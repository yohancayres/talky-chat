import { randomUUID } from 'crypto';
import {
  generateNewsMessage,
  generateProactiveMessage,
  generateReply,
  planPhoto,
} from './ai';
import { computeReplyDueAt, currentPresence } from './availability';
import { config } from './config';
import { DEFAULT_INTIMACY, clampIntimacy } from './intimacy';
import {
  clearChatPhotoGenerating,
  generateChatPhoto,
  isGeneratingAvatar,
  isGeneratingChatPhoto,
  markChatPhotoGenerating,
} from './image';
import {
  DEFAULT_SPLIT_STYLE,
  looksDelicate,
  splitMessages,
  typingDurationMs,
} from './messaging';
import { moodEmoji } from './mood';
import { recordConversationImpact, refreshDailyMood } from './moodService';
import { FOLLOWUP_DIRECTIVE, PHOTO_CAPTION_DIRECTIVE, PHOTO_DECLINE_DIRECTIVE } from './prompts';
import { sendPush } from './push';
import {
  addMessage,
  addPendingReply,
  getCharacter,
  getConversation,
  getMessages,
  getPushTokens,
  getUserActivity,
  hasPendingReply,
  listPendingReplies,
  listProactiveStates,
  removePendingReply,
  saveCharacter,
  setProactiveState,
} from './store';
import { Character, ChatPhoto, Message, PendingReply } from './types';

// Máximo de fotos guardadas por personagem (poda as mais antigas além disso).
const MAX_GALLERY = 30;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

// ---------------------------------------------------------------------------
// Sequência de envio por conversa. Cada nova mensagem do usuário incrementa a
// "geração" da conversa, o que CANCELA qualquer envio em andamento (partes ou
// follow-up) e faz começar uma nova sequência.
// ---------------------------------------------------------------------------
const sequenceGen = new Map<string, number>();

/** Chamado a cada mensagem do usuário: invalida a sequência em andamento. */
export function bumpSequence(conversationId: string): void {
  sequenceGen.set(conversationId, (sequenceGen.get(conversationId) ?? 0) + 1);
  followUps.delete(conversationId); // cancela follow-up pendente
}
function currentSequence(conversationId: string): number {
  return sequenceGen.get(conversationId) ?? 0;
}

// Sleep que aborta cedo se a sequência da conversa mudar (nova msg do usuário).
async function sleepOrCancel(ms: number, conversationId: string, gen: number): Promise<boolean> {
  let left = ms;
  while (left > 0) {
    if (currentSequence(conversationId) !== gen) return false;
    const chunk = Math.min(300, left);
    await sleep(chunk);
    left -= chunk;
  }
  return currentSequence(conversationId) === gen;
}

// ---------------------------------------------------------------------------
// "Digitando..." ao vivo: só durante a digitação real de cada parte (nunca na
// hora em que o usuário envia). Pode piscar (delicado) e cancela na interrupção.
// ---------------------------------------------------------------------------
const liveTyping = new Map<string, boolean>();

function setLiveTyping(conversationId: string, value: boolean): void {
  liveTyping.set(conversationId, value);
}
function clearLiveTyping(conversationId: string): void {
  liveTyping.delete(conversationId);
}

// Simula a digitação de uma parte (duração ~ tamanho). Em assunto delicado,
// digita de forma hesitante (digita, para, volta). Retorna false se foi
// interrompida (o usuário mandou outra mensagem).
async function simulateTyping(
  conversationId: string,
  text: string,
  delicate: boolean,
  gen: number,
): Promise<boolean> {
  const duration = typingDurationMs(text);
  if (!delicate) {
    setLiveTyping(conversationId, true);
    return sleepOrCancel(duration, conversationId, gen);
  }
  let budget = Math.round(duration * 1.8) + 2500;
  while (budget > 0) {
    setLiveTyping(conversationId, true);
    const type = randomInt(1500, 3500);
    if (!(await sleepOrCancel(Math.min(type, budget), conversationId, gen))) return false;
    budget -= type;
    if (budget <= 0) break;
    setLiveTyping(conversationId, false); // pausa: pensando/apagando
    const pause = randomInt(1500, 3500);
    if (!(await sleepOrCancel(pause, conversationId, gen))) return false;
    budget -= pause;
  }
  return true;
}

/**
 * Entrega uma resposta do personagem como UMA ou VÁRIAS mensagens, conforme o
 * estilo de picotar dele, com "digitando..." proporcional ao tamanho (e
 * hesitante em assuntos delicados). Retorna true se concluiu, false se foi
 * INTERROMPIDA por uma nova mensagem do usuário.
 */
async function emitMessages(
  conversationId: string,
  character: Character,
  fullText: string,
  opts: { lastUserText?: string } = {},
): Promise<boolean> {
  const parts = splitMessages(fullText, character.splitStyle ?? DEFAULT_SPLIT_STYLE);
  if (parts.length === 0) return true;
  const delicate = looksDelicate(`${opts.lastUserText ?? ''} ${fullText}`);
  const gen = currentSequence(conversationId);

  try {
    for (let i = 0; i < parts.length; i++) {
      // A hesitação (delicado) aparece sobretudo antes da 1ª parte.
      const typed = await simulateTyping(conversationId, parts[i], delicate && i === 0, gen);
      if (!typed) return false; // interrompido antes de enviar esta parte
      const message: Message = {
        id: randomUUID(),
        conversationId,
        role: 'character',
        senderId: character.id,
        senderName: character.name,
        text: parts[i],
        createdAt: new Date().toISOString(),
      };
      addMessage(message);
      await sendPush(getPushTokens(conversationId), character.name, parts[i], { conversationId });
      if (i < parts.length - 1) {
        setLiveTyping(conversationId, false);
        const gap = randomInt(500, 1400) * config.reply.typingSpeedFactor;
        if (!(await sleepOrCancel(gap, conversationId, gen))) return false;
      }
    }
    return true;
  } finally {
    clearLiveTyping(conversationId);
  }
}

// ---------------------------------------------------------------------------
// Follow-up: às vezes, 1-2 min após responder, o personagem manda uma segunda
// mensagem (uma emenda/complemento) — mas SÓ se o usuário não escreveu nesse meio.
// ---------------------------------------------------------------------------
const FOLLOWUP_CHANCE = 0.35;
const followUps = new Map<string, { dueAt: number; gen: number }>();

function scheduleFollowUp(conversationId: string): void {
  followUps.set(conversationId, {
    dueAt: Date.now() + randomInt(60, 120) * 1000,
    gen: currentSequence(conversationId),
  });
}

const inProgressFollowUps = new Set<string>();

async function deliverFollowUp(conversationId: string, gen: number): Promise<void> {
  const conversation = getConversation(conversationId);
  if (!conversation) return;
  const found = getCharacter(conversation.characterIds[0]);
  if (!found) return;
  const character = refreshDailyMood(found);

  // Não insiste se o personagem está dormindo ou já mandou muitas seguidas.
  if (currentPresence(character, new Date()).responsiveness === 'asleep') return;
  const history = getMessages(conversationId);
  if (trailingCharacterCount(history) > P.maxConsecutive) return;

  const text = await generateReply(character, history, {
    userName: conversation.userName,
    userStatus: conversation.userStatus,
    intimacy: conversation.intimacy,
    directive: FOLLOWUP_DIRECTIVE,
  });
  if (!text.trim()) return;
  // O usuário pode ter escrito enquanto gerava: aborta se a sequência mudou.
  if (currentSequence(conversationId) !== gen) return;
  await emitMessages(conversationId, character, text);
}

// Dispara os follow-ups vencidos cujas conversas seguem "quietas" (sem nova
// mensagem do usuário desde a resposta) e sem resposta pendente.
function processFollowUps(): void {
  const now = Date.now();
  for (const [conversationId, fu] of followUps) {
    if (fu.dueAt > now) continue;
    followUps.delete(conversationId);
    if (currentSequence(conversationId) !== fu.gen) continue; // usuário interagiu
    if (hasPendingReply(conversationId)) continue;
    if (isGeneratingChatPhoto(conversationId)) continue;
    if (inProgressFollowUps.has(conversationId)) continue;
    inProgressFollowUps.add(conversationId);
    void deliverFollowUp(conversationId, fu.gen)
      .catch((err) => console.error('[talky] erro no follow-up:', err))
      .finally(() => inProgressFollowUps.delete(conversationId));
  }
}

function lastUserText(history: Message[]): string {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === 'user') return history[i].text;
  }
  return '';
}

const P = config.proactive;

function randomInt(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min + 1));
}

function isQuietHour(hour: number): boolean {
  const { quietHoursStart: start, quietHoursEnd: end } = P;
  // Intervalo que cruza a meia-noite (ex: 23 -> 7).
  if (start > end) return hour >= start || hour < end;
  return hour >= start && hour < end;
}

/** Empurra a data para fora do "horário de sono", se necessário. */
function avoidQuietHours(date: Date): Date {
  if (!isQuietHour(date.getHours())) return date;
  const adjusted = new Date(date);
  // Se já passou do início do silêncio (noite), acorda no dia seguinte.
  if (P.quietHoursStart > P.quietHoursEnd && date.getHours() >= P.quietHoursStart) {
    adjusted.setDate(adjusted.getDate() + 1);
  }
  adjusted.setHours(P.quietHoursEnd, randomInt(0, 29), 0, 0);
  return adjusted;
}

// Mais intimidade => intervalo bem menor entre mensagens proativas (puxa
// assunto com mais frequência). ~1.0 (estranhos) .. ~0.25 (muito íntimos).
function intimacyGapFactor(intimacy?: number): number {
  return 1 - (clampIntimacy(intimacy ?? DEFAULT_INTIMACY) / 100) * 0.75;
}

/** Próximo horário previsto para uma mensagem espontânea (encurta com intimidade). */
export function scheduleNext(from: Date = new Date(), intimacy?: number): string {
  const base = randomInt(P.minGapMinutes, P.maxGapMinutes);
  const gap = Math.max(1, Math.round(base * intimacyGapFactor(intimacy)));
  const next = new Date(from.getTime() + gap * 60_000);
  return avoidQuietHours(next).toISOString();
}

export function initProactiveForConversation(conversationId: string): void {
  setProactiveState({
    conversationId,
    nextAt: scheduleNext(new Date(), getConversation(conversationId)?.intimacy),
    enabled: P.enabled,
  });
}

/** Chamado quando há atividade na conversa: reinicia a contagem de silêncio. */
export function touchProactive(conversationId: string): void {
  const state = listProactiveStates().find((s) => s.conversationId === conversationId);
  setProactiveState({
    conversationId,
    nextAt: scheduleNext(new Date(), getConversation(conversationId)?.intimacy),
    enabled: state?.enabled ?? P.enabled,
  });
}

/** Quantas mensagens do personagem há no fim, sem resposta do usuário. */
function trailingCharacterCount(messages: Message[]): number {
  let count = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'character') count++;
    else break;
  }
  return count;
}

const inProgress = new Set<string>();

async function fireProactive(conversationId: string, now: Date): Promise<void> {
  const conversation = getConversation(conversationId);
  if (!conversation) return;
  const found = getCharacter(conversation.characterIds[0]);
  if (!found) return;
  // Humor do dia em dia, para a mensagem espontânea refletir como ele(a) acordou.
  const character = refreshDailyMood(found, now);

  const history = getMessages(conversationId);
  const last = history[history.length - 1];

  // Parte das mensagens proativas é "movida a notícias": o personagem busca
  // algo real e recente sobre seus interesses/cotidiano e comenta.
  const useNews =
    config.webSearch.enabled &&
    character.interests.length > 0 &&
    Math.random() < config.webSearch.newsChance;

  const ctx = {
    userName: conversation.userName,
    userStatus: conversation.userStatus,
    intimacy: conversation.intimacy,
  };
  const text = useNews
    ? await generateNewsMessage(character, history, now, ctx)
    : await generateProactiveMessage(character, history, now, { ...ctx, lastMessageAt: last?.createdAt });
  if (!text.trim()) return;

  // Entrega como uma ou várias mensagens, com "digitando..." (mesmo ritmo das respostas).
  await emitMessages(conversationId, character, text);
}

async function tick(): Promise<void> {
  if (!P.enabled) return;
  const now = new Date();

  for (const state of listProactiveStates()) {
    if (!state.enabled) continue;
    if (new Date(state.nextAt).getTime() > now.getTime()) continue;
    if (inProgress.has(state.conversationId)) continue;

    // Intimidade desta conversa: encurta o intervalo entre proativas.
    const intimacy = getConversation(state.conversationId)?.intimacy;

    // Personagem "dormindo": reagenda para o fim do horário de silêncio.
    if (isQuietHour(now.getHours())) {
      setProactiveState({ ...state, nextAt: scheduleNext(now, intimacy) });
      continue;
    }

    // Já existe uma resposta a caminho: não interromper com mensagem proativa.
    if (hasPendingReply(state.conversationId)) {
      setProactiveState({ ...state, nextAt: scheduleNext(now, intimacy) });
      continue;
    }

    const messages = getMessages(state.conversationId);
    // Não acumular mensagens sem resposta: pausa até o usuário responder.
    if (trailingCharacterCount(messages) >= P.maxConsecutive) {
      setProactiveState({ ...state, nextAt: scheduleNext(now, intimacy) });
      continue;
    }

    inProgress.add(state.conversationId);
    // Empurra o próximo horário antes de gerar, evitando disparo duplicado.
    setProactiveState({ ...state, nextAt: scheduleNext(now, intimacy) });

    fireProactive(state.conversationId, now)
      .catch((err) => console.error('[talky] erro na mensagem proativa:', err))
      .finally(() => inProgress.delete(state.conversationId));
  }
}

// ---------------------------------------------------------------------------
// Respostas com atraso humano
// ---------------------------------------------------------------------------

const inProgressReplies = new Set<string>();

async function deliverReply(pending: PendingReply): Promise<void> {
  try {
    const conversation = getConversation(pending.conversationId);
    if (!conversation) return;
    const found = getCharacter(conversation.characterIds[0]);
    if (!found) return;
    // Atualiza o humor do dia antes de responder (entra no prompt).
    const character = refreshDailyMood(found);

    const history = getMessages(conversation.id);
    const text = await generateReply(character, history, {
      userName: conversation.userName,
      userStatus: conversation.userStatus,
      intimacy: conversation.intimacy,
      useWebSearch: config.webSearch.enabled && config.webSearch.inReplies,
    });
    if (!text.trim()) return;

    // Entrega em uma ou várias mensagens, com "digitando..." por tamanho
    // (hesitante se o assunto for delicado). Retorna false se foi interrompida.
    const completed = await emitMessages(conversation.id, character, text, {
      lastUserText: lastUserText(history),
    });
    touchProactive(conversation.id);
    // A conversa desloca o humor e a intimidade. Não bloqueia.
    void recordConversationImpact(conversation, character, getMessages(conversation.id)).catch(
      () => {},
    );

    // Se o usuário escreveu durante a entrega (interrompeu) ou logo depois, agenda
    // outra resposta para não deixar a mensagem dele sem retorno.
    const latest = getMessages(conversation.id);
    if (latest[latest.length - 1]?.role === 'user') {
      const { dueAt } = computeReplyDueAt(
        character,
        new Date(),
        getUserActivity(conversation.id),
        conversation.intimacy,
      );
      addPendingReply({
        id: randomUUID(),
        conversationId: conversation.id,
        dueAt: dueAt.toISOString(),
        createdAt: new Date().toISOString(),
      });
    } else if (completed && Math.random() < FOLLOWUP_CHANCE) {
      // Concluiu sem interrupção: às vezes manda uma emenda em 1-2 min (só se a
      // pessoa continuar quieta até lá).
      scheduleFollowUp(conversation.id);
    }
  } catch (err) {
    console.error('[talky] erro ao entregar resposta:', err);
  } finally {
    // Remove sempre (sucesso ou falha) para não reprocessar em loop.
    removePendingReply(pending.id);
  }
}

function processPendingReplies(): void {
  if (!config.reply.enabled) return;
  const now = Date.now();
  for (const pending of listPendingReplies()) {
    if (new Date(pending.dueAt).getTime() > now) continue;
    if (inProgressReplies.has(pending.id)) continue;
    inProgressReplies.add(pending.id);
    void deliverReply(pending).finally(() => inProgressReplies.delete(pending.id));
  }
}

// ---------------------------------------------------------------------------
// Fotos no chat ("manda uma foto de como você tá agora")
// ---------------------------------------------------------------------------

/**
 * Gera, em segundo plano, uma foto contextual do personagem (refletindo o que
 * está fazendo e o humor) e a entrega no chat com uma legenda curta. Se a
 * geração de imagem estiver indisponível/falhar, o personagem responde em texto.
 */
export function requestChatPhoto(conversationId: string, requestText: string): void {
  const canPhoto = config.image.enabled && !!config.openaiApiKey;
  if (canPhoto) markChatPhotoGenerating(conversationId);

  void (async () => {
    try {
      const conversation = getConversation(conversationId);
      if (!conversation) return;
      const found = getCharacter(conversation.characterIds[0]);
      if (!found) return;
      const character = refreshDailyMood(found);
      const history = getMessages(conversationId);
      const ctx = {
        userName: conversation.userName,
        userStatus: conversation.userStatus,
        intimacy: conversation.intimacy,
      };

      const base = {
        id: randomUUID(),
        conversationId,
        role: 'character' as const,
        senderId: character.id,
        senderName: character.name,
      };

      let message: Message | null = null;
      if (canPhoto) {
        const presence = currentPresence(character, new Date());
        const moodLabel = character.mood?.label;

        // Fotos já enviadas NESTA conversa não são reusadas (a mesma pessoa
        // sempre recebe uma diferente). As demais da galeria são candidatas.
        const sentUrls = new Set(
          getMessages(conversationId)
            .map((m) => m.imageUrl)
            .filter((u): u is string => Boolean(u)),
        );
        const gallery = character.photoGallery ?? [];
        const candidates = gallery.filter((p) => !sentUrls.has(p.imageUrl));

        // O modelo decide: reusar uma foto guardada ou descrever uma nova cena.
        const plan = await planPhoto(
          character,
          requestText,
          candidates.map((p) => ({ id: p.id, description: p.description })),
          { activity: presence.activity, mood: moodLabel },
        );

        const reused = plan.reuseId ? gallery.find((p) => p.id === plan.reuseId) : undefined;
        let imageUrl: string | null = null;
        let caption = '';

        if (reused) {
          // Reuso: manda a mesma foto (sem gerar), com uma legenda nova no jeito dele.
          console.log(`[talky] reusando foto guardada de ${character.name} (galeria).`);
          imageUrl = reused.imageUrl;
          caption = await generateReply(character, history, {
            ...ctx,
            directive: PHOTO_CAPTION_DIRECTIVE,
          });
        } else {
          // Nova foto: gera, guarda na galeria e poda as mais antigas.
          const [cap, newUrl] = await Promise.all([
            generateReply(character, history, { ...ctx, directive: PHOTO_CAPTION_DIRECTIVE }),
            generateChatPhoto(character, {
              activity: presence.activity,
              mood: moodLabel,
              scene: plan.scene,
            }),
          ]);
          caption = cap;
          imageUrl = newUrl;
          if (newUrl) {
            const photo: ChatPhoto = {
              id: randomUUID(),
              imageUrl: newUrl,
              description: plan.scene?.trim() || presence.activity || 'foto casual',
              createdAt: new Date().toISOString(),
            };
            // Mantém só as últimas MAX_GALLERY no pool de reuso. NÃO apaga os
            // arquivos: a mesma foto pode estar no histórico de várias conversas.
            const next = [...gallery, photo];
            const pruned = next.slice(Math.max(0, next.length - MAX_GALLERY));
            const fresh = getCharacter(character.id);
            if (fresh) saveCharacter({ ...fresh, photoGallery: pruned });
          }
        }

        if (imageUrl) {
          // createdAt no momento da entrega (a geração pode levar segundos).
          message = { ...base, text: caption.trim(), imageUrl, createdAt: new Date().toISOString() };
        }
      }

      if (!message) {
        // Sem foto (recurso off ou falha): responde em texto, no jeito dele.
        const declineText = await generateReply(character, history, {
          ...ctx,
          directive: PHOTO_DECLINE_DIRECTIVE,
        });
        if (!declineText.trim()) return;
        message = { ...base, text: declineText.trim(), createdAt: new Date().toISOString() };
      }

      addMessage(message);
      touchProactive(conversationId);
      await sendPush(
        getPushTokens(conversationId),
        character.name,
        message.imageUrl ? `📷 ${message.text || 'Foto'}` : message.text,
        { conversationId },
      );
      void recordConversationImpact(conversation, character, getMessages(conversationId)).catch(
        () => {},
      );
    } catch (err) {
      console.error('[talky] erro ao gerar foto de chat:', err);
    } finally {
      if (canPhoto) clearChatPhotoGenerating(conversationId);
    }
  })();
}

export interface ConversationStatus {
  state: 'online' | 'busy' | 'sleeping';
  /** O que o personagem está fazendo agora (ex: "trabalhando"). */
  activity: string;
  /** Resposta prestes a chegar — o app mostra "digitando...". */
  typing: boolean;
  /** Foto de perfil atual do personagem (pode ter mudado). */
  photoUrl?: string;
  /** Foto de perfil sendo gerada agora. */
  avatarGenerating: boolean;
  /** Rótulo do humor do dia (ex: "de bom humor", "meio pra baixo"). */
  mood?: string;
  /** Emoji do humor do dia. */
  moodEmoji?: string;
  /** O personagem está tirando/enviando uma foto agora. */
  photoGenerating: boolean;
}

export function getConversationStatus(conversationId: string): ConversationStatus {
  const conversation = getConversation(conversationId);
  const found = conversation && getCharacter(conversation.characterIds[0]);
  if (!found) {
    return {
      state: 'online',
      activity: '',
      typing: false,
      avatarGenerating: false,
      photoGenerating: false,
    };
  }

  const now = new Date();
  // Mantém o humor do dia em dia (re-sorteia ao virar o dia).
  const character = refreshDailyMood(found, now);
  const presence = currentPresence(character, now);
  // "Digitando" aparece SÓ enquanto o personagem está de fato digitando (durante
  // a entrega). Nunca na hora do envio do usuário — começa só depois do atraso
  // de "perceber a mensagem" (>= 1s), o que evita a sensação de automação.
  const typing = liveTyping.get(conversationId) === true;

  return {
    state: presence.state,
    activity: presence.activity,
    typing,
    photoUrl: character.photoUrl,
    avatarGenerating: isGeneratingAvatar(character.id),
    mood: config.mood.enabled ? character.mood?.label : undefined,
    moodEmoji: config.mood.enabled && character.mood ? moodEmoji(character.mood) : undefined,
    photoGenerating: isGeneratingChatPhoto(conversationId),
  };
}

export function startScheduler(): void {
  if (config.reply.enabled) {
    console.log(
      `[talky] respostas com atraso humano ativas (fator ${config.reply.speedFactor}, teto ${config.reply.maxAwakeMinutes} min).`,
    );
    setInterval(() => processPendingReplies(), config.reply.checkIntervalSeconds * 1000);
    // Verifica follow-ups (emendas 1-2 min depois) no mesmo ritmo.
    setInterval(() => processFollowUps(), config.reply.checkIntervalSeconds * 1000);
  } else {
    console.log('[talky] respostas imediatas (REPLY_DELAY_ENABLED=false).');
  }

  if (P.enabled) {
    console.log(
      `[talky] agendador de mensagens proativas ativo (intervalo ${P.minGapMinutes}-${P.maxGapMinutes} min).`,
    );
    setInterval(() => {
      void tick();
    }, P.checkIntervalSeconds * 1000);
  } else {
    console.log('[talky] mensagens proativas desativadas (PROACTIVE_ENABLED=false).');
  }
}

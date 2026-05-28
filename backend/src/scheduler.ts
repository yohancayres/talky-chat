import { randomUUID } from 'crypto';
import {
  decideAudioResponse,
  decidePhotoResponse,
  generateNewsMessage,
  generateProactiveMessage,
  generateReply,
} from './ai';
import { computeReplyDueAt, currentPresence, isFreshConversation, localHour } from './availability';
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
import { ensureCharacterVoice, recordConversationImpact, refreshDailyMood } from './moodService';
import { FOLLOWUP_DIRECTIVE, GOODNIGHT_DIRECTIVE, VACUO_DIRECTIVE } from './prompts';
import { sendPush } from './push';
import { generateSpeech } from './speech';
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

// "Gravando áudio..." ao vivo (enquanto gera o TTS) — distinto do "digitando".
const liveRecording = new Set<string>();
function setRecording(conversationId: string): void {
  liveRecording.add(conversationId);
}
function clearRecording(conversationId: string): void {
  liveRecording.delete(conversationId);
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
    userMemory: conversation.userMemory,
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

/**
 * Entrega a resposta como uma NOTA DE VOZ (TTS). O texto falado vai no `text`
 * (entra no contexto), mas o app exibe só o player. Retorna false se o TTS falhar.
 */
async function deliverVoiceReply(
  conversationId: string,
  characterIn: Character,
  text: string,
): Promise<boolean> {
  // Garante uma voz própria (personagens antigos não tinham → soavam iguais).
  const character = await ensureCharacterVoice(characterIn);
  setRecording(conversationId); // mostra "gravando áudio..." (não "digitando")
  let audioUrl: string | null = null;
  try {
    audioUrl = await generateSpeech(character, text, { mood: character.mood?.label });
  } finally {
    clearRecording(conversationId);
  }
  if (!audioUrl) return false;

  const message: Message = {
    id: randomUUID(),
    conversationId,
    role: 'character',
    senderId: character.id,
    senderName: character.name,
    text, // fica no contexto; o app não exibe (mostra só o player)
    audioUrl,
    createdAt: new Date().toISOString(),
  };
  addMessage(message);
  touchProactive(conversationId);
  await sendPush(getPushTokens(conversationId), character.name, '🎤 Áudio', { conversationId });
  return true;
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

// Chance de COBRAR quando ficou no vácuo, por personalidade: carinhoso/extrovertido
// reclama mais; formal/independente menos. ~10%..75% (é "às vezes", não sempre).
function complaintChance(t: Record<string, number>): number {
  const v = (k: string) => t[k] ?? 5;
  const c = 0.4 + (v('carinho') - 5) * 0.04 + (v('extroversao') - 5) * 0.03 - (v('formalidade') - 5) * 0.02;
  return Math.max(0.1, Math.min(0.75, c));
}

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
    userMemory: conversation.userMemory,
  };

  // Deixado no vácuo (a última mensagem é dele, você não respondeu): às vezes ele
  // cobra/reclama de leve, conforme a personalidade — em vez de puxar assunto novo.
  const ghosted = last?.role === 'character';
  const complain = ghosted && Math.random() < complaintChance(character.temperament ?? {});

  let text: string;
  if (complain) {
    text = await generateReply(character, history, { ...ctx, directive: VACUO_DIRECTIVE });
  } else if (useNews) {
    text = await generateNewsMessage(character, history, now, ctx);
  } else {
    text = await generateProactiveMessage(character, history, now, {
      ...ctx,
      lastMessageAt: last?.createdAt,
    });
  }
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
    const conv = getConversation(state.conversationId);
    const intimacy = conv?.intimacy;
    const chTz = conv ? getCharacter(conv.characterIds[0])?.timezone : undefined;

    // Horário de silêncio NO FUSO DO PERSONAGEM: reagenda (não cutuca de madrugada).
    if (isQuietHour(localHour(now, chTz))) {
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

// "Boa noite": quando o personagem ENTRA no sono e vocês conversaram nos últimos
// 30 min, ele manda uma despedida. `sleepGreeted` evita repetir na mesma dormida
// (reseta ao acordar). Roda independente das proativas.
const GOODNIGHT_RECENT_MS = 30 * 60_000;
const sleepGreeted = new Set<string>();
const inProgressGoodnight = new Set<string>();

async function processBedtimeGreetings(now: Date): Promise<void> {
  for (const state of listProactiveStates()) {
    const conversation = getConversation(state.conversationId);
    if (!conversation) continue;
    const found = getCharacter(conversation.characterIds[0]);
    if (!found) continue;

    // Conversa recém-criada fica sempre "acordada" — não conta como dormir.
    const fresh = isFreshConversation(conversation.createdAt, now);
    const asleep = !fresh && currentPresence(found, now).responsiveness === 'asleep';

    if (!asleep) {
      sleepGreeted.delete(state.conversationId); // acordou (ou fresh) → reseta
      continue;
    }
    if (sleepGreeted.has(state.conversationId) || inProgressGoodnight.has(state.conversationId)) {
      continue;
    }
    // Marca como "já se despediu nesta dormida" mesmo que não vá mandar (evita
    // reavaliar a cada tick durante toda a madrugada).
    sleepGreeted.add(state.conversationId);

    // Conversaram nos últimos 30 min? (precisa de uma mensagem do USUÁRIO recente)
    const messages = getMessages(state.conversationId);
    let lastUserAt: string | undefined;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        lastUserAt = messages[i].createdAt;
        break;
      }
    }
    if (!lastUserAt) continue;
    if (now.getTime() - new Date(lastUserAt).getTime() >= GOODNIGHT_RECENT_MS) continue;
    if (hasPendingReply(state.conversationId)) continue;

    inProgressGoodnight.add(state.conversationId);
    const character = refreshDailyMood(found, now);
    void (async () => {
      try {
        const text = await generateReply(character, getMessages(state.conversationId), {
          userName: conversation.userName,
          userStatus: conversation.userStatus,
          intimacy: conversation.intimacy,
          userMemory: conversation.userMemory,
          directive: GOODNIGHT_DIRECTIVE,
        });
        if (text.trim()) await emitMessages(state.conversationId, character, text);
      } catch (err) {
        console.error('[talky] erro na mensagem de boa noite:', err);
      } finally {
        inProgressGoodnight.delete(state.conversationId);
      }
    })();
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

    let text: string;
    if (pending.asAudio) {
      // O PERSONAGEM decide se manda voz. Se não quiser, responde em TEXTO — assim
      // não acontece o áudio dizendo "não vou mandar áudio".
      const decision = await decideAudioResponse(character, history, lastUserText(history), {
        userName: conversation.userName,
        intimacy: conversation.intimacy,
        userMemory: conversation.userMemory,
        mood: character.mood?.label,
      });
      if (decision.send && decision.text.trim()) {
        const delivered = await deliverVoiceReply(conversation.id, character, decision.text.trim());
        if (delivered) {
          void recordConversationImpact(conversation, character, getMessages(conversation.id)).catch(
            () => {},
          );
          return;
        }
        // TTS indisponível/falhou: entrega o MESMO conteúdo como texto.
        text = decision.text.trim();
      } else {
        // Não quis mandar áudio: a resposta dele (em texto) segue normalmente.
        text =
          decision.text.trim() ||
          (await generateReply(character, history, {
            userName: conversation.userName,
            userStatus: conversation.userStatus,
            intimacy: conversation.intimacy,
            userMemory: conversation.userMemory,
          }));
      }
    } else {
      text = await generateReply(character, history, {
        userName: conversation.userName,
        userStatus: conversation.userStatus,
        intimacy: conversation.intimacy,
        userMemory: conversation.userMemory,
        useWebSearch: config.webSearch.enabled && config.webSearch.inReplies,
      });
    }
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
        intimacy: conversation.intimacy,
        userMemory: conversation.userMemory,
      };
      const moodLabel = character.mood?.label;

      // Fotos já enviadas NESTA conversa não são reusadas (a mesma pessoa sempre
      // recebe uma diferente). As demais da galeria são candidatas a reuso.
      const sentUrls = new Set(
        history.map((m) => m.imageUrl).filter((u): u is string => Boolean(u)),
      );
      const gallery = character.photoGallery ?? [];
      const candidates = gallery.filter((p) => !sentUrls.has(p.imageUrl));

      // 1) O PERSONAGEM interpreta o pedido e decide, em personagem, se manda.
      const decision = await decidePhotoResponse(
        character,
        history,
        requestText,
        candidates.map((p) => ({ id: p.id, description: p.description })),
        { userName: conversation.userName, intimacy: conversation.intimacy, mood: moodLabel },
      );

      // 2a) Não quis mandar → responde em TEXTO, no jeito dele (entrega natural).
      if (!decision.send) {
        const text =
          decision.text || (await generateReply(character, history, ctx)); // fallback se vazio
        if (text.trim()) {
          await emitMessages(conversationId, character, text, { lastUserText: requestText });
        }
        void recordConversationImpact(conversation, character, getMessages(conversationId)).catch(
          () => {},
        );
        return;
      }

      // 2b) Vai mandar → reusa uma foto guardada ou gera uma nova com o contexto.
      const reused = decision.reuseId ? gallery.find((p) => p.id === decision.reuseId) : undefined;
      let imageUrl: string | null = reused?.imageUrl ?? null;

      if (!imageUrl) {
        const presence = currentPresence(character, new Date());
        markChatPhotoGenerating(conversationId);
        try {
          imageUrl = await generateChatPhoto(character, {
            activity: presence.activity,
            mood: moodLabel,
            scene: decision.scene,
          });
        } finally {
          clearChatPhotoGenerating(conversationId);
        }
        if (imageUrl) {
          const photo: ChatPhoto = {
            id: randomUUID(),
            imageUrl,
            description: decision.scene?.trim() || presence.activity || 'foto casual',
            createdAt: new Date().toISOString(),
          };
          // Mantém só as últimas MAX_GALLERY no pool de reuso (sem apagar arquivos).
          const next = [...gallery, photo];
          const pruned = next.slice(Math.max(0, next.length - MAX_GALLERY));
          const fresh = getCharacter(character.id);
          if (fresh) saveCharacter({ ...fresh, photoGallery: pruned });
        }
      }

      const caption = decision.text.trim();

      // Quis mandar mas a imagem falhou: ainda assim responde em texto (não fica mudo).
      if (!imageUrl) {
        if (caption) await emitMessages(conversationId, character, caption, { lastUserText: requestText });
        void recordConversationImpact(conversation, character, getMessages(conversationId)).catch(
          () => {},
        );
        return;
      }

      const message: Message = {
        id: randomUUID(),
        conversationId,
        role: 'character',
        senderId: character.id,
        senderName: character.name,
        text: caption,
        imageUrl,
        createdAt: new Date().toISOString(),
      };
      addMessage(message);
      touchProactive(conversationId);
      await sendPush(getPushTokens(conversationId), character.name, `📷 ${caption || 'Foto'}`, {
        conversationId,
      });
      void recordConversationImpact(conversation, character, getMessages(conversationId)).catch(
        () => {},
      );
    } catch (err) {
      console.error('[talky] erro ao responder pedido de foto:', err);
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
  /** O personagem está gravando um áudio agora (TTS em geração). */
  recordingAudio: boolean;
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
      recordingAudio: false,
    };
  }

  const now = new Date();
  // Mantém o humor do dia em dia (re-sorteia ao virar o dia).
  const character = refreshDailyMood(found, now);
  let presence = currentPresence(character, now);
  // Nos primeiros minutos da conversa, fica SEMPRE disponível (nunca dormindo).
  if (isFreshConversation(conversation?.createdAt, now)) {
    presence = {
      ...presence,
      state: 'online',
      activity: presence.state === 'sleeping' ? 'disponível' : presence.activity,
    };
  }
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
    recordingAudio: liveRecording.has(conversationId),
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

  // Despedida de "boa noite" ao entrar no sono (independe das proativas).
  setInterval(() => {
    void processBedtimeGreetings(new Date());
  }, 60_000);
}

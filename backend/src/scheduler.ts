import { randomUUID } from 'crypto';
import { generateNewsMessage, generateProactiveMessage, generateReply } from './ai';
import { currentPresence } from './availability';
import { config } from './config';
import { sendPush } from './push';
import {
  addMessage,
  getCharacter,
  getConversation,
  getMessages,
  getPendingReply,
  getPushTokens,
  hasPendingReply,
  listPendingReplies,
  listProactiveStates,
  removePendingReply,
  setProactiveState,
} from './store';
import { Message, PendingReply } from './types';

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

/** Próximo horário previsto para uma mensagem espontânea. */
export function scheduleNext(from: Date = new Date()): string {
  const gap = randomInt(P.minGapMinutes, P.maxGapMinutes);
  const next = new Date(from.getTime() + gap * 60_000);
  return avoidQuietHours(next).toISOString();
}

export function initProactiveForConversation(conversationId: string): void {
  setProactiveState({
    conversationId,
    nextAt: scheduleNext(),
    enabled: P.enabled,
  });
}

/** Chamado quando há atividade na conversa: reinicia a contagem de silêncio. */
export function touchProactive(conversationId: string): void {
  const state = listProactiveStates().find((s) => s.conversationId === conversationId);
  setProactiveState({
    conversationId,
    nextAt: scheduleNext(),
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
  const character = getCharacter(conversation.characterIds[0]);
  if (!character) return;

  const history = getMessages(conversationId);
  const last = history[history.length - 1];

  // Parte das mensagens proativas é "movida a notícias": o personagem busca
  // algo real e recente sobre seus interesses/cotidiano e comenta.
  const useNews =
    config.webSearch.enabled &&
    character.interests.length > 0 &&
    Math.random() < config.webSearch.newsChance;

  const ctx = { userName: conversation.userName, userStatus: conversation.userStatus };
  const text = useNews
    ? await generateNewsMessage(character, history, now, ctx)
    : await generateProactiveMessage(character, history, now, { ...ctx, lastMessageAt: last?.createdAt });
  if (!text.trim()) return;

  const message: Message = {
    id: randomUUID(),
    conversationId,
    role: 'character',
    senderId: character.id,
    senderName: character.name,
    text,
    createdAt: new Date().toISOString(),
  };
  addMessage(message);

  // Entrega push para o app fechado/em segundo plano.
  await sendPush(getPushTokens(conversationId), character.name, text, { conversationId });
}

async function tick(): Promise<void> {
  if (!P.enabled) return;
  const now = new Date();

  for (const state of listProactiveStates()) {
    if (!state.enabled) continue;
    if (new Date(state.nextAt).getTime() > now.getTime()) continue;
    if (inProgress.has(state.conversationId)) continue;

    // Personagem "dormindo": reagenda para o fim do horário de silêncio.
    if (isQuietHour(now.getHours())) {
      setProactiveState({ ...state, nextAt: scheduleNext(now) });
      continue;
    }

    // Já existe uma resposta a caminho: não interromper com mensagem proativa.
    if (hasPendingReply(state.conversationId)) {
      setProactiveState({ ...state, nextAt: scheduleNext(now) });
      continue;
    }

    const messages = getMessages(state.conversationId);
    // Não acumular mensagens sem resposta: pausa até o usuário responder.
    if (trailingCharacterCount(messages) >= P.maxConsecutive) {
      setProactiveState({ ...state, nextAt: scheduleNext(now) });
      continue;
    }

    inProgress.add(state.conversationId);
    // Empurra o próximo horário antes de gerar, evitando disparo duplicado.
    setProactiveState({ ...state, nextAt: scheduleNext(now) });

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
    const character = getCharacter(conversation.characterIds[0]);
    if (!character) return;

    const history = getMessages(conversation.id);
    const text = await generateReply(character, history, {
      userName: conversation.userName,
      userStatus: conversation.userStatus,
      useWebSearch: config.webSearch.enabled && config.webSearch.inReplies,
    });
    if (!text.trim()) return;

    const message: Message = {
      id: randomUUID(),
      conversationId: conversation.id,
      role: 'character',
      senderId: character.id,
      senderName: character.name,
      text,
      createdAt: new Date().toISOString(),
    };
    addMessage(message);
    touchProactive(conversation.id);
    await sendPush(getPushTokens(conversation.id), character.name, text, {
      conversationId: conversation.id,
    });
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

export interface ConversationStatus {
  state: 'online' | 'busy' | 'sleeping';
  /** O que o personagem está fazendo agora (ex: "trabalhando"). */
  activity: string;
  /** Resposta prestes a chegar — o app mostra "digitando...". */
  typing: boolean;
}

export function getConversationStatus(conversationId: string): ConversationStatus {
  const conversation = getConversation(conversationId);
  const character = conversation && getCharacter(conversation.characterIds[0]);
  if (!character) return { state: 'online', activity: '', typing: false };

  const now = new Date();
  const presence = currentPresence(character, now);
  const pending = getPendingReply(conversationId);
  const typing =
    !!pending &&
    presence.state !== 'sleeping' &&
    new Date(pending.dueAt).getTime() - now.getTime() <= config.reply.typingWindowSeconds * 1000;

  return { state: presence.state, activity: presence.activity, typing };
}

export function startScheduler(): void {
  if (config.reply.enabled) {
    console.log(
      `[talky] respostas com atraso humano ativas (fator ${config.reply.speedFactor}, teto ${config.reply.maxAwakeMinutes} min).`,
    );
    setInterval(() => processPendingReplies(), config.reply.checkIntervalSeconds * 1000);
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

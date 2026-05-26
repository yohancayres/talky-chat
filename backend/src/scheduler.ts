import { randomUUID } from 'crypto';
import { generateProactiveMessage } from './ai';
import { config } from './config';
import {
  addMessage,
  getCharacter,
  getConversation,
  getMessages,
  listProactiveStates,
  setProactiveState,
} from './store';
import { Message } from './types';

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

  const text = await generateProactiveMessage(
    character,
    history,
    conversation.userName,
    now,
    last?.createdAt,
  );
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

export function startScheduler(): void {
  if (!P.enabled) {
    console.log('[talky] mensagens proativas desativadas (PROACTIVE_ENABLED=false).');
    return;
  }
  console.log(
    `[talky] agendador de mensagens proativas ativo (intervalo ${P.minGapMinutes}-${P.maxGapMinutes} min, silêncio ${P.quietHoursStart}h-${P.quietHoursEnd}h).`,
  );
  setInterval(() => {
    void tick();
  }, P.checkIntervalSeconds * 1000);
}

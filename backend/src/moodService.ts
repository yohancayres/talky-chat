import { assessConversationImpact } from './ai';
import { config } from './config';
import { DEFAULT_INTIMACY, applyIntimacyDelta } from './intimacy';
import { DEFAULT_SPLIT_STYLE } from './messaging';
import { applyMoodShift, ensureDailyMood } from './mood';
import { getCharacter, getConversation, saveCharacter, saveConversation } from './store';
import { Character, Conversation, Message } from './types';

// Avalia humor/intimidade a cada N mensagens da conversa (não a cada mensagem),
// para economizar chamadas ao modelo. Conta o tamanho do histórico desde a
// última avaliação (estado em memória; reinício re-sincroniza naturalmente).
const ASSESS_EVERY = Math.max(1, Number(process.env.IMPACT_ASSESS_EVERY ?? 10));
const lastAssessedCount = new Map<string, number>();

/**
 * Garante que o personagem está com o humor do dia atual (re-sorteia e persiste
 * se virou o dia). Retorna o personagem possivelmente atualizado.
 */
export function refreshDailyMood(character: Character, now: Date = new Date()): Character {
  if (!config.mood.enabled) return character;
  const { mood, changed } = ensureDailyMood(character, now);
  if (!changed) return character;
  const updated = { ...character, mood };
  saveCharacter(updated);
  return updated;
}

/**
 * Numa única avaliação, atualiza o HUMOR do personagem (global) e a INTIMIDADE
 * desta conversa (por usuário) com base no impacto do papo recente. Best-effort
 * e não-bloqueante: chame SEM await após entregar a resposta.
 */
export async function recordConversationImpact(
  conversation: Conversation,
  character: Character,
  history: Message[],
  now: Date = new Date(),
): Promise<void> {
  const moodOn = config.mood.enabled && config.mood.conversationEffect;
  const intimacyOn = config.intimacy.enabled;
  if (!moodOn && !intimacyOn) return;

  // Só reavalia a cada ASSESS_EVERY mensagens novas desta conversa.
  const last = lastAssessedCount.get(conversation.id) ?? 0;
  if (history.length - last < ASSESS_EVERY) return;
  lastAssessedCount.set(conversation.id, history.length);

  const level = conversation.intimacy ?? DEFAULT_INTIMACY;
  const impact = await assessConversationImpact(character, history, level);

  // Personagem (global): humor + estilo de picotar. Relê e salva uma vez só.
  const freshChar = getCharacter(character.id) ?? character;
  let updatedChar = freshChar;
  let charChanged = false;

  if (moodOn && (impact.valenceDelta !== 0 || impact.energyDelta !== 0)) {
    const base = ensureDailyMood(freshChar, now).mood;
    updatedChar = { ...updatedChar, mood: applyMoodShift(base, impact, now) };
    charChanged = true;
  }
  if (impact.splitStyleDelta !== 0) {
    // Feedback sobre o jeito de mandar mensagens ajusta o estilo (global).
    const cur = freshChar.splitStyle ?? DEFAULT_SPLIT_STYLE;
    const next = Math.max(0, Math.min(100, Math.round(cur + impact.splitStyleDelta)));
    updatedChar = { ...updatedChar, splitStyle: next };
    charChanged = true;
  }
  if (charChanged) saveCharacter(updatedChar);

  // Conversa (por usuário): intimidade. Ganhos usam a taxa própria do personagem;
  // o atrito (queda) não é amortecido. Relê para não sobrescrever mudanças.
  if (intimacyOn && impact.intimacyDelta !== 0) {
    const freshConv = getConversation(conversation.id) ?? conversation;
    const gain = freshChar.intimacyGain ?? 1;
    const delta = impact.intimacyDelta > 0 ? impact.intimacyDelta * gain : impact.intimacyDelta;
    const next = applyIntimacyDelta(freshConv.intimacy ?? DEFAULT_INTIMACY, delta);
    saveConversation({ ...freshConv, intimacy: next });
  }
}

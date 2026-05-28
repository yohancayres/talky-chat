import { config } from './config';
import { DEFAULT_INTIMACY, clampIntimacy } from './intimacy';
import { Character, Responsiveness, ScheduleBlock } from './types';

export type StatusState = 'online' | 'busy' | 'sleeping';

/** Hora (0-23) no fuso do personagem; sem fuso, cai na hora do servidor. */
export function localHour(now: Date, timezone?: string): number {
  if (!timezone) return now.getHours();
  try {
    const h = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      hour12: false,
    }).format(now);
    const n = parseInt(h, 10);
    return Number.isFinite(n) ? n % 24 : now.getHours();
  } catch {
    return now.getHours();
  }
}

/** Data + hora local do personagem, em pt-BR (para contexto no prompt). */
export function localDateTimeStr(now: Date, timezone?: string): string {
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: timezone,
      weekday: 'long',
      day: '2-digit',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
    }).format(now);
  } catch {
    return new Intl.DateTimeFormat('pt-BR', {
      weekday: 'long',
      day: '2-digit',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
    }).format(now);
  }
}

// Janela de "boas-vindas" após criar a conversa: responde rápido e fica sempre
// disponível (nunca dormindo). Depois disso, normaliza para o comportamento normal.
export const FRESH_CONVERSATION_MS = 10 * 60_000;

/** A conversa foi criada há menos de FRESH_CONVERSATION_MS? */
export function isFreshConversation(createdAt: string | undefined, now: Date = new Date()): boolean {
  if (!createdAt) return false;
  return now.getTime() - new Date(createdAt).getTime() < FRESH_CONVERSATION_MS;
}

export interface Presence {
  activity: string;
  responsiveness: Responsiveness;
  state: StatusState;
}

export function defaultSchedule(): ScheduleBlock[] {
  return [
    { startHour: 0, endHour: 7, activity: 'dormindo', responsiveness: 'asleep' },
    { startHour: 7, endHour: 9, activity: 'começando o dia', responsiveness: 'fast' },
    { startHour: 9, endHour: 12, activity: 'trabalhando', responsiveness: 'slow' },
    { startHour: 12, endHour: 13, activity: 'no almoço', responsiveness: 'fast' },
    { startHour: 13, endHour: 18, activity: 'trabalhando', responsiveness: 'slow' },
    { startHour: 18, endHour: 23, activity: 'relaxando em casa', responsiveness: 'fast' },
    { startHour: 23, endHour: 24, activity: 'dormindo', responsiveness: 'asleep' },
  ];
}

function scheduleOf(character: Character): ScheduleBlock[] {
  return character.schedule && character.schedule.length > 0
    ? character.schedule
    : defaultSchedule();
}

function blockCoversHour(block: ScheduleBlock, hour: number): boolean {
  if (block.startHour <= block.endHour) {
    return hour >= block.startHour && hour < block.endHour;
  }
  // Bloco que cruza a meia-noite (ex: 23 -> 7).
  return hour >= block.startHour || hour < block.endHour;
}

function currentBlock(schedule: ScheduleBlock[], hour: number): ScheduleBlock {
  return (
    schedule.find((b) => blockCoversHour(b, hour)) ?? {
      startHour: hour,
      endHour: (hour + 1) % 24,
      activity: 'livre',
      responsiveness: 'fast',
    }
  );
}

function stateOf(responsiveness: Responsiveness): StatusState {
  if (responsiveness === 'asleep') return 'sleeping';
  if (responsiveness === 'fast') return 'online';
  return 'busy';
}

/** O que o personagem está fazendo agora (na HORA LOCAL dele). */
export function currentPresence(character: Character, now: Date): Presence {
  const block = currentBlock(scheduleOf(character), localHour(now, character.timezone));
  return {
    activity: block.activity,
    responsiveness: block.responsiveness,
    state: stateOf(block.responsiveness),
  };
}

function randomInt(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min + 1));
}

/** Próximo horário em que o personagem não está mais dormindo (hora local dele). */
function nextWake(schedule: ScheduleBlock[], now: Date, timezone?: string): Date {
  for (let i = 1; i <= 24; i++) {
    const candidate = new Date(now.getTime() + i * 3_600_000);
    if (currentBlock(schedule, localHour(candidate, timezone)).responsiveness !== 'asleep') {
      candidate.setMinutes(randomInt(0, 20), 0, 0);
      return candidate;
    }
  }
  return new Date(now.getTime() + 8 * 3_600_000);
}

function isUserActiveHour(activity: number[] | undefined, hour: number): boolean {
  if (!activity) return false;
  const total = activity.reduce((a, b) => a + b, 0);
  if (total < 5) return false;
  const topHours = activity
    .map((count, h) => ({ h, count }))
    .filter((x) => x.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 3)
    .map((x) => x.h);
  return topHours.includes(hour);
}

/**
 * Quanto a conversa estar OCIOSA aumenta o tempo de resposta. É uma TENDÊNCIA
 * aleatória: quanto mais tempo parada, maior o teto do atraso — mas o sorteio
 * ainda permite respostas rápidas de vez em quando.
 */
function idleFactor(idleMs?: number): number {
  if (!idleMs || idleMs <= 0) return 1;
  const idleHours = idleMs / 3_600_000;
  const trend = Math.min(idleHours / 8, 1); // satura em ~8h de silêncio
  const maxBoost = 3; // até ~4x quando bem ociosa
  return 1 + trend * maxBoost * Math.random(); // 1x (rápido) .. 1+trend*3 (lento)
}

// Cauda longa: a maioria das respostas é rápida, algumas demoram minutos.
function sampleAwakeDelayMs(): number {
  const r = Math.random();
  if (r < 0.6) return randomInt(3, 45) * 1000; // 3-45s
  if (r < 0.9) return randomInt(45, 240) * 1000; // 45s-4min
  return randomInt(240, 900) * 1000; // 4-15min
}

/**
 * Quando o personagem deve responder, considerando a atividade atual, o acaso e
 * os horários em que o usuário costuma conversar.
 */
export function computeReplyDueAt(
  character: Character,
  now: Date,
  userActivityByHour?: number[],
  intimacy?: number,
  idleMs?: number,
  fresh?: boolean,
): { dueAt: Date; sleeping: boolean } {
  // Conversa recém-criada (primeiros minutos): responde rápido e NUNCA dormindo,
  // pra dar as boas-vindas sem demora. Depois normaliza para o comportamento normal.
  if (fresh) {
    return { dueAt: new Date(now.getTime() + randomInt(2000, 15000)), sleeping: false };
  }

  const schedule = scheduleOf(character);
  const block = currentBlock(schedule, localHour(now, character.timezone));

  if (block.responsiveness === 'asleep') {
    return { dueAt: nextWake(schedule, now, character.timezone), sleeping: true };
  }

  // Menos intimidade => demora mais pra começar a responder.
  const lowIntimacy = 1 - clampIntimacy(intimacy ?? DEFAULT_INTIMACY) / 100; // 0 íntimo .. 1 estranho
  const intimacyMult = 1 + lowIntimacy * 1.8; // ~1.0 (íntimo) .. ~2.8 (estranhos)

  // Mantém o comportamento atual (às vezes demora minutos) e aplica os fatores.
  let ms = sampleAwakeDelayMs();
  if (block.responsiveness === 'away') ms *= randomInt(5, 10);
  else if (block.responsiveness === 'slow') ms *= randomInt(2, 4);
  if (isUserActiveHour(userActivityByHour, now.getHours())) ms *= 0.5;
  ms *= intimacyMult;
  ms *= idleFactor(idleMs); // conversa ociosa há muito tempo => tende a demorar mais
  ms *= config.reply.speedFactor;

  // Piso: sempre 1-3s antes de começar a responder; um pouco maior com pouca
  // intimidade (não é afetado pelo speedFactor, pra valer mesmo em teste).
  const minMs = Math.round(randomInt(1000, 3000) * (1 + lowIntimacy));
  const maxMs = config.reply.maxAwakeMinutes * 60_000;
  ms = Math.min(Math.max(ms, minMs), maxMs);
  return { dueAt: new Date(now.getTime() + ms), sleeping: false };
}

import { config } from './config';
import { Character, Responsiveness, ScheduleBlock } from './types';

export type StatusState = 'online' | 'busy' | 'sleeping';

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

/** O que o personagem está fazendo agora. */
export function currentPresence(character: Character, now: Date): Presence {
  const block = currentBlock(scheduleOf(character), now.getHours());
  return {
    activity: block.activity,
    responsiveness: block.responsiveness,
    state: stateOf(block.responsiveness),
  };
}

function randomInt(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min + 1));
}

/** Próximo horário em que o personagem não está mais dormindo. */
function nextWake(schedule: ScheduleBlock[], now: Date): Date {
  for (let i = 1; i <= 24; i++) {
    const candidate = new Date(now);
    candidate.setHours(now.getHours() + i, randomInt(0, 20), 0, 0);
    if (currentBlock(schedule, candidate.getHours()).responsiveness !== 'asleep') {
      return candidate;
    }
  }
  const fallback = new Date(now);
  fallback.setHours(now.getHours() + 8);
  return fallback;
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
): { dueAt: Date; sleeping: boolean } {
  const schedule = scheduleOf(character);
  const block = currentBlock(schedule, now.getHours());

  if (block.responsiveness === 'asleep') {
    return { dueAt: nextWake(schedule, now), sleeping: true };
  }

  let ms = sampleAwakeDelayMs();
  if (block.responsiveness === 'away') ms *= randomInt(5, 10);
  else if (block.responsiveness === 'slow') ms *= randomInt(2, 4);
  if (isUserActiveHour(userActivityByHour, now.getHours())) ms *= 0.5;
  ms *= config.reply.speedFactor;

  const maxMs = config.reply.maxAwakeMinutes * 60_000;
  ms = Math.min(Math.max(ms, 1000), maxMs);
  return { dueAt: new Date(now.getTime() + ms), sleeping: false };
}

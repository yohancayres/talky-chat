import { Character, Mood } from './types';

// ---------------------------------------------------------------------------
// Humor da persona — circumplexo de afeto: valence (triste↔feliz) x energy
// (cansado/entediado↔elétrico). Varia dia a dia e ao longo das conversas.
// ---------------------------------------------------------------------------

export interface MoodShift {
  /** Deslocamento de valence pela conversa (-3..3; feliz+, triste-). */
  valenceDelta: number;
  /** Deslocamento de energy pela conversa (-3..3; animado+, cansado-). */
  energyDelta: number;
  reason?: string;
}

const REASONS_GOOD = [
  'acordou bem disposto(a)',
  'dormiu super bem',
  'tá numa fase boa',
  'o dia começou redondo',
  'acordou de bem com a vida',
];
const REASONS_NEUTRAL = [
  'um dia comum',
  'nada de especial até agora',
  'no automático hoje',
  'só levando o dia',
];
const REASONS_LOW = [
  'dormiu mal',
  'acordou meio pra baixo',
  'semana puxada',
  'um dia meio cinza',
  'bateu uma tristeza sem motivo claro',
  'acordou desanimado(a)',
];
const REASONS_TIRED = [
  'exausto(a) da rotina',
  'cansaço acumulado',
  'mal pregou o olho',
  'sem energia nenhuma hoje',
];

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Soma de 3 uniformes ~ aproxima uma normal centrada em 0; range ~[-1.5,1.5]*scale.
function noise(scale: number): number {
  return (Math.random() + Math.random() + Math.random() - 1.5) * scale;
}

/** Dia civil local (YYYY-MM-DD) — base para re-sortear o humor a cada dia. */
export function localDay(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Rótulo do humor a partir das duas dimensões (valores já arredondados). */
export function moodLabel(valence: number, energy: number): string {
  if (valence <= -4) return energy <= -2 ? 'pra baixo e sem energia' : 'bem desanimado(a)';
  if (valence <= -2) {
    if (energy <= -2) return 'cansado(a) e desanimado(a)';
    if (energy >= 3) return 'irritadiço(a)';
    return 'meio pra baixo';
  }
  if (valence >= 4) return energy >= 2 ? 'super animado(a)' : 'feliz e tranquilo(a)';
  if (valence >= 2) {
    if (energy <= -2) return 'contente, mas cansado(a)';
    return 'de bom humor';
  }
  // valence neutra (-1..1)
  if (energy <= -3) return 'exausto(a)';
  if (energy <= -1) return 'meio entediado(a)';
  if (energy >= 3) return 'agitado(a)';
  return 'num dia normal';
}

/** Emoji que representa o humor (usado no status/perfil no app). */
export function moodEmoji(mood: Mood): string {
  const v = Math.round(mood.valence);
  const e = Math.round(mood.energy);
  if (v >= 3) return e >= 2 ? '🤩' : '😄';
  if (v >= 1) return e <= -2 ? '😌' : '🙂';
  if (v <= -3) return e <= -2 ? '😞' : '😢';
  if (v <= -1) return e <= -2 ? '😪' : '😕';
  if (e <= -3) return '🥱';
  if (e >= 3) return '😬';
  return '😐';
}

function pickReason(valence: number, energy: number): string {
  if (energy <= -3 && valence <= 1) return pick(REASONS_TIRED);
  if (valence >= 2) return pick(REASONS_GOOD);
  if (valence <= -2) return pick(REASONS_LOW);
  return pick(REASONS_NEUTRAL);
}

// O temperamento enviesa o humor típico: otimista/bem-humorado tende a dias
// melhores; extrovertido tende a mais energia.
function temperamentBias(t: Record<string, number> = {}): { v: number; e: number } {
  const otimismo = (t.otimismo ?? 5) - 5;
  const humor = (t.humor ?? 5) - 5;
  const docura = (t.docura ?? 5) - 5;
  const extroversao = (t.extroversao ?? 5) - 5;
  return {
    v: otimismo * 0.45 + humor * 0.2 + docura * 0.1,
    e: extroversao * 0.4 + humor * 0.1,
  };
}

/** Sorteia o humor do dia, com viés do temperamento e leve inércia do dia anterior. */
export function rollDailyMood(
  prev: Mood | undefined,
  temperament: Record<string, number> | undefined,
  now: Date,
): Mood {
  const bias = temperamentBias(temperament);
  const inertiaV = prev ? prev.valence * 0.2 : 0;
  const inertiaE = prev ? prev.energy * 0.2 : 0;
  const valence = clamp(Math.round(noise(3.2) + bias.v + inertiaV), -5, 5);
  const energy = clamp(Math.round(noise(3.0) + bias.e + inertiaE), -5, 5);
  return {
    valence,
    energy,
    label: moodLabel(valence, energy),
    note: pickReason(valence, energy),
    day: localDay(now),
    updatedAt: now.toISOString(),
  };
}

/**
 * Garante que o humor é do dia atual; re-sorteia se for de outro dia (ou se
 * ainda não existir). `changed` indica se foi preciso re-sortear (persistir).
 */
export function ensureDailyMood(character: Character, now: Date): { mood: Mood; changed: boolean } {
  const today = localDay(now);
  if (character.mood && character.mood.day === today) {
    return { mood: character.mood, changed: false };
  }
  return { mood: rollDailyMood(character.mood, character.temperament, now), changed: true };
}

/** Aplica o impacto de uma conversa ao humor, de forma gradual e limitada. */
export function applyMoodShift(mood: Mood, shift: MoodShift, now: Date): Mood {
  // Amortece: uma conversa não vira o dia de cabeça pra baixo, mas acumula.
  const dv = clamp(shift.valenceDelta, -3, 3) * 0.6;
  const de = clamp(shift.energyDelta, -3, 3) * 0.6;
  const valence = clamp(Math.round((mood.valence + dv) * 10) / 10, -5, 5);
  const energy = clamp(Math.round((mood.energy + de) * 10) / 10, -5, 5);
  const significant = Math.abs(dv) >= 0.9 || Math.abs(de) >= 0.9;
  return {
    ...mood,
    valence,
    energy,
    label: moodLabel(Math.round(valence), Math.round(energy)),
    note: significant && shift.reason ? shift.reason : mood.note,
    updatedAt: now.toISOString(),
  };
}

/** Trecho de prompt que faz a persona deixar o humor transparecer no tom. */
export function describeMoodForPrompt(mood: Mood): string {
  const valenceHint =
    mood.valence <= -3
      ? ' Tá num dia difícil: pode soar mais desanimado(a), curto(a) ou sensível, sem dramatizar.'
      : mood.valence >= 3
        ? ' Tá num dia ótimo: mais leve, positivo(a) e disposto(a).'
        : '';
  const energyHint =
    mood.energy <= -3
      ? ' Está com pouquíssima energia/cansado(a), então tende a falar menos e de forma mais arrastada.'
      : mood.energy >= 3
        ? ' Está agitado(a)/elétrico(a), com vontade de conversar e puxar assunto.'
        : '';
  return `\n# Seu humor hoje\nVocê acordou ${mood.label}${mood.note ? ` — ${mood.note}` : ''}.${valenceHint}${energyHint} Deixe isso colorir SUTILMENTE seu tom, sua energia e o que tem vontade de falar — sem anunciar de forma robótica "estou com humor X". Se a pessoa perguntar como você está, responda coerente com isso. Seu humor pode ir mudando ao longo da conversa conforme o papo.\n`;
}

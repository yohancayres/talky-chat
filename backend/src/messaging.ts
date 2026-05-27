import { config } from './config';

// ---------------------------------------------------------------------------
// Ritmo de mensagens: picotar conforme o estilo do personagem, duração de
// "digitação" pelo tamanho, e detecção de assunto delicado (digitação hesitante).
// ---------------------------------------------------------------------------

/** Estilo de picotar padrão (para personagens sem `splitStyle` definido). */
export const DEFAULT_SPLIT_STYLE = 35;

const MAX_PARTS = 5;

function splitSentences(text: string): string[] {
  const pieces = text.match(/[^.!?…]+[.!?…]*\s*/g) ?? [text];
  return pieces.map((p) => p.trim()).filter(Boolean);
}

function capParts(parts: string[], max: number): string[] {
  if (parts.length <= max) return parts;
  const head = parts.slice(0, max - 1);
  const tail = parts.slice(max - 1).join('\n');
  return [...head, tail];
}

/**
 * Divide o texto da resposta em uma ou mais mensagens conforme o estilo de
 * picotar do personagem (0 = tudo numa mensagem; 100 = tudo separado).
 */
export function splitMessages(text: string, splitStyle: number): string[] {
  const clean = text.trim();
  if (!clean) return [];
  const style = Math.max(0, Math.min(100, splitStyle));

  // Unidades naturais: linhas não vazias (o modelo já separa ideias com \n).
  let units = clean
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean);

  // Muito picotado: quebra também as linhas longas em frases.
  if (style >= 65) {
    units = units.flatMap((u) => (u.length > 60 ? splitSentences(u) : [u]));
  }
  if (units.length <= 1) return units.length ? units : [clean];

  // Agrupa unidades adjacentes: quanto MENOR o estilo, maior a chance de juntar.
  const mergeProb = (100 - style) / 100;
  const out: string[] = [];
  for (const u of units) {
    if (out.length > 0 && Math.random() < mergeProb) {
      out[out.length - 1] += '\n' + u;
    } else {
      out.push(u);
    }
  }
  return capParts(out, MAX_PARTS);
}

/** Duração de "digitação" (ms) proporcional ao tamanho do texto. */
export function typingDurationMs(text: string): number {
  const charsPerSec = 7; // digitação rápida de celular
  const ms = (text.length / charsPerSec) * 1000;
  const base = Math.max(900, Math.min(ms, 11000));
  return Math.round(base * config.reply.typingSpeedFactor);
}

// Assuntos delicados/constrangedores → digitação hesitante (digita, para, volta).
const DELICATE_PATTERNS: RegExp[] = [
  /\b(term(inar|inei|inamos|ino)|separa(r|ção|mos)|div[oó]rcio|romp(er|i|emos))\b/i,
  /\b(morte|morr(eu|i)|faleceu|luto|enterro|velório)\b/i,
  /\b(doen(ça|te)|c[âa]ncer|depress(ão|ivo)|ansiedade|hospital|diagn[óo]stico)\b/i,
  /\b(demit(ido|ida|iram|i)|demiss(ão)|fui mandado embora|perdi o emprego)\b/i,
  /\b(briga(mos|ram)?|discuss(ão|ao)|traí(u|ção)?|me traiu|terminou comigo)\b/i,
  /\b(chor(ei|ando|ar)|desabaf|t[oô] mal|n[ãa]o t[oô] bem|preciso (te )?contar|tenho que te contar)\b/i,
  /\b(me desculp|desculpa|perd[ãa]o|foi mal mesmo|vergonha|constrang)\b/i,
  /\b(te amo|gosto de voc[eê]|apaixon|sinto sua falta|fica comigo)\b/i,
];

/** A mensagem trata de algo delicado/constrangedor? (digitação intermitente) */
export function looksDelicate(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return DELICATE_PATTERNS.some((re) => re.test(t));
}

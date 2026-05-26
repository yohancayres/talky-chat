import { randomUUID } from 'crypto';
import type Anthropic from '@anthropic-ai/sdk';
import { anthropic } from './anthropicClient';
import { config } from './config';
import {
  CHARACTER_GEN_SYSTEM,
  TEMPERAMENT_KEYS,
  buildCharacterUserPrompt,
  buildChatSystemPrompt,
  buildNewsDirective,
  buildProactiveDirective,
} from './prompts';
import { currentPresence, defaultSchedule } from './availability';
import { Character, Message, Responsiveness, ScheduleBlock } from './types';

type ApiMessage = { role: 'user' | 'assistant'; content: string };

function extractText(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
}

// Quando há busca na web, queremos só a mensagem final (texto após o último
// uso de ferramenta), não eventuais comentários do modelo antes de pesquisar.
function extractComposedText(content: Anthropic.ContentBlock[]): string {
  let lastToolIndex = -1;
  content.forEach((block, i) => {
    if (block.type === 'server_tool_use' || block.type === 'web_search_tool_result') {
      lastToolIndex = i;
    }
  });
  const tail = lastToolIndex >= 0 ? content.slice(lastToolIndex + 1) : content;
  const text = tail
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
  return text || extractText(content);
}

function extractJSON(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    // O modelo às vezes embrulha o JSON em texto; pega o primeiro objeto.
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start !== -1 && end > start) {
      return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
    }
    throw new Error('Não foi possível interpretar o JSON do personagem.');
  }
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((v) => String(v)) : [];
}

function todayStr(): string {
  return new Date().toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export async function generateCharacter(
  hint?: string,
  userName?: string,
): Promise<Character> {
  const resp = await anthropic.messages.create({
    model: config.model,
    max_tokens: 8000,
    system: CHARACTER_GEN_SYSTEM,
    messages: [{ role: 'user', content: buildCharacterUserPrompt(hint, userName) }],
  });

  const data = extractJSON(extractText(resp.content));

  const timeline = Array.isArray(data.timeline)
    ? (data.timeline as Record<string, unknown>[]).map((t) => ({
        age: String(t.age ?? ''),
        title: String(t.title ?? ''),
        description: String(t.description ?? ''),
      }))
    : [];

  const schedule = normalizeSchedule(data.schedule);
  const temperament = normalizeTemperament(data.temperament);

  return {
    id: randomUUID(),
    name: String(data.name ?? 'Alex'),
    age: Number(data.age ?? 28),
    occupation: String(data.occupation ?? ''),
    location: String(data.location ?? ''),
    avatar: {
      emoji: String(data.avatarEmoji ?? '🙂'),
      color: String(data.avatarColor ?? '#E07A5F'),
    },
    personality: {
      summary: String(data.personalitySummary ?? ''),
      traits: asStringArray(data.traits),
      quirks: asStringArray(data.quirks),
      values: asStringArray(data.values),
      speakingStyle: String(data.speakingStyle ?? ''),
    },
    interests: asStringArray(data.interests),
    backstory: String(data.backstory ?? ''),
    routine: String(data.routine ?? ''),
    timeline,
    temperament,
    schedule,
    createdAt: new Date().toISOString(),
  };
}

function normalizeTemperament(value: unknown): Record<string, number> {
  const data = (value ?? {}) as Record<string, unknown>;
  const result: Record<string, number> = {};
  for (const key of TEMPERAMENT_KEYS) {
    const n = Math.round(Number(data[key]));
    // Faltando? valor variado para não cair tudo no meio.
    result[key] = Number.isFinite(n) ? Math.min(Math.max(n, 0), 10) : 2 + Math.floor(Math.random() * 5);
  }
  return result;
}

const VALID_RESPONSIVENESS: Responsiveness[] = ['fast', 'slow', 'away', 'asleep'];

function normalizeSchedule(value: unknown): ScheduleBlock[] {
  if (!Array.isArray(value)) return defaultSchedule();
  const blocks: ScheduleBlock[] = [];
  for (const raw of value as Record<string, unknown>[]) {
    const startHour = Math.round(Number(raw.startHour));
    const endHour = Math.round(Number(raw.endHour));
    const responsiveness = String(raw.responsiveness) as Responsiveness;
    if (!Number.isFinite(startHour) || !Number.isFinite(endHour)) continue;
    if (startHour < 0 || startHour > 23 || endHour < 1 || endHour > 24) continue;
    blocks.push({
      startHour,
      endHour,
      activity: String(raw.activity ?? 'livre'),
      responsiveness: VALID_RESPONSIVENESS.includes(responsiveness) ? responsiveness : 'fast',
    });
  }
  return blocks.length > 0 ? blocks : defaultSchedule();
}

function buildApiMessages(history: Message[]): ApiMessage[] {
  return history.map((m) => ({
    role: m.role === 'user' ? 'user' : 'assistant',
    content: m.text,
  }));
}

const WEB_SEARCH_TOOL = { type: 'web_search_20260209', name: 'web_search' } as const;

/**
 * Executa um turno do personagem no chat. `directive` é uma instrução pontual
 * (não armazenada). Com `useWebSearch`, o personagem pode buscar na web.
 */
interface ChatContext {
  userName?: string;
  /** Status definido pelo usuário (ex: "em reunião"). */
  userStatus?: string;
  directive?: string;
  useWebSearch?: boolean;
}

async function runChat(
  character: Character,
  history: Message[],
  ctx: ChatContext = {},
): Promise<string> {
  const presence = currentPresence(character, new Date());
  const system = buildChatSystemPrompt(
    character,
    ctx.userName,
    todayStr(),
    presence,
    ctx.userStatus,
  );
  const messages = buildApiMessages(history);

  if (ctx.directive) {
    messages.push({ role: 'user', content: ctx.directive });
  }

  // A API exige que a conversa comece com uma mensagem do usuário. Como o
  // personagem fala primeiro, prefixamos um contexto neutro quando necessário.
  if (messages.length === 0 || messages[0].role !== 'user') {
    messages.unshift({ role: 'user', content: 'O usuário acabou de abrir o aplicativo de chat.' });
  }

  const useWebSearch = ctx.useWebSearch ?? false;
  const resp = await anthropic.messages.create({
    model: config.model,
    max_tokens: useWebSearch ? 1500 : 1024,
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages,
    ...(useWebSearch
      ? { tools: [{ ...WEB_SEARCH_TOOL, max_uses: config.webSearch.maxUses }] }
      : {}),
  });

  return extractComposedText(resp.content);
}

/**
 * Gera a resposta do personagem. `directive` é uma instrução pontual (não
 * armazenada), usada por ex. para a primeira mensagem do personagem.
 */
export function generateReply(
  character: Character,
  history: Message[],
  ctx: ChatContext = {},
): Promise<string> {
  return runChat(character, history, ctx);
}

/**
 * Gera uma mensagem espontânea (proativa) do personagem, levando em conta o
 * horário e há quanto tempo a conversa está parada.
 */
export function generateProactiveMessage(
  character: Character,
  history: Message[],
  now: Date,
  ctx: { userName?: string; userStatus?: string; lastMessageAt?: string } = {},
): Promise<string> {
  return runChat(character, history, {
    userName: ctx.userName,
    userStatus: ctx.userStatus,
    directive: buildProactiveDirective(now, ctx.lastMessageAt),
  });
}

/**
 * Gera uma mensagem proativa baseada em uma notícia/assunto real e recente,
 * usando busca na web. Cai de volta para uma mensagem espontânea normal se a
 * busca não render nada.
 */
export async function generateNewsMessage(
  character: Character,
  history: Message[],
  now: Date,
  ctx: { userName?: string; userStatus?: string } = {},
): Promise<string> {
  const base = { userName: ctx.userName, userStatus: ctx.userStatus };
  const text = await runChat(character, history, {
    ...base,
    directive: buildNewsDirective(character, now),
    useWebSearch: true,
  });
  if (text.trim()) return text;
  return runChat(character, history, { ...base, directive: buildProactiveDirective(now) });
}

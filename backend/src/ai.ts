import { randomUUID } from 'crypto';
import type Anthropic from '@anthropic-ai/sdk';
import { anthropic } from './anthropicClient';
import { config } from './config';
import {
  CHARACTER_GEN_SYSTEM,
  buildCharacterUserPrompt,
  buildChatSystemPrompt,
  buildProactiveDirective,
} from './prompts';
import { Character, Message } from './types';

type ApiMessage = { role: 'user' | 'assistant'; content: string };

function extractText(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
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
    createdAt: new Date().toISOString(),
  };
}

function buildApiMessages(history: Message[]): ApiMessage[] {
  return history.map((m) => ({
    role: m.role === 'user' ? 'user' : 'assistant',
    content: m.text,
  }));
}

/**
 * Gera a resposta do personagem. `directive` é uma instrução pontual (não
 * armazenada), usada para a primeira mensagem do personagem.
 */
export async function generateReply(
  character: Character,
  history: Message[],
  userName?: string,
  directive?: string,
): Promise<string> {
  const system = buildChatSystemPrompt(character, userName, todayStr());
  const messages = buildApiMessages(history);

  if (directive) {
    messages.push({ role: 'user', content: directive });
  }

  // A API exige que a conversa comece com uma mensagem do usuário. Como o
  // personagem fala primeiro, prefixamos um contexto neutro quando necessário.
  if (messages.length === 0 || messages[0].role !== 'user') {
    messages.unshift({ role: 'user', content: 'O usuário acabou de abrir o aplicativo de chat.' });
  }

  const resp = await anthropic.messages.create({
    model: config.model,
    max_tokens: 1024,
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages,
  });

  return extractText(resp.content);
}

/**
 * Gera uma mensagem espontânea (proativa) do personagem, levando em conta o
 * horário e há quanto tempo a conversa está parada.
 */
export async function generateProactiveMessage(
  character: Character,
  history: Message[],
  userName: string | undefined,
  now: Date,
  lastMessageAt?: string,
): Promise<string> {
  const directive = buildProactiveDirective(now, lastMessageAt);
  return generateReply(character, history, userName, directive);
}

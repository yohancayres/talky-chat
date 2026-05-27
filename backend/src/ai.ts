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
import { MoodShift, rollDailyMood } from './mood';
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

/**
 * Gera uma descrição física curta para personagens que não têm `appearance`
 * (criados antes desse recurso), para manter as feições ao trocar a foto.
 */
export async function generateAppearance(character: Character): Promise<string> {
  try {
    const resp = await anthropic.messages.create(
      {
        model: config.model,
        max_tokens: 300,
        messages: [
          {
            role: 'user',
            content: `Descreva em 1-2 frases a aparência física de ${character.name}, ${character.age} anos, ${character.occupation} de ${character.location}, para uma foto de perfil: idade aparente, etnia/traços, cabelo, estilo e expressão típica. Responda só com a descrição, sem rótulos.`,
          },
        ],
      },
      { timeout: 30_000, maxRetries: 1 },
    );
    return extractText(resp.content);
  } catch (err) {
    console.warn('[talky] não foi possível gerar a aparência:', err);
    return '';
  }
}

export async function generateCharacter(
  hint?: string,
  userName?: string,
  avoidNames?: string[],
): Promise<Character> {
  const resp = await anthropic.messages.create({
    model: config.model,
    max_tokens: 8000,
    system: CHARACTER_GEN_SYSTEM,
    messages: [{ role: 'user', content: buildCharacterUserPrompt(hint, userName, avoidNames) }],
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
    ...deriveStyleTraits(temperament),
    id: randomUUID(),
    name: String(data.name ?? 'Alex'),
    age: Number(data.age ?? 28),
    occupation: String(data.occupation ?? ''),
    location: String(data.location ?? ''),
    avatar: {
      emoji: String(data.avatarEmoji ?? '🙂'),
      color: String(data.avatarColor ?? '#E07A5F'),
    },
    appearance: String(data.appearance ?? ''),
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
    mood: rollDailyMood(undefined, temperament, new Date()),
    createdAt: new Date().toISOString(),
  };
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

// Traços de ESTILO derivados do temperamento (com variação aleatória):
// - intimacyGain: rapidez com que cria intimidade (extrovertido/carinhoso sobe
//   rápido; cético/teimoso demora).
// - splitStyle: o quanto picota mensagens (extrovertido/brincalhão picota mais;
//   formal escreve em blocos).
function deriveStyleTraits(t: Record<string, number>): {
  intimacyGain: number;
  splitStyle: number;
} {
  const v = (k: string) => (t[k] ?? 5) - 5;
  const intimacyGain =
    Math.round(
      clamp(
        1 + v('extroversao') * 0.06 + v('carinho') * 0.06 + v('docura') * 0.04 - v('ceticismo') * 0.05 - v('teimosia') * 0.04 + (Math.random() * 0.5 - 0.25),
        0.4,
        1.8,
      ) * 100,
    ) / 100;
  const splitStyle = clamp(
    Math.round(35 + v('extroversao') * 4 + v('humor') * 2 - v('formalidade') * 4 + (Math.random() * 40 - 20)),
    0,
    100,
  );
  return { intimacyGain, splitStyle };
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
  /** Intimidade (0-100) do personagem com este usuário (controle interno). */
  intimacy?: number;
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
    ctx.intimacy,
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
  ctx: { userName?: string; userStatus?: string; intimacy?: number; lastMessageAt?: string } = {},
): Promise<string> {
  return runChat(character, history, {
    userName: ctx.userName,
    userStatus: ctx.userStatus,
    intimacy: ctx.intimacy,
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
  ctx: { userName?: string; userStatus?: string; intimacy?: number } = {},
): Promise<string> {
  const base = { userName: ctx.userName, userStatus: ctx.userStatus, intimacy: ctx.intimacy };
  const text = await runChat(character, history, {
    ...base,
    directive: buildNewsDirective(character, now),
    useWebSearch: true,
  });
  if (text.trim()) return text;
  return runChat(character, history, { ...base, directive: buildProactiveDirective(now) });
}

function clampNum(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(min, Math.min(max, value));
}

export interface PhotoPlan {
  /** id de uma foto guardada que já atende ao pedido (reusar, sem gerar). */
  reuseId?: string;
  /** Descrição em inglês de uma NOVA foto a gerar (quando não há reuso). */
  scene?: string;
}

/**
 * Planeja a foto: decide se uma das fotos JÁ guardadas (passadas em `candidates`,
 * só as que esta conversa ainda não recebeu) atende ao pedido — caso em que
 * retorna `reuseId` — ou descreve uma NOVA cena para gerar. Mantém-se apropriado
 * (pessoa vestida, sem conteúdo explícito). Em falha, retorna `{ scene: '' }`.
 */
export async function planPhoto(
  character: Character,
  requestText: string,
  candidates: { id: string; description: string }[],
  opts: { activity?: string; mood?: string } = {},
): Promise<PhotoPlan> {
  try {
    const list = candidates.length
      ? candidates.map((c) => `- [id:${c.id}] ${c.description}`).join('\n')
      : '(nenhuma foto guardada ainda)';
    const resp = await anthropic.messages.create(
      {
        model: config.model,
        max_tokens: 250,
        system:
          'You manage a person\'s photo gallery for a chat app. Decide whether an EXISTING photo already satisfies a new request, or a NEW photo must be generated. Reply ONLY with valid JSON, no markdown.',
        messages: [
          {
            role: 'user',
            content: `New photo request (Portuguese): "${requestText}".\nPerson: ${
              character.appearance || `${character.age}-year-old ${character.occupation}`
            }. Right now they are: ${opts.activity || 'at home'}. Mood: ${opts.mood || 'neutral'}.\n\nExisting photos that could be reused (id + description):\n${list}\n\nIf one of the existing photos clearly satisfies the request, reply {"reuseId":"<id>"}.\nOtherwise reply {"reuseId":null,"scene":"<short English description of the NEW photo: pose, framing, setting, expression, matching the request; tasteful, fully clothed, no explicit content>"}.`,
          },
        ],
      },
      { timeout: 15_000, maxRetries: 1 },
    );
    const data = extractJSON(extractText(resp.content));
    const reuseId = typeof data.reuseId === 'string' ? data.reuseId : undefined;
    if (reuseId && candidates.some((c) => c.id === reuseId)) return { reuseId };
    return { scene: typeof data.scene === 'string' ? data.scene : '' };
  } catch (err) {
    console.warn('[talky] não foi possível planejar a foto:', err);
    return { scene: '' };
  }
}

export interface ConversationImpact extends MoodShift {
  /**
   * Variação de intimidade (-15..+5): bom convívio sobe devagar (+1..+3),
   * momento de vínculo até +5; forçar intimidade cedo demais derruba (-5..-15).
   */
  intimacyDelta: number;
  /**
   * Ajuste do estilo de picotar (-30..+30), só quando a pessoa dá FEEDBACK sobre
   * como o personagem manda mensagens (ex: "para de picotar" = negativo;
   * "manda uma de cada vez" = positivo). 0 quando não há feedback.
   */
  splitStyleDelta: number;
}

/**
 * Avalia, numa única chamada, como a conversa recente afetou (a) o humor do
 * personagem e (b) a intimidade dele com a pessoa — considerando o nível atual
 * de intimidade para detectar quando o usuário forçou proximidade cedo demais.
 * Best-effort: qualquer falha retorna deltas nulos.
 */
export async function assessConversationImpact(
  character: Character,
  history: Message[],
  intimacyLevel: number,
): Promise<ConversationImpact> {
  const none = { valenceDelta: 0, energyDelta: 0, intimacyDelta: 0, splitStyleDelta: 0 };
  try {
    const recent = history
      .slice(-8)
      .map((m) => `${m.role === 'user' ? 'Pessoa' : character.name}: ${m.text}`)
      .join('\n');
    if (!recent.trim()) return none;

    const resp = await anthropic.messages.create(
      {
        model: config.model,
        max_tokens: 200,
        system:
          'Você analisa o impacto de uma conversa sobre uma pessoa: humor e intimidade. Responda SOMENTE com JSON válido, sem markdown nem texto extra.',
        messages: [
          {
            role: 'user',
            content: `Conversa recente de ${character.name}:\n\n${recent}\n\nA intimidade ATUAL de ${character.name} com a pessoa é ${intimacyLevel} numa escala de 0 (estranhos) a 100 (muito íntimos).\n\nResponda só com JSON:\n{"valenceDelta": -3..3 (mais feliz = positivo, mais triste = negativo), "energyDelta": -3..3 (mais animado = positivo, mais cansado/entediado = negativo), "intimacyDelta": -15..5 (papo bom e respeitoso sobe devagar +1..+3, momento de vínculo genuíno até +5; CAIA (-5..-15) SÓ se a pessoa claramente forçou romance/sexo pesado ou intimidade muito além do nível, foi invasiva ou desrespeitosa — perguntas pessoais normais, flerte leve ou desabafo NÃO derrubam e podem até subir um pouco), "splitStyleDelta": -30..30 (só se a pessoa deu FEEDBACK sobre COMO ${character.name} manda mensagens: pediu pra parar de mandar várias mensagens curtas/picotadas = negativo; pediu pra mandar separado/uma de cada vez = positivo; senão 0), "reason": "motivo bem curto"}\n\nSe a conversa for neutra/banal, use 0. Leve em conta o nível atual: o que é natural a 80 pode ser invasivo a 8.`,
          },
        ],
      },
      { timeout: 20_000, maxRetries: 1 },
    );

    const data = extractJSON(extractText(resp.content));
    return {
      valenceDelta: clampNum(Number(data.valenceDelta), -3, 3),
      energyDelta: clampNum(Number(data.energyDelta), -3, 3),
      intimacyDelta: clampNum(Number(data.intimacyDelta), -15, 5),
      splitStyleDelta: clampNum(Number(data.splitStyleDelta), -30, 30),
      reason: typeof data.reason === 'string' ? data.reason.slice(0, 60) : undefined,
    };
  } catch (err) {
    console.warn('[talky] não foi possível avaliar o impacto da conversa:', err);
    return none;
  }
}

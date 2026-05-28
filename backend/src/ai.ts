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
  describeTemperament,
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
        model: config.fastModel,
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

  // Cap no histórico: menos texto fixo no system prompt (economia recorrente de
  // tokens), sem perder o essencial da persona. No máx 6 marcos, descrições curtas.
  const timeline = Array.isArray(data.timeline)
    ? (data.timeline as Record<string, unknown>[]).slice(0, 6).map((t) => ({
        age: String(t.age ?? ''),
        title: truncate(String(t.title ?? ''), 80),
        description: truncate(String(t.description ?? ''), 160),
      }))
    : [];

  const schedule = normalizeSchedule(data.schedule);
  const temperament = normalizeTemperament(data.temperament);

  return {
    ...deriveStyleTraits(temperament),
    id: randomUUID(),
    name: String(data.name ?? 'Alex'),
    age: Number(data.age ?? 28),
    gender: normalizeGender(data.gender),
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
    backstory: truncate(String(data.backstory ?? ''), 600),
    routine: truncate(String(data.routine ?? ''), 400),
    timeline,
    temperament,
    schedule,
    mood: rollDailyMood(undefined, temperament, new Date()),
    // A voz é atribuída na 1ª vez que o personagem manda áudio (depende do provedor).
    createdAt: new Date().toISOString(),
  };
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

// Corta um texto no limite, preferindo uma fronteira limpa (fim de frase/palavra)
// para não cortar no meio de uma palavra. Sem reticências (texto interno do prompt).
function truncate(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const boundary = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '), cut.lastIndexOf('\n'));
  if (boundary > max * 0.5) return cut.slice(0, boundary + 1).trim();
  const space = cut.lastIndexOf(' ');
  return (space > max * 0.5 ? cut.slice(0, space) : cut).trim();
}

/** Normaliza qualquer indicação de gênero para 'female' | 'male' | ''. */
export function normalizeGender(value: unknown): string {
  const s = String(value ?? '').toLowerCase();
  if (/femin|female|mulher|garota|mo[çc]a|menina|feminina/.test(s)) return 'female';
  if (/mascul|\bmale\b|homem|rapaz|garoto|menino/.test(s)) return 'male';
  return '';
}

/**
 * Infere o gênero de um personagem (para escolher a voz do TTS) quando ele não
 * foi gravado na criação. Chamada leve; '' se incerto.
 */
export async function inferGender(character: Character): Promise<string> {
  try {
    const resp = await anthropic.messages.create(
      {
        model: config.fastModel,
        max_tokens: 8,
        system: 'Responda APENAS com uma palavra: "feminino" ou "masculino".',
        messages: [
          {
            role: 'user',
            content: `O personagem ${character.name}, ${character.age} anos, ${character.occupation}${
              character.appearance ? `, ${character.appearance}` : ''
            } — é do gênero feminino ou masculino?`,
          },
        ],
      },
      { timeout: 15_000, maxRetries: 1 },
    );
    return normalizeGender(extractText(resp.content));
  } catch (err) {
    console.warn('[talky] não foi possível inferir o gênero:', err);
    return '';
  }
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

// Só as últimas N mensagens carregam a descrição da foto / transcrição do áudio
// por extenso (verbosas, e só importam no turno). Nas mais antigas, o detalhe já
// foi para a memória do usuário — então viram um marcador curto, economizando tokens.
const MEDIA_DETAIL_RECENT = 6;

function buildApiMessages(history: Message[]): ApiMessage[] {
  const n = history.length;
  return history.map((m, i) => {
    let content = m.text;
    const recent = i >= n - MEDIA_DETAIL_RECENT;
    // Fotos que o usuário enviou entram no contexto como descrição em texto.
    if (m.imageDescription) {
      const note = recent ? `[Foto que enviei: ${m.imageDescription}]` : '[foto]';
      content = content ? `${content}\n${note}` : note;
    }
    // Áudios entram como o que foi OUVIDO (transcrição interna, não exibida).
    if (m.audioTranscript) {
      const note = recent ? `[Áudio que mandei, você ouviu: ${m.audioTranscript}]` : '[áudio]';
      content = content ? `${content}\n${note}` : note;
    }
    return { role: m.role === 'user' ? 'user' : 'assistant', content };
  });
}

type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

function normalizeMediaType(mediaType: string): ImageMediaType {
  if (mediaType.includes('png')) return 'image/png';
  if (mediaType.includes('gif')) return 'image/gif';
  if (mediaType.includes('webp')) return 'image/webp';
  return 'image/jpeg';
}

/**
 * Interpreta (visão) uma foto que o usuário enviou e devolve uma descrição curta
 * em português, para entrar no contexto da conversa. Best-effort.
 */
export async function interpretImage(
  base64: string,
  mediaType: string,
  caption?: string,
): Promise<string> {
  try {
    const resp = await anthropic.messages.create(
      {
        model: config.fastModel,
        max_tokens: 300,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: normalizeMediaType(mediaType), data: base64 },
              },
              {
                type: 'text',
                text: `Descreva em 1-2 frases, em português, o que aparece nesta foto que alguém enviou num chat${
                  caption ? ` (com a legenda: "${caption}")` : ''
                }. Seja concreto e objetivo: pessoas, lugar, objetos, clima, o que está acontecendo. Responda só com a descrição.`,
              },
            ],
          },
        ],
      },
      { timeout: 30_000, maxRetries: 1 },
    );
    return extractText(resp.content);
  } catch (err) {
    console.warn('[talky] não foi possível interpretar a foto enviada:', err);
    return '';
  }
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
  /** Memória compacta sobre o usuário (o que o personagem lembra). */
  userMemory?: string;
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
    ctx.userMemory,
  );
  // Janela: só as últimas N mensagens vão ao modelo. Em conversas grandes isso
  // evita reenviar todo o histórico a cada turno (principal causa de custo).
  const recent =
    config.reply.historyLimit > 0 ? history.slice(-config.reply.historyLimit) : history;
  const messages = buildApiMessages(recent);

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

export interface PhotoDecision {
  /** O personagem decidiu mandar a foto agora? */
  send: boolean;
  /** Mensagem dele no jeito dele: legenda (se send) ou resposta/recusa (se não). */
  text: string;
  /** Se for mandar e não reusar: descrição (inglês) da nova foto. */
  scene?: string;
  /** Se uma foto guardada serve: o id dela. */
  reuseId?: string;
}

/**
 * O PERSONAGEM interpreta o pedido de foto e decide, EM PERSONAGEM (conforme
 * personalidade, humor e intimidade), se manda uma foto agora. Se sim, devolve a
 * legenda + a cena (ou uma foto guardada pra reusar). Se não, devolve a resposta
 * em texto, no jeito dele (recusa/enrolação/brincadeira). Best-effort.
 */
export async function decidePhotoResponse(
  character: Character,
  history: Message[],
  requestText: string,
  candidates: { id: string; description: string }[],
  ctx: { userName?: string; intimacy?: number; mood?: string } = {},
): Promise<PhotoDecision> {
  try {
    const recent = history
      .slice(-8)
      .map((m) => `${m.role === 'user' ? 'Pessoa' : character.name}: ${m.text}`)
      .join('\n');
    const temperament = describeTemperament(character.temperament ?? {});
    const list = candidates.length
      ? candidates.map((c) => `- [id:${c.id}] ${c.description}`).join('\n')
      : '(nenhuma guardada)';
    const appearance = character.appearance ? ` Aparência: ${character.appearance}.` : '';

    const system = `Você É ${character.name}, ${character.age} anos, ${character.occupation}.${appearance} Jeito de escrever: ${character.personality.speakingStyle || 'casual e informal'}.${temperament ? `\nTraços marcantes:\n${temperament}` : ''}\nHumor hoje: ${ctx.mood ?? 'normal'}. Intimidade com a pessoa: ${ctx.intimacy ?? 25}/100 (0 = estranhos, 100 = muito íntimos).\nVocê vai decidir, EM PERSONAGEM, se manda uma foto sua agora. Responda SOMENTE com JSON válido, sem markdown.`;

    const user = `Conversa recente:\n${recent || '(começo da conversa)'}\n\nA pessoa pediu/sugeriu uma foto sua: "${requestText}".\n\nReaja como ${character.name} reagiria DE VERDADE. Mandar ou não depende da sua personalidade, do seu humor e de quão íntimos vocês são: pouca intimidade + pedido íntimo/sensual → você provavelmente enrola, brinca, desconversa ou recusa; bastante intimidade + pedido casual → manda numa boa. Não seja robótico nem prestativo demais — seja você.\n\nFotos suas já guardadas (pode reusar uma que sirva, em vez de tirar outra):\n${list}\n\nResponda só com JSON:\n{"send": true|false, "text": "sua mensagem curta no SEU jeito — a LEGENDA da foto se for mandar, ou a sua RESPOSTA (recusa/enrolação/brincadeira) se NÃO for mandar", "reuseId": "id de uma foto guardada que sirva, ou null", "scene": "se for mandar e NÃO reusar: descrição EM INGLÊS da foto (pose, enquadramento, cenário, expressão) coerente com o pedido e com você; pessoa vestida, sem conteúdo explícito; senão deixe \\"\\""}`;

    const resp = await anthropic.messages.create(
      {
        model: config.fastModel,
        max_tokens: 500,
        system,
        messages: [{ role: 'user', content: user }],
      },
      { timeout: 20_000, maxRetries: 1 },
    );
    const data = extractJSON(extractText(resp.content));
    const reuseId =
      typeof data.reuseId === 'string' && candidates.some((c) => c.id === data.reuseId)
        ? data.reuseId
        : undefined;
    return {
      send: Boolean(data.send),
      text: typeof data.text === 'string' ? data.text.trim() : '',
      scene: typeof data.scene === 'string' ? data.scene : '',
      reuseId,
    };
  } catch (err) {
    console.warn('[talky] não foi possível decidir a foto:', err);
    return { send: false, text: '' };
  }
}

export interface AudioDecision {
  /** O personagem decidiu mandar uma nota de voz (TTS) agora? */
  send: boolean;
  /**
   * Se `send`: o que ele FALA na nota de voz (texto natural pra virar áudio).
   * Se não: a resposta dele em TEXTO (recusa/enrolação/responde escrevendo).
   */
  text: string;
}

/**
 * O PERSONAGEM decide, EM PERSONAGEM, se manda um ÁUDIO agora. Evita o bug de
 * "áudio dizendo que não vai mandar áudio": se ele não quiser, responde em TEXTO;
 * só quando quer mandar é que o texto vira voz (TTS). Best-effort.
 */
export async function decideAudioResponse(
  character: Character,
  history: Message[],
  requestText: string,
  ctx: { userName?: string; intimacy?: number; userMemory?: string; mood?: string } = {},
): Promise<AudioDecision> {
  try {
    const recent = history
      .slice(-10)
      .map((m) => `${m.role === 'user' ? 'Pessoa' : character.name}: ${m.text}`)
      .join('\n');
    const temperament = describeTemperament(character.temperament ?? {});
    const memory = ctx.userMemory?.trim() ? `\nVocê lembra sobre a pessoa:\n${ctx.userMemory.trim()}` : '';

    const system = `Você É ${character.name}, ${character.age} anos, ${character.occupation}. Jeito de falar: ${character.personality.speakingStyle || 'casual e informal'}.${temperament ? `\nTraços:\n${temperament}` : ''}\nHumor hoje: ${ctx.mood ?? 'normal'}. Intimidade: ${ctx.intimacy ?? 25}/100.${memory}\nVocê está num app de mensagens e PODE mandar nota de voz. Decida, EM PERSONAGEM, se manda um áudio agora. Responda SOMENTE com JSON válido, sem markdown.`;

    const user = `Conversa recente:\n${recent || '(começo da conversa)'}\n\nA pessoa pediu que você responda/mande um ÁUDIO (nota de voz): "${requestText}".\n\nReaja como você reagiria DE VERDADE. Mandar ou não é decisão SUA, conforme seu jeito, humor e intimidade: se for tímido(a), estiver sem clima, em público, ou não tiver intimidade, você pode preferir responder por texto — brincar, enrolar ou só dizer que agora não dá. Se topar, manda numa boa.\n\nResponda só com JSON:\n{"send": true|false, "text": "se send=true: FALE naturalmente o que você responderia, como numa nota de voz de WhatsApp (NÃO diga 'vou te mandar um áudio', não narre, não diga 'peraí'); se send=false: sua resposta em TEXTO, no seu jeito (pode explicar que prefere não mandar áudio agora, brincar ou simplesmente responder escrevendo)"}`;

    const resp = await anthropic.messages.create(
      {
        model: config.model,
        max_tokens: 600,
        system,
        messages: [{ role: 'user', content: user }],
      },
      { timeout: 25_000, maxRetries: 1 },
    );
    const data = extractJSON(extractText(resp.content));
    return {
      send: Boolean(data.send),
      text: typeof data.text === 'string' ? data.text.trim() : '',
    };
  } catch (err) {
    console.warn('[talky] não foi possível decidir o áudio:', err);
    return { send: false, text: '' };
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
  /**
   * Memória ATUALIZADA sobre o usuário (versão completa e compacta, já mesclada
   * com a anterior). undefined quando não houve mudança/extração.
   */
  userMemory?: string;
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
  existingMemory?: string,
): Promise<ConversationImpact> {
  const none = { valenceDelta: 0, energyDelta: 0, intimacyDelta: 0, splitStyleDelta: 0 };
  try {
    const recent = history
      .slice(-8)
      .map((m) => `${m.role === 'user' ? 'Pessoa' : character.name}: ${m.text}`)
      .join('\n');
    if (!recent.trim()) return none;

    const mem = existingMemory?.trim()
      ? `\n\nMemória atual sobre a pessoa (atualize incrementando/corrigindo):\n${existingMemory.trim()}`
      : '';

    const resp = await anthropic.messages.create(
      {
        model: config.fastModel,
        max_tokens: 500,
        system:
          'Você analisa uma conversa: humor, intimidade e o que memorizar sobre a pessoa. Responda SOMENTE com JSON válido, sem markdown nem texto extra.',
        messages: [
          {
            role: 'user',
            content: `Conversa recente de ${character.name}:\n\n${recent}${mem}\n\nA intimidade ATUAL de ${character.name} com a pessoa é ${intimacyLevel} numa escala de 0 (estranhos) a 100 (muito íntimos).\n\nResponda só com JSON:\n{"valenceDelta": -3..3 (mais feliz=+, mais triste=-), "energyDelta": -3..3 (mais animado=+, mais cansado/entediado=-), "intimacyDelta": -15..5 (papo bom e respeitoso sobe devagar +1..+3, vínculo genuíno até +5; CAIA (-5..-15) SÓ se forçou romance/sexo pesado ou intimidade muito além do nível, foi invasiva ou desrespeitosa — perguntas pessoais normais, flerte leve ou desabafo NÃO derrubam), "splitStyleDelta": -30..30 (só com FEEDBACK sobre COMO manda mensagens: parar de picotar=negativo; mandar separado=positivo; senão 0), "reason": "motivo curto", "memory": "fatos relevantes e duradouros sobre a PESSOA (não sobre ${character.name}): nome, onde mora/trabalha, características físicas, gostos, interesses, relacionamentos, segredos, conquistas, acontecimentos importantes. Mescle com a memória atual: mantenha o que ainda vale, corrija o desatualizado, adicione o novo. Bullets curtos com '-', máx ~15 linhas, sem floreio. Se nada relevante a memorizar e não havia memória, use \\"\\""}\n\nNeutro/banal: deltas 0. Leve em conta o nível atual: o que é natural a 80 pode ser invasivo a 8.`,
          },
        ],
      },
      { timeout: 20_000, maxRetries: 1 },
    );

    const data = extractJSON(extractText(resp.content));
    const memory = typeof data.memory === 'string' ? data.memory.trim() : '';
    return {
      valenceDelta: clampNum(Number(data.valenceDelta), -3, 3),
      energyDelta: clampNum(Number(data.energyDelta), -3, 3),
      intimacyDelta: clampNum(Number(data.intimacyDelta), -15, 5),
      splitStyleDelta: clampNum(Number(data.splitStyleDelta), -30, 30),
      reason: typeof data.reason === 'string' ? data.reason.slice(0, 60) : undefined,
      userMemory: memory || undefined,
    };
  } catch (err) {
    console.warn('[talky] não foi possível avaliar o impacto da conversa:', err);
    return none;
  }
}

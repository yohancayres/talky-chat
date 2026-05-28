import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { config } from './config';
import { UPLOADS_DIR } from './image';
import { describeTemperament } from './prompts';
import { Character } from './types';

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

// Abreviações de chat → forma falada.
const ABBREV: Record<string, string> = {
  vc: 'você', voce: 'você', vcs: 'vocês', pq: 'porque', tb: 'também', tbm: 'também',
  q: 'que', td: 'tudo', tds: 'todos', blz: 'beleza', vlw: 'valeu', flw: 'falou',
  obg: 'obrigado', obgd: 'obrigado', vdd: 'verdade', dps: 'depois', msg: 'mensagem',
  hj: 'hoje', amanha: 'amanhã', agr: 'agora', mt: 'muito', mto: 'muito', mta: 'muita',
  n: 'não', naum: 'não', kd: 'cadê', cmg: 'comigo', ctg: 'contigo', oq: 'o que',
  pfv: 'por favor', pfvr: 'por favor', tipo: 'tipo', mds: 'meu deus', sla: 'sei lá',
};

// Hesitações/pausas de fala natural.
const FILLER_STARTERS = ['hmm...', 'ahh,', 'éé...', 'então,', 'olha,', 'ah,', 'hmm,', 'então...'];
const FILLER_MID = ['é...', 'hmm,', 'tipo,', 'sei lá,', 'então,', 'ahn,', 'ah,'];

/**
 * Insere disfluências naturais (hesitações e pausas) onde faz sentido — no
 * começo da fala e em algumas vírgulas — de forma leve e aleatória, pra soar
 * como alguém falando de verdade num áudio, não lendo um texto.
 */
export function addSpeechFillers(text: string): string {
  let s = text.trim();
  if (!s) return s;
  let inserted = 0;
  const MAX = s.length > 60 ? 2 : 1; // mensagens curtas levam menos filler

  // Começo da fala: ~40% de chance (se já não começa com interjeição/risada).
  if (Math.random() < 0.4 && !/^(hmm|ahh?|é|então|olha|ahn|tipo|haha|rá)/i.test(s)) {
    s = `${pick(FILLER_STARTERS)} ${s}`;
    inserted++;
  }

  // Em vírgulas: às vezes troca a pausa por uma hesitação.
  s = s.replace(/, /g, (m) => {
    if (inserted >= MAX || Math.random() >= 0.25) return m;
    inserted++;
    return `, ${pick(FILLER_MID)} `;
  });

  return s;
}

/**
 * Converte o texto escrito (chat) para algo que faça sentido FALADO: risadas
 * "kkk/rsrs" viram riso, emojis somem, abreviações são expandidas. Usado só na
 * geração do áudio — a mensagem exibida e o contexto mantêm o texto original.
 */
export function textForSpeech(text: string): string {
  let s = ` ${text} `;
  // Remove emojis e pictogramas.
  s = s.replace(
    /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{200D}]/gu,
    ' ',
  );
  // Marcadores de markdown e repetições de pontuação.
  s = s.replace(/[*_~`#>]/g, ' ').replace(/([!?.,])\1{2,}/g, '$1$1');
  // Risadas escritas → riso falado.
  s = s.replace(/\b(?:k{2,}|rs(?:rs)+|ha(?:ha)+h?|he(?:he)+|hue(?:hue)+|hi(?:hi)+)\b/gi, 'haha');
  // Expande abreviações (token isolado).
  s = s.replace(/[a-zà-ú]+/gi, (m) => ABBREV[m.toLowerCase()] ?? m);
  return s.replace(/\s+/g, ' ').trim();
}

// Quão grave (negativo) ou aguda (positivo) deve ser a voz, por idade + temperamento.
function pitchScore(character: Character): number {
  const t = character.temperament ?? {};
  const v = (k: string) => t[k] ?? 5;
  let s = 0;
  // Idosos: voz mais grave/assentada (reforça o timbre quando a voz escolhida
  // ainda soa jovem). Quanto mais velho, mais grave.
  if (character.age >= 65) s -= 3.5;
  else if (character.age >= 55) s -= 2.8;
  else if (character.age >= 45) s -= 2;
  else if (character.age >= 35) s -= 1;
  else if (character.age <= 22) s += 1;
  s += (v('docura') - 5) * 0.2;
  s += (v('extroversao') - 5) * 0.15;
  s -= (v('brutalidade') - 5) * 0.3;
  s -= (v('teimosia') - 5) * 0.1;
  return s;
}

// Fator de pitch para o ffmpeg (1 = sem mudança). Modesto p/ soar natural.
function pitchFactor(character: Character): number {
  return clamp(1 + clamp(pitchScore(character), -3, 3) * 0.035, 0.88, 1.12);
}

// Presets de "ambiente". Reflexões BEM curtas (<~35ms) e fracas: elas se fundem
// na voz e dão sensação de cômodo, SEM virar eco/slap perceptível. lowpass tira o
// "brilho digital" do TTS (cara de mic de celular).
const AMBIENCE_PRESETS: Record<string, string> = {
  // Quarto: cômodo pequeno, bem discreto.
  room: 'aecho=0.92:0.78:13|23:0.16|0.09,lowpass=f=10500,volume=1.04',
  // Escritório: um tiquinho mais de espaço, ainda sutil.
  office: 'aecho=0.92:0.8:16|27|38:0.16|0.1|0.06,lowpass=f=11000,volume=1.05',
};

function ambienceFilter(preset: string): string {
  if (!preset || ['false', 'off', 'none', '0'].includes(preset)) return '';
  if (preset === 'true' || preset === 'quarto') return AMBIENCE_PRESETS.room;
  if (preset === 'escritorio') return AMBIENCE_PRESETS.office;
  return AMBIENCE_PRESETS[preset] ?? AMBIENCE_PRESETS.room;
}

// Monta a cadeia de filtros do ffmpeg: pitch-shift (preserva duração) + ambiente.
function buildAudioFilter(pitch: number, ambience: string): string {
  const parts: string[] = [];
  if (Math.abs(pitch - 1) >= 0.01) {
    parts.push(
      'aresample=44100',
      `asetrate=${Math.round(44100 * pitch)}`,
      'aresample=44100',
      `atempo=${(1 / pitch).toFixed(4)}`,
    );
  }
  const amb = ambienceFilter(ambience);
  if (amb) parts.push(amb);
  return parts.join(',');
}

/**
 * Roda o ffmpeg aplicando uma cadeia de filtros ao mp3. Se o ffmpeg não estiver
 * instalado ou falhar, devolve o áudio original.
 */
function runFfmpeg(input: Buffer, filter: string): Promise<Buffer> {
  return new Promise((resolve) => {
    if (!filter) {
      resolve(input);
      return;
    }
    const ff = spawn('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      'pipe:0',
      '-af',
      filter,
      '-f',
      'mp3',
      'pipe:1',
    ]);
    const chunks: Buffer[] = [];
    let err = '';
    ff.stdout.on('data', (d: Buffer) => chunks.push(d));
    ff.stderr.on('data', (d: Buffer) => (err += d.toString()));
    ff.on('error', () => resolve(input)); // ffmpeg ausente → usa o original
    ff.on('close', (code) => {
      if (code === 0 && chunks.length) {
        resolve(Buffer.concat(chunks));
      } else {
        if (err) console.warn('[talky] processamento de áudio falhou (ffmpeg):', err.slice(0, 200));
        resolve(input);
      }
    });
    ff.stdin.on('error', () => {}); // evita EPIPE se o ffmpeg sair cedo
    ff.stdin.write(input);
    ff.stdin.end();
  });
}

function pick<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

// Vozes da OpenAI agrupadas por timbre aproximado.
const OPENAI_F = ['nova', 'shimmer', 'coral', 'sage'];
const OPENAI_M = ['onyx', 'echo', 'ash', 'ballad'];
const OPENAI_N = ['alloy', 'fable', 'verse'];
const OPENAI_ALL = [...OPENAI_F, ...OPENAI_M, ...OPENAI_N];

function desiredGender(character: Character): '' | 'female' | 'male' {
  // Usa o gênero explícito do personagem (mais confiável); senão, infere do texto.
  const g = (character.gender ?? '').toLowerCase();
  if (g === 'female' || g === 'male') return g;
  const a = `${character.appearance ?? ''} ${character.name ?? ''}`.toLowerCase();
  if (/\b(mulher|feminin|garota|moça|menina|ela é|senhora|dela)\b/.test(a)) return 'female';
  if (/\b(homem|masculin|rapaz|garoto|menino|ele é|senhor|dele|barba)\b/.test(a)) return 'male';
  return '';
}

function pickOpenAiVoice(character: Character): string {
  const g = desiredGender(character);
  if (g === 'female') return pick(OPENAI_F);
  if (g === 'male') return pick(OPENAI_M);
  return pick(OPENAI_ALL);
}

// --- ElevenLabs: busca as vozes da conta (cacheado) e escolhe por características ---
type ElVoice = { id: string; name: string; gender: string; text: string };
let elVoicesCache: ElVoice[] | null = null;

async function getElevenVoices(): Promise<ElVoice[]> {
  if (elVoicesCache) return elVoicesCache;
  const key = config.tts.elevenlabs.apiKey;
  if (!key) return [];
  try {
    const res = await fetch(`${config.tts.elevenlabs.baseUrl}/voices`, {
      headers: { 'xi-api-key': key },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      console.warn('[talky] ElevenLabs /voices falhou:', res.status, (await res.text()).slice(0, 300));
      return [];
    }
    const data = (await res.json()) as {
      voices?: {
        voice_id: string;
        name: string;
        labels?: Record<string, string>;
        description?: string;
      }[];
    };
    elVoicesCache = (data.voices ?? []).map((v) => {
      const labels = v.labels ?? {};
      // Junta todos os labels + nome + descrição num texto pra pontuar por palavra-chave.
      const text = `${Object.values(labels).join(' ')} ${v.name} ${v.description ?? ''}`.toLowerCase();
      return { id: v.voice_id, name: v.name, gender: (labels.gender ?? '').toLowerCase(), text };
    });
    return elVoicesCache;
  } catch (err) {
    console.warn('[talky] erro ao buscar vozes ElevenLabs:', err);
    return [];
  }
}

// Descritores de voz desejados, a partir do temperamento do personagem.
function desiredDescriptors(t: Record<string, number>): string[] {
  const v = (k: string) => t[k] ?? 5;
  const d: string[] = ['conversational', 'natural', 'casual']; // bom p/ chat sempre
  if (v('brutalidade') >= 7) d.push('deep', 'confident', 'assertive', 'gruff', 'strong');
  if (v('docura') >= 7 || v('carinho') >= 7) d.push('soft', 'warm', 'gentle', 'pleasant', 'sweet');
  if (v('humor') >= 7 || v('extroversao') >= 7) d.push('upbeat', 'excited', 'energetic', 'cheerful', 'playful');
  if (v('extroversao') <= 3 || v('formalidade') >= 7) d.push('calm', 'measured');
  if (v('sarcasmo') >= 7 || v('ironia') >= 7) d.push('confident', 'expressive');
  if (v('ceticismo') >= 7) d.push('deep', 'mature');
  return d;
}

// Pontua o quão bem a voz combina com o personagem (gênero, sotaque pt-BR, idade,
// descritores) e prioriza tom de BATE-PAPO em vez de locução/narração.
function scoreVoice(voice: ElVoice, character: Character): number {
  let score = 0;
  const g = desiredGender(character);
  if (g && voice.gender) score += voice.gender === g ? 8 : -8;
  // Prioriza vozes brasileiras/portuguesas.
  if (/brazil|brasil|portug/.test(voice.text)) score += 6;
  // Tom de conversa relaxada > locução: prioriza conversational/casual, penaliza narração.
  if (/conversational|casual|chatty|social|friendly|relaxed|natural/.test(voice.text)) score += 5;
  if (/narrat|audiobook|news|announc|professional|formal|documentary|presenter|broadcast/.test(voice.text))
    score -= 6;
  // Idade — peso FORTE, sobretudo para idosos: voz de jovem num personagem idoso
  // soa errado. Os labels da ElevenLabs são "young" / "middle_aged" / "old".
  const age = character.age;
  const isOld = /\bold\b|elderly|senior|mature|aged|grand/.test(voice.text);
  const isYoung = /young|youth|teen|child|girl|boy/.test(voice.text);
  if (age >= 60) {
    if (isOld) score += 10;
    if (isYoung) score -= 12; // nunca uma voz jovem para idoso, se houver alternativa
  } else if (age >= 50) {
    if (isOld || /middle/.test(voice.text)) score += 5;
    if (isYoung) score -= 5;
  } else if (age < 25) {
    if (isYoung) score += 3;
    if (isOld) score -= 5;
  } else if (age < 40) {
    if (/middle|young|adult/.test(voice.text)) score += 1.5;
    if (isOld) score -= 2;
  }
  // Descritores ligados ao temperamento.
  for (const d of desiredDescriptors(character.temperament ?? {})) {
    if (voice.text.includes(d)) score += 1.5;
  }
  return score;
}

async function pickElevenVoice(character: Character): Promise<string> {
  const voices = await getElevenVoices();
  if (!voices.length) return config.tts.elevenlabs.defaultVoice || '';
  // Filtro RÍGIDO de gênero quando conhecido: mulher nunca recebe voz masculina.
  const g = desiredGender(character);
  const matching = g ? voices.filter((v) => v.gender === g) : [];
  const pool = matching.length ? matching : voices;
  // Maior pontuação; +ruído pequeno pra desempatar (personagens parecidos variam um pouco).
  const ranked = pool
    .map((v) => ({ v, s: scoreVoice(v, character) + Math.random() * 0.9 }))
    .sort((a, b) => b.s - a.s);
  return ranked[0].v.id;
}

/**
 * A voz guardada combina com a IDADE do personagem? Evita que idosos fiquem com
 * voz jovem (e vice-versa) mesmo já tendo uma voz atribuída antes desta lógica.
 * Best-effort: se não conseguir avaliar (voz não encontrada), não força troca.
 */
export async function voiceFitsCharacter(
  voiceId: string,
  character: Character,
): Promise<boolean> {
  if (config.tts.provider !== 'elevenlabs') return true;
  const voices = await getElevenVoices();
  const v = voices.find((x) => x.id === voiceId);
  if (!v) return true;
  const isYoung = /young|youth|teen|child/.test(v.text);
  const isOld = /\bold\b|elderly|senior|mature|aged/.test(v.text);
  if (character.age >= 60 && isYoung) return false; // idoso com voz jovem
  if (character.age < 25 && isOld) return false; // jovem com voz de idoso
  return true;
}

/** O `voice` guardado pertence ao provedor ativo? (senão, precisa re-atribuir). */
export function voiceMatchesProvider(voice: string | undefined): boolean {
  if (!voice) return false;
  if (config.tts.provider === 'elevenlabs') return voice.length >= 15; // ids do EL têm ~20 chars
  return OPENAI_ALL.includes(voice);
}

/** Escolhe uma voz para o personagem conforme o provedor ativo e suas características. */
export async function pickVoiceForProvider(character: Character): Promise<string> {
  if (config.tts.provider === 'elevenlabs') return pickElevenVoice(character);
  return pickOpenAiVoice(character);
}

// Rótulo do tom para as instructions (a OpenAI não tem pitch; o ffmpeg faz o
// ajuste fino depois). Mantém a mesma direção do pitch-shift.
function pitchHint(character: Character): string {
  const score = pitchScore(character);
  if (score <= -1.2) return 'voz mais grave e encorpada';
  if (score >= 1.2) return 'voz mais fina e aguda';
  return 'voz de tom médio';
}

// Dicas de ENTREGA (ritmo, energia, tom) derivadas do temperamento — ajudam a
// diferenciar personagens mesmo quando a voz base é parecida.
function deliveryHints(t: Record<string, number>): string {
  const v = (k: string) => t[k] ?? 5;
  const hints: string[] = [];
  if (v('extroversao') >= 7 || v('humor') >= 7) hints.push('ritmo animado e enérgico');
  else if (v('extroversao') <= 3 || v('formalidade') >= 7) hints.push('ritmo pausado e contido');
  if (v('docura') >= 7 || v('carinho') >= 7) hints.push('voz suave e calorosa');
  if (v('brutalidade') >= 7) hints.push('voz firme e direta');
  if (v('ironia') >= 7 || v('sarcasmo') >= 7) hints.push('tom levemente debochado/irônico');
  if (v('paciencia') <= 3) hints.push('fala um pouco apressada');
  if (v('extroversao') >= 8) hints.push('mais alto e expansivo');
  return hints.join(', ');
}

// Instruções de COMO falar (não O QUE falar): personalidade + jeito + humor.
function buildVoiceInstructions(character: Character, mood?: string): string {
  const vibe = describeTemperament(character.temperament ?? {})
    .replace(/^- /gm, '')
    .replace(/\n/g, '; ');
  const delivery = deliveryHints(character.temperament ?? {});
  return [
    // O acento vem PRIMEIRO e enfático (as vozes puxam sotaque estrangeiro).
    'SOTAQUE: português do Brasil NATIVO, como um brasileiro de verdade falando. Pronúncia 100% brasileira, natural e fluente. NUNCA soe com sotaque americano/estrangeiro nem português de Portugal. Pronuncie as palavras como no Brasil (ex: "muito" = "muyntu", "dia" = "djia", "te" = "tchi", "de" = "dji").',
    `Você é ${character.name}, ${character.age} anos, ${character.occupation}, brasileiro(a), mandando um áudio de WhatsApp para um amigo.`,
    `Jeito de falar: ${character.personality.speakingStyle || 'casual e informal'}.`,
    `Tom de voz: ${pitchHint(character)}.`,
    delivery ? `Entrega da voz: ${delivery}.` : '',
    vibe ? `Personalidade (deixe transparecer no tom): ${vibe}.` : '',
    mood ? `Humor agora: ${mood}.` : '',
    'Fale espontâneo e com emoção, como uma pessoa real conversando — não como locutor nem robô. Ritmo e entonação naturais e coerentes com a sua personalidade.',
  ]
    .filter(Boolean)
    .join(' ');
}

// Expressividade do ElevenLabs (voice_settings) a partir da personalidade.
function elevenVoiceSettings(character: Character): Record<string, unknown> {
  const t = character.temperament ?? {};
  const v = (k: string) => t[k] ?? 5;
  const expressive = (v('extroversao') - 5 + (v('humor') - 5) + (v('docura') - 5)) / 3;
  return {
    // Estabilidade BAIXA = fala variada e relaxada (bate-papo), não monótona/locução.
    stability: clamp(0.35 - expressive * 0.04, 0.2, 0.45),
    similarity_boost: 0.75,
    // Estilo mais alto = mais solto/expressivo, com a "cara" da personalidade.
    style: clamp(0.35 + Math.max(0, expressive) * 0.04, 0.25, 0.6),
    use_speaker_boost: true,
  };
}

async function elevenSpeak(character: Character, text: string): Promise<Buffer | null> {
  const key = config.tts.elevenlabs.apiKey;
  if (!key) return null;
  const voiceId =
    character.voice && character.voice.length >= 15
      ? character.voice
      : config.tts.elevenlabs.defaultVoice || (await getElevenVoices())[0]?.id;
  if (!voiceId) return null;
  try {
    const res = await fetch(`${config.tts.elevenlabs.baseUrl}/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify({
        text,
        model_id: config.tts.elevenlabs.model,
        voice_settings: elevenVoiceSettings(character),
      }),
      signal: AbortSignal.timeout(config.tts.timeoutSeconds * 1000),
    });
    if (!res.ok) {
      console.warn('[talky] ElevenLabs TTS falhou:', res.status, await res.text());
      return null;
    }
    return Buffer.from(await res.arrayBuffer());
  } catch (err) {
    console.warn('[talky] erro no ElevenLabs TTS:', err);
    return null;
  }
}

async function openaiSpeak(
  character: Character,
  text: string,
  opts: { mood?: string },
): Promise<Buffer | null> {
  if (!config.openaiApiKey) return null;
  const voice = OPENAI_ALL.includes(character.voice ?? '')
    ? character.voice
    : config.tts.openai.defaultVoice;
  try {
    const res = await fetch(config.tts.openai.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.openaiApiKey}` },
      body: JSON.stringify({
        model: config.tts.openai.model,
        voice,
        input: text,
        instructions: buildVoiceInstructions(character, opts.mood),
        response_format: 'mp3',
      }),
      signal: AbortSignal.timeout(config.tts.timeoutSeconds * 1000),
    });
    if (!res.ok) {
      console.warn('[talky] OpenAI TTS falhou:', res.status, await res.text());
      return null;
    }
    return Buffer.from(await res.arrayBuffer());
  } catch (err) {
    console.warn('[talky] erro no OpenAI TTS:', err);
    return null;
  }
}

/**
 * Gera um áudio com a fala do personagem (ElevenLabs por padrão; OpenAI como
 * fallback), aplica o pitch-shift e salva em /uploads. Retorna o caminho público.
 */
export async function generateSpeech(
  character: Character,
  text: string,
  opts: { mood?: string } = {},
): Promise<string | null> {
  if (!config.tts.enabled || !text.trim()) return null;

  // Normaliza o texto para a FALA (kkk → haha, sem emojis, abreviações expandidas)
  // e adiciona hesitações/pausas naturais.
  let spoken = textForSpeech(text);
  if (!spoken) return null;
  if (config.tts.fillers) spoken = addSpeechFillers(spoken);

  let buffer: Buffer | null = null;
  if (config.tts.provider === 'elevenlabs') buffer = await elevenSpeak(character, spoken);
  if (!buffer) buffer = await openaiSpeak(character, spoken, opts); // fallback/provedor OpenAI
  if (!buffer) return null;

  // Pós-processamento: pitch (afina/engrossa) + ambiente (reverb de cômodo), via ffmpeg.
  const filter = buildAudioFilter(
    config.tts.pitchShift ? pitchFactor(character) : 1,
    config.tts.ambience,
  );
  if (filter) buffer = await runFfmpeg(buffer, filter);

  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  const fileName = `tts-${randomUUID()}.mp3`;
  fs.writeFileSync(path.join(UPLOADS_DIR, fileName), buffer);
  return `/uploads/${fileName}`;
}

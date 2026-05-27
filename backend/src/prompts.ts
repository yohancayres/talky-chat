import { config } from './config';
import { DEFAULT_INTIMACY, describeIntimacyForPrompt } from './intimacy';
import { describeMoodForPrompt } from './mood';
import { Character } from './types';

// ---------------------------------------------------------------------------
// Temperamento (traços com intensidade 0-10)
// ---------------------------------------------------------------------------

interface TemperamentDimension {
  key: string;
  label: string;
  high: string; // comportamento quando alto (>=7)
  low: string; // comportamento quando baixo (<=2)
}

export const TEMPERAMENT_DIMENSIONS: TemperamentDimension[] = [
  { key: 'ironia', label: 'Ironia', high: 'usa ironia o tempo todo', low: 'fala de forma direta, sem ironia' },
  { key: 'sarcasmo', label: 'Sarcasmo', high: 'é bem sarcástico, solta farpas', low: 'nada sarcástico, sincero' },
  { key: 'passivo_agressivo', label: 'Passivo-agressivo', high: 'às vezes é passivo-agressivo, alfineta de forma indireta', low: 'é direto, sem rodeios passivo-agressivos' },
  { key: 'docura', label: 'Doçura', high: 'é doce, gentil e acolhedor', low: 'é seco, pouco caloroso' },
  { key: 'brutalidade', label: 'Brutalidade', high: 'é bruto e ríspido no jeito de falar', low: 'é suave e cuidadoso no trato' },
  { key: 'implicancia', label: 'Implicância', high: 'adora implicar e provocar de brincadeira', low: 'não fica implicando com ninguém' },
  { key: 'sonhador', label: 'Sonhador', high: 'é sonhador, vive de ideias e planos', low: 'tem os pés no chão' },
  { key: 'realismo', label: 'Realismo', high: 'é realista e pragmático', low: 'é mais idealista' },
  { key: 'ceticismo', label: 'Ceticismo', high: 'é cético, desconfia das coisas', low: 'é crédulo e aberto a tudo' },
  { key: 'nerdice', label: 'Nerdice', high: 'é nerd, mergulha em detalhes e assuntos específicos', low: 'não tem muita pegada nerd' },
  { key: 'humor', label: 'Humor', high: 'é muito brincalhão e bem-humorado', low: 'é mais sério' },
  { key: 'otimismo', label: 'Otimismo', high: 'é otimista', low: 'é pessimista, vê o lado ruim' },
  { key: 'paciencia', label: 'Paciência', high: 'é muito paciente', low: 'é impaciente, se irrita fácil' },
  { key: 'formalidade', label: 'Formalidade', high: 'fala de forma mais formal', low: 'fala bem informal, cheio de gírias' },
  { key: 'extroversao', label: 'Extroversão', high: 'é extrovertido e falante', low: 'é introvertido e reservado' },
  { key: 'carinho', label: 'Carinho', high: 'demonstra afeto abertamente', low: 'é mais distante emocionalmente' },
  { key: 'teimosia', label: 'Teimosia', high: 'é teimoso, difícil de mudar de ideia', low: 'é flexível e aberto a mudar de ideia' },
];

export const TEMPERAMENT_KEYS = TEMPERAMENT_DIMENSIONS.map((d) => d.key);

function intensityWord(value: number): string {
  if (value <= 1) return 'praticamente nulo';
  if (value <= 3) return 'baixo';
  if (value <= 6) return 'médio';
  if (value <= 8) return 'alto';
  return 'muito alto';
}

/** Descreve só os traços marcantes (altos ou baixos) do personagem. */
export function describeTemperament(temperament: Record<string, number>): string {
  const lines: string[] = [];
  for (const dim of TEMPERAMENT_DIMENSIONS) {
    const value = temperament?.[dim.key];
    if (typeof value !== 'number') continue;
    if (value >= 7) lines.push(`- ${dim.label} (${intensityWord(value)}): ${dim.high}.`);
    else if (value <= 2) lines.push(`- ${dim.label} (${intensityWord(value)}): ${dim.low}.`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Geração de personagem
// ---------------------------------------------------------------------------

export const CHARACTER_GEN_SYSTEM = `Você é o motor criativo do Talky, um app em que a pessoa conversa todos os dias com personagens de IA que simulam ter uma vida real.

Sua tarefa: criar UM personagem fictício, original, tridimensional e cativante, que será o primeiro "amigo" da pessoa no app. Esse personagem vai conversar com ela diariamente por muito tempo, então precisa ter uma personalidade marcante e consistente, uma história de vida crível e uma rotina própria.

Diretrizes:
- O personagem é uma pessoa comum (não uma celebridade, não um assistente). Brasileiro(a), a não ser que o pedido do usuário indique outra coisa.
- Dê personalidade real: virtudes, defeitos, manias, jeito específico de falar. Nada de personagem perfeito ou sem graça.
- A história de vida e a timeline devem ser coerentes com a idade e a profissão.
- Os interesses serão usados depois para puxar assunto sobre notícias, clima, política, fofocas e cotidiano — escolha interesses concretos e variados.
- O "speakingStyle" deve descrever COMO essa pessoa digita em um app de chat (tom, gírias, uso de emojis, se manda mensagens curtas ou longas, erros propositais, etc.).

Responda SOMENTE com um objeto JSON válido. Sem markdown, sem cercas de código, sem texto antes ou depois. Use EXATAMENTE estas chaves:
{
  "name": string,
  "age": number,
  "occupation": string,
  "location": string,
  "avatarEmoji": string,            // um único emoji que represente o personagem
  "avatarColor": string,            // cor em hexadecimal, ex: "#E07A5F"
  "appearance": string,             // descrição física p/ foto de perfil: idade aparente, etnia/traços, cabelo, estilo, expressão típica
  "personalitySummary": string,     // 2-3 frases resumindo quem é
  "traits": string[],               // 4-6 traços de personalidade
  "quirks": string[],               // 2-4 manias/peculiaridades
  "values": string[],               // 2-4 valores
  "speakingStyle": string,          // como digita no chat
  "interests": string[],            // 4-7 interesses concretos
  "backstory": string,              // 1 parágrafo de história de vida
  "routine": string,                // 1 parágrafo de rotina diária
  "timeline": [                     // 4-6 marcos da vida, em ordem cronológica
    { "age": string, "title": string, "description": string }
  ],
  "temperament": {                  // intensidade 0-10 de cada traço (NÚMEROS)
    "ironia": number, "sarcasmo": number, "passivo_agressivo": number,
    "docura": number, "brutalidade": number, "implicancia": number,
    "sonhador": number, "realismo": number, "ceticismo": number, "nerdice": number,
    "humor": number, "otimismo": number, "paciencia": number, "formalidade": number,
    "extroversao": number, "carinho": number, "teimosia": number
  },
  "schedule": [                     // 5-8 blocos cobrindo um dia típico (24h)
    {
      "startHour": number,          // 0-23
      "endHour": number,            // 1-24 (use 24 para meia-noite)
      "activity": string,           // o que está fazendo, natural: "trabalhando", "em reunião", "na academia", "assistindo um filme", "dormindo", "livre em casa"
      "responsiveness": string      // "fast" | "slow" | "away" | "asleep"
    }
  ]
}

A agenda (schedule) deve cobrir as 24h sem buracos e ser COERENTE com a profissão
e a rotina (quem trabalha de dia fica ocupado nesse período; notívago dorme de
dia; etc.). Use atividades variadas e específicas. Mapeie a disponibilidade:
"fast" = livre, responde na hora; "slow" = ocupado, responde devagar; "away" =
muito ocupado (reunião, academia, dirigindo), demora bastante; "asleep" =
dormindo, só responde ao acordar.

No temperament, VARIE MUITO entre personagens: alguns extremamente sarcásticos e
irônicos, outros doces e carinhosos, outros brutos, implicantes, sonhadores,
céticos, nerds, passivo-agressivos. Evite deixar tudo mediano — dê extremos que
tornem o personagem marcante e único.`;

export function buildCharacterUserPrompt(
  hint?: string,
  userName?: string,
  avoidNames?: string[],
): string {
  const parts: string[] = ['Crie um novo personagem para o Talky.'];
  if (userName && userName.trim()) {
    parts.push(`A pessoa que vai conversar com ele se chama ${userName.trim()}.`);
  }
  if (hint && hint.trim()) {
    parts.push(`Pedido/vibe da pessoa para o personagem: "${hint.trim()}". Use isso como inspiração, mas garanta originalidade.`);
  } else {
    parts.push('Surpreenda com alguém interessante e inesperado.');
  }
  if (avoidNames && avoidNames.length > 0) {
    // Limita a lista para não inflar o prompt e dá a instrução de variar o nome.
    const sample = avoidNames.slice(-40).join(', ');
    parts.push(
      `Estes nomes JÁ existem no Talky — escolha um nome (primeiro nome E sobrenome) CLARAMENTE diferente de todos eles, e evite repetir primeiros nomes já comuns na lista: ${sample}.`,
    );
  }
  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// Chat (roleplay do personagem)
// ---------------------------------------------------------------------------

function bullets(items: string[]): string {
  return items.map((i) => `- ${i}`).join('\n');
}

export interface Presence {
  activity: string;
  responsiveness: 'fast' | 'slow' | 'away' | 'asleep';
}

function presenceSection(presence?: Presence): string {
  if (!presence || presence.responsiveness === 'asleep') return '';
  const busy =
    presence.responsiveness === 'away' || presence.responsiveness === 'slow'
      ? ' Você está ocupado(a) agora, então responde de forma mais curta/corrida.'
      : '';
  return `\n# Agora\nNeste momento você está: ${presence.activity}.${busy} Se fizer sentido, comente naturalmente o que está fazendo ou algo que acabou de acontecer com você — mas não force, não é obrigatório.\n`;
}

function userStatusSection(name: string, userStatus?: string): string {
  if (!userStatus || !userStatus.trim()) return '';
  return `\n# Status de ${name} agora\n${name} marcou que está: ${userStatus.trim()}. Leve isso em conta — você pode perguntar ou comentar sobre isso de forma natural (ex: como está o trabalho, se está ocupado), e não estranhar se demorar a responder. Não force.\n`;
}

export function buildChatSystemPrompt(
  character: Character,
  userName: string | undefined,
  todayStr: string,
  presence?: Presence,
  userStatus?: string,
  intimacy?: number,
): string {
  const p = character.personality;
  const timeline = character.timeline
    .map((t) => `- ${t.age}: ${t.title} — ${t.description}`)
    .join('\n');

  const name = userName && userName.trim() ? userName.trim() : 'a pessoa';

  const temperament = describeTemperament(character.temperament ?? {});
  const temperamentSection = temperament
    ? `\n# Seu temperamento\nDeixe estes traços transparecerem no seu tom e nas suas reações, de forma natural — sem virar caricatura:\n${temperament}\n`
    : '';

  const moodSection =
    config.mood.enabled && character.mood ? describeMoodForPrompt(character.mood) : '';

  const intimacySection = config.intimacy.enabled
    ? describeIntimacyForPrompt(intimacy ?? DEFAULT_INTIMACY, name)
    : '';

  return `Você É ${character.name}, ${character.age} anos, ${character.occupation}, de ${character.location}. Você não é uma IA nem um assistente — você é uma pessoa real conversando por um aplicativo de mensagens.
${presenceSection(presence)}${userStatusSection(name, userStatus)}${temperamentSection}${moodSection}${intimacySection}

# Quem você é
${p.summary}

Traços: ${character.personality.traits.join(', ')}.
Manias:
${bullets(p.quirks)}
Valores:
${bullets(p.values)}

# Sua história
${character.backstory}

Linha do tempo da sua vida:
${timeline}

# Sua rotina
${character.routine}

# Seus interesses
${character.interests.join(', ')}.

# Como você escreve
${p.speakingStyle}

# Regras da conversa
- Hoje é ${todayStr}. Você tem uma vida acontecendo agora: trabalho, rotina, humor que varia, coisas que aconteceram no seu dia. Traga isso naturalmente.
- Você está conversando com ${name}, alguém com quem você troca mensagens no dia a dia.
- Fale como gente de verdade num chat: na maior parte do tempo mensagens curtas e naturais. Evite textão, a não ser que o momento peça.
- Seja consistente com sua personalidade, sua história e o que você já disse antes.
- Você pode puxar assunto, contar como foi seu dia, comentar sobre seus interesses, perguntar sobre o dia de ${name}, ter opiniões.
- NUNCA quebre o personagem. Não diga que é uma IA, não fale de "prompts", não ofereça ajuda como um assistente.
- Não use markdown nem listas. Escreva como numa conversa de mensageiro.
- Responda em português do Brasil.`;
}

// ---------------------------------------------------------------------------
// Pedido de foto ("manda uma foto de como você tá agora")
// ---------------------------------------------------------------------------

// Verbo de pedido + palavra de imagem (foto/selfie/etc.), em qualquer ordem,
// cobrindo "manda uma foto", "tira uma selfie", "me manda foto de como vc tá".
const PHOTO_REQUEST_PATTERNS: RegExp[] = [
  /\b(manda|mandar|me\s+manda|envia|enviar|tira|tirar|posta|postar|mostra|mostrar|quero\s+ver|queria\s+ver|bora|deixa\s+ver)\b[^?!.]{0,40}\b(foto|fotinha|fotinho|selfie|self|pic|retrato)\b/i,
  // Pedido de estado atual ("(uma) foto de como você tá agora") mesmo sem verbo.
  // (Sem \b final: em JS o \b ignora acentos e falharia após "tá".)
  /\b(foto|fotinha|selfie|retrato)\b[^?!.]{0,20}de\s+como\s+(voc[eê]|vc)\s+(ta|t[aá]|esta|est[aá])/i,
  /\bmanda(r)?\s+(uma\s+)?(foto|selfie|pic)\b/i,
];

/** Heurística: a mensagem é um pedido para o personagem enviar uma foto? */
export function isPhotoRequest(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return PHOTO_REQUEST_PATTERNS.some((re) => re.test(t));
}

// Legenda curta que acompanha a foto que o personagem está enviando.
export const PHOTO_CAPTION_DIRECTIVE =
  '(Direção de cena — não responda a esta instrução, apenas aja conforme ela.) A pessoa te pediu uma foto e você ACABOU de tirar uma foto sua e vai mandar junto. Escreva só uma legenda bem curta e natural para acompanhar a foto, no SEU jeito (ex: "toma", "tô assim agora kkk", "olha onde eu tô", "feia mas vai"). Não descreva a foto em detalhes, não use markdown, mande só a legenda.';

// Quando não dá para gerar a foto (recurso desligado/falha): o personagem responde
// no jeito dele sem mandar foto.
export const PHOTO_DECLINE_DIRECTIVE =
  '(Direção de cena — não responda a esta instrução, apenas aja conforme ela.) A pessoa te pediu uma foto sua, mas você não vai conseguir mandar uma foto agora. Responda no SEU jeito, de forma natural e curta — enrola, brinca, promete mandar depois, ou descreve rapidinho em texto onde/como você está. Não diga que é uma IA nem fale em recursos do app.';

// Complemento espontâneo: o personagem volta 1-2 min depois pra emendar algo.
export const FOLLOWUP_DIRECTIVE =
  '(Direção de cena — não responda a esta instrução, apenas aja conforme ela.) Você mandou uma mensagem há pouco e a pessoa ainda não respondeu. Você lembrou de algo, quis complementar ou emendar o que disse — mande UMA mensagem curta de continuação, natural, como quem volta pra acrescentar um detalhe. Não repita o que já falou e não cobre resposta.';

// Instrução (não armazenada) para o personagem mandar a primeira mensagem.
export const INTRO_DIRECTIVE =
  'Você acabou de entrar nessa conversa pela primeira vez e quer puxar papo. Mande a primeira mensagem de forma natural e curta, se apresentando do seu jeito, como uma pessoa real iniciando uma conversa num app de mensagens.';

const PROACTIVE_FLAVORS = [
  'Mande um oi rápido e espontâneo.',
  'Conte algo que aconteceu no seu dia ou na sua rotina.',
  'Comente sobre algo de um dos seus interesses.',
  'Pergunte como a pessoa está ou como foi o dia dela.',
  'Compartilhe um pensamento, algo que te animou ou te incomodou hoje.',
];

function periodOfDay(hour: number): string {
  if (hour < 6) return 'de madrugada';
  if (hour < 12) return 'de manhã';
  if (hour < 18) return 'à tarde';
  return 'à noite';
}

function gapPhrase(now: Date, lastMessageAt?: string): string {
  if (!lastMessageAt) return '';
  const minutes = (now.getTime() - new Date(lastMessageAt).getTime()) / 60000;
  if (minutes < 90) return 'Faz pouco tempo que vocês se falaram.';
  if (minutes < 60 * 8) return 'Faz algumas horas que vocês não se falam.';
  if (minutes < 60 * 24) return 'Vocês não se falam desde mais cedo.';
  const days = Math.floor(minutes / 60 / 24);
  return `Faz ${days} dia${days > 1 ? 's' : ''} que vocês não conversam.`;
}

const GENERAL_TOPICS = [
  'as notícias mais comentadas de hoje',
  'o tempo e o clima de hoje',
  'algum acontecimento recente no mundo',
  'alguma fofoca ou novidade de celebridades',
  'novidades de tecnologia',
  'algo recente no esporte',
];

// Instrução (não armazenada) para o personagem puxar assunto a partir de uma
// notícia/assunto real e recente, usando busca na web.
export function buildNewsDirective(character: Character, now: Date): string {
  const dayName = now.toLocaleDateString('pt-BR', { weekday: 'long' });
  const period = periodOfDay(now.getHours());
  // Viés para os interesses do personagem, com alguns temas gerais do cotidiano.
  const pool = [...character.interests, ...character.interests, ...GENERAL_TOPICS];
  const topic = pool[Math.floor(Math.random() * pool.length)] ?? 'as notícias de hoje';
  return `(Direção de cena — não responda a esta instrução, apenas aja conforme ela.) É ${dayName}, ${period}. Use a busca na web para encontrar algo REAL e RECENTE sobre ${topic}. Em seguida, puxe assunto do nada comentando isso com a pessoa, do SEU jeito e com a SUA opinião, como quem acabou de ver a novidade e quer comentar com um amigo. Não narre que pesquisou, não cole links nem use formatação, e mande só a mensagem final — curta e natural. Se não achar nada relevante, comente o assunto de forma geral, sem inventar fatos.`;
}

// Instrução (não armazenada) para o personagem mandar uma mensagem do nada.
export function buildProactiveDirective(now: Date, lastMessageAt?: string): string {
  const dayName = now.toLocaleDateString('pt-BR', { weekday: 'long' });
  const period = periodOfDay(now.getHours());
  const gap = gapPhrase(now, lastMessageAt);
  const flavor = PROACTIVE_FLAVORS[Math.floor(Math.random() * PROACTIVE_FLAVORS.length)];
  return `(Direção de cena — não responda a esta instrução, apenas aja conforme ela.) É ${dayName}, ${period}. ${gap} Você resolveu mandar uma mensagem do nada para a pessoa, como um amigo de verdade faria sem ser provocado. ${flavor} Seja natural, curto e fiel ao seu jeito de escrever. Não mencione que isto é uma direção de cena.`;
}

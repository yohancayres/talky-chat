import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: Number(process.env.PORT ?? 3000),
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '',
  model: process.env.TALKY_MODEL ?? 'claude-opus-4-7',
  // Persistência: com MONGODB_URI usa MongoDB; sem ela, cai no arquivo db.json
  // (apenas para desenvolvimento local). Em produção, defina MONGODB_URI.
  mongoUri: process.env.MONGODB_URI ?? '',
  mongoDbName: process.env.MONGODB_DB ?? 'talky',
  // Geração de imagem (foto de perfil) — usa a API de imagens da OpenAI.
  openaiApiKey: process.env.OPENAI_API_KEY ?? '',
  image: {
    enabled: (process.env.IMAGE_GEN_ENABLED ?? 'true') !== 'false',
    model: process.env.TALKY_IMAGE_MODEL ?? 'gpt-image-2',
    size: process.env.TALKY_IMAGE_SIZE ?? '1024x1024',
    endpoint: process.env.OPENAI_IMAGE_ENDPOINT ?? 'https://api.openai.com/v1/images/generations',
    // Tempo máximo de espera pela geração da imagem (segundos). Geração roda em
    // segundo plano, então pode ser generoso (imagens podem levar minutos).
    timeoutSeconds: Number(process.env.IMAGE_TIMEOUT_SECONDS ?? 240),
  },
  proactive: {
    // O personagem manda mensagens sozinho quando a conversa fica em silêncio.
    enabled: (process.env.PROACTIVE_ENABLED ?? 'true') !== 'false',
    // Intervalo (em minutos) de silêncio antes de uma mensagem espontânea.
    // Para testar rápido, use valores baixos (ex: 1 e 2).
    minGapMinutes: Number(process.env.PROACTIVE_MIN_GAP_MINUTES ?? 120),
    maxGapMinutes: Number(process.env.PROACTIVE_MAX_GAP_MINUTES ?? 360),
    // "Horário de sono" do personagem (não manda mensagem nesse intervalo).
    quietHoursStart: Number(process.env.PROACTIVE_QUIET_START ?? 23),
    quietHoursEnd: Number(process.env.PROACTIVE_QUIET_END ?? 7),
    // De quanto em quanto tempo o agendador verifica (segundos).
    checkIntervalSeconds: Number(process.env.PROACTIVE_CHECK_INTERVAL_SECONDS ?? 30),
    // Máximo de mensagens seguidas do personagem sem resposta do usuário.
    maxConsecutive: Number(process.env.PROACTIVE_MAX_CONSECUTIVE ?? 3),
  },
  webSearch: {
    // O personagem usa busca na web para comentar notícias/cotidiano reais.
    enabled: (process.env.WEB_SEARCH_ENABLED ?? 'true') !== 'false',
    // Quantas buscas o modelo pode fazer por mensagem.
    maxUses: Number(process.env.WEB_SEARCH_MAX_USES ?? 3),
    // Chance (0-1) de uma mensagem proativa ser baseada em notícias do dia.
    newsChance: Number(process.env.PROACTIVE_NEWS_CHANCE ?? 0.4),
    // Permite busca também nas respostas normais (mais lento). Padrão: desligado.
    inReplies: (process.env.WEB_SEARCH_IN_REPLIES ?? 'false') === 'true',
  },
  reply: {
    // Respostas com atraso humano (não responde na hora). Se false, responde já.
    enabled: (process.env.REPLY_DELAY_ENABLED ?? 'true') !== 'false',
    // Multiplica todos os atrasos. Use baixo para testar rápido (ex: 0.05).
    speedFactor: Number(process.env.REPLY_SPEED_FACTOR ?? 1),
    // De quanto em quanto tempo o servidor verifica respostas pendentes (s).
    checkIntervalSeconds: Number(process.env.REPLY_CHECK_INTERVAL_SECONDS ?? 3),
    // Janela (s) antes da entrega em que o app mostra "digitando...".
    typingWindowSeconds: Number(process.env.REPLY_TYPING_WINDOW_SECONDS ?? 12),
    // Teto do atraso quando o personagem está acordado (minutos).
    maxAwakeMinutes: Number(process.env.REPLY_MAX_AWAKE_MINUTES ?? 30),
    // Multiplica a duração da "digitação" (proporcional ao tamanho da mensagem).
    typingSpeedFactor: Number(process.env.REPLY_TYPING_SPEED_FACTOR ?? 1),
  },
  character: {
    // Personagens são GLOBAIS: ao entrar, há esta chance (0-1) de o usuário ser
    // conectado a um personagem que já existe no Talky em vez de criar um novo.
    poolReuseChance: Number(process.env.CHARACTER_POOL_REUSE_CHANCE ?? 0.5),
  },
  mood: {
    // O personagem tem um humor que varia dia a dia (mais animado, triste, etc.).
    enabled: (process.env.MOOD_ENABLED ?? 'true') !== 'false',
    // Além da variação diária, as conversas também deslocam o humor. Isso usa uma
    // chamada leve extra por resposta — desligue para economizar.
    conversationEffect: (process.env.MOOD_CONVERSATION_EFFECT ?? 'true') !== 'false',
  },
  intimacy: {
    // Controle interno de intimidade por conversa: molda o quanto o personagem
    // se abre e gera atrito quando o usuário força intimidade cedo demais.
    enabled: (process.env.INTIMACY_ENABLED ?? 'true') !== 'false',
  },
};

if (!config.anthropicApiKey) {
  console.warn(
    '[talky] ANTHROPIC_API_KEY não está definido. Crie backend/.env a partir de .env.example.',
  );
}

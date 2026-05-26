import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: Number(process.env.PORT ?? 3000),
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '',
  model: process.env.TALKY_MODEL ?? 'claude-opus-4-7',
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
  },
};

if (!config.anthropicApiKey) {
  console.warn(
    '[talky] ANTHROPIC_API_KEY não está definido. Crie backend/.env a partir de .env.example.',
  );
}

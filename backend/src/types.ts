export interface TimelineEvent {
  /** Idade ou época do marco, ex: "18 anos" ou "2019". */
  age: string;
  title: string;
  description: string;
}

export interface Personality {
  summary: string;
  traits: string[];
  quirks: string[];
  values: string[];
  /** Como a pessoa escreve no chat: tom, gírias, emojis, tamanho das mensagens. */
  speakingStyle: string;
}

/**
 * Quão disponível o personagem está numa atividade:
 * - fast: livre, responde rapidinho
 * - slow: ocupado, responde mais devagar
 * - away: bem ocupado (reunião, academia), demora bastante
 * - asleep: dormindo, só responde ao acordar
 */
export type Responsiveness = 'fast' | 'slow' | 'away' | 'asleep';

/** Um bloco da agenda diária do personagem (horas locais 0-24). */
export interface ScheduleBlock {
  startHour: number;
  endHour: number;
  /** O que está fazendo, em linguagem natural (ex: "trabalhando", "em reunião"). */
  activity: string;
  responsiveness: Responsiveness;
}

/**
 * Humor atual da persona. Varia dia a dia (re-sorteado a cada novo dia, com
 * viés do temperamento) e também ao longo das conversas.
 */
export interface Mood {
  /** Quão bem se sente: -5 (péssimo/depre) a +5 (ótimo/feliz). */
  valence: number;
  /** Energia: -5 (exausto/entediado) a +5 (elétrico/agitado). */
  energy: number;
  /** Rótulo curto derivado (ex: "meio pra baixo", "animado", "cansado"). */
  label: string;
  /** Motivo curto do humor (ex: "dormiu mal", "conversa boa"). */
  note?: string;
  /** Dia (YYYY-MM-DD, hora local) da última rolagem diária. */
  day: string;
  updatedAt: string;
}

/** Uma foto gerada do personagem, guardada para reuso entre conversas. */
export interface ChatPhoto {
  id: string;
  /** Caminho público (ex: "/photos/<id>.png"). */
  imageUrl: string;
  /** Descrição da cena (pose, enquadramento, cenário) — usada para casar pedidos. */
  description: string;
  createdAt: string;
}

export interface Character {
  id: string;
  name: string;
  age: number;
  occupation: string;
  location: string;
  avatar: { emoji: string; color: string };
  /** Gênero do personagem ('female' | 'male'), usado p/ escolher a voz do TTS. */
  gender?: string;
  /** Descrição física, usada para gerar a foto de perfil. */
  appearance?: string;
  /** Caminho da foto de perfil gerada (ex: "/avatars/<id>.png"), se houver. */
  photoUrl?: string;
  personality: Personality;
  /** Temas que interessam o personagem — base para conversas sobre notícias e cotidiano. */
  interests: string[];
  backstory: string;
  routine: string;
  timeline: TimelineEvent[];
  /** Intensidade (0-10) de traços como ironia, sarcasmo, doçura, etc. */
  temperament: Record<string, number>;
  /** Agenda diária típica — define o que faz e quão disponível está a cada hora. */
  schedule: ScheduleBlock[];
  /** Humor do dia — muda diariamente e conforme as conversas. */
  mood?: Mood;
  /** Galeria de fotos já geradas, reaproveitadas entre conversas. */
  photoGallery?: ChatPhoto[];
  /** Taxa de ganho de intimidade (multiplica os ganhos; ~0.4 lento … ~1.8 rápido). */
  intimacyGain?: number;
  /** Quanto picota as mensagens (0 = manda tudo junto … 100 = tudo separado). */
  splitStyle?: number;
  /** Voz da OpenAI TTS usada nos áudios do personagem (timbre próprio). */
  voice?: string;
  createdAt: string;
}

export type SenderRole = 'user' | 'character';

export interface Message {
  id: string;
  conversationId: string;
  role: SenderRole;
  /** 'user' ou o id do personagem que enviou. */
  senderId: string;
  senderName: string;
  text: string;
  /** Foto enviada na mensagem (ex: "/photos/<id>.png" ou "/uploads/<id>.jpg"). */
  imageUrl?: string;
  /** Descrição (gerada por visão) de uma foto que o USUÁRIO enviou — vai pro contexto. */
  imageDescription?: string;
  /** Áudio enviado pelo usuário (ex: "/uploads/<id>.m4a"). */
  audioUrl?: string;
  /** Duração do áudio em milissegundos (para a UI do player). */
  audioDurationMs?: number;
  /** Transcrição do áudio — só vai pro CONTEXTO, nunca é exibida no chat. */
  audioTranscript?: string;
  createdAt: string;
}

export interface Conversation {
  id: string;
  title: string;
  /** Suporta múltiplos personagens (grupo). Por ora, começa com um. */
  characterIds: string[];
  /** Nome de quem conversa — usado nas mensagens proativas. */
  userName?: string;
  /** Dono da conversa (identidade do dispositivo/usuário). */
  userId?: string;
  /** Status definido pelo usuário (ex: "em reunião") — vira contexto pro personagem. */
  userStatus?: string;
  /**
   * Intimidade (0-100) do personagem com este usuário. Controle INTERNO — nunca
   * exibido. Cresce devagar com bom convívio; cai quando o usuário força
   * intimidade cedo demais. Define o quanto o personagem se abre.
   */
  intimacy?: number;
  /** Quando o usuário leu a conversa pela última vez (para contagem de não lidos). */
  lastReadAt?: string;
  createdAt: string;
}

/** Resposta agendada (atraso humano) que ainda será gerada e entregue. */
export interface PendingReply {
  id: string;
  conversationId: string;
  dueAt: string;
  /** O usuário pediu a resposta em áudio: entregar como mensagem de voz (TTS). */
  asAudio?: boolean;
  createdAt: string;
}

/** Estado de agendamento das mensagens proativas de uma conversa. */
export interface ProactiveState {
  conversationId: string;
  /** Quando a próxima mensagem espontânea está prevista (ISO). */
  nextAt: string;
  enabled: boolean;
}

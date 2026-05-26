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

export interface Character {
  id: string;
  name: string;
  age: number;
  occupation: string;
  location: string;
  avatar: { emoji: string; color: string };
  personality: Personality;
  /** Temas que interessam o personagem — base para conversas sobre notícias e cotidiano. */
  interests: string[];
  backstory: string;
  routine: string;
  timeline: TimelineEvent[];
  /** Agenda diária típica — define o que faz e quão disponível está a cada hora. */
  schedule: ScheduleBlock[];
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
  createdAt: string;
}

export interface Conversation {
  id: string;
  title: string;
  /** Suporta múltiplos personagens (grupo). Por ora, começa com um. */
  characterIds: string[];
  /** Nome de quem conversa — usado nas mensagens proativas. */
  userName?: string;
  /** Status definido pelo usuário (ex: "em reunião") — vira contexto pro personagem. */
  userStatus?: string;
  createdAt: string;
}

/** Resposta agendada (atraso humano) que ainda será gerada e entregue. */
export interface PendingReply {
  id: string;
  conversationId: string;
  dueAt: string;
  createdAt: string;
}

/** Estado de agendamento das mensagens proativas de uma conversa. */
export interface ProactiveState {
  conversationId: string;
  /** Quando a próxima mensagem espontânea está prevista (ISO). */
  nextAt: string;
  enabled: boolean;
}

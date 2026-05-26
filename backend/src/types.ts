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
  createdAt: string;
}

/** Estado de agendamento das mensagens proativas de uma conversa. */
export interface ProactiveState {
  conversationId: string;
  /** Quando a próxima mensagem espontânea está prevista (ISO). */
  nextAt: string;
  enabled: boolean;
}

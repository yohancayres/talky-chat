export interface TimelineEvent {
  age: string;
  title: string;
  description: string;
}

export interface Personality {
  summary: string;
  traits: string[];
  quirks: string[];
  values: string[];
  speakingStyle: string;
}

export interface Character {
  id: string;
  name: string;
  age: number;
  occupation: string;
  location: string;
  avatar: { emoji: string; color: string };
  photoUrl?: string;
  appearance?: string;
  personality: Personality;
  interests: string[];
  backstory: string;
  routine: string;
  timeline: TimelineEvent[];
  temperament?: Record<string, number>;
  createdAt: string;
}

export type SenderRole = 'user' | 'character';

export interface Message {
  id: string;
  conversationId: string;
  role: SenderRole;
  senderId: string;
  senderName: string;
  text: string;
  createdAt: string;
}

export interface Conversation {
  id: string;
  title: string;
  characterIds: string[];
  userName?: string;
  userStatus?: string;
  createdAt: string;
}

export interface ChatStatus {
  state: 'online' | 'busy' | 'sleeping';
  activity: string;
  typing: boolean;
  photoUrl?: string;
  avatarGenerating?: boolean;
}

/** Resumo de uma conversa para a tela de lista. */
export interface ConversationSummary {
  conversation: { id: string; title: string };
  character: {
    id: string;
    name: string;
    avatar: { emoji: string; color: string };
    photoUrl?: string;
  } | null;
  lastMessage: { text: string; role: SenderRole; createdAt: string } | null;
  unread: number;
}

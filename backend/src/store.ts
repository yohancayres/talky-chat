import fs from 'fs';
import path from 'path';
import { Character, Conversation, Message, PendingReply, ProactiveState } from './types';

// Persistência simples em arquivo JSON. Suficiente para o protótipo;
// trocar por um banco de dados real quando o app crescer.
const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

interface DB {
  characters: Record<string, Character>;
  conversations: Record<string, Conversation>;
  messages: Message[];
  proactive: Record<string, ProactiveState>;
  /** Tokens de push (Expo) por conversa. */
  pushTokens: Record<string, string[]>;
  /** Respostas agendadas (atraso humano) aguardando geração. */
  pendingReplies: PendingReply[];
  /** Histograma de atividade do usuário por hora (0-23), por conversa. */
  activity: Record<string, number[]>;
}

function emptyDB(): DB {
  return {
    characters: {},
    conversations: {},
    messages: [],
    proactive: {},
    pushTokens: {},
    pendingReplies: [],
    activity: {},
  };
}

function load(): DB {
  try {
    const parsed = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8')) as Partial<DB>;
    return { ...emptyDB(), ...parsed };
  } catch {
    return emptyDB();
  }
}

let db: DB = load();

function persist(): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

export function saveCharacter(character: Character): void {
  db.characters[character.id] = character;
  persist();
}

export function getCharacter(id: string): Character | undefined {
  return db.characters[id];
}

/** Todos os personagens (pool global compartilhado entre usuários). */
export function listCharacters(): Character[] {
  return Object.values(db.characters);
}

export function saveConversation(conversation: Conversation): void {
  db.conversations[conversation.id] = conversation;
  persist();
}

export function getConversation(id: string): Conversation | undefined {
  return db.conversations[id];
}

export function addMessage(message: Message): void {
  db.messages.push(message);
  persist();
}

export function getMessages(conversationId: string): Message[] {
  return db.messages
    .filter((m) => m.conversationId === conversationId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function setProactiveState(state: ProactiveState): void {
  db.proactive[state.conversationId] = state;
  persist();
}

export function getProactiveState(conversationId: string): ProactiveState | undefined {
  return db.proactive[conversationId];
}

export function listProactiveStates(): ProactiveState[] {
  return Object.values(db.proactive);
}

export function addPushToken(conversationId: string, token: string): void {
  const existing = db.pushTokens[conversationId] ?? [];
  if (!existing.includes(token)) {
    db.pushTokens[conversationId] = [...existing, token];
    persist();
  }
}

export function getPushTokens(conversationId: string): string[] {
  return db.pushTokens[conversationId] ?? [];
}

export function addPendingReply(reply: PendingReply): void {
  db.pendingReplies.push(reply);
  persist();
}

export function listPendingReplies(): PendingReply[] {
  return db.pendingReplies;
}

export function removePendingReply(id: string): void {
  db.pendingReplies = db.pendingReplies.filter((r) => r.id !== id);
  persist();
}

export function hasPendingReply(conversationId: string): boolean {
  return db.pendingReplies.some((r) => r.conversationId === conversationId);
}

export function getPendingReply(conversationId: string): PendingReply | undefined {
  return db.pendingReplies.find((r) => r.conversationId === conversationId);
}

export function bumpUserActivity(conversationId: string, hour: number): void {
  const hist = db.activity[conversationId] ?? new Array<number>(24).fill(0);
  hist[hour] = (hist[hour] ?? 0) + 1;
  db.activity[conversationId] = hist;
  persist();
}

export function getUserActivity(conversationId: string): number[] | undefined {
  return db.activity[conversationId];
}

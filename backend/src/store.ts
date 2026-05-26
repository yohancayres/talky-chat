import fs from 'fs';
import path from 'path';
import { Character, Conversation, Message, ProactiveState } from './types';

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
}

function emptyDB(): DB {
  return { characters: {}, conversations: {}, messages: [], proactive: {}, pushTokens: {} };
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

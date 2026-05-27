import fs from 'fs';
import path from 'path';
import { Db, MongoClient } from 'mongodb';
import { config } from './config';
import { Character, Conversation, Message, PendingReply, ProactiveState } from './types';

// Modelo em memória (acesso síncrono em todo o app) com persistência
// "write-through": cada escrita atualiza a memória E grava no backend escolhido.
// Em produção: MongoDB (MONGODB_URI). Em dev sem essa variável: arquivo db.json.
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

let db: DB = emptyDB();

// ---------------------------------------------------------------------------
// Persistência
// ---------------------------------------------------------------------------

type Collection =
  | 'characters'
  | 'conversations'
  | 'messages'
  | 'proactive'
  | 'pushTokens'
  | 'pendingReplies'
  | 'activity';

let mongo: Db | null = null;
let mongoClient: MongoClient | null = null;

function persistFile(): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

// Upsert de um documento (id vira _id). Mongo: fire-and-forget; arquivo: regrava.
function writeDoc(collection: Collection, id: string, doc: object): void {
  if (mongo) {
    void mongo
      .collection(collection)
      .replaceOne({ _id: id } as never, { _id: id, ...doc } as never, { upsert: true })
      .catch((e) => console.error(`[talky] erro ao gravar ${collection}:`, e));
  } else {
    persistFile();
  }
}

function removeDoc(collection: Collection, id: string): void {
  if (mongo) {
    void mongo
      .collection(collection)
      .deleteOne({ _id: id } as never)
      .catch((e) => console.error(`[talky] erro ao remover ${collection}:`, e));
  } else {
    persistFile();
  }
}

function removeBy(collection: Collection, field: string, value: string): void {
  if (mongo) {
    void mongo
      .collection(collection)
      .deleteMany({ [field]: value })
      .catch((e) => console.error(`[talky] erro ao remover ${collection}:`, e));
  } else {
    persistFile();
  }
}

function stripId<T>(doc: Record<string, unknown>): T {
  const { _id, ...rest } = doc;
  return rest as T;
}

async function loadFromMongo(mdb: Db): Promise<void> {
  const fresh = emptyDB();
  for (const c of await mdb.collection('characters').find().toArray()) {
    const ch = stripId<Character>(c);
    fresh.characters[ch.id] = ch;
  }
  for (const c of await mdb.collection('conversations').find().toArray()) {
    const conv = stripId<Conversation>(c);
    fresh.conversations[conv.id] = conv;
  }
  fresh.messages = (await mdb.collection('messages').find().toArray()).map((m) =>
    stripId<Message>(m),
  );
  for (const s of await mdb.collection('proactive').find().toArray()) {
    const st = stripId<ProactiveState>(s);
    fresh.proactive[st.conversationId] = st;
  }
  for (const t of await mdb.collection('pushTokens').find().toArray()) {
    fresh.pushTokens[String(t._id)] = (t.tokens as string[]) ?? [];
  }
  fresh.pendingReplies = (await mdb.collection('pendingReplies').find().toArray()).map((r) =>
    stripId<PendingReply>(r),
  );
  for (const a of await mdb.collection('activity').find().toArray()) {
    fresh.activity[String(a._id)] = (a.hist as number[]) ?? [];
  }
  db = fresh;
}

// Importa o db.json existente para o Mongo na primeira vez (continuidade dos dados).
async function migrateFileToMongoIfEmpty(mdb: Db): Promise<void> {
  if ((await mdb.collection('characters').countDocuments()) > 0) return;
  let fileDb: Partial<DB>;
  try {
    fileDb = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8')) as Partial<DB>;
  } catch {
    return; // sem arquivo: começa vazio
  }
  console.log('[talky] migrando db.json para o MongoDB (primeira execução)...');
  db = { ...emptyDB(), ...fileDb };
  for (const c of Object.values(db.characters)) writeDoc('characters', c.id, c);
  for (const c of Object.values(db.conversations)) writeDoc('conversations', c.id, c);
  for (const m of db.messages) writeDoc('messages', m.id, m);
  for (const s of Object.values(db.proactive)) writeDoc('proactive', s.conversationId, s);
  for (const [cid, tokens] of Object.entries(db.pushTokens))
    writeDoc('pushTokens', cid, { conversationId: cid, tokens });
  for (const r of db.pendingReplies) writeDoc('pendingReplies', r.id, r);
  for (const [cid, hist] of Object.entries(db.activity))
    writeDoc('activity', cid, { conversationId: cid, hist });
}

/** Conecta ao banco e carrega os dados para a memória. Chamar antes de servir. */
export async function initStore(): Promise<void> {
  if (config.mongoUri) {
    mongoClient = new MongoClient(config.mongoUri);
    await mongoClient.connect();
    mongo = mongoClient.db(config.mongoDbName);
    await loadFromMongo(mongo);
    await migrateFileToMongoIfEmpty(mongo);
    // Índices úteis para deleção e futuras consultas diretas.
    await mongo.collection('messages').createIndex({ conversationId: 1, createdAt: 1 });
    await mongo.collection('conversations').createIndex({ userId: 1 });
    await mongo.collection('pendingReplies').createIndex({ conversationId: 1 });
    console.log(`[talky] MongoDB conectado (db: ${config.mongoDbName}).`);
  } else {
    try {
      db = { ...emptyDB(), ...(JSON.parse(fs.readFileSync(DB_FILE, 'utf-8')) as Partial<DB>) };
    } catch {
      db = emptyDB();
    }
    console.warn(
      '[talky] sem MONGODB_URI: usando arquivo db.json (apenas para dev). Em produção, configure o MongoDB.',
    );
  }
}

export async function closeStore(): Promise<void> {
  await mongoClient?.close();
}

// ---------------------------------------------------------------------------
// API (síncrona) — inalterada para o resto do app
// ---------------------------------------------------------------------------

export function saveCharacter(character: Character): void {
  db.characters[character.id] = character;
  writeDoc('characters', character.id, character);
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
  writeDoc('conversations', conversation.id, conversation);
}

export function getConversation(id: string): Conversation | undefined {
  return db.conversations[id];
}

export function listConversationsByUser(userId: string): Conversation[] {
  return Object.values(db.conversations).filter((c) => c.userId === userId);
}

/**
 * Apaga uma conversa e tudo ligado a ela (mensagens, estado proativo, respostas
 * pendentes, tokens de push e histograma de atividade). O PERSONAGEM é mantido
 * no pool global — só some a conversa com este usuário.
 */
export function deleteConversation(conversationId: string): void {
  delete db.conversations[conversationId];
  db.messages = db.messages.filter((m) => m.conversationId !== conversationId);
  delete db.proactive[conversationId];
  delete db.pushTokens[conversationId];
  db.pendingReplies = db.pendingReplies.filter((r) => r.conversationId !== conversationId);
  delete db.activity[conversationId];
  removeDoc('conversations', conversationId);
  removeBy('messages', 'conversationId', conversationId);
  removeDoc('proactive', conversationId);
  removeDoc('pushTokens', conversationId);
  removeBy('pendingReplies', 'conversationId', conversationId);
  removeDoc('activity', conversationId);
}

export function addMessage(message: Message): void {
  db.messages.push(message);
  writeDoc('messages', message.id, message);
}

export function getMessages(conversationId: string): Message[] {
  return db.messages
    .filter((m) => m.conversationId === conversationId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function setProactiveState(state: ProactiveState): void {
  db.proactive[state.conversationId] = state;
  writeDoc('proactive', state.conversationId, state);
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
    writeDoc('pushTokens', conversationId, {
      conversationId,
      tokens: db.pushTokens[conversationId],
    });
  }
}

export function getPushTokens(conversationId: string): string[] {
  return db.pushTokens[conversationId] ?? [];
}

export function addPendingReply(reply: PendingReply): void {
  db.pendingReplies.push(reply);
  writeDoc('pendingReplies', reply.id, reply);
}

export function listPendingReplies(): PendingReply[] {
  return db.pendingReplies;
}

export function removePendingReply(id: string): void {
  db.pendingReplies = db.pendingReplies.filter((r) => r.id !== id);
  removeDoc('pendingReplies', id);
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
  writeDoc('activity', conversationId, { conversationId, hist });
}

export function getUserActivity(conversationId: string): number[] | undefined {
  return db.activity[conversationId];
}

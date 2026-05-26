import { randomUUID } from 'crypto';
import { Router } from 'express';
import { generateAppearance, generateCharacter, generateReply } from './ai';
import { computeReplyDueAt } from './availability';
import { config } from './config';
import { deleteAvatar, generateAvatar } from './image';
import { INTRO_DIRECTIVE } from './prompts';
import {
  getConversationStatus,
  initProactiveForConversation,
  touchProactive,
} from './scheduler';
import {
  addMessage,
  addPendingReply,
  addPushToken,
  bumpUserActivity,
  getCharacter,
  getConversation,
  getMessages,
  getUserActivity,
  hasPendingReply,
  listCharacters,
  saveCharacter,
  saveConversation,
} from './store';
import { Character, Conversation, Message } from './types';

export const router = Router();

function characterMessage(
  conversationId: string,
  character: Character,
  text: string,
): Message {
  return {
    id: randomUUID(),
    conversationId,
    role: 'character',
    senderId: character.id,
    senderName: character.name,
    text,
    createdAt: new Date().toISOString(),
  };
}

// Conecta o usuário a um personagem (existente no pool global ou novo), abre uma
// conversa e gera a mensagem de boas-vindas.
router.post('/characters/generate', async (req, res) => {
  try {
    const { hint, userName } = req.body ?? {};

    // Personagens são globais e compartilhados. Com certa probabilidade, o
    // usuário "esbarra" em um personagem que já existe no Talky.
    const pool = listCharacters();
    const hasHint = typeof hint === 'string' && hint.trim().length > 0;
    const reuseChance = hasHint
      ? config.character.poolReuseChance * 0.3 // com pedido específico, tende a criar
      : config.character.poolReuseChance;
    const reuse = pool.length > 0 && Math.random() < reuseChance;

    let character: Character;
    let existing = false;
    if (reuse) {
      character = pool[Math.floor(Math.random() * pool.length)];
      existing = true;
    } else {
      character = await generateCharacter(hint, userName);
      saveCharacter(character);
    }

    // Personagem novo sem foto: gera a foto de perfil (em paralelo com o intro,
    // mais abaixo). Personagem reusado já traz a foto (se tiver).
    const needsPhoto = !existing && !character.photoUrl;

    const conversation: Conversation = {
      id: randomUUID(),
      title: character.name,
      characterIds: [character.id],
      userName: typeof userName === 'string' ? userName.trim() : undefined,
      createdAt: new Date().toISOString(),
    };
    saveConversation(conversation);
    initProactiveForConversation(conversation.id);

    // A mensagem de boas-vindas é imediata (não cair num chat vazio). Geramos a
    // foto de perfil em paralelo para não somar latências.
    const [introText, photoUrl] = await Promise.all([
      generateReply(character, [], { userName, directive: INTRO_DIRECTIVE }),
      needsPhoto ? generateAvatar(character) : Promise.resolve(null),
    ]);

    if (photoUrl) {
      character = { ...character, photoUrl };
      saveCharacter(character);
    }

    const introMessage = characterMessage(conversation.id, character, introText);
    addMessage(introMessage);

    res.json({ conversation, character, messages: [introMessage], existing });
  } catch (err) {
    console.error('[talky] erro ao gerar personagem:', err);
    res.status(500).json({ error: messageOf(err) });
  }
});

// Carrega o estado de uma conversa (personagens + histórico).
router.get('/conversations/:id', (req, res) => {
  const conversation = getConversation(req.params.id);
  if (!conversation) {
    res.status(404).json({ error: 'Conversa não encontrada.' });
    return;
  }
  const characters = conversation.characterIds
    .map(getCharacter)
    .filter((c): c is Character => Boolean(c));
  const messages = getMessages(conversation.id);
  res.json({ conversation, characters, messages, status: getConversationStatus(conversation.id) });
});

// Gera (ou troca) a foto de perfil do personagem. Sem foto => cria do zero;
// com foto => mantém as feições, mas em outro cenário/ângulo.
router.post('/characters/:id/avatar', async (req, res) => {
  try {
    let character = getCharacter(req.params.id);
    if (!character) {
      res.status(404).json({ error: 'Personagem não encontrado.' });
      return;
    }
    if (!config.image.enabled || !config.openaiApiKey) {
      res.status(503).json({ error: 'Geração de imagem indisponível no servidor.' });
      return;
    }

    // Garante uma descrição física para manter as feições ao trocar a foto.
    if (!character.appearance || !character.appearance.trim()) {
      const appearance = await generateAppearance(character);
      if (appearance) {
        character = { ...character, appearance };
        saveCharacter(character);
      }
    }

    const variation = Boolean(character.photoUrl);
    const previous = character.photoUrl;
    const photoUrl = await generateAvatar(character, { variation });
    if (!photoUrl) {
      res.status(502).json({ error: 'Não foi possível gerar a foto agora.' });
      return;
    }

    character = { ...character, photoUrl };
    saveCharacter(character);
    if (previous && previous !== photoUrl) deleteAvatar(previous);

    res.json({ character });
  } catch (err) {
    console.error('[talky] erro ao gerar foto de perfil:', err);
    res.status(500).json({ error: messageOf(err) });
  }
});

// Define/limpa o status do usuário (ex: "em reunião"). Vira contexto pro personagem.
router.post('/conversations/:id/user-status', (req, res) => {
  const conversation = getConversation(req.params.id);
  if (!conversation) {
    res.status(404).json({ error: 'Conversa não encontrada.' });
    return;
  }
  const { status } = req.body ?? {};
  const value = typeof status === 'string' ? status.trim() : '';
  saveConversation({ ...conversation, userStatus: value || undefined });
  res.json({ ok: true, userStatus: value || null });
});

// Polling: retorna apenas as mensagens criadas depois de `after` (ISO).
// Usado pelo app para receber mensagens proativas e respostas em tempo quase real.
router.get('/conversations/:id/messages', (req, res) => {
  const conversation = getConversation(req.params.id);
  if (!conversation) {
    res.status(404).json({ error: 'Conversa não encontrada.' });
    return;
  }
  const after = typeof req.query.after === 'string' ? req.query.after : undefined;
  let messages = getMessages(conversation.id);
  if (after) {
    messages = messages.filter((m) => m.createdAt > after);
  }
  res.json({ messages, status: getConversationStatus(conversation.id) });
});

// Registra um token de push (Expo) para receber mensagens proativas.
router.post('/conversations/:id/push-token', (req, res) => {
  const conversation = getConversation(req.params.id);
  if (!conversation) {
    res.status(404).json({ error: 'Conversa não encontrada.' });
    return;
  }
  const { token } = req.body ?? {};
  if (!token || typeof token !== 'string') {
    res.status(400).json({ error: 'Token ausente.' });
    return;
  }
  addPushToken(conversation.id, token);
  res.json({ ok: true });
});

// Envia uma mensagem do usuário e devolve a(s) resposta(s) do personagem.
router.post('/conversations/:id/messages', async (req, res) => {
  try {
    const conversation = getConversation(req.params.id);
    if (!conversation) {
      res.status(404).json({ error: 'Conversa não encontrada.' });
      return;
    }

    const { text, userName } = req.body ?? {};
    if (!text || !String(text).trim()) {
      res.status(400).json({ error: 'Mensagem vazia.' });
      return;
    }

    const now = new Date();
    const userMessage: Message = {
      id: randomUUID(),
      conversationId: conversation.id,
      role: 'user',
      senderId: 'user',
      senderName: userName?.trim() || 'Você',
      text: String(text).trim(),
      createdAt: now.toISOString(),
    };
    addMessage(userMessage);
    bumpUserActivity(conversation.id, now.getHours());
    touchProactive(conversation.id);

    const character = getCharacter(conversation.characterIds[0]);
    if (!character) {
      res.status(500).json({ error: 'Personagem da conversa não encontrado.' });
      return;
    }

    // Atraso humano: agenda a resposta para mais tarde (gerada pelo scheduler) e
    // responde já só com a mensagem do usuário. O app recebe a resposta via polling.
    if (config.reply.enabled) {
      if (!hasPendingReply(conversation.id)) {
        const { dueAt } = computeReplyDueAt(character, now, getUserActivity(conversation.id));
        addPendingReply({
          id: randomUUID(),
          conversationId: conversation.id,
          dueAt: dueAt.toISOString(),
          createdAt: now.toISOString(),
        });
      }
      res.json({ userMessage, replies: [], status: getConversationStatus(conversation.id) });
      return;
    }

    // Modo imediato (atraso desligado).
    const history = getMessages(conversation.id);
    const replyText = await generateReply(character, history, {
      userName,
      userStatus: conversation.userStatus,
      useWebSearch: config.webSearch.enabled && config.webSearch.inReplies,
    });
    const replyMessage = characterMessage(conversation.id, character, replyText);
    addMessage(replyMessage);
    touchProactive(conversation.id);

    res.json({
      userMessage,
      replies: [replyMessage],
      status: getConversationStatus(conversation.id),
    });
  } catch (err) {
    console.error('[talky] erro ao responder mensagem:', err);
    res.status(500).json({ error: messageOf(err) });
  }
});

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : 'Erro inesperado.';
}

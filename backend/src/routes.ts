import { randomUUID } from 'crypto';
import { Router } from 'express';
import { generateCharacter, generateReply } from './ai';
import { INTRO_DIRECTIVE } from './prompts';
import {
  addMessage,
  getCharacter,
  getConversation,
  getMessages,
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

// Cria um personagem novo, abre uma conversa e gera a mensagem de boas-vindas.
router.post('/characters/generate', async (req, res) => {
  try {
    const { hint, userName } = req.body ?? {};
    const character = await generateCharacter(hint, userName);
    saveCharacter(character);

    const conversation: Conversation = {
      id: randomUUID(),
      title: character.name,
      characterIds: [character.id],
      createdAt: new Date().toISOString(),
    };
    saveConversation(conversation);

    const introText = await generateReply(character, [], userName, INTRO_DIRECTIVE);
    const introMessage = characterMessage(conversation.id, character, introText);
    addMessage(introMessage);

    res.json({ conversation, character, messages: [introMessage] });
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
  res.json({ conversation, characters, messages });
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

    const userMessage: Message = {
      id: randomUUID(),
      conversationId: conversation.id,
      role: 'user',
      senderId: 'user',
      senderName: userName?.trim() || 'Você',
      text: String(text).trim(),
      createdAt: new Date().toISOString(),
    };
    addMessage(userMessage);

    const character = getCharacter(conversation.characterIds[0]);
    if (!character) {
      res.status(500).json({ error: 'Personagem da conversa não encontrado.' });
      return;
    }

    const history = getMessages(conversation.id);
    const replyText = await generateReply(character, history, userName);
    const replyMessage = characterMessage(conversation.id, character, replyText);
    addMessage(replyMessage);

    res.json({ userMessage, replies: [replyMessage] });
  } catch (err) {
    console.error('[talky] erro ao responder mensagem:', err);
    res.status(500).json({ error: messageOf(err) });
  }
});

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : 'Erro inesperado.';
}

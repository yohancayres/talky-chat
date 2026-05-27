import { randomUUID } from 'crypto';
import { Router } from 'express';
import { generateAppearance, generateCharacter, generateReply, interpretImage } from './ai';
import { transcribeAudio } from './audio';
import { computeReplyDueAt } from './availability';
import { config } from './config';
import {
  clearAvatarGenerating,
  deleteAvatar,
  generateAvatar,
  isGeneratingAvatar,
  markAvatarGenerating,
  saveUpload,
} from './image';
import { ensureCharacterVoice, recordConversationImpact, refreshDailyMood } from './moodService';
import { DEFAULT_INTIMACY } from './intimacy';
import { DEFAULT_SPLIT_STYLE, splitMessages } from './messaging';
import { AUDIO_REPLY_DIRECTIVE, INTRO_DIRECTIVE, isAudioRequest, isPhotoRequest } from './prompts';
import { generateSpeech } from './speech';
import {
  bumpSequence,
  getConversationStatus,
  initProactiveForConversation,
  requestChatPhoto,
  touchProactive,
} from './scheduler';
import {
  addMessage,
  addPendingReply,
  addPushToken,
  bumpUserActivity,
  deleteConversation,
  getCharacter,
  getConversation,
  getMessages,
  getUserActivity,
  hasPendingReply,
  listCharacters,
  listConversationsByUser,
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
    const { hint, userName, userId } = req.body ?? {};

    // Personagens são globais e compartilhados. Com certa probabilidade, o
    // usuário "esbarra" em um personagem que já existe no Talky — MAS nunca em
    // alguém com quem ele já conversa (evita conversa duplicada).
    const allChars = listCharacters();
    const userCharIds = new Set(
      (typeof userId === 'string' ? listConversationsByUser(userId) : []).flatMap(
        (c) => c.characterIds,
      ),
    );
    const pool = allChars.filter((c) => !userCharIds.has(c.id));

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
      // Evita repetir nomes já existentes no Talky (o modelo tende a repetir).
      const avoidNames = allChars.map((c) => c.name);
      character = await generateCharacter(hint, userName, avoidNames);
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
      userId: typeof userId === 'string' ? userId : undefined,
      intimacy: DEFAULT_INTIMACY, // começam se conhecendo
      lastReadAt: new Date().toISOString(),
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

// Exclui a conversa do usuário. O personagem permanece no pool global (você
// pode reencontrá-lo depois); só o histórico e os dados desta conversa somem.
router.delete('/conversations/:id', (req, res) => {
  const conversation = getConversation(req.params.id);
  if (!conversation) {
    res.status(404).json({ error: 'Conversa não encontrada.' });
    return;
  }
  // Não apaga os arquivos de foto: com o reuso de galeria, a mesma foto pode
  // estar guardada no personagem e no histórico de outras conversas.
  deleteConversation(conversation.id);
  res.json({ ok: true });
});

// Lista as conversas de um usuário (tela de conversas), com prévia e não lidos.
router.get('/users/:userId/conversations', (req, res) => {
  const items = listConversationsByUser(req.params.userId)
    .map((conv) => {
      const character = getCharacter(conv.characterIds[0]);
      const messages = getMessages(conv.id);
      const last = messages[messages.length - 1];
      const lastReadAt = conv.lastReadAt ?? '';
      const unread = messages.filter(
        (m) => m.role === 'character' && m.createdAt > lastReadAt,
      ).length;
      return {
        conversation: { id: conv.id, title: conv.title },
        character: character
          ? {
              id: character.id,
              name: character.name,
              avatar: character.avatar,
              photoUrl: character.photoUrl,
            }
          : null,
        lastMessage: last
          ? { text: last.text, role: last.role, createdAt: last.createdAt }
          : null,
        unread,
      };
    })
    .sort((a, b) =>
      (b.lastMessage?.createdAt ?? '').localeCompare(a.lastMessage?.createdAt ?? ''),
    );
  res.json({ conversations: items });
});

// Marca a conversa como lida (zera os não lidos).
router.post('/conversations/:id/read', (req, res) => {
  const conversation = getConversation(req.params.id);
  if (!conversation) {
    res.status(404).json({ error: 'Conversa não encontrada.' });
    return;
  }
  saveConversation({ ...conversation, lastReadAt: new Date().toISOString() });
  res.json({ ok: true });
});

// Associa uma conversa sem dono a um usuário (migração do chat único antigo).
router.post('/conversations/:id/claim', (req, res) => {
  const conversation = getConversation(req.params.id);
  if (!conversation) {
    res.status(404).json({ error: 'Conversa não encontrada.' });
    return;
  }
  const { userId } = req.body ?? {};
  if (typeof userId !== 'string' || !userId) {
    res.status(400).json({ error: 'userId ausente.' });
    return;
  }
  if (!conversation.userId) {
    saveConversation({ ...conversation, userId });
  }
  res.json({ ok: true });
});

// Gera (ou troca) a foto de perfil do personagem. Sem foto => cria do zero;
// com foto => mantém as feições, mas em outro cenário/ângulo. A geração roda em
// segundo plano (pode levar minutos); o app recebe a foto nova via polling.
router.post('/characters/:id/avatar', (req, res) => {
  const character = getCharacter(req.params.id);
  if (!character) {
    res.status(404).json({ error: 'Personagem não encontrado.' });
    return;
  }
  if (!config.image.enabled || !config.openaiApiKey) {
    res.status(503).json({ error: 'Geração de imagem indisponível no servidor.' });
    return;
  }
  if (isGeneratingAvatar(character.id)) {
    res.status(202).json({ status: 'generating' });
    return;
  }

  markAvatarGenerating(character.id);
  res.status(202).json({ status: 'generating' });

  // Segundo plano — não bloqueia a resposta.
  void (async () => {
    try {
      let current = getCharacter(character.id);
      if (!current) return;

      // Garante uma descrição física para manter as feições ao trocar a foto.
      if (!current.appearance || !current.appearance.trim()) {
        const appearance = await generateAppearance(current);
        if (appearance) {
          current = { ...current, appearance };
          saveCharacter(current);
        }
      }

      const variation = Boolean(current.photoUrl);
      const previous = current.photoUrl;
      const photoUrl = await generateAvatar(current, { variation });
      if (photoUrl) {
        saveCharacter({ ...getCharacter(current.id)!, photoUrl });
        if (previous && previous !== photoUrl) deleteAvatar(previous);
      }
    } catch (err) {
      console.error('[talky] erro ao gerar foto de perfil:', err);
    } finally {
      clearAvatarGenerating(character.id);
    }
  })();
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

    const { text, userName, image, audio } = req.body ?? {};
    const trimmedText = typeof text === 'string' ? text.trim() : '';
    const hasImage = image && typeof image.data === 'string' && image.data.length > 0;
    const hasAudio = audio && typeof audio.data === 'string' && audio.data.length > 0;
    if (!trimmedText && !hasImage && !hasAudio) {
      res.status(400).json({ error: 'Mensagem vazia.' });
      return;
    }

    const now = new Date();
    // Há quanto tempo a conversa estava parada (antes desta mensagem)? Usado
    // para o personagem tender a demorar mais quando a conversa fica ociosa.
    const prior = getMessages(conversation.id);
    const lastPriorAt = prior.length ? prior[prior.length - 1].createdAt : undefined;
    const idleMs = lastPriorAt ? now.getTime() - new Date(lastPriorAt).getTime() : undefined;

    // Foto enviada pelo usuário: salva e interpreta (visão) para entrar no contexto.
    let imageUrl: string | undefined;
    let imageDescription: string | undefined;
    if (hasImage) {
      const mediaType = typeof image.mediaType === 'string' ? image.mediaType : 'image/jpeg';
      const saved = saveUpload(image.data, mediaType);
      if (saved) {
        imageUrl = saved;
        imageDescription =
          (await interpretImage(image.data, mediaType, trimmedText || undefined)) || undefined;
      }
    }

    // Áudio enviado pelo usuário: salva e transcreve. A transcrição vai SÓ para o
    // contexto (audioTranscript) — nunca para o texto exibido no chat.
    let audioUrl: string | undefined;
    let audioDurationMs: number | undefined;
    let audioTranscript: string | undefined;
    if (hasAudio) {
      const mediaType = typeof audio.mediaType === 'string' ? audio.mediaType : 'audio/m4a';
      const saved = saveUpload(audio.data, mediaType);
      if (saved) {
        audioUrl = saved;
        const dur = Number(audio.durationMs);
        audioDurationMs = Number.isFinite(dur) && dur > 0 ? Math.round(dur) : undefined;
        audioTranscript = (await transcribeAudio(audio.data, mediaType)) || undefined;
      }
    }

    const userMessage: Message = {
      id: randomUUID(),
      conversationId: conversation.id,
      role: 'user',
      senderId: 'user',
      senderName: userName?.trim() || 'Você',
      text: trimmedText,
      imageUrl,
      imageDescription,
      audioUrl,
      audioDurationMs,
      audioTranscript,
      createdAt: now.toISOString(),
    };
    addMessage(userMessage);
    bumpUserActivity(conversation.id, now.getHours());
    touchProactive(conversation.id);
    // Invalida qualquer envio em andamento (partes/follow-up): nova mensagem do
    // usuário interrompe a sequência atual e faz começar uma nova resposta.
    bumpSequence(conversation.id);

    const found = getCharacter(conversation.characterIds[0]);
    if (!found) {
      res.status(500).json({ error: 'Personagem da conversa não encontrado.' });
      return;
    }
    // Mantém o humor do dia atualizado (entra no prompt e no status).
    const character = refreshDailyMood(found, now);

    // Pedido por texto OU por voz (transcrição do áudio enviado).
    const commandText = userMessage.text || audioTranscript || '';

    // Pedido de foto ("manda uma foto de como você tá agora"): o personagem gera
    // e envia uma foto contextual em segundo plano (chega via polling/push).
    if (!hasImage && isPhotoRequest(commandText)) {
      requestChatPhoto(conversation.id, commandText);
      res.json({ userMessage, replies: [], status: getConversationStatus(conversation.id) });
      return;
    }

    // O usuário pediu a resposta em ÁUDIO? Então a resposta será uma nota de voz (TTS).
    const wantsAudio = isAudioRequest(commandText);

    // Atraso humano: agenda a resposta para mais tarde (gerada pelo scheduler) e
    // responde já só com a mensagem do usuário. O app recebe a resposta via polling.
    if (config.reply.enabled) {
      if (!hasPendingReply(conversation.id)) {
        const { dueAt } = computeReplyDueAt(
          character,
          now,
          getUserActivity(conversation.id),
          conversation.intimacy,
          idleMs,
        );
        addPendingReply({
          id: randomUUID(),
          conversationId: conversation.id,
          dueAt: dueAt.toISOString(),
          asAudio: wantsAudio,
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
      intimacy: conversation.intimacy,
      useWebSearch: config.webSearch.enabled && config.webSearch.inReplies,
      directive: wantsAudio ? AUDIO_REPLY_DIRECTIVE : undefined,
    });

    // Pediu áudio: responde com uma nota de voz (TTS), sem picotar.
    if (wantsAudio) {
      const voiced = await ensureCharacterVoice(character);
      const audioUrl = (await generateSpeech(voiced, replyText, { mood: voiced.mood?.label })) ?? undefined;
      if (audioUrl) {
        const voiceMsg: Message = {
          id: randomUUID(),
          conversationId: conversation.id,
          role: 'character',
          senderId: character.id,
          senderName: character.name,
          text: replyText,
          audioUrl,
          createdAt: new Date().toISOString(),
        };
        addMessage(voiceMsg);
        touchProactive(conversation.id);
        res.json({ userMessage, replies: [voiceMsg], status: getConversationStatus(conversation.id) });
        return;
      }
      // TTS indisponível/falhou: cai para texto normal abaixo.
    }

    // Picota conforme o estilo do personagem (sem atraso no modo imediato).
    const parts = splitMessages(replyText, character.splitStyle ?? DEFAULT_SPLIT_STYLE);
    const startMs = Date.now();
    const replies: Message[] = parts.map((text, i) => ({
      id: randomUUID(),
      conversationId: conversation.id,
      role: 'character',
      senderId: character.id,
      senderName: character.name,
      text,
      createdAt: new Date(startMs + i).toISOString(),
    }));
    replies.forEach(addMessage);
    touchProactive(conversation.id);

    res.json({
      userMessage,
      replies,
      status: getConversationStatus(conversation.id),
    });

    // A conversa desloca o humor e a intimidade (best-effort, após responder).
    void recordConversationImpact(conversation, character, getMessages(conversation.id)).catch(
      () => {},
    );
  } catch (err) {
    console.error('[talky] erro ao responder mensagem:', err);
    res.status(500).json({ error: messageOf(err) });
  }
});

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : 'Erro inesperado.';
}

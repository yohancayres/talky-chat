import { Character, ChatStatus, Conversation, ConversationSummary, Message } from './types';

// Em emulador iOS / web, localhost funciona. Em um celular físico, troque por
// http://SEU_IP_LOCAL:3000 definindo EXPO_PUBLIC_API_URL antes de rodar o app.
const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

// Provedor do token de sessão (Clerk). Definido no App via setAuthTokenGetter
// assim que o usuário está autenticado; toda requisição manda Authorization.
let authTokenGetter: (() => Promise<string | null>) | null = null;
export function setAuthTokenGetter(fn: (() => Promise<string | null>) | null): void {
  authTokenGetter = fn;
}

// timeoutMs <= 0 desliga o timeout — usado em operações longas (ex: gerar
// personagem + foto de perfil, que pode levar mais de um minuto).
async function request<T>(path: string, init?: RequestInit, timeoutMs = 30_000): Promise<T> {
  const controller = new AbortController();
  const timer = timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const token = authTokenGetter ? await authTokenGetter() : null;
    const res = await fetch(`${BASE_URL}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init?.headers ?? {}),
      },
    });
    if (!res.ok) {
      let detail = `Erro ${res.status}`;
      try {
        const body = (await res.json()) as { error?: string };
        if (body?.error) detail = body.error;
      } catch {
        // resposta sem corpo JSON
      }
      throw new Error(detail);
    }
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Tempo esgotado. Verifique se o backend está rodando.');
    }
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface GenerateResponse {
  conversation: Conversation;
  character: Character;
  messages: Message[];
  /** true = o usuário "encontrou" um personagem já existente no pool global. */
  existing?: boolean;
}

export interface ConversationResponse {
  conversation: Conversation;
  characters: Character[];
  messages: Message[];
  status: ChatStatus;
}

export interface SendMessageResponse {
  userMessage: Message;
  replies: Message[];
  status: ChatStatus;
}

export interface MessagesResponse {
  messages: Message[];
  status: ChatStatus;
}

export const api = {
  baseUrl: BASE_URL,

  generateCharacter(hint: string, userName: string, userId: string): Promise<GenerateResponse> {
    // Sem timeout: criar o personagem pode demorar (gera texto + foto de perfil).
    return request<GenerateResponse>(
      '/api/characters/generate',
      {
        method: 'POST',
        body: JSON.stringify({ hint, userName, userId }),
      },
      0,
    );
  },

  getConversation(id: string): Promise<ConversationResponse> {
    return request<ConversationResponse>(`/api/conversations/${id}`);
  },

  // Lista as conversas do usuário (tela de conversas).
  getConversations(userId: string): Promise<{ conversations: ConversationSummary[] }> {
    return request<{ conversations: ConversationSummary[] }>(
      `/api/users/${userId}/conversations`,
    );
  },

  // Marca uma conversa como lida.
  markRead(conversationId: string): Promise<{ ok: boolean }> {
    return request<{ ok: boolean }>(`/api/conversations/${conversationId}/read`, {
      method: 'POST',
    });
  },

  // Exclui a conversa (o personagem permanece no AmyChat; só some o histórico).
  deleteConversation(conversationId: string): Promise<{ ok: boolean }> {
    return request<{ ok: boolean }>(`/api/conversations/${conversationId}`, {
      method: 'DELETE',
    });
  },

  // Migra para a conta autenticada (token) as conversas anônimas deste device.
  // O dono novo vem do token no backend; aqui só passamos as referências antigas.
  claimAnonymous(deviceId?: string, legacyConversationId?: string): Promise<{ claimed: number }> {
    return request<{ claimed: number }>(`/api/claim-anonymous`, {
      method: 'POST',
      body: JSON.stringify({ deviceId, legacyConversationId }),
    });
  },

  sendMessage(
    conversationId: string,
    text: string,
    userName: string,
    attach?: {
      image?: { data: string; mediaType: string };
      audio?: { data: string; mediaType: string; durationMs?: number };
    },
  ): Promise<SendMessageResponse> {
    return request<SendMessageResponse>(
      `/api/conversations/${conversationId}/messages`,
      {
        method: 'POST',
        body: JSON.stringify({ text, userName, image: attach?.image, audio: attach?.audio }),
      },
      // Foto/áudio incluem visão/transcrição no servidor: mais tempo.
      attach?.image || attach?.audio ? 60_000 : 30_000,
    );
  },

  // Busca mensagens criadas depois de `afterIso` (mensagens proativas e respostas).
  getNewMessages(conversationId: string, afterIso: string): Promise<MessagesResponse> {
    const query = afterIso ? `?after=${encodeURIComponent(afterIso)}` : '';
    return request<MessagesResponse>(
      `/api/conversations/${conversationId}/messages${query}`,
    );
  },

  // Registra o token de push para receber mensagens proativas com o app fechado.
  registerPushToken(conversationId: string, token: string): Promise<{ ok: boolean }> {
    return request<{ ok: boolean }>(`/api/conversations/${conversationId}/push-token`, {
      method: 'POST',
      body: JSON.stringify({ token }),
    });
  },

  // Dispara a geração da foto (roda em segundo plano; retorna na hora). A foto
  // nova chega via polling (status.photoUrl / status.avatarGenerating).
  regenerateAvatar(characterId: string): Promise<{ status: string }> {
    return request<{ status: string }>(`/api/characters/${characterId}/avatar`, {
      method: 'POST',
    });
  },

  // Define o status do usuário (string vazia = disponível/limpar).
  setUserStatus(conversationId: string, status: string): Promise<{ ok: boolean }> {
    return request<{ ok: boolean }>(`/api/conversations/${conversationId}/user-status`, {
      method: 'POST',
      body: JSON.stringify({ status }),
    });
  },
};

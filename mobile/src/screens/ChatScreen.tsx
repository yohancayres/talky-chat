import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AppState,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { api } from '../api';
import { Avatar } from '../components/Avatar';
import { CharacterProfileModal } from '../components/CharacterProfileModal';
import { MessageBubble } from '../components/MessageBubble';
import { TypingIndicator } from '../components/TypingIndicator';
import { colors, radius } from '../theme';
import { Character, ChatStatus, Message } from '../types';

const USER_STATUS_OPTIONS = [
  'Disponível',
  'No trabalho',
  'Em reunião',
  'Vendo um filme',
  'Ocupado',
  'Ausente',
];

function characterStatusLabel(status: ChatStatus | null, character: Character): string {
  if (!status) return character.occupation || 'toque para ver o perfil';
  if (status.typing) return 'digitando...';
  if (status.state === 'sleeping') return `${status.activity || 'dormindo'} 💤`;
  if (status.state === 'online') return 'online';
  return status.activity || 'ocupado'; // busy → mostra a atividade (ex: "em reunião")
}

export function ChatScreen({
  conversationId,
  character,
  initialMessages,
  userName,
  initialStatus,
  initialUserStatus,
  onReset,
}: {
  conversationId: string;
  character: Character;
  initialMessages: Message[];
  userName: string;
  initialStatus?: ChatStatus | null;
  initialUserStatus?: string;
  onReset: () => void;
}) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [status, setStatus] = useState<ChatStatus | null>(initialStatus ?? null);
  const [userStatus, setUserStatus] = useState<string>(initialUserStatus ?? '');
  const listRef = useRef<FlatList<Message>>(null);

  const lastSyncRef = useRef<string>(
    initialMessages.length ? initialMessages[initialMessages.length - 1].createdAt : '',
  );

  const scrollToEnd = useCallback(() => {
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
  }, []);

  const mergeIncoming = useCallback((incoming: Message[]) => {
    if (incoming.length === 0) return;
    setMessages((prev) => {
      const seen = new Set(prev.map((m) => m.id));
      const merged = [...prev];
      for (const m of incoming) {
        if (!seen.has(m.id)) merged.push(m);
      }
      merged.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      return merged;
    });
    for (const m of incoming) {
      if (m.createdAt > lastSyncRef.current) lastSyncRef.current = m.createdAt;
    }
  }, []);

  // Polling: recebe respostas (com atraso), mensagens proativas e o status atual.
  useEffect(() => {
    let active = true;

    async function poll() {
      try {
        const res = await api.getNewMessages(conversationId, lastSyncRef.current);
        if (!active) return;
        setStatus(res.status);
        if (res.messages.length > 0) {
          mergeIncoming(res.messages);
          scrollToEnd();
        }
      } catch {
        // silencioso: tenta de novo no próximo ciclo
      }
    }

    poll();
    const interval = setInterval(poll, 5000);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') poll();
    });

    return () => {
      active = false;
      clearInterval(interval);
      subscription.remove();
    };
  }, [conversationId, mergeIncoming, scrollToEnd]);

  async function handleSend() {
    const text = draft.trim();
    if (!text || sending) return;

    setDraft('');
    const optimistic: Message = {
      id: `local-${Date.now()}`,
      conversationId,
      role: 'user',
      senderId: 'user',
      senderName: userName || 'Você',
      text,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);
    setSending(true);
    scrollToEnd();

    try {
      const res = await api.sendMessage(conversationId, text, userName);
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
      mergeIncoming([res.userMessage, ...res.replies]);
      setStatus(res.status);
    } catch (e) {
      const errorText = e instanceof Error ? e.message : 'Falha ao enviar.';
      const systemMsg: Message = {
        id: `error-${Date.now()}`,
        conversationId,
        role: 'character',
        senderId: character.id,
        senderName: character.name,
        text: `(não consegui enviar agora: ${errorText})`,
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, systemMsg]);
    } finally {
      setSending(false);
      scrollToEnd();
    }
  }

  async function selectUserStatus(label: string) {
    const value = label === 'Disponível' ? '' : label;
    setUserStatus(value);
    try {
      await api.setUserStatus(conversationId, value);
    } catch {
      // mantém o valor local mesmo se a rede falhar
    }
  }

  const isTyping = status?.typing ?? false;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Pressable style={styles.header} onPress={() => setProfileOpen(true)}>
        <View style={styles.headerAvatar}>
          <Avatar character={character} size={40} />
        </View>
        <View style={styles.headerInfo}>
          <Text style={styles.headerName}>{character.name}</Text>
          <Text
            style={[styles.headerSubtitle, isTyping && styles.headerTyping]}
            numberOfLines={1}
          >
            {characterStatusLabel(status, character)}
          </Text>
        </View>
      </Pressable>

      <View style={styles.userStatusBar}>
        <Text style={styles.userStatusLabel}>Seu status:</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {USER_STATUS_OPTIONS.map((label) => {
            const value = label === 'Disponível' ? '' : label;
            const selected = userStatus === value;
            return (
              <Pressable
                key={label}
                style={[styles.statusChip, selected && styles.statusChipActive]}
                onPress={() => selectUserStatus(label)}
              >
                <Text style={[styles.statusChipText, selected && styles.statusChipTextActive]}>
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <MessageBubble message={item} character={character} />}
        contentContainerStyle={styles.listContent}
        onContentSizeChange={scrollToEnd}
        ListFooterComponent={
          isTyping ? <TypingIndicator character={character} /> : null
        }
      />

      <View style={styles.inputBar}>
        <TextInput
          style={styles.input}
          placeholder={`Mensagem para ${character.name}...`}
          placeholderTextColor={colors.muted}
          value={draft}
          onChangeText={setDraft}
          multiline
        />
        <Pressable
          style={[styles.sendButton, (!draft.trim() || sending) && styles.sendButtonDisabled]}
          onPress={handleSend}
          disabled={!draft.trim() || sending}
        >
          <Text style={styles.sendIcon}>➤</Text>
        </Pressable>
      </View>

      <CharacterProfileModal
        visible={profileOpen}
        character={character}
        onClose={() => setProfileOpen(false)}
        onReset={() => {
          setProfileOpen(false);
          onReset();
        }}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 52,
    paddingBottom: 12,
    paddingHorizontal: 16,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerAvatar: { marginRight: 12 },
  headerInfo: { flex: 1 },
  headerName: { fontSize: 17, fontWeight: '700', color: colors.text },
  headerSubtitle: { fontSize: 13, color: colors.muted, marginTop: 1 },
  headerTyping: { color: colors.accent, fontStyle: 'italic' },
  userStatusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingLeft: 12,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  userStatusLabel: { fontSize: 12, color: colors.muted, marginRight: 8 },
  statusChip: {
    paddingVertical: 5,
    paddingHorizontal: 12,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
    marginRight: 8,
  },
  statusChipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  statusChipText: { fontSize: 13, color: colors.text },
  statusChipTextActive: { color: '#FFFFFF', fontWeight: '600' },
  listContent: { paddingVertical: 12 },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    paddingVertical: 10,
    paddingBottom: Platform.OS === 'ios' ? 28 : 12,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  input: {
    flex: 1,
    maxHeight: 120,
    backgroundColor: colors.bg,
    borderRadius: radius.lg,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
    fontSize: 16,
    color: colors.text,
    marginRight: 10,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: { backgroundColor: colors.muted },
  sendIcon: { color: '#FFFFFF', fontSize: 18, marginLeft: 2 },
});

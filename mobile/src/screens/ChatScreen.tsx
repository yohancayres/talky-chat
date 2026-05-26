import React, { useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { api } from '../api';
import { CharacterProfileModal } from '../components/CharacterProfileModal';
import { MessageBubble } from '../components/MessageBubble';
import { TypingIndicator } from '../components/TypingIndicator';
import { colors, radius } from '../theme';
import { Character, Message } from '../types';

export function ChatScreen({
  conversationId,
  character,
  initialMessages,
  userName,
  onReset,
}: {
  conversationId: string;
  character: Character;
  initialMessages: Message[];
  userName: string;
  onReset: () => void;
}) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const listRef = useRef<FlatList<Message>>(null);

  function scrollToEnd() {
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
  }

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
      setMessages((prev) => {
        const withoutOptimistic = prev.filter((m) => m.id !== optimistic.id);
        return [...withoutOptimistic, res.userMessage, ...res.replies];
      });
    } catch (e) {
      const errorText = e instanceof Error ? e.message : 'Falha ao enviar.';
      const systemMsg: Message = {
        id: `error-${Date.now()}`,
        conversationId,
        role: 'character',
        senderId: character.id,
        senderName: character.name,
        text: `(não consegui responder agora: ${errorText})`,
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, systemMsg]);
    } finally {
      setSending(false);
      scrollToEnd();
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Pressable style={styles.header} onPress={() => setProfileOpen(true)}>
        <View style={[styles.headerAvatar, { backgroundColor: character.avatar.color }]}>
          <Text style={styles.headerEmoji}>{character.avatar.emoji}</Text>
        </View>
        <View style={styles.headerInfo}>
          <Text style={styles.headerName}>{character.name}</Text>
          <Text style={styles.headerSubtitle} numberOfLines={1}>
            {sending ? 'digitando...' : character.occupation || 'toque para ver o perfil'}
          </Text>
        </View>
      </Pressable>

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <MessageBubble message={item} character={character} />}
        contentContainerStyle={styles.listContent}
        onContentSizeChange={scrollToEnd}
        ListFooterComponent={
          sending ? (
            <TypingIndicator emoji={character.avatar.emoji} color={character.avatar.color} />
          ) : null
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
  headerAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  headerEmoji: { fontSize: 22 },
  headerInfo: { flex: 1 },
  headerName: { fontSize: 17, fontWeight: '700', color: colors.text },
  headerSubtitle: { fontSize: 13, color: colors.muted, marginTop: 1 },
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

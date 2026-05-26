import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { api, GenerateResponse } from './src/api';
import { registerForPushToken } from './src/push';
import { ChatScreen } from './src/screens/ChatScreen';
import { ConversationListScreen } from './src/screens/ConversationListScreen';
import { OnboardingScreen } from './src/screens/OnboardingScreen';
import { colors } from './src/theme';
import { Character, ChatStatus, Message } from './src/types';
import { uuid } from './src/uuid';

// Registra o token de push no backend (best-effort, não bloqueia a UI).
async function syncPushToken(conversationId: string) {
  try {
    const token = await registerForPushToken();
    if (token) await api.registerPushToken(conversationId, token);
  } catch {
    // sem push: o app continua funcionando com polling em primeiro plano
  }
}

const STORAGE_USERID = 'talky.userId';
const STORAGE_USERNAME = 'talky.userName';
const STORAGE_CONVERSATION = 'talky.conversationId'; // legado (chat único)

async function getOrCreateUserId(): Promise<string> {
  let id = await AsyncStorage.getItem(STORAGE_USERID);
  if (!id) {
    id = uuid();
    await AsyncStorage.setItem(STORAGE_USERID, id);
  }
  return id;
}

type Screen =
  | { kind: 'booting' }
  | { kind: 'onboarding' }
  | { kind: 'newContact' }
  | { kind: 'list' }
  | { kind: 'error'; message: string }
  | {
      kind: 'chat';
      conversationId: string;
      character: Character;
      messages: Message[];
      status?: ChatStatus | null;
      userStatus?: string;
    };

export default function App() {
  const [screen, setScreen] = useState<Screen>({ kind: 'booting' });
  const [userId, setUserId] = useState<string>('');
  const [userName, setUserName] = useState<string>('');

  const boot = useCallback(async () => {
    setScreen({ kind: 'booting' });
    try {
      const uid = await getOrCreateUserId();
      setUserId(uid);
      const name = (await AsyncStorage.getItem(STORAGE_USERNAME)) ?? '';
      setUserName(name);

      // Migração: associa o chat único antigo a este usuário.
      const legacyConv = await AsyncStorage.getItem(STORAGE_CONVERSATION);
      if (legacyConv) {
        try {
          await api.claimConversation(legacyConv, uid);
        } catch {
          // ignora; segue para a listagem
        }
        await AsyncStorage.removeItem(STORAGE_CONVERSATION);
      }

      const res = await api.getConversations(uid);
      setScreen({ kind: res.conversations.length === 0 ? 'onboarding' : 'list' });
    } catch (e) {
      setScreen({
        kind: 'error',
        message: e instanceof Error ? e.message : 'Não foi possível conectar ao servidor.',
      });
    }
  }, []);

  useEffect(() => {
    boot();
  }, [boot]);

  const openConversation = useCallback(async (conversationId: string) => {
    setScreen({ kind: 'booting' });
    try {
      const data = await api.getConversation(conversationId);
      const character = data.characters[0];
      if (!character) {
        setScreen({ kind: 'list' });
        return;
      }
      api.markRead(conversationId).catch(() => {});
      setScreen({
        kind: 'chat',
        conversationId,
        character,
        messages: data.messages,
        status: data.status,
        userStatus: data.conversation.userStatus,
      });
      void syncPushToken(conversationId);
    } catch (e) {
      setScreen({
        kind: 'error',
        message: e instanceof Error ? e.message : 'Não foi possível abrir a conversa.',
      });
    }
  }, []);

  const handleCreated = useCallback(async (result: GenerateResponse, name: string) => {
    if (name) {
      await AsyncStorage.setItem(STORAGE_USERNAME, name);
      setUserName(name);
    }
    api.markRead(result.conversation.id).catch(() => {});
    setScreen({
      kind: 'chat',
      conversationId: result.conversation.id,
      character: result.character,
      messages: result.messages,
    });
    void syncPushToken(result.conversation.id);
  }, []);

  const handleReset = useCallback(async () => {
    await AsyncStorage.multiRemove([STORAGE_USERID, STORAGE_USERNAME, STORAGE_CONVERSATION]);
    boot();
  }, [boot]);

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />
      {screen.kind === 'booting' && (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      )}

      {screen.kind === 'onboarding' && userId !== '' && (
        <OnboardingScreen userId={userId} onCreated={handleCreated} />
      )}

      {screen.kind === 'newContact' && userId !== '' && (
        <OnboardingScreen
          userId={userId}
          existingUserName={userName}
          onCreated={handleCreated}
          onCancel={() => setScreen({ kind: 'list' })}
        />
      )}

      {screen.kind === 'list' && userId !== '' && (
        <ConversationListScreen
          userId={userId}
          onOpen={openConversation}
          onNewContact={() => setScreen({ kind: 'newContact' })}
        />
      )}

      {screen.kind === 'chat' && (
        <ChatScreen
          conversationId={screen.conversationId}
          character={screen.character}
          initialMessages={screen.messages}
          userName={userName}
          initialStatus={screen.status}
          initialUserStatus={screen.userStatus}
          onBack={() => setScreen({ kind: 'list' })}
          onReset={handleReset}
        />
      )}

      {screen.kind === 'error' && (
        <View style={styles.center}>
          <Text style={styles.errorTitle}>Sem conexão com o Talky</Text>
          <Text style={styles.errorText}>{screen.message}</Text>
          <Text style={styles.errorHint}>
            Confira se o backend está rodando e se EXPO_PUBLIC_API_URL aponta para ele.
          </Text>
          <Pressable style={styles.retry} onPress={boot}>
            <Text style={styles.retryText}>Tentar novamente</Text>
          </Pressable>
          <Pressable onPress={handleReset}>
            <Text style={styles.resetLink}>Começar do zero</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  errorTitle: { fontSize: 20, fontWeight: '700', color: colors.text, marginBottom: 10 },
  errorText: { fontSize: 15, color: colors.danger, textAlign: 'center', marginBottom: 12 },
  errorHint: { fontSize: 14, color: colors.muted, textAlign: 'center', marginBottom: 24 },
  retry: {
    backgroundColor: colors.accent,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 32,
    marginBottom: 16,
  },
  retryText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  resetLink: { color: colors.muted, fontSize: 14, textDecorationLine: 'underline' },
});

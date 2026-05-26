import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { api, GenerateResponse } from './src/api';
import { registerForPushToken } from './src/push';
import { ChatScreen } from './src/screens/ChatScreen';
import { OnboardingScreen } from './src/screens/OnboardingScreen';
import { colors } from './src/theme';
import { Character, Message } from './src/types';

// Registra o token de push no backend (best-effort, não bloqueia a UI).
async function syncPushToken(conversationId: string) {
  try {
    const token = await registerForPushToken();
    if (token) await api.registerPushToken(conversationId, token);
  } catch {
    // sem push: o app continua funcionando com polling em primeiro plano
  }
}

const STORAGE_CONVERSATION = 'talky.conversationId';
const STORAGE_USERNAME = 'talky.userName';

type Screen =
  | { kind: 'booting' }
  | { kind: 'onboarding' }
  | { kind: 'error'; message: string }
  | { kind: 'chat'; conversationId: string; character: Character; messages: Message[]; userName: string };

export default function App() {
  const [screen, setScreen] = useState<Screen>({ kind: 'booting' });

  const boot = useCallback(async () => {
    setScreen({ kind: 'booting' });
    try {
      const conversationId = await AsyncStorage.getItem(STORAGE_CONVERSATION);
      const userName = (await AsyncStorage.getItem(STORAGE_USERNAME)) ?? '';
      if (!conversationId) {
        setScreen({ kind: 'onboarding' });
        return;
      }
      const data = await api.getConversation(conversationId);
      const character = data.characters[0];
      if (!character) {
        await clearStorage();
        setScreen({ kind: 'onboarding' });
        return;
      }
      setScreen({
        kind: 'chat',
        conversationId,
        character,
        messages: data.messages,
        userName,
      });
      void syncPushToken(conversationId);
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

  async function clearStorage() {
    await AsyncStorage.multiRemove([STORAGE_CONVERSATION, STORAGE_USERNAME]);
  }

  const handleCreated = useCallback(async (result: GenerateResponse, userName: string) => {
    await AsyncStorage.setItem(STORAGE_CONVERSATION, result.conversation.id);
    await AsyncStorage.setItem(STORAGE_USERNAME, userName);
    setScreen({
      kind: 'chat',
      conversationId: result.conversation.id,
      character: result.character,
      messages: result.messages,
      userName,
    });
    void syncPushToken(result.conversation.id);
  }, []);

  const handleReset = useCallback(async () => {
    await clearStorage();
    setScreen({ kind: 'onboarding' });
  }, []);

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />
      {screen.kind === 'booting' && (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      )}

      {screen.kind === 'onboarding' && <OnboardingScreen onCreated={handleCreated} />}

      {screen.kind === 'chat' && (
        <ChatScreen
          conversationId={screen.conversationId}
          character={screen.character}
          initialMessages={screen.messages}
          userName={screen.userName}
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

import { ClerkProvider, useAuth } from '@clerk/clerk-expo';
import { tokenCache } from '@clerk/clerk-expo/token-cache';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { api, GenerateResponse, setAuthTokenGetter } from './src/api';
import { registerForPushToken } from './src/push';
import { AuthScreen } from './src/screens/AuthScreen';
import { ChatScreen } from './src/screens/ChatScreen';
import { ConversationListScreen } from './src/screens/ConversationListScreen';
import { OnboardingScreen } from './src/screens/OnboardingScreen';
import { colors } from './src/theme';
import { Character, ChatStatus, Message } from './src/types';
import { uuid } from './src/uuid';

const CLERK_PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? '';

// Registra o token de push no backend (best-effort, não bloqueia a UI).
async function syncPushToken(conversationId: string) {
  try {
    const token = await registerForPushToken();
    if (token) await api.registerPushToken(conversationId, token);
  } catch {
    // sem push: o app continua funcionando com polling em primeiro plano
  }
}

// Id anônimo antigo do dispositivo: hoje só serve para migrar (reivindicar) as
// conversas criadas antes do login para a conta autenticada do Clerk.
const STORAGE_DEVICEID = 'talky.userId';
const STORAGE_USERNAME = 'talky.userName';
const STORAGE_CONVERSATION = 'talky.conversationId'; // legado (chat único)
const STORAGE_MIGRATED = 'talky.migratedTo'; // guarda o userId p/ migrar só uma vez

async function getDeviceId(): Promise<string | null> {
  return AsyncStorage.getItem(STORAGE_DEVICEID);
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

function AuthedApp({ userId, onSignOut }: { userId: string; onSignOut: () => void }) {
  const [screen, setScreen] = useState<Screen>({ kind: 'booting' });
  const [userName, setUserName] = useState<string>('');

  const boot = useCallback(async () => {
    setScreen({ kind: 'booting' });
    try {
      const name = (await AsyncStorage.getItem(STORAGE_USERNAME)) ?? '';
      setUserName(name);

      // Migração única: reivindica para esta conta as conversas criadas antes do
      // login (chat anônimo do device + chat único legado). Roda só uma vez/conta.
      const migrated = await AsyncStorage.getItem(STORAGE_MIGRATED);
      if (migrated !== userId) {
        const deviceId = await getDeviceId();
        const legacyConv = await AsyncStorage.getItem(STORAGE_CONVERSATION);
        try {
          await api.claimAnonymous(deviceId ?? undefined, legacyConv ?? undefined);
        } catch {
          // best-effort: se falhar, não trava o login
        }
        await AsyncStorage.setItem(STORAGE_MIGRATED, userId);
        await AsyncStorage.removeItem(STORAGE_CONVERSATION);
      }

      const res = await api.getConversations(userId);
      setScreen({ kind: res.conversations.length === 0 ? 'onboarding' : 'list' });
    } catch (e) {
      setScreen({
        kind: 'error',
        message: e instanceof Error ? e.message : 'Não foi possível conectar ao servidor.',
      });
    }
  }, [userId]);

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
    await AsyncStorage.multiRemove([STORAGE_USERNAME, STORAGE_CONVERSATION, STORAGE_MIGRATED]);
    setUserName('');
    onSignOut();
  }, [onSignOut]);

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

      {/* A lista fica montada atrás do chat: voltar não recarrega (sem refresh)
          e o swipe revela a lista de verdade (transição fluida). */}
      {(screen.kind === 'list' || screen.kind === 'chat') && userId !== '' && (
        <ConversationListScreen
          userId={userId}
          onOpen={openConversation}
          onNewContact={() => setScreen({ kind: 'newContact' })}
        />
      )}

      {screen.kind === 'chat' && (
        <View style={[StyleSheet.absoluteFill, styles.chatOverlay]}>
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
        </View>
      )}

      {screen.kind === 'error' && (
        <View style={styles.center}>
          <Text style={styles.errorTitle}>Sem conexão com o AmyChat</Text>
          <Text style={styles.errorText}>{screen.message}</Text>
          <Text style={styles.errorHint}>
            Confira se o backend está rodando e se EXPO_PUBLIC_API_URL aponta para ele.
          </Text>
          <Pressable style={styles.retry} onPress={boot}>
            <Text style={styles.retryText}>Tentar novamente</Text>
          </Pressable>
          <Pressable onPress={handleReset}>
            <Text style={styles.resetLink}>Sair da conta</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

// Decide entre tela de login e app autenticado, e conecta o token de sessão do
// Clerk ao cliente HTTP (toda requisição passa a mandar Authorization: Bearer).
function Root() {
  const { isLoaded, isSignedIn, userId, getToken, signOut } = useAuth();

  useEffect(() => {
    setAuthTokenGetter(isSignedIn ? () => getToken() : null);
    return () => setAuthTokenGetter(null);
  }, [isSignedIn, getToken]);

  if (!isLoaded) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }
  if (!isSignedIn || !userId) return <AuthScreen />;
  return <AuthedApp userId={userId} onSignOut={() => signOut()} />;
}

export default function App() {
  if (!CLERK_PUBLISHABLE_KEY) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorTitle}>Configuração ausente</Text>
        <Text style={styles.errorText}>
          Defina EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY (.env / eas.json) e reinicie com `expo start -c`.
        </Text>
      </View>
    );
  }
  return (
    <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY} tokenCache={tokenCache}>
      <SafeAreaProvider>
        <KeyboardProvider>
          <StatusBar style="dark" />
          <Root />
        </KeyboardProvider>
      </SafeAreaProvider>
    </ClerkProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  // O chat fica por cima da lista (que segue montada atrás). elevation/zIndex
  // altos resolvem o stacking do Android (o header da lista "furava" por cima).
  // SEM backgroundColor aqui: o conteúdo do chat (Animated.View) já é opaco e é
  // ele que desliza no swipe — um fundo opaco no overlay parado tampava a lista
  // (revelava branco em vez de revelar a lista atrás, no swipe-back do iOS).
  chatOverlay: { elevation: 12, zIndex: 10 },
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

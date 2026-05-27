import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { api, GenerateResponse } from '../api';
import { haptics } from '../haptics';
import { colors, radius } from '../theme';

const LOADING_LINES = [
  'Inventando uma pessoa...',
  'Escrevendo a história de vida...',
  'Definindo a personalidade...',
  'Preparando a primeira mensagem...',
];

// Tela de carregamento com barra de progresso animada e texto em crossfade.
function CreatingView({ lineIndex }: { lineIndex: number }) {
  const fade = useRef(new Animated.Value(0)).current;
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    fade.setValue(0);
    Animated.timing(fade, { toValue: 1, duration: 400, useNativeDriver: true }).start();
  }, [lineIndex, fade]);

  useEffect(() => {
    // Avança a barra por etapas, mas nunca chega a 100% (só ao concluir de fato).
    const target = Math.min(0.9, (lineIndex + 1) / (LOADING_LINES.length + 1));
    Animated.timing(progress, {
      toValue: target,
      duration: 2000,
      useNativeDriver: false,
    }).start();
  }, [lineIndex, progress]);

  const width = progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });

  return (
    <View style={styles.loadingContainer}>
      <Text style={styles.logoEmoji}>💬</Text>
      <View style={styles.progressTrack}>
        <Animated.View style={[styles.progressFill, { width }]} />
      </View>
      <Animated.Text style={[styles.loadingText, { opacity: fade }]}>
        {LOADING_LINES[lineIndex]}
      </Animated.Text>
    </View>
  );
}

export function OnboardingScreen({
  userId,
  existingUserName,
  onCreated,
  onCancel,
}: {
  userId: string;
  // Quando fornecido, é um "novo contato": não pergunta o nome de novo.
  existingUserName?: string;
  onCreated: (result: GenerateResponse, userName: string) => void;
  onCancel?: () => void;
}) {
  const isNewContact = Boolean(existingUserName);
  const [name, setName] = useState(existingUserName ?? '');
  const [hint, setHint] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lineIndex, setLineIndex] = useState(0);

  async function handleCreate() {
    haptics.medium();
    setError(null);
    setLoading(true);

    const timer = setInterval(() => {
      setLineIndex((i) => (i + 1) % LOADING_LINES.length);
    }, 2200);

    try {
      const result = await api.generateCharacter(hint.trim(), name.trim(), userId);
      haptics.success();
      onCreated(result, name.trim());
    } catch (e) {
      haptics.error();
      setError(e instanceof Error ? e.message : 'Não foi possível criar o personagem.');
    } finally {
      clearInterval(timer);
      setLoading(false);
    }
  }

  if (loading) {
    return <CreatingView lineIndex={lineIndex} />;
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.logoEmoji}>💬</Text>
        <Text style={styles.title}>{isNewContact ? 'Novo contato' : 'AmyChat'}</Text>
        <Text style={styles.tagline}>
          {isNewContact
            ? 'Conheça mais alguém no AmyChat — um novo personagem ou alguém que já existe por aqui.'
            : 'Um amigo de IA com história, rotina e vida própria. Você pode criar um novo personagem ou esbarrar com alguém que já existe no AmyChat.'}
        </Text>

        {!isNewContact && (
          <View style={styles.field}>
            <Text style={styles.label}>Como você quer ser chamado?</Text>
            <TextInput
              style={styles.input}
              placeholder="Seu nome ou apelido"
              placeholderTextColor={colors.muted}
              value={name}
              onChangeText={setName}
              returnKeyType="next"
            />
          </View>
        )}

        <View style={styles.field}>
          <Text style={styles.label}>Que tipo de personagem? (opcional)</Text>
          <TextInput
            style={[styles.input, styles.inputMultiline]}
            placeholder="ex: alguém divertido que ama música e mora na praia"
            placeholderTextColor={colors.muted}
            value={hint}
            onChangeText={setHint}
            multiline
          />
          <Text style={styles.help}>
            Deixe em branco para conhecer alguém (novo ou já existente no AmyChat).
          </Text>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
          onPress={handleCreate}
        >
          <Text style={styles.buttonText}>
            {isNewContact ? 'Conhecer contato' : 'Conhecer meu personagem'}
          </Text>
        </Pressable>

        {onCancel && (
          <Pressable style={styles.cancel} onPress={onCancel}>
            <Text style={styles.cancelText}>Voltar</Text>
          </Pressable>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: 28, paddingTop: 96, flexGrow: 1 },
  loadingContainer: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  logoEmoji: { fontSize: 52, textAlign: 'center' },
  progressTrack: {
    width: 200,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.border,
    overflow: 'hidden',
    marginVertical: 28,
  },
  progressFill: { height: 6, borderRadius: 3, backgroundColor: colors.accent },
  title: {
    fontSize: 40,
    fontWeight: '800',
    color: colors.text,
    textAlign: 'center',
    marginTop: 8,
  },
  tagline: {
    fontSize: 16,
    color: colors.muted,
    textAlign: 'center',
    lineHeight: 23,
    marginTop: 12,
    marginBottom: 36,
  },
  field: { marginBottom: 22 },
  label: { fontSize: 15, fontWeight: '600', color: colors.text, marginBottom: 8 },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: colors.text,
  },
  inputMultiline: { minHeight: 80, textAlignVertical: 'top' },
  help: { fontSize: 13, color: colors.muted, marginTop: 6 },
  error: { color: colors.danger, fontSize: 14, marginBottom: 16, textAlign: 'center' },
  button: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonPressed: { backgroundColor: colors.accentDark },
  buttonText: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' },
  cancel: { marginTop: 18, alignItems: 'center' },
  cancelText: { color: colors.muted, fontSize: 15 },
  loadingText: { fontSize: 17, color: colors.text, textAlign: 'center' },
});

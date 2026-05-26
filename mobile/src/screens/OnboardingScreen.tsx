import React, { useState } from 'react';
import {
  ActivityIndicator,
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
import { colors, radius } from '../theme';

const LOADING_LINES = [
  'Inventando uma pessoa...',
  'Escrevendo a história de vida...',
  'Definindo a personalidade...',
  'Preparando a primeira mensagem...',
];

export function OnboardingScreen({
  onCreated,
}: {
  onCreated: (result: GenerateResponse, userName: string) => void;
}) {
  const [name, setName] = useState('');
  const [hint, setHint] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lineIndex, setLineIndex] = useState(0);

  async function handleCreate() {
    setError(null);
    setLoading(true);

    const timer = setInterval(() => {
      setLineIndex((i) => (i + 1) % LOADING_LINES.length);
    }, 2200);

    try {
      const result = await api.generateCharacter(hint.trim(), name.trim());
      onCreated(result, name.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível criar o personagem.');
    } finally {
      clearInterval(timer);
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.logoEmoji}>💬</Text>
        <ActivityIndicator size="large" color={colors.accent} style={{ marginVertical: 24 }} />
        <Text style={styles.loadingText}>{LOADING_LINES[lineIndex]}</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.logoEmoji}>💬</Text>
        <Text style={styles.title}>Talky</Text>
        <Text style={styles.tagline}>
          Um amigo de IA com história, rotina e vida própria. Você pode criar um
          novo personagem ou esbarrar com alguém que já existe no Talky.
        </Text>

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
            Deixe em branco para conhecer alguém (novo ou já existente no Talky).
          </Text>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
          onPress={handleCreate}
        >
          <Text style={styles.buttonText}>Conhecer meu personagem</Text>
        </Pressable>
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
  loadingText: { fontSize: 17, color: colors.text, textAlign: 'center' },
});

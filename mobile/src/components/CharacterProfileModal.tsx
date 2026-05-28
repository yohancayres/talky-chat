import React, { useEffect, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { setContactName, useContactNames } from '../contactNames';
import { colors, radius } from '../theme';
import { Character } from '../types';
import { Avatar } from './Avatar';

const TEMPERAMENT_LABELS: Record<string, string> = {
  ironia: 'Ironia',
  sarcasmo: 'Sarcasmo',
  passivo_agressivo: 'Passivo-agressivo',
  docura: 'Doçura',
  brutalidade: 'Brutalidade',
  implicancia: 'Implicância',
  sonhador: 'Sonhador',
  realismo: 'Realismo',
  ceticismo: 'Ceticismo',
  nerdice: 'Nerdice',
  humor: 'Humor',
  otimismo: 'Otimismo',
  paciencia: 'Paciência',
  formalidade: 'Formalidade',
  extroversao: 'Extroversão',
  carinho: 'Carinho',
  teimosia: 'Teimosia',
};

function Chips({ items }: { items: string[] }) {
  return (
    <View style={styles.chips}>
      {items.map((item, i) => (
        <View key={`${item}-${i}`} style={styles.chip}>
          <Text style={styles.chipText}>{item}</Text>
        </View>
      ))}
    </View>
  );
}

function TemperamentBars({ temperament }: { temperament: Record<string, number> }) {
  const rows = Object.entries(temperament)
    .filter(([key]) => TEMPERAMENT_LABELS[key])
    .sort((a, b) => b[1] - a[1]);
  return (
    <View>
      {rows.map(([key, value]) => (
        <View key={key} style={styles.barRow}>
          <Text style={styles.barLabel}>{TEMPERAMENT_LABELS[key]}</Text>
          <View style={styles.barTrack}>
            <View style={[styles.barFill, { width: `${Math.max(0, Math.min(10, value)) * 10}%` }]} />
          </View>
        </View>
      ))}
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

export function CharacterProfileModal({
  visible,
  character,
  mood,
  moodEmoji,
  regeneratingPhoto,
  onRegeneratePhoto,
  onClose,
  onReset,
}: {
  visible: boolean;
  character: Character | null;
  mood?: string;
  moodEmoji?: string;
  regeneratingPhoto?: boolean;
  onRegeneratePhoto?: () => void;
  onClose: () => void;
  onReset: () => void;
}) {
  const contactNames = useContactNames();
  const [nick, setNick] = useState('');
  // Sincroniza o campo com o apelido salvo ao abrir / trocar de personagem.
  useEffect(() => {
    setNick(character ? (contactNames[character.id] ?? '') : '');
  }, [character?.id, visible, contactNames]);

  if (!character) return null;

  const saveNick = () => {
    void setContactName(character.id, nick);
  };

  const photoLabel = regeneratingPhoto
    ? 'Gerando foto...'
    : character.photoUrl
      ? 'Trocar foto de perfil'
      : 'Gerar foto de perfil';

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={styles.close}>Fechar</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.body}>
          <View style={styles.avatar}>
            <Avatar character={character} size={88} />
          </View>
          <Text style={styles.name}>{character.name}, {character.age}</Text>
          <Text style={styles.subtitle}>
            {character.occupation}
            {character.location ? ` · ${character.location}` : ''}
          </Text>

          {/* Apelido local: só você vê. O nome real (acima) nunca muda. */}
          <View style={styles.nickBox}>
            <Text style={styles.nickLabel}>Nome do contato (só você vê)</Text>
            <View style={styles.nickRow}>
              <TextInput
                style={styles.nickInput}
                value={nick}
                onChangeText={setNick}
                onBlur={saveNick}
                onSubmitEditing={saveNick}
                placeholder={`Apelido para ${character.name.split(' ')[0]} (opcional)`}
                placeholderTextColor={colors.muted}
                returnKeyType="done"
                maxLength={40}
              />
              {nick.trim() ? (
                <Pressable
                  hitSlop={10}
                  onPress={() => {
                    setNick('');
                    void setContactName(character.id, '');
                  }}
                >
                  <Text style={styles.nickClear}>✕</Text>
                </Pressable>
              ) : null}
            </View>
          </View>

          {mood ? (
            <View style={styles.moodPill}>
              <Text style={styles.moodText}>
                {moodEmoji ? `${moodEmoji} ` : ''}Hoje está {mood}
              </Text>
            </View>
          ) : null}

          {onRegeneratePhoto && (
            <Pressable
              style={[styles.photoButton, regeneratingPhoto && styles.photoButtonDisabled]}
              onPress={onRegeneratePhoto}
              disabled={regeneratingPhoto}
            >
              <Text style={styles.photoButtonText}>{photoLabel}</Text>
            </Pressable>
          )}

          {character.personality.summary ? (
            <Text style={styles.summary}>{character.personality.summary}</Text>
          ) : null}

          {character.personality.traits.length > 0 && (
            <Section title="Personalidade">
              <Chips items={character.personality.traits} />
            </Section>
          )}

          {character.temperament && Object.keys(character.temperament).length > 0 && (
            <Section title="Temperamento">
              <TemperamentBars temperament={character.temperament} />
            </Section>
          )}

          {character.interests.length > 0 && (
            <Section title="Interesses">
              <Chips items={character.interests} />
            </Section>
          )}

          {character.backstory ? (
            <Section title="História">
              <Text style={styles.paragraph}>{character.backstory}</Text>
            </Section>
          ) : null}

          {character.routine ? (
            <Section title="Rotina">
              <Text style={styles.paragraph}>{character.routine}</Text>
            </Section>
          ) : null}

          {character.timeline.length > 0 && (
            <Section title="Linha do tempo">
              {character.timeline.map((event, i) => (
                <View key={`${event.title}-${i}`} style={styles.timelineItem}>
                  <Text style={styles.timelineAge}>{event.age}</Text>
                  <View style={styles.timelineContent}>
                    <Text style={styles.timelineTitle}>{event.title}</Text>
                    <Text style={styles.timelineDesc}>{event.description}</Text>
                  </View>
                </View>
              ))}
            </Section>
          )}

          <Pressable style={styles.resetButton} onPress={onReset}>
            <Text style={styles.resetText}>Recomeçar do zero (apagar tudo)</Text>
          </Pressable>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    paddingTop: 56,
    paddingHorizontal: 20,
    paddingBottom: 8,
    alignItems: 'flex-end',
  },
  close: { color: colors.accent, fontSize: 16, fontWeight: '600' },
  body: { paddingHorizontal: 20, paddingBottom: 48, alignItems: 'center' },
  avatar: { marginTop: 8 },
  name: { fontSize: 24, fontWeight: '700', color: colors.text, marginTop: 14 },
  subtitle: { fontSize: 15, color: colors.muted, marginTop: 4, textAlign: 'center' },
  nickBox: { alignSelf: 'stretch', marginTop: 18 },
  nickLabel: { fontSize: 12, color: colors.muted, marginBottom: 6, marginLeft: 4 },
  nickRow: { flexDirection: 'row', alignItems: 'center' },
  nickInput: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.text,
  },
  nickClear: { fontSize: 16, color: colors.muted, fontWeight: '700', paddingHorizontal: 12 },
  moodPill: {
    marginTop: 12,
    backgroundColor: colors.accentSoft,
    borderRadius: radius.lg,
    paddingVertical: 6,
    paddingHorizontal: 14,
  },
  moodText: { fontSize: 14, color: colors.accentDark, fontWeight: '600' },
  photoButton: {
    marginTop: 14,
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: 9,
    paddingHorizontal: 18,
  },
  photoButtonDisabled: { opacity: 0.5 },
  photoButtonText: { color: colors.accent, fontSize: 14, fontWeight: '600' },
  summary: {
    fontSize: 16,
    color: colors.text,
    lineHeight: 23,
    marginTop: 16,
    textAlign: 'center',
  },
  section: { alignSelf: 'stretch', marginTop: 24 },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  paragraph: { fontSize: 15, color: colors.text, lineHeight: 22 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  chipText: { color: colors.text, fontSize: 14 },
  barRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 9 },
  barLabel: { width: 130, fontSize: 13, color: colors.text },
  barTrack: {
    flex: 1,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.border,
    overflow: 'hidden',
  },
  barFill: { height: 8, borderRadius: 4, backgroundColor: colors.accent },
  timelineItem: { flexDirection: 'row', marginBottom: 14 },
  timelineAge: {
    width: 76,
    fontSize: 13,
    fontWeight: '700',
    color: colors.accent,
    paddingTop: 1,
  },
  timelineContent: { flex: 1 },
  timelineTitle: { fontSize: 15, fontWeight: '600', color: colors.text },
  timelineDesc: { fontSize: 14, color: colors.muted, lineHeight: 20, marginTop: 2 },
  resetButton: {
    marginTop: 36,
    alignSelf: 'stretch',
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: radius.md,
    paddingVertical: 14,
    alignItems: 'center',
  },
  resetText: { color: colors.danger, fontSize: 15, fontWeight: '600' },
});

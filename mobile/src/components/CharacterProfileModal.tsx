import React from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { colors, radius } from '../theme';
import { Character } from '../types';

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
  onClose,
  onReset,
}: {
  visible: boolean;
  character: Character | null;
  onClose: () => void;
  onReset: () => void;
}) {
  if (!character) return null;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={styles.close}>Fechar</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.body}>
          <View style={[styles.avatar, { backgroundColor: character.avatar.color }]}>
            <Text style={styles.avatarEmoji}>{character.avatar.emoji}</Text>
          </View>
          <Text style={styles.name}>{character.name}, {character.age}</Text>
          <Text style={styles.subtitle}>
            {character.occupation}
            {character.location ? ` · ${character.location}` : ''}
          </Text>

          {character.personality.summary ? (
            <Text style={styles.summary}>{character.personality.summary}</Text>
          ) : null}

          {character.personality.traits.length > 0 && (
            <Section title="Personalidade">
              <Chips items={character.personality.traits} />
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
            <Text style={styles.resetText}>Recomeçar com outro personagem</Text>
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
  avatar: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  avatarEmoji: { fontSize: 44 },
  name: { fontSize: 24, fontWeight: '700', color: colors.text, marginTop: 14 },
  subtitle: { fontSize: 15, color: colors.muted, marginTop: 4, textAlign: 'center' },
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

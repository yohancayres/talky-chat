import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme';
import { Character, Message } from '../types';
import { Avatar } from './Avatar';

export function MessageBubble({
  message,
  character,
}: {
  message: Message;
  character?: Character;
}) {
  if (message.role === 'user') {
    return (
      <View style={[styles.row, styles.rowEnd]}>
        <View style={[styles.bubble, styles.userBubble]}>
          <Text style={styles.userText}>{message.text}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.row, styles.rowStart]}>
      <View style={styles.avatarWrap}>
        {character ? (
          <Avatar character={character} size={34} />
        ) : (
          <View style={[styles.avatar, { backgroundColor: colors.accent }]}>
            <Text style={styles.avatarEmoji}>🙂</Text>
          </View>
        )}
      </View>
      <View style={[styles.bubble, styles.charBubble]}>
        <Text style={styles.charText}>{message.text}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    marginVertical: 4,
    paddingHorizontal: 12,
  },
  rowStart: { justifyContent: 'flex-start', alignItems: 'flex-end' },
  rowEnd: { justifyContent: 'flex-end' },
  avatarWrap: { marginRight: 8 },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarEmoji: { fontSize: 18 },
  bubble: {
    maxWidth: '78%',
    borderRadius: 18,
    paddingVertical: 9,
    paddingHorizontal: 13,
  },
  userBubble: {
    backgroundColor: colors.userBubble,
    borderBottomRightRadius: 6,
  },
  charBubble: {
    backgroundColor: colors.charBubble,
    borderBottomLeftRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
  },
  userText: { color: colors.userBubbleText, fontSize: 16, lineHeight: 22 },
  charText: { color: colors.charBubbleText, fontSize: 16, lineHeight: 22 },
});

import React, { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { api } from '../api';

type AvatarLike = { photoUrl?: string; avatar: { emoji: string; color: string } };

// Mostra a foto de perfil do personagem; se não houver (ou falhar), cai no emoji.
export function Avatar({ character, size }: { character: AvatarLike; size: number }) {
  const [failed, setFailed] = useState(false);
  const uri = character.photoUrl ? `${api.baseUrl}${character.photoUrl}` : null;
  const radius = size / 2;

  // Ao trocar a foto (URL nova), tenta carregar de novo.
  useEffect(() => setFailed(false), [uri]);

  if (uri && !failed) {
    return (
      <Image
        source={{ uri }}
        style={{ width: size, height: size, borderRadius: radius }}
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <View
      style={[
        styles.fallback,
        { width: size, height: size, borderRadius: radius, backgroundColor: character.avatar.color },
      ]}
    >
      <Text style={{ fontSize: size * 0.5 }}>{character.avatar.emoji}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: { alignItems: 'center', justifyContent: 'center' },
});

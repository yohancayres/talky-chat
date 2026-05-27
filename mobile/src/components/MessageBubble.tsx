import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Image, StyleSheet, Text, View } from 'react-native';
import { api } from '../api';
import { haptics } from '../haptics';
import { colors, radius } from '../theme';
import { formatTime } from '../time';
import { Character, Message } from '../types';
import { Avatar } from './Avatar';

// Foto enviada na mensagem, com indicador de carregamento e fallback.
function ImageAttachment({ url, tint }: { url: string; tint: string }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  // URIs absolutas (foto local recém-escolhida, otimista) usam direto; caminhos
  // relativos do servidor (/uploads, /photos) ganham o baseUrl.
  const uri =
    /^(https?:|file:|data:|blob:|content:)/.test(url) ? url : `${api.baseUrl}${url}`;

  if (failed) {
    return (
      <View style={[styles.imageWrap, styles.imageFallback]}>
        <Text style={styles.imageFallbackText}>📷 foto indisponível</Text>
      </View>
    );
  }

  return (
    <View style={styles.imageWrap}>
      <Image
        source={{ uri }}
        style={styles.image}
        resizeMode="cover"
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
      />
      {!loaded && (
        <View style={styles.imageLoading}>
          <ActivityIndicator color={tint} />
        </View>
      )}
    </View>
  );
}

export function MessageBubble({
  message,
  character,
  showAvatar = true,
  showTail = true,
  showTime = true,
  pending = false,
  animateIn = false,
}: {
  message: Message;
  character?: Character;
  /** Esconde o avatar quando faz parte de um grupo (mensagens seguidas). */
  showAvatar?: boolean;
  /** "Rabicho" só na última bolha de um grupo, estilo mensageiro. */
  showTail?: boolean;
  showTime?: boolean;
  /** Mensagem otimista ainda não confirmada pelo servidor. */
  pending?: boolean;
  /** Anima a entrada (mensagens recém-chegadas). */
  animateIn?: boolean;
}) {
  const isUser = message.role === 'user';
  const hasImage = Boolean(message.imageUrl);
  const anim = useRef(new Animated.Value(animateIn ? 0 : 1)).current;

  useEffect(() => {
    if (!animateIn) return;
    // Pequeno toque ao receber uma mensagem do personagem.
    if (!isUser) haptics.light();
    Animated.spring(anim, {
      toValue: 1,
      useNativeDriver: true,
      friction: 8,
      tension: 80,
    }).start();
  }, [anim, animateIn, isUser]);

  const animatedStyle = {
    opacity: anim,
    transform: [
      { translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) },
      { scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) },
    ],
  };

  const time = showTime ? formatTime(message.createdAt) : '';

  if (isUser) {
    return (
      <Animated.View style={[styles.row, styles.rowEnd, animatedStyle]}>
        <View
          style={[
            styles.bubble,
            styles.userBubble,
            hasImage && styles.bubbleWithImage,
            showTail ? styles.userTail : styles.userNoTail,
          ]}
        >
          {hasImage && <ImageAttachment url={message.imageUrl!} tint="#FFFFFF" />}
          {message.text ? (
            <Text style={[styles.userText, hasImage && styles.textBelowImage]}>{message.text}</Text>
          ) : null}
          <View style={styles.metaRow}>
            {time ? <Text style={styles.userTime}>{time}</Text> : null}
            <Text style={styles.tick}>{pending ? '🕐' : '✓✓'}</Text>
          </View>
        </View>
      </Animated.View>
    );
  }

  return (
    <Animated.View style={[styles.row, styles.rowStart, animatedStyle]}>
      <View style={styles.avatarWrap}>
        {showAvatar ? (
          character ? (
            <Avatar character={character} size={34} />
          ) : (
            <View style={[styles.avatar, { backgroundColor: colors.accent }]}>
              <Text style={styles.avatarEmoji}>🙂</Text>
            </View>
          )
        ) : (
          <View style={styles.avatarSpacer} />
        )}
      </View>
      <View
        style={[
          styles.bubble,
          styles.charBubble,
          hasImage && styles.bubbleWithImage,
          showTail ? styles.charTail : styles.charNoTail,
        ]}
      >
        {hasImage && <ImageAttachment url={message.imageUrl!} tint={colors.accent} />}
        {message.text ? (
          <Text style={[styles.charText, hasImage && styles.textBelowImage]}>{message.text}</Text>
        ) : null}
        {time ? <Text style={styles.charTime}>{time}</Text> : null}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    marginTop: 2,
    marginBottom: 2,
    paddingHorizontal: 12,
  },
  rowStart: { justifyContent: 'flex-start', alignItems: 'flex-end' },
  rowEnd: { justifyContent: 'flex-end' },
  avatarWrap: { marginRight: 8 },
  avatarSpacer: { width: 34, height: 1 },
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
    paddingVertical: 8,
    paddingHorizontal: 13,
  },
  bubbleWithImage: { padding: 4 },
  userBubble: { backgroundColor: colors.userBubble },
  userTail: { borderBottomRightRadius: 6 },
  userNoTail: { borderTopRightRadius: 6 },
  charBubble: {
    backgroundColor: colors.charBubble,
    borderWidth: 1,
    borderColor: colors.border,
  },
  charTail: { borderBottomLeftRadius: 6 },
  charNoTail: { borderTopLeftRadius: 6 },
  userText: { color: colors.userBubbleText, fontSize: 16, lineHeight: 22 },
  charText: { color: colors.charBubbleText, fontSize: 16, lineHeight: 22 },
  textBelowImage: { marginTop: 6, paddingHorizontal: 9 },
  imageWrap: {
    width: 220,
    height: 220,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.06)',
  },
  image: { width: '100%', height: '100%' },
  imageLoading: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  imageFallback: { alignItems: 'center', justifyContent: 'center' },
  imageFallbackText: { color: colors.muted, fontSize: 13 },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-end',
    marginTop: 2,
    paddingHorizontal: 4,
  },
  userTime: { color: 'rgba(255,255,255,0.75)', fontSize: 11, marginRight: 4 },
  tick: { color: 'rgba(255,255,255,0.85)', fontSize: 11 },
  charTime: {
    color: colors.muted,
    fontSize: 11,
    alignSelf: 'flex-end',
    marginTop: 2,
    paddingHorizontal: 4,
  },
});

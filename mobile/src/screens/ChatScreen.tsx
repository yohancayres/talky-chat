import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  AppState,
  Dimensions,
  FlatList,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  NativeScrollEvent,
  NativeSyntheticEvent,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TextInputKeyPressEventData,
  View,
} from 'react-native';
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../api';
import { Avatar } from '../components/Avatar';
import { CharacterProfileModal } from '../components/CharacterProfileModal';
import { MessageBubble } from '../components/MessageBubble';
import { TypingIndicator } from '../components/TypingIndicator';
import { haptics } from '../haptics';
import { colors, radius, shadow } from '../theme';
import { Character, ChatStatus, Message } from '../types';
import { formatDayDivider, formatDuration, isSameDay } from '../time';

const USER_STATUS_OPTIONS = [
  'Disponível',
  'No trabalho',
  'Em reunião',
  'Vendo um filme',
  'Ocupado',
  'Ausente',
];

// Considera "recém-chegada" (e portanto anima a entrada) qualquer mensagem
// criada nos últimos 8s — evita reanimar o histórico ao rolar.
const RECENT_MS = 8000;
// Gap acima do qual mensagens seguidas do mesmo remetente deixam de ser agrupadas.
const GROUP_GAP_MS = 5 * 60 * 1000;

function characterStatusLabel(status: ChatStatus | null, character: Character): string {
  if (!status) return character.occupation || 'toque para ver o perfil';
  if (status.recordingAudio) return 'gravando áudio...';
  if (status.typing) return 'digitando...';
  if (status.state === 'sleeping') return `${status.activity || 'dormindo'} 💤`;
  if (status.state === 'online') return 'online';
  return status.activity || 'ocupado'; // busy → mostra a atividade (ex: "em reunião")
}

function statusDotColor(status: ChatStatus | null): string | null {
  if (!status) return null;
  if (status.recordingAudio || status.typing || status.state === 'online') return colors.online;
  if (status.state === 'sleeping') return colors.sleeping;
  return colors.busy;
}

type Row =
  | { kind: 'divider'; id: string; label: string }
  | {
      kind: 'message';
      id: string;
      message: Message;
      showAvatar: boolean;
      showTail: boolean;
      animateIn: boolean;
    };

// Transforma a lista plana de mensagens em linhas com separadores de dia e
// metadados de agrupamento (avatar/rabicho só na última bolha de um bloco).
function buildRows(messages: Message[]): Row[] {
  const rows: Row[] = [];
  const now = Date.now();
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const prev = messages[i - 1];
    const next = messages[i + 1];

    if (!prev || !isSameDay(prev.createdAt, msg.createdAt)) {
      rows.push({ kind: 'divider', id: `div-${msg.id}`, label: formatDayDivider(msg.createdAt) });
    }

    const gapToNext = next ? new Date(next.createdAt).getTime() - new Date(msg.createdAt).getTime() : Infinity;
    const lastInGroup =
      !next ||
      next.role !== msg.role ||
      next.senderId !== msg.senderId ||
      !isSameDay(next.createdAt, msg.createdAt) ||
      gapToNext > GROUP_GAP_MS;

    rows.push({
      kind: 'message',
      id: msg.id,
      message: msg,
      showAvatar: lastInGroup,
      showTail: lastInGroup,
      // Anima só mensagens recebidas; as suas aparecem na hora (sem "subir").
      animateIn: msg.role === 'character' && now - new Date(msg.createdAt).getTime() < RECENT_MS,
    });
  }
  return rows;
}

export function ChatScreen({
  conversationId,
  character: initialCharacter,
  initialMessages,
  userName,
  initialStatus,
  initialUserStatus,
  onBack,
  onReset,
}: {
  conversationId: string;
  character: Character;
  initialMessages: Message[];
  userName: string;
  initialStatus?: ChatStatus | null;
  initialUserStatus?: string;
  onBack: () => void;
  onReset: () => void;
}) {
  const insets = useSafeAreaInsets();
  // Com o teclado aberto, não reservamos o espaço da barra de navegação no
  // rodapé (ela fica atrás do teclado) — evita um vão feio acima do teclado.
  const [keyboardUp, setKeyboardUp] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardUp(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardUp(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  const inputPadBottom = keyboardUp ? 12 : Math.max(insets.bottom, 12);
  const [character, setCharacter] = useState<Character>(initialCharacter);
  const [regeneratingPhoto, setRegeneratingPhoto] = useState(false);
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState('');
  const [attachment, setAttachment] = useState<{
    uri: string;
    base64: string;
    mediaType: string;
  } | null>(null);
  const [sending, setSending] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [status, setStatus] = useState<ChatStatus | null>(initialStatus ?? null);
  const [userStatus, setUserStatus] = useState<string>(initialUserStatus ?? '');
  const [showScrollDown, setShowScrollDown] = useState(false);
  const [unseenCount, setUnseenCount] = useState(0);
  const listRef = useRef<FlatList<Row>>(null);
  const atBottomRef = useRef(true);

  const lastSyncRef = useRef<string>(
    initialMessages.length ? initialMessages[initialMessages.length - 1].createdAt : '',
  );

  // Ao abrir a conversa, marca como lida.
  useEffect(() => {
    api.markRead(conversationId).catch(() => {});
  }, [conversationId]);

  // Toca áudio mesmo com o iPhone no modo silencioso (causa comum de "sem som").
  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});
  }, []);

  const scrollToEnd = useCallback((animated = true) => {
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated }));
    setShowScrollDown(false);
    setUnseenCount(0);
  }, []);

  const mergeIncoming = useCallback((incoming: Message[]) => {
    if (incoming.length === 0) return;
    setMessages((prev) => {
      const seen = new Set(prev.map((m) => m.id));
      const merged = [...prev];
      for (const m of incoming) {
        if (!seen.has(m.id)) merged.push(m);
      }
      merged.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      return merged;
    });
    for (const m of incoming) {
      if (m.createdAt > lastSyncRef.current) lastSyncRef.current = m.createdAt;
    }
  }, []);

  // Polling: recebe respostas (com atraso), mensagens proativas e o status atual.
  useEffect(() => {
    let active = true;

    async function poll() {
      try {
        const res = await api.getNewMessages(conversationId, lastSyncRef.current);
        if (!active) return;
        setStatus(res.status);
        // Foto de perfil pode ter sido (re)gerada em segundo plano.
        setRegeneratingPhoto(Boolean(res.status.avatarGenerating));
        if (res.status.photoUrl) {
          setCharacter((prev) =>
            prev.photoUrl === res.status.photoUrl ? prev : { ...prev, photoUrl: res.status.photoUrl },
          );
        }
        if (res.messages.length > 0) {
          mergeIncoming(res.messages);
          if (atBottomRef.current) {
            scrollToEnd();
          } else {
            // Usuário está lendo o histórico: não puxa a tela, só sinaliza.
            setUnseenCount((c) => c + res.messages.length);
            setShowScrollDown(true);
          }
          // Está com a conversa aberta: marca como lida.
          api.markRead(conversationId).catch(() => {});
        }
      } catch {
        // silencioso: tenta de novo no próximo ciclo
      }
    }

    poll();
    // 2,5s: rápido o suficiente para o "digitando..." intermitente aparecer.
    const interval = setInterval(poll, 2500);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') poll();
    });

    return () => {
      active = false;
      clearInterval(interval);
      subscription.remove();
    };
  }, [conversationId, mergeIncoming, scrollToEnd]);

  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(audioRecorder);

  async function startRecording() {
    try {
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Áudio', 'Preciso do microfone para gravar um áudio.');
        return;
      }
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
      // Logo após conceder a permissão pela 1ª vez, o Android às vezes ainda não
      // liberou o microfone e o prepare falha. Tentamos de novo após uma pausa.
      try {
        await audioRecorder.prepareToRecordAsync();
      } catch {
        await new Promise((r) => setTimeout(r, 400));
        await audioRecorder.prepareToRecordAsync();
      }
      audioRecorder.record();
      haptics.medium();
    } catch (e) {
      console.error('[talky] erro ao iniciar gravação:', e);
      const msg =
        e instanceof Error ? e.message : typeof e === 'string' ? e : JSON.stringify(e);
      Alert.alert('Áudio', `Não foi possível gravar: ${msg}`);
    }
  }

  async function stopAndSendRecording() {
    try {
      const durationMs = Math.round(recorderState.durationMillis ?? 0);
      await audioRecorder.stop();
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      const uri = audioRecorder.uri;
      if (!uri || durationMs < 700) return; // descarta toques acidentais
      const base64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
      sendRecordedAudio(uri, base64, durationMs);
    } catch (e) {
      Alert.alert('Áudio', e instanceof Error ? e.message : 'Não foi possível enviar o áudio.');
    }
  }

  async function cancelRecording() {
    haptics.selection();
    try {
      await audioRecorder.stop();
    } catch {
      // ignora
    }
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
  }

  async function pickImage() {
    haptics.selection();
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Fotos', 'Preciso de acesso à galeria para anexar uma foto.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.5, // comprime: a foto vai em base64 e ainda passa por visão
        base64: true,
      });
      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];
      if (!asset.base64) return;
      const mediaType = asset.mimeType || 'image/jpeg';
      setAttachment({ uri: asset.uri, base64: asset.base64, mediaType });
    } catch (e) {
      Alert.alert('Fotos', e instanceof Error ? e.message : 'Não foi possível abrir a galeria.');
    }
  }

  // Envio genérico (texto / foto / áudio) com mensagem otimista e troca atômica.
  async function submitMessage(opts: {
    text: string;
    imageUri?: string;
    audioUri?: string;
    audioDurationMs?: number;
    attach?: {
      image?: { data: string; mediaType: string };
      audio?: { data: string; mediaType: string; durationMs?: number };
    };
  }) {
    if (sending) return;
    haptics.light();
    const optimisticId = `local-${Date.now()}`;
    const optimistic: Message = {
      id: optimisticId,
      conversationId,
      role: 'user',
      senderId: 'user',
      senderName: userName || 'Você',
      text: opts.text,
      imageUrl: opts.imageUri, // mostra a mídia local até o servidor confirmar
      audioUrl: opts.audioUri,
      audioDurationMs: opts.audioDurationMs,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);
    setPendingIds((prev) => new Set(prev).add(optimisticId));
    setSending(true);
    scrollToEnd();

    try {
      const res = await api.sendMessage(conversationId, opts.text, userName, opts.attach);
      const incoming = [res.userMessage, ...res.replies];
      // Troca otimista→confirmada num único render: evita a lista encolher por um
      // instante (o que fazia a visão "subir" no envio).
      setMessages((prev) => {
        const withoutOptimistic = prev.filter((m) => m.id !== optimisticId);
        const seen = new Set(withoutOptimistic.map((m) => m.id));
        const merged = [...withoutOptimistic];
        for (const m of incoming) {
          if (!seen.has(m.id)) merged.push(m);
        }
        merged.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        return merged;
      });
      for (const m of incoming) {
        if (m.createdAt > lastSyncRef.current) lastSyncRef.current = m.createdAt;
      }
      setPendingIds((prev) => {
        const n = new Set(prev);
        n.delete(optimisticId);
        return n;
      });
      setStatus(res.status);
    } catch (e) {
      haptics.error();
      const errorText = e instanceof Error ? e.message : 'Falha ao enviar.';
      const systemMsg: Message = {
        id: `error-${Date.now()}`,
        conversationId,
        role: 'character',
        senderId: character.id,
        senderName: character.name,
        text: `(não consegui enviar agora: ${errorText})`,
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, systemMsg]);
      setPendingIds((prev) => {
        const n = new Set(prev);
        n.delete(optimisticId);
        return n;
      });
    } finally {
      setSending(false);
      scrollToEnd();
    }
  }

  function handleSend() {
    const text = draft.trim();
    const img = attachment;
    if ((!text && !img) || sending) return;
    setDraft('');
    setAttachment(null);
    void submitMessage({
      text,
      imageUri: img?.uri,
      attach: img ? { image: { data: img.base64, mediaType: img.mediaType } } : undefined,
    });
  }

  function sendRecordedAudio(uri: string, base64: string, durationMs: number) {
    void submitMessage({
      text: '',
      audioUri: uri,
      audioDurationMs: durationMs,
      attach: { audio: { data: base64, mediaType: 'audio/m4a', durationMs } },
    });
  }

  async function handleRegeneratePhoto() {
    if (regeneratingPhoto) return;
    haptics.medium();
    setRegeneratingPhoto(true); // feedback imediato; o polling confirma quando termina
    try {
      await api.regenerateAvatar(character.id);
    } catch (e) {
      setRegeneratingPhoto(false);
      Alert.alert('Foto de perfil', e instanceof Error ? e.message : 'Não foi possível gerar a foto.');
    }
  }

  async function selectUserStatus(label: string) {
    haptics.selection();
    const value = label === 'Disponível' ? '' : label;
    setUserStatus(value);
    try {
      await api.setUserStatus(conversationId, value);
    } catch {
      // mantém o valor local mesmo se a rede falhar
    }
  }

  // Enter envia; Shift+Enter (teclado físico/web) insere quebra de linha.
  function handleKeyPress(e: NativeSyntheticEvent<TextInputKeyPressEventData>) {
    const native = e.nativeEvent as TextInputKeyPressEventData & { shiftKey?: boolean };
    if (native.key === 'Enter' && !native.shiftKey) {
      (e as unknown as { preventDefault?: () => void }).preventDefault?.();
      handleSend();
    }
  }

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const distanceFromBottom = contentSize.height - (layoutMeasurement.height + contentOffset.y);
    const atBottom = distanceFromBottom < 120;
    atBottomRef.current = atBottom;
    setShowScrollDown(!atBottom);
    if (atBottom) setUnseenCount(0);
  }, []);

  const isTyping = status?.typing ?? false;
  const photoGenerating = status?.photoGenerating ?? false;
  const recordingAudio = status?.recordingAudio ?? false;
  const dotColor = statusDotColor(status);
  const rows = useMemo(() => buildRows(messages), [messages]);

  // Swipe-back estilo iOS: arrastar da borda esquerda para a direita volta para a lista.
  // Só ativa no iOS e quando o toque parte da borda, para não atrapalhar o scroll da lista
  // nem a barra horizontal de chips de status.
  const swipeX = useRef(new Animated.Value(0)).current;
  const screenWidth = Dimensions.get('window').width;
  const swipeBack = useMemo(
    () => {
      const settle = (toValue: number, done?: () => void) =>
        Animated.spring(swipeX, {
          toValue,
          useNativeDriver: true,
          bounciness: 0,
          speed: 18,
        }).start(({ finished }) => finished && done?.());
      return PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (evt, gesture) => {
          if (Platform.OS !== 'ios') return false;
          const startX = evt.nativeEvent.pageX - gesture.dx;
          const fromEdge = startX < 32;
          const movingRight = gesture.dx > 6 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5;
          return fromEdge && movingRight;
        },
        onPanResponderGrant: () => {
          swipeX.stopAnimation();
        },
        onPanResponderMove: (_, gesture) => {
          // Acompanha o dedo (clampa em >= 0).
          swipeX.setValue(Math.max(0, gesture.dx));
        },
        onPanResponderRelease: (_, gesture) => {
          const passed = gesture.dx > screenWidth * 0.3 || gesture.vx > 0.4;
          if (passed) settle(screenWidth, onBack);
          else settle(0);
        },
        onPanResponderTerminate: () => settle(0),
      });
    },
    [onBack, screenWidth, swipeX],
  );

  const renderRow = useCallback(
    ({ item }: { item: Row }) => {
      if (item.kind === 'divider') {
        return (
          <View style={styles.divider}>
            <Text style={styles.dividerText}>{item.label}</Text>
          </View>
        );
      }
      return (
        <MessageBubble
          message={item.message}
          character={character}
          showAvatar={item.showAvatar}
          showTail={item.showTail}
          animateIn={item.animateIn}
          pending={pendingIds.has(item.id)}
        />
      );
    },
    [character, pendingIds],
  );

  return (
    <Animated.View
      style={[styles.container, styles.swipeShadow, { transform: [{ translateX: swipeX }] }]}
      {...swipeBack.panHandlers}
    >
    <KeyboardAvoidingView
      style={styles.container}
      // Com edge-to-edge no Android a janela não redimensiona sozinha, então o
      // teclado cobria o input. "padding" nos dois empurra o input acima dele.
      behavior="padding"
    >
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <Pressable onPress={onBack} hitSlop={12} style={styles.backButton}>
          <Text style={styles.backIcon}>‹</Text>
        </Pressable>
        <Pressable style={styles.headerMain} onPress={() => setProfileOpen(true)}>
          <View style={styles.headerAvatar}>
            <Avatar character={character} size={40} />
            {dotColor && <View style={[styles.presenceDot, { backgroundColor: dotColor }]} />}
          </View>
          <View style={styles.headerInfo}>
            <Text style={styles.headerName} numberOfLines={1}>
              {character.name}
              {status?.moodEmoji ? ` ${status.moodEmoji}` : ''}
            </Text>
            <Text
              style={[styles.headerSubtitle, isTyping && styles.headerTyping]}
              numberOfLines={1}
            >
              {characterStatusLabel(status, character)}
            </Text>
          </View>
        </Pressable>
      </View>

      <View style={styles.userStatusBar}>
        <Text style={styles.userStatusLabel}>Seu status:</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.statusChips}
        >
          {USER_STATUS_OPTIONS.map((label) => {
            const value = label === 'Disponível' ? '' : label;
            const selected = userStatus === value;
            return (
              <Pressable
                key={label}
                style={[styles.statusChip, selected && styles.statusChipActive]}
                onPress={() => selectUserStatus(label)}
              >
                <Text style={[styles.statusChipText, selected && styles.statusChipTextActive]}>
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <View style={styles.listWrap}>
        <FlatList
          ref={listRef}
          data={rows}
          keyExtractor={(item) => item.id}
          renderItem={renderRow}
          contentContainerStyle={styles.listContent}
          onScroll={onScroll}
          scrollEventThrottle={16}
          onContentSizeChange={() => {
            if (atBottomRef.current) scrollToEnd(false);
          }}
          ListFooterComponent={
            recordingAudio ? (
              <View style={styles.photoPending}>
                <Avatar character={character} size={34} />
                <View style={styles.photoPendingBubble}>
                  <Text style={styles.photoPendingText}>🎤 gravando áudio…</Text>
                </View>
              </View>
            ) : photoGenerating ? (
              <View style={styles.photoPending}>
                <Avatar character={character} size={34} />
                <View style={styles.photoPendingBubble}>
                  <Text style={styles.photoPendingText}>📷 tirando uma foto…</Text>
                </View>
              </View>
            ) : isTyping ? (
              <TypingIndicator character={character} />
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.emptyChat}>
              <Avatar character={character} size={72} />
              <Text style={styles.emptyChatName}>{character.name}</Text>
              <Text style={styles.emptyChatHint}>
                Diga oi para {character.name.split(' ')[0]} e comece a conversa.
              </Text>
            </View>
          }
        />

        {showScrollDown && (
          <Pressable style={styles.scrollDown} onPress={() => scrollToEnd()}>
            {unseenCount > 0 && (
              <View style={styles.scrollDownBadge}>
                <Text style={styles.scrollDownBadgeText}>
                  {unseenCount > 9 ? '9+' : unseenCount}
                </Text>
              </View>
            )}
            <Text style={styles.scrollDownIcon}>⌄</Text>
          </Pressable>
        )}
      </View>

      {recorderState.isRecording ? (
        <View style={[styles.inputBar, { paddingBottom: inputPadBottom }]}>
          <Pressable onPress={cancelRecording} hitSlop={10} style={styles.recCancel}>
            <Text style={styles.recCancelIcon}>✕</Text>
          </Pressable>
          <View style={styles.recInfo}>
            <View style={styles.recDot} />
            <Text style={styles.recTime}>
              {formatDuration(recorderState.durationMillis ?? 0)}
            </Text>
            <Text style={styles.recHint}>gravando…</Text>
          </View>
          <Pressable style={styles.sendButton} onPress={stopAndSendRecording}>
            <Text style={styles.sendIcon}>➤</Text>
          </Pressable>
        </View>
      ) : (
        <>
          {attachment && (
            <View style={styles.attachPreview}>
              <Image source={{ uri: attachment.uri }} style={styles.attachThumb} />
              <Text style={styles.attachLabel} numberOfLines={1}>
                Foto anexada
              </Text>
              <Pressable onPress={() => setAttachment(null)} hitSlop={10}>
                <Text style={styles.attachRemove}>✕</Text>
              </Pressable>
            </View>
          )}

          <View style={[styles.inputBar, { paddingBottom: inputPadBottom }]}>
            <Pressable
              style={styles.attachButton}
              onPress={pickImage}
              disabled={sending}
              hitSlop={8}
            >
              <Text style={styles.attachIcon}>＋</Text>
            </Pressable>
            <TextInput
              style={styles.input}
              placeholder={`Mensagem para ${character.name.split(' ')[0]}...`}
              placeholderTextColor={colors.muted}
              value={draft}
              onChangeText={setDraft}
              onKeyPress={handleKeyPress}
              blurOnSubmit={false}
              multiline
            />
            {draft.trim() || attachment ? (
              <Pressable
                style={[styles.sendButton, sending && styles.sendButtonDisabled]}
                onPress={handleSend}
                disabled={sending}
              >
                <Text style={styles.sendIcon}>➤</Text>
              </Pressable>
            ) : (
              <Pressable
                style={[styles.sendButton, sending && styles.sendButtonDisabled]}
                onPress={startRecording}
                disabled={sending}
              >
                <Text style={styles.micIcon}>🎤</Text>
              </Pressable>
            )}
          </View>
        </>
      )}

      <CharacterProfileModal
        visible={profileOpen}
        character={character}
        mood={status?.mood}
        moodEmoji={status?.moodEmoji}
        regeneratingPhoto={regeneratingPhoto}
        onRegeneratePhoto={handleRegeneratePhoto}
        onClose={() => setProfileOpen(false)}
        onReset={() => {
          setProfileOpen(false);
          onReset();
        }}
      />
    </KeyboardAvoidingView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  // Sombra na borda esquerda durante o swipe (profundidade estilo iOS).
  swipeShadow: {
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: -3, height: 0 },
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 52,
    paddingBottom: 12,
    paddingHorizontal: 12,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    ...shadow.sm,
  },
  backButton: {
    paddingHorizontal: 4,
    paddingRight: 6,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  // includeFontPadding:false + textAlignVertical evitam o glifo ser cortado no
  // Android (onde o chevron sumia por causa do padding extra de fonte).
  backIcon: {
    fontSize: 34,
    color: colors.accent,
    lineHeight: 38,
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  headerMain: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  headerAvatar: { marginRight: 12 },
  presenceDot: {
    position: 'absolute',
    right: -1,
    bottom: -1,
    width: 13,
    height: 13,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: colors.surface,
  },
  headerInfo: { flex: 1 },
  headerName: { fontSize: 17, fontWeight: '700', color: colors.text },
  headerSubtitle: { fontSize: 13, color: colors.muted, marginTop: 1 },
  headerTyping: { color: colors.accent, fontStyle: 'italic' },
  userStatusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingLeft: 12,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  userStatusLabel: { fontSize: 12, color: colors.muted, marginRight: 8 },
  statusChips: { paddingRight: 12 },
  statusChip: {
    paddingVertical: 5,
    paddingHorizontal: 12,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
    marginRight: 8,
  },
  statusChipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  statusChipText: { fontSize: 13, color: colors.text },
  statusChipTextActive: { color: '#FFFFFF', fontWeight: '600' },
  listWrap: { flex: 1 },
  listContent: { paddingVertical: 12, flexGrow: 1 },
  divider: { alignItems: 'center', marginVertical: 12 },
  dividerText: {
    fontSize: 12,
    color: colors.muted,
    backgroundColor: colors.surfaceAlt,
    overflow: 'hidden',
    borderRadius: radius.lg,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  photoPending: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginVertical: 4,
    paddingHorizontal: 12,
  },
  photoPendingBubble: {
    marginLeft: 8,
    backgroundColor: colors.charBubble,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 18,
    borderBottomLeftRadius: 6,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  photoPendingText: { color: colors.muted, fontSize: 14, fontStyle: 'italic' },
  emptyChat: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyChatName: { fontSize: 20, fontWeight: '700', color: colors.text, marginTop: 14 },
  emptyChatHint: {
    fontSize: 15,
    color: colors.muted,
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 21,
  },
  scrollDown: {
    position: 'absolute',
    right: 16,
    bottom: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.md,
  },
  scrollDownIcon: { fontSize: 24, color: colors.text, lineHeight: 26, marginTop: -4 },
  scrollDownBadge: {
    position: 'absolute',
    top: -6,
    right: -6,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 5,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.surface,
  },
  scrollDownBadgeText: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },
  attachPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  attachThumb: { width: 40, height: 40, borderRadius: 8, backgroundColor: colors.border },
  attachLabel: { flex: 1, marginLeft: 10, fontSize: 14, color: colors.text },
  attachRemove: { fontSize: 16, color: colors.muted, paddingHorizontal: 6, fontWeight: '700' },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    paddingVertical: 10,
    paddingBottom: Platform.OS === 'ios' ? 28 : 12,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  attachButton: {
    width: 40,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 4,
  },
  attachIcon: { fontSize: 26, color: colors.accent, lineHeight: 28 },
  micIcon: { fontSize: 20 },
  recCancel: { width: 40, height: 44, alignItems: 'center', justifyContent: 'center' },
  recCancelIcon: { fontSize: 18, color: colors.danger, fontWeight: '700' },
  recInfo: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  recDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.danger, marginRight: 8 },
  recTime: { fontSize: 16, color: colors.text, fontVariant: ['tabular-nums'], marginRight: 8 },
  recHint: { fontSize: 14, color: colors.muted },
  input: {
    flex: 1,
    maxHeight: 120,
    backgroundColor: colors.bg,
    borderRadius: radius.lg,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
    fontSize: 16,
    color: colors.text,
    marginRight: 10,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.sm,
  },
  sendButtonDisabled: { backgroundColor: colors.muted, ...{ shadowOpacity: 0, elevation: 0 } },
  sendIcon: { color: '#FFFFFF', fontSize: 18, marginLeft: 2 },
});

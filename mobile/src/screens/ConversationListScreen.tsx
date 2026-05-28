import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { api } from '../api';
import { Avatar } from '../components/Avatar';
import { displayName, useContactNames } from '../contactNames';
import { haptics } from '../haptics';
import { colors, radius, shadow } from '../theme';
import { formatListTime } from '../time';
import { ConversationSummary } from '../types';

// Cache em memória: ao reabrir a lista, mostra os últimos dados na hora (sem
// spinner) e atualiza em silêncio. Evita o "refresh" ao voltar de uma conversa.
let cachedConversations: ConversationSummary[] = [];

export function ConversationListScreen({
  userId,
  onOpen,
  onNewContact,
}: {
  userId: string;
  onOpen: (conversationId: string) => void;
  onNewContact: () => void;
}) {
  const [items, setItems] = useState<ConversationSummary[]>(cachedConversations);
  const [loading, setLoading] = useState(cachedConversations.length === 0);
  const [refreshing, setRefreshing] = useState(false);
  const contactNames = useContactNames(); // apelidos locais

  const nameOf = useCallback(
    (item: ConversationSummary) =>
      item.character ? displayName(item.character, contactNames) : item.conversation.title,
    [contactNames],
  );

  const load = useCallback(async () => {
    try {
      const res = await api.getConversations(userId);
      setItems(res.conversations);
      cachedConversations = res.conversations;
    } catch {
      // mantém a lista atual em caso de falha de rede
    } finally {
      setLoading(false);
    }
  }, [userId]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 8000);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') load();
    });
    return () => {
      clearInterval(interval);
      sub.remove();
    };
  }, [load]);

  const handleOpen = useCallback(
    (id: string) => {
      haptics.selection();
      onOpen(id);
    },
    [onOpen],
  );

  const handleNewContact = useCallback(() => {
    haptics.medium();
    onNewContact();
  }, [onNewContact]);

  const handleDelete = useCallback(
    (item: ConversationSummary) => {
      const name = nameOf(item);
      haptics.selection();
      Alert.alert(
        'Excluir conversa',
        `Apagar sua conversa com ${name}? O histórico será removido. ${name} continua no AmyChat e você pode reencontrá-lo(a) depois.`,
        [
          { text: 'Cancelar', style: 'cancel' },
          {
            text: 'Excluir',
            style: 'destructive',
            onPress: async () => {
              haptics.medium();
              // Remove já da lista (otimista); recarrega do servidor se falhar.
              setItems((prev) => prev.filter((i) => i.conversation.id !== item.conversation.id));
              try {
                await api.deleteConversation(item.conversation.id);
              } catch {
                load();
              }
            },
          },
        ],
      );
    },
    [load, nameOf],
  );

  function renderItem({ item }: { item: ConversationSummary }) {
    const name = nameOf(item);
    const hasUnread = item.unread > 0;
    const preview = item.lastMessage
      ? `${item.lastMessage.role === 'user' ? 'Você: ' : ''}${item.lastMessage.text}`
      : 'Toque para conversar';
    return (
      <Pressable
        style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
        onPress={() => handleOpen(item.conversation.id)}
        onLongPress={() => handleDelete(item)}
        delayLongPress={350}
      >
        {item.character ? (
          <Avatar character={item.character} size={54} />
        ) : (
          <View style={styles.placeholder} />
        )}
        <View style={styles.rowBody}>
          <View style={styles.rowTop}>
            <Text style={[styles.name, hasUnread && styles.nameUnread]} numberOfLines={1}>
              {name}
            </Text>
            <Text style={[styles.time, hasUnread && styles.timeUnread]}>
              {formatListTime(item.lastMessage?.createdAt)}
            </Text>
          </View>
          <View style={styles.rowBottom}>
            <Text
              style={[styles.preview, hasUnread && styles.previewUnread]}
              numberOfLines={1}
            >
              {preview}
            </Text>
            {hasUnread && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{item.unread > 99 ? '99+' : item.unread}</Text>
              </View>
            )}
          </View>
        </View>
      </Pressable>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Conversas</Text>
        <Pressable
          style={({ pressed }) => [styles.newButton, pressed && styles.newButtonPressed]}
          onPress={handleNewContact}
          hitSlop={10}
        >
          <Text style={styles.newButtonText}>+</Text>
        </Pressable>
      </View>

      {loading && items.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      ) : (
        <FlatList
          data={items}
          extraData={contactNames}
          keyExtractor={(i) => i.conversation.id}
          renderItem={renderItem}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          contentContainerStyle={items.length === 0 ? styles.emptyContent : undefined}
          ListFooterComponent={
            items.length > 0 ? (
              <Text style={styles.hint}>Segure uma conversa para excluir</Text>
            ) : null
          }
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.accent}
              colors={[colors.accent]}
            />
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyEmoji}>💬</Text>
              <Text style={styles.emptyTitle}>Nenhuma conversa ainda</Text>
              <Text style={styles.emptyText}>Toque em + para conhecer alguém no AmyChat.</Text>
              <Pressable style={styles.emptyButton} onPress={handleNewContact}>
                <Text style={styles.emptyButtonText}>Conhecer alguém</Text>
              </Pressable>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 56,
    paddingBottom: 14,
    paddingHorizontal: 20,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    ...shadow.sm,
  },
  title: { fontSize: 26, fontWeight: '800', color: colors.text },
  newButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.sm,
  },
  newButtonPressed: { backgroundColor: colors.accentDark },
  newButtonText: { color: '#FFFFFF', fontSize: 24, lineHeight: 26, marginTop: -2 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  rowPressed: { backgroundColor: colors.surface },
  placeholder: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: colors.border,
  },
  rowBody: { flex: 1, marginLeft: 14 },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowBottom: { flexDirection: 'row', alignItems: 'center', marginTop: 3 },
  name: { fontSize: 17, fontWeight: '700', color: colors.text, flex: 1, marginRight: 8 },
  nameUnread: { fontWeight: '800' },
  time: { fontSize: 12, color: colors.muted },
  timeUnread: { color: colors.accent, fontWeight: '700' },
  preview: { fontSize: 14, color: colors.muted, flex: 1, marginRight: 8 },
  previewUnread: { color: colors.text, fontWeight: '600' },
  badge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  separator: { height: 1, backgroundColor: colors.border, marginLeft: 84 },
  hint: { textAlign: 'center', color: colors.muted, fontSize: 12, paddingVertical: 20 },
  emptyContent: { flexGrow: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 },
  emptyEmoji: { fontSize: 52 },
  emptyTitle: { fontSize: 19, fontWeight: '700', color: colors.text, marginTop: 16 },
  emptyText: { textAlign: 'center', color: colors.muted, marginTop: 6, fontSize: 15, lineHeight: 21 },
  emptyButton: {
    marginTop: 22,
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: 12,
    paddingHorizontal: 28,
    ...shadow.sm,
  },
  emptyButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
});

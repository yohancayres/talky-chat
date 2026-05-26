import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
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
import { colors } from '../theme';
import { ConversationSummary } from '../types';

function timeLabel(iso?: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) {
    return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

export function ConversationListScreen({
  userId,
  onOpen,
  onNewContact,
}: {
  userId: string;
  onOpen: (conversationId: string) => void;
  onNewContact: () => void;
}) {
  const [items, setItems] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await api.getConversations(userId);
      setItems(res.conversations);
    } catch {
      // mantém a lista atual em caso de falha de rede
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 10000);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') load();
    });
    return () => {
      clearInterval(interval);
      sub.remove();
    };
  }, [load]);

  function renderItem({ item }: { item: ConversationSummary }) {
    const name = item.character?.name ?? item.conversation.title;
    const preview = item.lastMessage
      ? `${item.lastMessage.role === 'user' ? 'Você: ' : ''}${item.lastMessage.text}`
      : 'Toque para conversar';
    return (
      <Pressable
        style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
        onPress={() => onOpen(item.conversation.id)}
      >
        {item.character ? (
          <Avatar character={item.character} size={54} />
        ) : (
          <View style={styles.placeholder} />
        )}
        <View style={styles.rowBody}>
          <View style={styles.rowTop}>
            <Text style={styles.name} numberOfLines={1}>
              {name}
            </Text>
            <Text style={styles.time}>{timeLabel(item.lastMessage?.createdAt)}</Text>
          </View>
          <View style={styles.rowBottom}>
            <Text
              style={[styles.preview, item.unread > 0 && styles.previewUnread]}
              numberOfLines={1}
            >
              {preview}
            </Text>
            {item.unread > 0 && (
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
        <Pressable style={styles.newButton} onPress={onNewContact} hitSlop={10}>
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
          keyExtractor={(i) => i.conversation.id}
          renderItem={renderItem}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}
          ListEmptyComponent={
            <Text style={styles.empty}>Nenhuma conversa ainda. Toque em + para conhecer alguém.</Text>
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
  },
  title: { fontSize: 26, fontWeight: '800', color: colors.text },
  newButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
  time: { fontSize: 12, color: colors.muted },
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
  empty: { textAlign: 'center', color: colors.muted, marginTop: 48, paddingHorizontal: 32, fontSize: 15 },
});

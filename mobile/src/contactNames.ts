import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

// Apelidos de contato definidos LOCALMENTE pelo usuário (characterId -> nome).
// Só existem neste dispositivo; o nome real do personagem nunca muda.
const KEY = 'talky.contactNames';

let cache: Record<string, string> | null = null;
const listeners = new Set<() => void>();

async function load(): Promise<Record<string, string>> {
  if (cache) return cache;
  try {
    cache = JSON.parse((await AsyncStorage.getItem(KEY)) ?? '{}') as Record<string, string>;
  } catch {
    cache = {};
  }
  return cache;
}

/** Define (ou remove, se vazio) o apelido local de um personagem. */
export async function setContactName(characterId: string, name: string): Promise<void> {
  const map = await load();
  const trimmed = name.trim();
  if (trimmed) map[characterId] = trimmed;
  else delete map[characterId];
  cache = { ...map };
  await AsyncStorage.setItem(KEY, JSON.stringify(cache));
  listeners.forEach((l) => l());
}

/** Mapa reativo de apelidos (atualiza quando algum é alterado). */
export function useContactNames(): Record<string, string> {
  const [names, setNames] = useState<Record<string, string>>(cache ?? {});
  useEffect(() => {
    let active = true;
    void load().then((m) => active && setNames({ ...m }));
    const l = () => setNames({ ...(cache ?? {}) });
    listeners.add(l);
    return () => {
      active = false;
      listeners.delete(l);
    };
  }, []);
  return names;
}

/** Nome a exibir: apelido local se houver, senão o nome real do personagem. */
export function displayName(
  character: { id: string; name: string },
  names: Record<string, string>,
): string {
  return names[character.id]?.trim() || character.name;
}

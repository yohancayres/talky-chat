import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

// Wrappers tolerantes a falha: haptics não existem na web nem em alguns
// emuladores, então qualquer erro é silenciado para nunca quebrar a UI.
const enabled = Platform.OS === 'ios' || Platform.OS === 'android';

export const haptics = {
  light() {
    if (enabled) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  },
  medium() {
    if (enabled) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
  },
  selection() {
    if (enabled) Haptics.selectionAsync().catch(() => {});
  },
  success() {
    if (enabled)
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  },
  error() {
    if (enabled)
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
  },
};

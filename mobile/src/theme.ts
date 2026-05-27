import { Platform, ViewStyle } from 'react-native';

export const colors = {
  bg: '#F3F1EC',
  surface: '#FFFFFF',
  surfaceAlt: '#FBFAF7',
  accent: '#2E9E83',
  accentDark: '#247A66',
  accentSoft: '#E3F1EC',
  text: '#22242A',
  muted: '#8C8F98',
  userBubble: '#2E9E83',
  userBubbleText: '#FFFFFF',
  charBubble: '#FFFFFF',
  charBubbleText: '#22242A',
  border: '#E6E3DC',
  danger: '#C0564F',
  // Cores de presença do personagem.
  online: '#34C759',
  busy: '#E8A33D',
  sleeping: '#7E8AA3',
};

export const radius = {
  sm: 10,
  md: 16,
  lg: 22,
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
};

// Sombras sutis para dar profundidade (iOS via shadow*, Android via elevation).
export const shadow = {
  sm: Platform.select<ViewStyle>({
    ios: {
      shadowColor: '#000',
      shadowOpacity: 0.06,
      shadowRadius: 4,
      shadowOffset: { width: 0, height: 2 },
    },
    default: { elevation: 2 },
  })!,
  md: Platform.select<ViewStyle>({
    ios: {
      shadowColor: '#000',
      shadowOpacity: 0.1,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 4 },
    },
    default: { elevation: 5 },
  })!,
};

// Neutral base, one green for progress, and a small colour dot for each group.
import { I18nManager, Platform, useColorScheme } from 'react-native';
import { useApp } from './store';

const light = {
  paper: '#FCFCFA', ink: '#23262A', wash: '#F0F0EC', line: '#E4E4DE', soft: '#A3A5A3', mute: '#5F6367',
  accent: '#2A7D4F', onAccent: '#FFFFFF',
  groups: ['#8A8D90', '#4A78B5', '#C0714F', '#3F9393', '#C29A3A', '#8A6BA8', '#B8607A'],
  shadow: '#000000', scrim: 'rgba(20,22,24,0.22)',
};
const dark: typeof light = {
  paper: '#16181B', ink: '#ECECE8', wash: '#24272B', line: '#32363B', soft: '#6F7377', mute: '#ADB0B3',
  accent: '#6FCF97', onAccent: '#10231A',
  groups: ['#8A8D90', '#7EA6DC', '#DD9A7C', '#6FBCBC', '#DCBB66', '#B398CF', '#D98CA4'],
  shadow: '#000000', scrim: 'rgba(0,0,0,0.45)',
};

export type Theme = typeof light;

export function useTheme(): Theme {
  const system = useColorScheme();
  const pref = useApp().data.meta.theme;
  return (pref === 'system' ? system : pref) === 'dark' ? dark : light;
}

export const useIsDark = () => useTheme() === dark;

export const font = {
  black: 'FrankRuhlLibre_900Black',
  serif: 'FrankRuhlLibre_500Medium',
  light: 'FrankRuhlLibre_300Light',
  regular: 'Assistant_400Regular',
  medium: 'Assistant_500Medium',
  semibold: 'Assistant_600SemiBold',
  bold: 'Assistant_700Bold',
};

/** The web preview runs right-to-left through the document direction, not through I18nManager. */
export const RTL = I18nManager.isRTL || Platform.OS === 'web';

export const groupColor = (t: Theme, color: number | undefined) => t.groups[color ?? 0] ?? t.groups[0];

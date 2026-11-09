import React from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { t as tr } from '../i18n';
import { useApp } from '../store';
import { font, groupColor, useTheme } from '../theme';

export function Pips({ points, muted }: { points: number; muted?: boolean }) {
  const t = useTheme();
  return (
    <View style={s.pips} accessible accessibilityLabel={tr.ptsLabel(points)}>
      {[1, 2, 3, 4, 5].map((i) => (
        <View key={i} style={[s.pip, { backgroundColor: i <= points ? (muted ? t.soft : t.ink) : t.line }]} />
      ))}
    </View>
  );
}

export function Dot({ color, size = 9 }: { color?: number; size?: number }) {
  const t = useTheme();
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: groupColor(t, color) }} />;
}

export function Chip({ label, on, color, onPress }: { label: string; on?: boolean; color?: number; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!on }}
      style={[s.chip, { backgroundColor: on ? t.ink : t.wash }]}
    >
      {color !== undefined ? <Dot color={color} /> : null}
      <Text style={[s.chipT, { color: on ? t.paper : t.ink }]}>{label}</Text>
    </Pressable>
  );
}

export function Btn({ label, solid, onPress, style }: { label: string; solid?: boolean; onPress: () => void; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={[s.btn, { borderColor: t.ink, backgroundColor: solid ? t.ink : 'transparent' }, style]}>
      <Text style={[s.btnT, { color: solid ? t.paper : t.ink }]}>{label}</Text>
    </Pressable>
  );
}

export function TextLink({ label, onPress }: { label: string; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} hitSlop={8} accessibilityRole="button">
      <Text style={[s.link, { color: t.ink, borderBottomColor: t.ink }]}>{label}</Text>
    </Pressable>
  );
}

export function ToastHost() {
  const { toast } = useApp();
  const t = useTheme();
  const insets = useSafeAreaInsets();
  if (!toast) return null;
  return (
    <View pointerEvents="box-none" style={[s.toastWrap, { bottom: insets.bottom + 128 }]}>
      <View style={[s.toast, { backgroundColor: t.ink }]} accessibilityLiveRegion="polite">
        <Text style={[s.toastT, { color: t.paper }]}>{toast.message}</Text>
        {toast.undo ? (
          <Pressable onPress={toast.undo} hitSlop={12} accessibilityRole="button">
            <Text style={[s.toastU, { color: t.paper, borderBottomColor: t.paper }]}>{tr.undo}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  pips: { flexDirection: 'row', gap: 2, alignItems: 'center' },
  pip: { width: 3.5, height: 13 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  chipT: { fontFamily: font.medium, fontSize: 14.5 },
  btn: { flex: 1, paddingVertical: 12, paddingHorizontal: 8, alignItems: 'center', borderWidth: 1.5, borderRadius: 10 },
  btnT: { fontFamily: font.bold, fontSize: 15.5 },
  link: { fontFamily: font.semibold, fontSize: 14.5, borderBottomWidth: 1.5 },
  toastWrap: { position: 'absolute', start: 14, end: 14, zIndex: 50, elevation: 50 },
  toast: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 11, borderRadius: 10 },
  toastT: { flex: 1, fontFamily: font.medium, fontSize: 15 },
  toastU: { fontFamily: font.bold, fontSize: 15, borderBottomWidth: 1.5 },
});

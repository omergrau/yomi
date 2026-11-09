// The bottom bar is a wheel: swipe it sideways to turn to the next screen, or tap a name.
import { Tabs, router, usePathname } from 'expo-router';
import React, { useCallback, useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { t as tr } from '../../i18n';
import { openSheet } from '../../store';
import { RTL, font, useTheme } from '../../theme';

const ROUTES = [
  { href: '/', label: tr.nav.today },
  { href: '/week', label: tr.nav.week },
  { href: '/lists', label: tr.nav.lists },
  { href: '/groups', label: tr.nav.groups },
  { href: '/score', label: tr.nav.score },
] as const;
const ITEM_W = 84;
const LAST = ROUTES.length - 1;
// Physical direction of "next": to the left in Hebrew.
const DIR = RTL ? -1 : 1;
const SPRING = { damping: 20, stiffness: 220 };

function WheelItem({ index, pos, on, onPress }: { index: number; pos: SharedValue<number>; on: boolean; onPress: () => void }) {
  const t = useTheme();
  const style = useAnimatedStyle(() => {
    const dist = Math.abs(index - pos.value);
    return {
      opacity: Math.max(0, 1 - Math.min(dist, 2.6) * 0.36),
      transform: [{ translateX: (index - pos.value) * ITEM_W * DIR }, { scale: 1 - Math.min(dist, 2) * 0.1 }],
    };
  });
  return (
    <Animated.View style={[s.item, style]}>
      <Pressable onPress={onPress} style={s.itemHit} accessibilityRole="tab" accessibilityState={{ selected: on }}>
        <Text style={[s.label, { color: on ? t.ink : t.mute, fontFamily: on ? font.bold : font.medium }]}>{ROUTES[index].label}</Text>
      </Pressable>
    </Animated.View>
  );
}

function Bar() {
  const t = useTheme();
  const path = usePathname();
  const current = Math.max(0, ROUTES.findIndex((r) => r.href === path));
  const pos = useSharedValue(current);
  const start = useSharedValue(current);
  const draggedAt = useRef(0);

  useEffect(() => {
    pos.value = withSpring(current, SPRING);
  }, [current, pos]);

  const go = useCallback((i: number) => {
    draggedAt.current = Date.now();
    if (ROUTES[i].href !== path) router.navigate(ROUTES[i].href);
  }, [path]);

  const pan = usePanGesture({
    activeOffsetX: [-8, 8],
    onActivate: () => {
      'worklet';
      start.value = pos.value;
    },
    onUpdate: (e) => {
      'worklet';
      pos.value = Math.max(-0.4, Math.min(LAST + 0.4, start.value - (e.translationX * DIR) / ITEM_W));
    },
    onDeactivate: (e) => {
      'worklet';
      const fling = Math.max(-0.6, Math.min(0.6, ((e.velocityX ?? 0) * DIR * 0.05) / ITEM_W));
      const flung = pos.value - fling;
      const target = Math.max(0, Math.min(LAST, Math.round(flung)));
      pos.value = withSpring(target, SPRING);
      scheduleOnRN(go, target);
    },
  });

  return (
    <View style={[s.bar, { backgroundColor: t.paper, borderTopColor: t.line }]}>
      <View style={s.mid}>
        <Pressable style={[s.add, { backgroundColor: t.accent }]} onPress={() => openSheet({ id: null })} accessibilityRole="button" accessibilityLabel={tr.nav.add}>
          <Text style={[s.plus, { color: t.onAccent }]}>+</Text>
        </Pressable>
      </View>
      <GestureDetector gesture={pan}>
        <View style={s.wheel} accessibilityRole="tablist">
          {ROUTES.map((r, i) => (
            <WheelItem
              key={r.href}
              index={i}
              pos={pos}
              on={i === current}
              onPress={() => {
                // A swipe that ends on a name must not also count as a tap on it.
                if (Date.now() - draggedAt.current > 250) go(i);
              }}
            />
          ))}
          <View pointerEvents="none" style={[s.dot, { backgroundColor: t.accent }]} />
        </View>
      </GestureDetector>
    </View>
  );
}

export default function TabsLayout() {
  const t = useTheme();
  return (
    <Tabs tabBar={() => <Bar />} screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: t.paper }, animation: 'none', freezeOnBlur: false }}>
      <Tabs.Screen name="index" />
      <Tabs.Screen name="week" />
      <Tabs.Screen name="lists" />
      <Tabs.Screen name="groups" />
      <Tabs.Screen name="score" />
    </Tabs>
  );
}

const s = StyleSheet.create({
  bar: { flexDirection: 'row', height: 60, alignItems: 'center', borderTopWidth: 1 },
  wheel: { flex: 1, height: '100%', overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  item: { position: 'absolute', width: ITEM_W, height: '100%' },
  itemHit: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 15 },
  dot: { position: 'absolute', bottom: 8, width: 5, height: 5, borderRadius: 3 },
  mid: { width: 62, alignItems: 'center' },
  add: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  plus: { fontFamily: font.light, fontSize: 32, lineHeight: 36 },
});

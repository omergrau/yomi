// The bottom bar is a wheel: swipe it sideways to turn to the next screen, or tap a name.
import { Tabs, router, usePathname } from 'expo-router';
import React, { useCallback, useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withSpring, withTiming, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { t as tr } from '../../i18n';
import { getApiKey } from '../../assistant/key';
import { openSheet } from '../../store';
import { RTL, font, useTheme } from '../../theme';
import { demoConversation } from '../../data/demo';

const ROUTES = [
  { href: '/', label: tr.nav.today },
  { href: '/week', label: tr.nav.week },
  { href: '/lists', label: tr.nav.lists },
  { href: '/groups', label: tr.nav.groups },
  { href: '/score', label: tr.nav.score },
  { href: '/assistant', label: tr.aiTab },
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
      <Pressable onPress={onPress} style={s.itemHit} accessibilityRole="tab" accessibilityState={{ selected: on }} aria-selected={on}>
        <Text style={[s.label, { color: on ? t.ink : t.mute, fontFamily: on ? font.bold : font.medium }]}>{ROUTES[index].label}</Text>
      </Pressable>
    </Animated.View>
  );
}

/** The assistant shortcut: a soft green pill with a sparkle that gently glows. */
function AiTag() {
  const t = useTheme();
  const glow = useSharedValue(0);
  useEffect(() => {
    glow.value = withRepeat(
      withSequence(withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.quad) }), withTiming(0, { duration: 1400, easing: Easing.inOut(Easing.quad) })),
      -1,
    );
  }, [glow]);
  const sparkle = useAnimatedStyle(() => ({ opacity: 0.55 + glow.value * 0.45, transform: [{ scale: 0.9 + glow.value * 0.2 }, { rotate: `${glow.value * 18}deg` }] }));
  return (
    <Pressable
      onPress={async () => ((await getApiKey()) || demoConversation.length ? router.navigate('/assistant') : router.push('/settings'))}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={tr.aiShortcutLabel}
      style={({ pressed }) => [
        s.ai,
        { backgroundColor: `${t.accent}1A`, transform: [{ scale: pressed ? 0.94 : 1 }] },
      ]}
    >
      <Animated.Text style={[s.aiStar, { color: t.accent }, sparkle]}>✦</Animated.Text>
      <Text style={[s.aiT, { color: t.accent }]}>AI</Text>
    </Pressable>
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
    <View style={[s.bar, { backgroundColor: t.paper }]}>
      <View style={s.mid}>
        <Pressable style={[s.add, { backgroundColor: t.accent }]} onPress={() => openSheet({ id: null })} accessibilityRole="button" accessibilityLabel={tr.nav.add}>
          <Text style={[s.plus, { color: t.onAccent }]}>+</Text>
        </Pressable>
      </View>
      {/* A shortcut to the assistant: the chat when a key is set, otherwise the place to add one. */}
      <AiTag />
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
      <Tabs.Screen name="assistant" />
    </Tabs>
  );
}

const s = StyleSheet.create({
  bar: { flexDirection: 'row', height: 62, alignItems: 'center' },
  wheel: { flex: 1, height: '100%', overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  item: { position: 'absolute', width: ITEM_W, height: '100%' },
  itemHit: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 15 },
  mid: { width: 62, alignItems: 'center' },
  ai: {
    flexDirection: 'row', alignItems: 'center', gap: 4, height: 30, paddingStart: 9, paddingEnd: 11, borderRadius: 15, marginEnd: 4,
  },
  aiStar: { fontSize: 14, lineHeight: 17 },
  aiT: { fontFamily: font.bold, fontSize: 13, letterSpacing: 0.6 },
  add: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  plus: { fontFamily: font.light, fontSize: 32, lineHeight: 36 },
});

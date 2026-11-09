// Picks a topic for a new task. Up to five topics turn on a wheel; more open a list.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import type { Group } from '../domain/types';
import { t as tr } from '../i18n';
import { RTL, font, groupColor, useTheme } from '../theme';

const ITEM_W = 92;
const DIR = RTL ? -1 : 1;
const SPRING = { damping: 20, stiffness: 240 };
const WHEEL_MAX = 5;

type Option = { id: string | null; name: string; color: number };

function WheelItem({ index, pos, option, on, onPress }: { index: number; pos: SharedValue<number>; option: Option; on: boolean; onPress: () => void }) {
  const t = useTheme();
  const style = useAnimatedStyle(() => {
    const dist = Math.abs(index - pos.value);
    return {
      opacity: Math.max(0, 1 - Math.min(dist, 2.5) * 0.34),
      transform: [{ translateX: (index - pos.value) * ITEM_W * DIR }, { scale: 1 - Math.min(dist, 2) * 0.08 }],
    };
  });
  return (
    <Animated.View style={[s.item, style]}>
      <Pressable
        onPress={onPress}
        accessibilityRole="radio"
        accessibilityState={{ selected: on, checked: on }}
        aria-checked={on}
        accessibilityLabel={option.name}
        style={[s.pill, { backgroundColor: on ? t.ink : t.paper }]}
      >
        <View style={[s.dot, { backgroundColor: groupColor(t, option.color) }]} />
        <Text numberOfLines={1} style={[s.pillT, { color: on ? t.paper : t.ink, fontFamily: on ? font.semibold : font.regular }]}>{option.name}</Text>
      </Pressable>
    </Animated.View>
  );
}

function Wheel({ options, value, onChange }: { options: Option[]; value: string | null; onChange: (id: string | null) => void }) {
  const index = Math.max(0, options.findIndex((o) => o.id === value));
  const pos = useSharedValue(index);
  const start = useSharedValue(index);
  const last = options.length - 1;
  const draggedAt = useRef(0);

  useEffect(() => {
    pos.value = withSpring(index, SPRING);
  }, [index, pos]);

  const pick = useCallback((i: number) => {
    draggedAt.current = Date.now();
    onChange(options[i].id);
  }, [onChange, options]);

  const pan = usePanGesture({
    activeOffsetX: [-8, 8],
    failOffsetY: [-12, 12],
    onActivate: () => {
      'worklet';
      start.value = pos.value;
    },
    onUpdate: (e) => {
      'worklet';
      pos.value = Math.max(-0.4, Math.min(last + 0.4, start.value - (e.translationX * DIR) / ITEM_W));
    },
    onDeactivate: (e) => {
      'worklet';
      const fling = Math.max(-0.6, Math.min(0.6, ((e.velocityX ?? 0) * DIR * 0.05) / ITEM_W));
      const target = Math.max(0, Math.min(last, Math.round(pos.value - fling)));
      pos.value = withSpring(target, SPRING);
      scheduleOnRN(pick, target);
    },
  });

  return (
    <GestureDetector gesture={pan}>
      <View style={s.wheel} accessibilityRole="radiogroup" accessibilityLabel={tr.topic}>
        {options.map((o, i) => (
          <WheelItem
            key={o.id ?? 'none'}
            index={i}
            pos={pos}
            option={o}
            on={i === index}
            onPress={() => {
              if (Date.now() - draggedAt.current > 250) pick(i);
            }}
          />
        ))}
      </View>
    </GestureDetector>
  );
}

function Dropdown({ options, value, onChange }: { options: Option[]; value: string | null; onChange: (id: string | null) => void }) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.id === value) ?? options[0];
  return (
    <View style={s.flex}>
      <Pressable
        onPress={() => setOpen((x) => !x)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${tr.topic}: ${current.name}`}
        style={[s.field, { backgroundColor: t.paper, borderColor: open ? t.ink : t.line }]}
      >
        <View style={[s.dot, { backgroundColor: groupColor(t, current.color) }]} />
        <Text numberOfLines={1} style={[s.fieldT, { color: t.ink }]}>{current.name}</Text>
        <Text style={[s.chev, { color: t.mute, transform: [{ rotate: open ? '180deg' : '0deg' }] }]}>⌄</Text>
      </Pressable>
      {open ? (
        <View style={[s.menu, { backgroundColor: t.paper, borderColor: t.line, shadowColor: t.shadow }]}>
          <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled style={s.menuScroll}>
            {options.map((o) => {
              const on = o.id === current.id;
              return (
                <Pressable
                  key={o.id ?? 'none'}
                  onPress={() => {
                    onChange(o.id);
                    setOpen(false);
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on, checked: on }}
        aria-checked={on}
                  accessibilityLabel={o.name}
                  style={({ pressed }) => [s.option, { backgroundColor: on ? t.wash : pressed ? t.wash : 'transparent' }]}
                >
                  <View style={[s.dot, { backgroundColor: groupColor(t, o.color) }]} />
                  <Text numberOfLines={1} style={[s.optionT, { color: t.ink, fontFamily: on ? font.semibold : font.regular }]}>{o.name}</Text>
                  {on ? <Text style={[s.check, { color: t.accent }]}>✓</Text> : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

/** "No topic" is offered as a topic of its own, first in the list. */
export function TopicPicker({ groups, value, onChange }: { groups: Group[]; value: string | null; onChange: (id: string | null) => void }) {
  const options: Option[] = [{ id: null, name: tr.noTopic, color: 0 }, ...groups.map((g) => ({ id: g.id, name: g.name, color: g.color }))];
  return groups.length > WHEEL_MAX ? (
    <Dropdown options={options} value={value} onChange={onChange} />
  ) : (
    <Wheel options={options} value={value} onChange={onChange} />
  );
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  wheel: { flex: 1, height: 34, overflow: 'hidden', justifyContent: 'center' },
  // The web preview lays out right-to-left through the document, so it needs the physical side.
  item: { position: 'absolute', width: ITEM_W, alignItems: 'flex-start', ...(Platform.OS === 'web' ? { right: 0 } : { start: 0 }) },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 30, maxWidth: ITEM_W - 6, paddingHorizontal: 11, borderRadius: 15 },
  pillT: { fontSize: 13.5, flexShrink: 1 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  field: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 34, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1 },
  fieldT: { flex: 1, fontFamily: font.medium, fontSize: 14.5 },
  chev: { fontSize: 16, lineHeight: 18 },
  menu: { marginTop: 6, borderRadius: 12, borderWidth: 1, overflow: 'hidden', elevation: 6, shadowOpacity: 0.12, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
  menuScroll: { maxHeight: 230 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 42, paddingHorizontal: 14 },
  optionT: { flex: 1, fontSize: 15 },
  check: { fontFamily: font.bold, fontSize: 15 },
});

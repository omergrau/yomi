// Picks a topic for a new task. Up to five topics sit close together in a row that slides sideways;
// more open a list.
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Group } from '../domain/types';
import { t as tr } from '../i18n';
import { font, groupColor, useTheme } from '../theme';

const ROW_MAX = 5;

type Option = { id: string; name: string; color: number };

function Row({ options, value, onChange }: { options: Option[]; value: string | null; onChange: (id: string) => void }) {
  const t = useTheme();
  return (
    <ScrollView
      horizontal
      keyboardShouldPersistTaps="handled"
      showsHorizontalScrollIndicator={false}
      style={s.flex}
      contentContainerStyle={s.row}
      accessibilityRole="radiogroup"
      accessibilityLabel={tr.topic}
    >
      {options.map((o) => {
        const on = o.id === value;
        return (
          <Pressable
            key={o.id}
            onPress={() => onChange(o.id)}
            accessibilityRole="radio"
            accessibilityState={{ selected: on, checked: on }}
            aria-checked={on}
            accessibilityLabel={o.name}
            style={[s.pill, { backgroundColor: on ? t.ink : t.paper }]}
          >
            <View style={[s.dot, { backgroundColor: groupColor(t, o.color) }]} />
            <Text numberOfLines={1} style={[s.pillT, { color: on ? t.paper : t.ink, fontFamily: on ? font.semibold : font.regular }]}>{o.name}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function Dropdown({ options, value, onChange }: { options: Option[]; value: string | null; onChange: (id: string) => void }) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.id === value) ?? null;
  return (
    <View style={s.flex}>
      <Pressable
        onPress={() => setOpen((x) => !x)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${tr.topic}: ${current?.name ?? tr.pickTopic}`}
        style={[s.field, { backgroundColor: t.paper, borderColor: open ? t.ink : t.line }]}
      >
        {current ? <View style={[s.dot, { backgroundColor: groupColor(t, current.color) }]} /> : null}
        <Text numberOfLines={1} style={[s.fieldT, { color: current ? t.ink : t.mute }]}>{current?.name ?? tr.pickTopic}</Text>
        <Text style={[s.chev, { color: t.mute, transform: [{ rotate: open ? '180deg' : '0deg' }] }]}>⌄</Text>
      </Pressable>
      {open ? (
        <View style={[s.menu, { backgroundColor: t.paper, borderColor: t.line, shadowColor: t.shadow }]}>
          <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled style={s.menuScroll}>
            {options.map((o) => {
              const on = o.id === current?.id;
              return (
                <Pressable
                  key={o.id}
                  onPress={() => {
                    onChange(o.id);
                    setOpen(false);
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on, checked: on }}
                  aria-checked={on}
                  accessibilityLabel={o.name}
                  style={({ pressed }) => [s.option, { backgroundColor: on || pressed ? t.wash : 'transparent' }]}
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

export function TopicPicker({ groups, value, onChange }: { groups: Group[]; value: string | null; onChange: (id: string) => void }) {
  const options: Option[] = groups.map((g) => ({ id: g.id, name: g.name, color: g.color }));
  return groups.length > ROW_MAX ? (
    <Dropdown options={options} value={value} onChange={onChange} />
  ) : (
    <Row options={options} value={value} onChange={onChange} />
  );
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 28, paddingHorizontal: 10, borderRadius: 14 },
  pillT: { fontSize: 13.5 },
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

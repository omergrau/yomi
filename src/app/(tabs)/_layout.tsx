import { Tabs, router, usePathname } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { t as tr } from '../../i18n';
import { openSheet } from '../../store';
import { font, useTheme } from '../../theme';

const ROUTES = {
  today: { href: '/', label: tr.nav.today },
  week: { href: '/week', label: tr.nav.week },
  groups: { href: '/groups', label: tr.nav.groups },
  score: { href: '/score', label: tr.nav.score },
} as const;

function Item({ route }: { route: keyof typeof ROUTES }) {
  const t = useTheme();
  const path = usePathname();
  const { href, label } = ROUTES[route];
  const on = path === href;
  return (
    <Pressable style={s.item} onPress={() => router.navigate(href)} accessibilityRole="tab" accessibilityState={{ selected: on }}>
      <Text style={[s.label, { color: on ? t.ink : t.mute, fontFamily: on ? font.bold : font.medium }]}>{label}</Text>
    </Pressable>
  );
}

function Bar() {
  const t = useTheme();
  return (
    <View style={[s.bar, { backgroundColor: t.paper, borderTopColor: t.line }]}>
      <Item route="today" />
      <Item route="week" />
      <View style={s.mid}>
        <Pressable
          style={[s.add, { backgroundColor: t.accent }]}
          onPress={() => openSheet({ id: null })}
          accessibilityRole="button"
          accessibilityLabel={tr.nav.add}
        >
          <Text style={[s.plus, { color: t.onAccent }]}>+</Text>
        </Pressable>
      </View>
      <Item route="groups" />
      <Item route="score" />
    </View>
  );
}

export default function TabsLayout() {
  const t = useTheme();
  return (
    <Tabs tabBar={() => <Bar />} screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: t.paper }, animation: 'none' }}>
      <Tabs.Screen name="index" />
      <Tabs.Screen name="week" />
      <Tabs.Screen name="groups" />
      <Tabs.Screen name="score" />
    </Tabs>
  );
}

const s = StyleSheet.create({
  bar: { flexDirection: 'row', height: 60, alignItems: 'center', borderTopWidth: 1 },
  item: { flex: 1, height: '100%', alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 14.5 },
  mid: { width: 64, alignItems: 'center' },
  add: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  plus: { fontFamily: font.light, fontSize: 32, lineHeight: 36 },
});

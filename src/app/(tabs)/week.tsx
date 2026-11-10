import { router } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Month } from '../../components/Month';
import { Timetable } from '../../components/Timetable';
import { Dot } from '../../components/ui';
import { addDays, weekDays } from '../../domain/dates';
import { dayStats, dayTasks } from '../../domain/logic';
import { fmtDay, fmtShort, t as tr } from '../../i18n';
import { setView, useApp } from '../../store';
import { RTL, font, useTheme } from '../../theme';

function WeekList() {
  const t = useTheme();
  const { data, today } = useApp();
  const [anchor, setAnchor] = useState(today);
  const days = weekDays(anchor);
  const groups = new Map(data.groups.map((g) => [g.id, g]));
  const current = days.includes(today);
  return (
    <ScrollView style={{ backgroundColor: t.paper }} contentContainerStyle={s.page}>
      <View style={s.head}>
        <Text style={[s.h1, { color: t.mute }]}>{current ? tr.weekTitle : `${fmtShort(days[0])} – ${fmtShort(days[6])}`}</Text>
        <View style={s.nav}>
          <Pressable onPress={() => setAnchor(addDays(anchor, -7))} hitSlop={10} accessibilityRole="button" accessibilityLabel={tr.weekPrev}>
            <Text style={[s.arrow, { color: t.mute }]}>{RTL ? '›' : '‹'}</Text>
          </Pressable>
          <Pressable onPress={() => setAnchor(addDays(anchor, 7))} hitSlop={10} accessibilityRole="button" accessibilityLabel={tr.weekNext}>
            <Text style={[s.arrow, { color: t.mute }]}>{RTL ? '‹' : '›'}</Text>
          </Pressable>
        </View>
      </View>
      {days.map((d) => {
        const st = dayStats(data, d);
        const ts = dayTasks(data, d);
        const past = d < today;
        return (
          <Pressable
            key={d}
            style={[s.day, past ? { opacity: 0.6 } : null]}
            onPress={() => {
              setView(d);
              router.navigate('/');
            }}
            accessibilityRole="button"
            accessibilityLabel={`יום ${fmtDay(d)}, ${fmtShort(d)}`}
          >
            <View style={s.dayHead}>
              <Text style={[s.dayName, { color: d === today ? t.accent : t.ink }]}>{fmtDay(d)}</Text>
              <Text style={[s.dayDate, { color: t.soft }]}>{fmtShort(d)}</Text>
              <Text style={[s.dayScore, { color: t.mute }]}>{st.total ? (past ? `${st.done} ${tr.pts}` : `${st.done} / ${st.total}`) : ''}</Text>
            </View>
            {st.total ? (
              <View style={[s.mini, { backgroundColor: t.wash }]}>
                <View style={[s.miniFill, { width: `${st.pct * 100}%`, backgroundColor: t.accent }]} />
              </View>
            ) : null}
            {ts.map((x) => {
              const g = x.groupId ? groups.get(x.groupId) : undefined;
              return (
                <View key={x.id} style={s.task}>
                  <Text style={[s.taskT, { color: x.doneAt ? t.soft : t.ink, textDecorationLine: x.doneAt ? 'line-through' : 'none' }]} numberOfLines={1}>{x.title}</Text>
                  {g && g.color ? <Dot color={g.color} size={6} /> : null}
                  {x.time ? <Text style={[s.time, { color: t.mute }]}>{x.time}</Text> : null}
                </View>
              );
            })}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

export default function WeekScreen() {
  const t = useTheme();
  const [mode, setMode] = useState<'week' | 'month' | 'table'>('week');
  return (
    <View style={[s.flex, { backgroundColor: t.paper }]}>
      <View style={[s.seg, { backgroundColor: t.wash }]}>
        {(['week', 'month', 'table'] as const).map((m) => (
          <Pressable key={m} onPress={() => setMode(m)} style={[s.segBtn, mode === m ? { backgroundColor: t.paper } : null]} accessibilityRole="tab" accessibilityState={{ selected: mode === m }}>
            <Text style={[s.segT, { color: mode === m ? t.ink : t.mute, fontFamily: mode === m ? font.semibold : font.regular }]}>{m === 'week' ? tr.weekTab : m === 'month' ? tr.monthTab : tr.timetableTab}</Text>
          </Pressable>
        ))}
      </View>
      {mode === 'week' ? <WeekList /> : mode === 'month' ? <Month /> : <Timetable />}
    </View>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  seg: { flexDirection: 'row', marginHorizontal: 20, marginTop: 12, marginBottom: 2, padding: 3, borderRadius: 10 },
  segBtn: { flex: 1, paddingVertical: 6, borderRadius: 8, alignItems: 'center' },
  segT: { fontSize: 14.5 },
  page: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 28 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  h1: { fontFamily: font.semibold, fontSize: 15, fontVariant: ['lining-nums'] },
  nav: { flexDirection: 'row', gap: 26 },
  arrow: { fontFamily: font.regular, fontSize: 26, lineHeight: 30 },
  day: { paddingVertical: 10 },
  dayHead: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  dayName: { fontFamily: font.bold, fontSize: 16 },
  dayDate: { fontFamily: font.medium, fontSize: 13.5, fontVariant: ['lining-nums'] },
  dayScore: { fontFamily: font.medium, fontSize: 13.5, marginStart: 'auto', fontVariant: ['tabular-nums', 'lining-nums'] },
  mini: { height: 3, borderRadius: 2, overflow: 'hidden', marginTop: 6, marginBottom: 2 },
  miniFill: { height: '100%' },
  task: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  time: { fontFamily: font.medium, fontSize: 13.5, fontVariant: ['tabular-nums', 'lining-nums'] },
  taskT: { flexShrink: 1, fontFamily: font.regular, fontSize: 15 },
});

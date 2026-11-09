import { router } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Timetable } from '../../components/Timetable';
import { Dot, Pips } from '../../components/ui';
import { addDays, weekDays } from '../../domain/dates';
import { dayStats, dayTasks } from '../../domain/logic';
import { fmtDate, fmtDay, t as tr } from '../../i18n';
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
        <Text style={[s.h1, { color: t.ink }]}>{current ? tr.weekTitle : fmtDate(days[0])}</Text>
        <View style={s.nav}>
          <Pressable onPress={() => setAnchor(addDays(anchor, -7))} hitSlop={10} accessibilityRole="button" accessibilityLabel={tr.weekPrev}>
            <Text style={[s.arrow, { color: t.ink }]}>{RTL ? '›' : '‹'}</Text>
          </Pressable>
          <Pressable onPress={() => setAnchor(addDays(anchor, 7))} hitSlop={10} accessibilityRole="button" accessibilityLabel={tr.weekNext}>
            <Text style={[s.arrow, { color: t.ink }]}>{RTL ? '‹' : '›'}</Text>
          </Pressable>
        </View>
      </View>
      <Text style={[s.lead, { color: t.mute }]}>{tr.weekRange(fmtDate(days[0]), fmtDate(days[6]))}</Text>
      {days.map((d) => {
        const st = dayStats(data, d);
        const ts = dayTasks(data, d);
        const past = d < today;
        return (
          <Pressable
            key={d}
            style={[s.day, { borderTopColor: d === today ? t.ink : t.line, borderTopWidth: d === today ? 2 : 1 }]}
            onPress={() => {
              setView(d);
              router.navigate('/');
            }}
            accessibilityRole="button"
            accessibilityLabel={`יום ${fmtDay(d)}, ${fmtDate(d)}`}
          >
            <View style={s.dayHead}>
              <Text style={[s.dayName, { color: t.ink }]}>{fmtDay(d)}</Text>
              <Text style={[s.dayDate, { color: t.mute }]}>{fmtDate(d)}</Text>
              <Text style={[s.dayScore, { color: t.ink }]}>{st.total ? (past ? `${st.done} ${tr.pts}` : `${st.done} / ${st.total}`) : ''}</Text>
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
                  {g ? <Dot color={g.color} /> : null}
                  {x.time ? <Text style={[s.time, { color: t.mute }]}>{x.time}</Text> : null}
                  <Text style={[s.taskT, { color: x.doneAt ? t.soft : t.ink, textDecorationLine: x.doneAt ? 'line-through' : 'none' }]} numberOfLines={1}>{x.title}</Text>
                  <Pips points={x.points} muted={!!x.doneAt} />
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
  const [mode, setMode] = useState<'week' | 'table'>('week');
  return (
    <View style={[s.flex, { backgroundColor: t.paper }]}>
      <View style={[s.seg, { backgroundColor: t.wash }]}>
        {(['week', 'table'] as const).map((m) => (
          <Pressable key={m} onPress={() => setMode(m)} style={[s.segBtn, mode === m ? { backgroundColor: t.paper } : null]} accessibilityRole="tab" accessibilityState={{ selected: mode === m }}>
            <Text style={[s.segT, { color: mode === m ? t.ink : t.mute, fontFamily: mode === m ? font.semibold : font.regular }]}>{m === 'week' ? tr.weekTab : tr.timetableTab}</Text>
          </Pressable>
        ))}
      </View>
      {mode === 'week' ? <WeekList /> : <Timetable />}
    </View>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  seg: { flexDirection: 'row', marginHorizontal: 16, marginTop: 12, marginBottom: 2, padding: 3, borderRadius: 10 },
  segBtn: { flex: 1, paddingVertical: 7, borderRadius: 8, alignItems: 'center' },
  segT: { fontSize: 14.5 },
  page: { paddingHorizontal: 18, paddingTop: 10, paddingBottom: 28 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  h1: { fontFamily: font.black, fontSize: 38, lineHeight: 46, fontVariant: ['lining-nums'] },
  nav: { flexDirection: 'row', gap: 26 },
  arrow: { fontFamily: font.regular, fontSize: 32, lineHeight: 36 },
  lead: { fontFamily: font.regular, fontSize: 15.5, marginBottom: 14, marginTop: 2, fontVariant: ['lining-nums'] },
  day: { paddingVertical: 12 },
  dayHead: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  dayName: { fontFamily: font.serif, fontSize: 19 },
  dayDate: { fontFamily: font.regular, fontSize: 14, fontVariant: ['lining-nums'] },
  dayScore: { fontFamily: font.bold, fontSize: 14.5, marginStart: 'auto', fontVariant: ['tabular-nums', 'lining-nums'] },
  mini: { height: 6, borderRadius: 3, overflow: 'hidden', marginTop: 7 },
  miniFill: { height: '100%' },
  task: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 7 },
  time: { fontFamily: font.regular, fontSize: 14, fontVariant: ['tabular-nums', 'lining-nums'] },
  taskT: { flex: 1, fontFamily: font.regular, fontSize: 15 },
});

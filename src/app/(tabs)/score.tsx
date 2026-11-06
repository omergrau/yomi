import { router } from 'expo-router';
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { TextLink } from '../../components/ui';
import { parseIso } from '../../domain/dates';
import { bestDay, groupWeekPoints, levelInfo, streak, totalPoints, weekSeries } from '../../domain/logic';
import { t as tr } from '../../i18n';
import { useApp } from '../../store';
import { font, groupColor, useTheme } from '../../theme';

const CHART_H = 90;

export default function ScoreScreen() {
  const t = useTheme();
  const { data, today } = useApp();
  const total = totalPoints(data);
  const lvl = levelInfo(total);
  const series = weekSeries(data, today);
  const week = series.reduce((a, x) => a + x.done, 0);
  const max = Math.max(1, ...series.map((x) => x.done));
  const byGroup = data.groups.map((g) => ({ g, v: groupWeekPoints(data, g.id, today) }));
  const gmax = Math.max(1, ...byGroup.map((x) => x.v));
  return (
    <ScrollView style={{ backgroundColor: t.paper }} contentContainerStyle={s.page}>
      <View style={s.top}>
        <View style={s.lvl}>
          <Text style={[s.lvlN, { color: t.ink }]}>{lvl.level}</Text>
          <Text style={[s.lvlT, { color: t.ink }]}>{tr.level}</Text>
        </View>
        <TextLink label={tr.settings} onPress={() => router.push('/settings')} />
      </View>
      <View style={[s.bar, { backgroundColor: t.wash }]}>
        <View style={[s.fill, { width: `${lvl.pct * 100}%`, backgroundColor: t.accent }]} />
      </View>
      <Text style={[s.cap, { color: t.mute }]}>{tr.totalLine(total.toLocaleString('he-IL'), lvl.toNext, lvl.level + 1)}</Text>

      <View style={[s.stats, { borderColor: t.line }]}>
        {[
          { v: streak(data, today), l: tr.daysInRow },
          { v: week, l: tr.thisWeek },
          { v: bestDay(data, today), l: tr.bestDay },
        ].map((x) => (
          <View key={x.l} style={s.stat}>
            <Text style={[s.statN, { color: t.ink }]}>{x.v}</Text>
            <Text style={[s.statL, { color: t.mute }]}>{x.l}</Text>
          </View>
        ))}
      </View>

      <Text style={[s.h2, { color: t.ink }]}>{tr.pointsByDay}</Text>
      <View style={s.chart}>
        {series.map((x) => {
          const future = x.day > today;
          return (
            <View key={x.day} style={s.col}>
              <Text style={[s.val, { color: t.ink }]}>{future ? '' : x.done}</Text>
              <View style={[s.colBar, { height: Math.max(1, (x.done / max) * CHART_H), backgroundColor: future ? t.line : t.accent }]} />
              <Text style={[s.colL, { color: x.day === today ? t.ink : t.mute, fontFamily: x.day === today ? font.bold : font.regular }]}>{tr.dayLetters[parseIso(x.day).getDay()]}</Text>
            </View>
          );
        })}
      </View>

      {byGroup.length ? <Text style={[s.h2, { color: t.ink }]}>{tr.pointsByGroup}</Text> : null}
      {byGroup.map(({ g, v }) => (
        <View key={g.id} style={s.gRow}>
          <Text style={[s.gName, { color: t.ink }]} numberOfLines={1}>{g.name}</Text>
          <View style={[s.gTrack, { backgroundColor: t.wash }]}>
            <View style={[s.gFill, { width: `${(v / gmax) * 100}%`, backgroundColor: groupColor(t, g.color) }]} />
          </View>
          <Text style={[s.gVal, { color: t.ink }]}>{v}</Text>
        </View>
      ))}

      <Text style={[s.h2, { color: t.ink }]}>{tr.howTitle}</Text>
      <View style={s.rules}>
        {tr.how.map((line) => (
          <Text key={line} style={[s.rule, { color: t.mute }]}>{line}</Text>
        ))}
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  page: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 28 },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  lvl: { flexDirection: 'row', alignItems: 'baseline', gap: 10 },
  lvlN: { fontFamily: font.black, fontSize: 96, lineHeight: 104, fontVariant: ['lining-nums'] },
  lvlT: { fontFamily: font.light, fontSize: 22 },
  bar: { height: 14, borderRadius: 7, overflow: 'hidden', marginTop: 6 },
  fill: { height: '100%' },
  cap: { fontFamily: font.regular, fontSize: 14.5, marginTop: 6, fontVariant: ['lining-nums'] },
  stats: { flexDirection: 'row', gap: 10, marginTop: 22, paddingVertical: 12, borderTopWidth: 1, borderBottomWidth: 1 },
  stat: { flex: 1, alignItems: 'flex-start' },
  statN: { fontFamily: font.serif, fontSize: 28, lineHeight: 34, fontVariant: ['lining-nums'] },
  statL: { fontFamily: font.regular, fontSize: 13.5 },
  h2: { fontFamily: font.serif, fontSize: 20, marginTop: 24, marginBottom: 10 },
  chart: { flexDirection: 'row', gap: 6, alignItems: 'flex-end', height: CHART_H + 44 },
  col: { flex: 1, alignItems: 'stretch', gap: 3 },
  val: { fontFamily: font.regular, fontSize: 13, textAlign: 'center', fontVariant: ['lining-nums'] },
  colBar: { borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  colL: { fontSize: 12.5, textAlign: 'center' },
  gRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 7 },
  gName: { width: 62, fontFamily: font.regular, fontSize: 14.5 },
  gTrack: { flex: 1, height: 12, borderRadius: 6, overflow: 'hidden' },
  gFill: { height: '100%' },
  gVal: { width: 30, fontFamily: font.bold, fontSize: 14.5, fontVariant: ['tabular-nums', 'lining-nums'] },
  rules: { gap: 6 },
  rule: { fontFamily: font.regular, fontSize: 15 },
});

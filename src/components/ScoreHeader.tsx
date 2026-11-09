import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, { interpolateColor, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { STREAK_GOAL, type DayStats } from '../domain/logic';
import type { Task } from '../domain/types';
import { fmtDate, fmtDay, t as tr } from '../i18n';
import { font, useTheme } from '../theme';
import { TextLink } from './ui';

function useCountUp(value: number) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = from.current;
    if (start === value) return;
    const t0 = Date.now();
    let raf = 0;
    const tick = () => {
      const k = Math.min(1, (Date.now() - t0) / 380);
      setShown(Math.round(start + (value - start) * k));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    from.current = value;
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return shown;
}

export const ScoreHeader = React.forwardRef<any, {
  date: string; today: string; stats: DayStats; tasks: Task[]; level: number; streak: number; onToday: () => void;
}>(function ScoreHeader({ date, today, stats, tasks, level, streak, onToday }, scoreRef) {
  const t = useTheme();
  const { height } = useWindowDimensions();
  const isToday = date === today;
  const shown = useCountUp(stats.done);
  const pct = useSharedValue(stats.pct);
  const closed = useSharedValue(stats.closed ? 1 : 0);
  useEffect(() => {
    pct.value = withTiming(stats.pct, { duration: 500 });
    closed.value = withTiming(stats.closed ? 1 : 0, { duration: 420 });
  }, [stats.pct, stats.closed, pct, closed]);

  const bgStyle = useAnimatedStyle(() => ({ backgroundColor: interpolateColor(closed.value, [0, 1], [t.paper, t.accent]) }));
  const fillStyle = useAnimatedStyle(() => ({ width: `${pct.value * 100}%` }));

  const fg = stats.closed ? t.onAccent : t.ink;
  const fill = stats.closed ? t.onAccent : t.accent;
  const track = stats.closed ? t.onAccent : t.wash;
  const cut = stats.closed ? t.accent : t.paper;
  const big = height < 720 ? 40 : 46;

  // Finished work comes first, so the bar always loads as one unbroken run.
  const ordered = [...tasks.filter((x) => x.doneAt), ...tasks.filter((x) => !x.doneAt)];
  const planned = ordered.reduce((a, x) => a + x.points, 0);
  const scale = Math.max(stats.total, planned, 1);
  const cuts: number[] = [];
  let run = 0;
  ordered.slice(0, -1).forEach((x) => {
    run += x.points;
    cuts.push((run / scale) * 100);
  });

  const message = !stats.total
    ? tr.barEmpty
    : stats.closed
      ? tr.barClosed(stats.done)
      : stats.toStreak > 0
        ? tr.barToStreak(stats.toStreak)
        : tr.barToClose(stats.left);

  return (
    <Animated.View style={[s.wrap, bgStyle]}>
      <View style={s.top}>
        <Text style={[s.date, { color: fg }]}>{`${isToday ? `${tr.today}, ` : ''}יום ${fmtDay(date)}, ${fmtDate(date)}`}</Text>
        {isToday ? (
          <Text style={[s.rank, { color: fg }]}>{`${tr.level} ${level} · ${tr.streak} ${streak}`}</Text>
        ) : (
          <TextLink label={tr.backToToday} onPress={onToday} />
        )}
      </View>
      <View style={s.score}>
        <View ref={scoreRef} collapsable={false}>
          <Text style={[s.big, { color: fg, fontSize: big, lineHeight: big * 1.08 }]} accessibilityLabel={`${stats.done} ${tr.points}`}>{shown}</Text>
        </View>
        <Text style={[s.total, { color: fg }]}>{`/ ${stats.total} ${tr.pts}`}</Text>
        <Text style={[s.count, { color: fg }]}>{tr.ofTasks(stats.doneCount, stats.count)}</Text>
      </View>
      <View
        style={[s.bar, { backgroundColor: track }]}
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: 100, now: Math.round(stats.pct * 100) }}
      >
        <Animated.View style={[s.fill, { backgroundColor: fill }, fillStyle]} />
        {cuts.map((c, i) => (
          <View key={i} style={[s.cut, { start: `${c}%`, backgroundColor: cut }]} />
        ))}
        {stats.total ? <View style={[s.mark, { start: `${STREAK_GOAL * 100}%`, backgroundColor: fg }]} /> : null}
      </View>
      <Text style={[s.msg, { color: fg }]} accessibilityLiveRegion="polite">{message}</Text>
    </Animated.View>
  );
});

const s = StyleSheet.create({
  wrap: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 8 },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 },
  date: { fontFamily: font.semibold, fontSize: 13.5, flexShrink: 1 },
  rank: { fontFamily: font.regular, fontSize: 13.5, opacity: 0.72, fontVariant: ['tabular-nums', 'lining-nums'] },
  score: { flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 0 },
  big: { fontFamily: font.black, fontVariant: ['tabular-nums', 'lining-nums'] },
  total: { fontFamily: font.light, fontSize: 19, opacity: 0.72, fontVariant: ['lining-nums'] },
  count: { fontFamily: font.regular, fontSize: 13.5, opacity: 0.72, marginStart: 'auto' },
  bar: { height: 16, borderRadius: 6, marginTop: 4 },
  fill: { position: 'absolute', top: 0, bottom: 0, start: 0, borderRadius: 6 },
  cut: { position: 'absolute', top: 0, bottom: 0, width: 2, marginStart: -1 },
  mark: { position: 'absolute', top: -4, bottom: -4, width: 2, marginStart: -1 },
  msg: { fontFamily: font.semibold, fontSize: 13.5, marginTop: 5, minHeight: 18 },
});

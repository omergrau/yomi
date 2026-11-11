// The day's score: the date, the points and one thin bar with the streak mark. The words stay for screen readers.
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, { interpolateColor, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { STREAK_GOAL, type DayStats } from '../domain/logic';
import type { Task } from '../domain/types';
import { fmtDay, fmtShort, t as tr } from '../i18n';
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
  date: string; today: string; stats: DayStats; tasks: Task[]; level: number; streak: number; onToday: () => void; alarm?: string | null; onAlarm?: () => void;
}>(function ScoreHeader({ date, today, stats, onToday, alarm, onAlarm }, scoreRef) {
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
  const track = stats.closed ? 'rgba(255,255,255,0.28)' : t.wash;
  const big = height < 720 ? 26 : 30;

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
        <Text style={[s.date, { color: fg }]}>{`${fmtDay(date)}, ${fmtShort(date)}`}</Text>
        <View style={s.topEnd}>
          {!isToday ? <TextLink label={tr.backToToday} onPress={onToday} /> : null}
          {/* The next alarm, and the way to the alarms screen. */}
          {onAlarm ? (
            <Pressable onPress={onAlarm} hitSlop={10} accessibilityRole="button" accessibilityLabel={tr.alarms}>
              <Text style={[s.alarm, { color: fg, opacity: alarm ? 0.75 : 0.35 }]}>{alarm ? `⏰ ${alarm}` : '⏰'}</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
      <View style={s.score}>
        <View style={s.num}>
        <View ref={scoreRef} collapsable={false}>
          <Text
            style={[s.big, { color: fg, fontSize: big, lineHeight: big * 1.08 }]}
            accessibilityLabel={`${stats.done} / ${stats.total} ${tr.pts}, ${tr.ofTasks(stats.doneCount, stats.count)}`}
          >
            {shown}
          </Text>
        </View>
        <Text style={[s.total, { color: fg }]}>{`/ ${stats.total}`}</Text>
        </View>
      <View
        style={[s.bar, { backgroundColor: track }]}
        accessibilityRole="progressbar"
        accessibilityLabel={message}
        accessibilityValue={{ min: 0, max: 100, now: Math.round(stats.pct * 100) }}
      >
        <Animated.View style={[s.fill, { backgroundColor: fill }, fillStyle]} />
        {stats.total && !stats.closed ? <View style={[s.mark, { start: `${STREAK_GOAL * 100}%`, backgroundColor: fg }]} /> : null}
      </View>
      </View>
    </Animated.View>
  );
});

const s = StyleSheet.create({
  wrap: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 8 },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 },
  date: { fontFamily: font.medium, fontSize: 14, opacity: 0.7, flexShrink: 1, fontVariant: ['tabular-nums', 'lining-nums'] },
  topEnd: { flexDirection: 'row', alignItems: 'baseline', gap: 14 },
  alarm: { fontFamily: font.medium, fontSize: 14, fontVariant: ['tabular-nums', 'lining-nums'] },
  score: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 2 },
  num: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  big: { fontFamily: font.black, fontVariant: ['tabular-nums', 'lining-nums'] },
  total: { fontFamily: font.light, fontSize: 15, opacity: 0.45, fontVariant: ['lining-nums'] },
  bar: { flex: 1, height: 4, borderRadius: 2 },
  fill: { position: 'absolute', top: 0, bottom: 0, start: 0, borderRadius: 2 },
  mark: { position: 'absolute', top: -3, bottom: -3, width: 2, marginStart: -1, opacity: 0.35 },
});

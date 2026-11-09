// The "My day" screen. Lifting and dragging run on the UI thread, using the layer proven in the feasibility test.
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import {
  FlatList,
  GestureDetector,
  ScrollView,
  useExclusiveGestures,
  usePanGesture,
  useTapGesture,
} from 'react-native-gesture-handler';
import Animated, {
  LinearTransition,
  interpolateColor,
  measure,
  runOnUI,
  scrollTo,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useFrameCallback,
  useSharedValue,
  withSpring,
  withTiming,
  type AnimatedRef,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { addDays, parseIso, weekDays } from '../domain/dates';
import { dayStats, dayTasks, levelInfo, poolTasks, streak as streakOf, totalPoints } from '../domain/logic';
import type { Group, Points, Recurring, Task } from '../domain/types';
import { t as tr } from '../i18n';
import { buzzLift, dropOnDay, moveToTomorrow, openSheet, quickAdd, removeFromDay, setView, toggleDone, useApp } from '../store';
import { RTL, font, useTheme, type Theme } from '../theme';
import { ScoreHeader } from './ScoreHeader';
import { TopicPicker } from './TopicPicker';
import { Chip, Dot, Pips } from './ui';

const AnimatedScroll = Animated.createAnimatedComponent(ScrollView);
const PEEK = 59;
const SWIPE_COMMIT = 92;

type Zone = 'none' | 'list' | 'pool' | 'day';
type Source = 'list' | 'pool';
type Drag = {
  active: SharedValue<string>;
  from: SharedValue<Source>;
  srcIndex: SharedValue<number>;
  zone: SharedValue<Zone>;
  insert: SharedValue<number>;
  rowH: SharedValue<number>;
  fingerX: SharedValue<number>;
  fingerY: SharedValue<number>;
  calibY: SharedValue<number>;
  baseX: SharedValue<number>;
  baseY: SharedValue<number>;
  tx: SharedValue<number>;
  ty: SharedValue<number>;
  scale: SharedValue<number>;
  drawerH: SharedValue<number>;
  prevH: SharedValue<number>;
  rootRef: AnimatedRef<View>;
};

function metaLine(task: Task, groupName: string | undefined, showGroup: boolean, series?: Recurring) {
  const parts: string[] = [];
  if (task.time) parts.push(series?.endTime ? `${task.time}–${series.endTime}` : task.time);
  if (series?.place) parts.push(series.place);
  if (showGroup && groupName) parts.push(groupName);
  if (task.recurringId) parts.push(tr.fixed);
  if (task.reminderMin !== null) parts.push(tr.reminder);
  if (task.deferrals === 1) parts.push(tr.deferredOnce);
  if (task.deferrals > 1) parts.push(tr.deferred(task.deferrals));
  return parts.join(' · ');
}

function RowBody({ task, group, showGroup, series, t }: { task: Task; group?: Group; showGroup: boolean; series?: Recurring; t: Theme }) {
  const done = !!task.doneAt;
  const meta = metaLine(task, group?.name, showGroup, series);
  return (
    <>
      <View style={s.body}>
        <Text style={[s.title, { color: done ? t.soft : t.ink, textDecorationLine: done ? 'line-through' : 'none' }]}>{task.title}</Text>
        {meta ? (
          <View style={s.meta}>
            {showGroup && group ? <Dot color={group.color} /> : null}
            <Text style={[s.metaT, { color: t.mute }]}>{meta}</Text>
          </View>
        ) : null}
      </View>
      <Pips points={task.points} muted={done} />
    </>
  );
}

function useLiftGesture(task: Task, zone: Source, index: number, d: Drag, ref: AnimatedRef<View>, onLift: (x: Task, w: number, h: number, from: Source) => void, onDrop: () => void) {
  return usePanGesture({
    activateAfterLongPress: 220,
    onActivate: (e) => {
      'worklet';
      const m = measure(ref);
      const root = measure(d.rootRef);
      if (!m || !root) return;
      // The ghost starts at the layout edge of its overlay, so the base offset is physical.
      d.baseX.value = RTL ? m.pageX + m.width - (root.pageX + root.width) : m.pageX - root.pageX;
      d.baseY.value = m.pageY - root.pageY;
      d.calibY.value = m.pageY + e.y - e.absoluteY;
      d.fingerX.value = e.absoluteX;
      d.fingerY.value = e.absoluteY + d.calibY.value;
      d.tx.value = 0;
      d.ty.value = 0;
      d.rowH.value = m.height;
      d.from.value = zone;
      d.srcIndex.value = index;
      d.zone.value = 'none';
      d.insert.value = index;
      d.prevH.value = d.drawerH.value;
      d.drawerH.value = withTiming(PEEK, { duration: 200 });
      d.scale.value = withTiming(1.03, { duration: 120 });
      d.active.value = task.id;
      scheduleOnRN(onLift, task, m.width, m.height, zone);
    },
    onUpdate: (e) => {
      'worklet';
      d.tx.value = e.translationX;
      d.ty.value = e.translationY;
      d.fingerX.value = e.absoluteX;
      d.fingerY.value = e.absoluteY + d.calibY.value;
    },
    onFinalize: () => {
      'worklet';
      if (d.active.value === task.id) scheduleOnRN(onDrop);
    },
  });
}

const DayRow = React.memo(function DayRow({
  task, group, series, index, d, width, onLift, onDrop, onToggle,
}: {
  task: Task; group?: Group; series?: Recurring; index: number; d: Drag; width: number;
  onLift: (x: Task, w: number, h: number, from: Source) => void; onDrop: () => void; onToggle: (x: Task, px: number, py: number) => void;
}) {
  const t = useTheme();
  const ref = useAnimatedRef<View>();
  const sx = useSharedValue(0);
  const id = task.id;
  const lift = useLiftGesture(task, 'list', index, d, ref, onLift, onDrop);
  const swipe = usePanGesture({
    activeOffsetX: [-14, 14],
    failOffsetY: [-12, 12],
    onUpdate: (e) => {
      'worklet';
      sx.value = e.translationX;
    },
    onDeactivate: () => {
      'worklet';
      const v = sx.value;
      if (Math.abs(v) > SWIPE_COMMIT) {
        // Dragging toward the right removes it from the day. Dragging toward the left moves it to tomorrow.
        sx.value = withTiming(v > 0 ? width : -width, { duration: 150 }, () => {
          scheduleOnRN(v > 0 ? removeFromDay : moveToTomorrow, id);
        });
      } else {
        sx.value = withSpring(0, { damping: 22, stiffness: 240 });
      }
    },
  });
  const tap = useTapGesture({
    onDeactivate: () => {
      'worklet';
      scheduleOnRN(openSheet, { id });
    },
  });
  const gesture = useExclusiveGestures(lift, swipe, tap);

  const rowStyle = useAnimatedStyle(() => {
    const a = d.active.value;
    if (!a) return { opacity: 1, transform: [{ translateY: 0 }] };
    if (a === id) return { opacity: 0, transform: [{ translateY: 0 }] };
    let shift = 0;
    const inList = d.zone.value === 'list';
    if (d.from.value === 'list') {
      const src = d.srcIndex.value;
      const ins = inList ? d.insert.value : Number.MAX_SAFE_INTEGER;
      if (index > src && index < ins) shift = -d.rowH.value;
      else if (index >= ins && index < src) shift = d.rowH.value;
    } else if (inList && index >= d.insert.value) {
      shift = d.rowH.value;
    }
    return { opacity: 1, transform: [{ translateY: withTiming(shift, { duration: 160 }) }] };
  });
  const fgStyle = useAnimatedStyle(() => ({ transform: [{ translateX: sx.value }] }));

  const done = !!task.doneAt;
  return (
    <Animated.View ref={ref} collapsable={false} style={[{ borderBottomColor: t.line, borderBottomWidth: 1 }, rowStyle]}>
      <View style={[StyleSheet.absoluteFill, s.under, { backgroundColor: t.ink }]}>
        <Text style={[s.underT, { color: t.paper }]}>{tr.swipeTomorrow}</Text>
        <Text style={[s.underT, { color: t.paper }]}>{tr.swipeRemove}</Text>
      </View>
      <Animated.View style={[s.row, { backgroundColor: t.paper }, fgStyle]}>
        <Pressable
          onPress={(e) => onToggle(task, e.nativeEvent.pageX, e.nativeEvent.pageY)}
          hitSlop={10}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: done }}
          accessibilityLabel={tr.markDone(task.title)}
          style={[s.check, { borderColor: done ? t.accent : t.soft, backgroundColor: done ? t.accent : 'transparent' }]}
        >
          {done ? <Text style={[s.tick, { color: t.onAccent }]}>✓</Text> : null}
        </Pressable>
        <GestureDetector gesture={gesture}>
          <Animated.View style={s.rowMain} accessible accessibilityRole="button" accessibilityLabel={task.title} accessibilityHint={tr.poolHint}>
            <RowBody task={task} group={group} series={series} showGroup t={t} />
          </Animated.View>
        </GestureDetector>
      </Animated.View>
    </Animated.View>
  );
});

/** A finished task: it can be reopened or opened, but it is no longer dragged. */
function DoneRow({ task, group, series, onToggle }: { task: Task; group?: Group; series?: Recurring; onToggle: (x: Task, px: number, py: number) => void }) {
  const t = useTheme();
  return (
    <View style={[s.row, { backgroundColor: t.paper, borderBottomColor: t.line, borderBottomWidth: 1 }]}>
      <Pressable
        onPress={(e) => onToggle(task, e.nativeEvent.pageX, e.nativeEvent.pageY)}
        hitSlop={10}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: true }}
        accessibilityLabel={tr.markDone(task.title)}
        style={[s.check, { borderColor: t.accent, backgroundColor: t.accent }]}
      >
        <Text style={[s.tick, { color: t.onAccent }]}>✓</Text>
      </Pressable>
      <Pressable style={s.rowMain} onPress={() => openSheet({ id: task.id })} accessibilityRole="button" accessibilityLabel={task.title}>
        <RowBody task={task} group={group} series={series} showGroup t={t} />
      </Pressable>
    </View>
  );
}

function PoolRow({ task, index, d, onLift, onDrop }: { task: Task; index: number; d: Drag; onLift: (x: Task, w: number, h: number, from: Source) => void; onDrop: () => void }) {
  const t = useTheme();
  const ref = useAnimatedRef<View>();
  const id = task.id;
  const lift = useLiftGesture(task, 'pool', index, d, ref, onLift, onDrop);
  const tap = useTapGesture({
    onDeactivate: () => {
      'worklet';
      scheduleOnRN(openSheet, { id });
    },
  });
  const gesture = useExclusiveGestures(lift, tap);
  const style = useAnimatedStyle(() => ({ opacity: d.active.value === id ? 0.25 : 1 }));
  return (
    <GestureDetector gesture={gesture}>
      <Animated.View ref={ref} collapsable={false} style={[s.poolRow, { borderBottomColor: t.line }, style]} accessible accessibilityRole="button" accessibilityLabel={task.title}>
        <RowBody task={task} showGroup={false} t={t} />
      </Animated.View>
    </GestureDetector>
  );
}

/**
 * Adds to the day being viewed. Once typing starts, urgency and topic appear right under the field,
 * so a task gets both without opening anything. The choice stays for the next task until the field is left.
 */
function QuickAdd({ t, groups }: { t: Theme; groups: Group[] }) {
  const [text, setText] = useState('');
  const [points, setPoints] = useState<Points>(3);
  const [groupId, setGroupId] = useState<string | null>(null);
  const submit = () => {
    if (!text.trim()) return;
    quickAdd(text, points, groupId);
    setText('');
  };
  const open = !!text.trim();
  return (
    <View style={[s.quickBox, { backgroundColor: t.wash }]}>
      <View style={s.quick}>
        <Text style={[s.quickPlus, { color: t.accent }]}>+</Text>
        <TextInput
          value={text}
          onChangeText={setText}
          onSubmitEditing={submit}
          onBlur={() => {
            if (!text.trim()) {
              setPoints(3);
              setGroupId(null);
            }
          }}
          submitBehavior="submit"
          returnKeyType="done"
          maxLength={120}
          placeholder={tr.quickAdd}
          placeholderTextColor={t.mute}
          style={[s.quickIn, { color: t.ink }]}
          accessibilityLabel={tr.quickAdd}
        />
        {open ? (
          <Pressable onPress={submit} hitSlop={8} style={[s.quickGo, { backgroundColor: t.accent }]} accessibilityRole="button" accessibilityLabel={tr.add}>
            <Text style={[s.quickGoT, { color: t.onAccent }]}>✓</Text>
          </Pressable>
        ) : null}
      </View>
      {open ? (
        <View style={s.quickOpts}>
          <View style={s.quickRow}>
            <Text style={[s.quickLabel, { color: t.mute }]}>{tr.worth}</Text>
            {[1, 2, 3, 4, 5].map((n) => (
              <Pressable
                key={n}
                onPress={() => setPoints(n as Points)}
                hitSlop={3}
                accessibilityRole="radio"
                accessibilityState={{ selected: points === n }}
                aria-checked={points === n}
                accessibilityLabel={tr.ptsLabel(n)}
                style={[s.quickPt, { backgroundColor: n <= points ? t.accent : t.paper }]}
              >
                <Text style={[s.quickPtT, { color: n <= points ? t.onAccent : t.mute }]}>{n}</Text>
              </Pressable>
            ))}
          </View>
          <View style={[s.quickRow, s.quickTopic]}>
            <Text style={[s.quickLabel, { color: t.mute }]}>{tr.topic}</Text>
            <TopicPicker groups={groups} value={groupId} onChange={setGroupId} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

function DayCell({ date, index, highlight, today, selected, stats, onPress, t }: {
  date: string; index: number; highlight: SharedValue<number>; today: string; selected: boolean; stats: { pct: number; total: number }; onPress: () => void; t: Theme;
}) {
  const d = parseIso(date);
  const past = date < today;
  const hlBg = useAnimatedStyle(() => ({ opacity: highlight.value === index && !past ? 1 : 0 }));
  return (
    <Pressable
      style={[s.cell, past ? { opacity: 0.55 } : null, selected ? { borderBottomColor: t.ink } : null]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`יום ${tr.days[d.getDay()]}, ${d.getDate()}`}
    >
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: t.accent, opacity: 0.22 }, hlBg]} />
      <Text style={[s.cellL, { color: t.mute }]}>{tr.dayLetters[d.getDay()]}</Text>
      <Text style={[s.cellN, { color: t.ink, fontFamily: date === today ? font.black : font.serif }]}>{d.getDate()}</Text>
      <View style={[s.cellBar, { backgroundColor: stats.total ? t.line : 'transparent' }]}>
        <View style={[s.cellFill, { width: `${stats.pct * 100}%`, backgroundColor: t.accent }]} />
      </View>
    </Pressable>
  );
}

function Fly({ x, y, tx, ty, points, color, onEnd }: { x: number; y: number; tx: number; ty: number; points: number; color: string; onEnd: () => void }) {
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withTiming(1, { duration: 620 }, () => {
      scheduleOnRN(onEnd);
    });
    // Runs once per flying number.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const style = useAnimatedStyle(() => {
    const k = p.value;
    const lift = k < 0.25 ? (k / 0.25) * -14 : -14;
    const go = k < 0.25 ? 0 : (k - 0.25) / 0.75;
    return {
      opacity: 1 - go * 0.9,
      transform: [{ translateX: (tx - x) * go }, { translateY: lift + (ty - y + 14) * go }, { scale: 1 + (k < 0.25 ? k : 0.25 - go * 0.5) }],
    };
  });
  return <Animated.Text style={[s.fly, { left: x - 12, top: y - 20, color }, style]}>{`+${points}`}</Animated.Text>;
}

type PoolItem = { kind: 'head'; key: string; group?: Group } | { kind: 'task'; key: string; task: Task; index: number };

export default function TodayScreen() {
  const t = useTheme();
  const { data, today, view } = useApp();
  const { height: winH, width: winW } = useWindowDimensions();
  const HALF = Math.round(winH * 0.46);
  const FULL = Math.round(winH * 0.74);

  const stats = useMemo(() => dayStats(data, view), [data, view]);
  const rows = useMemo(() => dayTasks(data, view), [data, view]);
  const pool = useMemo(() => poolTasks(data), [data]);
  const week = useMemo(() => weekDays(view), [view]);
  const groups = useMemo(() => new Map(data.groups.map((g) => [g.id, g])), [data.groups]);
  const total = useMemo(() => totalPoints(data), [data]);
  const streak = useMemo(() => streakOf(data, today), [data, today]);

  const [ghost, setGhost] = useState<{ task: Task; w: number; h: number; from: Source } | null>(null);
  const [filter, setFilter] = useState<string>('all');
  // A task added elsewhere must not be hidden by a filter left on from before.
  const poolCount = useRef(pool.length);
  useEffect(() => {
    if (pool.length > poolCount.current) setFilter('all');
    poolCount.current = pool.length;
  }, [pool.length]);
  const [flies, setFlies] = useState<{ id: number; x: number; y: number; tx: number; ty: number; points: number }[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [, setTick] = useState(0);

  const rootRef = useAnimatedRef<View>();
  const listRef = useAnimatedRef<View>();
  const scrollRef = useAnimatedRef<any>();
  const stripRef = useAnimatedRef<View>();
  const scoreRef = useRef<any>(null);
  const scrollY = useSharedValue(0);

  const d: Drag = {
    active: useSharedValue(''),
    from: useSharedValue<Source>('pool'),
    srcIndex: useSharedValue(0),
    zone: useSharedValue<Zone>('none'),
    insert: useSharedValue(0),
    rowH: useSharedValue(48),
    fingerX: useSharedValue(0),
    fingerY: useSharedValue(0),
    calibY: useSharedValue(0),
    baseX: useSharedValue(0),
    baseY: useSharedValue(0),
    tx: useSharedValue(0),
    ty: useSharedValue(0),
    scale: useSharedValue(1),
    drawerH: useSharedValue(PEEK),
    prevH: useSharedValue(PEEK),
    rootRef,
  };
  const dayIndex = useSharedValue(-1);
  const layouts = useSharedValue<{ y: number; h: number }[]>([]);
  const cache = useRef<Record<string, { y: number; h: number }>>({});
  const idsRef = useRef<string[]>([]);
  const openRows = useMemo(() => rows.filter((x) => !x.doneAt), [rows]);
  const doneRows = useMemo(() => rows.filter((x) => x.doneAt), [rows]);
  const series = useMemo(() => new Map(data.recurring.map((r) => [r.id, r])), [data.recurring]);
  idsRef.current = openRows.map((x) => x.id);

  const publish = useCallback(() => {
    layouts.value = idsRef.current.map((id) => cache.current[id] ?? { y: 0, h: 48 });
  }, [layouts]);
  useEffect(publish, [openRows, publish]);

  useFrameCallback(() => {
    'worklet';
    if (!d.active.value) return;
    const root = measure(rootRef);
    const list = measure(listRef);
    const strip = measure(stripRef);
    if (!root || !list || !strip) return;
    const y = d.fingerY.value;
    const drawerTop = root.pageY + root.height - d.drawerH.value;
    const stripBottom = strip.pageY + strip.height;
    if (y >= drawerTop) {
      d.zone.value = 'pool';
    } else if (y <= stripBottom + 6) {
      if (y >= strip.pageY - 6) {
        let idx = Math.floor(((d.fingerX.value - strip.pageX) / strip.width) * 7);
        idx = Math.max(0, Math.min(6, idx));
        // Cells follow the layout direction, so the first day is on the right in RTL.
        dayIndex.value = RTL ? 6 - idx : idx;
        d.zone.value = 'day';
      } else {
        d.zone.value = 'none';
      }
    } else {
      d.zone.value = 'list';
    }
    if (d.zone.value !== 'day') dayIndex.value = -1;
    if (d.zone.value === 'list') {
      const cy = y - list.pageY;
      const ls = layouts.value;
      let ins = ls.length;
      for (let i = 0; i < ls.length; i++) {
        if (cy < ls[i].y + ls[i].h / 2) {
          ins = i;
          break;
        }
      }
      d.insert.value = ins;
      if (y < stripBottom + 52 && scrollY.value > 0) scrollTo(scrollRef, 0, Math.max(0, scrollY.value - 6), false);
      else if (y > drawerTop - 44) scrollTo(scrollRef, 0, scrollY.value + 6, false);
    }
  });

  const ghostStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: d.baseX.value + d.tx.value }, { translateY: d.baseY.value + d.ty.value }, { scale: d.scale.value }],
    opacity: d.active.value ? 1 : 0,
  }));
  const drawerStyle = useAnimatedStyle(() => ({ transform: [{ translateY: FULL - d.drawerH.value }] }));
  const dropStyle = useAnimatedStyle(() => ({
    opacity: d.active.value ? 1 : 0,
    backgroundColor: interpolateColor(d.zone.value === 'pool' ? 1 : 0, [0, 1], [t.wash, t.ink]),
  }));
  const dropTextStyle = useAnimatedStyle(() => ({
    color: interpolateColor(d.zone.value === 'pool' ? 1 : 0, [0, 1], [t.ink, t.paper]),
  }));

  const pendingClear = useRef(false);
  useLayoutEffect(() => {
    if (!pendingClear.current) return;
    pendingClear.current = false;
    runOnUI(() => {
      'worklet';
      d.active.value = '';
      d.zone.value = 'none';
      d.scale.value = 1;
      d.drawerH.value = withSpring(d.prevH.value, { damping: 22, stiffness: 220 });
      dayIndex.value = -1;
    })();
    setGhost(null);
  });

  const onLift = useCallback((task: Task, w: number, h: number, from: Source) => {
    buzzLift();
    setGhost({ task, w, h, from });
  }, []);

  const finishDrop = useCallback(
    (id: string, from: Source, src: number, zone: Zone, insert: number, day: number) => {
      // The drop slot counts open tasks only, so it is translated to a place among all of the day's tasks.
      const toFull = (k: number) => {
        const others = rows.filter((x) => x.id !== id);
        const open = others.filter((x) => !x.doneAt);
        if (k < open.length) return others.indexOf(open[k]);
        return open.length ? others.indexOf(open[open.length - 1]) + 1 : 0;
      };
      const k = from === 'list' && insert > src ? insert - 1 : insert;
      if (zone === 'list' && (view >= today || from === 'list')) {
        dropOnDay(id, view, toFull(k));
      } else if (zone === 'day' && day >= 0) {
        const date = week[day];
        if (date >= today && date !== view) dropOnDay(id, date);
      } else if (zone === 'pool' && from === 'list') {
        removeFromDay(id);
      }
      pendingClear.current = true;
      // Forces the layout effect even when nothing changed, as in a cancelled drag.
      setTick((n) => n + 1);
    },
    [rows, today, view, week],
  );

  const onDrop = useCallback(() => {
    runOnUI(() => {
      'worklet';
      scheduleOnRN(finishDrop, d.active.value, d.from.value, d.srcIndex.value, d.zone.value, d.insert.value, dayIndex.value);
    })();
    // The shared values are stable for the life of the screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finishDrop]);

  const noteDrawer = useCallback((open: boolean) => setDrawerOpen(open), []);
  const headPan = usePanGesture({
    minDistance: 6,
    onUpdate: (e) => {
      'worklet';
      d.drawerH.value = Math.max(PEEK, Math.min(FULL, d.drawerH.value - e.changeY));
    },
    onDeactivate: () => {
      'worklet';
      const h = d.drawerH.value;
      let best = PEEK;
      for (const p of [PEEK, HALF, FULL]) if (Math.abs(p - h) < Math.abs(best - h)) best = p;
      d.drawerH.value = withSpring(best, { damping: 22, stiffness: 220 });
      scheduleOnRN(noteDrawer, best > PEEK);
    },
  });
  const headTap = useTapGesture({
    onDeactivate: () => {
      'worklet';
      const open = d.drawerH.value < HALF - 4;
      d.drawerH.value = withSpring(open ? HALF : PEEK, { damping: 22, stiffness: 220 });
      scheduleOnRN(noteDrawer, open);
    },
  });
  const headGesture = useExclusiveGestures(headPan, headTap);
  const onScroll = useAnimatedScrollHandler((e) => {
    scrollY.value = e.contentOffset.y;
  });

  const onToggle = useCallback((task: Task, px: number, py: number) => {
    if (!task.doneAt) {
      const points = task.points;
      (rootRef.current as any)?.measureInWindow((rx: number, ry: number) => {
        scoreRef.current?.measureInWindow((sx: number, sy: number, sw: number) => {
          setFlies((f) => [...f, { id: Date.now(), x: px - rx, y: py - ry, tx: sx - rx + sw / 2, ty: sy - ry + 30, points }]);
        });
      });
    }
    toggleDone(task.id);
    // rootRef is a stable animated ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const items = useMemo<PoolItem[]>(() => {
    const out: PoolItem[] = [];
    let index = 0;
    const list = filter === 'all' ? pool : pool.filter((x) => x.groupId === filter);
    if (filter !== 'all') {
      list.forEach((task) => out.push({ kind: 'task', key: task.id, task, index: index++ }));
      return out;
    }
    data.groups.forEach((g) => {
      const mine = list.filter((x) => x.groupId === g.id);
      if (!mine.length) return;
      out.push({ kind: 'head', key: `h-${g.id}`, group: g });
      mine.forEach((task) => out.push({ kind: 'task', key: task.id, task, index: index++ }));
    });
    const rest = list.filter((x) => !x.groupId || !groups.has(x.groupId));
    if (rest.length) {
      out.push({ kind: 'head', key: 'h-none' });
      rest.forEach((task) => out.push({ kind: 'task', key: task.id, task, index: index++ }));
    }
    return out;
  }, [data.groups, filter, groups, pool]);

  return (
    <View ref={rootRef} style={[s.root, { backgroundColor: t.paper }]} collapsable={false}>
      <ScoreHeader
        ref={scoreRef}
        date={view}
        today={today}
        stats={stats}
        tasks={rows}
        level={levelInfo(total).level}
        streak={streak}
        onToday={() => setView(today)}
      />
      <View style={[s.stripWrap, { borderColor: t.line }]}>
        <Pressable onPress={() => setView(addDays(view, -7))} hitSlop={6} style={s.arrow} accessibilityRole="button" accessibilityLabel={tr.weekPrev}>
          <Text style={[s.arrowT, { color: t.mute }]}>{RTL ? '›' : '‹'}</Text>
        </Pressable>
        <View ref={stripRef} collapsable={false} style={s.strip}>
          {week.map((date, i) => (
            <DayCell
              key={date}
              date={date}
              index={i}
              highlight={dayIndex}
              today={today}
              selected={date === view}
              stats={dayStats(data, date)}
              onPress={() => setView(date)}
              t={t}
            />
          ))}
        </View>
        <Pressable onPress={() => setView(addDays(view, 7))} hitSlop={6} style={s.arrow} accessibilityRole="button" accessibilityLabel={tr.weekNext}>
          <Text style={[s.arrowT, { color: t.mute }]}>{RTL ? '‹' : '›'}</Text>
        </Pressable>
      </View>

      <AnimatedScroll ref={scrollRef} onScroll={onScroll} scrollEventThrottle={16} style={s.flex} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: PEEK + 28 + (drawerOpen ? HALF : 0) }}>
        <QuickAdd t={t} groups={data.groups} />
        <View ref={listRef} collapsable={false} style={{ minHeight: doneRows.length ? 64 : 120 }}>
          {openRows.length ? (
            openRows.map((task, index) => (
              <Animated.View
                key={task.id}
                layout={LinearTransition.duration(260)}
                onLayout={(e) => {
                  cache.current[task.id] = { y: e.nativeEvent.layout.y, h: e.nativeEvent.layout.height };
                  publish();
                }}
              >
                <DayRow
                  task={task}
                  group={task.groupId ? groups.get(task.groupId) : undefined}
                  series={task.recurringId ? series.get(task.recurringId) : undefined}
                  index={index}
                  d={d}
                  width={winW}
                  onLift={onLift}
                  onDrop={onDrop}
                  onToggle={onToggle}
                />
              </Animated.View>
            ))
          ) : !doneRows.length ? (
            <Text style={[s.empty, { color: t.mute }]}>{tr.emptyDay}</Text>
          ) : null}
        </View>
        {doneRows.length ? <Text style={[s.doneHead, { color: t.mute }]}>{tr.doneSection(doneRows.length)}</Text> : null}
        {doneRows.map((task) => (
          <Animated.View key={task.id} layout={LinearTransition.duration(260)}>
            <DoneRow
              task={task}
              group={task.groupId ? groups.get(task.groupId) : undefined}
              series={task.recurringId ? series.get(task.recurringId) : undefined}
              onToggle={onToggle}
            />
          </Animated.View>
        ))}
      </AnimatedScroll>

      <Animated.View style={[s.drawer, { height: FULL, backgroundColor: t.paper, borderTopColor: t.line, shadowColor: t.shadow }, drawerStyle]}>
        <GestureDetector gesture={headGesture}>
          <View style={s.dhead} accessible accessibilityRole="button" accessibilityLabel={tr.pool} accessibilityState={{ expanded: drawerOpen }}>
            <View style={s.dheadRow}>
              <Text style={[s.dtitle, { color: t.ink }]}>{tr.pool}</Text>
              <Text style={[s.dcount, { color: t.mute }]}>{pool.length}</Text>
            </View>
            <Text style={[s.dhint, { color: t.mute }]}>{drawerOpen ? tr.poolHint : tr.poolPull}</Text>
            <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, s.drop, dropStyle]}>
              <Animated.Text style={[s.dropT, dropTextStyle]}>{ghost?.from === 'pool' ? tr.dropKeep : tr.dropRemove}</Animated.Text>
            </Animated.View>
          </View>
        </GestureDetector>
        <View style={s.chipsWrap}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
            <Chip label={tr.all} on={filter === 'all'} onPress={() => setFilter('all')} />
            {data.groups.map((g) => (
              <Chip key={g.id} label={g.name} color={g.color} on={filter === g.id} onPress={() => setFilter(g.id)} />
            ))}
          </ScrollView>
        </View>
        <FlatList
          data={items}
          keyExtractor={(x: PoolItem) => x.key}
          contentContainerStyle={{ paddingBottom: FULL - HALF + 24 }}
          removeClippedSubviews={false}
          extraData={items}
          initialNumToRender={14}
          windowSize={7}
          ListEmptyComponent={<Text style={[s.empty, { color: t.mute }]}>{pool.length ? tr.poolEmpty : tr.poolEmptyFirst}</Text>}
          renderItem={({ item }: { item: PoolItem }) =>
            item.kind === 'head' ? (
              <View style={s.ghead}>
                {item.group ? <Dot color={item.group.color} /> : null}
                <Text style={[s.gheadT, { color: t.mute }]}>{item.group?.name ?? tr.noGroup}</Text>
              </View>
            ) : (
              <PoolRow task={item.task} index={item.index} d={d} onLift={onLift} onDrop={onDrop} />
            )
          }
        />
      </Animated.View>

      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        {ghost ? (
          <Animated.View style={[s.ghost, { width: ghost.w, minHeight: ghost.h, backgroundColor: t.paper, borderColor: t.accent, shadowColor: t.shadow }, ghostStyle]}>
            <View style={[s.check, { borderColor: t.soft, opacity: ghost.from === 'list' ? 1 : 0, width: ghost.from === 'list' ? 30 : 0 }]} />
            <RowBody task={ghost.task} group={ghost.task.groupId ? groups.get(ghost.task.groupId) : undefined} showGroup t={t} />
          </Animated.View>
        ) : null}
        {flies.map((f) => (
          <Fly key={f.id} {...f} color={t.accent} onEnd={() => setFlies((x) => x.filter((y) => y.id !== f.id))} />
        ))}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, overflow: 'hidden' },
  flex: { flex: 1 },
  stripWrap: { flexDirection: 'row', alignItems: 'stretch', borderTopWidth: 1, borderBottomWidth: 1 },
  strip: { flex: 1, flexDirection: 'row' },
  arrow: { width: 22, alignItems: 'center', justifyContent: 'center' },
  arrowT: { fontFamily: font.regular, fontSize: 22 },
  cell: { flex: 1, alignItems: 'center', paddingTop: 3, paddingBottom: 4, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  cellL: { fontFamily: font.regular, fontSize: 11 },
  cellN: { fontSize: 16, lineHeight: 19, fontVariant: ['lining-nums'] },
  cellBar: { width: '62%', height: 3, marginTop: 2, borderRadius: 2, overflow: 'hidden' },
  cellFill: { height: '100%' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, minHeight: 48 },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6, minHeight: 48 },
  quickBox: { marginHorizontal: 14, marginTop: 6, marginBottom: 2, borderRadius: 10, paddingHorizontal: 12 },
  quick: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  quickGo: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  quickGoT: { fontFamily: font.bold, fontSize: 14, lineHeight: 18 },
  quickOpts: { gap: 6, paddingBottom: 9 },
  quickRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  quickLabel: { fontFamily: font.regular, fontSize: 12.5, width: 50 },
  quickPt: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  quickPtT: { fontFamily: font.semibold, fontSize: 12.5, fontVariant: ['lining-nums'] },
  quickTopic: { alignItems: 'flex-start' },
  quickPlus: { fontFamily: font.semibold, fontSize: 20, lineHeight: 24 },
  quickIn: { flex: 1, fontFamily: font.regular, fontSize: 14.5, paddingVertical: 6 },
  doneHead: { fontFamily: font.semibold, fontSize: 12.5, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
  under: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20 },
  underT: { fontFamily: font.bold, fontSize: 15 },
  check: { width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  tick: { fontFamily: font.bold, fontSize: 13, lineHeight: 17 },
  body: { flex: 1, minWidth: 0 },
  title: { fontFamily: font.semibold, fontSize: 15.5, lineHeight: 20 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 1 },
  metaT: { flexShrink: 1, fontFamily: font.regular, fontSize: 12.5, fontVariant: ['tabular-nums', 'lining-nums'] },
  empty: { fontFamily: font.regular, fontSize: 15.5, textAlign: 'center', paddingHorizontal: 28, paddingVertical: 32 },
  drawer: { position: 'absolute', start: 0, end: 0, bottom: 0, borderTopStartRadius: 16, borderTopEndRadius: 16, borderTopWidth: 1, elevation: 10, shadowOpacity: 0.09, shadowRadius: 14, shadowOffset: { width: 0, height: -5 } },
  dhead: { height: 58, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dheadRow: { flexDirection: 'row', alignItems: 'baseline', gap: 7 },
  dtitle: { fontFamily: font.serif, fontSize: 19 },
  dcount: { fontFamily: font.regular, fontSize: 14.5, fontVariant: ['lining-nums'] },
  dhint: { fontFamily: font.regular, fontSize: 13.5 },
  drop: { alignItems: 'center', justifyContent: 'center', borderTopStartRadius: 16, borderTopEndRadius: 16 },
  dropT: { fontFamily: font.bold, fontSize: 15.5 },
  chipsWrap: { height: 44 },
  chips: { gap: 6, paddingHorizontal: 18, alignItems: 'flex-start' },
  ghead: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 18, paddingTop: 12, paddingBottom: 4 },
  gheadT: { fontFamily: font.serif, fontSize: 15 },
  poolRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 18, paddingVertical: 7, minHeight: 46, borderBottomWidth: 1 },
  ghost: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 10, borderWidth: 1.5, elevation: 14, shadowOpacity: 0.25, shadowRadius: 16, shadowOffset: { width: 0, height: 8 } },
  fly: { position: 'absolute', fontFamily: font.black, fontSize: 26, fontVariant: ['lining-nums'] },
});

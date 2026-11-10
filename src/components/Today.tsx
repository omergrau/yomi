// The "My day" screen. Lifting and dragging run on the UI thread, using the layer proven in the feasibility test.
import { router } from 'expo-router';
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
import { ALARM_WINDOW, alarmAt, dayStats, dayTasks, isLateUrgent, levelInfo, poolTasks, streak as streakOf, totalPoints, upcomingAlarms, worth } from '../domain/logic';
import type { Group, Points, Recurring, Task } from '../domain/types';
import { t as tr } from '../i18n';
import { buzzLift, dropOnDay, moveToTomorrow, openSheet, quickAdd, removeFromDay, setView, toggleDone, useApp } from '../store';
import { RTL, font, useTheme, type Theme } from '../theme';
import { Agenda } from './Agenda';
import { endLabel, orderOpen } from '../domain/order';
import { ScoreHeader } from './ScoreHeader';
import { TopicPicker } from './TopicPicker';
import { Chip, Dot, Pips } from './ui';

const AnimatedScroll = Animated.createAnimatedComponent(ScrollView);
let doneShown = false;
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

/** What screen readers hear in place of the words the row no longer shows. */
function spoken(task: Task, group: Group | undefined, series?: Recurring) {
  const parts: string[] = [task.title];
  if (task.time) parts.push(endLabel(task, series) ? `${task.time}–${endLabel(task, series)}` : task.time);
  if (series?.place) parts.push(series.place);
  if (group) parts.push(group.name);
  if (task.recurringId) parts.push(tr.fixed);
  if (task.reminderMin !== null) parts.push(tr.reminder);
  if (task.deferrals === 1) parts.push(tr.deferredOnce);
  if (task.deferrals > 1) parts.push(tr.deferred(task.deferrals));
  return parts.join(', ');
}

function RowBody({ task, group, showGroup, t, late, next }: { task: Task; group?: Group; showGroup: boolean; series?: Recurring; t: Theme; late?: boolean; next?: boolean }) {
  const done = !!task.doneAt;
  return (
    <>
      <View style={s.body}>
        <Text
          numberOfLines={2}
          style={[s.title, { color: done ? t.soft : late ? t.alert : t.ink, fontFamily: late ? font.bold : font.medium, textDecorationLine: done ? 'line-through' : 'none' }]}
        >
          {task.title}
          {task.recurringId ? <Text style={{ color: t.soft }}>{'  ↻'}</Text> : null}
        </Text>
        {showGroup && group && group.color ? <Dot color={group.color} size={7} /> : null}
        {next && !done ? <View style={[s.nextDot, { backgroundColor: t.accent }]} /> : null}
      </View>
      {task.time ? (
        <Text style={[s.time, { color: next && !done ? t.accent : t.mute, fontFamily: next && !done ? font.bold : font.medium }]}>{task.time}</Text>
      ) : null}
      <Pips points={task.points} muted={done} hot={late || task.points === 5} />
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
  task, group, series, index, d, width, onLift, onDrop, onToggle, late, next,
}: {
  task: Task; group?: Group; series?: Recurring; index: number; d: Drag; width: number; late: boolean; next?: boolean;
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
    <Animated.View ref={ref} collapsable={false} style={rowStyle}>
      <View style={[StyleSheet.absoluteFill, s.under, { backgroundColor: t.ink }]}>
        <Text style={[s.underT, { color: t.paper }]}>{tr.swipeTomorrow}</Text>
        <Text style={[s.underT, { color: t.paper }]}>{tr.swipeRemove}</Text>
      </View>
      {/* Urgent and still open at 18:00: the title and its dots turn red. */}
      <Animated.View style={[s.row, { backgroundColor: t.paper }, fgStyle]}>
        <Pressable
          onPress={(e) => onToggle(task, e.nativeEvent.pageX, e.nativeEvent.pageY)}
          hitSlop={10}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: done }}
          accessibilityLabel={tr.markDone(task.title)}
          style={[s.check, { borderColor: done ? t.accent : late ? t.alert : t.soft, backgroundColor: done ? t.accent : 'transparent' }]}
        >
          {done ? <Text style={[s.tick, { color: t.onAccent }]}>✓</Text> : null}
        </Pressable>
        <GestureDetector gesture={gesture}>
          <Animated.View style={s.rowMain} accessible accessibilityRole="button" accessibilityLabel={spoken(task, group, series)} accessibilityHint={tr.poolHint}>
            <RowBody task={task} group={group} series={series} showGroup t={t} late={late} next={next} />
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
    <View style={[s.row, { backgroundColor: t.paper }]}>
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
      <Pressable style={s.rowMain} onPress={() => openSheet({ id: task.id })} accessibilityRole="button" accessibilityLabel={spoken(task, group, series)}>
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
      <Animated.View ref={ref} collapsable={false} style={[s.poolRow, style]} accessible accessibilityRole="button" accessibilityLabel={spoken(task, undefined)}>
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
  const [topicOn, setTopicOn] = useState(false);
  const submit = () => {
    if (!text.trim()) return;
    quickAdd(text, points, topicOn ? groupId : null);
    setText('');
  };
  const open = !!text.trim();
  return (
    <View style={[s.quickBox, open ? { backgroundColor: t.wash } : null]}>
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
              setTopicOn(false);
            }
          }}
          submitBehavior="submit"
          returnKeyType="done"
          maxLength={120}
          placeholder={tr.quickAddPh}
          placeholderTextColor={t.soft}
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
            <Pressable
              onPress={() => {
                const on = !topicOn;
                setTopicOn(on);
                if (on && !groupId && groups[0]) setGroupId(groups[0].id);
              }}
              hitSlop={8}
              style={s.quickCheckWrap}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: topicOn }}
              aria-checked={topicOn}
              accessibilityLabel={tr.topic}
            >
              <View style={[s.quickCheck, { borderColor: topicOn ? t.accent : t.soft, backgroundColor: topicOn ? t.accent : t.paper }]}>
                {topicOn ? <Text style={[s.quickCheckT, { color: t.onAccent }]}>✓</Text> : null}
              </View>
              <Text style={[s.quickCheckL, { color: topicOn ? t.ink : t.mute }]}>{tr.topic}</Text>
            </Pressable>
            {topicOn ? <TopicPicker groups={groups} value={groupId} onChange={setGroupId} /> : null}
          </View>
        </View>
      ) : null}
    </View>
  );
}

function DayCell({ date, index, highlight, today, selected, stats, onPress, t }: {
  date: string; index: number; highlight: SharedValue<number>; today: string; selected: boolean; stats: { pct: number; total: number; closed: boolean }; onPress: () => void; t: Theme;
}) {
  const d = parseIso(date);
  const past = date < today;
  const isToday = date === today;
  const hlBg = useAnimatedStyle(() => ({ opacity: highlight.value === index && !past ? 1 : 0 }));
  const fg = selected ? t.paper : isToday ? t.accent : past ? t.soft : t.ink;
  return (
    <Pressable
      style={s.cell}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`יום ${tr.days[d.getDay()]}, ${d.getDate()}`}
    >
      <View style={[s.cellCircle, selected ? { backgroundColor: t.ink } : null]}>
        <Animated.View style={[StyleSheet.absoluteFill, s.cellHl, { backgroundColor: t.accent }, hlBg]} />
        <Text style={[s.cellN, { color: fg, fontFamily: selected || isToday ? font.bold : font.semibold }]}>{d.getDate()}</Text>
      </View>
      <View style={[s.cellDot, { backgroundColor: stats.closed ? t.accent : stats.total && !selected ? t.line : 'transparent' }]} />
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
  const series = useMemo(() => new Map(data.recurring.map((r) => [r.id, r])), [data.recurring]);
  const [clock, setClock] = useState(Date.now());
  const nextAlarm = upcomingAlarms(data, clock)[0];
  useEffect(() => {
    const id = setInterval(() => setClock(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);
  // A task with a time sits in the schedule above, so the list holds only the rest.
  const listed = useMemo(() => rows.filter((x) => !x.time), [rows]);
  const openRows = useMemo(() => orderOpen(listed.filter((x) => !x.doneAt), view, today, clock, series).ordered, [listed, view, today, clock, series]);
  const doneRows = useMemo(() => listed.filter((x) => x.doneAt), [listed]);
  const [showDone, setShowDone] = useState(doneShown);
  const turnWeek = useCallback((n: number) => setView(addDays(view, n)), [view]);
  // Sideways on the week strip turns the week.
  const weekPan = usePanGesture({
    activeOffsetX: [-24, 24],
    failOffsetY: [-14, 14],
    onDeactivate: (e) => {
      'worklet';
      if (Math.abs(e.translationX) < 50) return;
      // Content runs right to left in Hebrew, so a swipe to the right shows the next week.
      const forward = RTL ? e.translationX > 0 : e.translationX < 0;
      scheduleOnRN(turnWeek, forward ? 7 : -7);
    },
  });
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
        const shown = openRows.filter((x) => x.id !== id);
        if (k < shown.length) return others.indexOf(shown[k]);
        const open = others.filter((x) => !x.doneAt);
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
    [openRows, rows, today, view, week],
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
    // Only a task that earns points sends them flying to the score.
    if (!task.doneAt && worth(task)) {
      const points = worth(task);
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
        alarm={nextAlarm && alarmAt(nextAlarm) - clock <= ALARM_WINDOW ? nextAlarm.time : null}
        onAlarm={() => router.push('/alarms')}
      />
      <GestureDetector gesture={weekPan}>
      <View style={s.stripWrap}>
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
        {/* Hidden buttons keep turning the week reachable for screen readers. */}
        <Pressable onPress={() => setView(addDays(view, -7))} style={s.srOnly} accessibilityRole="button" accessibilityLabel={tr.weekPrev} />
        <Pressable onPress={() => setView(addDays(view, 7))} style={s.srOnly} accessibilityRole="button" accessibilityLabel={tr.weekNext} />
      </View>
      </GestureDetector>

      <AnimatedScroll ref={scrollRef} onScroll={onScroll} scrollEventThrottle={16} style={s.flex} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: PEEK + 28 + (drawerOpen ? HALF : 0) }}>
        <Agenda date={view} onToggle={onToggle} />
        <View ref={listRef} collapsable={false} style={{ minHeight: 64 }}>
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
                  late={isLateUrgent(task, clock)}
                />
              </Animated.View>
            ))
          ) : !rows.length ? (
            <Text style={[s.empty, { color: t.mute }]}>{tr.emptyDay}</Text>
          ) : null}
        </View>
        <QuickAdd t={t} groups={data.groups} />
        {/* Finished tasks fold away under one line. */}
        {doneRows.length ? (
          <Pressable
            onPress={() => {
              doneShown = !showDone;
              setShowDone(!showDone);
            }}
            hitSlop={8}
            style={s.doneHead}
            accessibilityRole="button"
            accessibilityState={{ expanded: showDone }}
          >
            <Text style={[s.doneHeadT, { color: t.soft }]}>{tr.doneSection(doneRows.length)}</Text>
          </Pressable>
        ) : null}
        {(showDone ? doneRows : []).map((task) => (
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
              <Text style={[s.dtitle, { color: t.mute }]}>{`${tr.pool} · ${pool.length}`}</Text>
            </View>
            {/* A small chevron at the top centre says the drawer pulls up; it turns down once open. */}
            <View pointerEvents="none" style={s.grabWrap}>
              <View style={[s.grab, { borderColor: t.soft, transform: [{ translateY: drawerOpen ? -2 : 2 }, { rotate: drawerOpen ? '225deg' : '45deg' }] }]} />
            </View>
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
  stripWrap: { flexDirection: 'row', alignItems: 'stretch', paddingHorizontal: 12, paddingTop: 4, paddingBottom: 6 },
  strip: { flex: 1, flexDirection: 'row' },
  srOnly: { position: 'absolute', width: 1, height: 1, opacity: 0 },
  cell: { flex: 1, alignItems: 'center', paddingVertical: 2 },
  cellCircle: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  cellHl: { opacity: 0.25, borderRadius: 18 },
  cellN: { fontSize: 15.5, lineHeight: 19, fontVariant: ['tabular-nums', 'lining-nums'] },
  cellDot: { width: 4, height: 4, borderRadius: 2, marginTop: 3 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, minHeight: 52 },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, minHeight: 52 },
  quickBox: { marginHorizontal: 8, marginTop: 2, marginBottom: 2, borderRadius: 10, paddingHorizontal: 12 },
  quick: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  quickGo: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  quickGoT: { fontFamily: font.bold, fontSize: 14, lineHeight: 18 },
  quickOpts: { gap: 6, paddingBottom: 9 },
  quickRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  quickLabel: { fontFamily: font.regular, fontSize: 12.5, width: 62 },
  quickCheckWrap: { flexDirection: 'row', alignItems: 'center', gap: 6, width: 62, height: 28 },
  quickCheck: { width: 18, height: 18, borderRadius: 4, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  quickCheckT: { fontFamily: font.bold, fontSize: 11, lineHeight: 14 },
  quickCheckL: { fontFamily: font.regular, fontSize: 12.5 },
  quickPt: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  quickPtT: { fontFamily: font.semibold, fontSize: 12.5, fontVariant: ['lining-nums'] },
  quickTopic: { alignItems: 'flex-start' },
  quickPlus: { fontFamily: font.regular, fontSize: 22, lineHeight: 26, width: 22, textAlign: 'center' },
  quickIn: { flex: 1, fontFamily: font.medium, fontSize: 15, paddingVertical: 12 },
  doneHead: { alignSelf: 'flex-start', paddingHorizontal: 20, paddingTop: 8, paddingBottom: 6 },
  doneHeadT: { fontFamily: font.medium, fontSize: 13.5, fontVariant: ['lining-nums'] },
  under: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20 },
  underT: { fontFamily: font.bold, fontSize: 15 },
  check: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  tick: { fontFamily: font.bold, fontSize: 13, lineHeight: 17 },
  body: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 7 },
  title: { flexShrink: 1, fontSize: 16.5, lineHeight: 22 },
  nextDot: { width: 6, height: 6, borderRadius: 3 },
  time: { fontSize: 13.5, minWidth: 40, textAlign: 'left', fontVariant: ['tabular-nums', 'lining-nums'] },
  empty: { fontFamily: font.regular, fontSize: 15.5, textAlign: 'center', paddingHorizontal: 28, paddingVertical: 32 },
  drawer: { position: 'absolute', start: 0, end: 0, bottom: 0, borderTopStartRadius: 16, borderTopEndRadius: 16, borderTopWidth: 1, elevation: 10, shadowOpacity: 0.09, shadowRadius: 14, shadowOffset: { width: 0, height: -5 } },
  dhead: { height: 58, paddingHorizontal: 18, paddingTop: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  dheadRow: { flexDirection: 'row', alignItems: 'baseline', gap: 7 },
  dtitle: { fontFamily: font.semibold, fontSize: 14.5 },
  grabWrap: { position: 'absolute', top: 5, left: 0, right: 0, height: 12, alignItems: 'center', justifyContent: 'center' },
  grab: { width: 9, height: 9, borderTopWidth: 2, borderLeftWidth: 2, borderRadius: 1 },
  drop: { alignItems: 'center', justifyContent: 'center', borderTopStartRadius: 16, borderTopEndRadius: 16 },
  dropT: { fontFamily: font.bold, fontSize: 15.5 },
  chipsWrap: { height: 44 },
  chips: { gap: 6, paddingHorizontal: 18, alignItems: 'flex-start' },
  ghead: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 18, paddingTop: 12, paddingBottom: 4 },
  gheadT: { fontFamily: font.serif, fontSize: 15 },
  poolRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingVertical: 8, minHeight: 48 },
  ghost: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 10, borderWidth: 1.5, elevation: 14, shadowOpacity: 0.25, shadowRadius: 16, shadowOffset: { width: 0, height: 8 } },
  fly: { position: 'absolute', fontFamily: font.black, fontSize: 26, fontVariant: ['lining-nums'] },
});

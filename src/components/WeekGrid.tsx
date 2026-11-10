// The timetable as a week: a column for each day and a row for each hour of the whole day, 00:00 to 24:00.
// Lessons, timed tasks and phone calendar events sit as blocks at their time. The hours shrink to fit the
// screen, so the whole week can be read at a glance without scrolling.
import React, { useEffect, useMemo, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { calendarAccess, eventsBetween, type PhoneEvent } from '../calendar';
import { buildAgenda, type AgendaItem } from '../domain/agenda';
import { addDays, fireTime, parseIso, toIso, weekDays } from '../domain/dates';
import { dayTasks } from '../domain/logic';
import type { Recurring } from '../domain/types';
import { t as tr } from '../i18n';
import { openSheet, useApp } from '../store';
import { font, groupColor, useTheme } from '../theme';
import { hm } from './Agenda';
import { projected } from './Month';

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const GUTTER = 34;
const MIN_HOUR_H = 14;
const MIN_BLOCK = 30 * 60000;

type Block = { item: AgendaItem; top: number; height: number; lane: number; lanes: number };

/** Places a day's timed items, side by side where they overlap. */
function layout(items: AgendaItem[], dayStart: number, hourH: number): Block[] {
  const timed = items
    .filter((i) => !i.allDay && i.start !== null)
    .map((i) => ({ i, s: i.start!, e: Math.max(i.end ?? i.start! + 60 * 60000, i.start! + MIN_BLOCK) }))
    .sort((a, b) => a.s - b.s);
  const blocks: Block[] = [];
  let cluster: { b: Block; e: number }[] = [];
  let clusterEnd = -1;
  const close = () => {
    const lanes = Math.max(1, ...cluster.map((c) => c.b.lane + 1));
    for (const c of cluster) c.b.lanes = lanes;
    cluster = [];
  };
  for (const x of timed) {
    if (x.s >= clusterEnd) close();
    const taken = new Set(cluster.filter((c) => c.e > x.s).map((c) => c.b.lane));
    let lane = 0;
    while (taken.has(lane)) lane++;
    // An item that goes past midnight is cut at the end of the day.
    const s0 = Math.max(x.s, dayStart);
    const e0 = Math.min(x.e, dayStart + 24 * 3600000);
    const b: Block = { item: x.i, top: ((s0 - dayStart) / 3600000) * hourH, height: ((e0 - s0) / 3600000) * hourH, lane, lanes: 1 };
    blocks.push(b);
    cluster.push({ b, e: x.e });
    clusterEnd = Math.max(clusterEnd, x.e);
  }
  close();
  return blocks;
}

export function WeekGrid({ onOpenSlot }: { onOpenSlot: (r: Recurring) => void }) {
  const t = useTheme();
  const { data, today } = useApp();
  const [anchor, setAnchor] = useState(today);
  const [events, setEvents] = useState<PhoneEvent[]>([]);
  const [gridH, setGridH] = useState(0);
  const hourH = Math.max(MIN_HOUR_H, gridH / 24);
  const days = weekDays(anchor);
  const first = days[0];
  const hidden = data.meta.hiddenCalendars;

  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const ok = (await calendarAccess()) === 'granted';
        const ev = ok ? await eventsBetween(first, addDays(first, 7), hidden) : [];
        if (live) setEvents(ev);
      } catch {
        if (live) setEvents([]);
      }
    };
    load();
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') load();
    });
    return () => {
      live = false;
      sub.remove();
    };
  }, [first, hidden]);

  const series = useMemo(() => new Map(data.recurring.map((r) => [r.id, r])), [data.recurring]);
  const groups = useMemo(() => new Map(data.groups.map((g) => [g.id, g.color])), [data.groups]);

  const { byDay, recurringOf } = (() => {
    const keys = new Set(Object.values(data.tasks).filter((x) => x.recurringId).map((x) => `${x.recurringId}|${x.occurrenceDate}`));
    const recurringOf = new Map<string, string>();
    const byDay = new Map<string, AgendaItem[]>();
    for (const day of weekDays(first)) {
      const tasks = [...dayTasks(data, day), ...(day > today ? projected(data.recurring, day, keys) : [])];
      for (const x of tasks) if (x.recurringId) recurringOf.set(x.id, x.recurringId);
      const dayEvents = events.filter((e) => !e.allDay && toIso(new Date(e.start)) === day);
      byDay.set(day, buildAgenda(day, tasks, series, dayEvents, groups).filter((i) => !i.allDay && i.start !== null));
    }
    return { byDay, recurringOf };
  })();

  // With little room only every other hour gets a label.
  const every = hourH >= 22 ? 1 : 2;
  const start = parseIso(first);
  const end = parseIso(days[6]);
  const range =
    start.getMonth() === end.getMonth()
      ? `${start.getDate()}–${end.getDate()} ${tr.months[end.getMonth()]}`
      : `${start.getDate()} ${tr.months[start.getMonth()]} – ${end.getDate()} ${tr.months[end.getMonth()]}`;

  const open = (i: AgendaItem) => {
    if (!i.taskId) return;
    const rid = recurringOf.get(i.taskId);
    // A slot further ahead than the filled-in weeks opens the timetable item itself.
    if (i.taskId.startsWith('p-') && rid) {
      const r = series.get(rid);
      if (r) onOpenSlot(r);
      return;
    }
    openSheet({ id: i.taskId });
  };

  return (
    <View style={s.flex}>
      <View style={s.head}>
        <Pressable onPress={() => setAnchor(addDays(first, -7))} hitSlop={10} accessibilityRole="button" accessibilityLabel={tr.gridPrev}>
          <Text style={[s.arrow, { color: t.mute }]}>›</Text>
        </Pressable>
        <Pressable onPress={() => setAnchor(today)} accessibilityRole="button" accessibilityLabel={tr.gridThisWeek}>
          <Text style={[s.range, { color: t.ink }]}>{range}</Text>
        </Pressable>
        <Pressable onPress={() => setAnchor(addDays(first, 7))} hitSlop={10} accessibilityRole="button" accessibilityLabel={tr.gridNext}>
          <Text style={[s.arrow, { color: t.mute }]}>‹</Text>
        </Pressable>
      </View>
      <View style={[s.daysRow, { borderBottomColor: t.line }]}>
        <View style={{ width: GUTTER }} />
        {days.map((day, i) => {
          const on = day === today;
          return (
            <View key={day} style={s.dayHead}>
              <Text style={[s.dayL, { color: on ? t.accent : t.mute }]}>{tr.dayLetters[i]}</Text>
              <View style={[s.dayNum, on ? { backgroundColor: t.accent } : null]}>
                <Text style={[s.dayNumT, { color: on ? t.onAccent : t.ink }]}>{parseIso(day).getDate()}</Text>
              </View>
            </View>
          );
        })}
      </View>
      <View style={s.scroll} onLayout={(e) => setGridH(e.nativeEvent.layout.height - 16)}>
        {gridH > 0 ? (
        <View style={[s.grid, { height: 24 * hourH }]}>
          <View style={{ width: GUTTER }}>
            {HOURS.filter((h) => h % every === 0).map((h) => (
              <Text key={h} style={[s.hour, { top: h * hourH - (h ? 6 : 0), color: t.soft }]}>{`${String(h).padStart(2, '0')}:00`}</Text>
            ))}
          </View>
          {days.map((day) => {
            const dayStart = fireTime(day, '00:00', 0);
            const blocks = layout(byDay.get(day) ?? [], dayStart, hourH);
            return (
              <View key={day} style={[s.col, { borderStartColor: t.line, backgroundColor: day === today ? t.wash : 'transparent' }]}>
                {HOURS.slice(1).map((h) => (
                  <View key={h} style={[s.line, { top: h * hourH, backgroundColor: t.line, opacity: h % 6 ? 0.5 : 1 }]} />
                ))}
                {blocks.map((b) => {
                  const i = b.item;
                  // Side by side the blocks are narrow, so the text gets smaller and the time is left out.
                  const narrow = b.lanes > 1;
                  const color = i.source === 'calendar' ? i.color ?? t.mute : i.groupColor !== null ? groupColor(t, i.groupColor) : t.accent;
                  return (
                    <Pressable
                      key={i.key}
                      onPress={() => open(i)}
                      accessibilityRole="button"
                      accessibilityLabel={`${i.title} ${hm(i.start!)}`}
                      style={[
                        s.block,
                        {
                          top: b.top + 1,
                          height: Math.max(12, b.height - 2),
                          start: `${(b.lane / b.lanes) * 100}%`,
                          width: `${100 / b.lanes}%`,
                          backgroundColor: `${color}2E`,
                          borderStartColor: color,
                          paddingHorizontal: narrow ? 1.5 : 3,
                          opacity: i.done ? 0.5 : 1,
                        },
                      ]}
                    >
                      <Text
                        style={[s.blockT, narrow ? s.blockNarrow : null, { color: t.ink, textDecorationLine: i.done ? 'line-through' : 'none' }]}
                        numberOfLines={Math.max(1, Math.floor((b.height - (b.height >= 40 && !narrow ? 16 : 3)) / 13))}
                      >
                        {i.title}
                      </Text>
                      {b.height >= 40 && !narrow ? (
                        <Text style={[s.blockTime, { color: t.mute }]} numberOfLines={1}>
                          {hm(i.start!)}
                        </Text>
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
            );
          })}
        </View>
        ) : null}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingTop: 10, paddingBottom: 6 },
  arrow: { fontFamily: font.regular, fontSize: 30, lineHeight: 34 },
  range: { fontFamily: font.serif, fontSize: 19, fontVariant: ['lining-nums'] },
  daysRow: { flexDirection: 'row', paddingHorizontal: 6, paddingBottom: 6, borderBottomWidth: 1 },
  dayHead: { flex: 1, alignItems: 'center', gap: 2 },
  dayL: { fontFamily: font.semibold, fontSize: 12 },
  dayNum: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  dayNumT: { fontFamily: font.semibold, fontSize: 14, fontVariant: ['tabular-nums', 'lining-nums'] },
  scroll: { flex: 1, paddingHorizontal: 6, paddingTop: 8, paddingBottom: 8, overflow: 'hidden' },
  grid: { flexDirection: 'row' },
  hour: { position: 'absolute', end: 4, fontFamily: font.regular, fontSize: 10, fontVariant: ['tabular-nums', 'lining-nums'] },
  col: { flex: 1, borderStartWidth: StyleSheet.hairlineWidth },
  line: { position: 'absolute', start: 0, end: 0, height: StyleSheet.hairlineWidth },
  block: { position: 'absolute', borderRadius: 4, borderStartWidth: 2.5, paddingHorizontal: 3, paddingVertical: 1, overflow: 'hidden' },
  blockT: { fontFamily: font.semibold, fontSize: 10.5, lineHeight: 13 },
  blockNarrow: { fontSize: 9, lineHeight: 11.5 },
  blockTime: { fontFamily: font.regular, fontSize: 9.5, fontVariant: ['tabular-nums', 'lining-nums'] },
});

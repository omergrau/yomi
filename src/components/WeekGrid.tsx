// The timetable as a week: a column for each day and a row for each hour. Lessons, timed tasks and phone
// calendar events sit as blocks at their time, so the whole week can be read at a glance.
import React, { useEffect, useMemo, useState } from 'react';
import { AppState, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
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

const HOUR_H = 52;
const GUTTER = 34;
const MIN_BLOCK = 30 * 60000;

type Block = { item: AgendaItem; top: number; height: number; lane: number; lanes: number };

/** Places a day's timed items, side by side where they overlap. */
function layout(items: AgendaItem[], dayStart: number): Block[] {
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
    const b: Block = { item: x.i, top: ((x.s - dayStart) / 3600000) * HOUR_H, height: ((x.e - x.s) / 3600000) * HOUR_H, lane, lanes: 1 };
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

  const { byDay, from, to, recurringOf } = useMemo(() => {
    const keys = new Set(Object.values(data.tasks).filter((x) => x.recurringId).map((x) => `${x.recurringId}|${x.occurrenceDate}`));
    const recurringOf = new Map<string, string>();
    const byDay = new Map<string, AgendaItem[]>();
    for (const day of weekDays(first)) {
      const tasks = [...dayTasks(data, day), ...(day > today ? projected(data.recurring, day, keys) : [])];
      for (const x of tasks) if (x.recurringId) recurringOf.set(x.id, x.recurringId);
      const dayEvents = events.filter((e) => !e.allDay && toIso(new Date(e.start)) === day);
      byDay.set(day, buildAgenda(day, tasks, series, dayEvents, groups).filter((i) => !i.allDay && i.start !== null));
    }
    // Show 08:00–21:00 at least, and stretch to fit anything earlier or later.
    let from = 8;
    let to = 21;
    for (const items of byDay.values()) {
      for (const i of items) {
        from = Math.min(from, new Date(i.start!).getHours());
        const e = new Date(Math.max(i.end ?? i.start! + 3600000, i.start! + MIN_BLOCK));
        const sameDay = toIso(e) === toIso(new Date(i.start!));
        to = Math.max(to, sameDay ? Math.min(24, e.getHours() + (e.getMinutes() ? 1 : 0)) : 24);
      }
    }
    return { byDay, from, to, recurringOf };
  }, [data, events, first, today, series, groups]);

  const hours = Array.from({ length: to - from }, (_, i) => from + i);
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
      <ScrollView contentContainerStyle={s.scroll}>
        <View style={[s.grid, { height: hours.length * HOUR_H }]}>
          <View style={{ width: GUTTER }}>
            {hours.map((h) => (
              <Text key={h} style={[s.hour, { top: (h - from) * HOUR_H - 6, color: t.soft }]}>{`${String(h).padStart(2, '0')}:00`}</Text>
            ))}
          </View>
          {days.map((day) => {
            const dayStart = fireTime(day, `${String(from).padStart(2, '0')}:00`, 0);
            const blocks = layout(byDay.get(day) ?? [], dayStart);
            return (
              <View key={day} style={[s.col, { borderStartColor: t.line, backgroundColor: day === today ? t.wash : 'transparent' }]}>
                {hours.map((h) => (
                  <View key={h} style={[s.line, { top: (h - from) * HOUR_H, backgroundColor: t.line }]} />
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
                          height: Math.max(18, b.height - 2),
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
                        numberOfLines={Math.max(1, Math.floor((b.height - (b.height >= 44 && !narrow ? 16 : 4)) / 13))}
                      >
                        {i.title}
                      </Text>
                      {b.height >= 44 && !narrow ? (
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
      </ScrollView>
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
  scroll: { paddingHorizontal: 6, paddingTop: 10, paddingBottom: 24 },
  grid: { flexDirection: 'row' },
  hour: { position: 'absolute', end: 4, fontFamily: font.regular, fontSize: 10, fontVariant: ['tabular-nums', 'lining-nums'] },
  col: { flex: 1, borderStartWidth: StyleSheet.hairlineWidth },
  line: { position: 'absolute', start: 0, end: 0, height: StyleSheet.hairlineWidth },
  block: { position: 'absolute', borderRadius: 5, borderStartWidth: 2.5, paddingHorizontal: 3, paddingVertical: 2, overflow: 'hidden' },
  blockT: { fontFamily: font.semibold, fontSize: 10.5, lineHeight: 13 },
  blockNarrow: { fontSize: 9, lineHeight: 11.5 },
  blockTime: { fontFamily: font.regular, fontSize: 9.5, fontVariant: ['tabular-nums', 'lining-nums'] },
});

// A month at a glance, laid out like the phone's calendar: a grid of days with short coloured entries,
// and the chosen day's full list underneath. The grid stays in place; only the day's list scrolls.
import React, { useEffect, useMemo, useState } from 'react';
import { AppState, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { calendarAccess, eventsBetween, type PhoneEvent } from '../calendar';
import { buildAgenda, type AgendaItem } from '../domain/agenda';
import { addDays, parseIso, toIso, weekday } from '../domain/dates';
import { alive, dayTasks } from '../domain/logic';
import type { Recurring, Task } from '../domain/types';
import { fmtDate, t as tr } from '../i18n';
import { openSheet, useApp } from '../store';
import { font, groupColor, useTheme, type Theme } from '../theme';
import { hm } from './Agenda';

type Entry = { key: string; title: string; color: string; done: boolean; start: number | null; taskId: string | null; source: AgendaItem['source'] };

// The entries a day's cell shows before "+N"; kept small so the fixed grid leaves room for the list.
const CELL_ROWS = 2;

const firstOfMonth = (iso: string) => `${iso.slice(0, 7)}-01`;
const shiftMonth = (iso: string, n: number) => {
  const d = parseIso(firstOfMonth(iso));
  d.setMonth(d.getMonth() + n);
  return toIso(d);
};

/** Timetable slots beyond the weeks the app has already filled in, so the month shows them too. */
export function projected(recurring: Recurring[], date: string, existing: Set<string>): Task[] {
  return recurring
    .filter((r) => !r.endedAt && r.startDate <= date && r.weekdays.includes(weekday(date)) && !existing.has(`${r.id}|${date}`))
    .map((r) => ({
      id: `p-${r.id}-${date}`, title: r.title, groupId: r.groupId, points: r.points, date, sort: 0, time: r.time, reminderMin: null, deferrals: 0,
      doneAt: null, recurringId: r.id, occurrenceDate: date, createdAt: 0, deletedAt: null,
    }));
}

export function Month() {
  const t = useTheme();
  const { data, today } = useApp();
  const [month, setMonth] = useState(firstOfMonth(today));
  const [selected, setSelected] = useState(today);
  const [events, setEvents] = useState<PhoneEvent[]>([]);

  const start = addDays(month, -weekday(month));
  const nextMonth = shiftMonth(month, 1);
  const weeks = Math.ceil((weekday(month) + (parseIso(addDays(nextMonth, -1)).getDate())) / 7);
  const days = Array.from({ length: weeks * 7 }, (_, i) => addDays(start, i));
  const end = addDays(start, weeks * 7);
  const hidden = data.meta.hiddenCalendars;

  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const ok = (await calendarAccess()) === 'granted';
        const ev = ok ? await eventsBetween(start, end, hidden) : [];
        if (live) setEvents(ev);
      } catch {
        if (live) setEvents([]);
      }
    };
    load();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') load();
    });
    return () => {
      live = false;
      sub.remove();
    };
  }, [start, end, hidden]);

  const groups = useMemo(() => new Map(data.groups.map((g) => [g.id, g.color])), [data.groups]);
  const series = useMemo(() => new Map(data.recurring.map((r) => [r.id, r])), [data.recurring]);
  const occurrenceKeys = useMemo(
    () => new Set(Object.values(data.tasks).filter((x) => x.recurringId).map((x) => `${x.recurringId}|${x.occurrenceDate}`)),
    [data.tasks],
  );

  const byDay = useMemo(() => {
    const out = new Map<string, { items: AgendaItem[]; untimed: Task[] }>();
    for (const day of days) {
      const tasks = [...dayTasks(data, day), ...(day > today ? projected(data.recurring, day, occurrenceKeys) : [])];
      const dayEvents = events.filter((e) => toIso(new Date(e.start)) <= day && (e.allDay ? toIso(new Date(e.end - 1)) : toIso(new Date(e.end))) >= day);
      out.set(day, { items: buildAgenda(day, tasks, series, dayEvents, groups), untimed: tasks.filter((x) => !x.time) });
    }
    return out;
    // `days` follows `month`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, events, month, occurrenceKeys, series, groups, today]);

  const entriesFor = (day: string): Entry[] => {
    const v = byDay.get(day);
    if (!v) return [];
    const timed = v.items.map((i) => ({
      key: i.key, title: i.title, done: i.done, start: i.start, taskId: i.taskId, source: i.source,
      color: i.color ?? (i.groupColor !== null ? groupColor(t, i.groupColor) : i.source === 'calendar' ? t.soft : t.accent),
    }));
    const untimed = v.untimed.map((x) => ({
      key: `u-${x.id}`, title: x.title, done: !!x.doneAt, start: null, taskId: x.id.startsWith('p-') ? null : x.id, source: 'task' as const,
      color: x.groupId ? groupColor(t, groups.get(x.groupId)) : t.mute,
    }));
    return [...timed, ...untimed];
  };

  const monthEnd = addDays(nextMonth, -1);
  const left = alive(data).filter((x) => !x.doneAt && x.date && x.date >= today && x.date <= monthEnd && x.date >= month).length;
  const sel = entriesFor(selected);
  const m = parseIso(month);

  return (
    <View style={s.page}>
      <View style={s.head}>
        <Text style={[s.title, { color: t.ink }]}>{`${tr.monthNames[m.getMonth()]} ${m.getFullYear()}`}</Text>
        <View style={s.arrows}>
          <Pressable onPress={() => setMonth(shiftMonth(month, -1))} hitSlop={10} accessibilityRole="button" accessibilityLabel={tr.monthPrev}>
            <Text style={[s.arrow, { color: t.ink }]}>›</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              setMonth(firstOfMonth(today));
              setSelected(today);
            }}
            hitSlop={8}
            accessibilityRole="button"
          >
            <Text style={[s.todayBtn, { color: t.accent }]}>{tr.today}</Text>
          </Pressable>
          <Pressable onPress={() => setMonth(shiftMonth(month, 1))} hitSlop={10} accessibilityRole="button" accessibilityLabel={tr.monthNext}>
            <Text style={[s.arrow, { color: t.ink }]}>‹</Text>
          </Pressable>
        </View>
      </View>
      <Text style={[s.left, { color: t.mute }]}>{tr.monthLeft(left)}</Text>

      <View style={[s.grid, { borderColor: t.line }]}>
        <View style={s.week}>
          {tr.dayLetters.map((l) => (
            <Text key={l} style={[s.wd, { color: t.mute }]}>{l}</Text>
          ))}
        </View>
        {Array.from({ length: weeks }, (_, w) => (
          <View key={w} style={[s.week, { borderTopColor: t.line, borderTopWidth: 1 }]}>
            {days.slice(w * 7, w * 7 + 7).map((day) => {
              const inMonth = day.slice(0, 7) === month.slice(0, 7);
              const isSel = day === selected;
              const isToday = day === today;
              const list = entriesFor(day);
              return (
                <Pressable
                  key={day}
                  onPress={() => setSelected(day)}
                  style={[s.cell, { backgroundColor: isSel ? t.wash : 'transparent', opacity: inMonth ? 1 : 0.4 }]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSel }}
                  accessibilityLabel={`${fmtDate(day)}, ${list.length}`}
                >
                  <View style={[s.num, isToday ? { backgroundColor: t.accent } : null]}>
                    <Text style={[s.numT, { color: isToday ? t.onAccent : t.ink, fontFamily: isToday || isSel ? font.bold : font.regular }]}>{parseIso(day).getDate()}</Text>
                  </View>
                  {list.slice(0, CELL_ROWS).map((e) => (
                    <View key={e.key} style={[s.ev, { backgroundColor: e.done ? 'transparent' : `${e.color}26`, borderColor: e.color }]}>
                      <Text numberOfLines={1} style={[s.evT, { color: e.done ? t.soft : t.ink, textDecorationLine: e.done ? 'line-through' : 'none' }]}>{e.title}</Text>
                    </View>
                  ))}
                  {list.length > CELL_ROWS ? <Text style={[s.more, { color: t.mute }]}>{tr.monthMore(list.length - CELL_ROWS)}</Text> : null}
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>

      <View style={s.dayHead}>
        <Text style={[s.dayTitle, { color: t.ink }]}>{`${selected === today ? `${tr.today}, ` : ''}יום ${tr.days[weekday(selected)]}, ${fmtDate(selected)}`}</Text>
        {selected >= today ? (
          <Pressable onPress={() => openSheet({ id: null, date: selected })} hitSlop={8} accessibilityRole="button">
            <Text style={[s.add, { color: t.accent }]}>{tr.monthAdd}</Text>
          </Pressable>
        ) : null}
      </View>
      <ScrollView style={s.flex} contentContainerStyle={s.list}>
        {sel.length ? (
          sel.map((e) => <DayRow key={e.key} e={e} t={t} />)
        ) : (
          <Text style={[s.empty, { color: t.mute }]}>{tr.monthDayEmpty}</Text>
        )}
      </ScrollView>
    </View>
  );
}

function DayRow({ e, t }: { e: Entry; t: Theme }) {
  return (
    <Pressable
      disabled={!e.taskId}
      onPress={() => e.taskId && openSheet({ id: e.taskId })}
      style={[s.row, { borderBottomColor: t.line }]}
      accessibilityRole={e.taskId ? 'button' : 'text'}
      accessibilityLabel={e.title}
    >
      <Text style={[s.rowTime, { color: t.ink }]}>{e.start !== null ? hm(e.start) : ''}</Text>
      <View style={[s.rowBar, { backgroundColor: e.color }]} />
      <Text style={[s.rowT, { color: e.done ? t.soft : t.ink, textDecorationLine: e.done ? 'line-through' : 'none' }]} numberOfLines={1}>{e.title || tr.agendaUntitled}</Text>
      <Text style={[s.rowSrc, { color: t.mute }]}>{e.source === 'calendar' ? tr.agendaFromCalendar : e.source === 'timetable' ? tr.agendaFromTimetable : tr.agendaFromTask}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, paddingHorizontal: 12, paddingTop: 10 },
  flex: { flex: 1 },
  list: { paddingBottom: 40 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 4 },
  title: { fontFamily: font.serif, fontSize: 24 },
  arrows: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  arrow: { fontFamily: font.regular, fontSize: 28, lineHeight: 32 },
  todayBtn: { fontFamily: font.semibold, fontSize: 14 },
  left: { fontFamily: font.regular, fontSize: 13, paddingHorizontal: 4, marginBottom: 6 },
  grid: { borderWidth: 1, borderRadius: 12, overflow: 'hidden' },
  week: { flexDirection: 'row' },
  wd: { flex: 1, textAlign: 'center', fontFamily: font.regular, fontSize: 11.5, paddingVertical: 5 },
  cell: { flex: 1, minHeight: 58, paddingHorizontal: 1.5, paddingTop: 3, paddingBottom: 3, gap: 1.5 },
  num: { alignSelf: 'center', width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', marginBottom: 1 },
  numT: { fontSize: 12.5, fontVariant: ['lining-nums'] },
  ev: { borderStartWidth: 2, borderRadius: 3, paddingHorizontal: 2, paddingVertical: 0.5 },
  evT: { fontFamily: font.regular, fontSize: 9.5, lineHeight: 12 },
  more: { fontFamily: font.semibold, fontSize: 9.5, textAlign: 'center' },
  dayHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', paddingHorizontal: 4, paddingTop: 12, paddingBottom: 4 },
  dayTitle: { fontFamily: font.serif, fontSize: 17 },
  add: { fontFamily: font.semibold, fontSize: 14 },
  empty: { fontFamily: font.regular, fontSize: 14, paddingHorizontal: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 9, paddingHorizontal: 4, borderBottomWidth: 1 },
  rowTime: { width: 40, fontFamily: font.semibold, fontSize: 13, fontVariant: ['tabular-nums', 'lining-nums'] },
  rowBar: { width: 3, height: 18, borderRadius: 2 },
  rowT: { flex: 1, fontFamily: font.medium, fontSize: 14.5 },
  rowSrc: { fontFamily: font.regular, fontSize: 11.5 },
});

// The day's schedule: every task with a time and every phone calendar event, in clock order. A task with a time
// lives only here, not in the day's list, and is checked off from its row.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { calendarAccess, eventsFor, type CalendarAccess, type PhoneEvent } from '../calendar';
import { buildAgenda, nextUp, type AgendaItem } from '../domain/agenda';
import { dayTasks, isLateUrgent } from '../domain/logic';
import type { Task } from '../domain/types';
import { t as tr } from '../i18n';
import { openSheet, useApp } from '../store';
import { font, groupColor, useTheme, type Theme } from '../theme';
import { Pips } from './ui';

export const hm = (ms: number) => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export function useDayEvents(date: string, hidden: string[]) {
  const [events, setEvents] = useState<PhoneEvent[]>([]);
  const [access, setAccess] = useState<CalendarAccess>('undetermined');
  const load = useCallback(async () => {
    try {
      const a = await calendarAccess();
      setAccess(a);
      setEvents(a === 'granted' ? await eventsFor(date, hidden) : []);
    } catch {
      setEvents([]);
    }
  }, [date, hidden]);
  useEffect(() => {
    load();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') load();
    });
    return () => sub.remove();
  }, [load]);
  return { events, access, reload: load };
}

const barColor = (i: AgendaItem, t: Theme) => i.color ?? (i.groupColor !== null ? groupColor(t, i.groupColor) : i.source === 'calendar' ? t.soft : t.accent);

type Toggle = (x: Task, px: number, py: number) => void;

function Row({ item, task, now, isToday, next, onToggle, t }: { item: AgendaItem; task?: Task; now: number; isToday: boolean; next: boolean; onToggle: Toggle; t: Theme }) {
  const end = item.end ?? (item.start !== null ? item.start + 30 * 60000 : null);
  const past = isToday && end !== null && end <= now;
  const done = item.done;
  const late = task ? isLateUrgent(task, now) : false;
  const when = item.allDay ? tr.allDay : item.start !== null ? hm(item.start) : '';
  return (
    <View style={[s.row, { opacity: done ? 0.5 : past ? 0.6 : 1 }]}>
      {task ? (
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
      ) : (
        <View style={s.check} />
      )}
      <Pressable
        disabled={!task}
        onPress={() => task && openSheet({ id: task.id })}
        style={s.main}
        accessibilityRole={task ? 'button' : 'text'}
        accessibilityLabel={`${when} ${item.end !== null && !item.allDay ? tr.until(hm(item.end)) : ''} ${item.title}${item.place ? `, ${item.place}` : ''}`}
      >
        <View style={s.when}>
          <Text style={[s.start, { color: next ? t.accent : t.ink, fontFamily: next ? font.bold : font.semibold }]}>{when}</Text>
          {item.end !== null && !item.allDay ? <Text style={[s.end, { color: t.mute }]}>{hm(item.end)}</Text> : null}
        </View>
        <View style={[s.bar, { backgroundColor: barColor(item, t) }]} />
        <View style={s.info}>
          <Text
            style={[s.title, { color: late ? t.alert : t.ink, fontFamily: late ? font.bold : font.medium, textDecorationLine: done ? 'line-through' : 'none' }]}
            numberOfLines={2}
          >
            {item.title || tr.agendaUntitled}
            {task?.recurringId ? <Text style={{ color: t.soft }}>{'  ↻'}</Text> : null}
          </Text>
          {item.place ? <Text style={[s.sub, { color: t.mute }]} numberOfLines={1}>{item.place}</Text> : null}
        </View>
        {task ? <Pips points={task.points} muted={done} hot={late || task.points === 5} /> : null}
      </Pressable>
    </View>
  );
}

export function Agenda({ date, onToggle }: { date: string; onToggle: Toggle }) {
  const t = useTheme();
  const { data, today } = useApp();
  const { events, access } = useDayEvents(date, data.meta.hiddenCalendars);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  const tasks = useMemo(() => dayTasks(data, date), [data, date]);
  const items = useMemo(() => {
    const series = new Map(data.recurring.map((r) => [r.id, r]));
    const colors = new Map(data.groups.map((g) => [g.id, g.color]));
    return buildAgenda(date, tasks, series, events, colors);
  }, [data, date, tasks, events]);
  const byId = useMemo(() => new Map(tasks.map((x) => [x.id, x])), [tasks]);

  const isToday = date === today;
  // The item on now or next gets its time in green.
  const lead = isToday ? nextUp(items.filter((i) => !i.done), now) : null;

  if (!items.length) return null;

  return (
    <View style={s.wrap}>
      {items.map((i) => (
        <Row key={i.key} item={i} task={i.taskId ? byId.get(i.taskId) : undefined} now={now} isToday={isToday} next={lead?.item.key === i.key} onToggle={onToggle} t={t} />
      ))}
      {access === 'denied' ? <Text style={[s.note, { color: t.mute }]}>{tr.calendarDenied}</Text> : null}
      <View style={[s.rule, { backgroundColor: t.line }]} />
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { paddingTop: 2, paddingBottom: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, minHeight: 52 },
  check: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
  tick: { fontFamily: font.bold, fontSize: 13, lineHeight: 17 },
  main: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, minHeight: 52 },
  when: { width: 42, alignItems: 'flex-start' },
  start: { fontSize: 14, fontVariant: ['tabular-nums', 'lining-nums'] },
  end: { fontFamily: font.regular, fontSize: 11.5, fontVariant: ['tabular-nums', 'lining-nums'] },
  bar: { width: 3, alignSelf: 'stretch', borderRadius: 2 },
  info: { flex: 1 },
  title: { fontSize: 16.5 },
  sub: { fontFamily: font.regular, fontSize: 12.5 },
  note: { fontFamily: font.regular, fontSize: 12.5, paddingHorizontal: 20, paddingTop: 4 },
  rule: { height: StyleSheet.hairlineWidth, marginHorizontal: 20, marginTop: 6, marginBottom: 4 },
});

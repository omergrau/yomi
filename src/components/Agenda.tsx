// The day's schedule: phone calendar events, timetable slots and timed tasks, by the clock.
// Folded, it shows what is on now or next; open, the whole day.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { askCalendar, calendarAccess, eventsFor, type CalendarAccess, type PhoneEvent } from '../calendar';
import { buildAgenda, nextUp, type AgendaItem } from '../domain/agenda';
import { dayTasks } from '../domain/logic';
import { t as tr } from '../i18n';
import { openSheet, useApp } from '../store';
import { font, groupColor, useTheme, type Theme } from '../theme';

let openByDefault = false;

const hm = (ms: number) => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

function useDayEvents(date: string, hidden: string[]) {
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

function Row({ item, now, isToday, t }: { item: AgendaItem; now: number; isToday: boolean; t: Theme }) {
  const end = item.end ?? (item.start !== null ? item.start + 30 * 60000 : null);
  const past = isToday && end !== null && end <= now;
  const current = isToday && item.start !== null && end !== null && item.start <= now && now < end;
  const bar = item.color ?? (item.groupColor !== null ? groupColor(t, item.groupColor) : item.source === 'calendar' ? t.soft : t.accent);
  const sourceLabel = item.source === 'calendar' ? tr.agendaFromCalendar : item.source === 'timetable' ? tr.agendaFromTimetable : tr.agendaFromTask;
  return (
    <Pressable
      disabled={!item.taskId}
      onPress={() => item.taskId && openSheet({ id: item.taskId })}
      style={[s.row, { opacity: past || item.done ? 0.5 : 1, backgroundColor: current ? t.wash : 'transparent' }]}
      accessibilityRole={item.taskId ? 'button' : 'text'}
      accessibilityLabel={`${item.allDay ? tr.allDay : item.start !== null ? hm(item.start) : ''} ${item.title}`}
    >
      <View style={s.when}>
        <Text style={[s.start, { color: t.ink }]}>{item.allDay ? tr.allDay : item.start !== null ? hm(item.start) : ''}</Text>
        {item.end !== null && !item.allDay ? <Text style={[s.end, { color: t.mute }]}>{hm(item.end)}</Text> : null}
      </View>
      <View style={[s.bar, { backgroundColor: bar }]} />
      <View style={s.info}>
        <Text style={[s.title, { color: t.ink, textDecorationLine: item.done ? 'line-through' : 'none' }]} numberOfLines={1}>{item.title || tr.agendaUntitled}</Text>
        <Text style={[s.sub, { color: t.mute }]} numberOfLines={1}>{[current ? tr.agendaNow : null, item.place, sourceLabel].filter(Boolean).join(' · ')}</Text>
      </View>
    </Pressable>
  );
}

export function Agenda({ date }: { date: string }) {
  const t = useTheme();
  const { data, today } = useApp();
  const hidden = data.meta.hiddenCalendars;
  const { events, access, reload } = useDayEvents(date, hidden);
  const [open, setOpen] = useState(openByDefault);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(id);
  }, []);

  const items = useMemo(() => {
    const series = new Map(data.recurring.map((r) => [r.id, r]));
    const colors = new Map(data.groups.map((g) => [g.id, g.color]));
    return buildAgenda(date, dayTasks(data, date), series, events, colors);
  }, [data, date, events]);

  const isToday = date === today;
  const next = isToday ? nextUp(items, now) : null;
  const summary = !items.length
    ? tr.agendaEmpty
    : next
      ? `${next.current ? tr.agendaNow : tr.agendaNext} ${hm(next.item.start as number)} · ${next.item.title || tr.agendaUntitled}`
      : isToday
        ? tr.agendaDone
        : tr.agendaCount(items.length);

  const toggle = () => {
    openByDefault = !open;
    setOpen(!open);
  };

  return (
    <View style={[s.box, { borderColor: t.line }]}>
      <Pressable onPress={toggle} style={s.head} accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={`${tr.agenda}: ${summary}`}>
        <Text style={[s.label, { color: t.ink }]}>{tr.agenda}</Text>
        <Text style={[s.summary, { color: t.mute }]} numberOfLines={1}>{summary}</Text>
        <Text style={[s.chev, { color: t.mute, transform: [{ rotate: open ? '180deg' : '0deg' }] }]}>⌄</Text>
      </Pressable>
      {open ? (
        <View style={s.list}>
          {items.map((i) => (
            <Row key={i.key} item={i} now={now} isToday={isToday} t={t} />
          ))}
          {access === 'undetermined' ? (
            <Pressable
              onPress={async () => {
                await askCalendar();
                reload();
              }}
              style={[s.connect, { backgroundColor: t.wash }]}
              accessibilityRole="button"
            >
              <Text style={[s.connectT, { color: t.accent }]}>{tr.calendarConnect}</Text>
              <Text style={[s.connectS, { color: t.mute }]}>{tr.calendarConnectWhy}</Text>
            </Pressable>
          ) : null}
          {access === 'denied' ? <Text style={[s.note, { color: t.mute }]}>{tr.calendarDenied}</Text> : null}
          {access === 'unavailable' ? <Text style={[s.note, { color: t.mute }]}>{tr.calendarPhoneOnly}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  box: { marginHorizontal: 14, marginTop: 6, borderWidth: 1, borderRadius: 10, overflow: 'hidden' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, height: 36 },
  label: { fontFamily: font.semibold, fontSize: 13.5 },
  summary: { flex: 1, fontFamily: font.regular, fontSize: 13, fontVariant: ['tabular-nums', 'lining-nums'] },
  chev: { fontSize: 15, lineHeight: 17 },
  list: { paddingBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 12, paddingVertical: 5 },
  when: { width: 44, alignItems: 'flex-start' },
  start: { fontFamily: font.semibold, fontSize: 13.5, fontVariant: ['tabular-nums', 'lining-nums'] },
  end: { fontFamily: font.regular, fontSize: 11.5, fontVariant: ['tabular-nums', 'lining-nums'] },
  bar: { width: 3, alignSelf: 'stretch', borderRadius: 2 },
  info: { flex: 1 },
  title: { fontFamily: font.medium, fontSize: 14.5 },
  sub: { fontFamily: font.regular, fontSize: 12 },
  connect: { marginHorizontal: 12, marginTop: 4, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  connectT: { fontFamily: font.semibold, fontSize: 14 },
  connectS: { fontFamily: font.regular, fontSize: 12.5 },
  note: { fontFamily: font.regular, fontSize: 12.5, paddingHorizontal: 12, paddingTop: 4 },
});

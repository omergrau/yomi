// One quiet line for the phone calendar: what is on now or next. Tapping it opens the whole day's schedule.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { calendarAccess, eventsFor, type CalendarAccess, type PhoneEvent } from '../calendar';
import { buildAgenda, nextUp, type AgendaItem } from '../domain/agenda';
import { dayTasks } from '../domain/logic';
import { t as tr } from '../i18n';
import { openSheet, useApp } from '../store';
import { font, groupColor, useTheme, type Theme } from '../theme';

let openByDefault = false;

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

function Row({ item, now, isToday, t }: { item: AgendaItem; now: number; isToday: boolean; t: Theme }) {
  const end = item.end ?? (item.start !== null ? item.start + 30 * 60000 : null);
  const past = isToday && end !== null && end <= now;
  return (
    <Pressable
      disabled={!item.taskId}
      onPress={() => item.taskId && openSheet({ id: item.taskId })}
      style={[s.row, { opacity: past || item.done ? 0.5 : 1 }]}
      accessibilityRole={item.taskId ? 'button' : 'text'}
      accessibilityLabel={`${item.allDay ? tr.allDay : item.start !== null ? hm(item.start) : ''} ${item.title}`}
    >
      <View style={s.when}>
        <Text style={[s.start, { color: t.ink }]}>{item.allDay ? tr.allDay : item.start !== null ? hm(item.start) : ''}</Text>
        {item.end !== null && !item.allDay ? <Text style={[s.end, { color: t.mute }]}>{hm(item.end)}</Text> : null}
      </View>
      <View style={[s.bar, { backgroundColor: barColor(item, t) }]} />
      <View style={s.info}>
        <Text style={[s.title, { color: t.ink, textDecorationLine: item.done ? 'line-through' : 'none' }]} numberOfLines={1}>{item.title || tr.agendaUntitled}</Text>
        {item.place ? <Text style={[s.sub, { color: t.mute }]} numberOfLines={1}>{item.place}</Text> : null}
      </View>
    </Pressable>
  );
}

export function Agenda({ date }: { date: string }) {
  const t = useTheme();
  const { data, today } = useApp();
  const { events, access } = useDayEvents(date, data.meta.hiddenCalendars);
  const [open, setOpen] = useState(openByDefault);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  const items = useMemo(() => {
    const series = new Map(data.recurring.map((r) => [r.id, r]));
    const colors = new Map(data.groups.map((g) => [g.id, g.color]));
    return buildAgenda(date, dayTasks(data, date), series, events, colors);
  }, [data, date, events]);

  const isToday = date === today;
  // Tasks already sit in the day's list, so this line speaks only for the phone calendar.
  const outside = items.filter((i) => !i.taskId);
  const timed = outside.filter((i) => !i.allDay && i.start !== null);
  const lead = isToday ? nextUp(timed, now) : timed[0] ? { item: timed[0], current: false } : null;
  const allDay = outside.filter((i) => i.allDay);

  const toggle = () => {
    openByDefault = !open;
    setOpen(!open);
  };

  if (!outside.length) return null;

  const end = lead?.current && lead.item.start !== null ? lead.item.end ?? lead.item.start + 30 * 60000 : null;
  const label = lead
    ? `${lead.current && end ? `${tr.agendaNow} · ${tr.until(hm(end))}` : hm(lead.item.start as number)}  ${lead.item.title || tr.agendaUntitled}`
    : allDay.length
      ? `${tr.allDay}  ${allDay.map((i) => i.title).join(', ')}`
      : isToday
        ? tr.agendaDone
        : tr.agendaCount(outside.length);

  return (
    <View style={s.wrap}>
      <Pressable onPress={toggle} style={s.line} accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityHint={open ? tr.agendaLess : tr.agendaAll}>
        <View style={[s.dot, { backgroundColor: lead ? barColor(lead.item, t) : t.soft }]} />
        <Text style={[s.lineT, { color: lead ? t.ink : t.mute }]} numberOfLines={1}>{label}</Text>
        <Text style={[s.more, { color: t.soft }]}>{open ? '⌃' : '⌄'}</Text>
      </Pressable>
      {open ? (
        <View style={s.list}>
          {items.map((i) => (
            <Row key={i.key} item={i} now={now} isToday={isToday} t={t} />
          ))}
          {access === 'denied' ? <Text style={[s.note, { color: t.mute }]}>{tr.calendarDenied}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { paddingHorizontal: 20, paddingTop: 2, paddingBottom: 4 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 36 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  lineT: { flex: 1, fontFamily: font.medium, fontSize: 14, fontVariant: ['tabular-nums', 'lining-nums'] },
  more: { fontFamily: font.regular, fontSize: 14 },
  sub: { fontFamily: font.regular, fontSize: 12.5 },
  list: { paddingBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 5 },
  when: { width: 44, alignItems: 'flex-start' },
  start: { fontFamily: font.semibold, fontSize: 13.5, fontVariant: ['tabular-nums', 'lining-nums'] },
  end: { fontFamily: font.regular, fontSize: 11.5, fontVariant: ['tabular-nums', 'lining-nums'] },
  bar: { width: 3, alignSelf: 'stretch', borderRadius: 2 },
  info: { flex: 1 },
  title: { fontFamily: font.medium, fontSize: 14.5 },
  note: { fontFamily: font.regular, fontSize: 12.5, paddingTop: 4 },
});

// "Now and next": what is happening, how long is left, and what follows, from the phone calendar, the timetable
// and timed tasks. The rest of the day sits in a row of small tags, and the whole schedule opens on request.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { askCalendar, calendarAccess, eventsFor, type CalendarAccess, type PhoneEvent } from '../calendar';
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

const sourceLabel = (i: AgendaItem) => (i.source === 'calendar' ? tr.agendaFromCalendar : i.source === 'timetable' ? tr.agendaFromTimetable : tr.agendaFromTask);
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
        <Text style={[s.sub, { color: t.mute }]} numberOfLines={1}>{[item.place, sourceLabel(item)].filter(Boolean).join(' · ')}</Text>
      </View>
    </Pressable>
  );
}

export function Agenda({ date }: { date: string }) {
  const t = useTheme();
  const { data, today } = useApp();
  const { events, access, reload } = useDayEvents(date, data.meta.hiddenCalendars);
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
  const lead = isToday ? nextUp(items, now) : items.find((i) => !i.allDay && i.start !== null) ? { item: items.find((i) => !i.allDay && i.start !== null) as AgendaItem, current: false } : null;
  const after = lead ? items.filter((i) => !i.allDay && i.start !== null && i.start > (lead.item.start as number) && i.key !== lead.item.key) : [];
  const next = lead?.current ? after[0] : null;
  const chips = lead ? after.slice(lead.current ? 1 : 0) : [];
  const allDay = items.filter((i) => i.allDay);

  const toggle = () => {
    openByDefault = !open;
    setOpen(!open);
  };

  if (!items.length && access !== 'undetermined') return null;

  let progress = 0;
  let left = '';
  if (lead?.current && lead.item.start !== null) {
    const end = lead.item.end ?? lead.item.start + 30 * 60000;
    progress = Math.min(1, Math.max(0, (now - lead.item.start) / (end - lead.item.start)));
    left = tr.minutesLeft(Math.max(1, Math.round((end - now) / 60000)));
  }

  return (
    <View style={[s.card, { backgroundColor: t.wash }]}>
      {lead ? (
        <Pressable
          disabled={!lead.item.taskId}
          onPress={() => lead.item.taskId && openSheet({ id: lead.item.taskId })}
          accessibilityRole={lead.item.taskId ? 'button' : 'text'}
          style={s.lead}
        >
          <Text style={[s.kicker, { color: t.accent }]}>
            {`${lead.current ? tr.agendaNow : isToday ? tr.agendaNext : tr.agendaFirst} · ${hm(lead.item.start as number)}${lead.item.end ? `–${hm(lead.item.end)}` : ''}`}
          </Text>
          <Text style={[s.big, { color: t.ink }]} numberOfLines={2}>{lead.item.title || tr.agendaUntitled}</Text>
          <Text style={[s.sub, { color: t.mute }]} numberOfLines={1}>{[lead.item.place, left || null, sourceLabel(lead.item)].filter(Boolean).join(' · ')}</Text>
          {lead.current ? (
            <View style={[s.prog, { backgroundColor: t.line }]}>
              <View style={[s.progFill, { width: `${progress * 100}%`, backgroundColor: t.accent }]} />
            </View>
          ) : null}
        </Pressable>
      ) : (
        <Text style={[s.sub, s.lead, { color: t.mute }]}>{items.length ? (isToday ? tr.agendaDone : tr.agendaCount(items.length)) : tr.agendaEmpty}</Text>
      )}

      {next ? (
        <View style={[s.nextRow, { borderTopColor: t.line }]}>
          <Text style={[s.nextK, { color: t.ink }]}>{tr.agendaNext}</Text>
          <Text style={[s.nextT, { color: t.ink }]} numberOfLines={1}>{`${hm(next.start as number)} ${next.title || tr.agendaUntitled}`}</Text>
          <Text style={[s.tag, { color: t.mute, backgroundColor: t.paper }]}>{sourceLabel(next)}</Text>
        </View>
      ) : null}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips} keyboardShouldPersistTaps="handled">
        {allDay.map((i) => (
          <View key={i.key} style={[s.chip, { backgroundColor: t.paper, borderColor: t.line }]}>
            <Text style={[s.chipT, { color: t.mute }]} numberOfLines={1}>
              <Text style={{ color: t.ink, fontFamily: font.semibold }}>{tr.allDay}</Text> {i.title}
            </Text>
          </View>
        ))}
        {(next ? chips.slice(1) : chips).map((i) => (
          <View key={i.key} style={[s.chip, { backgroundColor: t.paper, borderColor: t.line }]}>
            <Text style={[s.chipT, { color: t.mute }]} numberOfLines={1}>
              <Text style={{ color: t.ink, fontFamily: font.semibold }}>{hm(i.start as number)}</Text> {i.title}
            </Text>
          </View>
        ))}
        <Pressable onPress={toggle} style={[s.chip, { backgroundColor: t.paper, borderColor: t.line }]} accessibilityRole="button" accessibilityState={{ expanded: open }}>
          <Text style={[s.chipT, { color: t.ink }]}>{open ? tr.agendaLess : tr.agendaAll}</Text>
        </Pressable>
      </ScrollView>

      {open ? (
        <View style={[s.list, { borderTopColor: t.line }]}>
          {items.map((i) => (
            <Row key={i.key} item={i} now={now} isToday={isToday} t={t} />
          ))}
          {access === 'undetermined' ? (
            <Pressable
              onPress={async () => {
                await askCalendar();
                reload();
              }}
              style={[s.connect, { backgroundColor: t.paper }]}
              accessibilityRole="button"
            >
              <Text style={[s.connectT, { color: t.accent }]}>{tr.calendarConnect}</Text>
              <Text style={[s.sub, { color: t.mute }]}>{tr.calendarConnectWhy}</Text>
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
  card: { marginHorizontal: 14, marginTop: 8, borderRadius: 14, paddingTop: 10, overflow: 'hidden' },
  lead: { paddingHorizontal: 14, gap: 3 },
  kicker: { fontFamily: font.bold, fontSize: 11.5, fontVariant: ['tabular-nums', 'lining-nums'] },
  big: { fontFamily: font.serif, fontSize: 18, lineHeight: 23 },
  sub: { fontFamily: font.regular, fontSize: 12.5 },
  prog: { height: 5, borderRadius: 3, overflow: 'hidden', marginTop: 5 },
  progFill: { height: '100%' },
  nextRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 14, marginTop: 9, paddingTop: 8, borderTopWidth: 1 },
  nextK: { fontFamily: font.bold, fontSize: 13 },
  nextT: { flex: 1, fontFamily: font.regular, fontSize: 13, fontVariant: ['tabular-nums', 'lining-nums'] },
  tag: { fontFamily: font.regular, fontSize: 11, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6, overflow: 'hidden' },
  chips: { gap: 6, paddingHorizontal: 14, paddingTop: 9, paddingBottom: 10 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 9, height: 24, justifyContent: 'center' },
  chipT: { fontFamily: font.regular, fontSize: 11.5, fontVariant: ['tabular-nums', 'lining-nums'] },
  list: { borderTopWidth: 1, paddingVertical: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 14, paddingVertical: 5 },
  when: { width: 44, alignItems: 'flex-start' },
  start: { fontFamily: font.semibold, fontSize: 13.5, fontVariant: ['tabular-nums', 'lining-nums'] },
  end: { fontFamily: font.regular, fontSize: 11.5, fontVariant: ['tabular-nums', 'lining-nums'] },
  bar: { width: 3, alignSelf: 'stretch', borderRadius: 2 },
  info: { flex: 1 },
  title: { fontFamily: font.medium, fontSize: 14.5 },
  connect: { marginHorizontal: 14, marginTop: 4, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  connectT: { fontFamily: font.semibold, fontSize: 14 },
  note: { fontFamily: font.regular, fontSize: 12.5, paddingHorizontal: 14, paddingTop: 4 },
});

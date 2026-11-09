// Builds one time-ordered schedule for a day from the phone's calendar and the app's own timed items.
import { fireTime } from './dates';
import type { Recurring, Task } from './types';

export type AgendaSource = 'calendar' | 'timetable' | 'task';
export type AgendaItem = {
  key: string;
  title: string;
  start: number | null;
  end: number | null;
  allDay: boolean;
  place: string | null;
  source: AgendaSource;
  color: string | null;
  groupColor: number | null;
  done: boolean;
  taskId: string | null;
};

export type CalendarEventLike = { id: string; title: string; start: number; end: number; allDay: boolean; location: string | null; color: string };

export function buildAgenda(date: string, tasks: Task[], series: Map<string, Recurring>, events: CalendarEventLike[], groupColors: Map<string, number>): AgendaItem[] {
  const items: AgendaItem[] = [];
  for (const e of events) {
    items.push({
      key: `c-${e.id}-${e.start}`, title: e.title, start: e.allDay ? null : e.start, end: e.allDay ? null : e.end, allDay: e.allDay,
      place: e.location, source: 'calendar', color: e.color || null, groupColor: null, done: false, taskId: null,
    });
  }
  for (const t of tasks) {
    if (!t.time || t.date !== date) continue;
    const r = t.recurringId ? series.get(t.recurringId) : undefined;
    items.push({
      key: `t-${t.id}`, title: t.title, start: fireTime(date, t.time, 0), end: r?.endTime ? fireTime(date, r.endTime, 0) : null, allDay: false,
      place: r?.place ?? null, source: r ? 'timetable' : 'task', color: null, groupColor: t.groupId ? groupColors.get(t.groupId) ?? null : null,
      done: !!t.doneAt, taskId: t.id,
    });
  }
  // All-day items lead; the rest follow the clock.
  return items.sort((a, b) => (a.allDay !== b.allDay ? (a.allDay ? -1 : 1) : (a.start ?? 0) - (b.start ?? 0) || a.title.localeCompare(b.title)));
}

/** The item happening now, or else the next one still to come. */
export function nextUp(items: AgendaItem[], now: number): { item: AgendaItem; current: boolean } | null {
  for (const i of items) {
    if (i.allDay || i.start === null) continue;
    const end = i.end ?? i.start + 30 * 60000;
    if (i.start <= now && now < end) return { item: i, current: true };
    if (i.start > now) return { item: i, current: false };
  }
  return null;
}

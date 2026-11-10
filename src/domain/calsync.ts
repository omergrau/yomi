// What the phone's "עוזר אישי" calendar should hold, and how to bring it there. Every task with a day becomes
// one event: a task with a time at its hours, a task without one as an all-day event. The calendar is the
// app's own, so it is rebuilt from the app's data and anything changed there by hand is set back.
import { addDays, fireTime, parseIso } from './dates';
import { alive } from './logic';
import { endLabel } from './order';
import type { AppData } from './types';

/** How many days back and ahead the calendar is kept in step. */
export const SYNC_BACK = 14;
export const SYNC_AHEAD = 120;
const DEFAULT_MIN = 30;
const MARK = 'yomi:';

export type CalSpec = {
  /** The task id. It is written into the event's notes so the event can be found again. */
  key: string;
  title: string;
  start: number;
  end: number;
  allDay: boolean;
  location: string | null;
  notes: string;
};

/** A day as UTC midnight, the way phone calendars keep all-day events. */
const utcDay = (date: string) => {
  const d = parseIso(date);
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
};

export function calendarSpecs(d: AppData, today: string): CalSpec[] {
  const from = addDays(today, -SYNC_BACK);
  const to = addDays(today, SYNC_AHEAD);
  const series = new Map(d.recurring.map((r) => [r.id, r]));
  const out: CalSpec[] = [];
  for (const t of alive(d)) {
    if (!t.date || t.date < from || t.date > to) continue;
    const r = t.recurringId ? series.get(t.recurringId) : undefined;
    const title = `${t.doneAt ? '✓ ' : ''}${t.title}`;
    const notes = `${MARK}${t.id}`;
    if (t.time) {
      const start = fireTime(t.date, t.time, 0);
      const endAt = endLabel(t, r);
      const end = endAt ? fireTime(t.date, endAt, 0) : start + DEFAULT_MIN * 60000;
      out.push({ key: t.id, title, start, end: Math.max(end, start + 60000), allDay: false, location: r?.place ?? null, notes });
    } else {
      out.push({ key: t.id, title, start: utcDay(t.date), end: utcDay(addDays(t.date, 1)), allDay: true, location: null, notes });
    }
  }
  return out;
}

/** The task id an event was written for, or null for an event the app did not write. */
export const keyOf = (notes: string | null | undefined) => {
  const m = notes?.match(/yomi:(\S+)/);
  return m ? m[1] : null;
};

export type CalEventLike = { id: string; notes: string | null; title: string; start: number; end: number; allDay: boolean; location: string | null };

/** The writes that bring the calendar's events in line with the wanted ones. */
export function planSync(existing: CalEventLike[], wanted: CalSpec[]) {
  const want = new Map(wanted.map((w) => [w.key, w]));
  const seen = new Set<string>();
  const update: { id: string; spec: CalSpec }[] = [];
  const remove: string[] = [];
  for (const e of existing) {
    const key = keyOf(e.notes);
    const w = key ? want.get(key) : undefined;
    // An event with no task behind it, or a second copy of one, goes away.
    if (!key || !w || seen.has(key)) {
      remove.push(e.id);
      continue;
    }
    seen.add(key);
    const same = e.title === w.title && e.start === w.start && e.end === w.end && e.allDay === w.allDay && (e.location ?? null) === w.location;
    if (!same) update.push({ id: e.id, spec: w });
  }
  const create = wanted.filter((w) => !seen.has(w.key));
  return { create, update, remove };
}

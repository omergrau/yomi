// Orders a day's open tasks around the clock: what comes next by time leads, and timed tasks whose time has
// passed join the ordinary to-do list instead of being marked done.
import { fireTime } from './dates';
import type { Recurring, Task } from './types';

const DEFAULT_LENGTH = 30 * 60000;

export function timeWindow(t: Task, series?: Recurring): { start: number; end: number } | null {
  if (!t.time || !t.date) return null;
  const start = fireTime(t.date, t.time, 0);
  const end = t.durationMin ? start + t.durationMin * 60000 : series?.endTime ? fireTime(t.date, series.endTime, 0) : start + DEFAULT_LENGTH;
  return { start, end: Math.max(end, start + 60000) };
}

/** The end of a timed task as HH:MM, from its own length or its timetable slot, or null when it has none. */
export function endLabel(t: Task, series?: Recurring): string | null {
  if (!t.time) return null;
  if (series?.endTime && !t.durationMin) return series.endTime;
  if (!t.durationMin) return null;
  const [h, m] = t.time.split(':').map(Number);
  const total = Math.min(h * 60 + m + t.durationMin, 23 * 60 + 59);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** `open` must already be in the day's urgency order. */
export function orderOpen(open: Task[], date: string, today: string, now: number, series: Map<string, Recurring>) {
  const upcoming: { t: Task; start: number }[] = [];
  const rest: Task[] = [];
  const overdue = new Set<string>();
  for (const t of open) {
    const w = timeWindow(t, t.recurringId ? series.get(t.recurringId) : undefined);
    if (!w) {
      rest.push(t);
      continue;
    }
    const passed = date < today || (date === today && w.end <= now);
    if (passed) {
      overdue.add(t.id);
      rest.push(t);
    } else upcoming.push({ t, start: w.start });
  }
  upcoming.sort((a, b) => a.start - b.start);
  return { ordered: [...upcoming.map((x) => x.t), ...rest], overdue };
}

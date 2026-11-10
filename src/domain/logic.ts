// Every product rule lives here as a pure function, so it can be tested without a device.
import { addDays, fireTime, toIso, weekDays, weekday } from './dates';
import { timeWindow } from './order';
import type { AppData, Backup, Change, Checklist, DayLog, EventType, Group, Points, Recurring, Task, TaskEvent } from './types';

export const STREAK_GOAL = 0.7;
export const POINTS_PER_LEVEL = 250;
export const HORIZON_DAYS = 28;

let counter = 0;
export const newId = (now: number = Date.now()) => `${now.toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 7)}`;

const event = (taskId: string, type: EventType, fromDate: string | null, toDate: string | null, at: number): TaskEvent => ({
  id: newId(at), taskId, type, fromDate, toDate, at,
});

export const alive = (d: AppData) => Object.values(d.tasks).filter((t) => !t.deletedAt);
const bySort = (a: Task, b: Task) => a.sort - b.sort || a.createdAt - b.createdAt;
/** More urgent tasks come first. Within the same urgency, the order the person set is kept. */
const byUrgency = (a: Task, b: Task) => b.points - a.points || bySort(a, b);
export const dayTasks = (d: AppData, date: string) => alive(d).filter((t) => t.date === date).sort(byUrgency);
export const poolTasks = (d: AppData) => alive(d).filter((t) => t.date === null && !t.doneAt).sort(byUrgency);

export type DayStats = { total: number; done: number; pct: number; count: number; doneCount: number; closed: boolean; streakKept: boolean; toStreak: number; left: number };

export function dayStats(d: AppData, date: string): DayStats {
  const ts = dayTasks(d, date);
  const done = ts.filter((t) => t.doneAt).reduce((a, t) => a + t.points, 0);
  // A finished day also counts what was planned but moved away afterwards.
  const logged = d.dayLogs[date];
  const total = Math.max(ts.reduce((a, t) => a + t.points, 0), logged?.planned ?? 0);
  const pct = total ? done / total : 0;
  return {
    total, done, pct,
    count: ts.length,
    doneCount: ts.filter((t) => t.doneAt).length,
    closed: total > 0 && done === total,
    streakKept: total > 0 && pct >= STREAK_GOAL,
    toStreak: Math.max(0, Math.ceil(total * STREAK_GOAL) - done),
    left: total - done,
  };
}

/** Consecutive days that reached the goal. Days with nothing planned neither extend nor break it. */
export function streak(d: AppData, today: string): number {
  let n = 0;
  const logs = Object.values(d.dayLogs).filter((l) => l.date < today).sort((a, b) => (a.date < b.date ? 1 : -1));
  for (const l of logs) {
    if (!l.planned) continue;
    if (l.done / l.planned >= STREAK_GOAL) n++;
    else break;
  }
  return n + (dayStats(d, today).streakKept ? 1 : 0);
}

export const totalPoints = (d: AppData) => alive(d).filter((t) => t.doneAt).reduce((a, t) => a + t.points, 0);

export function levelInfo(total: number) {
  const into = total % POINTS_PER_LEVEL;
  return { level: Math.floor(total / POINTS_PER_LEVEL) + 1, into, toNext: POINTS_PER_LEVEL - into, pct: into / POINTS_PER_LEVEL };
}

export const bestDay = (d: AppData, today: string) => Math.max(0, dayStats(d, today).done, ...Object.values(d.dayLogs).map((l) => l.done));

export const weekSeries = (d: AppData, date: string) => weekDays(date).map((day) => ({ day, ...dayStats(d, day) }));

export function groupWeekPoints(d: AppData, groupId: string, date: string) {
  const days = new Set(weekDays(date));
  return alive(d).filter((t) => t.groupId === groupId && t.doneAt && t.date && days.has(t.date)).reduce((a, t) => a + t.points, 0);
}

export const historyLabelOrder = (e: TaskEvent[]) => [...e].sort((a, b) => b.at - a.at);

function nextSort(d: AppData, date: string | null, exclude?: string) {
  const list = date ? dayTasks(d, date) : poolTasks(d);
  return list.filter((t) => t.id !== exclude).reduce((m, t) => Math.max(m, t.sort), 0) + 1;
}

/** Timed tasks enter the day in time order. The rest go to the end. */
function renumberWithInsert(d: AppData, date: string, task: Task, at?: number): Task[] {
  const others = dayTasks(d, date).filter((t) => t.id !== task.id);
  let index = at;
  if (index === undefined) {
    index = others.length;
    if (task.time) {
      const later = others.findIndex((t) => t.time && t.time > task.time!);
      if (later >= 0) index = later;
    }
  }
  index = Math.max(0, Math.min(index, others.length));
  const ordered = [...others.slice(0, index), task, ...others.slice(index)];
  const out: Task[] = [];
  ordered.forEach((t, i) => {
    const sort = i + 1;
    if (t === task) out.push({ ...task, sort });
    else if (t.sort !== sort) out.push({ ...t, sort });
  });
  return out;
}

export type TaskInput = { title: string; groupId: string | null; points: Points; date: string | null; time: string | null; reminderMin: number | null; durationMin?: number | null };

export function createTask(d: AppData, input: TaskInput, now: number): Change {
  const task: Task = {
    id: newId(now), ...input, reminderMin: input.time ? input.reminderMin : null, durationMin: input.time ? input.durationMin ?? undefined : undefined,
    sort: 0, deferrals: 0, doneAt: null, recurringId: null, occurrenceDate: null, createdAt: now, deletedAt: null,
  };
  const tasks = input.date ? renumberWithInsert(d, input.date, task) : [{ ...task, sort: nextSort(d, null) }];
  const events = [event(task.id, 'created', null, input.date, now)];
  return { tasks, events };
}

/** Moving to a later day from a planned day counts as a deferral. Moving earlier or planning from the pool does not. */
export function moveTask(d: AppData, id: string, to: string | null, now: number, opts?: { index?: number; keepTime?: boolean }): Change {
  const t = d.tasks[id];
  if (!t) return {};
  const from = t.date;
  if (from === to && opts?.index === undefined) return {};
  const later = !!from && !!to && to > from;
  const keep = opts?.keepTime ?? to !== null;
  const moved: Task = {
    ...t, date: to,
    time: keep ? t.time : null,
    reminderMin: keep ? t.reminderMin : null,
    durationMin: keep ? t.durationMin : undefined,
    deferrals: t.deferrals + (later ? 1 : 0),
  };
  const tasks = to ? renumberWithInsert(d, to, moved, opts?.index) : [{ ...moved, sort: 0 }];
  if (from === to) return { tasks };
  const type: EventType = to === null ? 'unplanned' : from === null ? 'planned' : later ? 'deferred' : 'moved';
  return { tasks, events: [event(id, type, from, to, now)] };
}

/** Pulling a fixed occurrence out removes only that occurrence. It has no place in the pool. */
export function removeFromDay(d: AppData, id: string, now: number): Change {
  const t = d.tasks[id];
  if (!t) return {};
  if (t.recurringId) return deleteTask(d, id, now);
  return moveTask(d, id, null, now, { keepTime: false });
}

export function deleteTask(d: AppData, id: string, now: number): Change {
  const t = d.tasks[id];
  if (!t) return {};
  return { tasks: [{ ...t, deletedAt: now }], events: [event(id, 'deleted', t.date, null, now)] };
}

export function setDone(d: AppData, id: string, done: boolean, today: string, now: number): Change {
  const t = d.tasks[id];
  if (!t) return {};
  const date = t.date ?? today;
  const series = t.recurringId ? d.recurring.find((r) => r.id === t.recurringId) : undefined;
  const w = timeWindow(t, series);
  const updated: Task = { ...t, date, doneAt: done ? now : null, noAuto: !done && !!w && w.end <= now ? true : t.noAuto };
  const change: Change = { tasks: [updated], events: [event(id, done ? 'completed' : 'reopened', t.date, date, now)] };
  // Correcting a past day keeps its log, and so the streak, accurate.
  const log = d.dayLogs[date];
  if (log) {
    const next: AppData = { ...d, tasks: { ...d.tasks, [id]: updated } };
    const doneNow = dayTasks(next, date).filter((x) => x.doneAt).reduce((a, x) => a + x.points, 0);
    change.dayLogs = [{ ...log, done: doneNow, planned: Math.max(log.planned, doneNow) }];
  }
  return change;
}

/** Completes every timed task whose time has ended, unless the person reopened it before. */
export function autoComplete(d: AppData, now: number): { change: Change; titles: string[]; points: number } {
  const series = new Map(d.recurring.map((r) => [r.id, r]));
  let cur = d;
  let change: Change = {};
  const titles: string[] = [];
  let points = 0;
  for (const t of alive(d)) {
    if (t.doneAt || t.noAuto || !t.date || !t.time) continue;
    const w = timeWindow(t, t.recurringId ? series.get(t.recurringId) : undefined);
    if (!w || w.end > now) continue;
    const c = setDone(cur, t.id, true, t.date, now);
    cur = applyChange(cur, c);
    change = merge(change, c);
    titles.push(t.title);
    points += t.points;
  }
  return { change, titles, points };
}

export function editTask(d: AppData, id: string, input: TaskInput, now: number): Change {
  const t = d.tasks[id];
  if (!t) return {};
  const base: Task = {
    ...t, title: input.title, groupId: input.groupId, points: input.points, time: input.time,
    reminderMin: input.time ? input.reminderMin : null, durationMin: input.time ? input.durationMin ?? undefined : undefined,
  };
  const withBase: AppData = { ...d, tasks: { ...d.tasks, [id]: base } };
  const move = input.date !== t.date ? moveTask(withBase, id, input.date, now, { keepTime: true }) : { tasks: [base] };
  const change: Change = { ...move };
  if (t.recurringId) {
    // Editing a fixed item updates the series and its open future occurrences.
    const r = d.recurring.find((x) => x.id === t.recurringId);
    if (r) {
      change.recurring = [{ ...r, title: input.title, groupId: input.groupId, points: input.points, time: input.time, reminderMin: input.time ? input.reminderMin : null }];
      const siblings = alive(d).filter((x) => x.recurringId === r.id && x.id !== id && !x.doneAt && x.date && t.date && x.date > t.date);
      change.tasks = [...(change.tasks ?? []), ...siblings.map((x) => ({ ...x, title: input.title, groupId: input.groupId, points: input.points, time: input.time, reminderMin: input.time ? input.reminderMin : null }))];
    }
  }
  return change;
}

export type RecurringInput = Omit<Recurring, 'id' | 'endedAt' | 'startDate'>;

export function createRecurring(d: AppData, input: RecurringInput, today: string, now: number): Change {
  const r: Recurring = { ...input, id: newId(now), startDate: today, endedAt: null, reminderMin: input.time ? input.reminderMin : null };
  const next: AppData = { ...d, recurring: [...d.recurring, r] };
  return { recurring: [r], ...materialize(next, today, now) };
}

/** Edits a series and its open occurrences from today on. Past and finished occurrences keep what they were. */
export function editRecurring(d: AppData, id: string, input: RecurringInput, today: string, now: number): Change {
  const r = d.recurring.find((x) => x.id === id);
  if (!r) return {};
  const reminderMin = input.time ? input.reminderMin : null;
  const updated: Recurring = { ...r, ...input, weekdays: r.weekdays, reminderMin };
  const future = alive(d).filter((t) => t.recurringId === id && !t.doneAt && t.date && t.date >= today);
  const base: Change = {
    recurring: [updated],
    tasks: future.map((t) => ({ ...t, title: input.title, groupId: input.groupId, points: input.points, time: input.time, reminderMin })),
  };
  return merge(base, setWeekdays(applyChange(d, base), id, input.weekdays, today, now));
}

/** Ends a series from the given day on. Past and finished occurrences stay in the history. */
export function endRecurring(d: AppData, recurringId: string, fromDate: string, now: number): Change {
  const r = d.recurring.find((x) => x.id === recurringId);
  if (!r) return {};
  const future = alive(d).filter((t) => t.recurringId === recurringId && !t.doneAt && t.date && t.date >= fromDate);
  return {
    recurring: [{ ...r, endedAt: now }],
    tasks: future.map((t) => ({ ...t, deletedAt: now })),
    events: future.map((t) => event(t.id, 'deleted', t.date, null, now)),
  };
}

/** Changes the days of a series. Open future occurrences on removed days go away, and new days fill in. */
export function setWeekdays(d: AppData, recurringId: string, weekdays: number[], today: string, now: number): Change {
  const r = d.recurring.find((x) => x.id === recurringId);
  if (!r || !weekdays.length || [...r.weekdays].sort().join() === [...weekdays].sort().join()) return {};
  const updated = { ...r, weekdays };
  const gone = alive(d).filter((t) => t.recurringId === recurringId && !t.doneAt && t.occurrenceDate && t.occurrenceDate > today && !weekdays.includes(weekday(t.occurrenceDate)));
  const removal: Change = {
    recurring: [updated],
    tasks: gone.map((t) => ({ ...t, deletedAt: now })),
    events: gone.map((t) => event(t.id, 'deleted', t.date, null, now)),
  };
  return merge(removal, materialize(applyChange(d, removal), today, now));
}

/** Creates occurrences for the coming weeks. A deleted or moved occurrence is never recreated. */
export function materialize(d: AppData, today: string, now: number): Change {
  const existing = new Set(Object.values(d.tasks).filter((t) => t.recurringId).map((t) => `${t.recurringId}|${t.occurrenceDate}`));
  const tasks: Task[] = [];
  const events: TaskEvent[] = [];
  let working = d;
  for (const r of d.recurring) {
    if (r.endedAt) continue;
    for (let i = 0; i <= HORIZON_DAYS; i++) {
      const date = addDays(today, i);
      if (date < r.startDate || !r.weekdays.includes(weekday(date)) || existing.has(`${r.id}|${date}`)) continue;
      const task: Task = {
        id: newId(now), title: r.title, groupId: r.groupId, points: r.points, date, sort: 0, time: r.time, reminderMin: r.reminderMin,
        deferrals: 0, doneAt: null, recurringId: r.id, occurrenceDate: date, createdAt: now, deletedAt: null,
      };
      const placed = renumberWithInsert(working, date, task);
      working = { ...working, tasks: { ...working.tasks, ...Object.fromEntries(placed.map((t) => [t.id, t])) } };
      for (const p of placed) {
        const at = tasks.findIndex((x) => x.id === p.id);
        if (at >= 0) tasks[at] = p;
        else tasks.push(p);
      }
      events.push(event(task.id, 'created', null, date, now));
    }
  }
  return tasks.length ? { tasks, events } : {};
}

/**
 * Starts a new day: snapshots the days that ended, then brings their unfinished tasks to today.
 * A rolled task loses its time and reminder, because the original slot has passed.
 * Fixed items stay where they were, and a long absence still counts as one deferral.
 */
export function rollover(d: AppData, today: string, now: number): Change {
  const past = alive(d).filter((t) => t.date && t.date < today);
  const dates = [...new Set(past.map((t) => t.date as string))].filter((x) => !d.dayLogs[x]);
  const dayLogs: DayLog[] = dates.map((date) => {
    const s = dayStats(d, date);
    return { date, planned: s.total, done: s.done };
  });
  const rolling = past.filter((t) => !t.doneAt && !t.recurringId).sort((a, b) => (a.date! < b.date! ? -1 : a.date! > b.date! ? 1 : a.sort - b.sort));
  const present = dayTasks(d, today);
  const tasks: Task[] = [];
  rolling.forEach((t, i) => tasks.push({ ...t, date: today, time: null, reminderMin: null, durationMin: undefined, deferrals: t.deferrals + 1, sort: i + 1 }));
  present.forEach((t, i) => {
    const sort = rolling.length + i + 1;
    if (t.sort !== sort) tasks.push({ ...t, sort });
  });
  return {
    tasks,
    dayLogs,
    events: rolling.map((t) => event(t.id, 'rolled', t.date, today, now)),
    meta: { lastDay: today },
  };
}

export function applyChange(d: AppData, c: Change): AppData {
  const tasks = c.tasks?.length ? { ...d.tasks, ...Object.fromEntries(c.tasks.map((t) => [t.id, t])) } : d.tasks;
  let groups = d.groups;
  if (c.groups?.length) {
    const up = new Map(c.groups.map((g) => [g.id, g]));
    groups = [...groups.map((g) => up.get(g.id) ?? g), ...c.groups.filter((g) => !groups.some((x) => x.id === g.id))];
  }
  if (c.removeGroups?.length) groups = groups.filter((g) => !c.removeGroups!.includes(g.id));
  let recurring = d.recurring;
  if (c.recurring?.length) {
    const up = new Map(c.recurring.map((r) => [r.id, r]));
    recurring = [...recurring.map((r) => up.get(r.id) ?? r), ...c.recurring.filter((r) => !recurring.some((x) => x.id === r.id))];
  }
  let lists = d.lists;
  if (c.lists?.length) {
    const up = new Map(c.lists.map((l) => [l.id, l]));
    lists = [...lists.map((l) => up.get(l.id) ?? l), ...c.lists.filter((l) => !lists.some((x) => x.id === l.id))].sort((a, b) => a.sort - b.sort);
  }
  if (c.removeLists?.length) lists = lists.filter((l) => !c.removeLists!.includes(l.id));
  const dayLogs = c.dayLogs?.length ? { ...d.dayLogs, ...Object.fromEntries(c.dayLogs.map((l) => [l.date, l])) } : d.dayLogs;
  return { tasks, groups, recurring, dayLogs, lists, meta: c.meta ? { ...d.meta, ...c.meta } : d.meta };
}

export const merge = (a: Change, b: Change): Change => {
  const byId = new Map<string, Task>();
  [...(a.tasks ?? []), ...(b.tasks ?? [])].forEach((t) => byId.set(t.id, t));
  return {
    tasks: [...byId.values()],
    groups: [...(a.groups ?? []), ...(b.groups ?? [])],
    removeGroups: [...(a.removeGroups ?? []), ...(b.removeGroups ?? [])],
    lists: [...(a.lists ?? []), ...(b.lists ?? [])],
    removeLists: [...(a.removeLists ?? []), ...(b.removeLists ?? [])],
    recurring: [...(a.recurring ?? []), ...(b.recurring ?? [])],
    dayLogs: [...(a.dayLogs ?? []), ...(b.dayLogs ?? [])],
    events: [...(a.events ?? []), ...(b.events ?? [])],
    meta: { ...a.meta, ...b.meta },
  };
};

export function createGroup(d: AppData, name: string, now: number): { change: Change; group: Group | null } {
  const clean = name.trim();
  if (!clean) return { change: {}, group: null };
  const found = d.groups.find((g) => g.name === clean);
  if (found) return { change: {}, group: found };
  const used = new Set(d.groups.map((g) => g.color));
  const color = [1, 2, 3, 4, 5, 6].find((c) => !used.has(c)) ?? (d.groups.length % 6) + 1;
  const group: Group = { id: newId(now), name: clean, color, sort: d.groups.reduce((m, g) => Math.max(m, g.sort), 0) + 1 };
  return { change: { groups: [group] }, group };
}

/** Deleting a group keeps its tasks and their points. They simply no longer belong to a group. */
export function deleteGroup(d: AppData, id: string): Change {
  return {
    removeGroups: [id],
    tasks: Object.values(d.tasks).filter((t) => t.groupId === id).map((t) => ({ ...t, groupId: null })),
    recurring: d.recurring.filter((r) => r.groupId === id).map((r) => ({ ...r, groupId: null })),
  };
}

export function createList(d: AppData, title: string, now: number): Checklist {
  return { id: newId(now), title: title.trim(), sort: d.lists.reduce((m, l) => Math.max(m, l.sort), 0) + 1, createdAt: now, items: [] };
}

/** Applies one edit to one list and returns the change, or nothing if the list is gone. */
export function editList(d: AppData, id: string, fn: (l: Checklist) => Checklist): Change {
  const l = d.lists.find((x) => x.id === id);
  return l ? { lists: [fn(l)] } : {};
}

export const addItem = (l: Checklist, text: string, now: number): Checklist => {
  const clean = text.trim();
  return clean ? { ...l, items: [...l.items, { id: newId(now), text: clean, done: false }] } : l;
};
export const toggleItem = (l: Checklist, id: string): Checklist => ({ ...l, items: l.items.map((x) => (x.id === id ? { ...x, done: !x.done } : x)) });
export const removeItem = (l: Checklist, id: string): Checklist => ({ ...l, items: l.items.filter((x) => x.id !== id) });
export const clearDone = (l: Checklist): Checklist => ({ ...l, items: l.items.filter((x) => !x.done) });

export type ReminderJob = { id: string; title: string; fireAt: number; time: string; urgent?: string[] };

/** From this hour an unfinished task of urgency 4 or 5 turns red, and a reminder repeats every whole hour until 23:00. */
export const URGENT_FROM_HOUR = 18;
export const URGENT_LAST_HOUR = 23;
export const isUrgent = (t: Task) => t.points >= 4;

/** An urgent task still open at 18:00 of its day, or later. A task left from an earlier day counts too. */
export function isLateUrgent(t: Task, now: number) {
  return !t.doneAt && !t.deletedAt && isUrgent(t) && !!t.date && fireTime(t.date, `${URGENT_FROM_HOUR}:00`, 0) <= now;
}

/** One reminder per whole hour from 18:00 to 23:00, listing the urgent tasks of that day that are still open. */
export function urgentJobs(d: AppData, now: number, days = 3): ReminderJob[] {
  const today = toIso(new Date(now));
  const open = alive(d).filter((t) => !t.doneAt && t.date && isUrgent(t));
  const jobs: ReminderJob[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(today, i);
    // Tasks left from earlier days roll over to today, so they are reminded today.
    const names = open.filter((t) => (i === 0 ? t.date! <= date : t.date === date)).sort((a, b) => b.points - a.points).map((t) => t.title);
    if (!names.length) continue;
    for (let h = URGENT_FROM_HOUR; h <= URGENT_LAST_HOUR; h++) {
      const fireAt = fireTime(date, `${String(h).padStart(2, '0')}:00`, 0);
      if (fireAt > now) jobs.push({ id: `urgent-${date}-${h}`, title: names[0], fireAt, time: '', urgent: names });
    }
  }
  return jobs;
}

export function reminderJobs(d: AppData, now: number, limit = 60): ReminderJob[] {
  const jobs: ReminderJob[] = [];
  for (const t of alive(d)) {
    if (t.doneAt || !t.date || !t.time || t.reminderMin === null) continue;
    const fireAt = fireTime(t.date, t.time, t.reminderMin);
    if (fireAt > now) jobs.push({ id: t.id, title: t.title, fireAt, time: t.time });
  }
  return jobs.sort((a, b) => a.fireAt - b.fireAt).slice(0, limit);
}

export function makeBackup(d: AppData, events: TaskEvent[], now: number): Backup {
  return {
    app: 'yomi', version: 1, exportedAt: now,
    data: { ...d, tasks: Object.values(d.tasks), dayLogs: Object.values(d.dayLogs) },
    events,
  };
}

/** Rejects anything that is not a whole backup, so a wrong file cannot damage the data. */
export function readBackup(raw: string): { data: AppData; events: TaskEvent[] } {
  const b = JSON.parse(raw) as Backup;
  if (b?.app !== 'yomi' || b.version !== 1 || !Array.isArray(b.data?.tasks) || !Array.isArray(b.data?.groups) || !Array.isArray(b.data?.recurring) || !Array.isArray(b.data?.dayLogs) || !Array.isArray(b.events)) {
    throw new Error('invalid backup');
  }
  for (const t of b.data.tasks) {
    if (typeof t.id !== 'string' || typeof t.title !== 'string' || ![1, 2, 3, 4, 5].includes(t.points)) throw new Error('invalid task');
  }
  return {
    data: {
      tasks: Object.fromEntries(b.data.tasks.map((t) => [t.id, t])),
      groups: b.data.groups,
      recurring: b.data.recurring,
      dayLogs: Object.fromEntries(b.data.dayLogs.map((l) => [l.date, l])),
      // Backups made before lists existed simply have none.
      lists: Array.isArray(b.data.lists) ? b.data.lists : [],
      meta: { lastDay: b.data.meta?.lastDay ?? null, theme: b.data.meta?.theme ?? 'system', hiddenCalendars: Array.isArray(b.data.meta?.hiddenCalendars) ? b.data.meta.hiddenCalendars : [] },
    },
    events: b.events,
  };
}

export const emptyData = (): AppData => ({ tasks: {}, groups: [], recurring: [], dayLogs: {}, lists: [], meta: { lastDay: null, theme: 'system', hiddenCalendars: [] } });

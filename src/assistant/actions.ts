// What the assistant may do in the app. Each action is a pure function of the data, so it can be tested
// without a phone or a network, and every change goes through the same logic as the buttons.
import { addDays, fireTime, weekday } from '../domain/dates';
import * as L from '../domain/logic';
import { endLabel, timeWindow } from '../domain/order';
import type { AppData, Change, Points, Task } from '../domain/types';

export type CalEvent = { title: string; start: number; end: number; allDay: boolean; location: string | null };
export type ActionResult = { result: unknown; change?: Change; summary?: string };
export type Ctx = { data: AppData; today: string; now: number; events: CalEvent[] };

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const hm = (ms: number) => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const toMin = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};
const clampUrgency = (n: number | null | undefined): Points => Math.max(1, Math.min(5, Math.round(n ?? 3))) as Points;

class ActionError extends Error {}
const need = (ok: boolean, message: string) => {
  if (!ok) throw new ActionError(message);
};

function topicId(d: AppData, name: string | null, now: number): { id: string | null; change: Change } {
  if (!name || !name.trim()) return { id: null, change: {} };
  const found = d.groups.find((g) => g.name.trim() === name.trim());
  if (found) return { id: found.id, change: {} };
  const made = L.createGroup(d, name, now);
  return { id: made.group?.id ?? null, change: made.change };
}

function describe(d: AppData, t: Task) {
  const series = t.recurringId ? d.recurring.find((r) => r.id === t.recurringId) : undefined;
  return {
    task_id: t.id,
    title: t.title,
    date: t.date,
    start: t.time,
    end: endLabel(t, series),
    urgency: t.points,
    topic: t.groupId ? d.groups.find((g) => g.id === t.groupId)?.name ?? null : null,
    done: !!t.doneAt,
    weekly: !!t.recurringId,
    times_postponed: t.deferrals,
  };
}

export function getSchedule(ctx: Ctx, input: { from_date: string; to_date: string }): ActionResult {
  need(DATE.test(input.from_date) && DATE.test(input.to_date) && input.from_date <= input.to_date, 'from_date and to_date must be YYYY-MM-DD, in order');
  const days: unknown[] = [];
  for (let day = input.from_date, i = 0; day <= input.to_date && i < 62; day = addDays(day, 1), i++) {
    const s = L.dayStats(ctx.data, day);
    days.push({
      date: day,
      weekday: weekday(day),
      tasks: L.dayTasks(ctx.data, day).map((t) => describe(ctx.data, t)),
      calendar: ctx.events
        .filter((e) => (e.allDay ? new Date(e.start).toDateString() === new Date(fireTime(day, '12:00', 0)).toDateString() : hmDate(e.start) === day))
        .map((e) => ({ title: e.title, start: e.allDay ? null : hm(e.start), end: e.allDay ? null : hm(e.end), all_day: e.allDay, place: e.location })),
      points_planned: s.total,
      points_done: s.done,
    });
  }
  const unscheduled = L.poolTasks(ctx.data).map((t) => describe(ctx.data, t));
  return { result: { days, my_tasks_without_a_day: unscheduled, topics: ctx.data.groups.map((g) => g.name) } };
}

function hmDate(ms: number) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export type AddTaskInput = {
  title: string; date: string | null; start: string | null; duration_min: number | null; urgency: number | null; topic: string | null; reminder_min: number | null;
};

export function addTask(ctx: Ctx, input: AddTaskInput): ActionResult {
  need(!!input.title?.trim(), 'title is required');
  need(input.date === null || DATE.test(input.date), 'date must be YYYY-MM-DD or null');
  need(input.start === null || TIME.test(input.start), 'start must be HH:MM or null');
  need(!input.start || !!input.date, 'a start time needs a date');
  const topic = topicId(ctx.data, input.topic, ctx.now);
  const after = L.applyChange(ctx.data, topic.change);
  const c = L.createTask(after, {
    title: input.title.trim(), groupId: topic.id, points: clampUrgency(input.urgency), date: input.date, time: input.start,
    reminderMin: input.start ? input.reminder_min ?? 0 : null, durationMin: input.start && input.duration_min ? Math.max(5, Math.round(input.duration_min)) : null,
  }, ctx.now);
  const task = c.tasks?.find((t) => t.title === input.title.trim() && !after.tasks[t.id]) as Task;
  const change = L.merge(topic.change, c);
  return { change, result: { added: describe(L.applyChange(ctx.data, change), task) }, summary: `נוספה: ${task.title}` };
}

export type UpdateTaskInput = {
  task_id: string; title: string | null; date: string | null; remove_from_day: boolean; start: string | null; clear_time: boolean;
  duration_min: number | null; urgency: number | null; topic: string | null; reminder_min: number | null;
};

export function updateTask(ctx: Ctx, input: UpdateTaskInput): ActionResult {
  const t = ctx.data.tasks[input.task_id];
  need(!!t && !t.deletedAt, 'no such task');
  need(input.date === null || DATE.test(input.date), 'date must be YYYY-MM-DD or null');
  need(input.start === null || TIME.test(input.start), 'start must be HH:MM or null');
  const topic = topicId(ctx.data, input.topic, ctx.now);
  const after = L.applyChange(ctx.data, topic.change);
  const date = input.remove_from_day ? null : input.date ?? t.date;
  const time = input.clear_time || !date ? null : input.start ?? t.time;
  const change = L.merge(
    topic.change,
    L.editTask(after, t.id, {
      title: input.title?.trim() || t.title,
      groupId: input.topic ? topic.id : t.groupId,
      points: input.urgency ? clampUrgency(input.urgency) : t.points,
      date,
      time,
      reminderMin: time ? input.reminder_min ?? t.reminderMin ?? 0 : null,
      durationMin: time ? input.duration_min ?? t.durationMin ?? null : null,
    }, ctx.now),
  );
  const next = L.applyChange(ctx.data, change);
  return { change, result: { updated: describe(next, next.tasks[t.id]) }, summary: `עודכנה: ${next.tasks[t.id].title}` };
}

export function completeTask(ctx: Ctx, input: { task_id: string; done: boolean }): ActionResult {
  const t = ctx.data.tasks[input.task_id];
  need(!!t && !t.deletedAt, 'no such task');
  const change = L.setDone(ctx.data, t.id, input.done, ctx.today, ctx.now);
  return { change, result: { task_id: t.id, done: input.done }, summary: `${input.done ? 'סומנה כבוצעה' : 'נפתחה מחדש'}: ${t.title}` };
}

export function deleteTask(ctx: Ctx, input: { task_id: string }): ActionResult {
  const t = ctx.data.tasks[input.task_id];
  need(!!t && !t.deletedAt, 'no such task');
  return { change: L.deleteTask(ctx.data, t.id, ctx.now), result: { deleted: t.id }, summary: `נמחקה: ${t.title}` };
}

export type WeeklyInput = {
  title: string; weekdays: number[]; start: string; end: string | null; place: string | null; urgency: number | null; topic: string | null; reminder_min: number | null;
};

export function addWeekly(ctx: Ctx, input: WeeklyInput): ActionResult {
  need(!!input.title?.trim(), 'title is required');
  need(Array.isArray(input.weekdays) && input.weekdays.length > 0 && input.weekdays.every((w) => Number.isInteger(w) && w >= 0 && w <= 6), 'weekdays are 0 (Sunday) to 6 (Saturday)');
  need(TIME.test(input.start), 'start must be HH:MM');
  need(input.end === null || (TIME.test(input.end) && toMin(input.end) > toMin(input.start)), 'end must be HH:MM after start, or null');
  const topic = topicId(ctx.data, input.topic, ctx.now);
  const after = L.applyChange(ctx.data, topic.change);
  const change = L.merge(
    topic.change,
    L.createRecurring(after, {
      title: input.title.trim(), groupId: topic.id, points: clampUrgency(input.urgency), weekdays: [...new Set(input.weekdays)].sort(),
      time: input.start, endTime: input.end, place: input.place?.trim() || null, reminderMin: input.reminder_min ?? 10,
    }, ctx.today, ctx.now),
  );
  return { change, result: { added_weekly: input.title.trim() }, summary: `נוסף למערכת: ${input.title.trim()}` };
}

/** Gaps of at least the given length between everything already booked, inside the waking window. */
export function findFreeTime(ctx: Ctx, input: { from_date: string; to_date: string; duration_min: number; earliest: string | null; latest: string | null }): ActionResult {
  need(DATE.test(input.from_date) && DATE.test(input.to_date) && input.from_date <= input.to_date, 'from_date and to_date must be YYYY-MM-DD, in order');
  need(input.duration_min > 0, 'duration_min must be positive');
  const earliest = input.earliest && TIME.test(input.earliest) ? input.earliest : '08:00';
  const latest = input.latest && TIME.test(input.latest) ? input.latest : '22:00';
  const series = new Map(ctx.data.recurring.map((r) => [r.id, r]));
  const slots: { date: string; start: string; end: string }[] = [];
  for (let day = input.from_date, i = 0; day <= input.to_date && i < 31; day = addDays(day, 1), i++) {
    let from = fireTime(day, earliest, 0);
    if (day === ctx.today) from = Math.max(from, Math.ceil(ctx.now / (15 * 60000)) * 15 * 60000);
    const until = fireTime(day, latest, 0);
    const busy: [number, number][] = [];
    for (const t of L.dayTasks(ctx.data, day)) {
      const w = timeWindow(t, t.recurringId ? series.get(t.recurringId) : undefined);
      if (w && !t.doneAt) busy.push([w.start, w.end]);
    }
    for (const e of ctx.events) if (!e.allDay && hmDate(e.start) === day) busy.push([e.start, e.end]);
    busy.sort((a, b) => a[0] - b[0]);
    let cursor = from;
    for (const [s, e] of [...busy, [until, until] as [number, number]]) {
      if (s - cursor >= input.duration_min * 60000 && cursor < until) slots.push({ date: day, start: hm(cursor), end: hm(Math.min(s, until)) });
      cursor = Math.max(cursor, e);
    }
  }
  return { result: { free: slots.slice(0, 20), searched_between: `${earliest}-${latest}` } };
}

function listView(l: AppData['lists'][number]) {
  return { list_id: l.id, title: l.title, items: l.items.map((x) => ({ item_id: x.id, text: x.text, checked: x.done })) };
}

export function getLists(ctx: Ctx): ActionResult {
  return { result: { lists: ctx.data.lists.map(listView) } };
}

export function createList(ctx: Ctx, input: { title: string; items: string[] }): ActionResult {
  need(!!input.title?.trim(), 'title is required');
  let list = L.createList(ctx.data, input.title, ctx.now);
  for (const text of input.items ?? []) list = L.addItem(list, text, ctx.now);
  return { change: { lists: [list] }, result: { created: listView(list) }, summary: `נוצרה רשימה: ${list.title} (${list.items.length})` };
}

export type UpdateListInput = {
  list_id: string; title: string | null; add: string[]; check: string[]; uncheck: string[]; remove: string[]; clear_checked: boolean;
};

/** One call can rename a list, add items, tick or untick them, remove some, and clear what is ticked. */
export function updateList(ctx: Ctx, input: UpdateListInput): ActionResult {
  let list = ctx.data.lists.find((l) => l.id === input.list_id);
  need(!!list, 'no such list; call get_lists for ids');
  list = list!;
  const known = new Set(list.items.map((x) => x.id));
  const unknown = [...(input.check ?? []), ...(input.uncheck ?? []), ...(input.remove ?? [])].filter((id) => !known.has(id));
  need(!unknown.length, `unknown item ids: ${unknown.join(', ')}`);
  if (input.title?.trim()) list = { ...list, title: input.title.trim() };
  for (const text of input.add ?? []) list = L.addItem(list, text, ctx.now);
  const check = new Set(input.check ?? []);
  const uncheck = new Set(input.uncheck ?? []);
  list = { ...list, items: list.items.map((x) => (check.has(x.id) ? { ...x, done: true } : uncheck.has(x.id) ? { ...x, done: false } : x)) };
  const remove = new Set(input.remove ?? []);
  list = { ...list, items: list.items.filter((x) => !remove.has(x.id)) };
  if (input.clear_checked) list = L.clearDone(list);
  const parts = [
    input.add?.length ? `נוספו ${input.add.length}` : '',
    check.size ? `סומנו ${check.size}` : '',
    remove.size || input.clear_checked ? 'הוסרו פריטים' : '',
  ].filter(Boolean);
  return { change: { lists: [list] }, result: { updated: listView(list) }, summary: `${list.title}: ${parts.join(', ') || 'עודכנה'}` };
}

export function deleteList(ctx: Ctx, input: { list_id: string }): ActionResult {
  const list = ctx.data.lists.find((l) => l.id === input.list_id);
  need(!!list, 'no such list; call get_lists for ids');
  return { change: { removeLists: [list!.id] }, result: { deleted: list!.id }, summary: `נמחקה רשימה: ${list!.title}` };
}

export const ACTIONS = {
  get_schedule: getSchedule,
  add_task: addTask,
  update_task: updateTask,
  complete_task: completeTask,
  delete_task: deleteTask,
  add_weekly: addWeekly,
  find_free_time: findFreeTime,
  get_lists: getLists,
  create_list: createList,
  update_list: updateList,
  delete_list: deleteList,
} as const;

export type ActionName = keyof typeof ACTIONS;

export function runAction(name: string, ctx: Ctx, input: unknown): ActionResult {
  const fn = ACTIONS[name as ActionName] as ((c: Ctx, i: never) => ActionResult) | undefined;
  if (!fn) throw new ActionError(`unknown action ${name}`);
  return fn(ctx, input as never);
}

export const isActionError = (e: unknown): e is Error => e instanceof ActionError;

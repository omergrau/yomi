import { describe, expect, it } from 'vitest';
import { fireTime } from '../domain/dates';
import * as L from '../domain/logic';
import type { AppData } from '../domain/types';
import { runAction, type Ctx } from './actions';

const TODAY = '2026-11-10'; // A Tuesday.
const NOW = fireTime(TODAY, '09:00', 0);
const ctx = (data: AppData, events: Ctx['events'] = []): Ctx => ({ data, today: TODAY, now: NOW, events });
const run = (data: AppData, name: string, input: unknown, events?: Ctx['events']) => {
  const r = runAction(name, ctx(data, events), input);
  return { ...r, data: r.change ? L.applyChange(data, r.change) : data };
};

describe('assistant actions', () => {
  it('adds a meeting with a time, a length and a new topic', () => {
    const r = run(L.emptyData(), 'add_task', { title: 'פגישה עם המנחה', date: '2026-11-12', start: '14:00', duration_min: 60, urgency: 4, topic: 'תואר', reminder_min: 30 });
    const t = L.alive(r.data)[0];
    expect(t).toMatchObject({ title: 'פגישה עם המנחה', date: '2026-11-12', time: '14:00', durationMin: 60, points: 4, reminderMin: 30 });
    expect(r.data.groups.map((g) => g.name)).toEqual(['תואר']);
    expect(r.summary).toContain('פגישה');
  });

  it('reuses an existing topic and keeps unchanged fields on update', () => {
    let d = run(L.emptyData(), 'add_task', { title: 'a', date: TODAY, start: '10:00', duration_min: 30, urgency: 2, topic: 'עבודה', reminder_min: null }).data;
    const id = L.alive(d)[0].id;
    d = run(d, 'update_task', { task_id: id, title: null, date: '2026-11-11', remove_from_day: false, start: null, clear_time: false, duration_min: null, urgency: null, topic: 'עבודה', reminder_min: null }).data;
    expect(d.tasks[id]).toMatchObject({ date: '2026-11-11', time: '10:00', durationMin: 30, points: 2 });
    expect(d.groups).toHaveLength(1);
  });

  it('can take a task off its day', () => {
    let d = run(L.emptyData(), 'add_task', { title: 'a', date: TODAY, start: '10:00', duration_min: null, urgency: 3, topic: null, reminder_min: null }).data;
    const id = L.alive(d)[0].id;
    d = run(d, 'update_task', { task_id: id, title: null, date: null, remove_from_day: true, start: null, clear_time: false, duration_min: null, urgency: null, topic: null, reminder_min: null }).data;
    expect(d.tasks[id]).toMatchObject({ date: null, time: null });
  });

  it('adds a weekly slot that shows up on its days', () => {
    const d = run(L.emptyData(), 'add_weekly', { title: 'אימון', weekdays: [0, 2], start: '18:00', end: '19:00', place: null, urgency: 3, topic: 'ספורט', reminder_min: 30 }).data;
    expect(L.dayTasks(d, TODAY).map((t) => t.title)).toEqual(['אימון']);
    expect(d.recurring[0]).toMatchObject({ endTime: '19:00', weekdays: [0, 2] });
  });

  it('finds free time around tasks and calendar events', () => {
    const d = run(L.emptyData(), 'add_task', { title: 'lecture', date: TODAY, start: '10:00', duration_min: 120, urgency: 3, topic: null, reminder_min: null }).data;
    const events = [{ title: 'dentist', start: fireTime(TODAY, '13:00', 0), end: fireTime(TODAY, '14:00', 0), allDay: false, location: null }];
    const r = runAction('find_free_time', ctx(d, events), { from_date: TODAY, to_date: TODAY, duration_min: 60, earliest: '08:00', latest: '18:00' });
    expect((r.result as { free: unknown[] }).free).toEqual([
      { date: TODAY, start: '09:00', end: '10:00' },
      { date: TODAY, start: '12:00', end: '13:00' },
      { date: TODAY, start: '14:00', end: '18:00' },
    ]);
  });

  it('reports the schedule with calendar events and tasks without a day', () => {
    let d = run(L.emptyData(), 'add_task', { title: 'today', date: TODAY, start: null, duration_min: null, urgency: 5, topic: null, reminder_min: null }).data;
    d = run(d, 'add_task', { title: 'someday', date: null, start: null, duration_min: null, urgency: 2, topic: null, reminder_min: null }).data;
    const events = [{ title: 'dentist', start: fireTime(TODAY, '13:00', 0), end: fireTime(TODAY, '14:00', 0), allDay: false, location: 'clinic' }];
    const r = runAction('get_schedule', ctx(d, events), { from_date: TODAY, to_date: TODAY }).result as any;
    expect(r.days[0].tasks[0]).toMatchObject({ title: 'today', urgency: 5 });
    expect(r.days[0].calendar[0]).toMatchObject({ title: 'dentist', start: '13:00', end: '14:00' });
    expect(r.my_tasks_without_a_day[0].title).toBe('someday');
  });

  it('creates a shopping list, ticks items while shopping, then clears and deletes it', () => {
    let r = run(L.emptyData(), 'create_list', { title: 'סופר', items: ['חלב', 'ביצים', 'לחם'] });
    let d = r.data;
    const list = d.lists[0];
    expect(list.items.map((x) => x.text)).toEqual(['חלב', 'ביצים', 'לחם']);
    const milk = list.items[0].id;
    d = run(d, 'update_list', { list_id: list.id, title: null, add: ['גבינה'], check: [milk], uncheck: [], remove: [], clear_checked: false }).data;
    expect(d.lists[0].items.map((x) => [x.text, x.done])).toEqual([['חלב', true], ['ביצים', false], ['לחם', false], ['גבינה', false]]);
    d = run(d, 'update_list', { list_id: list.id, title: 'קניות', add: [], check: [], uncheck: [], remove: [], clear_checked: true }).data;
    expect(d.lists[0]).toMatchObject({ title: 'קניות' });
    expect(d.lists[0].items.map((x) => x.text)).toEqual(['ביצים', 'לחם', 'גבינה']);
    const lists = runAction('get_lists', ctx(d), {}).result as any;
    expect(lists.lists[0].items[0]).toMatchObject({ text: 'ביצים', checked: false });
    d = run(d, 'delete_list', { list_id: list.id }).data;
    expect(d.lists).toEqual([]);
  });

  it('refuses list items it does not know', () => {
    const d = run(L.emptyData(), 'create_list', { title: 'x', items: ['a'] }).data;
    expect(() => runAction('update_list', ctx(d), { list_id: d.lists[0].id, title: null, add: [], check: ['nope'], uncheck: [], remove: [], clear_checked: false })).toThrow();
  });

  it('refuses bad input instead of guessing', () => {
    expect(() => runAction('add_task', ctx(L.emptyData()), { title: 'x', date: 'tomorrow', start: null, duration_min: null, urgency: 3, topic: null, reminder_min: null })).toThrow();
    expect(() => runAction('complete_task', ctx(L.emptyData()), { task_id: 'nope', done: true })).toThrow();
    expect(() => runAction('nope', ctx(L.emptyData()), {})).toThrow();
  });
});

describe('fields the model leaves out', () => {
  it('adds, updates and lists with only the required fields', () => {
    let r = run(L.emptyData(), 'add_task', { title: 'לקנות חלב' });
    const task = L.alive(r.data)[0];
    expect(task).toMatchObject({ title: 'לקנות חלב', date: null, time: null });
    r = run(r.data, 'update_task', { task_id: task.id, urgency: 5 });
    expect(L.alive(r.data)[0]).toMatchObject({ title: 'לקנות חלב', points: 5 });
    r = run(r.data, 'create_list', { title: 'קניות' });
    r = run(r.data, 'update_list', { list_id: r.data.lists[0].id, add: ['ביצים'] });
    expect(r.data.lists[0].items.map((x) => x.text)).toEqual(['ביצים']);
    r = run(r.data, 'add_weekly', { title: 'הרצאה', weekdays: [1], start: '10:00' });
    expect(() => run(r.data, 'find_free_time', { from_date: TODAY, to_date: TODAY, duration_min: 30 })).not.toThrow();
  });
});

describe('cancelling one weekly occurrence', () => {
  it('removes only that day and the series keeps repeating', () => {
    let r = run(L.emptyData(), 'add_weekly', { title: 'אימון', weekdays: [3], start: '18:00' });
    const occ = L.alive(r.data).filter((t) => t.recurringId).sort((a, b) => (a.date! < b.date! ? -1 : 1));
    expect(occ.length).toBeGreaterThan(1);
    r = run(r.data, 'cancel_weekly_once', { task_id: occ[0].id });
    expect(r.summary).toContain('בוטל הפעם');
    const left = L.alive(r.data).filter((t) => t.recurringId);
    expect(left.map((t) => t.id)).not.toContain(occ[0].id);
    expect(left.length).toBe(occ.length - 1);
    expect(r.data.recurring[0].endedAt).toBeNull();
    // Filling in the coming weeks again must not bring the cancelled day back.
    const again = L.applyChange(r.data, L.materialize(r.data, TODAY, NOW + 1000));
    expect(L.alive(again).filter((t) => t.recurringId).map((t) => t.date)).not.toContain(occ[0].date);
  });

  it('refuses a task that is not weekly', () => {
    const r = run(L.emptyData(), 'add_task', { title: 'משהו', date: TODAY });
    expect(() => run(r.data, 'cancel_weekly_once', { task_id: L.alive(r.data)[0].id })).toThrow();
  });
});

describe('alarm clocks', () => {
  it('sets an alarm, lists it and removes it', () => {
    let r = run(L.emptyData(), 'set_alarm', { date: '2026-11-11', time: '06:30', label: 'אימון' });
    expect(r.summary).toContain('06:30');
    expect(r.data.alarms[0]).toMatchObject({ date: '2026-11-11', time: '06:30', label: 'אימון', setAt: null });
    const listed = run(r.data, 'get_alarms', {}).result as { alarms: { alarm_id: string }[] };
    expect(listed.alarms).toHaveLength(1);
    r = run(r.data, 'delete_alarm', { alarm_id: listed.alarms[0].alarm_id });
    expect(r.data.alarms).toEqual([]);
  });

  it('works without a name and refuses a time that passed', () => {
    expect(run(L.emptyData(), 'set_alarm', { date: '2026-11-12', time: '07:00' }).data.alarms[0].label).toBeNull();
    expect(() => run(L.emptyData(), 'set_alarm', { date: TODAY, time: '08:00' })).toThrow();
    expect(() => run(L.emptyData(), 'set_alarm', { date: TODAY, time: '7am' })).toThrow();
  });
});

describe('assistant memory', () => {
  it('remembers, updates a note in place and forgets', () => {
    let r = run(L.emptyData(), 'remember', { text: 'מתאמן בבקרים' });
    expect(r.summary).toContain('נשמר בזיכרון');
    const id = r.data.notes[0].id;
    r = run(r.data, 'remember', { text: 'מתאמן בערבים', replaces: id });
    expect(r.data.notes).toHaveLength(1);
    expect(r.data.notes[0]).toMatchObject({ id, text: 'מתאמן בערבים' });
    r = run(r.data, 'forget', { note_id: id });
    expect(r.data.notes).toEqual([]);
  });

  it('refuses empty text, unknown ids and a full memory', () => {
    expect(() => run(L.emptyData(), 'remember', { text: '  ' })).toThrow();
    expect(() => run(L.emptyData(), 'forget', { note_id: 'nope' })).toThrow();
    const full = { ...L.emptyData(), notes: Array.from({ length: L.NOTES_MAX }, (_, i) => ({ id: `n${i}`, text: 'x', createdAt: i })) };
    expect(() => run(full, 'remember', { text: 'עוד אחד' })).toThrow();
  });
});

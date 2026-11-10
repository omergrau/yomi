import { describe, expect, it } from 'vitest';
import { addDays, fireTime, weekDays } from './dates';
import * as L from './logic';
import type { AppData, Change } from './types';

const NOW = new Date(2026, 10, 6, 9).getTime();
const TODAY = '2026-11-06'; // A Friday.
const TOM = '2026-11-07';

const base = (): AppData => L.emptyData();
const apply = (d: AppData, c: Change) => L.applyChange(d, c);
function add(d: AppData, title: string, over: Partial<L.TaskInput> = {}) {
  const c = L.createTask(d, { title, groupId: null, points: 3, date: TODAY, time: null, reminderMin: null, ...over }, NOW);
  const next = apply(d, c);
  return { d: next, id: c.tasks!.find((t) => t.title === title)!.id, change: c };
}

describe('dates', () => {
  it('crosses months and DST safely', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-03-27', 3)).toBe('2026-03-30');
    expect(weekDays(TODAY)[0]).toBe('2026-11-01');
    expect(weekDays(TODAY)[6]).toBe(TOM);
  });
  it('computes the reminder moment, including crossing midnight', () => {
    expect(fireTime(TODAY, '00:10', 30)).toBe(new Date(2026, 10, 5, 23, 40).getTime());
  });
});

describe('points and the daily bar', () => {
  it('counts points only for finished tasks', () => {
    let { d, id } = add(base(), 'a', { points: 5 });
    ({ d } = add(d, 'b', { points: 2 }));
    expect(L.dayStats(d, TODAY)).toMatchObject({ total: 7, done: 0, closed: false });
    d = apply(d, L.setDone(d, id, true, TODAY, NOW));
    expect(L.dayStats(d, TODAY)).toMatchObject({ total: 7, done: 5, left: 2, streakKept: true });
    expect(L.totalPoints(d)).toBe(5);
    d = apply(d, L.setDone(d, id, false, TODAY, NOW));
    expect(L.totalPoints(d)).toBe(0);
  });
  it('closes the day at 100% and keeps the streak at 70%', () => {
    let { d, id } = add(base(), 'a', { points: 3 });
    const second = add(d, 'b', { points: 1 });
    d = second.d;
    d = apply(d, L.setDone(d, id, true, TODAY, NOW));
    expect(L.dayStats(d, TODAY).streakKept).toBe(true);
    expect(L.dayStats(d, TODAY).closed).toBe(false);
    d = apply(d, L.setDone(d, second.id, true, TODAY, NOW));
    expect(L.dayStats(d, TODAY).closed).toBe(true);
  });
  it('raises a level every 250 points', () => {
    expect(L.levelInfo(0).level).toBe(1);
    expect(L.levelInfo(249)).toMatchObject({ level: 1, toNext: 1 });
    expect(L.levelInfo(250)).toMatchObject({ level: 2, into: 0 });
  });
});

describe('rollover', () => {
  const yesterday = addDays(TODAY, -1);
  it('moves unfinished tasks, records the deferral and drops the old time', () => {
    let { d, id } = add(base(), 'open', { date: yesterday, time: '10:00', reminderMin: 0 });
    const c = L.rollover(d, TODAY, NOW);
    d = apply(d, c);
    expect(d.tasks[id]).toMatchObject({ date: TODAY, time: null, reminderMin: null, deferrals: 1 });
    expect(c.events!.map((e) => [e.type, e.fromDate, e.toDate])).toEqual([['rolled', yesterday, TODAY]]);
  });
  it('leaves finished tasks and fixed items on their day', () => {
    let { d, id } = add(base(), 'done', { date: yesterday });
    d = apply(d, L.setDone(d, id, true, yesterday, NOW));
    d = apply(d, L.createRecurring(d, { title: 'gym', groupId: null, points: 3, weekdays: [4], time: '07:00', reminderMin: 0 }, yesterday, NOW));
    const fixed = L.dayTasks(d, yesterday).find((t) => t.recurringId)!;
    d = apply(d, L.rollover(d, TODAY, NOW));
    expect(d.tasks[id].date).toBe(yesterday);
    expect(d.tasks[fixed.id].date).toBe(yesterday);
  });
  it('snapshots the ended day so moved tasks still count against it', () => {
    let { d, id } = add(base(), 'a', { date: yesterday, points: 4 });
    ({ d } = add(d, 'b', { date: yesterday, points: 1 }));
    d = apply(d, L.setDone(d, id, true, yesterday, NOW));
    d = apply(d, L.rollover(d, TODAY, NOW));
    expect(d.dayLogs[yesterday]).toEqual({ date: yesterday, planned: 5, done: 4 });
    expect(L.dayStats(d, yesterday).total).toBe(5);
  });
  it('counts a long absence once and lands on the opening day', () => {
    let { d, id } = add(base(), 'a', { date: addDays(TODAY, -5) });
    d = apply(d, L.rollover(d, TODAY, NOW));
    expect(d.tasks[id]).toMatchObject({ date: TODAY, deferrals: 1 });
  });
  it('does nothing extra when run twice on the same day', () => {
    let { d, id } = add(base(), 'a', { date: yesterday });
    d = apply(d, L.rollover(d, TODAY, NOW));
    const again = L.rollover(d, TODAY, NOW);
    expect(again.events).toEqual([]);
    d = apply(d, again);
    expect(d.tasks[id].deferrals).toBe(1);
  });
  it('puts rolled tasks before what was already planned', () => {
    let { d, id } = add(base(), 'old', { date: yesterday });
    const fresh = add(d, 'new', { date: TODAY });
    d = apply(fresh.d, L.rollover(fresh.d, TODAY, NOW));
    expect(L.dayTasks(d, TODAY).map((t) => t.id)).toEqual([id, fresh.id]);
  });
});

describe('streak', () => {
  const log = (date: string, planned: number, done: number) => ({ date, planned, done });
  it('stops at the first day under the goal and ignores empty days', () => {
    const d = base();
    d.dayLogs = Object.fromEntries([
      log(addDays(TODAY, -1), 10, 7),
      log(addDays(TODAY, -2), 0, 0),
      log(addDays(TODAY, -3), 10, 10),
      log(addDays(TODAY, -4), 10, 2),
      log(addDays(TODAY, -5), 10, 10),
    ].map((l) => [l.date, l]));
    expect(L.streak(d, TODAY)).toBe(2);
  });
  it('adds today only once it reaches the goal', () => {
    let { d, id } = add(base(), 'a');
    expect(L.streak(d, TODAY)).toBe(0);
    d = apply(d, L.setDone(d, id, true, TODAY, NOW));
    expect(L.streak(d, TODAY)).toBe(1);
  });
  it('corrects a past day when a task is finished late', () => {
    const y = addDays(TODAY, -1);
    let { d, id } = add(base(), 'a', { date: y });
    d = apply(d, L.createRecurring(d, { title: 'fixed', groupId: null, points: 2, weekdays: [4], time: null, reminderMin: null }, y, NOW));
    const fixed = L.dayTasks(d, y).find((t) => t.recurringId)!;
    d = apply(d, L.setDone(d, id, true, y, NOW));
    d = apply(d, L.rollover(d, TODAY, NOW));
    expect(d.dayLogs[y].done).toBe(3);
    d = apply(d, L.setDone(d, fixed.id, true, TODAY, NOW));
    expect(d.dayLogs[y].done).toBe(5);
  });
});

describe('moving tasks', () => {
  it('counts a deferral only when moved later', () => {
    let { d, id } = add(base(), 'a', { date: TOM });
    let c = L.moveTask(d, id, TODAY, NOW);
    d = apply(d, c);
    expect(d.tasks[id].deferrals).toBe(0);
    expect(c.events![0].type).toBe('moved');
    c = L.moveTask(d, id, TOM, NOW);
    d = apply(d, c);
    expect(d.tasks[id].deferrals).toBe(1);
    expect(c.events![0].type).toBe('deferred');
  });
  it('keeps the time on a manual move and clears it on removal', () => {
    let { d, id } = add(base(), 'a', { time: '10:00', reminderMin: 10 });
    d = apply(d, L.moveTask(d, id, TOM, NOW));
    expect(d.tasks[id]).toMatchObject({ date: TOM, time: '10:00', reminderMin: 10 });
    d = apply(d, L.removeFromDay(d, id, NOW));
    expect(d.tasks[id]).toMatchObject({ date: null, time: null, reminderMin: null });
    expect(L.poolTasks(d).map((t) => t.id)).toEqual([id]);
  });
  it('removes only the occurrence of a fixed item', () => {
    let d = apply(base(), L.createRecurring(base(), { title: 'gym', groupId: null, points: 3, weekdays: [5], time: '07:00', reminderMin: null }, TODAY, NOW));
    const occ = L.dayTasks(d, TODAY)[0];
    d = apply(d, L.removeFromDay(d, occ.id, NOW));
    expect(L.dayTasks(d, TODAY)).toEqual([]);
    expect(L.poolTasks(d)).toEqual([]);
    expect(L.materialize(d, TODAY, NOW).tasks?.some((t) => t.date === TODAY)).toBeFalsy();
  });
  it('reorders within a day', () => {
    let a = add(base(), 'a');
    const b = add(a.d, 'b');
    const c = add(b.d, 'c');
    const d = apply(c.d, L.moveTask(c.d, c.id, TODAY, NOW, { index: 0 }));
    expect(L.dayTasks(d, TODAY).map((t) => t.title)).toEqual(['c', 'a', 'b']);
  });
  it('places a timed task by its time', () => {
    let { d } = add(base(), 'late', { time: '15:00' });
    ({ d } = add(d, 'early', { time: '08:00' }));
    expect(L.dayTasks(d, TODAY).map((t) => t.title)).toEqual(['early', 'late']);
  });
  it('keeps points on a deleted group task', () => {
    const g = L.createGroup(base(), 'Sport', NOW);
    let d = apply(base(), g.change);
    const a = add(d, 'a', { groupId: g.group!.id });
    d = apply(a.d, L.setDone(a.d, a.id, true, TODAY, NOW));
    expect(L.groupWeekPoints(d, g.group!.id, TODAY)).toBe(3);
    d = apply(d, L.deleteGroup(d, g.group!.id));
    expect(d.groups).toEqual([]);
    expect(d.tasks[a.id].groupId).toBeNull();
    expect(L.totalPoints(d)).toBe(3);
  });
});

describe('fixed items', () => {
  it('creates occurrences on the chosen weekdays and never twice', () => {
    let d = base();
    d = apply(d, L.createRecurring(d, { title: 'x', groupId: null, points: 2, weekdays: [0, 5], time: '09:00', reminderMin: 0 }, TODAY, NOW));
    const dates = L.alive(d).map((t) => t.date).sort();
    expect(dates[0]).toBe(TODAY);
    expect(dates).toContain('2026-11-08');
    expect(dates).not.toContain(TOM);
    expect(L.materialize(d, TODAY, NOW)).toEqual({});
  });
  it('ending a series removes future occurrences but keeps finished ones', () => {
    let d = base();
    d = apply(d, L.createRecurring(d, { title: 'x', groupId: null, points: 2, weekdays: [5], time: null, reminderMin: null }, TODAY, NOW));
    const first = L.dayTasks(d, TODAY)[0];
    d = apply(d, L.setDone(d, first.id, true, TODAY, NOW));
    d = apply(d, L.endRecurring(d, first.recurringId!, TODAY, NOW));
    expect(L.alive(d).map((t) => t.id)).toEqual([first.id]);
    expect(L.materialize(d, addDays(TODAY, 30), NOW)).toEqual({});
  });
  it('editing updates the series and later occurrences', () => {
    let d = base();
    d = apply(d, L.createRecurring(d, { title: 'old', groupId: null, points: 2, weekdays: [5], time: null, reminderMin: null }, TODAY, NOW));
    const first = L.dayTasks(d, TODAY)[0];
    d = apply(d, L.editTask(d, first.id, { title: 'new', groupId: null, points: 4, date: TODAY, time: '08:00', reminderMin: 0 }, NOW));
    expect(L.alive(d).every((t) => t.title === 'new' && t.points === 4)).toBe(true);
    expect(d.recurring[0].time).toBe('08:00');
  });
});

describe('changing the days of a fixed item', () => {
  it('drops open occurrences on removed days and fills new ones', () => {
    let d = apply(base(), L.createRecurring(base(), { title: 'x', groupId: null, points: 2, weekdays: [0], time: null, reminderMin: null }, TODAY, NOW));
    const id = d.recurring[0].id;
    d = apply(d, L.setWeekdays(d, id, [1], TODAY, NOW));
    const dates = L.alive(d).map((t) => t.date).sort();
    expect(dates).toContain('2026-11-09');
    expect(dates).not.toContain('2026-11-08');
    expect(L.setWeekdays(d, id, [1], TODAY, NOW)).toEqual({});
  });
});

describe('timetable', () => {
  it('edits a slot and its coming occurrences, and keeps the details', () => {
    let d = apply(base(), L.createRecurring(base(), { title: 'Lecture', groupId: null, points: 2, weekdays: [5], time: '10:00', endTime: '12:00', place: 'Hall 3', reminderMin: 10 }, TODAY, NOW));
    const id = d.recurring[0].id;
    expect(d.recurring[0]).toMatchObject({ endTime: '12:00', place: 'Hall 3' });
    d = apply(d, L.editRecurring(d, id, { title: 'Seminar', groupId: null, points: 3, weekdays: [0, 5], time: '09:00', endTime: '11:00', place: 'Room 1', reminderMin: 30 }, TODAY, NOW));
    expect(d.recurring[0]).toMatchObject({ title: 'Seminar', time: '09:00', endTime: '11:00', place: 'Room 1', weekdays: [0, 5] });
    const open = L.alive(d).filter((t) => t.recurringId === id);
    expect(open.every((t) => t.title === 'Seminar' && t.time === '09:00' && t.reminderMin === 30)).toBe(true);
    expect(open.map((t) => t.date)).toContain('2026-11-08');
    expect(L.reminderJobs(d, NOW)[0]).toMatchObject({ title: 'Seminar', time: '09:00' });
  });
});

describe('reminders', () => {
  it('lists only future reminders of open dated tasks, soonest first', () => {
    let { d } = add(base(), 'past', { time: '08:00', reminderMin: 0 });
    const later = add(d, 'later', { date: TOM, time: '10:00', reminderMin: 30 });
    const soon = add(later.d, 'soon', { time: '12:00', reminderMin: 0 });
    d = soon.d;
    ({ d } = add(d, 'none', { time: '13:00', reminderMin: null }));
    const jobs = L.reminderJobs(d, NOW);
    expect(jobs.map((j) => j.title)).toEqual(['soon', 'later']);
    d = apply(d, L.setDone(d, soon.id, true, TODAY, NOW));
    expect(L.reminderJobs(d, NOW).map((j) => j.title)).toEqual(['later']);
  });
});

describe('urgency', () => {
  it('puts more urgent tasks above less urgent ones, in the day and in the pool', () => {
    let { d } = add(base(), 'low', { points: 1 });
    ({ d } = add(d, 'high', { points: 5 }));
    ({ d } = add(d, 'mid', { points: 3 }));
    ({ d } = add(d, 'mid2', { points: 3 }));
    expect(L.dayTasks(d, TODAY).map((t) => t.title)).toEqual(['high', 'mid', 'mid2', 'low']);
    ({ d } = add(d, 'p1', { points: 2, date: null }));
    ({ d } = add(d, 'p2', { points: 4, date: null }));
    expect(L.poolTasks(d).map((t) => t.title)).toEqual(['p2', 'p1']);
  });
  it('keeps a manual order within the same urgency', () => {
    let a = add(base(), 'a', { points: 3 });
    const b = add(a.d, 'b', { points: 3 });
    const d = apply(b.d, L.moveTask(b.d, b.id, TODAY, NOW, { index: 0 }));
    expect(L.dayTasks(d, TODAY).map((t) => t.title)).toEqual(['b', 'a']);
  });
});

describe('activities whose time has passed', () => {
  const at = (h: string) => fireTime(TODAY, h, 0);
  it('complete themselves and earn their points', () => {
    let { d, id } = add(base(), 'gym', { time: '08:00', points: 4 });
    ({ d } = add(d, 'later', { time: '18:00' }));
    ({ d } = add(d, 'untimed' ));
    const r = L.autoComplete(d, at('09:00'));
    d = apply(d, r.change);
    expect(r.titles).toEqual(['gym']);
    expect(d.tasks[id].doneAt).not.toBeNull();
    expect(L.totalPoints(d)).toBe(4);
  });
  it('uses the end time of a timetable slot', () => {
    let d = apply(base(), L.createRecurring(base(), { title: 'lecture', groupId: null, points: 2, weekdays: [5], time: '10:00', endTime: '12:00', reminderMin: null }, TODAY, NOW));
    expect(L.autoComplete(d, at('11:00')).titles).toEqual([]);
    expect(L.autoComplete(d, at('12:01')).titles).toEqual(['lecture']);
  });
  it('stay open once the person reopens them', () => {
    let { d, id } = add(base(), 'gym', { time: '08:00' });
    d = apply(d, L.autoComplete(d, at('09:00')).change);
    d = apply(d, L.setDone(d, id, false, TODAY, at('09:05')));
    expect(d.tasks[id].noAuto).toBe(true);
    expect(L.autoComplete(d, at('10:00')).titles).toEqual([]);
  });
});

describe('one-off tasks with a length', () => {
  const at = (h: string) => fireTime(TODAY, h, 0);
  it('end at their own end time, and keep the length when the start moves', () => {
    let { d, id } = add(base(), 'meeting', { time: '10:00', durationMin: 120 });
    expect(L.autoComplete(d, at('11:30')).titles).toEqual([]);
    expect(L.autoComplete(d, at('12:00')).titles).toEqual(['meeting']);
    d = apply(d, L.editTask(d, id, { title: 'meeting', groupId: null, points: 3, date: TODAY, time: '14:00', reminderMin: 0, durationMin: 120 }, NOW));
    expect(d.tasks[id]).toMatchObject({ time: '14:00', durationMin: 120 });
  });
  it('lose the length together with the time', () => {
    let { d, id } = add(base(), 'meeting', { time: '10:00', durationMin: 60 });
    d = apply(d, L.removeFromDay(d, id, NOW));
    expect(d.tasks[id]).toMatchObject({ time: null });
    expect(d.tasks[id].durationMin).toBeFalsy();
  });
});

describe('lists', () => {
  it('adds, ticks, removes and clears items', () => {
    let d = base();
    const list = L.createList(d, ' Groceries ', NOW);
    d = apply(d, { lists: [list] });
    expect(d.lists[0].title).toBe('Groceries');
    d = apply(d, L.editList(d, list.id, (l) => L.addItem(l, 'Milk', NOW)));
    d = apply(d, L.editList(d, list.id, (l) => L.addItem(l, 'Eggs', NOW)));
    d = apply(d, L.editList(d, list.id, (l) => L.addItem(l, '   ', NOW)));
    expect(d.lists[0].items.map((x) => x.text)).toEqual(['Milk', 'Eggs']);
    const milk = d.lists[0].items[0].id;
    d = apply(d, L.editList(d, list.id, (l) => L.toggleItem(l, milk)));
    expect(d.lists[0].items[0].done).toBe(true);
    d = apply(d, L.editList(d, list.id, L.clearDone));
    expect(d.lists[0].items.map((x) => x.text)).toEqual(['Eggs']);
    d = apply(d, { removeLists: [list.id] });
    expect(d.lists).toEqual([]);
  });
  it('earns no points and leaves the day untouched', () => {
    let { d } = add(base(), 'a');
    const list = L.createList(d, 'x', NOW);
    d = apply(d, { lists: [{ ...list, items: [{ id: 'i', text: 'y', done: true }] }] });
    expect(L.totalPoints(d)).toBe(0);
    expect(L.dayStats(d, TODAY).count).toBe(1);
  });
  it('restores an older backup that has no lists', () => {
    const { d, change } = add(base(), 'a');
    const backup = L.makeBackup(d, change.events!, NOW) as any;
    delete backup.data.lists;
    expect(L.readBackup(JSON.stringify(backup)).data.lists).toEqual([]);
  });
});

describe('backup', () => {
  it('round-trips the data and the history', () => {
    const { d, change } = add(base(), 'a');
    const raw = JSON.stringify(L.makeBackup(d, change.events!, NOW));
    const back = L.readBackup(raw);
    expect(back.data.tasks).toEqual(d.tasks);
    expect(back.events).toEqual(change.events);
  });
  it('rejects a file that is not a backup', () => {
    expect(() => L.readBackup('{"a":1}')).toThrow();
    expect(() => L.readBackup('not json')).toThrow();
    expect(() => L.readBackup(JSON.stringify({ app: 'yomi', version: 1, events: [], data: { groups: [], recurring: [], dayLogs: [], tasks: [{ id: 'x', title: 'y', points: 9 }] } }))).toThrow();
  });
});

describe('urgent tasks in the evening', () => {
  const at = (h: number) => new Date(2026, 10, 6, h).getTime();
  it('turns red only from 18:00, only for urgency 4 or 5, and not when done', () => {
    let d = base();
    d = apply(d, L.createTask(d, { title: 'דחוף', groupId: null, points: 5, date: TODAY, time: null, reminderMin: null }, NOW));
    d = apply(d, L.createTask(d, { title: 'רגיל', groupId: null, points: 3, date: TODAY, time: null, reminderMin: null }, NOW));
    const [urgent, normal] = ['דחוף', 'רגיל'].map((n) => L.alive(d).find((t) => t.title === n)!);
    expect(L.isLateUrgent(urgent, at(17))).toBe(false);
    expect(L.isLateUrgent(urgent, at(18))).toBe(true);
    expect(L.isLateUrgent(normal, at(20))).toBe(false);
    expect(L.isLateUrgent({ ...urgent, doneAt: at(17) }, at(20))).toBe(false);
  });

  it('reminds every whole hour from 18:00 to 23:00 while open, and stops when done', () => {
    let d = base();
    d = apply(d, L.createTask(d, { title: 'להגיש עבודה', groupId: null, points: 4, date: TODAY, time: null, reminderMin: null }, NOW));
    d = apply(d, L.createTask(d, { title: 'לקנות לחם', groupId: null, points: 2, date: TODAY, time: null, reminderMin: null }, NOW));
    const jobs = L.urgentJobs(d, at(19) + 60000);
    expect(jobs.map((j) => new Date(j.fireAt).getHours())).toEqual([20, 21, 22, 23]);
    expect(jobs[0].urgent).toEqual(['להגיש עבודה']);
    const task = L.alive(d).find((t) => t.title === 'להגיש עבודה')!;
    const done = apply(d, L.setDone(d, task.id, true, TODAY, at(19)));
    expect(L.urgentJobs(done, at(19) + 60000)).toEqual([]);
  });

  it('covers tomorrow too, so it reminds even if the app is not opened', () => {
    let d = base();
    d = apply(d, L.createTask(d, { title: 'מחר דחוף', groupId: null, points: 5, date: TOM, time: null, reminderMin: null }, NOW));
    const jobs = L.urgentJobs(d, NOW);
    expect(jobs).toHaveLength(6);
    expect(jobs.every((j) => j.id.startsWith(`urgent-${TOM}-`))).toBe(true);
  });
});

describe('alarm clocks', () => {
  const now = fireTime('2026-11-10', '09:00', 0);
  const make = (date: string, time: string, setAt: number | null = null) => ({ ...L.createAlarm({ date, time, label: null }, now), id: `${date}-${time}`, setAt });

  it('hands an alarm to the clock only within a day of ringing', () => {
    const d = { ...L.emptyData(), alarms: [make('2026-11-11', '07:00'), make('2026-11-13', '07:00'), make('2026-11-11', '06:00', now)] };
    expect(L.alarmsToSet(d, now).map((a) => a.id)).toEqual(['2026-11-11-07:00']);
  });

  it('asks the evening before to open the app for an alarm further ahead', () => {
    const d = { ...L.emptyData(), alarms: [make('2026-11-13', '07:00'), make('2026-11-14', '21:30'), make('2026-11-11', '07:00', now)] };
    const jobs = L.alarmJobs(d, now);
    expect(jobs.map((j) => j.fireAt)).toEqual([fireTime('2026-11-12', '20:00', 0), fireTime('2026-11-14', '09:00', 0)]);
    expect(jobs.every((j) => j.alarm)).toBe(true);
  });

  it('forgets alarms that rang over a day ago and keeps older backups readable', () => {
    const d = { ...L.emptyData(), alarms: [make('2026-11-08', '07:00'), make('2026-11-10', '07:00')] };
    expect(L.oldAlarms(d, now)).toEqual(['2026-11-08-07:00']);
    const b = L.makeBackup(L.emptyData(), [], now);
    const { alarms: _, ...older } = b.data;
    expect(L.readBackup(JSON.stringify({ ...b, data: older })).data.alarms).toEqual([]);
    const withAlarm = L.makeBackup({ ...L.emptyData(), alarms: [make('2026-11-11', '07:00', now)] }, [], now);
    expect(L.readBackup(JSON.stringify(withAlarm)).data.alarms[0].setAt).toBeNull();
  });
});

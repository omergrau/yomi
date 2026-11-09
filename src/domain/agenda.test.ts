import { describe, expect, it } from 'vitest';
import { buildAgenda, nextUp } from './agenda';
import { fireTime } from './dates';
import type { Recurring, Task } from './types';

const DAY = '2026-11-09';
const at = (h: string) => fireTime(DAY, h, 0);
const task = (over: Partial<Task>): Task => ({
  id: 'x', title: 'x', groupId: null, points: 3, date: DAY, sort: 1, time: null, reminderMin: null, deferrals: 0, doneAt: null,
  recurringId: null, occurrenceDate: null, createdAt: 0, deletedAt: null, ...over,
});

describe('daily schedule', () => {
  const lecture: Recurring = { id: 'r', title: 'Lecture', groupId: null, points: 2, weekdays: [1], time: '10:00', endTime: '12:00', place: 'Hall', reminderMin: 10, startDate: DAY, endedAt: null };
  const items = buildAgenda(
    DAY,
    [
      task({ id: 'a', title: 'Call', time: '09:00' }),
      task({ id: 'b', title: 'Untimed' }),
      task({ id: 'c', title: 'Lecture', time: '10:00', recurringId: 'r' }),
      task({ id: 'd', title: 'Other day', time: '08:00', date: '2026-11-10' }),
    ],
    new Map([['r', lecture]]),
    [
      { id: 'e1', title: 'Dentist', start: at('13:30'), end: at('14:00'), allDay: false, location: 'Clinic', color: '#f00' },
      { id: 'e2', title: 'Birthday', start: at('00:00'), end: at('23:59'), allDay: true, location: null, color: '#0f0' },
    ],
    new Map(),
  );

  it('merges calendar events, timetable slots and timed tasks in time order', () => {
    expect(items.map((i) => i.title)).toEqual(['Birthday', 'Call', 'Lecture', 'Dentist']);
    expect(items.map((i) => i.source)).toEqual(['calendar', 'task', 'timetable', 'calendar']);
  });
  it('gives timetable slots their end time and place', () => {
    expect(items[2]).toMatchObject({ end: at('12:00'), place: 'Hall' });
  });
  it('finds what is on now, or what comes next', () => {
    expect(nextUp(items, at('10:30'))).toMatchObject({ item: { title: 'Lecture' }, current: true });
    expect(nextUp(items, at('12:10'))).toMatchObject({ item: { title: 'Dentist' }, current: false });
    expect(nextUp(items, at('20:00'))).toBeNull();
  });
});

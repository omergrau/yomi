import { describe, expect, it } from 'vitest';
import { fireTime } from './dates';
import { orderOpen } from './order';
import type { Recurring, Task } from './types';

const DAY = '2026-11-09';
const task = (id: string, over: Partial<Task> = {}): Task => ({
  id, title: id, groupId: null, points: 3, date: DAY, sort: 1, time: null, reminderMin: null, deferrals: 0, doneAt: null,
  recurringId: null, occurrenceDate: null, createdAt: 0, deletedAt: null, ...over,
});
const lecture: Recurring = { id: 'r', title: 'L', groupId: null, points: 2, weekdays: [1], time: '10:00', endTime: '12:00', place: null, reminderMin: null, startDate: DAY, endedAt: null };
const series = new Map([['r', lecture]]);
// Already in urgency order, as the day hands them over.
const open = [
  task('urgent', { points: 5 }),
  task('gym', { time: '08:00' }),
  task('lecture', { time: '10:00', recurringId: 'r' }),
  task('call', { time: '18:00' }),
  task('dentist', { time: '13:30' }),
  task('low', { points: 1 }),
];

describe('order around the clock', () => {
  it('puts what is on now and what comes next first, by time', () => {
    const { ordered } = orderOpen(open, DAY, DAY, fireTime(DAY, '11:20', 0), series);
    expect(ordered.map((t) => t.id)).toEqual(['lecture', 'dentist', 'call', 'urgent', 'gym', 'low']);
  });
  it('turns passed timed tasks into ordinary to-dos, not done ones', () => {
    const { ordered, overdue } = orderOpen(open, DAY, DAY, fireTime(DAY, '12:30', 0), series);
    expect([...overdue].sort()).toEqual(['gym', 'lecture']);
    expect(ordered.slice(0, 2).map((t) => t.id)).toEqual(['dentist', 'call']);
    expect(ordered.every((t) => !t.doneAt)).toBe(true);
  });
  it('treats every timed task on a future day as coming, and on a past day as passed', () => {
    expect(orderOpen(open, DAY, '2026-11-08', 0, series).overdue.size).toBe(0);
    expect(orderOpen(open, DAY, '2026-11-10', 0, series).overdue.size).toBe(4);
  });
});

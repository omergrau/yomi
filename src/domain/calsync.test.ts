import { describe, expect, it } from 'vitest';
import { calendarSpecs, keyOf, planSync, type CalSpec } from './calsync';
import { fireTime } from './dates';
import * as L from './logic';
import type { AppData } from './types';

const NOW = new Date(2026, 10, 11, 9).getTime();
const TODAY = '2026-11-11';
function add(d: AppData, over: Partial<L.TaskInput>) {
  return L.applyChange(d, L.createTask(d, { title: 'x', groupId: null, points: 3, date: TODAY, time: null, reminderMin: null, ...over }, NOW + Math.random() * 1000));
}

describe('the "עוזר אישי" calendar', () => {
  it('gets one event per task with a day', () => {
    let d = L.emptyData();
    d = add(d, { title: 'רופא', time: '12:30', durationMin: 45 });
    d = add(d, { title: 'לכבס' });
    d = add(d, { title: 'בלי יום', date: null });
    const specs = calendarSpecs(d, TODAY);
    expect(specs).toHaveLength(2);
    const doc = specs.find((s) => s.title === 'רופא')!;
    expect(doc).toMatchObject({ allDay: false, start: fireTime(TODAY, '12:30', 0), end: fireTime(TODAY, '13:15', 0) });
    const wash = specs.find((s) => s.title === 'לכבס')!;
    expect(wash.allDay).toBe(true);
    expect(wash.end - wash.start).toBe(86400000);
    expect(keyOf(wash.notes)).toBe(Object.values(d.tasks).find((t) => t.title === 'לכבס')!.id);
  });

  it('marks a finished task and drops a removed one', () => {
    let d = add(L.emptyData(), { title: 'רופא', time: '12:30' });
    const id = Object.keys(d.tasks)[0];
    d = L.applyChange(d, L.setDone(d, id, true, TODAY, NOW));
    expect(calendarSpecs(d, TODAY)[0].title).toBe('✓ רופא');
    d = L.applyChange(d, { tasks: [{ ...d.tasks[id], deletedAt: NOW }] });
    expect(calendarSpecs(d, TODAY)).toHaveLength(0);
  });

  it('writes only what changed', () => {
    const spec = (key: string, title: string): CalSpec => ({ key, title, start: 1, end: 2, allDay: false, location: null, notes: `yomi:${key}` });
    const ev = (id: string, key: string | null, title: string) => ({ id, notes: key ? `yomi:${key}` : 'my own', title, start: 1, end: 2, allDay: false, location: null });
    const plan = planSync(
      [ev('e1', 'a', 'same'), ev('e2', 'b', 'old'), ev('e3', 'gone', 'x'), ev('e4', 'a', 'same'), ev('e5', null, 'not ours')],
      [spec('a', 'same'), spec('b', 'new'), spec('c', 'fresh')],
    );
    expect(plan.update).toEqual([{ id: 'e2', spec: spec('b', 'new') }]);
    expect(plan.create.map((c) => c.key)).toEqual(['c']);
    expect(plan.remove).toEqual(['e3', 'e4', 'e5']);
  });
});

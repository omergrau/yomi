// Runs the real SQL of the phone's database against an SQLite engine, because the web preview does not use it.
import { describe, expect, it, vi } from 'vitest';
import * as L from '../domain/logic';


const { DatabaseSync } = (process as any).getBuiltinModule("node:sqlite");

vi.mock('expo-sqlite', () => ({
  openDatabaseSync: () => {
    const db = new DatabaseSync(':memory:');
    return {
      execSync: (sql: string) => db.exec(sql),
      runSync: (sql: string, params: unknown[] = []) => db.prepare(sql).run(...params),
      getAllSync: (sql: string, params: unknown[] = []) => db.prepare(sql).all(...params).map((r: object) => ({ ...r })),
      getFirstSync: (sql: string) => {
        const r = db.prepare(sql).get();
        return r ? { ...r } : null;
      },
      withTransactionSync: (fn: () => void) => {
        db.exec('BEGIN');
        try {
          fn();
          db.exec('COMMIT');
        } catch (e) {
          db.exec('ROLLBACK');
          throw e;
        }
      },
    };
  },
}));

const NOW = new Date(2026, 10, 6, 9).getTime();
const TODAY = '2026-11-06';

describe('phone database', () => {
  it('stores and reloads everything exactly', async () => {
    const { openRepo } = await import('./repo.native');
    const repo = openRepo();
    let d = repo.load();
    expect(d).toEqual(L.emptyData());

    const steps = [
      L.createGroup(d, 'Sport', NOW).change,
    ];
    repo.apply(steps[0]);
    d = L.applyChange(d, steps[0]);
    const groupId = d.groups[0].id;

    const add = L.createTask(d, { title: 'שלום', groupId, points: 4, date: TODAY, time: '10:00', reminderMin: 30 }, NOW);
    repo.apply(add);
    d = L.applyChange(d, add);
    const id = add.tasks![0].id;

    const fixed = L.createRecurring(d, { title: 'gym', groupId, points: 2, weekdays: [0, 5], time: '07:00', reminderMin: 0 }, TODAY, NOW);
    repo.apply(fixed);
    d = L.applyChange(d, fixed);

    const done = L.setDone(d, id, true, TODAY, NOW + 1);
    repo.apply(done);
    d = L.applyChange(d, done);

    const roll = L.rollover(d, '2026-11-07', NOW + 2);
    repo.apply(roll);
    d = L.applyChange(d, roll);

    expect(repo.load()).toEqual(d);
    expect(repo.eventsFor(id).map((e) => e.type)).toEqual(expect.arrayContaining(['created', 'completed']));
  });

  it('replaces everything on restore, and survives a removed group', async () => {
    const { openRepo } = await import('./repo.native');
    const repo = openRepo();
    const made = L.createGroup(repo.load(), 'A', NOW);
    repo.apply(made.change);
    repo.apply(L.deleteGroup(repo.load(), made.group!.id));
    expect(repo.load().groups).toEqual([]);

    const a = L.createTask(repo.load(), { title: 'x', groupId: null, points: 1, date: null, time: null, reminderMin: null }, NOW);
    repo.apply(a);
    const raw = JSON.stringify(L.makeBackup(repo.load(), repo.allEvents(), NOW));
    repo.apply(L.createTask(repo.load(), { title: 'y', groupId: null, points: 1, date: null, time: null, reminderMin: null }, NOW));
    expect(Object.keys(repo.load().tasks)).toHaveLength(2);
    const back = L.readBackup(raw);
    repo.replaceAll(back.data, back.events);
    expect(Object.keys(repo.load().tasks)).toHaveLength(1);
    expect(repo.allEvents()).toHaveLength(1);
  });

  it('removes history entries when an action is undone', async () => {
    const { openRepo } = await import('./repo.native');
    const repo = openRepo();
    const a = L.createTask(repo.load(), { title: 'x', groupId: null, points: 1, date: null, time: null, reminderMin: null }, NOW);
    repo.apply(a);
    repo.removeEvents(a.events!.map((e) => e.id));
    expect(repo.allEvents()).toEqual([]);
  });
});

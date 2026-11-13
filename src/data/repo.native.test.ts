// Runs the real SQL of the phone's database against an SQLite engine, because the web preview does not use it.
import { describe, expect, it, vi } from 'vitest';
import * as L from '../domain/logic';


const { DatabaseSync } = (process as any).getBuiltinModule("node:sqlite");

vi.mock('expo-sqlite', () => ({
  openDatabaseSync: () => {
    const db = new DatabaseSync(':memory:');
    // Lets a test start from a database written by an older version of the app.
    (globalThis as any).__seedDb?.(db);
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
  it('keeps everything from the first version after an update', async () => {
    const { MIGRATIONS, openRepo } = await import('./repo.native');
    (globalThis as any).__seedDb = (db: any) => {
      db.exec(MIGRATIONS[0]);
      db.exec('PRAGMA user_version = 1');
      db.prepare('INSERT INTO groups_ (id,name,color,sort) VALUES (?,?,?,?)').run('g1', 'תואר', 1, 1);
      db.prepare(`INSERT INTO tasks (id,title,group_id,points,date,sort,time,reminder_min,deferrals,done_at,recurring_id,occurrence_date,created_at,deleted_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('t1', 'משימה ישנה', 'g1', 4, TODAY, 1, '10:00', 0, 2, NOW, null, null, NOW, null);
      db.prepare(`INSERT INTO recurring (id,title,group_id,points,weekdays,time,reminder_min,start_date,ended_at) VALUES (?,?,?,?,?,?,?,?,?)`)
        .run('r1', 'אימון', null, 3, '[0,2]', '07:00', 10, TODAY, null);
      db.prepare('INSERT INTO day_logs (date,planned,done) VALUES (?,?,?)').run('2026-11-05', 8, 6);
      db.prepare('INSERT INTO events (id,task_id,type,from_date,to_date,at) VALUES (?,?,?,?,?,?)').run('e1', 't1', 'completed', TODAY, TODAY, NOW);
      db.prepare('INSERT INTO meta (key,value) VALUES (?,?)').run('theme', 'dark');
    };
    const repo = openRepo();
    delete (globalThis as any).__seedDb;
    const d = repo.load();
    expect(d.tasks.t1.noAuto).toBeUndefined();
    expect(d.tasks.t1).toMatchObject({ title: 'משימה ישנה', groupId: 'g1', points: 4, time: '10:00', deferrals: 2, doneAt: NOW });
    expect(d.groups[0].name).toBe('תואר');
    expect(d.recurring[0]).toMatchObject({ title: 'אימון', weekdays: [0, 2], time: '07:00', endTime: null, place: null });
    expect(d.dayLogs['2026-11-05']).toEqual({ date: '2026-11-05', planned: 8, done: 6 });
    expect(d.meta.theme).toBe('dark');
    expect(d.meta.hiddenCalendars).toEqual([]);
    expect(d.lists).toEqual([]);
    expect(d.alarms).toEqual([]);
    expect(d.notes).toEqual([]);
    expect(repo.eventsFor('t1')).toHaveLength(1);
    expect(L.totalPoints(d)).toBe(4);
  });

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

    const fixed = L.createRecurring(d, { title: 'gym', groupId, points: 2, weekdays: [0, 5], time: '07:00', endTime: '08:00', place: 'Gym', reminderMin: 0 }, TODAY, NOW);
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

  it('keeps the length of a one-off task', async () => {
    const { openRepo } = await import('./repo.native');
    const repo = openRepo();
    const a = L.createTask(repo.load(), { title: 'meeting', groupId: null, points: 2, date: TODAY, time: '10:00', reminderMin: 0, durationMin: 90 }, NOW);
    repo.apply(a);
    expect(repo.load().tasks[a.tasks![0].id].durationMin).toBe(90);
  });

  it('keeps the hidden calendars setting', async () => {
    const { openRepo } = await import('./repo.native');
    const repo = openRepo();
    repo.apply({ meta: { hiddenCalendars: ['a', 'b'] } });
    expect(repo.load().meta.hiddenCalendars).toEqual(['a', 'b']);
  });

  it('keeps the assistant memory', async () => {
    const { openRepo } = await import('./repo.native');
    const repo = openRepo();
    const note = L.createNote('מעדיף להתאמן בבוקר', NOW);
    repo.apply({ notes: [note] });
    expect(repo.load().notes).toEqual([note]);
    repo.apply({ removeNotes: [note.id] });
    expect(repo.load().notes).toEqual([]);
  });

  it('keeps alarms', async () => {
    const { openRepo } = await import('./repo.native');
    const repo = openRepo();
    const alarm = { ...L.createAlarm({ date: TODAY, time: '07:15', label: 'השכמה' }, NOW), setAt: NOW };
    repo.apply({ alarms: [alarm] });
    expect(repo.load().alarms).toEqual([alarm]);
    repo.apply({ removeAlarms: [alarm.id] });
    expect(repo.load().alarms).toEqual([]);
  });

  it('keeps lists and their items', async () => {
    const { openRepo } = await import('./repo.native');
    const repo = openRepo();
    const list = L.createList(repo.load(), 'קניות', NOW);
    repo.apply({ lists: [{ ...list, items: [{ id: 'a', text: 'חלב', done: true }] }] });
    expect(repo.load().lists[0].items).toEqual([{ id: 'a', text: 'חלב', done: true }]);
    repo.apply({ removeLists: [list.id] });
    expect(repo.load().lists).toEqual([]);
  });

  it('removes history entries when an action is undone', async () => {
    const { openRepo } = await import('./repo.native');
    const repo = openRepo();
    const a = L.createTask(repo.load(), { title: 'x', groupId: null, points: 1, date: null, time: null, reminderMin: null }, NOW);
    repo.apply(a);
    repo.removeEvents(a.events!.map((e) => e.id));
    expect(repo.allEvents()).toEqual([]);
  });
  it('keeps saved talks apart from the plan, and a restore leaves them alone', async () => {
    const { openRepo } = await import('./repo.native');
    const repo = openRepo();
    const chat = { id: 'c1', title: 'מה נשאר?', updatedAt: NOW, lines: [{ from: 'me' as const, text: 'מה נשאר?' }, { from: 'bot' as const, text: '**שתי** משימות' }], summary: null, summaryUpto: 0 };
    repo.putChat(chat);
    repo.putChat({ ...chat, id: 'c2', updatedAt: NOW + 1 });
    expect(repo.chats().map((c) => c.id)).toEqual(['c2', 'c1']);
    expect(repo.chats()[1]).toEqual(chat);
    repo.replaceAll(L.emptyData(), []);
    expect(repo.chats()).toHaveLength(2);
    repo.removeChat('c2');
    expect(repo.chats().map((c) => c.id)).toEqual(['c1']);
    expect(repo.load()).toEqual(L.emptyData());
  });
});

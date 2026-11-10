import { openDatabaseSync, type SQLiteDatabase } from 'expo-sqlite';
import type { Alarm, AppData, Change, Note, Checklist, DayLog, Group, Recurring, Task, TaskEvent } from '../domain/types';
import type { Repo } from './repoTypes';

// Each entry upgrades the database by one version. Never edit an entry after it has shipped; add a new one.
export const MIGRATIONS = [
  `
  CREATE TABLE tasks (
    id TEXT PRIMARY KEY NOT NULL, title TEXT NOT NULL, group_id TEXT, points INTEGER NOT NULL,
    date TEXT, sort INTEGER NOT NULL, time TEXT, reminder_min INTEGER, deferrals INTEGER NOT NULL,
    done_at INTEGER, recurring_id TEXT, occurrence_date TEXT, created_at INTEGER NOT NULL, deleted_at INTEGER
  );
  CREATE INDEX tasks_date ON tasks(date);
  CREATE TABLE groups_ (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, color INTEGER NOT NULL, sort INTEGER NOT NULL);
  CREATE TABLE recurring (
    id TEXT PRIMARY KEY NOT NULL, title TEXT NOT NULL, group_id TEXT, points INTEGER NOT NULL, weekdays TEXT NOT NULL,
    time TEXT, reminder_min INTEGER, start_date TEXT NOT NULL, ended_at INTEGER
  );
  CREATE TABLE day_logs (date TEXT PRIMARY KEY NOT NULL, planned INTEGER NOT NULL, done INTEGER NOT NULL);
  CREATE TABLE events (
    id TEXT PRIMARY KEY NOT NULL, task_id TEXT NOT NULL, type TEXT NOT NULL, from_date TEXT, to_date TEXT, at INTEGER NOT NULL
  );
  CREATE INDEX events_task ON events(task_id);
  CREATE TABLE meta (key TEXT PRIMARY KEY NOT NULL, value TEXT);
  `,
  `
  CREATE TABLE lists (id TEXT PRIMARY KEY NOT NULL, title TEXT NOT NULL, sort INTEGER NOT NULL, created_at INTEGER NOT NULL, items TEXT NOT NULL);
  `,
  `
  ALTER TABLE recurring ADD COLUMN end_time TEXT;
  ALTER TABLE recurring ADD COLUMN place TEXT;
  `,
  `
  ALTER TABLE tasks ADD COLUMN no_auto INTEGER;
  `,
  `
  ALTER TABLE tasks ADD COLUMN duration_min INTEGER;
  `,
  `
  CREATE TABLE alarms (id TEXT PRIMARY KEY NOT NULL, date TEXT NOT NULL, time TEXT NOT NULL, label TEXT, created_at INTEGER NOT NULL, set_at INTEGER);
  `,
  `
  CREATE TABLE notes (id TEXT PRIMARY KEY NOT NULL, text TEXT NOT NULL, created_at INTEGER NOT NULL);
  `,
];

function migrate(db: SQLiteDatabase) {
  const row = db.getFirstSync<{ user_version: number }>('PRAGMA user_version');
  const from = row?.user_version ?? 0;
  for (let v = from; v < MIGRATIONS.length; v++) {
    db.withTransactionSync(() => {
      db.execSync(MIGRATIONS[v]);
      db.execSync(`PRAGMA user_version = ${v + 1}`);
    });
  }
}

const putTask = (db: SQLiteDatabase, t: Task) =>
  db.runSync(
    `INSERT OR REPLACE INTO tasks (id,title,group_id,points,date,sort,time,reminder_min,deferrals,done_at,recurring_id,occurrence_date,created_at,deleted_at,no_auto,duration_min)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [t.id, t.title, t.groupId, t.points, t.date, t.sort, t.time, t.reminderMin, t.deferrals, t.doneAt, t.recurringId, t.occurrenceDate, t.createdAt, t.deletedAt, t.noAuto ? 1 : 0, t.durationMin ?? null],
  );
const putGroup = (db: SQLiteDatabase, g: Group) => db.runSync('INSERT OR REPLACE INTO groups_ (id,name,color,sort) VALUES (?,?,?,?)', [g.id, g.name, g.color, g.sort]);
const putRecurring = (db: SQLiteDatabase, r: Recurring) =>
  db.runSync('INSERT OR REPLACE INTO recurring (id,title,group_id,points,weekdays,time,reminder_min,start_date,ended_at,end_time,place) VALUES (?,?,?,?,?,?,?,?,?,?,?)', [
    r.id, r.title, r.groupId, r.points, JSON.stringify(r.weekdays), r.time, r.reminderMin, r.startDate, r.endedAt, r.endTime ?? null, r.place ?? null,
  ]);
const putLog = (db: SQLiteDatabase, l: DayLog) => db.runSync('INSERT OR REPLACE INTO day_logs (date,planned,done) VALUES (?,?,?)', [l.date, l.planned, l.done]);
const putList = (db: SQLiteDatabase, l: Checklist) =>
  db.runSync('INSERT OR REPLACE INTO lists (id,title,sort,created_at,items) VALUES (?,?,?,?,?)', [l.id, l.title, l.sort, l.createdAt, JSON.stringify(l.items)]);
const putAlarm = (db: SQLiteDatabase, a: Alarm) =>
  db.runSync('INSERT OR REPLACE INTO alarms (id,date,time,label,created_at,set_at) VALUES (?,?,?,?,?,?)', [a.id, a.date, a.time, a.label, a.createdAt, a.setAt]);
const putNote = (db: SQLiteDatabase, n: Note) => db.runSync('INSERT OR REPLACE INTO notes (id,text,created_at) VALUES (?,?,?)', [n.id, n.text, n.createdAt]);
const putEvent = (db: SQLiteDatabase, e: TaskEvent) =>
  db.runSync('INSERT OR REPLACE INTO events (id,task_id,type,from_date,to_date,at) VALUES (?,?,?,?,?,?)', [e.id, e.taskId, e.type, e.fromDate, e.toDate, e.at]);
const putMeta = (db: SQLiteDatabase, m: Partial<AppData['meta']>) => {
  Object.entries(m).forEach(([k, v]) =>
    db.runSync('INSERT OR REPLACE INTO meta (key,value) VALUES (?,?)', [k, Array.isArray(v) ? JSON.stringify(v) : v ?? null]),
  );
};

type EventRow = { id: string; task_id: string; type: TaskEvent['type']; from_date: string | null; to_date: string | null; at: number };
const toEvent = (r: EventRow): TaskEvent => ({ id: r.id, taskId: r.task_id, type: r.type, fromDate: r.from_date, toDate: r.to_date, at: r.at });

export function openRepo(): Repo {
  const db = openDatabaseSync('yomi.db');
  db.execSync('PRAGMA journal_mode = WAL');
  migrate(db);
  return {
    load() {
      const tasks = db.getAllSync<any>('SELECT * FROM tasks').map(
        (r): Task => ({
          id: r.id, title: r.title, groupId: r.group_id, points: r.points, date: r.date, sort: r.sort, time: r.time, reminderMin: r.reminder_min,
          deferrals: r.deferrals, doneAt: r.done_at, recurringId: r.recurring_id, occurrenceDate: r.occurrence_date, createdAt: r.created_at, deletedAt: r.deleted_at,
          ...(r.no_auto ? { noAuto: true } : {}),
          ...(r.duration_min ? { durationMin: r.duration_min } : {}),
        }),
      );
      const groups = db.getAllSync<Group>('SELECT id,name,color,sort FROM groups_ ORDER BY sort');
      const recurring = db.getAllSync<any>('SELECT * FROM recurring').map(
        (r): Recurring => ({
          id: r.id, title: r.title, groupId: r.group_id, points: r.points, weekdays: JSON.parse(r.weekdays), time: r.time,
          reminderMin: r.reminder_min, startDate: r.start_date, endedAt: r.ended_at, endTime: r.end_time, place: r.place,
        }),
      );
      const logs = db.getAllSync<DayLog>('SELECT date,planned,done FROM day_logs');
      const lists = db.getAllSync<any>('SELECT * FROM lists ORDER BY sort').map(
        (r): Checklist => ({ id: r.id, title: r.title, sort: r.sort, createdAt: r.created_at, items: JSON.parse(r.items) }),
      );
      const alarms = db.getAllSync<any>('SELECT * FROM alarms').map(
        (r): Alarm => ({ id: r.id, date: r.date, time: r.time, label: r.label, createdAt: r.created_at, setAt: r.set_at }),
      );
      const notes = db.getAllSync<any>('SELECT * FROM notes ORDER BY created_at').map((r): Note => ({ id: r.id, text: r.text, createdAt: r.created_at }));
      const meta = Object.fromEntries(db.getAllSync<{ key: string; value: string | null }>('SELECT key,value FROM meta').map((m) => [m.key, m.value]));
      return {
        tasks: Object.fromEntries(tasks.map((t) => [t.id, t])),
        groups, recurring, lists, alarms, notes,
        dayLogs: Object.fromEntries(logs.map((l) => [l.date, l])),
        meta: {
          lastDay: meta.lastDay ?? null,
          theme: (meta.theme as AppData['meta']['theme']) ?? 'system',
          hiddenCalendars: meta.hiddenCalendars ? JSON.parse(meta.hiddenCalendars) : [],
        },
      };
    },
    apply(c: Change) {
      db.withTransactionSync(() => {
        c.tasks?.forEach((t) => putTask(db, t));
        c.groups?.forEach((g) => putGroup(db, g));
        c.removeGroups?.forEach((id) => db.runSync('DELETE FROM groups_ WHERE id = ?', [id]));
        c.recurring?.forEach((r) => putRecurring(db, r));
        c.dayLogs?.forEach((l) => putLog(db, l));
        c.lists?.forEach((l) => putList(db, l));
        c.removeLists?.forEach((id) => db.runSync('DELETE FROM lists WHERE id = ?', [id]));
        c.alarms?.forEach((a) => putAlarm(db, a));
        c.removeAlarms?.forEach((id) => db.runSync('DELETE FROM alarms WHERE id = ?', [id]));
        c.notes?.forEach((n) => putNote(db, n));
        c.removeNotes?.forEach((id) => db.runSync('DELETE FROM notes WHERE id = ?', [id]));
        c.events?.forEach((e) => putEvent(db, e));
        if (c.meta) putMeta(db, c.meta);
      });
    },
    removeEvents(ids) {
      db.withTransactionSync(() => ids.forEach((id) => db.runSync('DELETE FROM events WHERE id = ?', [id])));
    },
    eventsFor: (taskId) => db.getAllSync<EventRow>('SELECT * FROM events WHERE task_id = ? ORDER BY at DESC', [taskId]).map(toEvent),
    allEvents: () => db.getAllSync<EventRow>('SELECT * FROM events ORDER BY at').map(toEvent),
    replaceAll(d, events) {
      db.withTransactionSync(() => {
        db.execSync('DELETE FROM tasks; DELETE FROM groups_; DELETE FROM recurring; DELETE FROM day_logs; DELETE FROM events; DELETE FROM meta; DELETE FROM lists; DELETE FROM alarms; DELETE FROM notes;');
        Object.values(d.tasks).forEach((t) => putTask(db, t));
        d.groups.forEach((g) => putGroup(db, g));
        d.recurring.forEach((r) => putRecurring(db, r));
        Object.values(d.dayLogs).forEach((l) => putLog(db, l));
        d.lists.forEach((l) => putList(db, l));
        (d.alarms ?? []).forEach((a) => putAlarm(db, a));
        (d.notes ?? []).forEach((n) => putNote(db, n));
        events.forEach((e) => putEvent(db, e));
        putMeta(db, d.meta);
      });
    },
  };
}

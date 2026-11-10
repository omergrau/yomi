export type Points = 1 | 2 | 3 | 4 | 5;

export type Task = {
  id: string;
  title: string;
  groupId: string | null;
  points: Points;
  /** Null means the task waits in the pool. */
  date: string | null;
  sort: number;
  time: string | null;
  /** Minutes before the time. Null means no reminder. */
  reminderMin: number | null;
  deferrals: number;
  doneAt: number | null;
  recurringId: string | null;
  /** The day this occurrence was generated for. It stays fixed if the occurrence is moved. */
  occurrenceDate: string | null;
  createdAt: number;
  deletedAt: number | null;
  /** How long a timed task lasts, in minutes. Absent means a short, open-ended slot. */
  durationMin?: number | null;
  /** Set when the person reopened a task that had completed itself at the end of its time. */
  noAuto?: boolean;
};

export type Group = { id: string; name: string; color: number; sort: number };

export type Recurring = {
  id: string;
  title: string;
  groupId: string | null;
  points: Points;
  /** 0 is Sunday. */
  weekdays: number[];
  time: string | null;
  reminderMin: number | null;
  startDate: string;
  endedAt: number | null;
  /** Timetable details. Absent on items made before the timetable existed. */
  endTime?: string | null;
  place?: string | null;
};

export type EventType = 'created' | 'planned' | 'moved' | 'deferred' | 'rolled' | 'unplanned' | 'completed' | 'reopened' | 'deleted';

/** Append-only history of what happened to a task and when. */
export type TaskEvent = { id: string; taskId: string; type: EventType; fromDate: string | null; toDate: string | null; at: number };

/** What a finished day looked like before unfinished tasks left it. */
export type DayLog = { date: string; planned: number; done: number };

export type ListItem = { id: string; text: string; done: boolean };

/** A plain checklist. It earns no points and belongs to no day. */
export type Checklist = { id: string; title: string; sort: number; createdAt: number; items: ListItem[] };

/**
 * An alarm the person asked for. It rings in the phone's own clock app, which only takes a time within the
 * next day, so the app hands it over once it is that close. `setAt` is when it was handed over.
 */
export type Alarm = { id: string; date: string; time: string; label: string | null; createdAt: number; setAt: number | null };

/** Something the assistant should know about the person, kept across conversations and updates. */
export type Note = { id: string; text: string; createdAt: number };

export type Meta = { lastDay: string | null; theme: 'system' | 'light' | 'dark'; hiddenCalendars: string[] };

export type AppData = {
  tasks: Record<string, Task>;
  groups: Group[];
  recurring: Recurring[];
  dayLogs: Record<string, DayLog>;
  lists: Checklist[];
  alarms: Alarm[];
  notes: Note[];
  meta: Meta;
};

/** One atomic change. Logic functions return these, and the store saves and applies them. */
export type Change = {
  tasks?: Task[];
  groups?: Group[];
  removeGroups?: string[];
  lists?: Checklist[];
  removeLists?: string[];
  alarms?: Alarm[];
  removeAlarms?: string[];
  notes?: Note[];
  removeNotes?: string[];
  recurring?: Recurring[];
  dayLogs?: DayLog[];
  events?: TaskEvent[];
  meta?: Partial<Meta>;
};

export type Backup = {
  app: 'yomi';
  version: 1;
  exportedAt: number;
  data: Omit<AppData, 'tasks' | 'dayLogs'> & { tasks: Task[]; dayLogs: DayLog[] };
  events: TaskEvent[];
};

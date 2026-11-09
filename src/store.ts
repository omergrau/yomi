// The single source of truth. Every change goes through commit(), which saves first and then updates the screen.
import * as Haptics from 'expo-haptics';
import { useSyncExternalStore } from 'react';
import { AppState, Platform } from 'react-native';
import { openRepo } from './data/repo';
import type { Repo } from './data/repoTypes';
import { addDays, toIso } from './domain/dates';
import * as L from './domain/logic';
import type { AppData, Change, Points, Recurring, Task, TaskEvent } from './domain/types';
import { fmtDay, t as tr } from './i18n';
import { syncReminders } from './notifications';

export type SheetState = { id: string | null; groupId?: string | null; date?: string | null };
export type Toast = { key: number; message: string; undo?: () => void };

export type TaskForm = L.TaskInput & { repeat: boolean; weekdays: number[] };
export type SlotForm = { title: string; weekdays: number[]; time: string | null; endTime: string | null; place: string; reminderMin: number | null; groupId: string | null; points: Points };

type Snapshot = {
  data: AppData;
  today: string;
  view: string;
  toast: Toast | null;
  sheet: SheetState | null;
  ready: boolean;
};

let repo: Repo;
const today0 = toIso(new Date());
let S: Snapshot = { data: L.emptyData(), today: today0, view: today0, toast: null, sheet: null, ready: false };
const listeners = new Set<() => void>();

const set = (patch: Partial<Snapshot>) => {
  S = { ...S, ...patch };
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
export const useApp = () => useSyncExternalStore(subscribe, () => S, () => S);
export const getApp = () => S;

let toastKey = 0;
let toastTimer: ReturnType<typeof setTimeout> | null = null;
export function showToast(message: string, undo?: () => void) {
  if (toastTimer) clearTimeout(toastTimer);
  const key = ++toastKey;
  set({ toast: { key, message, undo } });
  toastTimer = setTimeout(() => set({ toast: null }), undo ? 4500 : 3000);
}
export const hideToast = () => set({ toast: null });

let reminderTimer: ReturnType<typeof setTimeout> | null = null;
function queueReminders() {
  if (reminderTimer) clearTimeout(reminderTimer);
  reminderTimer = setTimeout(() => {
    syncReminders(S.data).catch(() => {});
  }, 400);
}

function commit(change: Change) {
  repo.apply(change);
  set({ data: L.applyChange(S.data, change) });
  queueReminders();
}

/** Applies a change and returns a function that exactly reverses it. */
function commitUndoable(change: Change): () => void {
  const before = S.data;
  commit(change);
  return () => {
    const tasks: Task[] = (change.tasks ?? []).map((x) => before.tasks[x.id] ?? { ...x, deletedAt: Date.now() });
    const recurring = (change.recurring ?? []).map((r) => before.recurring.find((x) => x.id === r.id)).filter(Boolean) as Recurring[];
    const dayLogs = (change.dayLogs ?? []).map((l) => before.dayLogs[l.date]).filter(Boolean);
    repo.removeEvents((change.events ?? []).map((e) => e.id));
    commit({ tasks, recurring, dayLogs });
    hideToast();
  };
}

/** Runs at launch, on return to the app and once a minute, so a day that ended always rolls over. */
export function ensureDay() {
  const today = toIso(new Date());
  const changedDay = today !== S.today;
  const change = S.data.meta.lastDay === today ? {} : L.rollover(S.data, today, Date.now());
  const next = L.applyChange(S.data, change);
  const all = L.merge(change, L.materialize(next, today, Date.now()));
  const rolled = change.events?.length ?? 0;
  if (all.tasks?.length || all.dayLogs?.length || all.events?.length || all.meta?.lastDay) commit(all);
  if (changedDay) set({ today, view: S.view === S.today ? today : S.view });
  if (rolled) showToast(tr.rolled(rolled));
}

let started = false;
export function initStore() {
  if (started) return;
  started = true;
  repo = openRepo();
  let data = repo.load();
  if (!data.groups.length && !data.meta.lastDay) {
    tr.starterGroups.forEach((name) => {
      const made = L.createGroup(data, name, Date.now());
      repo.apply(made.change);
      data = L.applyChange(data, made.change);
    });
  }
  S = { ...S, data, ready: true };
  ensureDay();
  queueReminders();
  AppState.addEventListener('change', (s) => {
    if (s === 'active') ensureDay();
  });
  setInterval(ensureDay, 60000);
}

export const setView = (view: string) => set({ view });
export const openSheet = (sheet: SheetState) => set({ sheet });
export const closeSheet = () => set({ sheet: null });
export const taskHistory = (id: string): TaskEvent[] => L.historyLabelOrder(repo.eventsFor(id));

const dayWord = (date: string) => (date === S.today ? tr.today : date === addDays(S.today, 1) ? tr.tomorrow : tr.dayName(fmtDay(date)));
const buzz = (kind: 'light' | 'success' | 'select') => {
  if (Platform.OS === 'web') return;
  const p = kind === 'light' ? Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light) : kind === 'success' ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success) : Haptics.selectionAsync();
  p.catch(() => {});
};
export const buzzLift = () => buzz('light');

export function toggleDone(id: string) {
  const task = S.data.tasks[id];
  if (!task) return;
  const done = !task.doneAt;
  const date = task.date ?? S.today;
  const beforeLevel = L.levelInfo(L.totalPoints(S.data)).level;
  const wasClosed = L.dayStats(S.data, date).closed;
  commit(L.setDone(S.data, id, done, S.today, Date.now()));
  const closed = L.dayStats(S.data, date).closed;
  const level = L.levelInfo(L.totalPoints(S.data)).level;
  if (done && level > beforeLevel) showToast(tr.newLevel(level));
  buzz(closed && !wasClosed ? 'success' : 'light');
}

export function dropOnDay(id: string, date: string, index?: number) {
  const task = S.data.tasks[id];
  if (!task) return;
  const undo = commitUndoable(L.moveTask(S.data, id, date, Date.now(), { index }));
  if (task.date !== date) showToast(index === undefined || date !== S.view ? tr.movedTo(dayWord(date)) : tr.addedTo(dayWord(date)), undo);
  buzz('select');
}

export function removeFromDay(id: string) {
  const task = S.data.tasks[id];
  if (!task) return;
  const undo = commitUndoable(L.removeFromDay(S.data, id, Date.now()));
  showToast(task.recurringId ? tr.removedOccurrence : tr.movedToPool, undo);
  buzz('select');
}

export function moveToTomorrow(id: string) {
  const task = S.data.tasks[id];
  if (!task) return;
  const base = task.date && task.date >= S.today ? task.date : S.today;
  const to = addDays(base, 1);
  const undo = commitUndoable(L.moveTask(S.data, id, to, Date.now(), { keepTime: true }));
  showToast(tr.movedTo(dayWord(to)), undo);
  buzz('select');
}

export function deleteTask(id: string) {
  const undo = commitUndoable(L.deleteTask(S.data, id, Date.now()));
  showToast(tr.deleted, undo);
}

export function saveForm(id: string | null, form: TaskForm) {
  const now = Date.now();
  const input: L.TaskInput = { title: form.title.trim(), groupId: form.groupId, points: form.points as Points, date: form.date, time: form.time, reminderMin: form.reminderMin };
  const existing = id ? S.data.tasks[id] : null;
  if (existing) {
    let change = L.editTask(S.data, existing.id, input, now);
    if (existing.recurringId) {
      const after = L.applyChange(S.data, change);
      change = L.merge(change, L.setWeekdays(after, existing.recurringId, form.weekdays, S.today, now));
    }
    commit(change);
    return;
  }
  if (form.repeat) {
    commit(L.createRecurring(S.data, { title: input.title, groupId: input.groupId, points: input.points, time: input.time, reminderMin: input.reminderMin, weekdays: form.weekdays }, S.today, now));
    return;
  }
  commit(L.createTask(S.data, input, now));
  showToast(input.date ? tr.addedTo(dayWord(input.date)) : tr.addedPool);
}

/** The fastest path: a title alone puts a task on the day being viewed. */
export function quickAdd(title: string, points: Points = 3, groupId: string | null = null) {
  const clean = title.trim();
  if (!clean) return;
  const date = S.view >= S.today ? S.view : S.today;
  commit(L.createTask(S.data, { title: clean, groupId, points, date, time: null, reminderMin: null }, Date.now()));
  buzz('light');
}

function editList(id: string, fn: Parameters<typeof L.editList>[2]) {
  commit(L.editList(S.data, id, fn));
}
export function addList(title: string) {
  const list = L.createList(S.data, title, Date.now());
  commit({ lists: [list] });
  return list.id;
}
export const renameList = (id: string, title: string) => editList(id, (l) => ({ ...l, title: title.trim() }));
export const addListItem = (id: string, text: string) => editList(id, (l) => L.addItem(l, text, Date.now()));
export const removeListItem = (id: string, item: string) => editList(id, (l) => L.removeItem(l, item));
export const clearListDone = (id: string) => editList(id, L.clearDone);
export function toggleListItem(id: string, item: string) {
  editList(id, (l) => L.toggleItem(l, item));
  buzz('select');
}
export function removeList(id: string) {
  const list = S.data.lists.find((l) => l.id === id);
  if (!list) return;
  commit({ removeLists: [id] });
  showToast(tr.listDeleted, () => {
    commit({ lists: [list] });
    hideToast();
  });
}

/** Saves a timetable slot as a recurring item, so it appears in its days and reminds like any task. */
export function saveSlot(id: string | null, f: SlotForm) {
  const input = {
    title: f.title.trim(), groupId: f.groupId, points: f.points, weekdays: [...f.weekdays].sort(), time: f.time,
    endTime: f.endTime, place: f.place.trim() || null, reminderMin: f.time ? f.reminderMin : null,
  };
  const now = Date.now();
  commit(id ? L.editRecurring(S.data, id, input, S.today, now) : L.createRecurring(S.data, input, S.today, now));
  showToast(tr.slotSaved);
}

export function endSeries(recurringId: string, fromDate: string) {
  const undo = commitUndoable(L.endRecurring(S.data, recurringId, fromDate, Date.now()));
  showToast(tr.seriesEnded, undo);
}

export function addGroup(name: string) {
  const made = L.createGroup(S.data, name, Date.now());
  if (made.change.groups) commit(made.change);
  return made.group;
}
export function renameGroup(id: string, name: string) {
  const g = S.data.groups.find((x) => x.id === id);
  if (g && name.trim()) commit({ groups: [{ ...g, name: name.trim() }] });
}
export const removeGroup = (id: string) => commit(L.deleteGroup(S.data, id));
export const setTheme = (theme: AppData['meta']['theme']) => commit({ meta: { theme } });
export const setHiddenCalendars = (hiddenCalendars: string[]) => commit({ meta: { hiddenCalendars } });

export const exportPayload = () => JSON.stringify(L.makeBackup(S.data, repo.allEvents(), Date.now()));

export function importPayload(raw: string) {
  const { data, events } = L.readBackup(raw);
  repo.replaceAll(data, events);
  set({ data });
  ensureDay();
  queueReminders();
}

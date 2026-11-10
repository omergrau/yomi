// The phone's calendar. Its events are read so the day shows what is already booked, and the app's own tasks are
// written to a calendar of its own, "עוזר אישי". That calendar is left out of reading, so nothing shows twice.
import { Platform } from 'react-native';
import { addDays, parseIso } from './domain/dates';
import { SYNC_AHEAD, SYNC_BACK, planSync, type CalSpec } from './domain/calsync';

export type PhoneCalendar = { id: string; title: string; color: string; account: string };
export type PhoneEvent = { id: string; title: string; start: number; end: number; allDay: boolean; location: string | null; calendarId: string; color: string };
export type CalendarAccess = 'granted' | 'denied' | 'undetermined' | 'unavailable';

type Legacy = typeof import('expo-calendar/legacy');
const api = (): Legacy | null => (Platform.OS === 'web' ? null : (require('expo-calendar/legacy') as Legacy));

export async function calendarAccess(): Promise<CalendarAccess> {
  const c = api();
  if (!c) return 'unavailable';
  const p = await c.getCalendarPermissionsAsync();
  return p.granted ? 'granted' : p.canAskAgain ? 'undetermined' : 'denied';
}

export async function askCalendar(): Promise<boolean> {
  const c = api();
  if (!c) return false;
  return (await c.requestCalendarPermissionsAsync()).granted;
}

/** The app's own calendar is marked by its owner account. */
export const APP_CALENDAR = 'עוזר אישי';
const OWNER = 'app.yomi';
type Cal = { ownerAccount?: string; source?: { name?: string } };
const isApp = (x: Cal) => x.ownerAccount === OWNER || x.source?.name === OWNER;

export async function listCalendars(): Promise<PhoneCalendar[]> {
  const c = api();
  if (!c) return [];
  const cals = await c.getCalendarsAsync(c.EntityTypes.EVENT);
  return cals
    .filter((x) => x.isVisible !== false && !isApp(x))
    .map((x) => ({ id: x.id, title: x.title, color: x.color, account: x.source?.name ?? '' }));
}

/** Events between two days (the end day excluded), from every calendar the person has not hidden. */
export async function eventsBetween(fromDate: string, toDate: string, hidden: string[]): Promise<PhoneEvent[]> {
  const c = api();
  if (!c) return [];
  const cals = (await listCalendars()).filter((x) => !hidden.includes(x.id));
  if (!cals.length) return [];
  const colors = new Map(cals.map((x) => [x.id, x.color]));
  const from = parseIso(fromDate);
  from.setHours(0, 0, 0, 0);
  const to = parseIso(toDate);
  to.setHours(0, 0, 0, 0);
  const events = await c.getEventsAsync(cals.map((x) => x.id), from, to);
  return events.map((e) => ({
    id: e.id, title: e.title || '', start: new Date(e.startDate).getTime(), end: new Date(e.endDate).getTime(), allDay: !!e.allDay,
    location: e.location || null, calendarId: e.calendarId, color: colors.get(e.calendarId) ?? '',
  }));
}

/** Events that touch the given day, from every calendar the person has not hidden. */
export async function eventsFor(date: string, hidden: string[]): Promise<PhoneEvent[]> {
  const c = api();
  if (!c) return [];
  const cals = (await listCalendars()).filter((x) => !hidden.includes(x.id));
  if (!cals.length) return [];
  const colors = new Map(cals.map((x) => [x.id, x.color]));
  const from = parseIso(date);
  from.setHours(0, 0, 0, 0);
  const to = parseIso(addDays(date, 1));
  to.setHours(0, 0, 0, 0);
  const events = await c.getEventsAsync(cals.map((x) => x.id), from, to);
  return events.map((e) => ({
    id: e.id,
    title: e.title || '',
    start: new Date(e.startDate).getTime(),
    end: new Date(e.endDate).getTime(),
    allDay: !!e.allDay,
    location: e.location || null,
    calendarId: e.calendarId,
    color: colors.get(e.calendarId) ?? '',
  }));
}

async function appCalendarId(make: boolean): Promise<string | null> {
  const c = api();
  if (!c) return null;
  const found = (await c.getCalendarsAsync(c.EntityTypes.EVENT)).find(isApp);
  if (found || !make) return found?.id ?? null;
  return c.createCalendarAsync({
    title: APP_CALENDAR,
    name: OWNER,
    color: '#2E7D5B',
    entityType: c.EntityTypes.EVENT,
    source: { isLocalAccount: true, name: OWNER, type: c.SourceType.LOCAL },
    ownerAccount: OWNER,
    accessLevel: c.CalendarAccessLevel.OWNER,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
}

const DAY = 86400000;

/** Brings the "עוזר אישי" calendar in line with the app's tasks. Returns how many events were written or removed. */
export async function syncAppCalendar(wanted: CalSpec[], now: number): Promise<number> {
  const c = api();
  if (!c || (await calendarAccess()) !== 'granted') return 0;
  const id = await appCalendarId(true);
  if (!id) return 0;
  const from = new Date(now - (SYNC_BACK + 1) * DAY);
  const to = new Date(now + (SYNC_AHEAD + 2) * DAY);
  const existing = (await c.getEventsAsync([id], from, to)).map((e) => ({
    id: e.id, notes: e.notes ?? null, title: e.title || '', start: new Date(e.startDate).getTime(), end: new Date(e.endDate).getTime(),
    allDay: !!e.allDay, location: e.location || null,
  }));
  const plan = planSync(existing, wanted);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const details = (w: CalSpec) => ({
    title: w.title, startDate: new Date(w.start), endDate: new Date(w.end), allDay: w.allDay, location: w.location ?? '', notes: w.notes,
    timeZone: w.allDay ? 'UTC' : tz, endTimeZone: w.allDay ? 'UTC' : tz, alarms: [],
  });
  for (const e of plan.remove) await c.deleteEventAsync(e).catch(() => {});
  for (const u of plan.update) await c.updateEventAsync(u.id, details(u.spec)).catch(() => {});
  for (const w of plan.create) await c.createEventAsync(id, details(w)).catch(() => {});
  return plan.remove.length + plan.update.length + plan.create.length;
}

/** Turning the sync off removes the app's calendar and every event in it. */
export async function removeAppCalendar() {
  const c = api();
  if (!c || (await calendarAccess()) !== 'granted') return;
  const id = await appCalendarId(false);
  if (id) await c.deleteCalendarAsync(id);
}

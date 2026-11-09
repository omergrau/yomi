// Reads the phone's calendar so the day can show what is already booked. Nothing is written to the calendar.
import { Platform } from 'react-native';
import { addDays, parseIso } from './domain/dates';

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

export async function listCalendars(): Promise<PhoneCalendar[]> {
  const c = api();
  if (!c) return [];
  const cals = await c.getCalendarsAsync(c.EntityTypes.EVENT);
  return cals
    .filter((x) => x.isVisible !== false)
    .map((x) => ({ id: x.id, title: x.title, color: x.color, account: x.source?.name ?? '' }));
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

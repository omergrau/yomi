import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { reminderJobs, urgentJobs, type ReminderJob } from './domain/logic';
import type { AppData } from './domain/types';
import { t } from './i18n';

const CHANNEL = 'reminders';
const native = Platform.OS !== 'web';

export function setupNotifications() {
  if (!native) return;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
  });
  Notifications.setNotificationChannelAsync(CHANNEL, { name: t.channel, importance: Notifications.AndroidImportance.HIGH }).catch(() => {});
}

export type ReminderAccess = { notifications: boolean; exact: boolean; canAsk: boolean; scheduled: number };

export async function reminderAccess(): Promise<ReminderAccess> {
  if (!native) return { notifications: false, exact: false, canAsk: false, scheduled: 0 };
  const p = await Notifications.getPermissionsAsync();
  const e = await Notifications.getExactAlarmPermissionsAsync();
  const list = await Notifications.getAllScheduledNotificationsAsync();
  return { notifications: p.granted, exact: e.granted, canAsk: p.canAskAgain, scheduled: list.length };
}

export async function askNotifications() {
  if (!native) return false;
  const p = await Notifications.requestPermissionsAsync();
  return p.granted;
}

export async function askExact() {
  if (!native) return;
  await Notifications.requestExactAlarmPermissionsAsync();
}

/** Asked the first time a reminder is set, when the reason is obvious. */
export async function ensureReminderPermission() {
  if (!native) return;
  const p = await Notifications.getPermissionsAsync();
  if (!p.granted && p.canAskAgain) await Notifications.requestPermissionsAsync();
}

export async function scheduleTest() {
  await Notifications.scheduleNotificationAsync({
    content: { title: t.testTitle, body: t.testBody },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: Date.now() + 60000, channelId: CHANNEL },
  });
}

let running: Promise<void> = Promise.resolve();

/** Makes what the phone has scheduled match the data. Each task keeps one reminder, keyed by its id. */
export function syncReminders(data: AppData) {
  if (!native) return running;
  running = running.then(() => sync(data), () => sync(data));
  return running;
}

async function sync(data: AppData) {
  const now = Date.now();
  const jobs = [...reminderJobs(data, now), ...urgentJobs(data, now)];
  const wanted = new Map(jobs.map((j) => [j.id, j]));
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  const have = new Set<string>();
  for (const n of scheduled) {
    const job = wanted.get(n.identifier);
    const d = n.content.data as { fireAt?: number; yomi?: boolean } | null;
    if (!d?.yomi) continue;
    const want = job ? content(job) : null;
    if (job && want && d.fireAt === job.fireAt && n.content.title === want.title && n.content.body === want.body) have.add(n.identifier);
    else await Notifications.cancelScheduledNotificationAsync(n.identifier);
  }
  for (const job of jobs) {
    if (have.has(job.id)) continue;
    await Notifications.scheduleNotificationAsync({
      identifier: job.id,
      content: { ...content(job), data: { yomi: true, fireAt: job.fireAt, taskId: job.id } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: job.fireAt, channelId: CHANNEL },
    });
  }
}

function content(job: ReminderJob) {
  if (job.urgent) return { title: t.urgentTitle(job.urgent.length), body: job.urgent.join(' · ') };
  return { title: job.title, body: t.startsAt(job.time) };
}

// Sets and removes alarms in the phone's own clock app, so they ring like any alarm: loudly, until stopped,
// and in silent mode too. Only Android has this; elsewhere nothing happens.
import { Platform } from 'react-native';
import type { Alarm } from './domain/types';
import { t } from './i18n';

export const hasClock = Platform.OS === 'android';

const X = 'android.intent.extra.alarm.';
let queue: Promise<unknown> = Promise.resolve();

// The clock app opens for a moment each time, so the calls go one after another.
function launch(action: string, extra: Record<string, string | number | boolean>): Promise<boolean> {
  const run = async () => {
    try {
      const IntentLauncher = await import('expo-intent-launcher');
      await IntentLauncher.startActivityAsync(action, { extra });
      return true;
    } catch {
      return false;
    }
  };
  const p = queue.then(run, run);
  queue = p;
  return p;
}

const parts = (a: Alarm) => a.time.split(':').map(Number);

export function setClockAlarm(a: Alarm) {
  if (!hasClock) return Promise.resolve(false);
  const [h, m] = parts(a);
  return launch('android.intent.action.SET_ALARM', {
    [`${X}HOUR`]: h,
    [`${X}MINUTES`]: m,
    [`${X}MESSAGE`]: a.label ?? t.alarmDefault,
    [`${X}VIBRATE`]: true,
    [`${X}SKIP_UI`]: true,
  });
}

/** Turns off the clock alarm set at that time. The clock app may ask which one when several match. */
export function dismissClockAlarm(a: Alarm) {
  if (!hasClock) return Promise.resolve(false);
  const [h, m] = parts(a);
  return launch('android.intent.action.DISMISS_ALARM', {
    [`${X}SEARCH_MODE`]: 'android.time',
    [`${X}HOUR`]: h,
    [`${X}MINUTES`]: m,
  });
}

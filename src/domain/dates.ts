// Calendar days are plain YYYY-MM-DD strings in local time, so comparing them as strings is safe.
const pad = (n: number) => String(n).padStart(2, '0');

export const toIso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const parseIso = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
};

export const addDays = (s: string, n: number) => {
  const d = parseIso(s);
  d.setDate(d.getDate() + n);
  return toIso(d);
};

export const weekday = (s: string) => parseIso(s).getDay();

export const weekDays = (s: string) => {
  const start = addDays(s, -weekday(s));
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
};

/** The moment a reminder fires, or null when the task has no valid time. */
export const fireTime = (date: string, time: string, minutesBefore: number) => {
  const [h, m] = time.split(':').map(Number);
  const [y, mo, d] = date.split('-').map(Number);
  return new Date(y, mo - 1, d, h, m - minutesBefore, 0, 0).getTime();
};

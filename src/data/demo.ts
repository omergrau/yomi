// A sample week for the browser prototype only, so the timetable and the day can be seen filled in.
// The phone never loads this: it is used by repo.ts, the web stand-in, and only when the page asks for it.
import { addDays, toIso, weekDays } from '../domain/dates';
import { addItem, applyChange, createGroup, createList, createRecurring, createTask, emptyData, toggleItem } from '../domain/logic';
import type { AppData, Change, Points } from '../domain/types';
import { t as tr } from '../i18n';

/** A sample talk with the assistant, built from the same week, so its formatting can be seen without a key. */
export let demoConversation: { q: string; a: string }[] = [];

export function demoData(): AppData {
  const today = toIso(new Date());
  let now = Date.now() - 100000;
  let d = emptyData();
  const put = (c: Change) => {
    d = applyChange(d, c);
  };
  const groups = tr.starterGroups.map((name) => {
    const made = createGroup(d, name, now++);
    put(made.change);
    return made.group?.id ?? null;
  });
  const [g1, g2, g3] = [groups[0] ?? null, groups[1] ?? groups[0] ?? null, groups[2] ?? groups[0] ?? null];

  // The weekly timetable: lectures, training and work shifts, filled in from the start of this week.
  const slots: { title: string; days: number[]; time: string; end: string; place: string | null; groupId: string | null }[] = [
    { title: 'הרצאה: אלגוריתמים', days: [0, 2], time: '10:00', end: '12:00', place: 'בניין 34', groupId: g1 },
    { title: 'תרגול: אלגוריתמים', days: [1], time: '14:00', end: '15:30', place: 'בניין 28', groupId: g1 },
    { title: 'הרצאה: מבני נתונים', days: [1, 3], time: '08:30', end: '10:00', place: 'בניין 35', groupId: g1 },
    { title: 'משמרת בעבודה', days: [0, 3], time: '16:00', end: '20:00', place: null, groupId: g2 },
    { title: 'אימון כושר', days: [0, 2, 4], time: '07:00', end: '08:00', place: 'חדר כושר', groupId: g3 },
    { title: 'כדורגל עם החבר׳ה', days: [5], time: '18:00', end: '20:00', place: null, groupId: g3 },
    { title: 'שינה', days: [0, 1, 2, 3, 4, 5, 6], time: '00:00', end: '06:30', place: null, groupId: null },
  ];
  for (const x of slots) {
    put(createRecurring(d, { title: x.title, groupId: x.groupId, points: 2, weekdays: x.days, time: x.time, endTime: x.end, place: x.place, reminderMin: 10 }, weekDays(today)[0], now++));
  }

  // One-off appointments with a time, and jobs without one, across the week.
  const week = weekDays(today);
  const timed: [number, string, string, number | null][] = [
    [1, 'רופא שיניים', '12:30', 45],
    [3, 'פגישה עם המנחה', '13:00', 60],
    [4, 'ארוחת ערב משפחתית', '19:30', 120],
    [6, 'סרט עם נועה', '21:00', 150],
  ];
  for (const [i, title, time, dur] of timed) {
    put(createTask(d, { title, groupId: null, points: 2, date: week[i], time, reminderMin: 15, durationMin: dur }, now++));
  }
  const jobs: [string | null, string, Points, string | null][] = [
    [today, 'להגיש תרגיל 3', 5, g1],
    [today, 'לקנות מתנה ליום הולדת', 3, null],
    [today, 'לכבס', 2, null],
    [addDays(today, 1), 'לקרוא פרק 4', 3, g1],
    [addDays(today, 2), 'לשלם חשבון חשמל', 4, null],
    [null, 'להזמין תור לטסט', 3, null],
    [null, 'לסדר את הארון', 1, null],
  ];
  for (const [date, title, points, groupId] of jobs) {
    put(createTask(d, { title, groupId, points, date, time: null, reminderMin: null }, now++));
  }

  // A shopping list with two things already bought.
  let list = createList(d, 'קניות לשבוע', now++);
  for (const item of ['חלב', 'לחם', 'ביצים', 'עגבניות', 'פסטה', 'שמפו']) list = addItem(list, item, now++);
  list = toggleItem(toggleItem(list, list.items[1].id), list.items[2].id);
  put({ lists: [list] });

  const at = week.indexOf(today);
  const plan = [
    ...slots.filter((x) => x.days.includes(at) && x.title !== 'שינה').map((x) => ({ time: x.time, end: x.end, title: x.title })),
    ...timed.filter((x) => x[0] === at).map(([, title, time]) => ({ time, end: null as string | null, title })),
  ].sort((a, b) => a.time.localeCompare(b.time));
  const open = jobs.filter((x) => x[0] === today);
  const planText = plan.length
    ? plan.map((x) => `- **${x.end ? `${x.time}–${x.end}` : x.time}** ${x.title}`).join('\n')
    : 'אין היום שום דבר בשעה קבועה.';
  demoConversation = [
    {
      q: 'מה נשאר לי לעשות היום?',
      a: `נשארו לך היום **${open.length} משימות**, ויש ${plan.length} דברים בלו״ז.\n\n## בלו״ז\n${planText}\n\n## משימות\n${open
        .map(([, title, points]) => `- **${title}**${points >= 4 ? ' · דחוף' : ''}`)
        .join('\n')}\n\nהייתי מתחיל מ**${open[0]?.[1] ?? ''}**, זו המשימה הכי דחופה.`,
    },
    {
      q: 'מה עוד צריך לקנות?',
      a: `ברשימה **${list.title}** נשארו ${list.items.filter((x) => !x.done).length} דברים:\n\n${list.items
        .filter((x) => !x.done)
        .map((x) => `- ${x.text}`)
        .join('\n')}\n\nאת ה${list.items[1].text} וה${list.items[2].text} כבר סימנת.`,
    },
  ];
  return d;
}

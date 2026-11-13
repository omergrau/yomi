// Talks to Claude with the app's actions as tools. Every change it makes goes through the store,
// so it shows at once and can be undone.
import Anthropic from '@anthropic-ai/sdk';
import { eventsBetween, calendarAccess } from '../calendar';
import { addDays, toIso } from '../domain/dates';
import { applyAssistantChange, getApp } from '../store';
import { isActionError, runAction, type CalEvent } from './actions';
import { getApiKey } from './key';

const MODEL = 'claude-opus-5-5';
const MAX_STEPS = 8;
// Summaries of old talks are written by the small model, which costs a small part of the main one.
const SUMMARY_MODEL = 'claude-haiku-5-5';

// Optional fields are simply left out of `required`; runAction fills in what is missing.
const optional = (type: string, description: string) => ({ type, description });
const TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: 'get_schedule',
    description: 'Read the days in a date range: tasks with time, length, urgency and topic, weekly timetable items, phone calendar events, plus tasks that have no day yet. Call this before planning or when unsure what exists.',
    input_schema: {
      type: 'object', additionalProperties: false, required: ['from_date', 'to_date'],
      properties: { from_date: { type: 'string', description: 'YYYY-MM-DD' }, to_date: { type: 'string', description: 'YYYY-MM-DD, at most 62 days after from_date' } },
    },
  },
  {
    name: 'add_task',
    description: 'Add a one-off task or meeting. Leave date out to keep it in "my tasks" without a day. A start time needs a date.',
    input_schema: {
      type: 'object', additionalProperties: false,
      required: ['title'],
      properties: {
        title: { type: 'string', description: 'Short Hebrew title' },
        date: optional('string', 'YYYY-MM-DD; leave out for no day'),
        start: optional('string', 'HH:MM 24h; leave out for no time'),
        duration_min: optional('integer', 'Length in minutes for meetings and activities, or null'),
        urgency: optional('integer', '1 (low) to 5 (urgent). Default 3'),
        topic: optional('string', 'Topic name; an existing one if it fits, else a new one, or null'),
        reminder_min: optional('integer', 'Minutes before the start to remind: 0, 10, 30 or 60; null for no reminder'),
      },
    },
  },
  {
    name: 'update_task',
    description: 'Change an existing task. Fields left out stay as they are. remove_from_day moves it back to "my tasks"; clear_time keeps the day but drops the time.',
    input_schema: {
      type: 'object', additionalProperties: false,
      required: ['task_id'],
      properties: {
        task_id: { type: 'string' },
        title: optional('string', 'New title or null'),
        date: optional('string', 'New YYYY-MM-DD or null'),
        remove_from_day: { type: 'boolean' },
        start: optional('string', 'New HH:MM or null'),
        clear_time: { type: 'boolean' },
        duration_min: optional('integer', 'New length in minutes or null'),
        urgency: optional('integer', '1 to 5 or null'),
        topic: optional('string', 'Topic name or null'),
        reminder_min: optional('integer', 'Minutes before or null'),
      },
    },
  },
  {
    name: 'complete_task',
    description: 'Mark a task done (earns its urgency as points) or reopen it.',
    input_schema: { type: 'object', additionalProperties: false, required: ['task_id', 'done'], properties: { task_id: { type: 'string' }, done: { type: 'boolean' } } },
  },
  {
    name: 'delete_task',
    description: 'Delete one task. Ask the person first unless they clearly asked for this exact deletion.',
    input_schema: { type: 'object', additionalProperties: false, required: ['task_id'], properties: { task_id: { type: 'string' } } },
  },
  {
    name: 'cancel_weekly_once',
    description: 'Cancel a single occurrence of a weekly timetable item, such as a cancelled lecture or a skipped training. Only that day goes away; the item keeps repeating on other weeks. Use a task_id with weekly: true from get_schedule (occurrences exist for the next 4 weeks).',
    input_schema: { type: 'object', additionalProperties: false, required: ['task_id'], properties: { task_id: { type: 'string' } } },
  },
  {
    name: 'remember',
    description: 'Save one lasting fact about the person to your memory, so future conversations know it: a preference, a routine, a constraint, how they like to plan. One short sentence in Hebrew. To change a note you already have, pass its id in replaces instead of adding a second one.',
    input_schema: {
      type: 'object', additionalProperties: false,
      required: ['text'],
      properties: {
        text: { type: 'string', description: 'One short sentence, up to 200 characters' },
        replaces: optional('string', 'The id of an existing note this one updates'),
      },
    },
  },
  {
    name: 'forget',
    description: 'Remove a note from your memory, when the person asks or when it is no longer true.',
    input_schema: { type: 'object', additionalProperties: false, required: ['note_id'], properties: { note_id: { type: 'string' } } },
  },
  {
    name: 'get_alarms',
    description: 'Read the upcoming alarm clocks with their ids.',
    input_schema: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'set_alarm',
    description: 'Set an alarm clock that rings in the phone clock app on a given day and time. To wake the person relative to their plans (for example an hour before the first lesson tomorrow), read get_schedule first and work out the time.',
    input_schema: {
      type: 'object', additionalProperties: false,
      required: ['date', 'time'],
      properties: {
        date: { type: 'string', description: 'YYYY-MM-DD' },
        time: { type: 'string', description: 'HH:MM, 24-hour' },
        label: optional('string', 'Short name shown when it rings, such as השכמה לאימון'),
      },
    },
  },
  {
    name: 'delete_alarm',
    description: 'Remove an alarm clock. Use an alarm_id from get_alarms.',
    input_schema: { type: 'object', additionalProperties: false, required: ['alarm_id'], properties: { alarm_id: { type: 'string' } } },
  },
  {
    name: 'add_weekly',
    description: 'Add a fixed weekly item to the timetable, such as a lecture or training. It appears on its weekdays every week and reminds.',
    input_schema: {
      type: 'object', additionalProperties: false,
      required: ['title', 'weekdays', 'start'],
      properties: {
        title: { type: 'string' },
        weekdays: { type: 'array', items: { type: 'integer' }, description: '0 Sunday ... 6 Saturday' },
        start: { type: 'string', description: 'HH:MM' },
        end: optional('string', 'HH:MM after start, or null'),
        place: optional('string', 'Place or null'),
        urgency: optional('integer', '1 to 5'),
        topic: optional('string', 'Topic name or null'),
        reminder_min: optional('integer', 'Minutes before; default 10'),
      },
    },
  },
  {
    name: 'find_free_time',
    description: 'Find free windows of at least duration_min minutes between tasks, timetable items and calendar events. Use it before suggesting a time.',
    input_schema: {
      type: 'object', additionalProperties: false, required: ['from_date', 'to_date', 'duration_min'],
      properties: {
        from_date: { type: 'string' }, to_date: { type: 'string' }, duration_min: { type: 'integer' },
        earliest: optional('string', 'HH:MM, default 08:00'), latest: optional('string', 'HH:MM, default 22:00'),
      },
    },
  },
  {
    name: 'get_lists',
    description: 'Read every checklist (such as shopping lists) with its items, their ids and whether they are ticked.',
    input_schema: { type: 'object', additionalProperties: false, required: [], properties: {} },
  },
  {
    name: 'create_list',
    description: 'Create a new checklist with a title and its items.',
    input_schema: {
      type: 'object', additionalProperties: false, required: ['title', 'items'],
      properties: { title: { type: 'string' }, items: { type: 'array', items: { type: 'string' }, description: 'One short Hebrew item each' } },
    },
  },
  {
    name: 'update_list',
    description: 'Change one checklist: rename it, add items, tick or untick items, remove items, or clear every ticked item. Use item ids from get_lists.',
    input_schema: {
      type: 'object', additionalProperties: false, required: ['list_id'],
      properties: {
        list_id: { type: 'string' },
        title: optional('string', 'New title or null'),
        add: { type: 'array', items: { type: 'string' } },
        check: { type: 'array', items: { type: 'string' }, description: 'Item ids to tick' },
        uncheck: { type: 'array', items: { type: 'string' }, description: 'Item ids to untick' },
        remove: { type: 'array', items: { type: 'string' }, description: 'Item ids to remove' },
        clear_checked: { type: 'boolean', description: 'Remove every ticked item' },
      },
    },
  },
  {
    name: 'delete_list',
    description: 'Delete a whole checklist. Do it when the person asks, for example after shopping.',
    input_schema: { type: 'object', additionalProperties: false, required: ['list_id'], properties: { list_id: { type: 'string' } } },
  },
];

const SYSTEM = `You are the planning assistant inside "עוזר אישי" (Personal Assistant), a personal Hebrew day planner on the person's phone.
You can read their schedule and change it with the tools. Reply in short, natural Hebrew.

How to write replies (the chat shows light Markdown):
- Keep it like a chat: a sentence or two for simple answers, with no formatting at all.
- Use **bold** for what matters most at a glance: a time, a day, a task name.
- Use "-" bullets for three or more items, such as a day's plan, one item per line, with the time first ("**09:00** הרצאה").
- Use a "##" heading only in a longer answer that has parts, such as a plan for several days, one heading per day.
- Do not use tables, code blocks, italics for emphasis, or stray asterisks, and keep emojis rare.

How the app works:
- Tasks belong to a day or wait in "my tasks" (המשימות שלי) without a day. Each has urgency 1-5, which is also the points it earns when done. A task with a time is part of the day's schedule, like an appointment, and earns no points. Every task with a day is also copied automatically to the phone calendar "עוזר אישי", so adding a task here is how to put something in the person's calendar.
- Timed tasks can have a length; when their time ends they complete themselves. Weekly items form the timetable (מערכת שעות).
- Topics (נושאים) group tasks, for example תואר, עבודה, ספורט.
- When a weekly item (lecture, training) is cancelled for one day, use cancel_weekly_once on that day's occurrence. Never delete or change the weekly item itself for a one-time change.
- Alarm clocks (שעון מעורר) ring in the phone clock app. Set them with set_alarm; when the person asks to wake up "in time for" something, look at the schedule and allow time to get ready (ask how long if it matters and is unknown).
- You have a memory of the person (shown below). Use it without mentioning it each time. When you learn something lasting and useful for planning (a routine, a preference, how long things take them, what matters most), save it with remember and say so in a few words. Also save whatever they ask you to remember. Do not save one-off tasks or events, which belong in the schedule, and do not save sensitive details such as health, money or passwords unless they ask.
- Checklists (רשימות) are plain lists with items to tick, such as a shopping list. They have no dates or points. Read them with get_lists before changing one, and match a list by its title.
- The week starts on Sunday. The person is in Israel.

How to work:
- Act when the request is clear: "I have a meeting on Thursday at 14:00 for an hour" means add it, not ask about it.
- Ask one short question only when something essential is missing, such as which day.
- Before proposing a time, look at the schedule or call find_free_time; suggest one or two concrete options.
- For one-off meetings without a stated length, use 60 minutes. Default urgency is 3.
- After changing things, say in one line what you did. The app shows an undo button, so do not ask for confirmation of ordinary additions or moves.
- Ask before deleting anything the person did not name, and before changing more than three tasks at once.
- Never invent tasks, events or times that are not in the data.`;

export type AssistantTurn = { reply: string; summaries: string[]; undo: (() => void)[] };
export type AssistantError = 'no-key' | 'bad-key' | 'no-credit' | 'rate' | 'network' | 'refused' | 'other';

let history: Anthropic.Beta.BetaMessageParam[] = [];
/** Where the conversation stands now, to come back to when a message is edited. */
export const conversationMark = () => history.length;
/** Drops everything said from the mark on, so an edited message is asked again in its place. */
export const rewindConversation = (mark: number) => {
  history = history.slice(0, mark);
};
// A talk that goes on from a saved one carries its background in front of the first message.
let carry: string | null = null;
export const resetConversation = () => {
  history = [];
  carry = null;
};
/** Starts a talk that goes on from a saved one: nothing of it is sent until the next message. */
export const continueConversation = (background: string) => {
  history = [];
  carry = background;
};

/** A few lines on what an old talk was about, for carrying it on. Returns null if it could not be written. */
export async function summarizeChat(transcript: string): Promise<string | null> {
  const apiKey = await getApiKey();
  if (!apiKey || !transcript.trim()) return null;
  try {
    const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 1 });
    const r = await client.beta.messages.create({
      model: SUMMARY_MODEL,
      max_tokens: 400,
      system:
        'You summarize a talk between a person and their planning assistant, so the assistant can carry it on later. Write 3 to 5 short lines in Hebrew, plain text with no formatting: what was discussed, what was decided, what the assistant changed in the app, and what is still open. Keep names, days and times exactly as written.',
      messages: [{ role: 'user', content: transcript }],
    });
    const text = r.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map((b) => b.text).join('\n').trim();
    return text || null;
  } catch {
    return null;
  }
}

async function eventsFor(from: string, to: string): Promise<CalEvent[]> {
  try {
    if ((await calendarAccess()) !== 'granted') return [];
    return await eventsBetween(from, addDays(to, 1), getApp().data.meta.hiddenCalendars);
  } catch {
    return [];
  }
}

function contextLine() {
  const now = new Date();
  const days = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
  return `[עכשיו: יום ${days[now.getDay()]} ${toIso(now)} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}]`;
}

/** What the assistant remembers about the person, read fresh for every request so a new note counts at once. */
function memoryBlock() {
  const notes = getApp().data.notes;
  if (!notes.length) return 'Your memory of the person is empty so far.';
  return `Your memory of the person (note_id: text):\n${notes.map((n) => `- ${n.id}: ${n.text}`).join('\n')}`;
}

export class AssistantFailure extends Error {
  constructor(public kind: AssistantError, public detail = '') {
    super(kind);
  }
}

export async function ask(text: string): Promise<AssistantTurn> {
  const apiKey = await getApiKey();
  if (!apiKey) throw new AssistantFailure('no-key');
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 1 });
  const turn: AssistantTurn = { reply: '', summaries: [], undo: [] };
  const start = history.length;
  const lead = !history.length && carry ? `${carry}\n\n` : '';
  history.push({ role: 'user', content: [{ type: 'text', text: `${lead}${contextLine()}\n${text}` }] });

  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      const response = await client.beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        system: `${SYSTEM}\n\n${memoryBlock()}`,
        tools: TOOLS,
        messages: history,
      });
      // Thinking and tool blocks go back exactly as they came.
      history.push({ role: 'assistant', content: response.content as Anthropic.Beta.BetaContentBlockParam[] });

      if (response.stop_reason === 'refusal') throw new AssistantFailure('refused');
      const texts = response.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map((b) => b.text.trim()).filter(Boolean);
      if (texts.length) turn.reply = texts.join('\n\n');
      const calls = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
      if (response.stop_reason !== 'tool_use' || !calls.length) break;

      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const call of calls) {
        try {
          const input = call.input as Record<string, string>;
          const needsEvents = call.name === 'get_schedule' || call.name === 'find_free_time';
          const events = needsEvents ? await eventsFor(input.from_date, input.to_date) : [];
          const app = getApp();
          const r = runAction(call.name, { data: app.data, today: app.today, now: Date.now(), events }, call.input);
          if (r.change) turn.undo.push(applyAssistantChange(r.change));
          if (r.summary) turn.summaries.push(r.summary);
          results.push({ type: 'tool_result', tool_use_id: call.id, content: JSON.stringify(r.result) });
        } catch (e) {
          results.push({ type: 'tool_result', tool_use_id: call.id, is_error: true, content: isActionError(e) ? e.message : 'The action failed.' });
        }
      }
      history.push({ role: 'user', content: results });
    }
  } catch (e) {
    // Leave the conversation as it was before this message, so a retry starts clean.
    history = history.slice(0, start);
    if (e instanceof AssistantFailure) throw e;
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) throw new AssistantFailure('bad-key');
    if (e instanceof Anthropic.RateLimitError) throw new AssistantFailure('rate');
    if (e instanceof Anthropic.BadRequestError && /credit|billing|balance/i.test(e.message)) throw new AssistantFailure('no-credit');
    if (e instanceof Anthropic.APIConnectionError) throw new AssistantFailure('network');
    // Keep the API's own words, so an unexpected failure can be reported and fixed.
    const status = e instanceof Anthropic.APIError && e.status ? `${e.status} ` : '';
    throw new AssistantFailure('other', `${status}${e instanceof Error ? e.message : String(e)}`.slice(0, 300));
  }
  return turn;
}

/** A free check that the key is accepted. It reads the model list and costs nothing. */
export async function checkKey(apiKey: string): Promise<'ok' | AssistantError> {
  try {
    const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 0 });
    await client.models.retrieve(MODEL);
    return 'ok';
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return 'bad-key';
    if (e instanceof Anthropic.APIConnectionError) return 'network';
    return 'other';
  }
}

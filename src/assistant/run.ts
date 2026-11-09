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

const nullable = (type: string, description: string) => ({ type: [type, 'null'], description });
const TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: 'get_schedule',
    description: 'Read the days in a date range: tasks with time, length, urgency and topic, weekly timetable items, phone calendar events, plus tasks that have no day yet. Call this before planning or when unsure what exists.',
    strict: true,
    input_schema: {
      type: 'object', additionalProperties: false, required: ['from_date', 'to_date'],
      properties: { from_date: { type: 'string', description: 'YYYY-MM-DD' }, to_date: { type: 'string', description: 'YYYY-MM-DD, at most 62 days after from_date' } },
    },
  },
  {
    name: 'add_task',
    description: 'Add a one-off task or meeting. Leave date null to keep it in "my tasks" without a day. A start time needs a date.',
    strict: true,
    input_schema: {
      type: 'object', additionalProperties: false,
      required: ['title', 'date', 'start', 'duration_min', 'urgency', 'topic', 'reminder_min'],
      properties: {
        title: { type: 'string', description: 'Short Hebrew title' },
        date: nullable('string', 'YYYY-MM-DD, or null for no day'),
        start: nullable('string', 'HH:MM 24h, or null for no time'),
        duration_min: nullable('integer', 'Length in minutes for meetings and activities, or null'),
        urgency: nullable('integer', '1 (low) to 5 (urgent). Default 3'),
        topic: nullable('string', 'Topic name; an existing one if it fits, else a new one, or null'),
        reminder_min: nullable('integer', 'Minutes before the start to remind: 0, 10, 30 or 60; null for no reminder'),
      },
    },
  },
  {
    name: 'update_task',
    description: 'Change an existing task. Null fields stay as they are. remove_from_day moves it back to "my tasks"; clear_time keeps the day but drops the time.',
    strict: true,
    input_schema: {
      type: 'object', additionalProperties: false,
      required: ['task_id', 'title', 'date', 'remove_from_day', 'start', 'clear_time', 'duration_min', 'urgency', 'topic', 'reminder_min'],
      properties: {
        task_id: { type: 'string' },
        title: nullable('string', 'New title or null'),
        date: nullable('string', 'New YYYY-MM-DD or null'),
        remove_from_day: { type: 'boolean' },
        start: nullable('string', 'New HH:MM or null'),
        clear_time: { type: 'boolean' },
        duration_min: nullable('integer', 'New length in minutes or null'),
        urgency: nullable('integer', '1 to 5 or null'),
        topic: nullable('string', 'Topic name or null'),
        reminder_min: nullable('integer', 'Minutes before or null'),
      },
    },
  },
  {
    name: 'complete_task',
    description: 'Mark a task done (earns its urgency as points) or reopen it.',
    strict: true,
    input_schema: { type: 'object', additionalProperties: false, required: ['task_id', 'done'], properties: { task_id: { type: 'string' }, done: { type: 'boolean' } } },
  },
  {
    name: 'delete_task',
    description: 'Delete one task. Ask the person first unless they clearly asked for this exact deletion.',
    strict: true,
    input_schema: { type: 'object', additionalProperties: false, required: ['task_id'], properties: { task_id: { type: 'string' } } },
  },
  {
    name: 'add_weekly',
    description: 'Add a fixed weekly item to the timetable, such as a lecture or training. It appears on its weekdays every week and reminds.',
    strict: true,
    input_schema: {
      type: 'object', additionalProperties: false,
      required: ['title', 'weekdays', 'start', 'end', 'place', 'urgency', 'topic', 'reminder_min'],
      properties: {
        title: { type: 'string' },
        weekdays: { type: 'array', items: { type: 'integer' }, description: '0 Sunday ... 6 Saturday' },
        start: { type: 'string', description: 'HH:MM' },
        end: nullable('string', 'HH:MM after start, or null'),
        place: nullable('string', 'Place or null'),
        urgency: nullable('integer', '1 to 5'),
        topic: nullable('string', 'Topic name or null'),
        reminder_min: nullable('integer', 'Minutes before; default 10'),
      },
    },
  },
  {
    name: 'find_free_time',
    description: 'Find free windows of at least duration_min minutes between tasks, timetable items and calendar events. Use it before suggesting a time.',
    strict: true,
    input_schema: {
      type: 'object', additionalProperties: false, required: ['from_date', 'to_date', 'duration_min', 'earliest', 'latest'],
      properties: {
        from_date: { type: 'string' }, to_date: { type: 'string' }, duration_min: { type: 'integer' },
        earliest: nullable('string', 'HH:MM, default 08:00'), latest: nullable('string', 'HH:MM, default 22:00'),
      },
    },
  },
];

const SYSTEM = `You are the planning assistant inside "עוזר אישי" (Personal Assistant), a personal Hebrew day planner on the person's phone.
You can read their schedule and change it with the tools. Reply in short, natural Hebrew.

How the app works:
- Tasks belong to a day or wait in "my tasks" (המשימות שלי) without a day. Each has urgency 1-5, which is also the points it earns when done.
- Timed tasks can have a length; when their time ends they complete themselves. Weekly items form the timetable (מערכת שעות).
- Topics (נושאים) group tasks, for example תואר, עבודה, ספורט.
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
export const resetConversation = () => {
  history = [];
};

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

export class AssistantFailure extends Error {
  constructor(public kind: AssistantError) {
    super(kind);
  }
}

export async function ask(text: string): Promise<AssistantTurn> {
  const apiKey = await getApiKey();
  if (!apiKey) throw new AssistantFailure('no-key');
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 1 });
  const turn: AssistantTurn = { reply: '', summaries: [], undo: [] };
  const start = history.length;
  history.push({ role: 'user', content: [{ type: 'text', text: `${contextLine()}\n${text}` }] });

  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      const response = await client.beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        cache_control: { type: 'ephemeral' },
        system: SYSTEM,
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
    throw new AssistantFailure('other');
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

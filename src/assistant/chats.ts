// The last few talks with the assistant, kept on the phone as plain text so one can be read again or carried on.
// Only the words are kept, never the tool calls, and only a short part is sent to Claude when a talk goes on.

export type ChatLine = { from: 'me' | 'bot'; text: string };
/** `summary` covers lines[0, summaryUpto); the lines after it are sent as they are. */
export type SavedChat = { id: string; title: string; updatedAt: number; lines: ChatLine[]; summary: string | null; summaryUpto: number };

export const MAX_CHATS = 5;
export const MAX_LINES = 40;
/** A talk this short is sent whole, with no summary. */
export const SHORT = 8;
/** The last lines that go along word for word with a summary. */
export const RECENT = 6;
/** A summary is written again only after this many new lines. */
const STALE = 12;
const LINE_CHARS = 1500;

export const chatTitle = (lines: ChatLine[]) =>
  (lines.find((l) => l.from === 'me')?.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);

/** A talk as it is saved: the newest lines only, and a title from its first question. */
export function toSaved(id: string, lines: ChatLine[], now: number, prev?: SavedChat): SavedChat {
  const cut = Math.max(0, lines.length - MAX_LINES);
  const kept = lines.slice(cut);
  // Lines that fall off the start take the summary's place with them.
  const upto = prev ? Math.max(0, prev.summaryUpto - cut) : 0;
  return { id, title: prev?.title || chatTitle(kept), updatedAt: now, lines: kept, summary: prev?.summary ?? null, summaryUpto: upto };
}

/** The newest talks to keep, and the ids of the rest to remove. */
export function keepChats(all: SavedChat[]): { keep: SavedChat[]; drop: string[] } {
  const sorted = [...all].sort((a, b) => b.updatedAt - a.updatedAt);
  return { keep: sorted.slice(0, MAX_CHATS), drop: sorted.slice(MAX_CHATS).map((c) => c.id) };
}

/** A long talk needs a summary before it goes on, and again once much has been said since the last one. */
export const needsSummary = (c: SavedChat) =>
  c.lines.length > SHORT && (!c.summary || c.lines.length - c.summaryUpto > STALE);

const asText = (lines: ChatLine[]) =>
  lines.map((l) => `${l.from === 'me' ? 'אני' : 'העוזר'}: ${l.text.trim().slice(0, LINE_CHARS)}`).join('\n');

/** What the cheap model reads to write the summary: everything but the last few lines, which go along as they are. */
export const summarySource = (c: SavedChat) => asText(c.lines.slice(0, Math.max(0, c.lines.length - RECENT)));
export const summaryUptoFor = (c: SavedChat) => Math.max(0, c.lines.length - RECENT);

/** The background put before the first new message of a talk that goes on. */
export function carryText(c: SavedChat): string {
  const date = new Date(c.updatedAt);
  const when = `${date.getDate()}.${date.getMonth() + 1}`;
  const head = `[ממשיכים שיחה קודמת מ-${when}. זה רקע בלבד, לא בקשה חדשה.]`;
  if (c.lines.length <= SHORT || !c.summary) {
    const lines = c.lines.length <= SHORT ? c.lines : c.lines.slice(-SHORT);
    return `${head}\n${asText(lines)}\n[סוף השיחה הקודמת]`;
  }
  return `${head}\nסיכום: ${c.summary.trim()}\nההודעות האחרונות:\n${asText(c.lines.slice(c.summaryUpto))}\n[סוף השיחה הקודמת]`;
}

import { describe, expect, it } from 'vitest';
import { MAX_CHATS, MAX_LINES, carryText, keepChats, needsSummary, summarySource, summaryUptoFor, toSaved, type ChatLine, type SavedChat } from './chats';

const talk = (n: number): ChatLine[] => Array.from({ length: n }, (_, i) => ({ from: i % 2 ? 'bot' : 'me', text: `שורה ${i}` }));

describe('saved chats', () => {
  it('keeps only the five newest talks', () => {
    const all = Array.from({ length: 7 }, (_, i) => toSaved(`c${i}`, talk(2), 1000 + i));
    const { keep, drop } = keepChats(all);
    expect(keep).toHaveLength(MAX_CHATS);
    expect(keep[0].id).toBe('c6');
    expect(drop.sort()).toEqual(['c0', 'c1']);
  });

  it('keeps a long talk to its last lines, with the title from the first question', () => {
    const c = toSaved('a', talk(50), 1);
    expect(c.lines).toHaveLength(MAX_LINES);
    expect(c.lines[0].text).toBe('שורה 10');
    const again = toSaved('a', [{ from: 'me', text: 'מה  נשאר\nהיום?' }], 1);
    expect(again.title).toBe('מה נשאר היום?');
  });

  it('sends a short talk whole and needs no summary', () => {
    const c = toSaved('a', talk(6), new Date(2026, 10, 12).getTime());
    expect(needsSummary(c)).toBe(false);
    const text = carryText(c);
    expect(text).toContain('12.11');
    expect(text).toContain('אני: שורה 0');
    expect(text).toContain('העוזר: שורה 5');
  });

  it('a long talk is summarized once, and the summary goes with the last lines only', () => {
    let c: SavedChat = toSaved('a', talk(20), 1);
    expect(needsSummary(c)).toBe(true);
    expect(summarySource(c)).toContain('שורה 13');
    expect(summarySource(c)).not.toContain('שורה 14');
    c = { ...c, summary: 'סידרנו את יום חמישי', summaryUpto: summaryUptoFor(c) };
    expect(needsSummary(c)).toBe(false);
    const text = carryText(c);
    expect(text).toContain('סיכום: סידרנו את יום חמישי');
    expect(text).toContain('שורה 14');
    expect(text).not.toContain('שורה 13');
    // Much said since: a fresh summary is due.
    c = toSaved('a', talk(34), 2, c);
    expect(needsSummary(c)).toBe(true);
  });

  it('moves the summary mark when old lines fall off the start', () => {
    const c: SavedChat = { ...toSaved('a', talk(40), 1), summary: 'x', summaryUpto: 30 };
    const next = toSaved('a', talk(44), 2, c);
    expect(next.summaryUpto).toBe(26);
  });
});

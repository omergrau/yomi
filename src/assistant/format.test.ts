import { describe, expect, it } from 'vitest';
import { inline, parse, plain } from './format';

describe('assistant reply formatting', () => {
  it('reads bold, italics and code inside a line', () => {
    expect(inline('ב-**09:00** יש *הרצאה* ב-`34`')).toEqual([
      { text: 'ב-' }, { text: '09:00', bold: true }, { text: ' יש ' }, { text: 'הרצאה', italic: true }, { text: ' ב-' }, { text: '34', code: true },
    ]);
  });
  it('leaves a lone or spaced asterisk as it is', () => {
    expect(inline('5 * 3 = 15 *')).toEqual([{ text: '5 * 3 = 15 *' }]);
    expect(inline('כוכבית* באמצע')).toEqual([{ text: 'כוכבית* באמצע' }]);
  });
  it('reads headings, lists, dividers and paragraphs', () => {
    const b = parse('## יום ראשון\n- **09:00** הרצאה\n  - בניין 34\n1. לקום\n\n---\nזהו.');
    expect(b.map((x) => x.kind)).toEqual(['heading', 'bullet', 'bullet', 'number', 'gap', 'rule', 'para']);
    expect(b[0]).toMatchObject({ level: 2, spans: [{ text: 'יום ראשון' }] });
    expect(b[2]).toMatchObject({ depth: 1 });
    expect(b[3]).toMatchObject({ n: '1' });
  });
  it('gives screen readers the text without marks', () => {
    expect(plain('## היום\n- **09:00** הרצאה')).toBe('היום\n• 09:00 הרצאה');
  });
});

describe('time ranges in Hebrew', () => {
  it('keeps 10:00–12:00 in order', () => {
    expect(inline('הרצאה 10:00–12:00 בבניין')[0].text).toBe('הרצאה \u206610:00–12:00\u2069 בבניין');
    expect(plain('הרצאה **10:00–12:00**')).toBe('הרצאה 10:00–12:00');
  });
});

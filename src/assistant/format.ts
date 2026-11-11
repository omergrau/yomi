// Reads the light Markdown the assistant writes: headings, bold, italics, code, bullet and numbered lists and a
// divider. Anything else is kept as plain text, and a lone asterisk is shown as it is.

export type Span = { text: string; bold?: boolean; italic?: boolean; code?: boolean };
export type Block =
  | { kind: 'heading'; level: 1 | 2 | 3; spans: Span[] }
  | { kind: 'para'; spans: Span[] }
  | { kind: 'bullet'; depth: number; spans: Span[] }
  | { kind: 'number'; n: string; depth: number; spans: Span[] }
  | { kind: 'quote'; spans: Span[] }
  | { kind: 'rule' }
  | { kind: 'gap' };

// Simple patterns only, so the phone's JavaScript engine reads them the same way. Underscores are left alone.
const INLINE = /(\*\*[^*\n]+?\*\*|`[^`\n]+`|\*[^*\s](?:[^*\n]*[^*\s])?\*)/;

/** A range such as 10:00–12:00 is kept left to right, so Hebrew around it does not turn it around. */
export const keepRanges = (text: string) => text.replace(/\d{1,2}(?::\d{2})?\s?[–—-]\s?\d{1,2}(?::\d{2})?/g, (m) => `\u2066${m}\u2069`);

export const inline = (text: string) => spansOf(keepRanges(text));

function spansOf(text: string): Span[] {
  const out: Span[] = [];
  const parts = text.split(new RegExp(INLINE.source, 'g'));
  for (const p of parts) {
    if (!p) continue;
    if (p.startsWith('**') && p.endsWith('**') && p.length > 4) {
      // Bold may hold italics inside it.
      for (const s of spansOf(p.slice(2, -2))) out.push({ ...s, bold: true });
    } else if (p.startsWith('`') && p.endsWith('`') && p.length > 2) out.push({ text: p.slice(1, -1), code: true });
    else if (/^\*[^*\s]/.test(p) && p.endsWith('*') && p.length > 2) out.push({ text: p.slice(1, -1), italic: true });
    else out.push({ text: p });
  }
  // Neighbours with the same look are joined.
  return out.reduce<Span[]>((acc, s) => {
    const last = acc[acc.length - 1];
    if (last && !!last.bold === !!s.bold && !!last.italic === !!s.italic && !!last.code === !!s.code) last.text += s.text;
    else acc.push({ ...s });
    return acc;
  }, []);
}

export function parse(md: string): Block[] {
  const blocks: Block[] = [];
  const gap = () => {
    if (blocks.length && blocks[blocks.length - 1].kind !== 'gap') blocks.push({ kind: 'gap' });
  };
  for (const raw of md.replace(/\r/g, '').split('\n')) {
    const indent = raw.match(/^\s*/)![0].length;
    const line = raw.trim();
    let m: RegExpMatchArray | null;
    if (!line) gap();
    else if ((m = line.match(/^(#{1,6})\s+(.*)$/))) blocks.push({ kind: 'heading', level: Math.min(3, m[1].length) as 1 | 2 | 3, spans: inline(m[2].replace(/\s*#+$/, '')) });
    else if (/^([-*_])\s*(\1\s*){2,}$/.test(line)) blocks.push({ kind: 'rule' });
    else if ((m = line.match(/^[-*•+]\s+(.*)$/))) blocks.push({ kind: 'bullet', depth: indent >= 2 ? 1 : 0, spans: inline(m[1]) });
    else if ((m = line.match(/^(\d{1,3})[.)]\s+(.*)$/))) blocks.push({ kind: 'number', n: m[1], depth: indent >= 2 ? 1 : 0, spans: inline(m[2]) });
    else if ((m = line.match(/^>\s?(.*)$/))) blocks.push({ kind: 'quote', spans: inline(m[1]) });
    else blocks.push({ kind: 'para', spans: inline(line) });
  }
  while (blocks.length && blocks[blocks.length - 1].kind === 'gap') blocks.pop();
  while (blocks.length && blocks[0].kind === 'gap') blocks.shift();
  return blocks;
}

/** The text without its marks, for screen readers and copying. */
export const plain = (md: string) =>
  parse(md)
    .map((b) => (b.kind === 'gap' ? '' : b.kind === 'rule' ? '' : `${b.kind === 'bullet' ? '• ' : b.kind === 'number' ? `${b.n}. ` : ''}${b.spans.map((s) => s.text).join('')}`))
    .join('\n')
    .replace(/[\u2066\u2069]/g, '')
    .replace(/\n{3,}/g, '\n\n');

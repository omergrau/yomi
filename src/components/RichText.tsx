// The assistant's reply with its formatting: headings, bold, lists and short dividers, kept quiet like a chat.
import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { parse, plain, type Span } from '../assistant/format';
import { font, type Theme } from '../theme';

function Spans({ spans, t, base }: { spans: Span[]; t: Theme; base?: object }) {
  return (
    <>
      {spans.map((x, i) => (
        <Text
          key={i}
          style={[
            base,
            x.bold ? { fontFamily: font.bold } : null,
            x.italic ? { fontStyle: 'italic' } : null,
            x.code ? [s.code, { backgroundColor: t.paper, color: t.ink }] : null,
          ]}
        >
          {x.text}
        </Text>
      ))}
    </>
  );
}

export function RichText({ text, t, color }: { text: string; t: Theme; color: string }) {
  const blocks = useMemo(() => parse(text), [text]);
  const label = useMemo(() => plain(text), [text]);
  return (
    <View style={s.wrap} accessible accessibilityLabel={label}>
      {blocks.map((b, i) => {
        const first = i === 0;
        switch (b.kind) {
          case 'gap':
            return <View key={i} style={s.gap} />;
          case 'rule':
            return <View key={i} style={[s.rule, { backgroundColor: t.line }]} />;
          case 'heading':
            return (
              <Text key={i} selectable style={[s.body, b.level === 1 ? s.h1 : b.level === 2 ? s.h2 : s.h3, { color }, first ? null : s.headTop]}>
                <Spans spans={b.spans} t={t} />
              </Text>
            );
          case 'bullet':
          case 'number':
            return (
              <View key={i} style={[s.item, b.depth ? s.nested : null]}>
                <Text style={[s.body, s.mark, { color: t.mute }]}>{b.kind === 'bullet' ? (b.depth ? '◦' : '•') : `${b.n}.`}</Text>
                <Text selectable style={[s.body, s.itemT, { color }]}>
                  <Spans spans={b.spans} t={t} />
                </Text>
              </View>
            );
          case 'quote':
            return (
              <Text key={i} selectable style={[s.body, s.quote, { color: t.mute, borderStartColor: t.line }]}>
                <Spans spans={b.spans} t={t} />
              </Text>
            );
          default:
            return (
              <Text key={i} selectable style={[s.body, { color }]}>
                <Spans spans={b.spans} t={t} />
              </Text>
            );
        }
      })}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: 2 },
  body: { fontFamily: font.regular, fontSize: 15, lineHeight: 22 },
  h1: { fontFamily: font.bold, fontSize: 17.5, lineHeight: 24 },
  h2: { fontFamily: font.bold, fontSize: 16.5, lineHeight: 23 },
  h3: { fontFamily: font.semibold, fontSize: 15.5, lineHeight: 22 },
  headTop: { marginTop: 4 },
  gap: { height: 6 },
  rule: { height: StyleSheet.hairlineWidth, marginVertical: 8 },
  item: { flexDirection: 'row', gap: 6 },
  nested: { paddingStart: 16 },
  mark: { minWidth: 12 },
  itemT: { flex: 1 },
  quote: { borderStartWidth: 3, paddingStart: 9 },
  code: { fontFamily: font.medium, borderRadius: 4, fontSize: 14 },
});

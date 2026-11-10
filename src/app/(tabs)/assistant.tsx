// A chat with the planning assistant. What it changes shows at once in the app, with one undo per reply.
import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import Animated, { useAnimatedKeyboard, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { getApiKey } from '../../assistant/key';
import { AssistantFailure, ask, conversationMark, resetConversation, rewindConversation } from '../../assistant/run';
import { t as tr } from '../../i18n';
import { showToast } from '../../store';
import { font, useTheme } from '../../theme';

// `mark` is where the conversation stood before a message of mine, so it can be edited and asked again.
type Bubble = { id: number; from: 'me' | 'bot'; text: string; mark?: number; summaries?: string[]; undo?: (() => void)[]; undone?: boolean; error?: boolean };

let saved: Bubble[] = [];
let nextId = 1;

export default function AssistantScreen() {
  const t = useTheme();
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [bubbles, setBubbles] = useState<Bubble[]>(saved);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Bubble | null>(null);
  const input = useRef<any>(null);
  const scroll = useRef<any>(null);
  // Lift the text box by exactly the part of the keyboard that covers this screen.
  // The screen ends above the tab bar and the phone's own buttons, so that gap is measured and taken off.
  const keyboard = useAnimatedKeyboard();
  const gap = useSharedValue(0);
  const root = useRef<any>(null);
  const { height: windowH } = useWindowDimensions();
  const measure = () => root.current?.measureInWindow((_x: number, y: number, _w: number, h: number) => {
    if (h > 0) gap.value = Math.max(0, windowH - (y + h));
  });
  const lift = useAnimatedStyle(() => ({ paddingBottom: Math.max(0, keyboard.height.value - gap.value) }));

  useFocusEffect(
    useCallback(() => {
      getApiKey().then((k) => setHasKey(!!k));
    }, []),
  );

  const update = (b: Bubble[]) => {
    saved = b;
    setBubbles(b);
    setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 50);
  };

  const send = async (value?: string) => {
    const message = (value ?? text).trim();
    if (!message || busy) return;
    setText('');
    let base = saved;
    if (editing) {
      // Asking again from an earlier message: take back what the replies since then changed, and forget them.
      const at = saved.findIndex((b) => b.id === editing.id);
      if (at >= 0) {
        saved
          .slice(at + 1)
          .filter((b) => b.undo?.length && !b.undone)
          .reverse()
          .forEach((b) => [...(b.undo ?? [])].reverse().forEach((u) => u()));
        rewindConversation(editing.mark ?? 0);
        base = saved.slice(0, at);
      }
      setEditing(null);
    }
    const mine: Bubble = { id: nextId++, from: 'me', text: message, mark: conversationMark() };
    let list = [...base, mine];
    update(list);
    setBusy(true);
    try {
      const r = await ask(message);
      list = [...list, { id: nextId++, from: 'bot', text: r.reply || tr.aiDoneNoText, summaries: r.summaries, undo: r.undo }];
    } catch (e) {
      const kind = e instanceof AssistantFailure ? e.kind : 'other';
      const detail = e instanceof AssistantFailure ? e.detail : e instanceof Error ? e.message : '';
      list = [...list, { id: nextId++, from: 'bot', text: detail ? `${tr.aiError[kind]}\n(${detail})` : tr.aiError[kind], error: true }];
      if (kind === 'no-key' || kind === 'bad-key') setHasKey(kind === 'bad-key');
    }
    update(list);
    setBusy(false);
  };

  const startEdit = (b: Bubble) => {
    if (busy) return;
    setEditing(b);
    setText(b.text);
    setTimeout(() => input.current?.focus(), 50);
  };

  const cancelEdit = () => {
    setEditing(null);
    setText('');
  };

  const lastMine = [...bubbles].reverse().find((b) => b.from === 'me')?.id;
  const editUndoes = editing ? bubbles.slice(bubbles.findIndex((b) => b.id === editing.id) + 1).some((b) => b.undo?.length && !b.undone) : false;

  const undo = (b: Bubble) => {
    [...(b.undo ?? [])].reverse().forEach((u) => u());
    update(saved.map((x) => (x.id === b.id ? { ...x, undone: true } : x)));
    showToast(tr.aiUndone);
  };

  if (hasKey === false) {
    return (
      <View style={[s.flex, s.center, { backgroundColor: t.paper }]}>
        <Text style={[s.h1, { color: t.ink }]}>{tr.aiTitle}</Text>
        <Text style={[s.lead, { color: t.mute }]}>{tr.aiNeedKey}</Text>
        <Pressable onPress={() => router.push('/settings')} style={[s.cta, { backgroundColor: t.accent }]} accessibilityRole="button">
          <Text style={[s.ctaT, { color: t.onAccent }]}>{tr.aiToSettings}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <Animated.View ref={root as never} onLayout={measure} style={[s.flex, { backgroundColor: t.paper }, lift]}>
      <View style={s.head}>
        <Text style={[s.h1, { color: t.ink }]}>{tr.aiTitle}</Text>
        {bubbles.length ? (
          <Pressable
            onPress={() => {
              resetConversation();
              setEditing(null);
              update([]);
            }}
            hitSlop={8}
            accessibilityRole="button"
          >
            <Text style={[s.small, { color: t.mute }]}>{tr.aiNew}</Text>
          </Pressable>
        ) : null}
      </View>
      <ScrollView ref={scroll} style={s.flex} contentContainerStyle={s.list} keyboardShouldPersistTaps="handled">
        {!bubbles.length ? (
          <View style={s.empty}>
            <Text style={[s.lead, { color: t.mute }]}>{tr.aiIntro}</Text>
            {tr.aiExamples.map((x) => (
              <Pressable key={x} onPress={() => send(x)} style={[s.example, { backgroundColor: t.wash }]} accessibilityRole="button">
                <Text style={[s.exampleT, { color: t.ink }]}>{x}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        {bubbles.map((b) => (
          <React.Fragment key={b.id}>
          <Pressable
            onLongPress={b.from === 'me' ? () => startEdit(b) : undefined}
            disabled={b.from !== 'me'}
            style={[s.bubble, b.from === 'me' ? [s.me, { backgroundColor: t.accent, opacity: editing?.id === b.id ? 0.55 : 1 }] : [s.bot, { backgroundColor: t.wash }]]}
          >
            <Text style={[s.bubbleT, { color: b.from === 'me' ? t.onAccent : b.error ? t.mute : t.ink }]} selectable={b.from !== 'me'}>{b.text}</Text>
            {b.summaries?.length ? (
              <View style={[s.changes, { borderTopColor: t.line }]}>
                {b.summaries.map((x, i) => (
                  <Text key={i} style={[s.change, { color: b.undone ? t.soft : t.mute, textDecorationLine: b.undone ? 'line-through' : 'none' }]}>{`✓ ${x}`}</Text>
                ))}
                {b.undo?.length && !b.undone ? (
                  <Pressable onPress={() => undo(b)} hitSlop={8} accessibilityRole="button">
                    <Text style={[s.undo, { color: t.accent }]}>{tr.undo}</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
          </Pressable>
          {b.id === lastMine && !busy && !editing ? (
            <Pressable onPress={() => startEdit(b)} hitSlop={8} style={s.editLink} accessibilityRole="button" accessibilityLabel={tr.aiEditing}>
              <Text style={[s.small, { color: t.mute }]}>{`✎ ${tr.aiEdit}`}</Text>
            </Pressable>
          ) : null}
          </React.Fragment>
        ))}
        {busy ? (
          <View style={[s.bubble, s.bot, s.thinking, { backgroundColor: t.wash }]}>
            <ActivityIndicator size="small" color={t.accent} />
            <Text style={[s.bubbleT, { color: t.mute }]}>{tr.aiThinking}</Text>
          </View>
        ) : null}
      </ScrollView>
      {editing ? (
        <View style={[s.editBar, { borderTopColor: t.line }]}>
          <View style={s.flex}>
            <Text style={[s.editT, { color: t.ink }]}>{`✎ ${tr.aiEditing}`}</Text>
            {editUndoes ? <Text style={[s.editNote, { color: t.mute }]}>{tr.aiEditNote}</Text> : null}
          </View>
          <Pressable onPress={cancelEdit} hitSlop={8} accessibilityRole="button">
            <Text style={[s.small, { color: t.accent }]}>{tr.aiEditCancel}</Text>
          </Pressable>
        </View>
      ) : null}
      <View style={[s.inputRow, { borderTopColor: t.line }]}>
        <TextInput
          ref={input}
          value={text}
          onChangeText={setText}
          // Enter starts a new line; the arrow button sends.
          submitBehavior="newline"
          placeholder={tr.aiPlaceholder}
          placeholderTextColor={t.soft}
          multiline
          maxLength={1000}
          onFocus={() => setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 300)}
          style={[s.input, { color: t.ink, backgroundColor: t.wash }]}
          accessibilityLabel={tr.aiPlaceholder}
        />
        <Pressable
          onPress={() => send()}
          disabled={!text.trim() || busy}
          style={[s.send, { backgroundColor: text.trim() && !busy ? t.accent : t.wash }]}
          accessibilityRole="button"
          accessibilityLabel={tr.aiSend}
        >
          <Text style={[s.sendT, { color: text.trim() && !busy ? t.onAccent : t.soft }]}>↑</Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center', padding: 28, gap: 12 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 18, paddingTop: 16, paddingBottom: 6 },
  h1: { fontFamily: font.serif, fontSize: 26 },
  small: { fontFamily: font.regular, fontSize: 14 },
  lead: { fontFamily: font.regular, fontSize: 15, lineHeight: 21, textAlign: 'center' },
  cta: { borderRadius: 12, paddingHorizontal: 18, paddingVertical: 11 },
  ctaT: { fontFamily: font.bold, fontSize: 15 },
  list: { paddingHorizontal: 14, paddingBottom: 16, gap: 8 },
  empty: { gap: 8, paddingTop: 12 },
  example: { borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10 },
  exampleT: { fontFamily: font.regular, fontSize: 14.5 },
  bubble: { maxWidth: '86%', borderRadius: 16, paddingHorizontal: 13, paddingVertical: 9 },
  me: { alignSelf: 'flex-start', borderBottomStartRadius: 4 },
  bot: { alignSelf: 'flex-end', borderBottomEndRadius: 4 },
  thinking: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  bubbleT: { fontFamily: font.regular, fontSize: 15, lineHeight: 21 },
  changes: { borderTopWidth: 1, marginTop: 8, paddingTop: 6, gap: 3 },
  change: { fontFamily: font.medium, fontSize: 13 },
  editLink: { alignSelf: 'flex-start', marginTop: -3, paddingHorizontal: 4 },
  editBar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 7, borderTopWidth: 1 },
  editT: { fontFamily: font.semibold, fontSize: 13.5 },
  editNote: { fontFamily: font.regular, fontSize: 12, marginTop: 1 },
  undo: { fontFamily: font.bold, fontSize: 13.5, marginTop: 2 },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderTopWidth: 1 },
  input: { flex: 1, maxHeight: 120, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 9, fontFamily: font.regular, fontSize: 15.5 },
  send: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  sendT: { fontFamily: font.bold, fontSize: 19, lineHeight: 22 },
});

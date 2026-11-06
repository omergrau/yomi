import { router } from 'expo-router';
import React, { useState } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { t as tr } from '../../i18n';
import { addList, useApp } from '../../store';
import { font, useTheme } from '../../theme';

export default function ListsScreen() {
  const t = useTheme();
  const { data } = useApp();
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');

  const create = () => {
    const clean = title.trim();
    setTitle('');
    setAdding(false);
    if (!clean) return;
    const id = addList(clean);
    router.push(`/list/${id}`);
  };

  return (
    <KeyboardAvoidingView behavior="padding" style={[s.flex, { backgroundColor: t.paper }]}>
      <ScrollView style={s.flex} contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">
        <View style={s.head}>
          <Text style={[s.h1, { color: t.ink }]}>{tr.listsTitle}</Text>
          {!adding ? (
            <Pressable onPress={() => setAdding(true)} hitSlop={8} accessibilityRole="button">
              <Text style={[s.action, { color: t.accent }]}>{tr.listNew}</Text>
            </Pressable>
          ) : null}
        </View>

        {adding ? (
          <View style={[s.card, s.inputRow, { backgroundColor: t.wash }]}>
            <TextInput
              value={title}
              onChangeText={setTitle}
              onSubmitEditing={create}
              autoFocus
              maxLength={60}
              placeholder={tr.listNamePh}
              placeholderTextColor={t.soft}
              style={[s.input, { color: t.ink }]}
              accessibilityLabel={tr.listNamePh}
            />
            <Pressable onPress={create} hitSlop={8} accessibilityRole="button">
              <Text style={[s.action, { color: title.trim() ? t.accent : t.mute }]}>{title.trim() ? tr.create : tr.cancel}</Text>
            </Pressable>
          </View>
        ) : null}

        {!data.lists.length && !adding ? <Text style={[s.empty, { color: t.mute }]}>{tr.listsEmpty}</Text> : null}

        {data.lists.map((l) => {
          const done = l.items.filter((x) => x.done).length;
          const pct = l.items.length ? (done / l.items.length) * 100 : 0;
          return (
            <Pressable key={l.id} style={[s.card, { backgroundColor: t.wash }]} onPress={() => router.push(`/list/${l.id}`)} accessibilityRole="button" accessibilityLabel={l.title}>
              <View style={s.row}>
                <Text style={[s.name, { color: t.ink }]} numberOfLines={1}>{l.title}</Text>
                <Text style={[s.count, { color: t.mute }]}>{l.items.length ? `${done}/${l.items.length}` : tr.listNoItems}</Text>
              </View>
              {l.items.length ? (
                <View style={[s.track, { backgroundColor: t.line }]}>
                  <View style={[s.fill, { width: `${pct}%`, backgroundColor: t.accent }]} />
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  page: { paddingHorizontal: 16, paddingTop: 18, paddingBottom: 40, gap: 8 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, paddingHorizontal: 2 },
  h1: { fontFamily: font.serif, fontSize: 28, lineHeight: 36 },
  action: { fontFamily: font.semibold, fontSize: 14.5 },
  card: { borderRadius: 14, paddingHorizontal: 14, paddingVertical: 14 },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 8 },
  input: { flex: 1, fontFamily: font.semibold, fontSize: 16.5, paddingVertical: 6 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  name: { flexShrink: 1, fontFamily: font.semibold, fontSize: 16.5 },
  count: { fontFamily: font.regular, fontSize: 13.5, fontVariant: ['tabular-nums', 'lining-nums'] },
  track: { height: 4, borderRadius: 2, overflow: 'hidden', marginTop: 10 },
  fill: { height: '100%' },
  empty: { fontFamily: font.regular, fontSize: 15.5, lineHeight: 22, paddingHorizontal: 2, paddingVertical: 12 },
});

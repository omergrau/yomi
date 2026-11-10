// What the assistant remembers about the person. Each note can be edited in place or removed.
import { router } from 'expo-router';
import React, { useState } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { NOTE_MAX } from '../domain/logic';
import type { Note } from '../domain/types';
import { t as tr } from '../i18n';
import { addNote, editNote, removeNote, useApp } from '../store';
import { font, useTheme } from '../theme';

function NoteRow({ note }: { note: Note }) {
  const t = useTheme();
  const [text, setText] = useState(note.text);
  return (
    <View style={[s.item, { borderBottomColor: t.line }]}>
      <TextInput
        value={text}
        onChangeText={setText}
        onEndEditing={() => (text.trim() ? text.trim() !== note.text && editNote(note.id, text) : setText(note.text))}
        multiline
        maxLength={NOTE_MAX}
        style={[s.itemT, { color: t.ink }]}
        accessibilityLabel={note.text}
      />
      <Pressable onPress={() => removeNote(note.id)} hitSlop={10} accessibilityRole="button" accessibilityLabel={`${tr.remove}: ${note.text}`}>
        <Text style={[s.remove, { color: t.soft }]}>×</Text>
      </Pressable>
    </View>
  );
}

export default function MemoryScreen() {
  const t = useTheme();
  const { data } = useApp();
  const [text, setText] = useState('');
  const submit = () => {
    addNote(text);
    setText('');
  };
  return (
    <KeyboardAvoidingView behavior="padding" style={[s.flex, { backgroundColor: t.paper }]}>
      <ScrollView style={s.flex} contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">
        <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button" style={s.back}>
          <Text style={[s.link, { color: t.mute }]}>{tr.back}</Text>
        </Pressable>
        <Text style={[s.title, { color: t.ink }]}>{tr.memoryTitle}</Text>
        <Text style={[s.lead, { color: t.mute }]}>{tr.memoryLead}</Text>
        <View style={[s.add, { backgroundColor: t.wash }]}>
          <Text style={[s.plus, { color: t.accent }]}>+</Text>
          <TextInput
            value={text}
            onChangeText={setText}
            onSubmitEditing={submit}
            submitBehavior="submit"
            returnKeyType="done"
            maxLength={NOTE_MAX}
            placeholder={tr.memoryAddPh}
            placeholderTextColor={t.mute}
            style={[s.addIn, { color: t.ink }]}
            accessibilityLabel={tr.memoryAddPh}
          />
        </View>
        {!data.notes.length ? <Text style={[s.none, { color: t.soft }]}>{tr.memoryEmpty}</Text> : null}
        {data.notes.map((n) => (
          <NoteRow key={`${n.id}-${n.text}`} note={n} />
        ))}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  page: { paddingHorizontal: 18, paddingTop: 14, paddingBottom: 40 },
  back: { alignSelf: 'flex-start' },
  link: { fontFamily: font.medium, fontSize: 14 },
  title: { fontFamily: font.serif, fontSize: 28, marginTop: 8 },
  lead: { fontFamily: font.regular, fontSize: 13.5, lineHeight: 19, marginTop: 4, marginBottom: 12 },
  add: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, borderRadius: 12, marginBottom: 6 },
  plus: { fontFamily: font.semibold, fontSize: 20, lineHeight: 24 },
  addIn: { flex: 1, fontFamily: font.regular, fontSize: 15.5, paddingVertical: 10 },
  none: { fontFamily: font.regular, fontSize: 14.5, lineHeight: 20, textAlign: 'center', marginTop: 24 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 1 },
  itemT: { flex: 1, fontFamily: font.regular, fontSize: 16, paddingVertical: 12 },
  remove: { fontFamily: font.regular, fontSize: 22, lineHeight: 26, paddingHorizontal: 4 },
});

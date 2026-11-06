// A plain checklist: a title and items to tick. It earns no points and belongs to no day.
import { router, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { ListItem } from '../../domain/types';
import { t as tr } from '../../i18n';
import { addListItem, clearListDone, removeList, removeListItem, renameList, toggleListItem, useApp } from '../../store';
import { font, useTheme } from '../../theme';

export default function ListScreen() {
  const t = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data } = useApp();
  const list = data.lists.find((l) => l.id === id);
  const [text, setText] = useState('');
  const [title, setTitle] = useState(list?.title ?? '');

  if (!list) return <View style={[s.flex, { backgroundColor: t.paper }]} />;

  const open = list.items.filter((x) => !x.done);
  const done = list.items.filter((x) => x.done);

  const submit = () => {
    addListItem(list.id, text);
    setText('');
  };
  const leave = () => {
    router.back();
    removeList(list.id);
  };
  const confirmDelete = () => {
    if (Platform.OS === 'web') {
      leave();
      return;
    }
    Alert.alert(tr.listDeleteTitle(list.title), undefined, [
      { text: tr.cancel, style: 'cancel' },
      { text: tr.remove, style: 'destructive', onPress: leave },
    ]);
  };

  const row = (item: ListItem) => (
    <View key={item.id} style={[s.item, { borderBottomColor: t.line }]}>
      <Pressable
        onPress={() => toggleListItem(list.id, item.id)}
        style={s.itemMain}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: item.done }}
        accessibilityLabel={item.text}
      >
        <View style={[s.check, { borderColor: item.done ? t.accent : t.soft, backgroundColor: item.done ? t.accent : 'transparent' }]}>
          {item.done ? <Text style={[s.tick, { color: t.onAccent }]}>✓</Text> : null}
        </View>
        <Text style={[s.itemT, { color: item.done ? t.soft : t.ink, textDecorationLine: item.done ? 'line-through' : 'none' }]}>{item.text}</Text>
      </Pressable>
      <Pressable onPress={() => removeListItem(list.id, item.id)} hitSlop={10} accessibilityRole="button" accessibilityLabel={`${tr.remove}: ${item.text}`}>
        <Text style={[s.remove, { color: t.soft }]}>×</Text>
      </Pressable>
    </View>
  );

  return (
    <KeyboardAvoidingView behavior="padding" style={[s.flex, { backgroundColor: t.paper }]}>
      <ScrollView style={s.flex} contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">
        <View style={s.top}>
          <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button">
            <Text style={[s.link, { color: t.mute }]}>{tr.back}</Text>
          </Pressable>
          <Pressable onPress={confirmDelete} hitSlop={10} accessibilityRole="button">
            <Text style={[s.link, { color: t.mute }]}>{tr.listDelete}</Text>
          </Pressable>
        </View>
        <TextInput
          value={title}
          onChangeText={setTitle}
          onEndEditing={() => (title.trim() ? renameList(list.id, title) : setTitle(list.title))}
          maxLength={60}
          style={[s.title, { color: t.ink }]}
          accessibilityLabel={tr.listNamePh}
        />
        <View style={[s.add, { backgroundColor: t.wash }]}>
          <Text style={[s.plus, { color: t.accent }]}>+</Text>
          <TextInput
            value={text}
            onChangeText={setText}
            onSubmitEditing={submit}
            submitBehavior="submit"
            returnKeyType="done"
            autoFocus={!list.items.length}
            maxLength={120}
            placeholder={tr.listItemPh}
            placeholderTextColor={t.mute}
            style={[s.addIn, { color: t.ink }]}
            accessibilityLabel={tr.listItemPh}
          />
        </View>
        {open.map(row)}
        {done.length ? (
          <View style={s.doneHead}>
            <Text style={[s.doneT, { color: t.mute }]}>{tr.listDone(done.length)}</Text>
            <Pressable onPress={() => clearListDone(list.id)} hitSlop={10} accessibilityRole="button">
              <Text style={[s.link, { color: t.mute }]}>{tr.listClear}</Text>
            </Pressable>
          </View>
        ) : null}
        {done.map(row)}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  page: { paddingHorizontal: 18, paddingTop: 14, paddingBottom: 40 },
  top: { flexDirection: 'row', justifyContent: 'space-between' },
  link: { fontFamily: font.medium, fontSize: 14 },
  title: { fontFamily: font.serif, fontSize: 28, paddingVertical: 8, marginTop: 4 },
  add: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, borderRadius: 12, marginTop: 6, marginBottom: 6 },
  plus: { fontFamily: font.semibold, fontSize: 20, lineHeight: 24 },
  addIn: { flex: 1, fontFamily: font.regular, fontSize: 15.5, paddingVertical: 8 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 1 },
  itemMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  check: { width: 26, height: 26, borderRadius: 13, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  tick: { fontFamily: font.bold, fontSize: 14, lineHeight: 18 },
  itemT: { flex: 1, fontFamily: font.regular, fontSize: 16 },
  remove: { fontFamily: font.regular, fontSize: 22, lineHeight: 26, paddingHorizontal: 4 },
  doneHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 18, paddingBottom: 4 },
  doneT: { fontFamily: font.semibold, fontSize: 13.5 },
});

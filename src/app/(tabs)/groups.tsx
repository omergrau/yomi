import React, { useEffect, useRef, useState } from 'react';
import { Alert, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Dot, Pips } from '../../components/ui';
import { alive, groupWeekPoints } from '../../domain/logic';
import { t as tr } from '../../i18n';
import { addGroup, dropOnDay, openSheet, removeGroup, renameGroup, showToast, useApp } from '../../store';
import { font, useTheme, type Theme } from '../../theme';

function Small({ label, strong, onPress, t }: { label: string; strong?: boolean; onPress: () => void; t: Theme }) {
  return (
    <Pressable onPress={onPress} hitSlop={8} accessibilityRole="button">
      <Text style={[s.small, { color: strong ? t.accent : t.mute, fontFamily: strong ? font.semibold : font.regular }]}>{label}</Text>
    </Pressable>
  );
}

export default function GroupsScreen() {
  const t = useTheme();
  const { data, today } = useApp();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const scroll = useRef<any>(null);
  const cardY = useRef<Record<string, number>>({});
  const focusId = useRef<string | null>(null);
  const tasks = alive(data);

  // Once the keyboard is up, the page moves so the field being typed in stays visible.
  useEffect(() => {
    const sub = Keyboard.addListener('keyboardDidShow', () => {
      const id = focusId.current;
      if (id && cardY.current[id] !== undefined) scroll.current?.scrollTo({ y: Math.max(0, cardY.current[id] - 12), animated: true });
    });
    return () => sub.remove();
  }, []);

  const create = () => {
    const clean = name.trim();
    if (clean) {
      const g = addGroup(clean);
      if (g) {
        setOpen(g.id);
        showToast(tr.groupCreated(g.name));
      }
    }
    setName('');
    setAdding(false);
  };

  const confirmDelete = (id: string, title: string) => {
    if (Platform.OS === 'web') {
      removeGroup(id);
      return;
    }
    Alert.alert(tr.groupDeleteTitle(title), tr.groupDeleteBody, [
      { text: tr.cancel, style: 'cancel' },
      { text: tr.remove, style: 'destructive', onPress: () => removeGroup(id) },
    ]);
  };

  const saveRename = () => {
    if (renaming) renameGroup(renaming.id, renaming.value);
    setRenaming(null);
    focusId.current = null;
  };

  return (
    <KeyboardAvoidingView behavior="padding" style={[s.flex, { backgroundColor: t.paper }]}>
      <ScrollView ref={scroll} style={s.flex} contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">
        <View style={s.head}>
          <Text style={[s.h1, { color: t.ink }]}>{tr.groupsTitle}</Text>
          {!adding ? <Small label={tr.newGroupChip} strong onPress={() => setAdding(true)} t={t} /> : null}
        </View>

        {adding ? (
          <View style={[s.card, s.inputRow, { backgroundColor: t.wash }]}>
            <Dot />
            <TextInput
              value={name}
              onChangeText={setName}
              onSubmitEditing={create}
              autoFocus
              placeholder={tr.groupNew}
              placeholderTextColor={t.soft}
              maxLength={24}
              style={[s.input, { color: t.ink }]}
              accessibilityLabel={tr.groupNew}
            />
            <Small label={name.trim() ? tr.create : tr.cancel} strong={!!name.trim()} onPress={create} t={t} />
          </View>
        ) : null}

        {data.groups.map((g) => {
          const mine = tasks.filter((x) => x.groupId === g.id && !x.doneAt).sort((a, b) => ((a.date ?? '9') < (b.date ?? '9') ? -1 : 1));
          const isOpen = open === g.id;
          const editing = renaming?.id === g.id;
          return (
            <View
              key={g.id}
              style={[s.card, isOpen || editing ? { backgroundColor: t.wash } : null]}
              onLayout={(e) => {
                cardY.current[g.id] = e.nativeEvent.layout.y;
              }}
            >
              {editing ? (
                <View style={s.inputRow}>
                  <Dot color={g.color} />
                  <TextInput
                    value={renaming.value}
                    onChangeText={(value) => setRenaming({ id: g.id, value })}
                    onSubmitEditing={saveRename}
                    autoFocus
                    maxLength={24}
                    style={[s.input, { color: t.ink }]}
                    accessibilityLabel={tr.rename}
                  />
                  <Small label={tr.save} strong onPress={saveRename} t={t} />
                </View>
              ) : (
                <Pressable style={s.cardHead} onPress={() => setOpen(isOpen ? null : g.id)} accessibilityRole="button" accessibilityState={{ expanded: isOpen }}>
                  <Dot color={g.color} />
                  <Text style={[s.name, { color: t.ink }]} numberOfLines={1}>{g.name}</Text>
                  <Text style={[s.sub, { color: t.soft }]} accessibilityLabel={tr.groupSummary(mine.length, groupWeekPoints(data, g.id, today))}>{mine.length || ''}</Text>
                </Pressable>
              )}
              {isOpen ? (
                <View style={s.body}>
                  {mine.map((x) => (
                    <View key={x.id} style={s.task}>
                      <Pressable style={s.flex} onPress={() => openSheet({ id: x.id })} accessibilityRole="button">
                        <Text style={[s.taskT, { color: t.ink }]}>{x.title}</Text>
                      </Pressable>
                      {!x.date ? <Small label={tr.toToday} strong onPress={() => dropOnDay(x.id, today)} t={t} /> : null}
                      <Pips points={x.points} />
                    </View>
                  ))}
                  <View style={s.tools}>
                    <Small label={tr.addTask} strong onPress={() => openSheet({ id: null, groupId: g.id, date: null })} t={t} />
                    <View style={s.toolLinks}>
                      <Small
                        label={tr.rename}
                        onPress={() => {
                          focusId.current = g.id;
                          setRenaming({ id: g.id, value: g.name });
                        }}
                        t={t}
                      />
                      <Small label={tr.remove} onPress={() => confirmDelete(g.id, g.name)} t={t} />
                    </View>
                  </View>
                </View>
              ) : null}
            </View>
          );
        })}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  page: { paddingHorizontal: 8, paddingTop: 18, paddingBottom: 40, gap: 2 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, paddingHorizontal: 12 },
  h1: { fontFamily: font.serif, fontSize: 28, lineHeight: 36 },
  small: { fontSize: 14.5 },
  card: { borderRadius: 14, paddingHorizontal: 12 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52 },
  name: { flexShrink: 1, fontFamily: font.medium, fontSize: 16.5 },
  sub: { marginStart: 'auto', fontFamily: font.regular, fontSize: 13.5, fontVariant: ['lining-nums'] },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 9, minHeight: 54 },
  input: { flex: 1, fontFamily: font.semibold, fontSize: 16.5, paddingVertical: 6 },
  body: { paddingBottom: 12, gap: 2 },
  task: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 7 },
  taskT: { fontFamily: font.regular, fontSize: 15 },
  tools: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 10, paddingTop: 8 },
  toolLinks: { flexDirection: 'row', gap: 16 },
});

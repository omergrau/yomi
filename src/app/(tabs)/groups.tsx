import React, { useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Dot, Pips, TextLink } from '../../components/ui';
import { alive, groupWeekPoints } from '../../domain/logic';
import { t as tr } from '../../i18n';
import { addGroup, dropOnDay, openSheet, removeGroup, renameGroup, showToast, useApp } from '../../store';
import { font, useTheme } from '../../theme';

export default function GroupsScreen() {
  const t = useTheme();
  const { data, today } = useApp();
  const [name, setName] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const tasks = alive(data);

  const create = () => {
    const clean = name.trim();
    if (!clean) return;
    const g = addGroup(clean);
    if (g) {
      setOpen(g.id);
      showToast(tr.groupCreated(g.name));
    }
    setName('');
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

  return (
    <ScrollView style={{ backgroundColor: t.paper }} contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">
      <Text style={[s.h1, { color: t.ink }]}>{tr.groupsTitle}</Text>
      <Text style={[s.lead, { color: t.mute }]}>{tr.groupsLead}</Text>
      <View style={[s.new, { borderColor: t.ink }]}>
        <TextInput
          value={name}
          onChangeText={setName}
          onSubmitEditing={create}
          placeholder={tr.groupNew}
          placeholderTextColor={t.soft}
          maxLength={24}
          style={[s.newIn, { color: t.ink }]}
          accessibilityLabel={tr.groupNew}
        />
        <Pressable style={[s.newBtn, { backgroundColor: t.ink }]} onPress={create} accessibilityRole="button">
          <Text style={[s.newT, { color: t.paper }]}>{tr.create}</Text>
        </Pressable>
      </View>

      {data.groups.map((g) => {
        const mine = tasks.filter((x) => x.groupId === g.id && !x.doneAt).sort((a, b) => (a.date ?? '9') < (b.date ?? '9') ? -1 : 1);
        const isOpen = open === g.id;
        return (
          <View key={g.id} style={[s.group, { borderTopColor: t.line }]}>
            <Pressable style={s.ghd} onPress={() => setOpen(isOpen ? null : g.id)} accessibilityRole="button" accessibilityState={{ expanded: isOpen }}>
              <View style={s.gname}>
                <Dot color={g.color} size={11} />
                <Text style={[s.gt, { color: t.ink }]}>{g.name}</Text>
              </View>
              <Text style={[s.gpts, { color: t.ink }]}>{`${groupWeekPoints(data, g.id, today)} ${tr.ptsThisWeek}`}</Text>
              <Text style={[s.gopen, { color: t.mute }]}>{tr.groupOpen(mine.length)}</Text>
            </Pressable>
            {isOpen ? (
              <View>
                {mine.map((x) => (
                  <View key={x.id} style={[s.task, { borderTopColor: t.wash }]}>
                    <Pressable style={s.taskName} onPress={() => openSheet({ id: x.id })} accessibilityRole="button">
                      <Text style={[s.taskT, { color: t.ink }]}>{x.title}</Text>
                    </Pressable>
                    <Pips points={x.points} />
                    {!x.date ? <TextLink label={tr.toToday} onPress={() => dropOnDay(x.id, today)} /> : null}
                  </View>
                ))}
                {renaming?.id === g.id ? (
                  <View style={[s.new, { borderColor: t.ink, marginTop: 10, marginBottom: 6 }]}>
                    <TextInput
                      value={renaming.value}
                      onChangeText={(value) => setRenaming({ id: g.id, value })}
                      autoFocus
                      maxLength={24}
                      style={[s.newIn, { color: t.ink }]}
                      accessibilityLabel={tr.rename}
                    />
                    <Pressable
                      style={[s.newBtn, { backgroundColor: t.ink }]}
                      onPress={() => {
                        renameGroup(g.id, renaming.value);
                        setRenaming(null);
                      }}
                    >
                      <Text style={[s.newT, { color: t.paper }]}>{tr.save}</Text>
                    </Pressable>
                  </View>
                ) : null}
                <View style={s.tools}>
                  <Pressable onPress={() => openSheet({ id: null, groupId: g.id, date: null })} accessibilityRole="button">
                    <Text style={[s.add, { color: t.ink }]}>{tr.addIn(g.name)}</Text>
                  </Pressable>
                  <View style={s.toolLinks}>
                    <TextLink label={tr.rename} onPress={() => setRenaming({ id: g.id, value: g.name })} />
                    <TextLink label={tr.remove} onPress={() => confirmDelete(g.id, g.name)} />
                  </View>
                </View>
              </View>
            ) : null}
          </View>
        );
      })}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  page: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 28 },
  h1: { fontFamily: font.black, fontSize: 38, lineHeight: 46 },
  lead: { fontFamily: font.regular, fontSize: 15.5, marginBottom: 14, marginTop: 2 },
  new: { flexDirection: 'row', borderWidth: 1.5, borderRadius: 10, overflow: 'hidden', marginBottom: 18 },
  newIn: { flex: 1, fontFamily: font.regular, fontSize: 16, paddingHorizontal: 12, paddingVertical: 10 },
  newBtn: { paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  newT: { fontFamily: font.bold, fontSize: 15 },
  group: { borderTopWidth: 1 },
  ghd: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'baseline', paddingVertical: 14, rowGap: 2 },
  gname: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  gt: { fontFamily: font.serif, fontSize: 27, lineHeight: 33 },
  gpts: { fontFamily: font.bold, fontSize: 15, fontVariant: ['tabular-nums', 'lining-nums'] },
  gopen: { width: '100%', fontFamily: font.regular, fontSize: 14, fontVariant: ['lining-nums'] },
  task: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, borderTopWidth: 1 },
  taskName: { flex: 1 },
  taskT: { fontFamily: font.medium, fontSize: 15.5 },
  tools: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 10, paddingTop: 10, paddingBottom: 16 },
  add: { fontFamily: font.semibold, fontSize: 15.5 },
  toolLinks: { flexDirection: 'row', gap: 16 },
});

import React, { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { addDays, weekday } from '../domain/dates';
import type { Points, Task, TaskEvent } from '../domain/types';
import { fmtDate, t as tr } from '../i18n';
import { ensureReminderPermission } from '../notifications';
import { hasNativePickers, pickDate, pickTime } from '../pickers';
import {
  addGroup, closeSheet, deleteTask, endSeries, moveToTomorrow, removeFromDay, saveForm, taskHistory, useApp, type TaskForm,
} from '../store';
import { font, useTheme, type Theme } from '../theme';
import { Btn, Chip, TextLink } from './ui';

const VALID_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const VALID_DATE = /^\d{4}-\d{2}-\d{2}$/;

function initial(task: Task | null, weekdays: number[] | null, preset: { groupId?: string | null; date?: string | null }, view: string, today: string): TaskForm {
  if (task) {
    return {
      title: task.title, groupId: task.groupId, points: task.points, date: task.date, time: task.time, reminderMin: task.reminderMin,
      repeat: !!task.recurringId, weekdays: weekdays ?? [],
    };
  }
  const date = preset.date !== undefined ? preset.date : view >= today ? view : today;
  return {
    title: '', groupId: preset.groupId ?? null, points: 3, date, time: null, reminderMin: null,
    repeat: false, weekdays: [weekday(date ?? today)],
  };
}

function Label({ children, t }: { children: string; t: Theme }) {
  return <Text style={[s.label, { color: t.mute }]}>{children}</Text>;
}

export function TaskSheet() {
  const { sheet } = useApp();
  if (!sheet) return null;
  return <SheetBody key={sheet.id ?? 'new'} />;
}

function SheetBody() {
  const { sheet, data, view, today } = useApp();
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const task = sheet?.id ? data.tasks[sheet.id] ?? null : null;
  const series = task?.recurringId ? data.recurring.find((r) => r.id === task.recurringId) ?? null : null;
  const [f, setF] = useState<TaskForm>(() => initial(task, series?.weekdays ?? null, sheet ?? {}, view, today));
  const [titleError, setTitleError] = useState(false);
  const [dayError, setDayError] = useState(false);
  const [newGroup, setNewGroup] = useState<string | null>(null);
  const [typedDate, setTypedDate] = useState('');
  const [history, setHistory] = useState<TaskEvent[] | null>(null);


  const up = (p: Partial<TaskForm>) => setF((x) => ({ ...x, ...p }));
  const tomorrow = addDays(today, 1);
  const other = f.date && f.date !== today && f.date !== tomorrow;

  const chooseDate = async () => {
    const picked = await pickDate(f.date, today);
    if (picked) up({ date: picked });
  };
  const chooseTime = async () => {
    const picked = await pickTime(f.time);
    if (picked) up({ time: picked, reminderMin: f.reminderMin ?? 0 });
  };

  const save = () => {
    if (!f.title.trim()) {
      setTitleError(true);
      return;
    }
    if (f.repeat && !f.weekdays.length) {
      setDayError(true);
      return;
    }
    if (f.reminderMin !== null && f.time) ensureReminderPermission().catch(() => {});
    saveForm(task?.id ?? null, f);
    closeSheet();
  };

  const placed = !!task?.date;
  return (
    <Modal visible transparent animationType="slide" statusBarTranslucent onRequestClose={closeSheet}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.flex}>
        <Pressable style={[s.flex, { backgroundColor: t.scrim }]} onPress={closeSheet} accessibilityRole="button" accessibilityLabel={tr.cancel} />
        <View style={[s.sheet, { backgroundColor: t.paper, paddingBottom: insets.bottom + 14 }]}>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
            <TextInput
              value={f.title}
              onChangeText={(title) => {
                up({ title });
                setTitleError(false);
              }}
              autoFocus={!task}
              placeholder={titleError ? tr.needTitle : tr.sheetTitlePh}
              placeholderTextColor={titleError ? t.ink : t.soft}
              maxLength={120}
              style={[s.titleInput, { color: t.ink, borderBottomColor: titleError ? t.accent : t.ink }]}
              accessibilityLabel={tr.sheetTitlePh}
            />

            <View>
              <Label t={t}>{tr.worth}</Label>
              <View style={s.pick}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <Pressable
                    key={n}
                    onPress={() => up({ points: n as Points })}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: f.points === n }}
                    accessibilityLabel={tr.ptsLabel(n)}
                    style={[s.pickBtn, { backgroundColor: n <= f.points ? t.accent : t.wash }]}
                  >
                    <Text style={[s.pickT, { color: n <= f.points ? t.onAccent : t.ink }]}>{n}</Text>
                  </Pressable>
                ))}
              </View>
              <View style={s.pickCap}>
                <Text style={[s.cap, { color: t.mute }]}>{tr.small}</Text>
                <Text style={[s.cap, { color: t.mute }]}>{tr.big}</Text>
              </View>
            </View>

            <View>
              <Label t={t}>{tr.group}</Label>
              <View style={s.wrap}>
                {data.groups.map((g) => (
                  <Chip key={g.id} label={g.name} color={g.color} on={f.groupId === g.id} onPress={() => up({ groupId: f.groupId === g.id ? null : g.id })} />
                ))}
                {newGroup === null ? <Chip label={tr.newGroupChip} onPress={() => setNewGroup('')} /> : null}
              </View>
              {newGroup !== null ? (
                <View style={[s.inline, { borderColor: t.ink }]}>
                  <TextInput
                    value={newGroup}
                    onChangeText={setNewGroup}
                    autoFocus
                    maxLength={24}
                    placeholder={tr.groupNamePh}
                    placeholderTextColor={t.soft}
                    style={[s.inlineIn, { color: t.ink }]}
                    onSubmitEditing={() => {
                      const g = addGroup(newGroup);
                      if (g) up({ groupId: g.id });
                      setNewGroup(null);
                    }}
                  />
                  <Pressable
                    style={[s.inlineBtn, { backgroundColor: t.ink }]}
                    onPress={() => {
                      const g = addGroup(newGroup);
                      if (g) up({ groupId: g.id });
                      setNewGroup(null);
                    }}
                  >
                    <Text style={[s.inlineT, { color: t.paper }]}>{tr.create}</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>

            {!task ? (
              <Pressable style={s.toggleRow} onPress={() => up({ repeat: !f.repeat })} accessibilityRole="switch" accessibilityState={{ checked: f.repeat }}>
                <Text style={[s.toggleT, { color: t.ink }]}>{tr.repeat}</Text>
                <View style={[s.sw, { borderColor: f.repeat ? t.accent : t.soft, backgroundColor: f.repeat ? t.accent : 'transparent' }]}>
                  <View style={[s.knob, { backgroundColor: f.repeat ? t.onAccent : t.soft, alignSelf: f.repeat ? 'flex-end' : 'flex-start' }]} />
                </View>
              </Pressable>
            ) : null}

            {f.repeat ? (
              <View>
                <Label t={t}>{tr.repeatDays}</Label>
                <View style={s.days}>
                  {tr.dayLetters.map((l, i) => {
                    const on = f.weekdays.includes(i);
                    return (
                      <Pressable
                        key={i}
                        onPress={() => {
                          setDayError(false);
                          up({ weekdays: on ? f.weekdays.filter((x) => x !== i) : [...f.weekdays, i] });
                        }}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: on }}
                        accessibilityLabel={tr.days[i]}
                        style={[s.dayBtn, { backgroundColor: on ? t.ink : t.wash }]}
                      >
                        <Text style={[s.dayT, { color: on ? t.paper : t.ink }]}>{l}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                {dayError ? <Text style={[s.err, { color: t.ink }]}>{tr.repeatNeedDay}</Text> : null}
              </View>
            ) : null}

            {!f.repeat || task ? (
              <View>
                <Label t={t}>{tr.when}</Label>
                <View style={s.wrap}>
                  <Chip label={tr.today} on={f.date === today} onPress={() => up({ date: today })} />
                  <Chip label={tr.tomorrow} on={f.date === tomorrow} onPress={() => up({ date: tomorrow })} />
                  {!f.repeat ? <Chip label={tr.noDate} on={!f.date} onPress={() => up({ date: null, time: null, reminderMin: null })} /> : null}
                  {hasNativePickers ? <Chip label={other ? fmtDate(f.date as string) : tr.otherDate} on={!!other} onPress={chooseDate} /> : null}
                </View>
                {!hasNativePickers ? (
                  <TextInput
                    value={typedDate}
                    onChangeText={(v) => {
                      setTypedDate(v);
                      if (VALID_DATE.test(v) && v >= today) up({ date: v });
                    }}
                    placeholder={`${tr.otherDate}: ${tr.datePh}`}
                    placeholderTextColor={t.soft}
                    style={[s.typed, { color: t.ink, borderColor: t.line }]}
                    accessibilityLabel={tr.otherDate}
                  />
                ) : null}
              </View>
            ) : null}

            {f.date || f.repeat ? (
              <View>
                <Label t={t}>{tr.time}</Label>
                <View style={s.wrap}>
                  {hasNativePickers ? (
                    <Chip label={f.time ?? tr.noTime} on={!!f.time} onPress={chooseTime} />
                  ) : (
                    <TextInput
                      defaultValue={f.time ?? ''}
                      onChangeText={(v) => {
                        if (VALID_TIME.test(v)) up({ time: v, reminderMin: f.reminderMin ?? 0 });
                        else if (!v) up({ time: null, reminderMin: null });
                      }}
                      placeholder={tr.timePh}
                      placeholderTextColor={t.soft}
                      style={[s.typed, s.typedTime, { color: t.ink, borderColor: t.line }]}
                      accessibilityLabel={tr.time}
                    />
                  )}
                  {f.time && hasNativePickers ? <Chip label={tr.clear} onPress={() => up({ time: null, reminderMin: null })} /> : null}
                </View>
              </View>
            ) : null}

            {f.time ? (
              <View>
                <Label t={t}>{tr.reminderLabel}</Label>
                <View style={s.wrap}>
                  {tr.reminderOpts.map((o) => (
                    <Chip key={o.l} label={o.l} on={f.reminderMin === o.v} onPress={() => up({ reminderMin: o.v })} />
                  ))}
                </View>
              </View>
            ) : null}

            {placed && task ? (
              <View style={s.acts}>
                <Btn
                  label={tr.removeFromDay}
                  onPress={() => {
                    closeSheet();
                    removeFromDay(task.id);
                  }}
                />
                <Btn
                  label={tr.moveTomorrow}
                  onPress={() => {
                    closeSheet();
                    moveToTomorrow(task.id);
                  }}
                />
              </View>
            ) : null}
            <View style={s.acts}>
              <Btn label={task ? tr.save : tr.add} solid onPress={save} />
            </View>

            {task ? (
              <View style={s.linkRow}>
                <TextLink label={tr.history} onPress={() => setHistory(history ? null : taskHistory(task.id))} />
                {series && !series.endedAt ? (
                  <TextLink
                    label={tr.endSeries}
                    onPress={() => {
                      closeSheet();
                      endSeries(series.id, task.date && task.date > today ? task.date : today);
                    }}
                  />
                ) : null}
                <TextLink
                  label={tr.deleteTask}
                  onPress={() => {
                    closeSheet();
                    deleteTask(task.id);
                  }}
                />
              </View>
            ) : null}

            {history ? (
              <View style={s.history}>
                {history.map((e) => (
                  <Text key={e.id} style={[s.historyT, { color: t.mute }]}>
                    {`${new Date(e.at).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' })} · ${tr.historyLine[e.type]}${e.toDate && e.toDate !== e.fromDate ? ` ל-${fmtDate(e.toDate)}` : ''}`}
                  </Text>
                ))}
              </View>
            ) : null}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  sheet: { maxHeight: '92%', borderTopStartRadius: 18, borderTopEndRadius: 18 },
  content: { padding: 18, gap: 15 },
  titleInput: { fontFamily: font.serif, fontSize: 23, borderBottomWidth: 1.5, paddingVertical: 6 },
  label: { fontFamily: font.semibold, fontSize: 13.5, marginBottom: 6 },
  pick: { flexDirection: 'row', gap: 4 },
  pickBtn: { flex: 1, height: 50, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  pickT: { fontFamily: font.serif, fontSize: 22, fontVariant: ['lining-nums'] },
  pickCap: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  cap: { fontFamily: font.regular, fontSize: 13 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
  inline: { flexDirection: 'row', borderWidth: 1.5, borderRadius: 10, overflow: 'hidden', marginTop: 8 },
  inlineIn: { flex: 1, fontFamily: font.regular, fontSize: 16, paddingHorizontal: 12, paddingVertical: 8 },
  inlineBtn: { paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  inlineT: { fontFamily: font.bold, fontSize: 15 },
  toggleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  toggleT: { fontFamily: font.medium, fontSize: 16 },
  sw: { width: 44, height: 25, borderRadius: 13, borderWidth: 1.5, padding: 3, justifyContent: 'center' },
  knob: { width: 16, height: 16, borderRadius: 8 },
  days: { flexDirection: 'row', gap: 4 },
  dayBtn: { flex: 1, height: 42, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  dayT: { fontFamily: font.semibold, fontSize: 15 },
  err: { fontFamily: font.semibold, fontSize: 14, marginTop: 6 },
  typed: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, marginTop: 8, fontFamily: font.regular, fontSize: 15 },
  typedTime: { marginTop: 0, minWidth: 110 },
  acts: { flexDirection: 'row', gap: 6 },
  linkRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 18, justifyContent: 'center', paddingTop: 4 },
  history: { gap: 3 },
  historyT: { fontFamily: font.regular, fontSize: 14, fontVariant: ['lining-nums'] },
});

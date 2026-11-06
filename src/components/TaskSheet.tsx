// A light quick-add sheet: title, worth and a row of small options. Details open only when asked for.
import React, { useState } from 'react';
import { KeyboardAvoidingView, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { addDays, weekday } from '../domain/dates';
import type { Points, Task, TaskEvent } from '../domain/types';
import { fmtDate, t as tr } from '../i18n';
import { ensureReminderPermission } from '../notifications';
import { hasNativePickers, pickDate, pickTime } from '../pickers';
import {
  addGroup, closeSheet, deleteTask, endSeries, moveToTomorrow, removeFromDay, saveForm, taskHistory, useApp, type TaskForm,
} from '../store';
import { font, groupColor, useTheme, type Theme } from '../theme';
import { Chip, Dot } from './ui';

const VALID_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const VALID_DATE = /^\d{4}-\d{2}-\d{2}$/;
type Panel = 'none' | 'when' | 'group' | 'time' | 'repeat';

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

function Pill({ label, set, open, color, onPress, t }: { label: string; set: boolean; open: boolean; color?: string; onPress: () => void; t: Theme }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ expanded: open }} style={[s.pill, { backgroundColor: open ? t.line : t.wash }]}>
      {color ? <View style={[s.pillDot, { backgroundColor: color }]} /> : null}
      <Text style={[s.pillT, { color: set ? t.ink : t.mute, fontFamily: set ? font.semibold : font.regular }]}>{label}</Text>
    </Pressable>
  );
}

function Quiet({ label, onPress, t }: { label: string; onPress: () => void; t: Theme }) {
  return (
    <Pressable onPress={onPress} hitSlop={8} accessibilityRole="button">
      <Text style={[s.quiet, { color: t.mute }]}>{label}</Text>
    </Pressable>
  );
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
  const [panel, setPanel] = useState<Panel>('none');
  const [titleError, setTitleError] = useState(false);
  const [dayError, setDayError] = useState(false);
  const [newGroup, setNewGroup] = useState<string | null>(null);
  const [typedDate, setTypedDate] = useState('');
  const [history, setHistory] = useState<TaskEvent[] | null>(null);

  const up = (p: Partial<TaskForm>) => setF((x) => ({ ...x, ...p }));
  const toggle = (p: Panel) => setPanel((c) => (c === p ? 'none' : p));
  const tomorrow = addDays(today, 1);
  const other = !!f.date && f.date !== today && f.date !== tomorrow;
  const group = f.groupId ? data.groups.find((g) => g.id === f.groupId) : undefined;
  const whenLabel = !f.date ? tr.noDate : f.date === today ? tr.today : f.date === tomorrow ? tr.tomorrow : fmtDate(f.date);
  const daysLabel = [...f.weekdays].sort().map((d) => tr.dayLetters[d]).join(' ');

  const chooseDate = async () => {
    const picked = await pickDate(f.date, today);
    if (picked) up({ date: picked });
  };
  const chooseTime = async () => {
    const picked = await pickTime(f.time);
    if (picked) up({ time: picked, reminderMin: f.reminderMin ?? 0 });
  };
  const makeGroup = () => {
    const g = newGroup ? addGroup(newGroup) : null;
    if (g) up({ groupId: g.id });
    setNewGroup(null);
  };

  const save = () => {
    if (!f.title.trim()) {
      setTitleError(true);
      return;
    }
    if (f.repeat && !f.weekdays.length) {
      setPanel('repeat');
      setDayError(true);
      return;
    }
    if (f.reminderMin !== null && f.time) ensureReminderPermission().catch(() => {});
    saveForm(task?.id ?? null, f);
    closeSheet();
  };

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={closeSheet}>
      <KeyboardAvoidingView behavior="padding" style={s.flex}>
        <Pressable style={[s.flex, { backgroundColor: t.scrim }]} onPress={closeSheet} accessibilityRole="button" accessibilityLabel={tr.cancel} />
        <View style={[s.sheet, { backgroundColor: t.paper, paddingBottom: insets.bottom + 12 }]}>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
            <View style={s.titleRow}>
              <TextInput
                value={f.title}
                onChangeText={(title) => {
                  up({ title });
                  setTitleError(false);
                }}
                onSubmitEditing={save}
                submitBehavior="submit"
                returnKeyType="done"
                autoFocus={!task}
                placeholder={titleError ? tr.needTitle : tr.sheetTitlePh}
                placeholderTextColor={titleError ? t.ink : t.soft}
                maxLength={120}
                style={[s.titleInput, { color: t.ink }]}
                accessibilityLabel={tr.sheetTitlePh}
              />
              <Pressable
                onPress={save}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel={task ? tr.save : tr.add}
                style={[s.send, { backgroundColor: f.title.trim() ? t.accent : t.wash }]}
              >
                <Text style={[s.sendT, { color: f.title.trim() ? t.onAccent : t.soft }]}>✓</Text>
              </Pressable>
            </View>

            <View style={s.worth}>
              <Text style={[s.worthT, { color: t.mute }]}>{tr.worth}</Text>
              {[1, 2, 3, 4, 5].map((n) => (
                <Pressable
                  key={n}
                  onPress={() => up({ points: n as Points })}
                  hitSlop={3}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: f.points === n }}
                  accessibilityLabel={tr.ptsLabel(n)}
                  style={[s.point, { backgroundColor: n <= f.points ? t.accent : t.wash }]}
                >
                  <Text style={[s.pointT, { color: n <= f.points ? t.onAccent : t.mute }]}>{n}</Text>
                </Pressable>
              ))}
            </View>

            <View style={s.pills}>
              {!f.repeat || series ? <Pill label={whenLabel} set={!!f.date} open={panel === 'when'} onPress={() => toggle('when')} t={t} /> : null}
              <Pill label={group?.name ?? tr.group} set={!!group} open={panel === 'group'} color={group ? groupColor(t, group.color) : undefined} onPress={() => toggle('group')} t={t} />
              {f.date || f.repeat ? (
                <Pill
                  label={f.time ? `${f.time}${f.reminderMin !== null ? ` · ${tr.reminderLabel}` : ''}` : tr.time}
                  set={!!f.time}
                  open={panel === 'time'}
                  onPress={() => toggle('time')}
                  t={t}
                />
              ) : null}
              {!task || series ? (
                <Pill label={f.repeat ? `${tr.repeatShort} ${daysLabel}` : tr.repeatShort} set={f.repeat} open={panel === 'repeat'} onPress={() => toggle('repeat')} t={t} />
              ) : null}
            </View>

            {panel === 'when' ? (
              <View>
                <View style={s.wrap}>
                  <Chip label={tr.today} on={f.date === today} onPress={() => up({ date: today })} />
                  <Chip label={tr.tomorrow} on={f.date === tomorrow} onPress={() => up({ date: tomorrow })} />
                  {!f.repeat ? <Chip label={tr.noDate} on={!f.date} onPress={() => up({ date: null, time: null, reminderMin: null })} /> : null}
                  {hasNativePickers ? <Chip label={other ? fmtDate(f.date as string) : tr.otherDate} on={other} onPress={chooseDate} /> : null}
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
                    style={[s.typed, { color: t.ink, backgroundColor: t.wash }]}
                    accessibilityLabel={tr.otherDate}
                  />
                ) : null}
              </View>
            ) : null}

            {panel === 'group' ? (
              <View>
                <View style={s.wrap}>
                  {data.groups.map((g) => (
                    <Chip key={g.id} label={g.name} color={g.color} on={f.groupId === g.id} onPress={() => up({ groupId: f.groupId === g.id ? null : g.id })} />
                  ))}
                  {newGroup === null ? <Chip label={tr.newGroupChip} onPress={() => setNewGroup('')} /> : null}
                </View>
                {newGroup !== null ? (
                  <View style={[s.inline, { backgroundColor: t.wash }]}>
                    <Dot />
                    <TextInput
                      value={newGroup}
                      onChangeText={setNewGroup}
                      onSubmitEditing={makeGroup}
                      autoFocus
                      maxLength={24}
                      placeholder={tr.groupNamePh}
                      placeholderTextColor={t.soft}
                      style={[s.inlineIn, { color: t.ink }]}
                    />
                    <Quiet label={tr.create} onPress={makeGroup} t={t} />
                  </View>
                ) : null}
              </View>
            ) : null}

            {panel === 'time' ? (
              <View style={s.col}>
                <View style={s.wrap}>
                  {hasNativePickers ? (
                    <Chip label={f.time ?? tr.setTime} on={!!f.time} onPress={chooseTime} />
                  ) : (
                    <TextInput
                      defaultValue={f.time ?? ''}
                      onChangeText={(v) => {
                        if (VALID_TIME.test(v)) up({ time: v, reminderMin: f.reminderMin ?? 0 });
                        else if (!v) up({ time: null, reminderMin: null });
                      }}
                      placeholder={tr.timePh}
                      placeholderTextColor={t.soft}
                      style={[s.typed, s.typedTime, { color: t.ink, backgroundColor: t.wash }]}
                      accessibilityLabel={tr.time}
                    />
                  )}
                  {f.time && hasNativePickers ? <Chip label={tr.clear} onPress={() => up({ time: null, reminderMin: null })} /> : null}
                </View>
                {f.time ? (
                  <View style={s.wrap}>
                    {tr.reminderOpts.map((o) => (
                      <Chip key={o.l} label={o.l} on={f.reminderMin === o.v} onPress={() => up({ reminderMin: o.v })} />
                    ))}
                  </View>
                ) : null}
              </View>
            ) : null}

            {panel === 'repeat' ? (
              <View style={s.col}>
                <View style={s.days}>
                  {tr.dayLetters.map((l, i) => {
                    const on = f.repeat && f.weekdays.includes(i);
                    return (
                      <Pressable
                        key={i}
                        onPress={() => {
                          setDayError(false);
                          const weekdays = on ? f.weekdays.filter((x) => x !== i) : f.repeat ? [...f.weekdays, i] : [i];
                          up({ weekdays, repeat: !!series || weekdays.length > 0 });
                        }}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: on }}
                        accessibilityLabel={tr.days[i]}
                        style={[s.day, { backgroundColor: on ? t.ink : t.wash }]}
                      >
                        <Text style={[s.dayT, { color: on ? t.paper : t.ink }]}>{l}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                {dayError ? <Text style={[s.err, { color: t.ink }]}>{tr.repeatNeedDay}</Text> : null}
                {series && !series.endedAt ? (
                  <Quiet
                    label={tr.endSeries}
                    onPress={() => {
                      closeSheet();
                      endSeries(series.id, task?.date && task.date > today ? task.date : today);
                    }}
                    t={t}
                  />
                ) : null}
              </View>
            ) : null}

            {task ? (
              <View style={s.links}>
                {task.date ? (
                  <>
                    <Quiet
                      label={tr.removeFromDay}
                      onPress={() => {
                        closeSheet();
                        removeFromDay(task.id);
                      }}
                      t={t}
                    />
                    <Quiet
                      label={tr.moveTomorrow}
                      onPress={() => {
                        closeSheet();
                        moveToTomorrow(task.id);
                      }}
                      t={t}
                    />
                  </>
                ) : null}
                <Quiet label={tr.history} onPress={() => setHistory(history ? null : taskHistory(task.id))} t={t} />
                <Quiet
                  label={tr.deleteTask}
                  onPress={() => {
                    closeSheet();
                    deleteTask(task.id);
                  }}
                  t={t}
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
  sheet: { maxHeight: '85%', borderTopStartRadius: 20, borderTopEndRadius: 20 },
  content: { paddingHorizontal: 18, paddingTop: 14, gap: 12 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  titleInput: { flex: 1, fontFamily: font.medium, fontSize: 19, paddingVertical: 6 },
  send: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  sendT: { fontFamily: font.bold, fontSize: 19, lineHeight: 24 },
  worth: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  worthT: { fontFamily: font.regular, fontSize: 14, marginEnd: 4 },
  point: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  pointT: { fontFamily: font.semibold, fontSize: 14, fontVariant: ['lining-nums'] },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  pillDot: { width: 8, height: 8, borderRadius: 4 },
  pillT: { fontSize: 14, fontVariant: ['lining-nums'] },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
  col: { gap: 8 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 10, paddingHorizontal: 12, marginTop: 8 },
  inlineIn: { flex: 1, fontFamily: font.regular, fontSize: 15.5, paddingVertical: 7 },
  days: { flexDirection: 'row', gap: 4 },
  day: { flex: 1, height: 36, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  dayT: { fontFamily: font.semibold, fontSize: 14 },
  err: { fontFamily: font.semibold, fontSize: 14 },
  typed: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, marginTop: 8, fontFamily: font.regular, fontSize: 15 },
  typedTime: { marginTop: 0, minWidth: 110 },
  links: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, paddingTop: 2 },
  quiet: { fontFamily: font.medium, fontSize: 14 },
  history: { gap: 3 },
  historyT: { fontFamily: font.regular, fontSize: 13.5, fontVariant: ['lining-nums'] },
});

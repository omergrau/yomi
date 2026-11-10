// Everything about a task on one screen: one tap per change, no typing except the name.
// Changes to an existing task save as they are made.
import React, { useRef, useState } from 'react';
import { KeyboardAvoidingView, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { addDays, parseIso, weekDays, weekday } from '../domain/dates';
import { endLabel } from '../domain/order';
import type { Points, Task, TaskEvent } from '../domain/types';
import { fmtDate, t as tr } from '../i18n';
import { ensureReminderPermission } from '../notifications';
import { hasNativePickers, pickDate, pickTime } from '../pickers';
import {
  addGroup, closeSheet, deleteTask, endSeries, moveToTomorrow, removeFromDay, saveForm, taskHistory, useApp, type TaskForm,
} from '../store';
import { font, groupColor, useTheme, type Theme } from '../theme';

const HOURS = Array.from({ length: 18 }, (_, i) => i + 6);
const MINUTES = ['00', '15', '30', '45'];
const pad = (n: number) => String(n).padStart(2, '0');
const chunk = <T,>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

function initial(task: Task | null, weekdays: number[] | null, preset: { groupId?: string | null; date?: string | null }, view: string, today: string): TaskForm {
  if (task) {
    return {
      title: task.title, groupId: task.groupId, points: task.points, date: task.date, time: task.time, reminderMin: task.reminderMin, durationMin: task.durationMin ?? null,
      repeat: !!task.recurringId, weekdays: weekdays ?? [],
    };
  }
  const date = preset.date !== undefined ? preset.date : view >= today ? view : today;
  return { title: '', groupId: preset.groupId ?? null, points: 3, date, time: null, reminderMin: null, durationMin: null, repeat: false, weekdays: [] };
}

function Label({ text, t }: { text: string; t: Theme }) {
  return <Text style={[s.label, { color: t.mute }]}>{text}</Text>;
}

/** A small tappable cell. Selected cells are filled. */
function Cell({ label, on, off, wide, color, onPress, t, a11y }: {
  label: string; on?: boolean; off?: boolean; wide?: boolean; color?: string; onPress: () => void; t: Theme; a11y?: string;
}) {
  return (
    <Pressable
      onPress={off ? undefined : onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityState={{ selected: !!on, disabled: !!off }}
      accessibilityLabel={a11y ?? label}
      style={[wide ? s.chip : s.cell, { backgroundColor: on ? t.ink : t.wash, opacity: off ? 0.35 : 1 }]}
    >
      {color ? <View style={[s.dot, { backgroundColor: color }]} /> : null}
      <Text style={[s.cellT, { color: on ? t.paper : t.ink, fontFamily: on ? font.semibold : font.regular }]}>{label}</Text>
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
  const [titleError, setTitleError] = useState(false);
  const [newGroup, setNewGroup] = useState<string | null>(null);
  const [history, setHistory] = useState<TaskEvent[] | null>(null);
  const latest = useRef(f);
  latest.current = f;

  // An existing task saves on every change, so editing never needs a save button.
  const persist = (next: TaskForm) => {
    if (task && next.title.trim()) {
      if (next.reminderMin !== null && next.time) ensureReminderPermission().catch(() => {});
      saveForm(task.id, next);
    }
  };
  const up = (p: Partial<TaskForm>) => {
    const next = { ...latest.current, ...p };
    if (next.repeat && !next.weekdays.length && !series) next.repeat = false;
    latest.current = next;
    setF(next);
    persist(next);
  };

  const finish = (fromButton = false) => {
    const cur = latest.current;
    if (!cur.title.trim()) {
      if (!task && fromButton) setTitleError(true);
      else closeSheet();
      return;
    }
    if (!task) {
      if (cur.reminderMin !== null && cur.time) ensureReminderPermission().catch(() => {});
      saveForm(null, cur);
    } else persist(cur);
    closeSheet();
  };

  const days = [...weekDays(today), ...weekDays(addDays(today, 7))];
  const beyond = !!f.date && !days.includes(f.date);
  const [hh, mm] = f.time ? f.time.split(':') : [null, null];
  const minutes = MINUTES.includes(mm ?? '') || !mm ? MINUTES : [...MINUTES, mm].sort();
  const canRepeat = !task || !!series;

  const setHour = (h: number) => up({ time: `${pad(h)}:${mm ?? '00'}`, reminderMin: f.time ? f.reminderMin : 0 });
  const setMinute = (m: string) => up({ time: `${hh ?? '09'}:${m}`, reminderMin: f.time ? f.reminderMin : 0 });
  const makeGroup = () => {
    const g = newGroup ? addGroup(newGroup) : null;
    if (g) up({ groupId: g.id });
    setNewGroup(null);
  };

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={() => finish()}>
      <KeyboardAvoidingView behavior="padding" style={s.flex}>
        <Pressable style={[s.flex, { backgroundColor: t.scrim }]} onPress={() => finish()} accessibilityRole="button" accessibilityLabel={tr.done} />
        <View style={[s.sheet, { backgroundColor: t.paper, paddingBottom: insets.bottom + 10 }]}>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
            <View style={s.titleRow}>
              <TextInput
                value={f.title}
                onChangeText={(title) => {
                  latest.current = { ...latest.current, title };
                  setF(latest.current);
                  setTitleError(false);
                }}
                onEndEditing={() => persist(latest.current)}
                onSubmitEditing={task ? undefined : () => finish(true)}
                submitBehavior={task ? 'blurAndSubmit' : 'submit'}
                returnKeyType="done"
                autoFocus={!task}
                placeholder={titleError ? tr.needTitle : tr.sheetTitlePh}
                placeholderTextColor={titleError ? t.ink : t.soft}
                maxLength={120}
                style={[s.titleInput, { color: t.ink }]}
                accessibilityLabel={tr.sheetTitlePh}
              />
              <Pressable onPress={() => finish(true)} hitSlop={6} accessibilityRole="button" accessibilityLabel={task ? tr.done : tr.add} style={[s.send, { backgroundColor: f.title.trim() ? t.accent : t.wash }]}>
                <Text style={[s.sendT, { color: f.title.trim() ? t.onAccent : t.soft }]}>✓</Text>
              </Pressable>
            </View>

            <View style={s.inline}>
              <Label text={tr.worth} t={t} />
              <View style={s.points}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <Pressable
                    key={n}
                    onPress={() => up({ points: n as Points })}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: f.points === n }}
                    accessibilityLabel={tr.ptsLabel(n)}
                    style={[s.point, { backgroundColor: n <= f.points ? t.accent : t.wash }]}
                  >
                    <Text style={[s.pointT, { color: n <= f.points ? t.onAccent : t.mute }]}>{n}</Text>
                  </Pressable>
                ))}
              </View>
            </View>

            {!f.repeat || series ? (
              <View>
                <Label text={tr.when} t={t} />
                <View style={s.rows}>
                  <View style={s.line}>
                    {tr.dayLetters.map((l) => (
                      <Text key={l} style={[s.head7, { color: t.soft }]}>{l}</Text>
                    ))}
                  </View>
                  {chunk(days, 7).map((week) => (
                    <View key={week[0]} style={s.line}>
                      {week.map((d) => (
                        <Cell
                          key={d}
                          label={String(parseIso(d).getDate())}
                          a11y={d === today ? tr.today : `${tr.days[weekday(d)]} ${fmtDate(d)}`}
                          on={f.date === d}
                          off={d < today}
                          onPress={() => up({ date: d })}
                          t={t}
                        />
                      ))}
                    </View>
                  ))}
                </View>
                <View style={s.row}>
                  {!f.repeat ? <Cell wide label={tr.noDate} on={!f.date} onPress={() => up({ date: null, time: null, reminderMin: null })} t={t} /> : null}
                  {hasNativePickers ? (
                    <Cell
                      wide
                      label={beyond ? fmtDate(f.date as string) : tr.otherDate}
                      on={beyond}
                      onPress={async () => {
                        const picked = await pickDate(f.date, today);
                        if (picked) up({ date: picked });
                      }}
                      t={t}
                    />
                  ) : null}
                </View>
              </View>
            ) : null}

            {f.date || f.repeat ? (
              <View>
                <Label text={tr.time} t={t} />
                <View style={s.rows}>
                  {chunk(HOURS, 6).map((row) => (
                    <View key={row[0]} style={s.line}>
                      {row.map((h) => (
                        <Cell key={h} label={pad(h)} on={hh === pad(h)} onPress={() => setHour(h)} t={t} a11y={`${h}:00`} />
                      ))}
                    </View>
                  ))}
                  <View style={s.line}>
                    {minutes.map((m) => (
                      <Cell key={m} label={`:${m}`} on={mm === m} onPress={() => setMinute(m)} t={t} a11y={`${m} דקות`} />
                    ))}
                  </View>
                </View>
                <View style={s.row}>
                  <Cell wide label={tr.noHour} on={!f.time} onPress={() => up({ time: null, reminderMin: null, durationMin: null })} t={t} />
                  {hasNativePickers ? (
                    <Cell
                      wide
                      label={tr.otherTime}
                      onPress={async () => {
                        const picked = await pickTime(f.time);
                        if (picked) up({ time: picked, reminderMin: f.time ? f.reminderMin : 0 });
                      }}
                      t={t}
                    />
                  ) : null}
                </View>
              </View>
            ) : null}

            {f.time && !series ? (
              <View>
                <Label text={tr.until(endLabel({ ...(task ?? ({} as Task)), time: f.time, durationMin: f.durationMin ?? null } as Task))} t={t} />
                <View style={s.row}>
                  {tr.durations.map((o) => (
                    <Cell key={o.l} wide label={o.l} on={(f.durationMin ?? null) === o.v} onPress={() => up({ durationMin: o.v })} t={t} />
                  ))}
                  {hasNativePickers ? (
                    <Cell
                      wide
                      label={tr.otherEnd}
                      on={!!f.durationMin && !tr.durations.some((o) => o.v === f.durationMin)}
                      onPress={async () => {
                        const picked = await pickTime(f.time);
                        if (!picked || !f.time) return;
                        const [sh, sm] = f.time.split(':').map(Number);
                        const [eh, em] = picked.split(':').map(Number);
                        const mins = eh * 60 + em - (sh * 60 + sm);
                        if (mins > 0) up({ durationMin: mins });
                      }}
                      t={t}
                    />
                  ) : null}
                </View>
              </View>
            ) : null}

            {f.time ? (
              <View>
                <Label text={tr.reminderLabel} t={t} />
                <View style={s.row}>
                  {tr.reminderOpts.map((o) => (
                    <Cell key={o.l} wide label={o.l} on={f.reminderMin === o.v} onPress={() => up({ reminderMin: o.v })} t={t} />
                  ))}
                </View>
              </View>
            ) : null}

            <View>
              <Label text={tr.group} t={t} />
              <View style={s.row}>
                <Cell wide label={tr.noGroup} on={!f.groupId} onPress={() => up({ groupId: null })} t={t} />
                {data.groups.map((g) => (
                  <Cell key={g.id} wide label={g.name} color={groupColor(t, g.color)} on={f.groupId === g.id} onPress={() => up({ groupId: g.id })} t={t} />
                ))}
                {newGroup === null ? <Cell wide label={tr.newGroupChip} onPress={() => setNewGroup('')} t={t} /> : null}
              </View>
              {newGroup !== null ? (
                <View style={[s.newGroup, { backgroundColor: t.wash }]}>
                  <TextInput
                    value={newGroup}
                    onChangeText={setNewGroup}
                    onSubmitEditing={makeGroup}
                    autoFocus
                    maxLength={24}
                    placeholder={tr.groupNamePh}
                    placeholderTextColor={t.soft}
                    style={[s.newGroupIn, { color: t.ink }]}
                  />
                  <Pressable onPress={makeGroup} hitSlop={8}>
                    <Text style={[s.quiet, { color: t.accent }]}>{tr.create}</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>

            {canRepeat ? (
              <View>
                <Label text={tr.repeatLabel} t={t} />
                <View style={s.line}>
                  {tr.dayLetters.map((l, i) => {
                    const on = f.repeat && f.weekdays.includes(i);
                    return (
                      <Cell
                        key={i}
                        label={l}
                        a11y={tr.days[i]}
                        on={on}
                        onPress={() => {
                          const weekdays = on ? f.weekdays.filter((x) => x !== i) : f.repeat ? [...f.weekdays, i] : [i];
                          if (series && !weekdays.length) return;
                          up({ weekdays, repeat: !!series || weekdays.length > 0 });
                        }}
                        t={t}
                      />
                    );
                  })}
                </View>
              </View>
            ) : null}

            {task ? (
              <View style={s.links}>
                {series ? (
                  <Pressable onPress={() => { closeSheet(); removeFromDay(task.id); }} hitSlop={8} accessibilityRole="button">
                    <Text style={[s.quiet, { color: t.accent }]}>{tr.cancelOnce}</Text>
                  </Pressable>
                ) : null}
                {task.date ? (
                  <>
                    {series ? null : (
                      <Pressable onPress={() => { closeSheet(); removeFromDay(task.id); }} hitSlop={8} accessibilityRole="button">
                        <Text style={[s.quiet, { color: t.mute }]}>{tr.removeFromDay}</Text>
                      </Pressable>
                    )}
                    <Pressable onPress={() => { closeSheet(); moveToTomorrow(task.id); }} hitSlop={8} accessibilityRole="button">
                      <Text style={[s.quiet, { color: t.mute }]}>{tr.moveTomorrow}</Text>
                    </Pressable>
                  </>
                ) : null}
                {series && !series.endedAt ? (
                  <Pressable onPress={() => { closeSheet(); endSeries(series.id, task.date && task.date > today ? task.date : today); }} hitSlop={8} accessibilityRole="button">
                    <Text style={[s.quiet, { color: t.mute }]}>{tr.endSeries}</Text>
                  </Pressable>
                ) : null}
                <Pressable onPress={() => setHistory(history ? null : taskHistory(task.id))} hitSlop={8} accessibilityRole="button">
                  <Text style={[s.quiet, { color: t.mute }]}>{tr.history}</Text>
                </Pressable>
                {series ? null : (
                  <Pressable onPress={() => { closeSheet(); deleteTask(task.id); }} hitSlop={8} accessibilityRole="button">
                    <Text style={[s.quiet, { color: t.mute }]}>{tr.deleteTask}</Text>
                  </Pressable>
                )}
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
  sheet: { maxHeight: '92%', borderTopStartRadius: 20, borderTopEndRadius: 20 },
  content: { paddingHorizontal: 16, paddingTop: 12, gap: 12 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  titleInput: { flex: 1, fontFamily: font.medium, fontSize: 18, paddingVertical: 4 },
  send: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  sendT: { fontFamily: font.bold, fontSize: 18, lineHeight: 23 },
  label: { fontFamily: font.regular, fontSize: 12.5, marginBottom: 5 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  points: { flexDirection: 'row', gap: 6 },
  point: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  pointT: { fontFamily: font.semibold, fontSize: 14, fontVariant: ['lining-nums'] },
  rows: { gap: 4 },
  line: { flexDirection: 'row', gap: 4 },
  head7: { flex: 1, textAlign: 'center', fontFamily: font.regular, fontSize: 11.5 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 },
  cell: { flex: 1, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 32, paddingHorizontal: 11, borderRadius: 8 },
  cellT: { fontSize: 14, fontVariant: ['tabular-nums', 'lining-nums'] },
  dot: { width: 8, height: 8, borderRadius: 4 },
  newGroup: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 8, paddingHorizontal: 10, marginTop: 6 },
  newGroupIn: { flex: 1, fontFamily: font.regular, fontSize: 15, paddingVertical: 6 },
  links: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, paddingTop: 4 },
  quiet: { fontFamily: font.medium, fontSize: 14 },
  history: { gap: 3 },
  historyT: { fontFamily: font.regular, fontSize: 13.5, fontVariant: ['lining-nums'] },
});

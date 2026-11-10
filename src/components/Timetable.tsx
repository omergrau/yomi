// A weekly timetable of fixed slots, such as lectures or training. Each slot is a recurring item, so it also
// appears in its days and sends its reminder.
import React, { useState } from 'react';
import { KeyboardAvoidingView, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { weekday } from '../domain/dates';
import type { Recurring } from '../domain/types';
import { t as tr } from '../i18n';
import { ensureReminderPermission } from '../notifications';
import { hasNativePickers, pickTime } from '../pickers';
import { endSeries, saveSlot, useApp, type SlotForm } from '../store';
import { font, useTheme, type Theme } from '../theme';
import { Chip } from './ui';
import { WeekGrid } from './WeekGrid';

const VALID_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function TimeField({ value, label, onChange, t }: { value: string | null; label: string; onChange: (v: string | null) => void; t: Theme }) {
  if (hasNativePickers) {
    return (
      <Pressable
        onPress={async () => {
          const v = await pickTime(value);
          if (v) onChange(v);
        }}
        style={[s.timeBtn, { backgroundColor: t.wash }]}
        accessibilityRole="button"
        accessibilityLabel={label}
      >
        <Text style={[s.timeLabel, { color: t.mute }]}>{label}</Text>
        <Text style={[s.timeVal, { color: value ? t.ink : t.soft }]}>{value ?? '--:--'}</Text>
      </Pressable>
    );
  }
  return (
    <View style={[s.timeBtn, { backgroundColor: t.wash }]}>
      <Text style={[s.timeLabel, { color: t.mute }]}>{label}</Text>
      <TextInput
        defaultValue={value ?? ''}
        onChangeText={(v) => (VALID_TIME.test(v) ? onChange(v) : !v ? onChange(null) : undefined)}
        placeholder={tr.timePh}
        placeholderTextColor={t.soft}
        style={[s.timeVal, s.timeInput, { color: t.ink }]}
        accessibilityLabel={label}
      />
    </View>
  );
}

function SlotSheet({ slot, day, onClose }: { slot: Recurring | null; day: number; onClose: () => void }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { data, today } = useApp();
  const [f, setF] = useState<SlotForm>(() =>
    slot
      ? { title: slot.title, weekdays: slot.weekdays, time: slot.time, endTime: slot.endTime ?? null, place: slot.place ?? '', reminderMin: slot.reminderMin, groupId: slot.groupId, points: slot.points }
      : { title: '', weekdays: [day], time: null, endTime: null, place: '', reminderMin: 10, groupId: null, points: 2 },
  );
  const [error, setError] = useState('');
  const up = (p: Partial<SlotForm>) => {
    setError('');
    setF((x) => ({ ...x, ...p }));
  };

  const save = () => {
    if (!f.title.trim()) return setError(tr.needTitle);
    if (!f.weekdays.length) return setError(tr.repeatNeedDay);
    if (!f.time) return setError(tr.slotNeedTime);
    if (f.endTime && f.endTime <= f.time) return setError(tr.slotEndAfter);
    if (f.reminderMin !== null) ensureReminderPermission().catch(() => {});
    saveSlot(slot?.id ?? null, f);
    onClose();
  };

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <KeyboardAvoidingView behavior="padding" style={s.flex}>
        <Pressable style={[s.flex, { backgroundColor: t.scrim }]} onPress={onClose} accessibilityRole="button" accessibilityLabel={tr.cancel} />
        <View style={[s.sheet, { backgroundColor: t.paper, paddingBottom: insets.bottom + 12 }]}>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.content}>
            <View style={s.titleRow}>
              <TextInput
                value={f.title}
                onChangeText={(title) => up({ title })}
                autoFocus={!slot}
                placeholder={tr.slotTitlePh}
                placeholderTextColor={t.soft}
                maxLength={80}
                style={[s.titleInput, { color: t.ink }]}
                accessibilityLabel={tr.slotTitlePh}
              />
              <Pressable onPress={save} style={[s.send, { backgroundColor: f.title.trim() ? t.accent : t.wash }]} accessibilityRole="button" accessibilityLabel={tr.save}>
                <Text style={[s.sendT, { color: f.title.trim() ? t.onAccent : t.soft }]}>✓</Text>
              </Pressable>
            </View>

            <View style={s.days}>
              {tr.dayLetters.map((l, i) => {
                const on = f.weekdays.includes(i);
                return (
                  <Pressable
                    key={i}
                    onPress={() => up({ weekdays: on ? f.weekdays.filter((x) => x !== i) : [...f.weekdays, i] })}
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

            <View style={s.times}>
              <TimeField value={f.time} label={tr.slotStart} onChange={(time) => up({ time })} t={t} />
              <TimeField value={f.endTime} label={tr.slotEnd} onChange={(endTime) => up({ endTime })} t={t} />
            </View>

            <TextInput
              value={f.place}
              onChangeText={(place) => up({ place })}
              placeholder={tr.slotPlacePh}
              placeholderTextColor={t.soft}
              maxLength={60}
              style={[s.place, { color: t.ink, backgroundColor: t.wash }]}
              accessibilityLabel={tr.slotPlacePh}
            />

            <View>
              <Text style={[s.label, { color: t.mute }]}>{tr.reminderLabel}</Text>
              <View style={s.wrap}>
                {tr.reminderOpts.map((o) => (
                  <Chip key={o.l} label={o.l} on={f.reminderMin === o.v} onPress={() => up({ reminderMin: o.v })} />
                ))}
              </View>
            </View>

            <View>
              <Text style={[s.label, { color: t.mute }]}>{tr.group}</Text>
              <View style={s.wrap}>
                {data.groups.map((g) => (
                  <Chip key={g.id} label={g.name} color={g.color} on={f.groupId === g.id} onPress={() => up({ groupId: f.groupId === g.id ? null : g.id })} />
                ))}
              </View>
            </View>

            {error ? <Text style={[s.err, { color: t.ink }]}>{error}</Text> : null}

            {slot ? (
              <Pressable
                onPress={() => {
                  onClose();
                  endSeries(slot.id, today);
                }}
                hitSlop={8}
                accessibilityRole="button"
              >
                <Text style={[s.quiet, { color: t.mute }]}>{tr.slotRemove}</Text>
              </Pressable>
            ) : null}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export function Timetable() {
  const t = useTheme();
  const { today } = useApp();
  const [editing, setEditing] = useState<{ slot: Recurring | null } | null>(null);
  return (
    <View style={s.flex}>
      <WeekGrid onOpenSlot={(r) => setEditing({ slot: r })} />
      <View style={[s.addBar, { borderTopColor: t.line }]}>
        <Pressable onPress={() => setEditing({ slot: null })} hitSlop={8} style={s.addRow} accessibilityRole="button">
          <Text style={[s.add, { color: t.accent }]}>{tr.slotAdd}</Text>
        </Pressable>
      </View>
      {editing ? <SlotSheet slot={editing.slot} day={weekday(today)} onClose={() => setEditing(null)} /> : null}
    </View>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  dayBar: { flexDirection: 'row', gap: 4, paddingHorizontal: 16, paddingTop: 4 },
  dayTab: { flex: 1, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center', gap: 3 },
  dayTabT: { fontFamily: font.semibold, fontSize: 15 },
  has: { width: 4, height: 4, borderRadius: 2 },
  list: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 40, gap: 8 },
  dayName: { fontFamily: font.serif, fontSize: 21, marginBottom: 4 },
  empty: { fontFamily: font.regular, fontSize: 15, lineHeight: 21 },
  slot: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 12, overflow: 'hidden', paddingEnd: 14, minHeight: 64 },
  bar: { width: 4, alignSelf: 'stretch' },
  when: { width: 50, alignItems: 'center' },
  start: { fontFamily: font.semibold, fontSize: 15.5, fontVariant: ['tabular-nums', 'lining-nums'] },
  end: { fontFamily: font.regular, fontSize: 13, fontVariant: ['tabular-nums', 'lining-nums'] },
  info: { flex: 1, paddingVertical: 10 },
  slotT: { fontFamily: font.semibold, fontSize: 16 },
  slotM: { fontFamily: font.regular, fontSize: 13.5, marginTop: 1 },
  addRow: { paddingVertical: 8 },
  addBar: { paddingHorizontal: 16, paddingVertical: 4, borderTopWidth: 1, alignItems: 'center' },
  add: { fontFamily: font.semibold, fontSize: 15 },
  sheet: { maxHeight: '88%', borderTopStartRadius: 20, borderTopEndRadius: 20 },
  content: { paddingHorizontal: 18, paddingTop: 14, gap: 12 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  titleInput: { flex: 1, fontFamily: font.medium, fontSize: 19, paddingVertical: 6 },
  send: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  sendT: { fontFamily: font.bold, fontSize: 19, lineHeight: 24 },
  days: { flexDirection: 'row', gap: 4 },
  day: { flex: 1, height: 36, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  dayT: { fontFamily: font.semibold, fontSize: 14 },
  times: { flexDirection: 'row', gap: 8 },
  timeBtn: { flex: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  timeLabel: { fontFamily: font.regular, fontSize: 12.5 },
  timeVal: { fontFamily: font.semibold, fontSize: 18, fontVariant: ['tabular-nums', 'lining-nums'] },
  timeInput: { padding: 0 },
  place: { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontFamily: font.regular, fontSize: 15.5 },
  label: { fontFamily: font.regular, fontSize: 13.5, marginBottom: 6 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  err: { fontFamily: font.semibold, fontSize: 14 },
  quiet: { fontFamily: font.medium, fontSize: 14 },
});

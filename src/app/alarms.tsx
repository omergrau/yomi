// Alarms the person sets: a day, a time and an optional name. They ring in the phone's own clock app.
import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { addDays, fireTime } from '../domain/dates';
import { upcomingAlarms } from '../domain/logic';
import { fmtDate, fmtDay, t as tr } from '../i18n';
import { hasNativePickers, pickTime } from '../pickers';
import { addAlarm, removeAlarm, showToast, useApp } from '../store';
import { font, useTheme } from '../theme';
import { Btn, Chip } from '../components/ui';

const TIME = /^([01]?\d|2[0-3]):[0-5]\d$/;
const pad = (time: string) => (time.length === 4 ? `0${time}` : time);

export default function AlarmsScreen() {
  const t = useTheme();
  const { data, today } = useApp();
  const [date, setDate] = useState(addDays(today, 1));
  const [time, setTime] = useState('07:00');
  const [label, setLabel] = useState('');
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);
  const alarms = upcomingAlarms(data, now);
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i));
  const dayWord = (d: string) => (d === today ? tr.today : d === addDays(today, 1) ? tr.tomorrow : tr.dayName(fmtDay(d)));

  const save = () => {
    if (!TIME.test(time)) return;
    const hhmm = pad(time);
    if (fireTime(date, hhmm, 0) <= Date.now()) {
      showToast(tr.alarmPast);
      return;
    }
    addAlarm({ date, time: hhmm, label: label.trim() || null });
    setLabel('');
  };

  return (
    <ScrollView style={[s.flex, { backgroundColor: t.paper }]} contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">
      <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button" style={s.back}>
        <Text style={[s.link, { color: t.mute }]}>{tr.back}</Text>
      </Pressable>
      <Text style={[s.title, { color: t.ink }]}>{tr.alarms}</Text>
      <Text style={[s.lead, { color: t.mute }]}>{tr.alarmsLead}</Text>

      <View style={[s.card, { backgroundColor: t.wash }]}>
        <View style={s.chips}>
          {days.map((d) => (
            <Chip key={d} label={dayWord(d)} on={d === date} onPress={() => setDate(d)} />
          ))}
        </View>
        <View style={s.row}>
          {hasNativePickers ? (
            <Pressable
              onPress={async () => {
                const picked = await pickTime(time);
                if (picked) setTime(picked);
              }}
              style={[s.time, { backgroundColor: t.paper }]}
              accessibilityRole="button"
              accessibilityLabel={tr.alarmAdd}
            >
              <Text style={[s.timeT, { color: t.ink }]}>{time}</Text>
            </Pressable>
          ) : (
            <TextInput value={time} onChangeText={setTime} maxLength={5} style={[s.time, s.timeT, { color: t.ink, backgroundColor: t.paper }]} accessibilityLabel="HH:MM" />
          )}
          <TextInput
            value={label}
            onChangeText={setLabel}
            maxLength={40}
            placeholder={tr.alarmLabelPh}
            placeholderTextColor={t.soft}
            style={[s.label, { color: t.ink, backgroundColor: t.paper }]}
            accessibilityLabel={tr.alarmLabelPh}
          />
        </View>
        <View style={s.row}>
          <Btn label={tr.alarmAdd} solid onPress={save} />
        </View>
      </View>

      {!alarms.length ? <Text style={[s.none, { color: t.soft }]}>{tr.alarmNone}</Text> : null}
      {alarms.map((a) => (
        <View key={a.id} style={[s.item, { borderBottomColor: t.line }]}>
          <Text style={[s.itemTime, { color: t.ink }]}>{a.time}</Text>
          <View style={s.flex}>
            <Text style={[s.itemT, { color: t.ink }]} numberOfLines={1}>{`${dayWord(a.date)}, ${fmtDate(a.date)}${a.label ? ` · ${a.label}` : ''}`}</Text>
            <Text style={[s.itemSub, { color: a.setAt ? t.accent : t.mute }]}>{a.setAt ? tr.alarmInClock : tr.alarmWaiting}</Text>
          </View>
          <Pressable onPress={() => removeAlarm(a.id)} hitSlop={10} accessibilityRole="button" accessibilityLabel={`${tr.remove}: ${a.time}`}>
            <Text style={[s.remove, { color: t.soft }]}>×</Text>
          </Pressable>
        </View>
      ))}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  page: { paddingHorizontal: 18, paddingTop: 14, paddingBottom: 40 },
  back: { alignSelf: 'flex-start' },
  link: { fontFamily: font.medium, fontSize: 14 },
  title: { fontFamily: font.serif, fontSize: 28, marginTop: 8 },
  lead: { fontFamily: font.regular, fontSize: 13.5, lineHeight: 19, marginTop: 4, marginBottom: 12 },
  card: { borderRadius: 14, padding: 12, gap: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  row: { flexDirection: 'row', gap: 8 },
  time: { width: 104, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8, justifyContent: 'center' },
  timeT: { fontFamily: font.bold, fontSize: 22, fontVariant: ['tabular-nums', 'lining-nums'], textAlign: 'center' },
  label: { flex: 1, borderRadius: 10, paddingHorizontal: 12, fontFamily: font.regular, fontSize: 15 },
  none: { fontFamily: font.regular, fontSize: 14.5, textAlign: 'center', marginTop: 24 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1 },
  itemTime: { fontFamily: font.bold, fontSize: 24, fontVariant: ['tabular-nums', 'lining-nums'] },
  itemT: { fontFamily: font.medium, fontSize: 14.5 },
  itemSub: { fontFamily: font.regular, fontSize: 12.5, marginTop: 1 },
  remove: { fontFamily: font.regular, fontSize: 22, lineHeight: 26, paddingHorizontal: 4 },
});

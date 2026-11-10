import Constants from 'expo-constants';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, AppState, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { clearApiKey, getApiKey, looksLikeKey, setApiKey } from '../assistant/key';
import { checkKey } from '../assistant/run';
import { pickBackup, shareBackup } from '../backup';
import { askCalendar, calendarAccess, listCalendars, type CalendarAccess, type PhoneCalendar } from '../calendar';
import { Btn, Chip, TextLink } from '../components/ui';
import { t as tr } from '../i18n';
import { askExact, askNotifications, reminderAccess, scheduleTest, type ReminderAccess } from '../notifications';
import { exportPayload, importPayload, setCalendarSync, setHiddenCalendars, setTheme, showToast, useApp } from '../store';
import { font, useTheme } from '../theme';

export default function SettingsScreen() {
  const t = useTheme();
  const { data } = useApp();
  const [access, setAccess] = useState<ReminderAccess | null>(null);
  const [cal, setCal] = useState<CalendarAccess>('undetermined');
  const [hasKey, setHasKey] = useState(false);
  const [keyText, setKeyText] = useState('');
  const [keyMsg, setKeyMsg] = useState('');
  useEffect(() => {
    getApiKey().then((k) => setHasKey(!!k));
  }, []);
  const saveKey = async () => {
    if (!looksLikeKey(keyText)) {
      setKeyMsg(tr.aiKeyBadFormat);
      return;
    }
    setKeyMsg(tr.aiKeyChecking);
    const r = await checkKey(keyText.trim());
    if (r !== 'ok') {
      setKeyMsg(tr.aiError[r]);
      return;
    }
    await setApiKey(keyText);
    setKeyText('');
    setHasKey(true);
    setKeyMsg('');
    showToast(tr.aiKeySaved);
  };
  const [cals, setCals] = useState<PhoneCalendar[]>([]);
  const native = Platform.OS !== 'web';

  const refresh = useCallback(() => {
    reminderAccess().then(setAccess).catch(() => {});
    calendarAccess()
      .then(async (a) => {
        setCal(a);
        setCals(a === 'granted' ? await listCalendars() : []);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  const doExport = async () => {
    try {
      await shareBackup(exportPayload());
    } catch {
      showToast(tr.exportBad);
    }
  };

  const doImport = async () => {
    let raw: string | null;
    try {
      raw = await pickBackup();
    } catch {
      showToast(tr.importBad);
      return;
    }
    if (!raw) return;
    const content = raw;
    Alert.alert(tr.importTitle, tr.importBody, [
      { text: tr.cancel, style: 'cancel' },
      {
        text: tr.importYes,
        style: 'destructive',
        onPress: () => {
          try {
            importPayload(content);
            showToast(tr.importDone);
          } catch {
            showToast(tr.importBad);
          }
        },
      },
    ]);
  };

  return (
    <ScrollView style={{ backgroundColor: t.paper }} contentContainerStyle={s.page}>
      <View style={s.head}>
        <Text style={[s.h1, { color: t.ink }]}>{tr.settings}</Text>
        <TextLink label={tr.back} onPress={() => router.back()} />
      </View>

      <Text style={[s.h2, { color: t.ink, borderTopColor: t.line }]}>{tr.look}</Text>
      <View style={s.wrap}>
        {tr.themeOpts.map((o) => (
          <Chip key={o.v} label={o.l} on={data.meta.theme === o.v} onPress={() => setTheme(o.v)} />
        ))}
      </View>

      <Text style={[s.h2, { color: t.ink, borderTopColor: t.line }]}>{tr.reminders}</Text>
      {native && access ? (
        <View style={s.col}>
          <Text style={[s.line, { color: t.ink }]}>{access.notifications ? tr.notifAllowed : tr.notifDenied}</Text>
          {!access.notifications ? (
            <Btn
              label={access.canAsk ? tr.notifAsk : tr.openSettings}
              onPress={() => (access.canAsk ? askNotifications().then(refresh) : Linking.openSettings())}
            />
          ) : null}
          <Text style={[s.line, { color: t.ink }]}>{access.exact ? tr.exactAllowed : tr.exactDenied}</Text>
          {!access.exact ? <Btn label={tr.exactAsk} onPress={() => askExact().then(refresh)} /> : null}
          <Text style={[s.line, { color: t.mute }]}>{tr.scheduled(access.scheduled)}</Text>
          <Btn
            label={tr.testReminder}
            onPress={() => {
              scheduleTest().then(() => {
                showToast(tr.testSet);
                refresh();
              }).catch(() => {});
            }}
          />
          <Text style={[s.note, { color: t.mute }]}>{tr.batteryNote}</Text>
          <TextLink label={tr.openSettings} onPress={() => Linking.openSettings()} />
        </View>
      ) : (
        <Text style={[s.note, { color: t.mute }]}>{tr.webOnlyPhone}</Text>
      )}

      <Text style={[s.h2, { color: t.ink, borderTopColor: t.line }]}>{tr.aiSettingsTitle}</Text>
      <View style={s.col}>
        <Text style={[s.note, { color: t.mute }]}>{tr.aiSettingsNote}</Text>
        {hasKey ? (
          <>
            <Text style={[s.line, { color: t.ink }]}>{tr.aiKeyOn}</Text>
            <TextLink label={tr.memoryLink(data.notes.length)} onPress={() => router.push('/memory')} />
            <TextLink
              label={tr.aiRemoveKey}
              onPress={async () => {
                await clearApiKey();
                setHasKey(false);
                showToast(tr.aiKeyRemoved);
              }}
            />
          </>
        ) : (
          <>
            <TextInput
              value={keyText}
              onChangeText={(v) => {
                setKeyText(v);
                setKeyMsg('');
              }}
              placeholder={tr.aiKeyPh}
              placeholderTextColor={t.soft}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              style={[s.keyInput, { color: t.ink, backgroundColor: t.wash }]}
              accessibilityLabel={tr.aiSettingsTitle}
            />
            {keyMsg ? <Text style={[s.note, { color: t.ink }]}>{keyMsg}</Text> : null}
            <Btn label={tr.aiSaveKey} solid onPress={saveKey} />
          </>
        )}
      </View>

      <Text style={[s.h2, { color: t.ink, borderTopColor: t.line }]}>{tr.calendarTitle}</Text>
      {cal === 'unavailable' ? <Text style={[s.note, { color: t.mute }]}>{tr.calendarPhoneOnly}</Text> : null}
      {cal !== 'unavailable' ? (
        <Pressable
          onPress={() => setCalendarSync(!(data.meta.calendarSync && cal === 'granted')).then((ok) => (ok ? refresh() : showToast(tr.calendarSyncDenied)))}
          style={s.calRow}
          accessibilityRole="switch"
          accessibilityState={{ checked: data.meta.calendarSync && cal === 'granted' }}
          aria-checked={data.meta.calendarSync && cal === 'granted'}
          accessibilityLabel={tr.calendarSync}
          accessibilityHint={tr.calendarSyncWhy}
        >
          <View style={[s.box, { borderColor: data.meta.calendarSync && cal === 'granted' ? t.accent : t.soft, backgroundColor: data.meta.calendarSync && cal === 'granted' ? t.accent : 'transparent' }]}>
            {data.meta.calendarSync && cal === 'granted' ? <Text style={[s.boxT, { color: t.onAccent }]}>✓</Text> : null}
          </View>
          <View style={s.flex}>
            <Text style={[s.line, { color: t.ink }]}>{tr.calendarSync}</Text>
            <Text style={[s.note, { color: t.mute }]}>{tr.calendarSyncWhy}</Text>
          </View>
        </Pressable>
      ) : null}
      {cal === 'undetermined' ? (
        <View style={s.col}>
          <Text style={[s.note, { color: t.mute }]}>{tr.calendarConnectWhy}</Text>
          <Btn label={tr.calendarConnect} solid onPress={() => askCalendar().then(refresh)} />
        </View>
      ) : null}
      {cal === 'denied' ? (
        <View style={s.col}>
          <Text style={[s.note, { color: t.mute }]}>{tr.calendarDenied}</Text>
          <TextLink label={tr.openSettings} onPress={() => Linking.openSettings()} />
        </View>
      ) : null}
      {cal === 'granted' ? (
        <View style={s.col}>
          <Text style={[s.note, { color: t.mute }]}>{cals.length ? tr.calendarConnected : tr.calendarNone}</Text>
          {cals.map((c) => {
            const shown = !data.meta.hiddenCalendars.includes(c.id);
            return (
              <Pressable
                key={c.id}
                onPress={() => setHiddenCalendars(shown ? [...data.meta.hiddenCalendars, c.id] : data.meta.hiddenCalendars.filter((x) => x !== c.id))}
                style={s.calRow}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: shown }}
                aria-checked={shown}
                accessibilityLabel={c.title}
              >
                <View style={[s.box, { borderColor: shown ? t.accent : t.soft, backgroundColor: shown ? t.accent : 'transparent' }]}>
                  {shown ? <Text style={[s.boxT, { color: t.onAccent }]}>✓</Text> : null}
                </View>
                <View style={[s.calDot, { backgroundColor: c.color || t.soft }]} />
                <View style={s.flex}>
                  <Text style={[s.line, { color: t.ink }]} numberOfLines={1}>{c.title}</Text>
                  {c.account ? <Text style={[s.note, { color: t.mute }]} numberOfLines={1}>{c.account}</Text> : null}
                </View>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      <Text style={[s.h2, { color: t.ink, borderTopColor: t.line }]}>{tr.backup}</Text>
      <Text style={[s.note, { color: t.mute }]}>{tr.backupNote}</Text>
      {native ? (
        <View style={s.col}>
          <Btn label={tr.exportBtn} solid onPress={doExport} />
          <Btn label={tr.importBtn} onPress={doImport} />
        </View>
      ) : (
        <Text style={[s.note, { color: t.mute }]}>{tr.webOnlyPhone}</Text>
      )}

      <Text style={[s.version, { color: t.soft }]}>{tr.version(Constants.expoConfig?.version ?? '')}</Text>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  page: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 32 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  h1: { fontFamily: font.black, fontSize: 38, lineHeight: 46 },
  h2: { fontFamily: font.serif, fontSize: 20, marginTop: 22, paddingTop: 16, marginBottom: 10, borderTopWidth: 1 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  col: { gap: 9, alignItems: 'stretch', marginTop: 4 },
  line: { fontFamily: font.medium, fontSize: 15.5, fontVariant: ['lining-nums'] },
  note: { fontFamily: font.regular, fontSize: 14.5, lineHeight: 20 },
  flex: { flex: 1 },
  keyInput: { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontFamily: font.regular, fontSize: 15 },
  calRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
  box: { width: 20, height: 20, borderRadius: 5, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  boxT: { fontFamily: font.bold, fontSize: 12, lineHeight: 15 },
  calDot: { width: 10, height: 10, borderRadius: 5 },
  version: { fontFamily: font.regular, fontSize: 13, textAlign: 'center', marginTop: 28 },
});

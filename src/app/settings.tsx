import Constants from 'expo-constants';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, AppState, Linking, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { pickBackup, shareBackup } from '../backup';
import { Btn, Chip, TextLink } from '../components/ui';
import { t as tr } from '../i18n';
import { askExact, askNotifications, reminderAccess, scheduleTest, type ReminderAccess } from '../notifications';
import { exportPayload, importPayload, setTheme, showToast, useApp } from '../store';
import { font, useTheme } from '../theme';

export default function SettingsScreen() {
  const t = useTheme();
  const { data } = useApp();
  const [access, setAccess] = useState<ReminderAccess | null>(null);
  const native = Platform.OS !== 'web';

  const refresh = useCallback(() => {
    reminderAccess().then(setAccess).catch(() => {});
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
  version: { fontFamily: font.regular, fontSize: 13, textAlign: 'center', marginTop: 28 },
});

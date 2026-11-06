import { Assistant_400Regular, Assistant_500Medium, Assistant_600SemiBold, Assistant_700Bold } from '@expo-google-fonts/assistant';
import { FrankRuhlLibre_300Light, FrankRuhlLibre_500Medium, FrankRuhlLibre_900Black } from '@expo-google-fonts/frank-ruhl-libre';
import * as Notifications from 'expo-notifications';
import { useFonts } from 'expo-font';
import { Stack, router } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { TaskSheet } from '../components/TaskSheet';
import { Btn, ToastHost } from '../components/ui';
import { t as tr } from '../i18n';
import { setupNotifications } from '../notifications';
import { getApp, initStore, setView, useApp } from '../store';
import { font, useIsDark, useTheme } from '../theme';

SplashScreen.preventAutoHideAsync().catch(() => {});
setupNotifications();
if (Platform.OS === 'web' && typeof document !== 'undefined') document.documentElement.dir = 'rtl';
initStore();

function Shell() {
  const t = useTheme();
  const dark = useIsDark();
  const { ready } = useApp();
  const [fonts] = useFonts({
    Assistant_400Regular, Assistant_500Medium, Assistant_600SemiBold, Assistant_700Bold,
    FrankRuhlLibre_300Light, FrankRuhlLibre_500Medium, FrankRuhlLibre_900Black,
  });

  useEffect(() => {
    if (fonts && ready) SplashScreen.hideAsync().catch(() => {});
  }, [fonts, ready]);

  // Tapping a reminder opens the day that task belongs to.
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const sub = Notifications.addNotificationResponseReceivedListener((r) => {
      const id = r.notification.request.content.data?.taskId as string | undefined;
      const date = id ? getApp().data.tasks[id]?.date : null;
      if (date) {
        setView(date);
        router.navigate('/');
      }
    });
    return () => sub.remove();
  }, []);

  if (!fonts) return <View style={{ flex: 1, backgroundColor: t.paper }} />;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.paper }} edges={['top', 'bottom']}>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.paper }, animation: 'fade' }} />
      <ToastHost />
      <TaskSheet />
    </SafeAreaView>
  );
}

export function ErrorBoundary({ retry }: { error: Error; retry: () => Promise<void> }) {
  return (
    <View style={s.crash}>
      <Text style={s.crashT}>{tr.crashTitle}</Text>
      <Text style={s.crashB}>{tr.crashBody}</Text>
      <Btn label={tr.crashRetry} solid onPress={retry} style={{ flex: 0, alignSelf: 'stretch' }} />
    </View>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <Shell />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const s = StyleSheet.create({
  crash: { flex: 1, justifyContent: 'center', padding: 28, gap: 10, backgroundColor: '#FCFCFA' },
  crashT: { fontFamily: font.serif, fontSize: 28, color: '#23262A' },
  crashB: { fontFamily: font.regular, fontSize: 16, color: '#5F6367' },
});

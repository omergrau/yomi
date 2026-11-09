// The person's own Claude API key. It is kept encrypted on this phone only and never leaves it except
// to call the Claude API directly.
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const KEY = 'yomi.claude.apiKey';
let webKey: string | null = null;

export async function getApiKey(): Promise<string | null> {
  if (Platform.OS === 'web') return webKey;
  try {
    return await SecureStore.getItemAsync(KEY);
  } catch {
    return null;
  }
}

export async function setApiKey(value: string) {
  const clean = value.trim();
  if (Platform.OS === 'web') webKey = clean;
  else await SecureStore.setItemAsync(KEY, clean);
}

export async function clearApiKey() {
  if (Platform.OS === 'web') webKey = null;
  else await SecureStore.deleteItemAsync(KEY);
}

export const looksLikeKey = (v: string) => /^sk-ant-[A-Za-z0-9_-]{20,}$/.test(v.trim());

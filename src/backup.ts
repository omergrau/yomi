import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { toIso } from './domain/dates';

export async function shareBackup(payload: string) {
  const file = new File(Paths.cache, `yomi-backup-${toIso(new Date())}.json`);
  file.create({ overwrite: true });
  file.write(payload);
  await Sharing.shareAsync(file.uri, { mimeType: 'application/json', dialogTitle: 'עוזר אישי' });
}

/** Returns the file's text, or null when nothing was chosen. */
export async function pickBackup(): Promise<string | null> {
  const res = await DocumentPicker.getDocumentAsync({ type: ['application/json', '*/*'], copyToCacheDirectory: true, multiple: false });
  if (res.canceled || !res.assets?.[0]) return null;
  return new File(res.assets[0].uri).text();
}

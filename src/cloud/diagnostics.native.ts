import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Application from 'expo-application';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import { createSyncDiagnostics } from './sync-diagnostics';

const diagnostics = createSyncDiagnostics(AsyncStorage);
let activeShare: Promise<void> | null = null;
export const recordCloudDiagnostic = diagnostics.record;

export async function readCloudDiagnostics(): Promise<string> {
  return JSON.stringify({
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    platform: Platform.OS,
    appVersion: Application.nativeApplicationVersion ?? 'unknown',
    build: Application.nativeBuildVersion ?? 'unknown',
    events: await diagnostics.read(),
  }, null, 2);
}

export function shareCloudDiagnostics(): Promise<void> {
  activeShare ??= (async () => {
    if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is unavailable on this device.');
    const file = new File(Paths.cache, 'puptime-sync-diagnostics.json');
    file.create({ overwrite: true });
    file.write(await readCloudDiagnostics());
    // Android share targets can read after the chooser closes. Replace this bounded cache file on the next export.
    await Sharing.shareAsync(file.uri, { dialogTitle: 'Export Puptime sync diagnostics', mimeType: 'application/json', UTI: 'public.json' });
  })().finally(() => { activeShare = null; });
  return activeShare;
}

import { File, Paths } from 'expo-file-system';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';

import { dateKey, type PuppyEvent } from './domain';
import { csvToEvents, eventsToCsv } from './export';

export async function pickEventsCsv(): Promise<PuppyEvent[] | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: '*/*',
    multiple: false,
    copyToCacheDirectory: true,
  });
  if (result.canceled) return null;

  const file = new File(result.assets[0].uri);
  return csvToEvents(await file.text());
}

export async function shareEventsCsv(events: PuppyEvent[]): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('Sharing is unavailable on this device.');
  }

  const file = new File(Paths.cache, `puptime-activity-${dateKey(Date.now())}.csv`);
  file.create({ overwrite: true });
  file.write(eventsToCsv(events));

  await Sharing.shareAsync(file.uri, {
    dialogTitle: 'Export Puptime activity',
    mimeType: 'text/csv',
    UTI: 'public.comma-separated-values-text',
  });
}

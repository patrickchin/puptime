import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { dateKey, type PuppyEvent } from './domain';
import { eventsToCsv } from './export';

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

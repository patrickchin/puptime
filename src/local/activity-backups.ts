import { z } from 'zod';
import { dateKey, type PuppyEvent } from '../domain.ts';
import { identifierSchema } from '../cloud/protocol.ts';
import { parseEvents } from '../storage-validation.ts';

const backupSchema = z.strictObject({
  format: z.literal('puptime-activity'), version: z.literal(1),
  createdAt: z.number().int().nonnegative().max(8640000000000000),
  petId: identifierSchema, puppyName: z.string().min(1).max(256),
  events: z.unknown().transform(parseEvents),
});
export type ActivityBackup = z.infer<typeof backupSchema>;
export type BackupSummary = Omit<ActivityBackup, 'events'> & { id: string; count: number; bytes: number };
export interface BackupFiles {
  list(): Promise<{ id: string; bytes: number }[]>;
  read(id: string): Promise<string>;
  write(id: string, content: string): Promise<void>;
  remove(id: string): Promise<void>;
}
export const backupFileName = /^bkp_[a-f0-9]{32}\.json$/;
const parse = (content: string) => backupSchema.parse(JSON.parse(content));

// Activity only: no images, account credentials, sync queues or database copies.
export function createActivityBackups(options: {
  files: BackupFiles; petId: string; newId: () => string; now?: () => number;
  read: () => Promise<{ events: PuppyEvent[]; puppyName: string }>;
  restore: (events: PuppyEvent[]) => Promise<{ imported: number; skipped: number }>;
}) {
  const { files } = options, now = options.now ?? Date.now;
  let queue: Promise<unknown> = Promise.resolve(), savedDay: string | undefined;
  function serial<T>(action: () => Promise<T>) {
    const result = queue.then(action); queue = result.catch(() => undefined); return result;
  }
  async function list() {
    const backups: BackupSummary[] = []; let unreadable = 0;
    for (const file of await files.list()) {
      if (!backupFileName.test(file.id)) continue;
      const content = await files.read(file.id);
      try {
        const { events, ...metadata } = parse(content);
        backups.push({ ...metadata, id: file.id, bytes: file.bytes, count: events.length });
      } catch { unreadable++; } // Preserve damaged files for manual recovery.
    }
    backups.sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
    return { backups, unreadable };
  }
  async function capture() {
    const timestamp = now(), day = dateKey(timestamp);
    if (savedDay === day) return;
    const { backups } = await list();
    if (backups.some(item => item.petId === options.petId && dateKey(item.createdAt) === day)) {
      for (const old of backups.slice(30)) await files.remove(old.id);
      savedDay = day; return;
    }
    const data = await options.read();
    if (!data.events.length) return; // Never rotate good history out for an empty journal.
    const backup = backupSchema.parse({ ...data, format: 'puptime-activity', version: 1, createdAt: timestamp, petId: options.petId });
    const id = `${options.newId()}.json`;
    if (!backupFileName.test(id)) throw new Error('Invalid backup identifier.');
    const content = JSON.stringify(backup);
    await files.write(id, content);
    // Verify durable contents before removing any older snapshots.
    if (await files.read(id) !== content) throw new Error('Backup verification failed.');
    for (const old of [{ id, createdAt: timestamp }, ...backups].sort((a,b) => b.createdAt-a.createdAt).slice(30)) await files.remove(old.id);
    savedDay = day;
  }
  async function read(id: string) {
    if (!backupFileName.test(id)) throw new Error('Invalid backup identifier.');
    return parse(await files.read(id));
  }
  return {
    capture: () => serial(capture),
    list: () => serial(list),
    read: (id: string) => serial(() => read(id)),
    restore: (id: string) => serial(async () => options.restore((await read(id)).events)),
  };
}

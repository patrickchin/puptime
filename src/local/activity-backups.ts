import { z } from 'zod';
import { dateKey, type PuppyEvent } from '../domain.ts';
import { identifierSchema } from '../cloud/protocol.ts';
import { parseEvents } from '../storage-validation.ts';
import type { SqlExecutor } from './database.ts';

export const backupReasons = ['daily', 'before-update', 'account-change', 'cloud-replace', 'import', 'recovery', 'delete'] as const;
export type BackupReason = typeof backupReasons[number];
export type BackupGuard = (sql: SqlExecutor, reason: BackupReason) => Promise<void>;

const backupSchema = z.strictObject({
  format: z.literal('puptime-activity'), version: z.literal(1),
  createdAt: z.number().int().nonnegative().max(8640000000000000),
  petId: identifierSchema, puppyName: z.string().min(1).max(256),
  reason: z.enum(backupReasons).default('daily'), appVersion: z.string().min(1).max(128).optional(),
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
      try {
        const { events, ...metadata } = parse(await files.read(file.id));
        backups.push({ ...metadata, id: file.id, bytes: file.bytes, count: events.length });
      } catch { unreadable++; } // Preserve damaged files for manual recovery.
    }
    backups.sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
    return { backups, unreadable };
  }
  async function prune(backups: BackupSummary[]) {
    const daily = backups.filter(item => item.reason === 'daily');
    const safety = backups.filter(item => item.reason !== 'daily');
    // Keep the latest checkpoint for every safety reason, even after many deletions/imports.
    const protectedReasons = new Set<BackupReason>(), keep = new Set<string>();
    for (const item of safety) if (!protectedReasons.has(item.reason)) { protectedReasons.add(item.reason); keep.add(item.id); }
    for (const item of safety) if (keep.size < 10) keep.add(item.id);
    for (const old of [...daily.slice(30), ...safety.filter(item => !keep.has(item.id))]) await files.remove(old.id);
  }
  async function capture(reason: BackupReason, read: typeof options.read, appVersion?: string) {
    const timestamp = now(), day = dateKey(timestamp);
    if (reason === 'daily' && savedDay === day) return;
    const { backups } = await list();
    if (reason === 'daily' && backups.some(item => item.reason === 'daily' && item.petId === options.petId && dateKey(item.createdAt) === day)) {
      await prune(backups);
      savedDay = day; return;
    }
    const data = await read();
    if (!data.events.length) return; // Never rotate good history out for an empty journal.
    const backup = backupSchema.parse({ ...data, format: 'puptime-activity', version: 1, createdAt: timestamp, petId: options.petId, reason, ...(appVersion ? { appVersion } : {}) });
    if (reason !== 'daily') {
      const latest = backups.find(item => item.petId === options.petId && item.reason === reason && item.appVersion === appVersion);
      if (latest) {
        const previous = parse(await files.read(latest.id));
        if (previous.puppyName === backup.puppyName && JSON.stringify(previous.events) === JSON.stringify(backup.events)) { await prune(backups); return; }
      }
    }
    const id = `${options.newId()}.json`;
    if (!backupFileName.test(id)) throw new Error('Invalid backup identifier.');
    const content = JSON.stringify(backup);
    await files.write(id, content);
    // Verify durable contents before removing any older snapshots.
    if (await files.read(id) !== content) throw new Error('Backup verification failed.');
    const { events, ...metadata } = backup;
    await prune([{ ...metadata, id, count: events.length, bytes: content.length }, ...backups].sort((a,b) => b.createdAt-a.createdAt));
    if (reason === 'daily') savedDay = day;
  }
  async function read(id: string) {
    if (!backupFileName.test(id)) throw new Error('Invalid backup identifier.');
    return parse(await files.read(id));
  }
  return {
    capture: (reason: BackupReason = 'daily', read = options.read, appVersion?: string) => serial(() => capture(reason, read, appVersion)),
    list: () => serial(list),
    read: (id: string) => serial(() => read(id)),
    // Release the file queue before entering a DB transaction, whose guard saves a recovery checkpoint.
    restore: async (id: string) => options.restore((await serial(() => read(id))).events),
  };
}

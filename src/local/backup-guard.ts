import { eventDataFromSql, type EventSqlRow } from '../record-sql.ts';
import { identifierSchema } from '../cloud/protocol.ts';
import { createActivityBackups, type ActivityBackup, type BackupFiles, type BackupGuard } from './activity-backups.ts';
import type { SqlExecutor } from './database.ts';
import type { PuppyEvent } from '../domain.ts';

export async function readBackupData(sql: SqlExecutor, petId: string) {
  const puppy = await sql.getFirstAsync<{ name: string }>('SELECT name FROM puppies WHERE id=?', petId);
  if (!puppy) throw new Error('The local puppy could not be found.');
  const rows = await sql.getAllAsync<EventSqlRow & { id: string }>('SELECT * FROM events WHERE pet_id=? ORDER BY at DESC,id DESC', petId);
  return { puppyName: puppy.name, events: rows.map(({ id, ...row }) => ({ id, ...eventDataFromSql(row) })) };
}

export function createBackupGuard(options: {
  files: BackupFiles; petId: string; newId: () => string; appVersion: string;
  restore: (events: PuppyEvent[], puppy: Pick<ActivityBackup, 'petId' | 'puppyName'>) => Promise<{ imported: number; skipped: number }>;
}) {
  const service = createActivityBackups({ ...options, read: async () => { throw new Error('Native backups require a database snapshot.'); } });
  // Always called inside the DB queue, using its executor directly. Never reenter that queue.
  const checkpoint: BackupGuard = async (sql, reason) => {
    const puppies = await sql.getAllAsync<{ id: string }>('SELECT id FROM puppies ORDER BY id');
    for (const { id } of puppies) await service.capture(reason, () => readBackupData(sql, id), options.appVersion, id);
  };
  return { service, checkpoint };
}

export async function checkpointBeforeUpgrade(sql: SqlExecutor, appVersion: string, checkpoint: BackupGuard) {
  const previous = await sql.getFirstAsync<{ value: string }>("SELECT value FROM metadata WHERE key='backup_app_version'");
  if (previous?.value === appVersion) return;
  await checkpoint(sql, 'before-update');
  await sql.runAsync("INSERT INTO metadata(key,value) VALUES ('backup_app_version',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", appVersion);
}

export async function existingBackupPet(sql: SqlExecutor) {
  if (!await sql.getFirstAsync("SELECT name FROM sqlite_master WHERE type='table' AND name='metadata'")) return null;
  const pet = await sql.getFirstAsync<{ value: string }>("SELECT value FROM metadata WHERE key='active_pet_id'");
  return pet ? identifierSchema.parse(pet.value) : null;
}

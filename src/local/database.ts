import { STARTER_SCHEDULE } from '../domain.ts';
import { legacyKeys, petSettingKeys, storageKeys, type LegacySnapshot } from './legacy.ts';
export type SqlValue = string | number | null | Uint8Array;
export interface SqlExecutor {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, ...values: SqlValue[]): Promise<{ changes: number }>;
  getFirstAsync<T>(sql: string, ...values: SqlValue[]): Promise<T | null>;
  getAllAsync<T>(sql: string, ...values: SqlValue[]): Promise<T[]>;
}
export interface SqlConnection extends SqlExecutor {
  withTransactionAsync(action: () => Promise<void>): Promise<void>;
  closeAsync(): Promise<void>;
}
export interface LocalDatabase {
  read<T>(action: (sql: SqlExecutor) => Promise<T>): Promise<T>;
  write<T>(action: (sql: SqlExecutor) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
const pauses = [25, 75, 200];
async function retryBusy<T>(action: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await action(); }
    catch (error) {
      if (!(error instanceof Error) || !/SQLITE_BUSY|SQLITE_LOCKED|database is (?:locked|busy)/i.test(error.message) || attempt >= pauses.length) throw error;
      await new Promise((resolve) => setTimeout(resolve, pauses[attempt]));
    }
  }
}

// The connection is private to one runtime. Every read and write uses this queue.
// Unlike Expo's exclusive helper, withTransactionAsync uses this configured connection.
export async function createLocalDatabase(connection: SqlConnection): Promise<LocalDatabase> {
  await retryBusy(() => connection.execAsync('PRAGMA busy_timeout = 250; PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;'));
  let queue: Promise<unknown> = Promise.resolve();
  function serial<T>(action: () => Promise<T>): Promise<T> {
    const result = queue.then(action);
    queue = result.catch(() => undefined);
    return result;
  }
  return {
    read: (action) => serial(() => action(connection)),
    write: (action) => serial(() => retryBusy(async () => {
      let result: Awaited<ReturnType<typeof action>>;
      await connection.withTransactionAsync(async () => { result = await action(connection); });
      return result!;
    })),
    close: () => serial(() => connection.closeAsync()),
  };
}

export const localSchema = `
CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS puppies (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS events (
  pet_id TEXT NOT NULL REFERENCES puppies(id) ON DELETE CASCADE,
  id TEXT NOT NULL, at INTEGER NOT NULL, body TEXT NOT NULL CHECK(json_valid(body)),
  PRIMARY KEY(pet_id,id)
);
CREATE INDEX IF NOT EXISTS events_by_pet_time ON events(pet_id,at DESC,id);
CREATE TABLE IF NOT EXISTS routines (
  pet_id TEXT NOT NULL REFERENCES puppies(id) ON DELETE CASCADE,
  id TEXT NOT NULL, minutes INTEGER NOT NULL CHECK(minutes BETWEEN 0 AND 1439), body TEXT NOT NULL CHECK(json_valid(body)),
  PRIMARY KEY(pet_id,id)
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS pet_settings (pet_id TEXT NOT NULL REFERENCES puppies(id) ON DELETE CASCADE, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(pet_id,key));
CREATE TABLE IF NOT EXISTS legacy_snapshots (key TEXT PRIMARY KEY NOT NULL, raw_value TEXT);
`;

export async function migrateLegacy(database: LocalDatabase, source: LegacySnapshot | (() => Promise<LegacySnapshot>), newId?: () => string): Promise<{ petId: string; migrated: boolean }> {
  return database.write(async (sql) => {
    await sql.execAsync(localSchema);
    const version = await sql.getFirstAsync<{ value: string }>("SELECT value FROM metadata WHERE key = 'schema_version'");
    if (version && !['1','2'].includes(version.value)) throw new Error('Unsupported or newer local database schema.');
    if (version) {
      const pet = await sql.getFirstAsync<{ value: string }>("SELECT value FROM metadata WHERE key = 'active_pet_id'");
      const complete = await sql.getFirstAsync<{ value: string }>("SELECT value FROM metadata WHERE key = 'migration_complete'");
      if (!pet || complete?.value !== '1' || !await sql.getFirstAsync('SELECT id FROM puppies WHERE id = ?', pet.value)) throw new Error('The local migration metadata is incomplete.');
      if (version.value === '1') {
        for (const key of petSettingKeys) {
          await sql.runAsync('INSERT INTO pet_settings(pet_id,key,value) SELECT ?,key,value FROM settings WHERE key=?', pet.value, key);
          await sql.runAsync('DELETE FROM settings WHERE key=?', key);
        }
        await sql.runAsync("UPDATE metadata SET value='2' WHERE key='schema_version'");
      }
      return { petId: pet.value, migrated: false };
    }
    const snapshot = typeof source === 'function' ? await source() : source;
    const petId = newId ? newId() : (await sql.getFirstAsync<{ id: string }>('SELECT lower(hex(randomblob(16))) AS id'))!.id;
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(petId)) throw new Error('Invalid initial puppy identifier.');
    await sql.runAsync('INSERT INTO puppies(id,name) VALUES (?,?)', petId, 'My puppy');
    for (const event of snapshot.events) await sql.runAsync('INSERT INTO events(pet_id,id,at,body) VALUES (?,?,?,?)', petId, event.id, event.at, JSON.stringify(event));
    for (const routine of snapshot.schedule ?? STARTER_SCHEDULE) await sql.runAsync('INSERT INTO routines(pet_id,id,minutes,body) VALUES (?,?,?,?)', petId, routine.id, routine.minutes, JSON.stringify(routine));
    for (const key of legacyKeys) {
      const raw = snapshot.raw[key];
      await sql.runAsync('INSERT INTO legacy_snapshots(key,raw_value) VALUES (?,?)', key, raw);
      if (raw !== null && key !== storageKeys.events && key !== storageKeys.schedule) {
        if (petSettingKeys.has(key)) await sql.runAsync('INSERT INTO pet_settings(pet_id,key,value) VALUES (?,?,?)', petId, key, raw);
        else await sql.runAsync('INSERT INTO settings(key,value) VALUES (?,?)', key, raw);
      }
    }
    for (const [key, value] of Object.entries({ schema_version: '2', active_pet_id: petId, migration_complete: '1', show_onboarding: String(snapshot.showOnboarding) })) {
      await sql.runAsync('INSERT INTO metadata(key,value) VALUES (?,?)', key, value);
    }
    return { petId, migrated: true };
  });
}

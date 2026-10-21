import { STARTER_SCHEDULE } from '../domain.ts';
import { identifierSchema } from '../cloud/protocol.ts';
import {eventSqlDefinition,routineSqlDefinition,routineSqlValues,upsertRoutineSql} from '../record-sql.ts';
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

const revisionChangesIndex='CREATE INDEX IF NOT EXISTS local_revision_changes ON local_revisions(pet_id,kind,sequence DESC);';
export const localSchema = `
CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS puppies (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS events (
  pet_id TEXT NOT NULL REFERENCES puppies(id) ON DELETE CASCADE,
  id TEXT NOT NULL CHECK(length(id) BETWEEN 1 AND 256),
  ${eventSqlDefinition}, PRIMARY KEY(pet_id,id)
);
CREATE INDEX IF NOT EXISTS events_by_pet_time ON events(pet_id,at DESC,id DESC);
CREATE INDEX IF NOT EXISTS events_by_pet_activity ON events(pet_id,type,custom_label,at DESC,id DESC);
CREATE INDEX IF NOT EXISTS events_open_nap ON events(pet_id,at DESC,id DESC) WHERE type='nap' AND end_state=1;
CREATE INDEX IF NOT EXISTS events_closed_nap ON events(pet_id,ended_at,at) WHERE type='nap' AND end_state=2;
CREATE INDEX IF NOT EXISTS events_latest_activity ON events(pet_id,type,custom_label,MAX(at,COALESCE(ended_at,at)) DESC,id DESC) WHERE estimated IS NOT 1;
CREATE TABLE IF NOT EXISTS routines (
  pet_id TEXT NOT NULL REFERENCES puppies(id) ON DELETE CASCADE,
  id TEXT NOT NULL CHECK(length(id) BETWEEN 1 AND 256),
  ${routineSqlDefinition}, PRIMARY KEY(pet_id,id)
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS pet_settings (pet_id TEXT NOT NULL REFERENCES puppies(id) ON DELETE CASCADE, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(pet_id,key));
CREATE TABLE IF NOT EXISTS local_revisions (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT, pet_id TEXT NOT NULL REFERENCES puppies(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, local_id TEXT NOT NULL, before_data TEXT CHECK(before_data IS NULL OR json_valid(before_data)),
  after_data TEXT CHECK(after_data IS NULL OR json_valid(after_data)), created_at INTEGER NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('local','enrollment','cloud','restore'))
);
CREATE INDEX IF NOT EXISTS local_revision_history ON local_revisions(pet_id,kind,local_id,sequence DESC);
${revisionChangesIndex}
CREATE TABLE IF NOT EXISTS local_sync_owner (
  singleton INTEGER PRIMARY KEY CHECK(singleton=1), generation TEXT NOT NULL UNIQUE,
  account_id TEXT NOT NULL, device_id TEXT NOT NULL, cursor INTEGER NOT NULL DEFAULT 0 CHECK(cursor>=0),
  pending_pet_id TEXT REFERENCES puppies(id), resyncing INTEGER NOT NULL DEFAULT 0 CHECK(resyncing IN (0,1)), staging_cursor INTEGER NOT NULL DEFAULT 0 CHECK(staging_cursor>=0),
  staging_complete INTEGER NOT NULL DEFAULT 0 CHECK(staging_complete IN (0,1))
);
CREATE TABLE IF NOT EXISTS local_sync_pets (
  pet_id TEXT PRIMARY KEY REFERENCES puppies(id) ON DELETE CASCADE,
  generation TEXT NOT NULL REFERENCES local_sync_owner(generation) ON DELETE CASCADE,
  cloud_pet_id TEXT, enrollment TEXT NOT NULL CHECK(json_valid(enrollment)),
  status TEXT NOT NULL CHECK(status IN ('preparing','active')), UNIQUE(generation,cloud_pet_id)
);
CREATE TABLE IF NOT EXISTS local_sync_outbox (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT, operation_id TEXT NOT NULL UNIQUE,
  generation TEXT NOT NULL REFERENCES local_sync_owner(generation) ON DELETE CASCADE,
  local_pet_id TEXT NOT NULL REFERENCES puppies(id) ON DELETE CASCADE,
  local_kind TEXT NOT NULL, local_id TEXT NOT NULL, change_json TEXT NOT NULL CHECK(json_valid(change_json)),
  mutation_json TEXT CHECK(mutation_json IS NULL OR json_valid(mutation_json)), blocked_reason TEXT
);
CREATE INDEX IF NOT EXISTS local_sync_pending ON local_sync_outbox(generation,sequence);
CREATE TABLE IF NOT EXISTS local_sync_records (
  generation TEXT NOT NULL REFERENCES local_sync_owner(generation) ON DELETE CASCADE,
  record_id TEXT NOT NULL, body TEXT NOT NULL CHECK(json_valid(body)), PRIMARY KEY(generation,record_id)
);
CREATE TABLE IF NOT EXISTS local_sync_acks (
  generation TEXT NOT NULL REFERENCES local_sync_owner(generation) ON DELETE CASCADE,
  operation_id TEXT NOT NULL, local_sequence INTEGER NOT NULL, mutation_json TEXT NOT NULL CHECK(json_valid(mutation_json)),
  result_json TEXT NOT NULL CHECK(json_valid(result_json)), outcome TEXT NOT NULL DEFAULT 'accepted' CHECK(outcome IN ('accepted','rejected')), PRIMARY KEY(generation,operation_id)
);
CREATE TABLE IF NOT EXISTS local_sync_baseline (
  generation TEXT NOT NULL REFERENCES local_sync_owner(generation) ON DELETE CASCADE,
  record_id TEXT NOT NULL, body TEXT NOT NULL CHECK(json_valid(body)), PRIMARY KEY(generation,record_id)
);
`;

export async function initializeLocalDatabase(database: LocalDatabase, newId?: () => string, beforeInitialize?: (sql: SqlExecutor) => Promise<void>): Promise<{ petId: string }> {
  return database.write(async (sql) => {
    await beforeInitialize?.(sql);
    const metadata = await sql.getFirstAsync("SELECT name FROM sqlite_master WHERE type='table' AND name='metadata'");
    if (metadata) {
      const version = await sql.getFirstAsync<{ value: string }>("SELECT value FROM metadata WHERE key='schema_version'");
      if (!version) throw new Error('The local database metadata is incomplete.');
      if (version.value !== '4') throw new Error('Unsupported development or newer local database schema. The original data has been preserved.');
      const pet = await sql.getFirstAsync<{ value: string }>("SELECT value FROM metadata WHERE key = 'active_pet_id'");
      const onboarding = await sql.getFirstAsync<{ value: string }>("SELECT value FROM metadata WHERE key='show_onboarding'");
      const required=['metadata','puppies','events','routines','settings','pet_settings','local_revisions','local_sync_owner','local_sync_pets','local_sync_outbox','local_sync_records','local_sync_acks','local_sync_baseline'];
      const tables=await sql.getAllAsync<{name:string}>("SELECT name FROM sqlite_master WHERE type='table'");
      if(required.some(name=>!tables.some(table=>table.name===name))||!pet||!identifierSchema.safeParse(pet.value).success||!onboarding||!['true','false'].includes(onboarding.value)
        ||!await sql.getFirstAsync('SELECT id FROM puppies WHERE id=?',pet.value)) throw new Error('The local database metadata or active puppy is incomplete.');
      await sql.execAsync(revisionChangesIndex);
      return { petId: pet.value };
    }
    if(await sql.getFirstAsync("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' LIMIT 1")) throw new Error('The existing local database is incomplete. The original data has been preserved.');
    await sql.execAsync(localSchema);
    const petId = identifierSchema.parse(newId ? newId() : (await sql.getFirstAsync<{ id: string }>("SELECT 'pet_' || lower(hex(randomblob(16))) AS id"))!.id);
    await sql.runAsync('INSERT INTO puppies(id,name) VALUES (?,?)', petId, 'My puppy');
    for (const {id,...data} of STARTER_SCHEDULE) await sql.runAsync(upsertRoutineSql,petId,id,...routineSqlValues(data));
    for (const [key, value] of Object.entries({ schema_version: '4', active_pet_id: petId, show_onboarding: 'true', first_launch_step:'welcome', notify_on_device:'false' })) {
      await sql.runAsync('INSERT INTO metadata(key,value) VALUES (?,?)', key, value);
    }
    return { petId };
  });
}

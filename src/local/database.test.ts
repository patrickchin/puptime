import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { createLocalDatabase, localSchema, migrateLegacy } from './database.ts';
import { legacyKeys, parseLegacySnapshot } from './legacy.ts';
import { sqliteTestConnection } from './sqlite-test-adapter.ts';
const first = { id: 'event-1', type: 'pee', at: 100, note: '保留\nall notes', source: 'app', estimated: true };
const second = { id: 'event-2', type: 'nap', at: 200, endedAt: 300, source: 'widget' };
const routine = { id: 'same-id', type: 'meal', minutes: 700, reminder: true };
const values = { 'puptime.events.v1': JSON.stringify([first, second]), 'puptime.schedule.v1': JSON.stringify([routine]), 'puptime.theme.v1': 'soft-play' };
const snapshot = parseLegacySnapshot(legacyKeys.map((key) => [key, values[key as keyof typeof values] ?? null]));
async function setup(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'puptime-sqlite-'));
  const path = join(directory, 'data.db');
  const database = await createLocalDatabase(sqliteTestConnection(path));
  t.after(async () => { await database.close(); await rm(directory, { recursive: true, force: true }); });
  return { database, path };
}

test('atomic migration preserves original values and per-record fields across reopen', async (t) => {
  const { database, path } = await setup(t);
  assert.deepEqual(await migrateLegacy(database, snapshot, () => 'pet-1'), { petId: 'pet-1', migrated: true });
  const rows = await database.read((sql) => sql.getAllAsync<{ body: string }>('SELECT body FROM events ORDER BY at'));
  assert.deepEqual(rows.map((row) => JSON.parse(row.body)), [first, second]);
  assert.deepEqual(await database.read((sql) => sql.getAllAsync<{ body: string }>('SELECT body FROM routines')).then((rows) => rows.map((row) => JSON.parse(row.body))), [routine]);
  const originals = await database.read((sql) => sql.getAllAsync<{ key: string; raw_value: string | null }>('SELECT key, raw_value FROM legacy_snapshots'));
  assert.deepEqual(Object.fromEntries(originals.map((row) => [row.key, row.raw_value])), snapshot.raw);
  await database.write((sql) => sql.runAsync('UPDATE events SET body = json_set(body, \'$.note\', ?) WHERE id = ?', 'Newer edit', first.id));
  const reopened = await createLocalDatabase(sqliteTestConnection(path));
  try {
    assert.deepEqual(await migrateLegacy(reopened, snapshot, () => 'must-not-create'), { petId: 'pet-1', migrated: false });
    assert.equal(JSON.parse((await reopened.read((sql) => sql.getFirstAsync<{ body: string }>('SELECT body FROM events WHERE id = ?', first.id)))!.body).note, 'Newer edit');
    assert.equal((await reopened.read((sql) => sql.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM puppies')))!.count, 1);
  } finally { await reopened.close(); }
});

test('partial migration failure rolls back records, snapshots and success marker, then retries', async (t) => {
  const { database } = await setup(t);
  await database.write((sql) => sql.execAsync(localSchema + "CREATE TRIGGER fail_migration BEFORE INSERT ON events WHEN NEW.id = 'event-2' BEGIN SELECT RAISE(ABORT, 'storage failure'); END;"));
  await assert.rejects(migrateLegacy(database, snapshot, () => 'pet-1'), /storage failure/);
  for (const table of ['events', 'routines', 'puppies', 'legacy_snapshots', 'metadata']) {
    assert.equal((await database.read((sql) => sql.getFirstAsync<{ count: number }>(`SELECT COUNT(*) AS count FROM ${table}`)))!.count, 0);
  }
  await database.write((sql) => sql.execAsync('DROP TRIGGER fail_migration'));
  assert.equal((await migrateLegacy(database, snapshot, () => 'pet-1')).migrated, true);
});

test('separate connection initializers serialize without duplicating the initial puppy', async (t) => {
  const { database, path } = await setup(t);
  const other = await createLocalDatabase(sqliteTestConnection(path));
  try {
    const results = await Promise.all([migrateLegacy(database, snapshot, () => 'pet-first'), migrateLegacy(other, snapshot, () => 'pet-second')]);
    assert.equal(results.filter((result) => result.migrated).length, 1);
    assert.equal(results[0].petId, results[1].petId);
  } finally { await other.close(); }
});

test('foreign keys and pet-scoped IDs apply on the transaction connection', async (t) => {
  const { database } = await setup(t); await migrateLegacy(database, snapshot, () => 'pet-1');
  await assert.rejects(database.write((sql) => sql.runAsync('INSERT INTO events(pet_id,id,at,body) VALUES (?,?,?,?)', 'missing-pet', first.id, first.at, JSON.stringify(first))), /FOREIGN KEY/);
  await database.write(async (sql) => {
    await sql.runAsync('INSERT INTO puppies(id,name) VALUES (?,?)', 'pet-2', 'Second');
    await sql.runAsync('INSERT INTO events(pet_id,id,at,body) VALUES (?,?,?,?)', 'pet-2', first.id, first.at, JSON.stringify(first));
  });
  assert.equal((await database.read((sql) => sql.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM events WHERE id = ?', first.id)))!.count, 2);
});

test('new installs migrate once and newer schemas fail without touching their rows', async (t) => {
  const { database } = await setup(t);
  const empty = parseLegacySnapshot(legacyKeys.map((key) => [key, null]));
  await migrateLegacy(database, empty, () => 'pet-empty');
  assert.equal((await database.read((sql) => sql.getFirstAsync<{ value: string }>("SELECT value FROM metadata WHERE key = 'show_onboarding'")))!.value, 'true');
  await database.write((sql) => sql.runAsync("UPDATE metadata SET value = '2' WHERE key = 'schema_version'"));
  await assert.rejects(migrateLegacy(database, empty), /newer|unsupported/i);
  assert.equal((await database.read((sql) => sql.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM puppies')))!.count, 1);
});

test('completed migration never re-reads or reparses retained legacy storage', async (t) => {
  const { database } = await setup(t);
  let reads = 0;
  await migrateLegacy(database, async () => { reads++; return snapshot; }, () => 'pet-lazy');
  await migrateLegacy(database, async () => { throw new Error('Legacy source is now unavailable'); });
  assert.equal(reads, 1);
});

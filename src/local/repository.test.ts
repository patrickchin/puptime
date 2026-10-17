import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test, { type TestContext } from 'node:test';
import { createLocalDatabase, migrateLegacy } from './database.ts';
import { legacyKeys, parseLegacySnapshot } from './legacy.ts';
import { createLocalRepository } from './repository.ts';
import { sqliteTestConnection } from './sqlite-test-adapter.ts';
import { EventsImportError, EventsStorageError } from '../storage-validation.ts';
import type { PuppyEvent } from '../domain.ts';
const event = (id = 'first', at = 100): PuppyEvent => ({ id, at, type: 'pee', source: 'app' });
async function setup(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'puptime-repository-'));
  const path = join(directory, 'data.db');
  const database = await createLocalDatabase(sqliteTestConnection(path));
  t.after(async () => { await database.close(); await rm(directory, { recursive: true, force: true }); });
  await migrateLegacy(database, parseLegacySnapshot(legacyKeys.map((key) => [key, key === 'puptime.schedule.v1' ? '[]' : null])), () => 'pet-1');
  return { database, path, repository: createLocalRepository(database, 'pet-1') };
}

test('transactional CRUD returns committed history and retains estimate provenance and optional clears', async (t) => {
  const { repository } = await setup(t);
  const first = { ...event(), estimated: true, note: 'keep' };
  await repository.appendEvents([first, event('second', 200)]);
  const updated = await repository.appendEvents([{ ...event(), source: 'widget' }]);
  assert.equal(updated.find((item) => item.id === first.id)!.note, 'keep');
  assert.equal(updated.find((item) => item.id === first.id)!.estimated, true);
  const changed = await repository.updateEvent(first.id, { at: 300, note: undefined });
  assert.deepEqual(changed.map((item) => item.id), ['first', 'second']);
  assert.equal(changed[0].estimated, true); assert.equal(changed[0].note, undefined);
  assert.deepEqual(await repository.removeEvent('second'), [changed[0]]);
  assert.deepEqual(await repository.loadEvents(), [changed[0]]);
});

test('duplicate CSV import does not write and preserves existing conflicting-open-nap import behavior', async (t) => {
  const { repository, database } = await setup(t);
  await repository.appendEvents([{ ...event(), note: 'newer' }]);
  assert.deepEqual(await repository.importEvents([event(), event('second')]), { events: [{ ...event(), note: 'newer' }, event('second')], imported: 1, skipped: 1 });
  const before = (await database.read((sql) => sql.getFirstAsync<{ count: number }>('SELECT total_changes() AS count')))!.count;
  assert.equal((await repository.importEvents([event(), event('second')])).imported, 0);
  assert.equal((await database.read((sql) => sql.getFirstAsync<{ count: number }>('SELECT total_changes() AS count')))!.count, before);
  const nap: PuppyEvent = { id: 'nap', type: 'nap', at: 200, endedAt: null, source: 'app' };
  await repository.appendEvents([nap]);
  await assert.rejects(repository.importEvents([{ ...nap, id: 'another-nap' }, event('not-imported')]), EventsImportError);
  assert.equal((await repository.loadEvents()).some((item) => item.id === 'not-imported'), false);
});

test('concurrent app/widget connections preserve separate appends and independent edits', async (t) => {
  const { repository, path } = await setup(t);
  const otherDatabase = await createLocalDatabase(sqliteTestConnection(path));
  const widget = createLocalRepository(otherDatabase, 'pet-1');
  try {
    await Promise.all([repository.appendEvents([event('app')]), widget.appendEvents([event('widget')])]);
    assert.deepEqual(new Set((await repository.loadEvents()).map((item) => item.id)), new Set(['app', 'widget']));
    await Promise.all([repository.updateEvent('app', { note: 'edited on app' }), widget.updateEvent('app', { at: 500 })]);
    const saved = (await repository.loadEvents()).find((item) => item.id === 'app')!;
    assert.equal(saved.at, 500); assert.equal(saved.note, 'edited on app');
  } finally { await otherDatabase.close(); }
});

test('history reads and one-row edits preserve all unchanged event object references', async (t) => {
  const { repository } = await setup(t);
  await repository.appendEvents(Array.from({ length: 1000 }, (_, index) => event(`event-${index}`, index)));
  const before = await repository.loadEvents();
  assert.equal((await repository.loadEvents())[500], before[500]);
  const after = await repository.updateEvent('event-500', { note: 'one edit' });
  assert.equal(after.filter((item, index) => item === before[index]).length, 999);
  assert.equal(after.find((item) => item.id === 'event-500')!.note, 'one edit');
});

test('failed mid-batch writes roll back every change and leave the next write usable', async (t) => {
  const { repository, database } = await setup(t);
  await repository.appendEvents([event('first'), event('second')]);
  await database.write((sql) => sql.execAsync("CREATE TRIGGER fail_update BEFORE UPDATE ON events WHEN NEW.id='second' BEGIN SELECT RAISE(ABORT,'write failure'); END;"));
  await assert.rejects(repository.appendEvents([{ ...event('first'), note: 'must roll back' }, { ...event('second'), note: 'fails' }]), /write failure/);
  assert.equal((await repository.loadEvents()).every((item) => item.note === undefined), true);
  await repository.updateEvent('first', { note: 'retry works' });
  assert.equal((await repository.loadEvents()).find((item) => item.id === 'first')!.note, 'retry works');
});

test('event and routine identity are pet-scoped and routine replacement is atomic', async (t) => {
  const { repository, database } = await setup(t);
  await database.write((sql) => sql.runAsync('INSERT INTO puppies(id,name) VALUES (?,?)', 'pet-2', 'Other'));
  const other = createLocalRepository(database, 'pet-2');
  await repository.appendEvents([event()]); await other.appendEvents([{ ...event(), note: 'other puppy' }]);
  assert.equal((await repository.loadEvents())[0].note, undefined);
  assert.equal((await other.loadEvents())[0].note, 'other puppy');
  const routine = { id: 'routine', type: 'meal' as const, minutes: 500 };
  await repository.saveSchedule([routine]); await other.saveSchedule([{ ...routine, minutes: 600 }]);
  await database.write((sql) => sql.execAsync("CREATE TRIGGER fail_routine BEFORE INSERT ON routines WHEN NEW.id='fails' BEGIN SELECT RAISE(ABORT,'routine failure'); END;"));
  await assert.rejects(repository.saveSchedule([{ ...routine, id: 'fails' }]), /routine failure/);
  assert.deepEqual(await repository.loadSchedule(), [routine]);
  assert.equal((await other.loadSchedule())[0].minutes, 600);
  await assert.rejects(createLocalRepository(database, 'missing-pet').loadEvents(), /puppy/i);
});

test('corrupt saved rows reject reads and edits while retaining the original bytes', async (t) => {
  const { repository, database } = await setup(t);
  await repository.appendEvents([event()]);
  const body = JSON.stringify({ ...event(), id: 'wrong-id' });
  await database.write((sql) => sql.runAsync('UPDATE events SET body=? WHERE id=?', body, 'first'));
  await assert.rejects(repository.loadEvents(), EventsStorageError);
  await assert.rejects(repository.updateEvent('first', { note: 'overwrite' }), EventsStorageError);
  assert.equal((await database.read((sql) => sql.getFirstAsync<{ body: string }>('SELECT body FROM events')))!.body, body);
});

test('SQLite disk quota failure acknowledges no partial batch and recovers after capacity returns', async (t) => {
  const { repository, database } = await setup(t);
  await repository.appendEvents([event('saved')]);
  const pages = (await database.read((sql) => sql.getFirstAsync<{ page_count: number }>('PRAGMA page_count')))!.page_count;
  await database.read((sql) => sql.execAsync(`PRAGMA max_page_count=${pages + 1}`));
  await assert.rejects(repository.appendEvents(Array.from({ length: 20 }, (_, index) => ({ ...event(`large-${index}`), note: 'x'.repeat(16384) }))));
  assert.deepEqual(await repository.loadEvents(), [event('saved')]);
  await database.read((sql) => sql.execAsync('PRAGMA max_page_count=10000'));
  await repository.appendEvents([event('after-capacity')]);
  assert.equal((await repository.loadEvents()).length, 2);
});

test('persistent external write locks stop after bounded retries without losing existing history', async (t) => {
  const { repository, database, path } = await setup(t);
  await repository.appendEvents([event('saved')]);
  const blocker = sqliteTestConnection(path);
  await blocker.execAsync("BEGIN IMMEDIATE; UPDATE puppies SET name='Locked' WHERE id='pet-1';");
  try {
    await assert.rejects(repository.appendEvents([event('must-not-save')]), /locked|busy/i);
    assert.deepEqual(await repository.loadEvents(), [event('saved')]);
  } finally { await blocker.execAsync('ROLLBACK'); await blocker.closeAsync(); }
  await repository.appendEvents([event('after-unlock')]);
  assert.equal((await repository.loadEvents()).length, 2);
  assert.equal((await database.read((sql) => sql.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM events')))!.count, 2);
});

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { createLocalDatabase, initializeLocalDatabase, type SqlExecutor } from './database.ts';
import { sqliteTestConnection } from './sqlite-test-adapter.ts';
import { createLocalRuntime } from './runtime-factory.ts';
import { checkpointBeforeUpgrade, createBackupGuard } from './backup-guard.ts';
import type { BackupFiles } from './activity-backups.ts';

async function fixture(t: TestContext) {
  const database = await createLocalDatabase(sqliteTestConnection(':memory:'));
  t.after(() => database.close());
  await initializeLocalDatabase(database, () => 'pet_guard');
  let sequence = 0, failed = false;
  const disk = new Map<string, string>();
  const files: BackupFiles = {
    async list() { return [...disk].map(([id, value]) => ({ id, bytes: Buffer.byteLength(value) })); },
    async read(id) { return disk.get(id)!; },
    async write(id, content) { if (failed) throw new Error('disk full'); disk.set(id, content); },
    async remove(id) { disk.delete(id); },
  };
  let runtime: Awaited<ReturnType<typeof createLocalRuntime>>;
  const guard = createBackupGuard({ files, petId: 'pet_guard', appVersion: '1.2.0/12',
    newId: () => `bkp_${(++sequence).toString(16).padStart(32, '0')}`, restore: events => runtime.recoverEvents(events) });
  runtime = await createLocalRuntime(database, 'pet_guard', undefined, guard.checkpoint);
  await runtime.storage.appendEvents([{ id: 'evt_one', type: 'pee', at: 100, source: 'app', note: 'Original' }]);
  const snapshot = () => database.read(async sql => Object.fromEntries(await Promise.all(['metadata','events','local_revisions','local_sync_outbox'].map(async table => [table,await sql.getAllAsync(`SELECT * FROM ${table} ORDER BY rowid`)]))));
  return { database, runtime, guard, disk, snapshot, fail(value: boolean) { failed = value; } };
}

test('safety snapshots include same-day changes, precede mutations and restore without queue deadlock', { timeout: 3000 }, async t => {
  const { runtime, guard, disk } = await fixture(t);
  await runtime.checkpoint('daily');
  const daily = (await guard.service.list()).backups[0];
  await runtime.storage.appendEvents([{ id: 'evt_two', type: 'meal', at: 200, source: 'widget' }]);
  await runtime.storage.removeEvent('evt_two');
  const deletion = (await guard.service.list()).backups.find(item => item.reason === 'delete')!;
  assert.equal(deletion.count, 2); assert.equal(daily.count, 1);
  assert.ok((await guard.service.read(deletion.id)).events.some(event => event.id === 'evt_two'));
  await runtime.storage.importEvents([{ id: 'evt_three', type: 'poop', at: 300, source: 'app' }]);
  assert.equal((await guard.service.list()).backups.find(item => item.reason === 'import')!.count, 1);
  assert.deepEqual(await guard.service.restore(deletion.id), { imported: 1, skipped: 1 });
  const recovery = (await guard.service.list()).backups.find(item => item.reason === 'recovery')!;
  assert.deepEqual((await guard.service.read(recovery.id)).events.map(event => event.id), ['evt_three','evt_one']);
  assert.equal((await runtime.storage.loadEvents()).length, 3);
  assert.equal(JSON.parse(disk.get(daily.id)!).events.length, 1);
});

test('backup failure aborts deletion import and recovery before any local table changes', async t => {
  const f = await fixture(t);
  await f.runtime.checkpoint('daily');
  const daily = (await f.guard.service.list()).backups[0];
  await f.runtime.storage.appendEvents([{ id: 'evt_two', type: 'meal', at: 200, source: 'app' }]);
  f.fail(true); const before = await f.snapshot();
  await assert.rejects(f.runtime.storage.removeEvent('evt_one'), /disk full/);
  await assert.rejects(f.runtime.storage.importEvents([{ id: 'evt_new', type: 'pee', at: 300, source: 'app' }]), /disk full/);
  await assert.rejects(f.guard.service.restore(daily.id), /disk full/);
  assert.deepEqual(await f.snapshot(), before);
  f.fail(false); await f.runtime.storage.removeEvent('evt_one');
  assert.equal((await f.runtime.storage.loadEvents()).length, 1);
});

test('upgrade checkpoint runs before initialization changes, tracks actual builds and retries safely', async t => {
  const f = await fixture(t);
  await f.database.write(sql => sql.runAsync("INSERT INTO metadata(key,value) VALUES ('backup_app_version','1.1.0/11')"));
  f.fail(true); const before = await f.snapshot();
  await assert.rejects(initializeLocalDatabase(f.database, undefined, sql => checkpointBeforeUpgrade(sql, '1.2.0/12', f.guard.checkpoint)), /disk full/);
  assert.deepEqual(await f.snapshot(), before);
  f.fail(false);
  await initializeLocalDatabase(f.database, undefined, async sql => {
    await checkpointBeforeUpgrade(sql, '1.2.0/12', f.guard.checkpoint);
    // Represents a migration or initialization change after the checkpoint.
    await sql.runAsync("UPDATE events SET note='After initialization' WHERE id='evt_one'");
  });
  const update = (await f.guard.service.list()).backups.find(item => item.reason === 'before-update')!;
  assert.equal((await f.guard.service.read(update.id)).events[0].note, 'Original');
  const size = f.disk.size;
  await initializeLocalDatabase(f.database, undefined, sql => checkpointBeforeUpgrade(sql, '1.2.0/12', f.guard.checkpoint));
  assert.equal(f.disk.size, size, 'Same installed build does not create repeated upgrade snapshots.');
  await f.database.write(sql => checkpointBeforeUpgrade(sql, '1.2.0/13', f.guard.checkpoint));
  assert.equal(f.disk.size, size + 1, 'A new build with the same marketing version is still protected.');
  assert.equal(await f.database.read(async sql => (await sql.getFirstAsync<{value:string}>("SELECT value FROM metadata WHERE key='backup_app_version'"))!.value), '1.2.0/13');
});

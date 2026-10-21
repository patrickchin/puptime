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
    newId: () => `bkp_${(++sequence).toString(16).padStart(32, '0')}`, restore: (events,puppy) => runtime.recoverBackup(events,puppy) });
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

test('daily, account and upgrade checkpoints cover inactive dogs and dogs populated later that day', async t => {
  const f=await fixture(t);
  await f.database.write(async sql=>{
    await sql.runAsync("INSERT INTO puppies(id,name) VALUES ('pet_other','Basil'),('pet_empty','Empty')");
  });
  const other=await createLocalRuntime(f.database,'pet_other');
  await other.storage.appendEvents([{id:'evt_one',type:'meal',at:200,source:'widget',note:'Basil only'}]);
  for (const reason of ['daily','account-change'] as const) await f.runtime.checkpoint(reason);
  await initializeLocalDatabase(f.database,undefined,sql=>checkpointBeforeUpgrade(sql,'1.3.0/14',f.guard.checkpoint));
  const {backups}=await f.guard.service.list();
  assert.equal(backups.length,6);
  for (const petId of ['pet_guard','pet_other']) {
    assert.deepEqual(backups.filter(item=>item.petId===petId).map(item=>item.reason).sort(),['account-change','before-update','daily']);
    for (const backup of backups.filter(item=>item.petId===petId)) {
      const saved=await f.guard.service.read(backup.id);
      assert.equal(saved.events[0].note,petId==='pet_guard'?'Original':'Basil only');
    }
  }
  const empty=await createLocalRuntime(f.database,'pet_empty');
  await empty.storage.appendEvents([{id:'evt_first',type:'walk',at:300,source:'app'}]);
  await f.runtime.checkpoint('daily');
  assert.equal((await f.guard.service.list()).backups.filter(item=>item.reason==='daily').length,3);
  assert.equal(await f.database.read(async sql=>(await sql.getFirstAsync<{value:string}>("SELECT value FROM metadata WHERE key='active_pet_id'"))!.value),'pet_guard');
});

test('recovery targets the original inactive dog, preserves edits and recreates a lost profile atomically', async t => {
  const f=await fixture(t);
  await f.database.write(sql=>sql.runAsync("INSERT INTO puppies(id,name) VALUES ('pet_other','Basil')"));
  const other=await createLocalRuntime(f.database,'pet_other');
  const saved=[{id:'evt_one',type:'meal' as const,at:200,source:'app' as const,note:'Basil only'},
    {id:'evt_missing',type:'custom' as const,customLabel:'Training',at:300,source:'app' as const}];
  await other.storage.appendEvents(saved); await f.runtime.checkpoint('daily');
  const backup=(await f.guard.service.list()).backups.find(item=>item.petId==='pet_other')!;
  await other.storage.updateEvent('evt_one',{note:'Basil current edit'});
  await other.storage.savePuppyName('Basil renamed');
  await other.storage.removeEvent('evt_missing');
  const activeBefore=await f.runtime.storage.loadEvents();
  assert.deepEqual(await f.guard.service.restore(backup.id),{imported:1,skipped:1});
  assert.deepEqual(await f.guard.service.restore(backup.id),{imported:0,skipped:2});
  assert.equal((await other.storage.loadEvents()).find(event=>event.id==='evt_one')!.note,'Basil current edit');
  assert.equal(await other.storage.loadPuppyName(),'Basil renamed');
  assert.ok((await other.storage.loadCustomActivities()).includes('Training'));
  assert.deepEqual(await f.runtime.storage.loadEvents(),activeBefore);
  await f.database.write(sql=>sql.runAsync("DELETE FROM puppies WHERE id='pet_other'"));
  assert.deepEqual(await f.guard.service.restore(backup.id),{imported:2,skipped:0});
  assert.equal(await other.storage.loadPuppyName(),'Basil');
  assert.equal((await other.storage.loadEvents()).length,2);
  assert.deepEqual(await f.runtime.storage.loadEvents(),activeBefore);
  // An invalid snapshot cannot leave an orphan profile or partially restored logs.
  await assert.rejects(f.runtime.recoverBackup([
    {id:'evt_nap_1',type:'nap',at:100,endedAt:null,source:'app'},
    {id:'evt_nap_2',type:'nap',at:200,endedAt:null,source:'app'},
  ],{petId:'pet_lost',puppyName:'Lost'}));
  assert.equal(await f.database.read(sql=>sql.getFirstAsync("SELECT id FROM puppies WHERE id='pet_lost'")),null);
});

test('a backup failure for an inactive dog blocks destructive work and upgrade marking', async t => {
  const f=await fixture(t);
  await f.database.write(sql=>sql.runAsync("INSERT INTO puppies(id,name) VALUES ('pet_other','Basil')"));
  const other=await createLocalRuntime(f.database,'pet_other');
  await other.storage.appendEvents([{id:'evt_other',type:'meal',at:200,source:'app'}]);
  await f.runtime.checkpoint('delete'); // Reuse active dog's saved checkpoint, then fail on the inactive dog.
  await other.storage.updateEvent('evt_other',{note:'New data needs a checkpoint'});
  const before=await f.snapshot(); f.fail(true);
  await assert.rejects(f.runtime.storage.removeEvent('evt_one'),/disk full/);
  await assert.rejects(initializeLocalDatabase(f.database,undefined,sql=>checkpointBeforeUpgrade(sql,'1.3.0/14',f.guard.checkpoint)),/disk full/);
  assert.deepEqual(await f.snapshot(),before);
  f.fail(false); await f.runtime.storage.removeEvent('evt_one');
  const otherSnapshot=(await f.guard.service.list()).backups.find(item=>item.petId==='pet_other'&&item.reason==='delete')!;
  assert.equal((await f.guard.service.read(otherSnapshot.id)).events[0].note,'New data needs a checkpoint');
});

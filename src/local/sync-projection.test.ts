import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { createLocalDatabase, migrateLegacy } from './database.ts';
import { legacyKeys, parseLegacySnapshot } from './legacy.ts';
import { sqliteTestConnection } from './sqlite-test-adapter.ts';
import { createNativeStorage } from './native-storage.ts';
import * as projection from './sync-projection.ts';
import type { LocalChange } from './sync-projection.ts';

async function setup(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'puptime-projection-'));
  const database = await createLocalDatabase(sqliteTestConnection(join(directory,'data.db')));
  t.after(async () => { await database.close(); await rm(directory,{recursive:true,force:true}); });
  await migrateLegacy(database,parseLegacySnapshot(legacyKeys.map(key=>[key,key==='puptime.schedule.v1'?'[]':null])),()=> 'pet-1');
  const changes: LocalChange[][] = [];
  const storage = createNativeStorage(database, 'pet-1', async (sql, batch) => {
    assert.equal((await sql.getFirstAsync<{n:number}>('SELECT COUNT(*) n FROM puppies'))!.n, 1);
    changes.push(batch);
  });
  return {database,storage,changes};
}
const event = {id:'same-id',type:'pee' as const,at:100,source:'app' as const,estimated:true};

test('facade captures only actual event/routine changes inside the original SQL transaction', async t => {
  const {storage,changes}=await setup(t);
  await storage.appendEvents([event]);
  assert.deepEqual(changes.pop(),[{kind:'event',localId:'same-id',before:null,after:{type:'pee',at:100,source:'app',estimated:true}}]);
  await storage.updateEvent('same-id',{note:'new'});
  const changed=changes.pop()!;
  assert.equal(changed[0].before!.note,undefined); assert.equal(changed[0].after!.note,'new');
  await storage.importEvents([event]); assert.equal(changes.length,0);
  await storage.saveSchedule([{id:'same-id',type:'meal',minutes:500}]);
  assert.deepEqual(changes.pop(),[{kind:'routine',localId:'same-id',before:null,after:{type:'meal',minutes:500}}]);
  await storage.saveSchedule([]); assert.equal(changes.pop()![0].after,null);
  await storage.removeEvent('same-id'); assert.equal(changes.pop()![0].after,null);
});

test('change sink failure rolls back local save and reopening remains usable', async t => {
  const {database,storage}=await setup(t);
  const failing=createNativeStorage(database,'pet-1',async()=>{throw new Error('queue quota');});
  await assert.rejects(failing.appendEvents([event]),/queue quota/);
  assert.deepEqual(await storage.loadEvents(),[]);
  await assert.rejects(failing.saveThemePreference('day-trails'),/queue quota/);
  assert.equal(await storage.loadThemePreference(),'system');
  await storage.appendEvents([event]); assert.equal((await storage.loadEvents()).length,1);
});

test('settings capture explicit actions without uploads merely from loading derived labels', async t => {
  const {database,storage,changes}=await setup(t);
  await storage.appendEvents([{...event,type:'custom',customLabel:'Training'}]); changes.length=0;
  await storage.loadCustomActivities(); assert.equal(changes.length,0);
  await storage.saveThemePreference('soft-play');
  assert.deepEqual(changes.pop(),[{kind:'accountPreferences',localId:'preferences',before:{theme:'system',language:'system',widgetActions:['pee','poop','meal'],reminderLeadMinutes:10,widgetConfirmations:false,pottyAfterPeeEnabled:true,pottyAfterPeeDelayMinutes:120,pottyAfterMealEnabled:true,pottyAfterMealDelayMinutes:30},after:{theme:'soft-play',language:'system',widgetActions:['pee','poop','meal'],reminderLeadMinutes:10,widgetConfirmations:false,pottyAfterPeeEnabled:true,pottyAfterPeeDelayMinutes:120,pottyAfterMealEnabled:true,pottyAfterMealDelayMinutes:30}}]);
  await storage.saveThemePreference('soft-play'); assert.equal(changes.length,0);
  await storage.saveActivityCustomization('custom:training',{emoji:'🎾'}); changes.length=0;
  await storage.deleteCustomActivity('Training');
  assert.deepEqual(new Set(changes[0].map(change=>change.kind)),new Set(['customActivity','customization']));
  assert.ok(changes[0].every(change=>change.after===null));
  assert.equal((await storage.loadEvents())[0].customLabel,'Training');
  changes.length=0; await storage.completeOnboarding(); assert.equal(changes.length,0);
  await storage.savePuppyName('Pip'); assert.equal(changes.pop()![0].after!.name,'Pip');
  const records=await database.read(sql=>projection.readLocalRecords(sql,'pet-1'));
  assert.ok(!JSON.stringify(records).includes('onboarding'));
});

test('projection round trip preserves exact IDs, history and independent puppy state without echo work', async t => {
  const {database,storage,changes}=await setup(t);
  assert.equal(typeof projection.readLocalRecords,'function'); assert.equal(typeof projection.applyLocalRecords,'function');
  await storage.appendEvents([{...event,note:'训练'}]);
  await storage.saveSchedule([{id:'same-id',type:'custom',customLabel:'Training',minutes:300,reminder:true}]);
  await storage.saveCustomActivity('Training'); await storage.saveLanguagePreference('es');
  const records=await database.read(sql=>projection.readLocalRecords(sql,'pet-1'));
  await database.write(sql=>sql.runAsync('INSERT INTO puppies(id,name) VALUES (?,?)','pet-2','Other'));
  changes.length=0;
  await database.write(sql=>projection.applyLocalRecords(sql,'pet-2',records,[]));
  const other=createNativeStorage(database,'pet-2');
  assert.deepEqual(await other.loadEvents(),await storage.loadEvents());
  assert.deepEqual(await other.loadSchedule(),await storage.loadSchedule());
  assert.equal(await other.loadPuppyName(),'My puppy');
  await database.write(sql=>projection.applyLocalRecords(sql,'pet-2',[],[{kind:'customActivity',localId:'custom:training'}]));
  assert.deepEqual(await other.loadCustomActivities(),[]);
  assert.equal((await other.loadEvents())[0].note,'训练');
  assert.deepEqual(await storage.loadCustomActivities(),['Training']); assert.equal(changes.length,0);
});

test('snapshot and apply reject corrupt indexes and invalid batches without partial projection', async t => {
  const {database,storage}=await setup(t);
  await storage.appendEvents([event]);
  await database.write(sql=>sql.runAsync('UPDATE events SET at=999 WHERE pet_id=? AND id=?','pet-1',event.id));
  await assert.rejects(database.read(sql=>projection.readLocalRecords(sql,'pet-1')),/index/i);
  await database.write(sql=>sql.runAsync('UPDATE events SET at=100 WHERE pet_id=? AND id=?','pet-1',event.id));
  await assert.rejects(database.write(sql=>projection.applyLocalRecords(sql,'pet-1',[
    {kind:'event',localId:'new-valid',data:{type:'meal',at:200,source:'app'}},
    {kind:'routine',localId:'invalid',data:{type:'meal',minutes:1500}},
  ],[])));
  assert.deepEqual((await storage.loadEvents()).map(value=>value.id),[event.id]);
});

test('partial preference projection merges reminder fields and preserves local-only state', async t => {
  const {database,storage,changes}=await setup(t);
  await storage.saveNotificationPreferences({reminderLeadMinutes:15,widgetConfirmations:true,pottyAfterPee:{enabled:true,delayMinutes:180},pottyAfterMeal:{enabled:true,delayMinutes:60}});
  assert.equal(changes.pop()![0].after!.pottyAfterMealDelayMinutes,60);
  await database.write(sql=>sql.runAsync("INSERT INTO metadata(key,value) VALUES ('notify_on_this_device','false')"));
  await database.write(sql=>projection.applyLocalRecords(sql,'pet-1',[{kind:'accountPreferences',localId:'preferences',data:{pottyAfterMealEnabled:false}}],[]));
  assert.deepEqual(await storage.loadNotificationPreferences(),{reminderLeadMinutes:15,widgetConfirmations:true,pottyAfterPee:{enabled:true,delayMinutes:180},pottyAfterMeal:{enabled:false,delayMinutes:60}});
  assert.equal((await database.read(sql=>sql.getFirstAsync<{value:string}>("SELECT value FROM metadata WHERE key='notify_on_this_device'")))!.value,'false');
  assert.equal(changes.length,0);
});

test('locally valid legacy values remain lossless even when cloud limits are narrower', async t => {
  const {database,storage,changes}=await setup(t);
  const local={...event,id:'legacy'.repeat(100),note:'训练'.repeat(17000)};
  await storage.appendEvents([local]);
  assert.equal(changes[0][0].localId,local.id); assert.equal(changes[0][0].after!.note,local.note);
  const record=(await database.read(sql=>projection.readLocalRecords(sql,'pet-1'))).find(value=>value.kind==='event')!;
  assert.equal(record.localId,local.id); assert.equal(record.data.note,local.note);
});

test('applying an unchanged populated snapshot preserves cached rows and writes only the edited event',async t=>{
 const {database,storage}=await setup(t);
 await storage.appendEvents(Array.from({length:1000},(_,index)=>({...event,id:`row-${index}`,at:index})));
 const before=await storage.loadEvents(),records=await database.read(sql=>projection.readLocalRecords(sql,'pet-1'));
 await database.write(sql=>sql.execAsync('CREATE TABLE event_write_audit(id TEXT); CREATE TRIGGER count_event_updates AFTER UPDATE ON events BEGIN INSERT INTO event_write_audit(id) VALUES(NEW.id); END;'));
 await database.write(sql=>projection.applyLocalRecords(sql,'pet-1',records,[]));
 const unchanged=await storage.loadEvents();assert.equal(unchanged.filter((value,index)=>value===before[index]).length,1000);
 const record=records.find(value=>value.kind==='event'&&value.localId==='row-500')!;record.data={...record.data,note:'only one edit'};
 await database.write(sql=>projection.applyLocalRecords(sql,'pet-1',records,[]));
 const after=await storage.loadEvents();assert.equal(after.filter((value,index)=>value===before[index]).length,999);
 assert.deepEqual((await database.read(sql=>sql.getAllAsync<{id:string}>('SELECT id FROM event_write_audit'))).map(row=>row.id),['row-500']);
});


test('an empty new record cannot be skipped as a semantic no-op',async t=>{
 const {database}=await setup(t);
 await assert.rejects(database.write(sql=>projection.applyLocalRecords(sql,'pet-1',[{kind:'event',localId:'empty',data:{}}],[])));
});

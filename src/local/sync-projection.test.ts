import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { createLocalDatabase, initializeLocalDatabase } from './database.ts';
import { sqliteTestConnection } from './sqlite-test-adapter.ts';
import { createNativeStorage } from './native-storage.ts';
import * as projection from './sync-projection.ts';
import type { LocalChange } from './sync-projection.ts';

async function setup(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'puptime-projection-'));
  const database = await createLocalDatabase(sqliteTestConnection(join(directory,'data.db')));
  t.after(async () => { await database.close(); await rm(directory,{recursive:true,force:true}); });
  await initializeLocalDatabase(database,()=> 'pet-1');await database.write(sql=>sql.runAsync('DELETE FROM routines'));
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
  await assert.rejects(failing.saveThemePreference('light'),/queue quota/);
  assert.equal(await storage.loadThemePreference(),'system');
  await storage.appendEvents([event]); assert.equal((await storage.loadEvents()).length,1);
});

test('settings capture explicit actions without uploads merely from loading derived labels', async t => {
  const {database,storage,changes}=await setup(t);
  await storage.appendEvents([{...event,type:'custom',customLabel:'Training'}]); changes.length=0;
  await storage.loadCustomActivities(); assert.equal(changes.length,0);
  await storage.saveThemePreference('dark');
  assert.deepEqual(changes.pop(),[{kind:'accountPreferences',localId:'preferences',before:{theme:'system',language:'system',widgetActions:['pee','poop','meal'],reminderLeadMinutes:10,widgetConfirmations:false,pottyAfterPeeEnabled:true,pottyAfterPeeDelayMinutes:120,pottyAfterMealEnabled:true,pottyAfterMealDelayMinutes:30},after:{theme:'dark',language:'system',widgetActions:['pee','poop','meal'],reminderLeadMinutes:10,widgetConfirmations:false,pottyAfterPeeEnabled:true,pottyAfterPeeDelayMinutes:120,pottyAfterMealEnabled:true,pottyAfterMealDelayMinutes:30}}]);
  await storage.saveThemePreference('dark'); assert.equal(changes.length,0);
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

test('remote event projection materializes custom labels without resurrecting a deleted activity',async t=>{
 const {database,storage}=await setup(t);
 const record={kind:'event' as const,localId:'remote-custom',data:{type:'custom',customLabel:'Training',at:100,source:'app'}};
 await database.write(sql=>projection.applyLocalRecords(sql,'pet-1',[record],[]));
 assert.equal((await database.read(sql=>sql.getFirstAsync<{value:string}>("SELECT value FROM pet_settings WHERE key='puptime.customActivities.v1'")))!.value,'["Training"]');
 await storage.deleteCustomActivity('Training');
 await database.write(sql=>projection.applyLocalRecords(sql,'pet-1',[{...record,data:{...record.data,note:'remote note'}}],[]));
 assert.deepEqual(await storage.loadCustomActivities(),[]);assert.equal((await storage.loadEvents())[0].note,'remote note');
 await database.write(sql=>projection.applyLocalRecords(sql,'pet-1',[{kind:'customActivity',localId:'custom:training',data:{label:'Training'}}],[]));
 assert.deepEqual(await storage.loadCustomActivities(),['Training']);
});

test('snapshot and apply reject corrupt fields and invalid batches without partial projection', async t => {
  const {database,storage}=await setup(t);
  await storage.appendEvents([event]);
  await database.write(sql=>sql.execAsync("PRAGMA ignore_check_constraints=ON; UPDATE events SET source='corrupt'; PRAGMA ignore_check_constraints=OFF;"));
  await assert.rejects(database.read(sql=>projection.readLocalRecords(sql,'pet-1')),/invalid/i);
  await database.write(sql=>sql.runAsync("UPDATE events SET source='app' WHERE pet_id=? AND id=?",'pet-1',event.id));
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

test('meal, poop and after-wee timing survive storage, sync capture and partial remote updates',async t=>{
  const {database,storage,changes}=await setup(t);
  const current=await storage.loadNotificationPreferences();
  await storage.saveNotificationPreferences({...current,mealReminderOffsetMinutes:-15,poopReminderOffsetMinutes:30,pottyAfterPee:{enabled:true,delayMinutes:180}});
  const captured=changes.pop()![0].after!;
  assert.equal(captured.mealReminderOffsetMinutes,-15);
  assert.equal(captured.poopReminderOffsetMinutes,30);
  assert.equal(captured.pottyAfterPeeEnabled,true);
  assert.equal(captured.pottyAfterPeeDelayMinutes,180);
  await database.write(sql=>projection.applyLocalRecords(sql,'pet-1',[{kind:'accountPreferences',localId:'preferences',data:{mealReminderOffsetMinutes:5,pottyAfterPeeEnabled:false}}],[]));
  assert.deepEqual(await storage.loadNotificationPreferences(),{...current,mealReminderOffsetMinutes:5,poopReminderOffsetMinutes:30,pottyAfterPee:{enabled:false,delayMinutes:180}});
});

test('current boundary values remain lossless across change capture and projection', async t => {
  const {database,storage,changes}=await setup(t);
  const local={...event,id:'历史 / '.repeat(40),note:'训练'.repeat(8192)};
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

test('local commit signals fire only after successful changed writes, never for reads, no-ops or projection',async t=>{
 const {database}=await setup(t);let commits=0;
 const storage=createNativeStorage(database,'pet-1',undefined,()=>{commits++;});
 await storage.appendEvents([event]);assert.equal(commits,1);
 await storage.importEvents([event]);await storage.saveSchedule([]);await storage.saveThemePreference('system');await storage.loadCustomActivities();assert.equal(commits,1);
 await storage.updateEvent(event.id,{note:'saved'});await storage.saveSchedule([{id:'routine',type:'meal',minutes:300}]);await storage.saveThemePreference('dark');assert.equal(commits,4);
 await database.write(sql=>projection.applyLocalRecords(sql,'pet-1',[{kind:'event',localId:event.id,data:{type:'pee',at:200,source:'app',estimated:true}}],[]));assert.equal(commits,4);
});

test('a deferred SQL commit failure emits no local signal and advisory listener errors cannot turn a committed save into failure',async t=>{
 const {database}=await setup(t);let commits=0,fail=false;
 await database.write(sql=>sql.execAsync('CREATE TABLE commit_parent(id TEXT PRIMARY KEY); CREATE TABLE commit_child(parent_id TEXT REFERENCES commit_parent(id) DEFERRABLE INITIALLY DEFERRED);'));
 const storage=createNativeStorage(database,'pet-1',async sql=>{if(fail)await sql.runAsync("INSERT INTO commit_child(parent_id) VALUES ('missing')");},()=>{commits++;});
 fail=true;await assert.rejects(storage.appendEvents([event]),/FOREIGN KEY/i);assert.equal(commits,0);assert.deepEqual(await storage.loadEvents(),[]);
 await assert.rejects(storage.saveSchedule([{id:'routine',type:'meal',minutes:300}]),/FOREIGN KEY/i);assert.equal(commits,0);
 await assert.rejects(storage.saveThemePreference('dark'),/FOREIGN KEY/i);assert.equal(commits,0);assert.equal(await storage.loadThemePreference(),'system');
 fail=false;
 let advisoryCalls=0;const advisory=createNativeStorage(database,'pet-1',async()=>{},()=>{advisoryCalls++;throw new Error('listener failed');});
 await advisory.appendEvents([event]);await advisory.saveThemePreference('dark');await advisory.saveSchedule([{id:'routine',type:'meal',minutes:300}]);
 assert.equal(advisoryCalls,3);assert.equal((await storage.loadEvents()).length,1);assert.equal(await storage.loadThemePreference(),'dark');assert.equal((await storage.loadSchedule()).length,1);
});

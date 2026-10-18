import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { createLocalDatabase, initializeLocalDatabase } from './database.ts';
import { sqliteTestConnection } from './sqlite-test-adapter.ts';
import { createNativeStorage } from './native-storage.ts';
import { createLocalRuntime } from './runtime-factory.ts';
import { DEFAULT_NOTIFICATION_PREFERENCES, type NotificationPreferences } from '../notification-config.ts';
import type { PuppyEvent } from '../domain.ts';
async function setup(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(),'puptime-native-settings-'));
  const path = join(directory,'data.db');
  const database = await createLocalDatabase(sqliteTestConnection(path));
  t.after(async () => { await database.close(); await rm(directory,{recursive:true,force:true}); });
  await initializeLocalDatabase(database,()=> 'pet-1');
  return { database, path, storage:createNativeStorage(database,'pet-1') };
}

test('local writes enforce cloud field limits without committing invalid creation edit or import',async t=>{
  const {database}=await setup(t),{storage}=await createLocalRuntime(database,'pet-1');
  const saved:PuppyEvent={id:'x'.repeat(256),type:'custom',customLabel:'c'.repeat(40),at:8640000000000000,source:'app',note:'n'.repeat(16384)};
  await storage.appendEvents([saved]);
  assert.deepEqual(await storage.loadEvents(),[saved]);
  const snapshot=()=>database.read(async sql=>Object.fromEntries(await Promise.all(['events','routines','puppies','pet_settings','local_revisions','local_sync_outbox'].map(async table=>[table,(await sql.getAllAsync<Record<string,unknown>>(`SELECT * FROM ${table} ORDER BY rowid`)).map(row=>({...row}))]))));
  const before=await snapshot();
  for(const invalid of [
    {...saved,id:'x'.repeat(257)}, {...saved,id:'control\u0001'}, {...saved,id:'too-long-note',note:'n'.repeat(16385)},
    {...saved,id:'too-long-label',customLabel:'c'.repeat(41)}, {...saved,id:'missing-custom-label',customLabel:undefined},
    {...saved,id:'wrong-time',at:8640000000000001},
  ]){
    await assert.rejects(storage.appendEvents([invalid]),TypeError);
    await assert.rejects(storage.importEvents([invalid]),TypeError);
    assert.deepEqual(await snapshot(),before);
  }
  await assert.rejects(storage.updateEvent(saved.id,{note:'n'.repeat(16385)}),TypeError);
  await assert.rejects(storage.saveScheduleEntry({id:'routine',type:'custom',customLabel:'c'.repeat(41),minutes:1}),TypeError);
  assert.deepEqual(await snapshot(),before);
});

test('local writers persist parsed canonical labels in records and revision capture',async t=>{
  const {database}=await setup(t),{storage}=await createLocalRuntime(database,'pet-1');
  await storage.appendEvents([{id:'canonical-event',type:'custom',customLabel:' Training ',at:100,source:'app'}]);
  await storage.saveScheduleEntry({id:'canonical-routine',type:'custom',customLabel:' Medicine ',minutes:100});
  assert.equal((await storage.loadEvents())[0].customLabel,'Training');
  assert.equal((await storage.loadSchedule()).find(row=>row.id==='canonical-routine')!.customLabel,'Medicine');
  const revisions=await database.read(sql=>sql.getAllAsync<{kind:string;local_id:string;after_data:string}>('SELECT kind,local_id,after_data FROM local_revisions'));
  assert.equal(JSON.parse(revisions.find(row=>row.kind==='event'&&row.local_id==='canonical-event')!.after_data).customLabel,'Training');
  assert.equal(JSON.parse(revisions.find(row=>row.kind==='routine'&&row.local_id==='canonical-routine')!.after_data).customLabel,'Medicine');
});

test('native facade preserves onboarding, theme, language, routines and notification choices', async (t) => {
  const {storage}=await setup(t);
  assert.equal(await storage.shouldShowOnboarding(),true);
  await storage.completeOnboarding(); assert.equal(await storage.shouldShowOnboarding(),false);
  assert.equal(await storage.loadThemePreference(),'system'); await storage.saveThemePreference('day-trails'); assert.equal(await storage.loadThemePreference(),'day-trails');
  await storage.saveLanguagePreference('es'); assert.equal(await storage.loadLanguagePreference(),'es');
  assert.deepEqual(await storage.loadNotificationPreferences(),DEFAULT_NOTIFICATION_PREFERENCES);
  const preferences:NotificationPreferences={...DEFAULT_NOTIFICATION_PREFERENCES,reminderLeadMinutes:5,widgetConfirmations:true,pottyAfterMeal:{enabled:false,delayMinutes:60}};
  await storage.saveNotificationPreferences(preferences); assert.deepEqual(await storage.loadNotificationPreferences(),preferences);
  await storage.saveSchedule([]); assert.deepEqual(await storage.loadSchedule(),[]);
});

test('onboarding commits the supplied puppy name with completion', async (t) => {
  const {database}=await setup(t);
  const {storage}=await createLocalRuntime(database,'pet-1');
  await storage.completeOnboarding({puppyName:'  Biscuit  '});
  assert.equal(await storage.loadPuppyName(),'Biscuit');
  assert.equal(await storage.shouldShowOnboarding(),false);
  assert.equal((await database.read(sql=>sql.getFirstAsync<{n:number}>("SELECT count(*) n FROM local_revisions WHERE kind='puppy'")))?.n,1);
  assert.equal((await database.read(sql=>sql.getFirstAsync<{n:number}>('SELECT count(*) n FROM local_sync_outbox')))?.n,0);
  assert.deepEqual(await storage.loadEvents(),[]);
});

test('omitting an onboarding name preserves the existing puppy name', async (t) => {
  const {storage}=await setup(t);
  await storage.savePuppyName('Mochi');
  await storage.completeOnboarding();
  assert.equal(await storage.loadPuppyName(),'Mochi');
});

test('an explicitly blank onboarding name uses My puppy', async (t) => {
  const {storage}=await setup(t);
  await storage.savePuppyName('Mochi');
  await storage.completeOnboarding({puppyName:'  '});
  assert.equal(await storage.loadPuppyName(),'My puppy');
  assert.equal(await storage.shouldShowOnboarding(),false);
});

test('invalid onboarding names cannot complete setup', async (t) => {
  const {storage}=await setup(t);
  await assert.rejects(storage.completeOnboarding({puppyName:'x'.repeat(257)}));
  assert.equal(await storage.loadPuppyName(),'My puppy');
  assert.equal(await storage.shouldShowOnboarding(),true);
});

test('onboarding naming is scoped to its puppy and repeated completion is idempotent', async (t) => {
  const {database}=await setup(t);
  await database.write(sql=>sql.runAsync('INSERT INTO puppies(id,name) VALUES (?,?)','pet-2','Nori'));
  const {storage}=await createLocalRuntime(database,'pet-1');
  await Promise.all([storage.completeOnboarding({puppyName:'Biscuit'}),storage.completeOnboarding({puppyName:'Biscuit'})]);
  const rows=await database.read(sql=>sql.getAllAsync<{id:string;name:string}>('SELECT id,name FROM puppies ORDER BY id'));
  assert.deepEqual(rows.map(({id,name})=>[id,name]),[['pet-1','Biscuit'],['pet-2','Nori']]);
  assert.equal((await database.read(sql=>sql.getFirstAsync<{n:number}>("SELECT count(*) n FROM local_revisions WHERE kind='puppy'")))?.n,1);
});

test('failed onboarding completion rolls back the name, marker and revision before retry', async (t) => {
  const {database}=await setup(t);
  const {storage}=await createLocalRuntime(database,'pet-1');
  const event:PuppyEvent={id:'kept-before-onboarding',type:'pee',at:100,source:'app'};
  await storage.appendEvents([event]);
  const revisions=await database.read(sql=>sql.getAllAsync('SELECT * FROM local_revisions ORDER BY sequence'));
  await database.write(sql=>sql.execAsync("CREATE TRIGGER fail_onboarding BEFORE UPDATE OF value ON metadata WHEN OLD.key='show_onboarding' BEGIN SELECT RAISE(ABORT,'injected onboarding failure'); END;"));
  await assert.rejects(storage.completeOnboarding({puppyName:'Biscuit'}),/injected onboarding failure/);
  assert.equal(await storage.loadPuppyName(),'My puppy');
  assert.equal(await storage.shouldShowOnboarding(),true);
  assert.deepEqual(await database.read(sql=>sql.getAllAsync('SELECT * FROM local_revisions ORDER BY sequence')),revisions);
  assert.deepEqual(await storage.loadEvents(),[event]);
  assert.equal((await database.read(sql=>sql.getFirstAsync<{n:number}>('SELECT count(*) n FROM local_sync_outbox')))?.n,0);
  await database.write(sql=>sql.execAsync('DROP TRIGGER fail_onboarding'));
  await storage.completeOnboarding({puppyName:'Biscuit'});
  assert.equal(await storage.loadPuppyName(),'Biscuit');
  assert.equal(await storage.shouldShowOnboarding(),false);
});

test('custom labels, deletion markers and customizations survive delete/recreate without changing history', async (t) => {
  const {storage}=await setup(t);
  const event:PuppyEvent={id:'custom-event',type:'custom',customLabel:'Training',at:100,source:'app'};
  await storage.appendEvents([event]); assert.deepEqual(await storage.loadCustomActivities(),['Training']);
  await storage.saveCustomActivity('Medicine');
  await storage.saveActivityCustomization('custom:training',{name:'Practice',emoji:'🎾',color:3});
  assert.deepEqual((await storage.loadActivityCustomizations())['custom:training'],{name:'Practice',emoji:'🎾',color:3});
  assert.deepEqual(await storage.deleteCustomActivity('Training'),['Medicine']);
  assert.deepEqual(await storage.loadCustomActivities(),['Medicine']);
  assert.equal((await storage.loadActivityCustomizations())['custom:training'],undefined);
  assert.deepEqual(await storage.loadEvents(),[event]);
  await storage.saveCustomActivity('Training'); assert.deepEqual(await storage.loadCustomActivities(),['Medicine','Training']);
});

test('account appearance is shared while custom activity settings stay with their puppy', async (t) => {
  const {storage,database}=await setup(t);
  await database.write((sql)=>sql.runAsync('INSERT INTO puppies(id,name) VALUES (?,?)','pet-2','Second'));
  const other=createNativeStorage(database,'pet-2');
  await storage.saveCustomActivity('Training');
  await storage.saveActivityCustomization('pee',{emoji:'💧'});
  await storage.saveThemePreference('soft-play');
  assert.deepEqual(await other.loadCustomActivities(),[]); assert.deepEqual(await other.loadActivityCustomizations(),{});
  assert.equal(await other.loadThemePreference(),'soft-play');
  await storage.saveWidgetActions(['pee','custom:training']); assert.deepEqual(await storage.loadWidgetActions(),['pee','custom:training']);
  assert.deepEqual(await other.loadWidgetActions(),['pee','poop','meal']);
});

test('competing settings writers combine distinct additions without lost updates', async (t) => {
  const {storage,path}=await setup(t);
  const otherDatabase=await createLocalDatabase(sqliteTestConnection(path));
  try {
    const other=createNativeStorage(otherDatabase,'pet-1');
    await Promise.all([storage.saveCustomActivity('Training'),other.saveCustomActivity('Medicine')]);
    assert.deepEqual(new Set(await storage.loadCustomActivities()),new Set(['Training','Medicine']));
    await Promise.all([storage.saveActivityCustomization('pee',{color:1}),other.saveActivityCustomization('meal',{color:2})]);
    assert.deepEqual(await storage.loadActivityCustomizations(),{pee:{color:1},meal:{color:2}});
  } finally {await otherDatabase.close();}
});

test('retired preferences fall back but malformed JSON cannot overwrite retained settings', async (t) => {
  const {storage,database}=await setup(t);
  await database.write(async(sql)=> {
    await sql.runAsync('INSERT INTO settings(key,value) VALUES (?,?)','puptime.theme.v1','retired-theme');
    await sql.runAsync('INSERT INTO pet_settings(pet_id,key,value) VALUES (?,?,?)','pet-1','puptime.customActivities.v1','{broken');
  });
  assert.equal(await storage.loadThemePreference(),'system');
  await assert.rejects(storage.saveCustomActivity('Overwrite'),/settings/i);
  assert.equal((await database.read((sql)=>sql.getFirstAsync<{value:string}>('SELECT value FROM pet_settings WHERE pet_id=? AND key=?','pet-1','puptime.customActivities.v1')))!.value,'{broken');
});

test('explicit null JSON settings are corruption rather than an absent preference', async (t) => {
  const {storage,database}=await setup(t);
  await database.write(async(sql)=> {
    await sql.runAsync('INSERT INTO pet_settings(pet_id,key,value) VALUES (?,?,?)','pet-1','puptime.customActivities.v1','null');
    await sql.runAsync('INSERT INTO settings(key,value) VALUES (?,?)','puptime.notificationPreferences.v1','null');
  });
  await assert.rejects(storage.saveCustomActivity('Overwrite'),/settings/i);
  await assert.rejects(storage.loadNotificationPreferences(),/settings/i);
});

test('failed multi-key activity deletion rolls back its marker, labels and customization together', async (t) => {
  const {storage,database}=await setup(t);
  await storage.saveCustomActivity('Training');
  await storage.saveActivityCustomization('custom:training',{emoji:'🎾'});
  await database.write((sql)=>sql.execAsync("CREATE TRIGGER fail_customizations BEFORE UPDATE ON pet_settings WHEN NEW.key='puptime.activityCustomizations.v1' BEGIN SELECT RAISE(ABORT,'settings failure'); END;"));
  await assert.rejects(storage.deleteCustomActivity('Training'),/settings failure/);
  assert.deepEqual(await storage.loadCustomActivities(),['Training']);
  assert.deepEqual((await storage.loadActivityCustomizations())['custom:training'],{emoji:'🎾'});
});

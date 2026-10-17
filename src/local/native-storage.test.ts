import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { createLocalDatabase, migrateLegacy } from './database.ts';
import { legacyKeys, parseLegacySnapshot } from './legacy.ts';
import { sqliteTestConnection } from './sqlite-test-adapter.ts';
import { createNativeStorage } from './native-storage.ts';
import { DEFAULT_NOTIFICATION_PREFERENCES, type NotificationPreferences } from '../notification-config.ts';
import type { PuppyEvent } from '../domain.ts';
async function setup(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(),'puptime-native-settings-'));
  const path = join(directory,'data.db');
  const database = await createLocalDatabase(sqliteTestConnection(path));
  t.after(async () => { await database.close(); await rm(directory,{recursive:true,force:true}); });
  await migrateLegacy(database,parseLegacySnapshot(legacyKeys.map((key) => [key,null])),()=> 'pet-1');
  return { database, path, storage:createNativeStorage(database,'pet-1') };
}

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

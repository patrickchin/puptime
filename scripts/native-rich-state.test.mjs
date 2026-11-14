import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createLocalDatabase,initializeLocalDatabase} from '../src/local/database.ts';
import {sqliteTestConnection} from '../src/local/sqlite-test-adapter.ts';
import {createNativeStorage} from '../src/local/native-storage.ts';
import {cloudRecordId} from '../src/cloud/record-identity.ts';
import {DEFAULT_NOTIFICATION_PREFERENCES} from '../src/notification-config.ts';
import {accountFlowEnvironment,assertRichCloud,readRichNativeState} from './verify-native-rich-state.mjs';

test('read-only rich-state evidence uses actual native SQLite and production projection',async()=>{
 const root=await mkdtemp(join(tmpdir(),'puptime-rich-state-')),path=join(root,'native.db'),petId='pet_rich_fixture',database=await createLocalDatabase(sqliteTestConnection(path));
 try{
  await initializeLocalDatabase(database,()=>petId);const storage=createNativeStorage(database,petId);
  await storage.saveThemePreference('dark');await storage.saveLanguagePreference('es');await storage.saveWidgetActions(['pee','poop','walk']);await storage.saveNotificationPreferences({...DEFAULT_NOTIFICATION_PREFERENCES,reminderLeadMinutes:15});
  await storage.saveNotificationDelivery(true);await storage.saveQuietStatusEnabled(true);
  await storage.saveScheduleEntry({id:'rtn_rich_fixture',type:'meal',minutes:601,reminder:true,toleranceMinutes:60});
  await storage.appendEvents([{id:'evt_rich_fixture',type:'walk',at:123456,source:'app',note:'Synthetic preserved note'}]);
  const state=await readRichNativeState(path),prefs=state.records.find(record=>record.kind==='accountPreferences').data;
  assert.equal(prefs.theme,'dark');assert.equal(prefs.language,'es');assert.equal(prefs.reminderLeadMinutes,15);assert.ok(prefs.widgetActions.includes('walk'));
  const remote=state.records.map((record,index)=>({id:cloudRecordId(record.kind,record.kind==='accountPreferences'?null:petId,record.localId),kind:record.kind,petId:record.kind==='accountPreferences'?null:petId,data:record.data,deleted:false,sequence:index+1})).reverse();
  assertRichCloud(state.records,remote);assert.ok(!JSON.stringify(remote).includes('notify_on_device'));assert.ok(!JSON.stringify(remote).includes('quiet_status_on_device'));
  assert.throws(()=>assertRichCloud(state.records,remote.filter(record=>record.kind!=='accountPreferences')));
  assert.throws(()=>assertRichCloud(state.records,remote.map(record=>record.kind==='routine'&&record.data.minutes===601?{...record,data:{...record.data,minutes:602}}:record)));
  assert.deepEqual((await readRichNativeState(path)).tables,state.tables,'Evidence reads must not change any native table.');
 }finally{await database.close();await rm(root,{recursive:true,force:true});}
});

test('current projection keeps latest updates and tombstones without changing pull history',()=>{
 const petId='pet_rich_fixture',preferences={kind:'accountPreferences',localId:'preferences',data:{theme:'dark',language:'es'}},routine={kind:'routine',localId:'rtn_rich_fixture',data:{type:'meal',minutes:601,reminder:true}},removed={kind:'event',localId:'evt_removed',data:{type:'pee',at:1,source:'app'}};
 const record=(value,sequence,data=value.data,deleted=false)=>({id:cloudRecordId(value.kind,value.kind==='accountPreferences'?null:petId,value.localId),kind:value.kind,petId:value.kind==='accountPreferences'?null:petId,data,deleted,sequence});
 const history=[record(preferences,1,{theme:'system',language:'en'}),record(routine,2,{type:'meal',minutes:600,reminder:false}),record(removed,3),record(preferences,4,{theme:'dark',language:'en'}),record(routine,5),record(removed,6,removed.data,true),record(preferences,7)];
 const original=structuredClone(history);assertRichCloud([preferences,routine],history);assertRichCloud([preferences,routine],[...history].reverse());assert.deepEqual(history,original);
 assert.throws(()=>assertRichCloud([preferences,routine],history.slice(0,-1)));
 assert.throws(()=>assertRichCloud([preferences,routine],history.filter(row=>!row.deleted)));
 assert.throws(()=>assertRichCloud([preferences,routine],[...history,record(preferences,7,{theme:'light',language:'es'})]));
 assert.throws(()=>assertRichCloud([preferences,routine],[{...history[0],sequence:undefined},...history.slice(1)]));
});

test('locale expectations keep English exact and require acknowledged Spanish final state',()=>{
 const en=accountFlowEnvironment('en',{EXPECTED_COUNT:12}),es=accountFlowEnvironment('es',{EXPECTED_COUNT:12});
 assert.equal(en.ACCOUNT_CODE_LABEL,'Sign-in code');assert.equal(en.ACCOUNT_LOG_COUNT,'12 activity logs');assert.equal(es.ACCOUNT_LOG_COUNT,'12 registros de actividad');assert.equal(es.ACCOUNT_STATUS,'Al día');
 for(const title of ['Up to date','Combine these histories?'])assert.match(title,new RegExp(en.ACCOUNT_READY));
 for(const title of ['Up to date','Combine these histories?','Al día','¿Combinar estos historiales?'])assert.match(title,new RegExp(es.ACCOUNT_READY));
 for(const title of ['Combine these histories','Combine these historiesX','Sync paused','Loading account…'])assert.doesNotMatch(title,new RegExp(es.ACCOUNT_READY));
 assert.match('¿Cerrar sesión en este dispositivo?',new RegExp(es.ACCOUNT_SIGN_OUT_TITLE));assert.doesNotMatch('¿Cerrar sesión en este dispositivo',new RegExp(es.ACCOUNT_SIGN_OUT_TITLE));
 assert.throws(()=>accountFlowEnvironment('unknown'));
});

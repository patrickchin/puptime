import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {parseAllDocuments} from 'yaml';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createLocalDatabase,initializeLocalDatabase} from '../src/local/database.ts';
import {sqliteTestConnection} from '../src/local/sqlite-test-adapter.ts';
import {createNativeStorage} from '../src/local/native-storage.ts';
import {cloudRecordId} from '../src/cloud/record-identity.ts';
import {DEFAULT_NOTIFICATION_PREFERENCES} from '../src/notification-config.ts';
import {accountFlowEnvironment,assertRichCloud,readRichNativeState,verifyNativeFontNotices} from './verify-native-rich-state.mjs';

test('read-only rich-state evidence uses actual native SQLite and production projection',async()=>{
 const root=await mkdtemp(join(tmpdir(),'puptime-rich-state-')),path=join(root,'native.db'),petId='pet_rich_fixture',database=await createLocalDatabase(sqliteTestConnection(path));
 try{
  await initializeLocalDatabase(database,()=>petId);const storage=createNativeStorage(database,petId);
  await storage.saveThemePreference('dark');await storage.saveLanguagePreference('es');await storage.saveWidgetActions(['pee','poop','walk']);await storage.saveNotificationPreferences({...DEFAULT_NOTIFICATION_PREFERENCES,reminderLeadMinutes:15});
  await storage.saveNotificationDelivery(true);await storage.saveQuietStatusEnabled(true);
  await storage.saveScheduleEntry({id:'rtn_rich_fixture',type:'meal',minutes:601,reminder:true,toleranceMinutes:60});
  await storage.appendEvents([{id:'evt_rich_fixture',type:'walk',at:123456,source:'app',note:'Synthetic preserved note'}]);
  await storage.appendEvents([{id:'evt_custom_fixture',type:'custom',customLabel:'Confidence practice',at:123457,source:'app',note:'Synthetic custom note'}]);
  await storage.saveScheduleEntry({id:'rtn_custom_fixture',type:'custom',customLabel:'Confidence practice',minutes:616,reminder:true});
  const state=await readRichNativeState(path),prefs=state.records.find(record=>record.kind==='accountPreferences').data;
  assert.equal(prefs.theme,'dark');assert.equal(prefs.language,'es');assert.equal(prefs.reminderLeadMinutes,15);assert.ok(prefs.widgetActions.includes('walk'));
  const remote=state.records.map((record,index)=>({id:cloudRecordId(record.kind,record.kind==='accountPreferences'?null:petId,record.localId),kind:record.kind,petId:record.kind==='accountPreferences'?null:petId,data:record.data,deleted:false,sequence:index+1})).reverse();
  assertRichCloud(state.records,remote);assert.ok(!JSON.stringify(remote).includes('notify_on_device'));assert.ok(!JSON.stringify(remote).includes('quiet_status_on_device'));
  assert.throws(()=>assertRichCloud(state.records,remote.filter(record=>record.kind!=='accountPreferences')));
  assert.throws(()=>assertRichCloud(state.records,remote.map(record=>record.kind==='routine'&&record.data.minutes===601?{...record,data:{...record.data,minutes:602}}:record)));
  assert.throws(()=>assertRichCloud(state.records,remote.map(record=>record.kind==='routine'&&record.data.type==='custom'?{...record,data:{...record.data,customLabel:undefined}}:record)));
  assert.throws(()=>assertRichCloud(state.records,remote.filter(record=>record.kind!=='customActivity')));
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


test('standalone font-notices keeps both view snapshots strict and restores the original projection',async()=>{
 for(const corruptView of [false,true]){
  const root=await mkdtemp(join(tmpdir(),'puptime-notice-evidence-')),path=join(root,'native.db'),petId='pet_notices_fixture',database=await createLocalDatabase(sqliteTestConnection(path));
  try{
   await initializeLocalDatabase(database,()=>petId);const storage=createNativeStorage(database,petId),calls=[];
   await storage.appendEvents(Array.from({length:12},(_,i)=>({id:'evt_notices_'+i,type:'pee',at:123456+i,source:'app',note:'Synthetic preserved notice history'})));
   const before=await readRichNativeState(path);
   const execute=()=>verifyNativeFontNotices({databasePath:()=>path,flow:async(name,env)=>{
    calls.push([name,env]);
    if(name==='rich-notices'&&env.NOTICE_ACTION==='theme')await storage.saveThemePreference(env.NOTICE_THEME);
    if(name==='rich-notices'&&env.NOTICE_ACTION==='view'&&corruptView)await storage.appendEvents([{id:'evt_forbidden_view_write',type:'poop',at:123999,source:'app'}]);
   }});
   if(corruptView){await assert.rejects(execute,/Only explicitly expected rows/);assert.equal(calls.filter(([name,env])=>name==='rich-notices'&&env.NOTICE_ACTION==='view').length,1);}
   else{
    const result=await execute(),after=await readRichNativeState(path);
    assert.deepEqual(calls,[['prepare',undefined],['add-logs',{BATCHES:'4',EXPECTED_COUNT:'12'}],...['light','dark'].flatMap(theme=>[['rich-notices',{NOTICE_ACTION:'theme',NOTICE_THEME:theme}],['rich-notices',{NOTICE_ACTION:'view',NOTICE_THEME:theme}]]),['rich-notices',{NOTICE_ACTION:'theme',NOTICE_THEME:'system'}]]);
    assert.deepEqual(after.records,before.records);assert.deepEqual(after.tables.events,before.tables.events);
    assert.deepEqual(result.receipt,{phase:'font-notices',noticeScreenshotsCaptured:true,noticeVisualReview:'required',noticeViewsAll14Stable:true});
   }
  }finally{await database.close();await rm(root,{recursive:true,force:true});}
 }
});


// Interpret only this parsed transition guard; no native runtime is simulated.
function profileAgeModel(state,{beforeTap=()=>{},afterTap=()=>{},afterAnimation=()=>{}}={}){
 const commands=parseAllDocuments(readFileSync(new URL('../.maestro/helpers/conversational/to-reminders.yaml',import.meta.url),'utf8'))[1].toJS();
 const profileIndex=commands.findIndex(command=>command?.assertVisible?.id==='preview.profile'),guard=commands[profileIndex+1]?.retry;
 assert.equal(guard?.maxRetries,2);assert.deepEqual(commands[profileIndex+2],{assertVisible:{id:'preview.prompt',text:'How old is your pup?'}});
 const expectedButton='I’ll add their name later',ageHeading='How old is your pup?';let profileActions=0,ageActions=0,tapLookups=0,attempts=0;
 const visible=selector=>selector?.id==='preview.profile'?state.profile:selector?.id==='preview.prompt'&&selector.text===ageHeading?state.age:false;
 function execute(list){for(const command of list){
  if(command==='waitForAnimationToEnd'){afterAnimation(state);continue;}
  if(command.runFlow){const {when,commands}=command.runFlow;if(when.visible&&!visible(when.visible)||when.notVisible&&visible(when.notVisible))continue;execute(commands);}
  else if(command.assertVisible)assert.ok(visible(command.assertVisible),'Required transition predicate is absent.');
  else if(command.tapOn){
   tapLookups++;beforeTap(state);const selector=command.tapOn,label=state.profile?expectedButton:state.age?'I’m not sure yet':'';
   assert.equal(selector.id,'preview.skip');assert.equal(selector.enabled,true);assert.equal(selector.text,'^'+expectedButton+'$');
   assert.ok(label&&new RegExp(selector.text).test(label)&&state.enabled!==false,'Only the enabled profile action may be delivered.');
   if(state.profile)profileActions++;else if(state.age)ageActions++;afterTap(state,profileActions);
  }else assert.fail('Unexpected command in the narrowly modeled guard.');
 }}
 let error;for(;attempts<=guard.maxRetries;){attempts++;try{execute(guard.commands);error=undefined;break;}catch(value){error=value;}}
 return {profileActions,ageActions,tapLookups,attempts,error};
}

test('profile→age guard handles retained source and stops actions after the destination',()=>{
 const state={profile:true,age:false};const result=profileAgeModel(state,{afterTap:(state,count)=>{if(count===2){state.profile=false;state.age=true;}}});
 assert.equal(result.error,undefined);assert.equal(result.profileActions,2);assert.equal(result.ageActions,0);assert.equal(result.attempts,2);
 const again=profileAgeModel(state);assert.equal(again.error,undefined);assert.equal(again.profileActions,0);assert.equal(again.ageActions,0);assert.equal(again.tapLookups,0);assert.equal(again.attempts,1);
 const retained=profileAgeModel({profile:true,age:false});assert.ok(retained.error);assert.equal(retained.profileActions,3);assert.equal(retained.attempts,3);
});

test('profile→age guard handles late destination arrival and never delivers the reused age Skip',()=>{
 for(const hook of ['afterAnimation','beforeTap']){
  const state={profile:true,age:false},result=profileAgeModel(state,{[hook]:state=>{state.profile=false;state.age=true;}});
  assert.equal(result.error,undefined);assert.equal(result.profileActions,0);assert.equal(result.ageActions,0);assert.ok(result.attempts<=2);
 }
 // Even if an outgoing profile is still reported, an already present target wins.
 const arrived=profileAgeModel({profile:true,age:true});assert.equal(arrived.error,undefined);assert.equal(arrived.profileActions,0);assert.equal(arrived.ageActions,0);assert.equal(arrived.tapLookups,0);
});

test('profile→age guard fails boundedly without tapping when both source and destination are absent',()=>{
 const result=profileAgeModel({profile:false,age:false});assert.ok(result.error);assert.equal(result.profileActions,0);assert.equal(result.ageActions,0);assert.equal(result.tapLookups,0);assert.equal(result.attempts,3);
 const source=readFileSync(new URL('../src/screens/OnboardingDesignPreview.tsx',import.meta.url),'utf8');assert.ok(source.includes("'I’ll add their name later',()=>{setName('');go('age');}"));
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {createLocalDatabase,initializeLocalDatabase} from './database.ts';
import {sqliteTestConnection} from './sqlite-test-adapter.ts';
import {createLocalRuntime} from './runtime-factory.ts';
import {entityId} from '../entity-id.ts';
import type {AssistantRequest,AssistantPlan} from '../assistant.ts';

async function fixture(t:import('node:test').TestContext){
  const db=await createLocalDatabase(sqliteTestConnection(':memory:'));t.after(()=>db.close());await initializeLocalDatabase(db,()=> 'pet_ellie');
  const runtime=await createLocalRuntime(db,'pet_ellie');await runtime.storage.savePuppyName('Ellie');
  const context:AssistantRequest={text:'Ellie peed and pooped an hour ago',now:Date.UTC(2026,9,27,12),timezone:'Asia/Shanghai',locale:'en',puppy:{id:runtime.petId,name:'Ellie'},customActivities:[],recentEvents:[],confirmBeforeSaving:true,conversation:[]};
  const action={kind:'log' as const,puppyId:runtime.petId,type:'pee' as const,at:context.now-3600000,endedAt:null,customLabel:null,note:null};
  const plan:AssistantPlan={reply:'Ready to log.',needsClarification:false,actions:[action,{...action,type:'poop',note:'A bit runny today.'}]};
  return {db,runtime,context,action,plan};
}
test('a request commits both logs with local history, deduplicates its retry, and undoes as a group',async t=>{
  const {runtime,context,plan,db}=await fixture(t),id=entityId('cmd');
  assert.equal(await runtime.assistant.confirmation(),true);
  const result=await runtime.assistant.execute(id,plan,context);
  assert.deepEqual(await (await createLocalRuntime(db,runtime.petId)).assistant.lastResult(),result);
  assert.equal(result.changes.length,2);assert.ok(result.changes.every(({after})=>after.at===context.now-3600000&&/^evt_[a-f0-9]{32}$/.test(after.id)));
  assert.deepEqual(await runtime.assistant.execute(id,plan,context),result);assert.equal((await runtime.storage.loadEvents()).length,2);
  assert.equal((await db.read(sql=>sql.getFirstAsync<{n:number}>("SELECT COUNT(*) n FROM local_revisions WHERE kind='event'")))!.n,2);
  await runtime.assistant.execute(entityId('cmd'),{reply:'Open Insights',needsClarification:false,actions:[{kind:'navigate',screen:'insights'}]},context);
  await runtime.assistant.undo(id);assert.deepEqual(await runtime.storage.loadEvents(),[]);
  await assert.rejects(runtime.assistant.execute(id,plan,context),/undone/);
});
test('a failed second log rolls back the batch and leaves no successful receipt',async t=>{
  const {runtime,context,plan,db}=await fixture(t),id=entityId('cmd');
  await db.write(sql=>sql.execAsync("CREATE TRIGGER reject_second BEFORE INSERT ON events WHEN NEW.type='poop' BEGIN SELECT RAISE(ABORT,'synthetic second write failure'); END;"));
  await assert.rejects(runtime.assistant.execute(id,plan,context),/second write failure/);assert.deepEqual(await runtime.storage.loadEvents(),[]);
  await db.write(sql=>sql.execAsync('DROP TRIGGER reject_second'));
  assert.equal((await runtime.assistant.execute(id,plan,context)).changes.length,2);
});
test('assistant logs use the existing sync outbox and a queue failure rolls back the whole request',async t=>{
  const {runtime,context,plan,db}=await fixture(t);
  const owner={...await runtime.sync.prepareAssociation({accountId:'usr_fixture',localPetId:runtime.petId,deviceId:runtime.deviceId,enrollment:{operationId:'enrollment',deviceId:runtime.deviceId,localPetId:runtime.petId,name:'Ellie'}}),accountId:'usr_fixture'};
  await runtime.sync.stageBaseline({...owner,page:{changes:[],cursor:0,hasMore:false}});await runtime.sync.completeAssociation({...owner,cloudPetId:runtime.petId});
  const before=(await runtime.sync.status(runtime.petId)).pending,id=entityId('cmd');
  await db.write(sql=>sql.execAsync("CREATE TRIGGER reject_assistant_queue BEFORE INSERT ON local_sync_outbox BEGIN SELECT RAISE(ABORT,'synthetic queue failure'); END;"));
  await assert.rejects(runtime.assistant.execute(id,plan,context),/queue failure/);
  assert.deepEqual(await runtime.storage.loadEvents(),[]);assert.equal(await runtime.assistant.lastResult(),null);
  await db.write(sql=>sql.execAsync('DROP TRIGGER reject_assistant_queue'));
  await runtime.assistant.execute(id,plan,context);
  assert.equal((await runtime.sync.status(runtime.petId)).pending,before+2);
});
test('edits preserve unrelated fields and reject stale edits or stale undo without losing later work',async t=>{
  const {runtime,context,plan}=await fixture(t);
  const created=await runtime.assistant.execute(entityId('cmd'),plan,context),poop=created.changes[1].after;
  const {source,...expected}=poop;const editContext={...context,recentEvents:[expected]};
  const edit:AssistantPlan={reply:'Add a note.',needsClarification:false,actions:[{kind:'edit_log',puppyId:runtime.petId,eventId:poop.id,at:null,endedAt:null,note:'After breakfast'}]};
  const id=entityId('cmd');await runtime.assistant.execute(id,edit,editContext);
  assert.equal((await runtime.activity.getEvent(poop.id))!.at,poop.at);
  await runtime.storage.updateEvent(poop.id,{note:'Changed on another device'});
  await assert.rejects(runtime.assistant.undo(id),/changed/);
  await assert.rejects(runtime.assistant.execute(entityId('cmd'),edit,editContext),/changed/);
  assert.equal((await runtime.activity.getEvent(poop.id))!.note,'Changed on another device');
});
test('confirmation preference persists and can be changed by a validated assistant action and undone',async t=>{
  const {runtime,context,db}=await fixture(t),id=entityId('cmd');
  await runtime.assistant.execute(id,{reply:'Turn off review.',needsClarification:false,actions:[{kind:'set_confirmation',enabled:false}]},context);
  assert.equal(await (await createLocalRuntime(db,runtime.petId)).assistant.confirmation(),false);
  await runtime.assistant.undo(id);assert.equal(await runtime.assistant.confirmation(),true);
  await runtime.assistant.setConfirmation(false);await assert.rejects(runtime.assistant.execute(entityId('cmd'),{reply:'Open settings',needsClarification:false,actions:[{kind:'navigate',screen:'settings'}]},context),/preference changed/);
});
test('a second running nap rejects the entire batch and preserves the existing nap',async t=>{
  const {runtime,context,action}=await fixture(t);
  await runtime.storage.appendEvents([{id:'evt_open',type:'nap',at:context.now-7200000,endedAt:null,source:'app'}]);
  await assert.rejects(runtime.assistant.execute(entityId('cmd'),{reply:'Start nap',needsClarification:false,actions:[{...action,type:'nap'}]},context),/already running/);
  assert.equal((await runtime.storage.loadEvents()).length,1);
});
test('undo cannot reopen an earlier nap while another nap is running',async t=>{
  const {runtime,context}=await fixture(t),nap={id:'evt_old_nap',type:'nap' as const,at:context.now-7200000,endedAt:null,source:'app' as const};
  await runtime.storage.appendEvents([nap]);const {source,...expected}=nap;
  const id=entityId('cmd');await runtime.assistant.execute(id,{reply:'End nap',needsClarification:false,actions:[{kind:'edit_log',puppyId:runtime.petId,eventId:nap.id,at:null,endedAt:context.now-3600000,note:null}]},{...context,recentEvents:[expected]});
  await runtime.storage.appendEvents([{...nap,id:'evt_current_nap',at:context.now-60000}]);
  await assert.rejects(runtime.assistant.undo(id),/current nap/);
  assert.equal((await runtime.activity.getEvent(nap.id))!.endedAt,context.now-3600000);
  assert.equal((await runtime.activity.getEvent('evt_current_nap'))!.endedAt,null);
});

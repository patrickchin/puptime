import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test,{type TestContext} from 'node:test';
import type {PuppyEvent} from '../domain.ts';
import {createLocalDatabase,initializeLocalDatabase} from '../local/database.ts';
import {createLocalRuntime} from '../local/runtime-factory.ts';
import {sqliteTestConnection} from '../local/sqlite-test-adapter.ts';
import {createAccountController,type IdentityAdapter} from './account-controller.ts';
import {CloudApiError,createCloudApi,type CloudAccountSummary} from './api.ts';
import {type CloudRecord,type Enrollment,type Mutation,type MutationResult} from './protocol.ts';
import {cloudRecordId,localRecordId} from './record-identity.ts';
import {reconcileMutation} from './reconcile.ts';

const guestLogs:PuppyEvent[]=[
 {id:'evt_pee',type:'pee',at:100,source:'app',note:'Outside 🐶'},
 {id:'evt_poop',type:'poop',at:200,source:'widget'},
 {id:'evt_meal',type:'meal',at:300,source:'app',note:'早餐'},
 {id:'evt_potty',type:'pottyTrip',at:400,source:'app'},
 {id:'evt_walk',type:'walk',at:500,source:'widget',estimated:true},
 {id:'evt_nap',type:'nap',at:600,endedAt:900,source:'app',note:'Finished nap'},
 {id:'evt_open_nap',type:'nap',at:1000,endedAt:null,source:'widget'},
 {id:'evt_custom',type:'custom',customLabel:'Training',at:1100,source:'app'},
 {id:'evt_shared',type:'meal',at:1200,source:'app',note:'Latest guest edit'},
 ...Array.from({length:105},(_,i):PuppyEvent=>({id:`evt_guest_${i}`,type:'pee',at:2000+i,source:'app',note:`Guest log ${i}`})),
];
const ordered=(events:PuppyEvent[])=>[...events].sort((a,b)=>a.id.localeCompare(b.id));

// Exercises the real controller, runner, storage, SQLite transactions and API
// schemas. The remote is an in-process protocol replica, not a native auth UI.
async function fixture(t:TestContext,{existing=false}={}) {
 const directory=await mkdtemp(join(tmpdir(),'puptime-guest-sync-')),path=join(directory,'data.db');
 const summary:CloudAccountSummary={user:{id:'usr_guest_test',email:'guest@example.com',name:'Guest'},cloud:{canSync:true,canExport:true},pets:existing?[{id:'pet_cloud',name:'Biscuit',eventCount:106}]:[]};
 const petId=existing?'pet_cloud':'pet_guest';
 const records=new Map<string,CloudRecord>(),changes:CloudRecord[]=[],operations=new Map<string,MutationResult>();
 const enrollments:Enrollment[]=[],batches:Mutation[][]=[],syncRequests:string[]=[];
 let credentials=false;
 function seed(kind:CloudRecord['kind'],id:string,data:CloudRecord['data']) {
  const record={id:cloudRecordId(kind,petId,id),petId,kind,data,revision:1,sequence:changes.length+1,deleted:false,updatedAt:1};
  records.set(record.id,record);changes.push(record);
 }
 const cloudLogs:PuppyEvent[]=existing?Array.from({length:105},(_,i)=>({id:`evt_cloud_${i}`,type:'meal',at:5000+i,source:'app'})):[];
 if(existing){
  seed('puppy',petId,{name:'Biscuit'});
  for(const {id,...data} of [...cloudLogs,{...guestLogs[8],note:'Earlier cloud note'}])seed('event',id,data);
 }
 const api=createCloudApi(async(route,options)=>{
  if(route.startsWith('/api/sync/')||route==='/api/cloud/enroll')syncRequests.push(route);
  if(route==='/api/config')return {data:{protocolVersion:1,providers:{email:true,apple:true,google:true}},error:null};
  if(!credentials)return {data:null,error:{status:401}};
  if(route==='/api/account')return {data:structuredClone(summary),error:null};
  if(route==='/api/cloud/enroll'){
   const request=structuredClone(options.body as Enrollment);enrollments.push(request);
   assert.equal(request.confirmedPetId??request.localPetId,petId);
   if(!summary.pets.length)summary.pets=[{id:petId,name:request.name,eventCount:0}];
   return {data:{petId},error:null};
  }
  if(route==='/api/sync/push'){
   const batch=structuredClone((options.body as {mutations:Mutation[]}).mutations);batches.push(batch);
   const accepted=batch.map(mutation=>{
    const previous=operations.get(mutation.operationId);if(previous)return previous;
    const current=records.get(mutation.recordId)??null,result=reconcileMutation(current,mutation,10000);
    const record={...result.record,revision:(current?.revision??0)+1,sequence:changes.length+1};records.set(record.id,record);changes.push(record);
    const acknowledgment={operationId:mutation.operationId,record,sequence:record.sequence,reason:result.reason};
    operations.set(mutation.operationId,acknowledgment);return acknowledgment;
   });
   return {data:{accepted,rejected:[]},error:null};
  }
  if(route.startsWith('/api/sync/pull?after=')){
   const after=Number(route.split('=')[1]),page=changes.filter(record=>record.sequence>after).slice(0,100);
   return {data:{changes:page,cursor:page.at(-1)?.sequence??after,hasMore:changes.length>(page.at(-1)?.sequence??after)},error:null};
  }
  throw new Error(`Unexpected route: ${route}`);
 });
 const identity:IdentityAdapter={
  requestEmail:async()=>({error:null}),verifyEmail:async()=>{credentials=true;return {error:null};},
  signInSocial:async()=>{credentials=true;return {error:null};},linkSocial:async()=>({error:null}),
  listAccounts:async()=>({data:[],error:null}),signOut:async()=>{credentials=false;return {error:null};},hasCredentials:async()=>credentials,
 };
 async function open() {
  const database=await createLocalDatabase(sqliteTestConnection(path));
  const {petId:localPetId}=await initializeLocalDatabase(database,()=> 'pet_guest');
  const writes=new Set<()=>void>(),timers:Array<{fn:()=>void;cancelled:boolean}>=[];
  const runtime=await createLocalRuntime(database,localPetId,()=>{for(const fn of writes)fn();});
  const controller=createAccountController({runtime,api,identity,subscribeLocalWrites:fn=>{writes.add(fn);return()=>{writes.delete(fn);};},changed:()=>{},defer:fn=>{const task={fn,cancelled:false};timers.push(task);return()=>{task.cancelled=true;};}});
  return {runtime,controller,timers};
 }
 let client=await open();
 t.after(async()=>{client.controller.stop();await client.runtime.database.close();await rm(directory,{recursive:true,force:true});});
 async function reopen() {
  client.controller.stop();await client.runtime.database.close();client=await open();return client;
 }
 async function startAsGuest() {
  await client.controller.refresh();
  assert.equal(await client.controller.continueLocally(),'ok');
  await client.runtime.storage.completeOnboarding({puppyName:'Biscuit'});
  client.controller.setOnline(false);
  await client.runtime.storage.appendEvents([...guestLogs,{id:'evt_deleted',type:'pee',at:50,source:'app'}]);
  await client.runtime.storage.updateEvent('evt_meal',{note:'早餐 — edited offline'});
  await client.runtime.storage.removeEvent('evt_deleted');
  const expected=await client.runtime.storage.loadEvents();
  assert.deepEqual(ordered(expected),ordered(guestLogs.map(log=>log.id==='evt_meal'?{...log,note:'早餐 — edited offline'}:log)));
  assert.equal((await client.runtime.sync.status('pet_guest')).state,'local');
  assert.deepEqual(syncRequests,[],'Guest history stays local until Enable/Combine');
  return expected;
 }
 async function signIn(method:'email'|'apple'|'google'='email') {
  client.controller.setOnline(true);await client.controller.refresh();
  if(method==='email'){
   assert.equal(await client.controller.requestEmail(summary.user.email),'ok');
   assert.equal(await client.controller.verifyEmail(summary.user.email,'123456'),'ok');
  }else assert.equal(await client.controller.signInSocial(method),'ok');
  assert.equal(client.controller.read().account!.user.id,summary.user.id);
  assert.equal((await client.runtime.sync.status('pet_guest')).state,'local');
  assert.deepEqual(syncRequests,[],'Sign-in alone must not upload or download history');
 }
 async function enable() {
  assert.equal(await client.controller.enableCloud(existing?{confirmedPetId:petId}:{}),'ok');
  client.controller.setActive(true);await client.controller.refresh();
 }
 async function run() {
  const timer=client.timers.find(task=>!task.cancelled);assert.ok(timer,'A sync run must be scheduled');timer.cancelled=true;
  await new Promise<void>(resolve=>{
   let started=false;
   const unsubscribe=client.controller.subscribe(()=>{
    if(client.controller.read().running)started=true;
    else if(started){unsubscribe();resolve();}
   });
   timer.fn();
  });
  return client.controller.read().run!;
 }
 async function drain() {
  for(let i=0;i<20;i++){
   const result=await run();
   if(result.state==='synced')return;
   assert.equal(result.state,'pending',JSON.stringify(result));
  }
  assert.fail('Guest backlog did not drain');
 }
 function remoteLogs() {
  return ordered([...records.values()].filter(record=>record.kind==='event'&&!record.deleted).map(record=>({id:localRecordId(record),...record.data} as PuppyEvent)));
 }
 return {get client(){return client;},api,identity,summary,petId,cloudLogs,enrollments,batches,operations,reopen,startAsGuest,signIn,enable,run,drain,remoteLogs};
}

for(const method of ['email','apple','google'] as const)for(const existing of [false,true])test(`guest logs survive restart and ${method} sign-in, then explicit ${existing?'Combine':'Enable'} uploads every field`,{timeout:10000},async t=>{
 const f=await fixture(t,{existing}),guest=await f.startAsGuest();
 await f.reopen();assert.deepEqual(ordered(await f.client.runtime.storage.loadEvents()),ordered(guest));
 await f.signIn(method);assert.deepEqual(ordered(await f.client.runtime.storage.loadEvents()),ordered(guest));
 if(existing){
  assert.equal(await f.client.controller.enableCloud({}),'confirmation-required');
  assert.equal(await f.client.controller.enableCloud({confirmedPetId:'pet_wrong'}),'confirmation-required');
  assert.equal(await f.client.controller.enableCloud({confirmedPetId:f.petId,mode:'restore'}),'confirmation-required');
  assert.deepEqual(ordered(await f.client.runtime.storage.loadEvents()),ordered(guest));assert.equal(f.enrollments.length,0);
 }
 await f.enable();await f.drain();
 const expected=ordered([...guest,...f.cloudLogs]);
 assert.deepEqual(f.remoteLogs(),expected);assert.deepEqual(ordered(await f.client.runtime.storage.loadEvents()),expected);
 assert.equal((await f.client.runtime.sync.status('pet_guest')).pending,0);
 assert.equal(await f.client.runtime.storage.loadFirstLaunch(),null);
 assert.ok(f.batches.length>1,'Guest history must span multiple upload batches');
 const committed=f.operations.size;
 await f.reopen();f.client.controller.setActive(true);await f.client.controller.refresh();await f.drain();
 assert.deepEqual(ordered(await f.client.runtime.storage.loadEvents()),expected);assert.deepEqual(f.remoteLogs(),expected);
 assert.equal(f.operations.size,committed,'Restart must not duplicate uploaded logs');
 assert.equal(f.enrollments.length,1,'A completed association is not enrolled again');
});

for(const failure of ['enrollment-reply','baseline-page','upload-reply','local-commit'] as const)test(`guest Combine preserves logs and resumes after ${failure} failure and restart`,{timeout:10000},async t=>{
 const f=await fixture(t,{existing:true}),guest=await f.startAsGuest();await f.signIn();await f.enable();
 const {enroll,pull,push}=f.api;let failed=false;
 f.api.enroll=async(...args)=>{const result=await enroll(...args);if(failure==='enrollment-reply'&&!failed){failed=true;throw new CloudApiError('network');}return result;};
 f.api.pull=async(...args)=>{if(failure==='baseline-page'&&!failed&&args[0]>0){failed=true;throw new CloudApiError('network');}return pull(...args);};
 f.api.push=async(...args)=>{const result=await push(...args);if(failure==='upload-reply'&&!failed){failed=true;throw new CloudApiError('network');}return result;};
 if(failure==='local-commit')await f.client.runtime.database.write(sql=>sql.execAsync("CREATE TRIGGER fail_guest_queue AFTER INSERT ON local_sync_outbox WHEN NEW.local_id='evt_meal' BEGIN SELECT RAISE(ABORT,'queue interrupted'); END;"));
 const result=await f.run();assert.equal(result.state,failure==='local-commit'?'error':'retry');
 const before=await f.client.runtime.storage.loadEvents();
 for(const event of guest)assert.deepEqual(before.find(item=>item.id===event.id),event,'Failure must preserve each guest log');
 const enrollment=await f.client.runtime.sync.enrollmentState();
 const owner=await f.client.runtime.sync.status('pet_guest');
 const pending=await f.client.runtime.sync.nextBatch({generation:owner.generation!,accountId:owner.accountId!});
 if(failure==='upload-reply')assert.deepEqual(pending,f.batches[0],'Lost response must retain exact requests');
 await f.reopen();assert.deepEqual(await f.client.runtime.storage.loadEvents(),before);
 assert.deepEqual(await f.client.runtime.sync.enrollmentState(),enrollment);
 assert.deepEqual(await f.client.runtime.sync.nextBatch({generation:owner.generation!,accountId:owner.accountId!}),pending);
 if(failure==='local-commit')await f.client.runtime.database.write(sql=>sql.execAsync('DROP TRIGGER fail_guest_queue'));
 f.client.controller.setActive(true);await f.client.controller.refresh();await f.drain();
 const expected=ordered([...guest,...f.cloudLogs]);
 assert.deepEqual(f.remoteLogs(),expected);assert.deepEqual(ordered(await f.client.runtime.storage.loadEvents()),expected);
 assert.equal((await f.client.runtime.sync.status('pet_guest')).pending,0);
 assert.ok(f.enrollments.every(request=>JSON.stringify(request)===JSON.stringify(f.enrollments[0])),'Enrollment retries keep the original operation');
 if(failure==='upload-reply')assert.deepEqual(f.batches[1],f.batches[0],'Retry must not create new upload operations');
});

test('guest edits and new logs made during Combine baseline and an upload stay visible and reach the cloud',{timeout:10000},async t=>{
 const f=await fixture(t,{existing:true}),guest=await f.startAsGuest();await f.signIn();
 const {pull,push}=f.api;let baselineEdited=false,uploadEdited=false;
 const baselineLog:PuppyEvent={id:'evt_during_baseline',type:'meal',at:7000,source:'widget'};
 const uploadLog:PuppyEvent={id:'evt_during_upload',type:'poop',at:8000,source:'app'};
 f.api.pull=async(...args)=>{
  const result=await pull(...args);
  if(!baselineEdited){baselineEdited=true;await f.client.runtime.storage.appendEvents([baselineLog]);await f.client.runtime.storage.updateEvent('evt_pee',{note:'Changed during baseline'});}
  return result;
 };
 f.api.push=async(...args)=>{
  const result=await push(...args);
  if(!uploadEdited){uploadEdited=true;await f.client.runtime.storage.appendEvents([uploadLog]);await f.client.runtime.storage.updateEvent('evt_meal',{note:'Changed while upload was in flight'});}
  return result;
 };
 await f.enable();await f.drain();
 const expected=ordered([...guest.map(log=>log.id==='evt_pee'?{...log,note:'Changed during baseline'}:log.id==='evt_meal'?{...log,note:'Changed while upload was in flight'}:log),...f.cloudLogs,baselineLog,uploadLog]);
 assert.equal(baselineEdited,true);assert.equal(uploadEdited,true);
 assert.deepEqual(f.remoteLogs(),expected);assert.deepEqual(ordered(await f.client.runtime.storage.loadEvents()),expected);
 await f.reopen();assert.deepEqual(ordered(await f.client.runtime.storage.loadEvents()),expected);
});

for(const interruption of ['background','offline'] as const)for(const phase of ['baseline','upload'] as const)test(`guest Combine resumes after going ${interruption} during ${phase} and restarting`,{timeout:10000},async t=>{
 const f=await fixture(t,{existing:true}),guest=await f.startAsGuest();await f.signIn();await f.enable();
 let entered!:()=>void,release!:()=>void,interrupted=false;
 const started=new Promise<void>(resolve=>{entered=resolve;}),waiting=new Promise<void>(resolve=>{release=resolve;});
 const {pull,push}=f.api;
 f.api.pull=async(...args)=>{
  const result=await pull(...args);
  if(phase==='baseline'&&args[0]>0&&!interrupted){interrupted=true;entered();await waiting;}
  return result;
 };
 f.api.push=async(...args)=>{
  const result=await push(...args);
  if(phase==='upload'&&!interrupted){interrupted=true;entered();await waiting;}
  return result;
 };
 const running=f.run();await started;
 if(interruption==='background')f.client.controller.setActive(false);else f.client.controller.setOnline(false);
 release();await running;
 assert.equal(f.client.controller.read().running,false);
 const before=await f.client.runtime.storage.loadEvents();
 for(const event of guest)assert.deepEqual(before.find(item=>item.id===event.id),event);
 await f.reopen();assert.deepEqual(await f.client.runtime.storage.loadEvents(),before);
 f.client.controller.setActive(true);await f.client.controller.refresh();await f.drain();
 const expected=ordered([...guest,...f.cloudLogs]);
 assert.deepEqual(f.remoteLogs(),expected);assert.deepEqual(ordered(await f.client.runtime.storage.loadEvents()),expected);
 assert.equal((await f.client.runtime.sync.status('pet_guest')).pending,0);
 if(phase==='upload')assert.deepEqual(f.batches[1],f.batches[0],'An interrupted committed upload retries the exact operations');
});

test('offline and denied cloud access leave guest logs available for a later explicit Enable',{timeout:10000},async t=>{
 const f=await fixture(t),guest=await f.startAsGuest();await f.signIn();
 f.client.controller.setOnline(false);assert.equal(await f.client.controller.enableCloud({}),'error');
 assert.deepEqual(ordered(await f.client.runtime.storage.loadEvents()),ordered(guest));assert.equal(f.enrollments.length,0);
 f.client.controller.setOnline(true);f.summary.cloud.canSync=false;await f.client.controller.refresh();
 assert.equal(await f.client.controller.enableCloud({}),'error');assert.equal(f.client.controller.read().problem,'forbidden');
 assert.equal((await f.client.runtime.sync.status('pet_guest')).state,'local');assert.equal(f.batches.length,0);
 await f.reopen();assert.deepEqual(ordered(await f.client.runtime.storage.loadEvents()),ordered(guest));
 f.summary.cloud.canSync=true;await f.client.controller.refresh();await f.enable();await f.drain();assert.deepEqual(f.remoteLogs(),ordered(guest));
});

for(const method of ['email','apple','google'] as const)test(`failed or cancelled ${method} sign-in keeps all guest logs after reopening`,{timeout:10000},async t=>{
 const f=await fixture(t),guest=await f.startAsGuest();f.client.controller.setOnline(true);await f.client.controller.refresh();
 if(method==='email'){
  f.identity.verifyEmail=async()=>({error:{status:400,code:'INVALID_OTP'}});
  await f.client.controller.requestEmail(f.summary.user.email);
  assert.equal(await f.client.controller.verifyEmail(f.summary.user.email,'000000'),'error');
 }else{
  f.identity.signInSocial=async()=>({error:null,cancelled:true});
  assert.equal(await f.client.controller.signInSocial(method),'cancelled');
 }
 assert.equal(f.client.controller.read().account,null);assert.equal(f.enrollments.length,0);assert.equal(f.batches.length,0);
 await f.reopen();assert.deepEqual(ordered(await f.client.runtime.storage.loadEvents()),ordered(guest));
 await f.client.controller.refresh();assert.equal(f.client.controller.read().account,null);
});

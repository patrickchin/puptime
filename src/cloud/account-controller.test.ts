import assert from 'node:assert/strict';
import test,{type TestContext} from 'node:test';
import { createLocalDatabase,initializeLocalDatabase } from '../local/database.ts';
import { sqliteTestConnection } from '../local/sqlite-test-adapter.ts';
import { createLocalRuntime } from '../local/runtime-factory.ts';
import { CloudApiError,type CloudApi,type CloudAccountSummary } from './api.ts';
import * as controllerModule from './account-controller.ts';
const event={id:'one',type:'pee' as const,at:100,source:'app' as const};
async function fixture(t:TestContext) {
 const database=await createLocalDatabase(sqliteTestConnection(':memory:'));t.after(()=>database.close());
 await initializeLocalDatabase(database,()=> 'pet-1');await database.write(sql=>sql.runAsync('DELETE FROM routines'));
 const writes=new Set<()=>void>(),runtime=await createLocalRuntime(database,'pet-1',()=>{for(const fn of writes)fn();});
 const summary:CloudAccountSummary={user:{id:'account-1',email:'person@example.com',name:'Person'},cloud:{canSync:false,canExport:true,source:'none',expiresAt:null},pets:[]};
 const state={credentials:false,summary,trialCalls:0,signOutCalls:0,signOutFails:false,storageFails:false,requested:[] as string[],verifications:0};
 const config={protocolVersion:1 as const,trialDays:14,providers:{apple:false,google:true,email:true},pricingFinalized:false};
 const api:CloudApi={config:async()=>config,account:async()=>{if(!state.credentials)throw new CloudApiError('auth-required',401);return structuredClone(state.summary);},startTrial:async()=>{state.trialCalls++;state.summary.cloud={canSync:true,canExport:true,source:'trial',expiresAt:8640000000000000};return {cloud:state.summary.cloud};},enroll:async request=>({petId:request.confirmedPetId??request.localPetId}),push:async mutations=>({accepted:[],rejected:mutations.map(mutation=>({operationId:mutation.operationId,error:'retry_later' as const}))}),pull:async after=>({changes:[],cursor:after,hasMore:false})};
 const identity={requestEmail:async(email:string)=>{state.requested.push(email);return {error:null};},verifyEmail:async(_email:string,code:string)=>{state.verifications++;if(code!=='123456')return {error:{status:400,code:'INVALID_OTP'}};state.credentials=true;return {error:null};},signInSocial:async()=>{state.credentials=true;return {error:null};},signOut:async()=>{state.signOutCalls++;if(!state.storageFails)state.credentials=false;return {error:state.signOutFails?{status:503,code:'NETWORK_ERROR'}:null};},hasCredentials:async()=>{if(state.storageFails)throw new Error('secure storage failed');return state.credentials;}};
 const timers:Array<{fn:()=>void;delay:number;cancelled:boolean}>=[];
 assert.equal(typeof controllerModule.createAccountController,'function');
 const controller=controllerModule.createAccountController({runtime,api,identity,subscribeLocalWrites:(fn:()=>void)=>{writes.add(fn);return()=>{writes.delete(fn);};},defer:(fn:()=>void,delay:number)=>{const task={fn,delay,cancelled:false};timers.push(task);return()=>{task.cancelled=true;};},changed:()=>{}});
 t.after(()=>controller.stop());
 return {controller,runtime,state,api,config,timers};
}

test('configuration and sign-in are optional and never implicitly activate trial or associate local history',async t=>{
 const {controller,runtime,state}=await fixture(t);await runtime.storage.appendEvents([event]);
 await controller.refresh();assert.equal(controller.read().account,null);assert.equal(controller.read().config!.providers.email,true);
 assert.equal(await controller.requestEmail('person@example.com'),'ok');assert.equal(controller.read().codeSentTo,'person@example.com');
 assert.equal(await controller.verifyEmail('person@example.com','123456'),'ok');assert.equal(controller.read().account!.user.id,'account-1');
 assert.equal(state.trialCalls,0);assert.equal((await runtime.sync.status('pet-1')).state,'local');assert.deepEqual(await runtime.storage.loadEvents(),[event]);
});

test('invalid fields, wrong codes and unavailable providers fail without replacing signup input or local data',async t=>{
 const {controller,state}=await fixture(t);await controller.refresh();
 assert.equal(await controller.requestEmail('bad email'),'error');assert.deepEqual(state.requested,[]);
 await controller.requestEmail('person@example.com');assert.equal(await controller.verifyEmail('person@example.com','000000'),'error');assert.equal(controller.read().problem,'invalid-code');assert.equal(controller.read().codeSentTo,'person@example.com');
 assert.equal(await controller.signInSocial('apple'),'error');assert.equal(controller.read().problem,'provider-unavailable');assert.equal(controller.read().account,null);
});

test('existing-cloud confirmation precedes trial activation and durable local association',async t=>{
 const {controller,runtime,state}=await fixture(t);state.credentials=true;state.summary.pets=[{id:'cloud-pet',name:'Cloud puppy',eventCount:12}];await runtime.storage.appendEvents([event]);await controller.refresh();
 assert.equal(await controller.enableCloud({}),'confirmation-required');assert.equal(state.trialCalls,0);assert.equal((await runtime.sync.status('pet-1')).state,'local');
 assert.equal(await controller.enableCloud({confirmedPetId:'different'}),'confirmation-required');assert.equal(state.trialCalls,0);
 assert.equal(await controller.enableCloud({confirmedPetId:'cloud-pet'}),'ok');assert.equal(state.trialCalls,1);
 const saved=await runtime.sync.enrollmentState();assert.equal(saved!.request.confirmedPetId,'cloud-pet');assert.equal(saved!.accountId,'account-1');assert.equal((await runtime.sync.status('pet-1')).state,'preparing');
});

test('a trial that remains unavailable never prepares or uploads history',async t=>{
 const {controller,runtime,state,api}=await fixture(t);state.credentials=true;api.startTrial=async()=>({cloud:state.summary.cloud});await controller.refresh();
 assert.equal(await controller.enableCloud({}),'error');assert.equal(controller.read().problem,'trial-unavailable');assert.equal((await runtime.sync.status('pet-1')).state,'local');
});

async function enrollLocal(runtime:Awaited<ReturnType<typeof createLocalRuntime>>) {
 const owner={...await runtime.sync.prepareAssociation({accountId:'account-1',localPetId:runtime.petId,deviceId:runtime.deviceId,enrollment:{operationId:'enroll-1',deviceId:runtime.deviceId,localPetId:runtime.petId,name:'My puppy'}}),accountId:'account-1'};
 await runtime.sync.stageBaseline({...owner,page:{changes:[],cursor:0,hasMore:false}});await runtime.sync.completeAssociation({...owner,cloudPetId:runtime.petId});return owner;
}

test('pending sign-out needs explicit confirmation and keeps local history while detaching the cloud owner',async t=>{
 const {controller,runtime,state}=await fixture(t);state.credentials=true;await enrollLocal(runtime);await runtime.storage.appendEvents([event]);await controller.refresh();
 assert.equal(await controller.signOut({}),'pending-confirmation-required');assert.equal(state.signOutCalls,0);assert.equal((await runtime.sync.status('pet-1')).state,'active');
 assert.equal(await controller.signOut({confirmPending:true}),'ok');assert.equal(controller.read().account,null);assert.equal((await runtime.sync.status('pet-1')).state,'local');assert.deepEqual(await runtime.storage.loadEvents(),[event]);
});

test('offline SDK sign-out that already cleared credentials detaches locally and reports unconfirmed server revocation',async t=>{
 const {controller,runtime,state}=await fixture(t);state.credentials=true;state.signOutFails=true;await enrollLocal(runtime);await controller.refresh();
 assert.equal(await controller.signOut({confirmPending:true}),'ok');assert.equal(controller.read().account,null);assert.equal(controller.read().problem,'remote-sign-out-unconfirmed');assert.equal((await runtime.sync.status('pet-1')).state,'local');
});

test('secure storage failure never claims sign-out succeeded or starts another upload',async t=>{
 const {controller,runtime,state,timers}=await fixture(t);state.credentials=true;state.storageFails=true;state.signOutFails=true;await enrollLocal(runtime);await controller.refresh();
 assert.equal(await controller.signOut({confirmPending:true}),'error');assert.equal(controller.read().problem,'sign-out-failed');assert.ok(controller.read().account);assert.equal(timers.filter(task=>!task.cancelled).length,0);
});

test('a different signed-in account never reassigns the old queue or starts its own trial',async t=>{
 const {controller,runtime,state}=await fixture(t);state.credentials=true;await enrollLocal(runtime);state.summary.user.id='account-2';await controller.refresh();
 assert.equal(await controller.enableCloud({}),'error');assert.equal(controller.read().problem,'account-mismatch');assert.equal(state.trialCalls,0);assert.equal((await runtime.sync.status('pet-1')).accountId,'account-1');
});

const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));
test('foreground work coalesces local commits and stops timers on background, disconnection and disposal',async t=>{
 const {controller,runtime,state,timers}=await fixture(t);state.credentials=true;state.summary.cloud={canSync:true,canExport:true,source:'trial',expiresAt:8640000000000000};await enrollLocal(runtime);await controller.refresh();
 controller.setActive(true);await controller.refresh();assert.equal(timers.filter(task=>!task.cancelled).length,1);
 await runtime.storage.appendEvents([event]);await runtime.storage.updateEvent(event.id,{note:'new'});await tick();assert.equal(timers.filter(task=>!task.cancelled).length,1);
 controller.setOnline(false);assert.equal(timers.filter(task=>!task.cancelled).length,0);
 controller.setOnline(true);await controller.refresh();assert.equal(timers.filter(task=>!task.cancelled).length,1);
 controller.setActive(false);assert.equal(timers.filter(task=>!task.cancelled).length,0);
 controller.stop();await runtime.storage.updateEvent(event.id,{note:'after stop'});await tick();assert.equal(timers.filter(task=>!task.cancelled).length,0);assert.equal((await runtime.storage.loadEvents())[0].note,'after stop');
});

test('sign-out aborts and awaits an in-flight runner before SDK credentials are cleared',async t=>{
 const {controller,runtime,state,api,timers}=await fixture(t);state.credentials=true;state.summary.cloud={canSync:true,canExport:true,source:'trial',expiresAt:8640000000000000};await enrollLocal(runtime);
 let entered=false,aborted=false;
 api.pull=async(_after,signal)=>{entered=true;return new Promise((_,reject)=>{signal!.addEventListener('abort',()=>{aborted=true;reject(signal!.reason);},{once:true});});};
 controller.setActive(true);await controller.refresh();const timer=timers.find(task=>!task.cancelled)!;timer.cancelled=true;timer.fn();await tick();assert.equal(entered,true);
 assert.equal(await controller.signOut({confirmPending:true}),'ok');assert.equal(aborted,true);assert.equal(state.credentials,false);assert.equal(controller.read().running,false);assert.equal((await runtime.sync.status('pet-1')).state,'local');
});

test('disposing during configuration loading prevents subsequent account and trial requests',async t=>{
 const {controller,state,api}=await fixture(t);state.credentials=true;
 let release:()=>void=()=>{};const waiting=new Promise<void>(resolve=>{release=resolve;});let accountCalls=0;
 const config=await api.config();api.config=async()=>{await waiting;return config;};api.account=async()=>{accountCalls++;return state.summary;};
 const request=controller.refresh();await tick();controller.stop();release();await request;
 assert.equal(accountCalls,0);assert.equal(state.trialCalls,0);
});
test('cold-start service failure still permits confirmed local sign-out of a saved association',async t=>{
 const {controller,runtime,state,api}=await fixture(t);state.credentials=true;state.signOutFails=true;
 await enrollLocal(runtime);await runtime.storage.appendEvents([event]);
 api.config=async()=>{throw new CloudApiError('network');};
 await controller.refresh();assert.equal(controller.read().account,null);assert.equal(controller.read().sync!.accountId,'account-1');
 assert.equal(await controller.signOut({}),'pending-confirmation-required');assert.equal(state.credentials,true);
 assert.equal(await controller.signOut({confirmPending:true}),'ok');assert.equal(state.credentials,false);assert.equal(controller.read().sync!.accountId,null);
 assert.deepEqual(await runtime.storage.loadEvents(),[event]);assert.equal(controller.read().problem,'remote-sign-out-unconfirmed');
});

test('automatic runner expiry exposes a paused entitlement without another manual account refresh',async t=>{
 const {controller,runtime,state,timers}=await fixture(t);
 state.credentials=true;state.summary.cloud={canSync:true,canExport:true,source:'trial',expiresAt:8640000000000000};await enrollLocal(runtime);
 controller.setActive(true);await controller.refresh();
 state.summary.cloud={canSync:false,canExport:true,source:'none',expiresAt:null};
 await runtime.storage.appendEvents([event]);await tick();
 const pending=timers.find(timer=>!timer.cancelled)!;pending.cancelled=true;pending.fn();
 for(let i=0;i<50&&controller.read().running;i++)await tick();
 assert.equal(controller.read().run!.state,'expired');
 assert.equal(controller.read().problem,'expired');
 assert.ok(controller.read().sync!.pending>0);assert.deepEqual(await runtime.storage.loadEvents(),[event]);
 const {accountStatus}=await import('./account-status.ts');assert.equal(accountStatus(controller.read()),'expired');
 assert.equal(timers.filter(timer=>!timer.cancelled).length,0);
});

test('another device winning first enrollment returns to explicit puppy confirmation without logout or losing local work',async t=>{
 const {controller,runtime,state,api,timers}=await fixture(t);state.credentials=true;await runtime.storage.appendEvents([event]);
 const requests:Parameters<CloudApi['enroll']>[0][]=[];
 api.enroll=async request=>{requests.push(request);state.summary.pets=[{id:'other-device-pet',name:'Cloud puppy',eventCount:3}];throw new CloudApiError('conflict',409);};
 controller.setActive(true);await controller.refresh();assert.equal(await controller.enableCloud({}),'ok');
 const pending=timers.find(timer=>!timer.cancelled)!;pending.cancelled=true;pending.fn();
 for(let i=0;i<50&&controller.read().running;i++)await tick();
 assert.equal((await runtime.sync.status(runtime.petId)).state,'local');
 assert.equal(controller.read().problem,'confirmation-required');assert.equal(controller.read().account!.pets[0].id,'other-device-pet');
 assert.deepEqual(await runtime.storage.loadEvents(),[event]);assert.equal(state.trialCalls,1);
 await controller.retry();assert.equal(requests.length,1);
 assert.equal(await controller.enableCloud({}),'confirmation-required');assert.equal((await runtime.sync.status(runtime.petId)).state,'local');
 assert.equal(await controller.enableCloud({confirmedPetId:'other-device-pet'}),'ok');
 const saved=await runtime.sync.enrollmentState();assert.equal(saved!.request.confirmedPetId,'other-device-pet');
 assert.notEqual(saved!.request.operationId,requests[0].operationId);assert.equal(state.trialCalls,1);
});

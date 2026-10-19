import assert from 'node:assert/strict';
import test,{type TestContext} from 'node:test';
import { createLocalDatabase,initializeLocalDatabase } from '../local/database.ts';
import { sqliteTestConnection } from '../local/sqlite-test-adapter.ts';
import { createLocalRuntime } from '../local/runtime-factory.ts';
import { CloudApiError,type CloudApi,type CloudAccountSummary } from './api.ts';
import type {Revision} from './protocol.ts';
import * as controllerModule from './account-controller.ts';
const event={id:'one',type:'pee' as const,at:100,source:'app' as const};
async function fixture(t:TestContext,{pristine=false,exportCloud}:{pristine?:boolean;exportCloud?:controllerModule.CloudExportAction}={}) {
 const database=await createLocalDatabase(sqliteTestConnection(':memory:'));t.after(()=>database.close());
 await initializeLocalDatabase(database,()=> 'pet-1');if(!pristine)await database.write(sql=>sql.runAsync('DELETE FROM routines'));
 const writes=new Set<()=>void>(),runtime=await createLocalRuntime(database,'pet-1',()=>{for(const fn of writes)fn();});
 const summary:CloudAccountSummary={user:{id:'account-1',email:'person@example.com',name:'Person'},cloud:{canSync:false,canExport:true,source:'none',expiresAt:null},pets:[]};
 const state={credentials:false,summary,trialCalls:0,signOutCalls:0,signOutFails:false,storageFails:false,requested:[] as string[],verifications:0,linkCalls:0,listCalls:0,linkedAccounts:[] as {userId:string;providerId:string}[]};
 const config={protocolVersion:1 as const,trialDays:14,providers:{apple:false,google:true,email:true},pricingFinalized:false};
 const api:CloudApi={config:async()=>config,account:async()=>{if(!state.credentials)throw new CloudApiError('auth-required',401);return structuredClone(state.summary);},startTrial:async()=>{state.trialCalls++;state.summary.cloud={canSync:true,canExport:true,source:'trial',expiresAt:8640000000000000};return {cloud:state.summary.cloud};},enroll:async request=>({petId:request.confirmedPetId??request.localPetId}),push:async mutations=>({accepted:[],rejected:mutations.map(mutation=>({operationId:mutation.operationId,error:'retry_later' as const}))}),pull:async after=>({changes:[],cursor:after,hasMore:false}),history:async()=>({revisions:[]})};
 const identity:controllerModule.IdentityAdapter={requestEmail:async(email:string)=>{state.requested.push(email);return {error:null};},verifyEmail:async(_email:string,code:string)=>{state.verifications++;if(code!=='123456')return {error:{status:400,code:'INVALID_OTP'}};state.credentials=true;return {error:null};},signInSocial:async()=>{state.credentials=true;return {error:null};},linkSocial:async provider=>{state.linkCalls++;state.linkedAccounts.push({userId:state.summary.user.id,providerId:provider});return {error:null};},listAccounts:async()=>{state.listCalls++;return {data:structuredClone(state.linkedAccounts),error:null};},signOut:async()=>{state.signOutCalls++;if(!state.storageFails)state.credentials=false;return {error:state.signOutFails?{status:503,code:'NETWORK_ERROR'}:null};},hasCredentials:async()=>{if(state.storageFails)throw new Error('secure storage failed');return state.credentials;}};
 const timers:Array<{fn:()=>void;delay:number;cancelled:boolean}>=[];
 assert.equal(typeof controllerModule.createAccountController,'function');
 const controller=controllerModule.createAccountController({runtime,api,identity,exportCloud,subscribeLocalWrites:(fn:()=>void)=>{writes.add(fn);return()=>{writes.delete(fn);};},defer:(fn:()=>void,delay:number)=>{const task={fn,delay,cancelled:false};timers.push(task);return()=>{task.cancelled=true;};},changed:()=>{}});
 t.after(()=>controller.stop());
 return {controller,runtime,state,api,identity,config,timers};
}

async function localTables(runtime:Awaited<ReturnType<typeof createLocalRuntime>>) {
 return runtime.database.read(async sql=>{
  const tables=await sql.getAllAsync<{name:string}>("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
  return Promise.all(tables.map(async({name})=>[name,await sql.getAllAsync(`SELECT * FROM "${name.replaceAll('"','""')}" ORDER BY rowid`)]));
 });
}

test('identity adapter uses official explicit linking and normalizes only safe account fields',async()=>{
 const calls:unknown[]=[],sdk={emailOtp:{sendVerificationOtp:async()=>({error:null})},signIn:{emailOtp:async()=>({error:null}),social:async(input:unknown)=>{calls.push(input);return {error:null};}},signOut:async()=>({error:null}),getCookie:async()=> 'managed-cookie',linkSocial:async(input:unknown)=>{calls.push(input);return {error:null};},listAccounts:async()=>({data:[{userId:'owner',providerId:'google',accountId:'private-subject',accessToken:'private-token'}] as unknown,error:null})};
 const identity=controllerModule.createIdentityAdapter(sdk);
 await identity.signInSocial('google');await identity.linkSocial('apple');
 assert.deepEqual(calls,[{provider:'google',callbackURL:'puptime://account',errorCallbackURL:'puptime://account'},{provider:'apple',callbackURL:'puptime://account',errorCallbackURL:'puptime://account'}]);
 assert.deepEqual(await identity.listAccounts(),{data:[{userId:'owner',providerId:'google'}],error:null});
 sdk.listAccounts=async()=>({data:[{providerId:'google'}],error:null});
 assert.deepEqual(await identity.listAccounts(),{data:null,error:{status:502,code:'INVALID_RESPONSE'}});
});

test('refresh and retry load connected providers only for configured signed-in identities',async t=>{
 const {controller,state,config}=await fixture(t);config.providers.google=false;state.credentials=true;
 assert.equal(await controller.refresh(),'ok');assert.equal(state.listCalls,0);assert.deepEqual(controller.read().linkedProviders,[]);
 config.providers.apple=true;state.linkedAccounts=[{userId:'account-1',providerId:'apple'},{userId:'account-1',providerId:'other'}];
 assert.equal(await controller.refresh(),'ok');assert.deepEqual(controller.read().linkedProviders,['apple']);
 state.linkedAccounts.push({userId:'account-1',providerId:'google'});
 assert.equal(await controller.retry(),'ok');assert.deepEqual(controller.read().linkedProviders,['apple','google']);
 state.credentials=false;await controller.refresh();assert.equal(controller.read().linkedProviders,null);
});

test('connecting a provider retains every local table and pending operation without activating cloud',async t=>{
 const {controller,runtime,state}=await fixture(t);state.credentials=true;await enrollLocal(runtime);await runtime.storage.appendEvents([event]);await controller.refresh();
 const before=await localTables(runtime),status=await runtime.sync.status(runtime.petId);assert.ok(status.pending>0);
 assert.equal(await controller.connectProvider('google'),'ok');assert.deepEqual(controller.read().linkedProviders,['google']);assert.equal(controller.read().linkingProvider,null);
 assert.deepEqual(await localTables(runtime),before);assert.deepEqual(await runtime.sync.status(runtime.petId),status);
 assert.equal(state.trialCalls,0);assert.equal(state.signOutCalls,0);assert.equal(state.credentials,true);assert.equal(state.linkCalls,1);
 assert.equal(await controller.connectProvider('google'),'ok');assert.equal(state.linkCalls,1);
});

test('a signed-in local-only owner can connect a provider without enrollment or a trial',async t=>{
 const {controller,runtime,state}=await fixture(t);state.credentials=true;await runtime.storage.appendEvents([event]);await controller.refresh();const before=await localTables(runtime);
 assert.equal(await controller.connectProvider('google'),'ok');assert.deepEqual(await localTables(runtime),before);assert.equal(state.trialCalls,0);assert.equal((await runtime.sync.status(runtime.petId)).state,'local');
});

test('an OAuth initiation response without a newly linked account is honestly incomplete',async t=>{
 const {controller,runtime,state,identity}=await fixture(t);state.credentials=true;await enrollLocal(runtime);await runtime.storage.appendEvents([event]);await controller.refresh();const before=await localTables(runtime);
 identity.linkSocial=async()=>({error:null});
 assert.equal(await controller.connectProvider('google'),'error');assert.equal(controller.read().problem,'link-incomplete');assert.deepEqual(controller.read().linkedProviders,[]);
 assert.deepEqual(await localTables(runtime),before);assert.equal(state.credentials,true);assert.equal(state.signOutCalls,0);
});

test('returning from the provider browser does not erase the incomplete result with a queued foreground refresh',async t=>{
 const {controller,state,identity}=await fixture(t);state.credentials=true;controller.setActive(true);await controller.refresh();
 let release!:()=>void,started!:()=>void;const entered=new Promise<void>(resolve=>{started=resolve;});
 identity.linkSocial=async()=>{started();await new Promise<void>(resolve=>{release=resolve;});return {error:null};};
 const request=controller.connectProvider('google');await entered;controller.setActive(false);controller.setActive(true);release();
 assert.equal(await request,'error');await tick();assert.equal(controller.read().problem,'link-incomplete');
});

test('a lost linking reply stays unconfirmed until retry reconciles the same owner without replaying OAuth',async t=>{
 const {controller,runtime,state,identity}=await fixture(t);state.credentials=true;await enrollLocal(runtime);await runtime.storage.appendEvents([event]);await controller.refresh();const before=await localTables(runtime);
 identity.linkSocial=async()=>{state.linkCalls++;state.linkedAccounts=[{userId:'account-1',providerId:'google'}];throw new Error('response lost');};
 assert.equal(await controller.connectProvider('google'),'error');assert.equal(controller.read().problem,'network');assert.deepEqual(controller.read().linkedProviders,[]);
 assert.equal(await controller.retry(),'ok');assert.deepEqual(controller.read().linkedProviders,['google']);assert.equal(state.linkCalls,1);assert.deepEqual(await localTables(runtime),before);
});

test('a delayed post-link provider list is fenced against a replacement local generation',async t=>{
 const {controller,runtime,state,identity}=await fixture(t);state.credentials=true;const owner=await enrollLocal(runtime);await runtime.storage.appendEvents([event]);await controller.refresh();
 let release!:(value:{data:{userId:string;providerId:string}[];error:null})=>void,started!:()=>void,count=0;const entered=new Promise<void>(resolve=>{started=resolve;});
 identity.listAccounts=async()=>{if(++count===1)return {data:[],error:null};started();return new Promise(resolve=>{release=resolve;});};
 const request=controller.connectProvider('google');await entered;await runtime.sync.detach(owner);await runtime.sync.prepareAssociation({accountId:'account-1',localPetId:runtime.petId,deviceId:runtime.deviceId,enrollment:{operationId:'new-list-generation',deviceId:runtime.deviceId,localPetId:runtime.petId,name:'My puppy'}});const before=await localTables(runtime);
 release({data:[{userId:'account-1',providerId:'google'}],error:null});assert.equal(await request,'error');assert.equal(controller.read().problem,'account-mismatch');assert.equal(controller.read().linkedProviders,null);assert.deepEqual(await localTables(runtime),before);
});

test('duplicate linking taps dispatch once and preserve legitimate writes made while OAuth is open',async t=>{
 const {controller,runtime,state,identity}=await fixture(t);state.credentials=true;await enrollLocal(runtime);await runtime.storage.appendEvents([event]);await controller.refresh();
 let release!:()=>void,started!:()=>void;const entered=new Promise<void>(resolve=>{started=resolve;});
 identity.linkSocial=async()=>{state.linkCalls++;started();await new Promise<void>(resolve=>{release=resolve;});state.linkedAccounts=[{userId:'account-1',providerId:'google'}];return {error:null};};
 const request=controller.connectProvider('google');await entered;assert.equal(controller.read().linkingProvider,'google');
 assert.equal(await controller.connectProvider('google'),'cancelled');assert.equal(await controller.signInSocial('google'),'cancelled');
 await runtime.storage.appendEvents([{...event,id:'written-during-oauth',at:200}]);const before=await localTables(runtime);release();assert.equal(await request,'ok');
 assert.equal(state.linkCalls,1);assert.deepEqual(await localTables(runtime),before);assert.equal((await runtime.storage.loadEvents()).length,2);
});

for(const change of ['session','owner','dispose','network','auth-expired'] as const)test(`a linking completion after ${change} cannot publish a stale connected state`,async t=>{
 const {controller,runtime,state,api,identity}=await fixture(t);state.credentials=true;const owner=await enrollLocal(runtime);await runtime.storage.appendEvents([event]);await controller.refresh();
 let release!:()=>void,started!:()=>void;const entered=new Promise<void>(resolve=>{started=resolve;});
 identity.linkSocial=async()=>{started();await new Promise<void>(resolve=>{release=resolve;});state.linkedAccounts=[{userId:'account-1',providerId:'google'}];return {error:null};};
 const request=controller.connectProvider('google');await entered;
 if(change==='session')state.summary={...state.summary,user:{...state.summary.user,id:'account-2'}};
 if(change==='owner'){await runtime.sync.detach(owner);await runtime.sync.prepareAssociation({accountId:'account-1',localPetId:runtime.petId,deviceId:runtime.deviceId,enrollment:{operationId:'replacement-owner',deviceId:runtime.deviceId,localPetId:runtime.petId,name:'My puppy'}});}
 if(change==='network')controller.setOnline(false);
 if(change==='auth-expired')state.credentials=false;
 let laterAccountCalls=0;const original=api.account;api.account=async()=>{laterAccountCalls++;return original();};
 const listCalls=state.listCalls,before=await localTables(runtime);if(change==='dispose')controller.stop();const frozen=controller.read();
 release();assert.equal(await request,'error');assert.notDeepEqual(controller.read().linkedProviders,['google']);assert.deepEqual(await localTables(runtime),before);
 assert.equal(state.signOutCalls,0);assert.equal(state.trialCalls,0);
 if(change==='dispose'){assert.equal(controller.read(),frozen);assert.equal(laterAccountCalls,0);assert.equal(state.listCalls,listCalls);}
 if(change==='session'||change==='owner')assert.equal(controller.read().problem,'account-mismatch');
 if(change==='auth-expired'){assert.equal(controller.read().account,null);assert.equal(controller.read().problem,'auth-required');}
});

test('a provider list from another user or a failed verification never claims a new connection',async t=>{
 const {controller,state,identity}=await fixture(t);state.credentials=true;await controller.refresh();
 identity.linkSocial=async()=>({error:null});identity.listAccounts=async()=>({data:[{userId:'other-owner',providerId:'google'}],error:null});
 assert.equal(await controller.connectProvider('google'),'error');assert.equal(controller.read().problem,'account-mismatch');assert.equal(controller.read().linkedProviders,null);
 identity.listAccounts=async()=>({data:null,error:{status:503}});assert.equal(await controller.refresh(),'error');assert.equal(controller.read().linkedProviders,null);
 identity.listAccounts=async()=>{throw new Error('network');};assert.equal(await controller.refresh(),'error');assert.equal(controller.read().problem,'network');
});

test('provider linking rejects offline unavailable unauthenticated and mismatched owners before OAuth',async t=>{
 const {controller,runtime,state}=await fixture(t);await controller.refresh();assert.equal(await controller.connectProvider('google'),'error');
 state.credentials=true;await controller.refresh();assert.equal(await controller.connectProvider('apple'),'error');
 controller.setOnline(false);assert.equal(await controller.connectProvider('google'),'error');controller.setOnline(true);
 await runtime.sync.prepareAssociation({accountId:'different-owner',localPetId:runtime.petId,deviceId:runtime.deviceId,enrollment:{operationId:'wrong-owner',deviceId:runtime.deviceId,localPetId:runtime.petId,name:'My puppy'}});
 assert.equal(await controller.connectProvider('google'),'error');assert.equal(controller.read().problem,'account-mismatch');assert.equal(state.linkCalls,0);
});

test('an unconfirmed social browser sign-in keeps its input and explains the original-method path',async t=>{
 const {controller,runtime,identity}=await fixture(t);await controller.refresh();await controller.requestEmail('person@example.com');identity.signInSocial=async()=>({error:null});const before=await localTables(runtime);
 assert.equal(await controller.signInSocial('google'),'error');assert.equal(controller.read().problem,'social-incomplete');assert.equal(controller.read().codeSentTo,'person@example.com');assert.deepEqual(await localTables(runtime),before);
});

test('first-launch restore validates local work before activating any trial',async t=>{
 const {controller,runtime,state}=await fixture(t,{pristine:true});
 state.credentials=true;state.summary.pets=[{id:'cloud-pet',name:'Basil',eventCount:2}];
 await runtime.storage.appendEvents([event]);await controller.refresh();
 assert.equal(await controller.enableCloud({confirmedPetId:'cloud-pet',mode:'restore'}),'confirmation-required');
 assert.equal(state.trialCalls,0);assert.equal((await runtime.sync.status('pet-1')).state,'local');
 assert.deepEqual(await runtime.storage.loadEvents(),[event]);
});

test('first-launch local fallback detaches a staged restore and keeps account credentials',async t=>{
 const {controller,runtime,state,timers}=await fixture(t,{pristine:true});
 state.credentials=true;state.summary.cloud={canSync:true,canExport:true,source:'trial',expiresAt:8640000000000000};
 state.summary.pets=[{id:'cloud-pet',name:'Basil',eventCount:2}];await controller.refresh();
 assert.equal(await controller.enableCloud({confirmedPetId:'cloud-pet',mode:'restore'}),'ok');
 const status=await runtime.sync.status('pet-1');assert.ok(status.generation);
 const fence={generation:status.generation,accountId:'account-1'};
 await runtime.sync.stageBaseline({...fence,page:{changes:[],cursor:0,hasMore:false}});
 assert.equal(await controller.continueLocally(),'ok');
 assert.equal(state.credentials,true);assert.equal(state.signOutCalls,0);assert.equal(state.trialCalls,0);
 assert.equal((await runtime.sync.status('pet-1')).state,'local');assert.equal(await runtime.sync.enrollmentState(),null);
 assert.equal((await runtime.storage.loadSchedule()).length,12);
 controller.setActive(true);await controller.refresh();await runtime.storage.appendEvents([event]);await controller.refresh();
 assert.equal(timers.filter(timer=>!timer.cancelled).length,0);
 assert.deepEqual(await runtime.storage.loadEvents(),[event]);
 assert.equal((await runtime.sync.status('pet-1')).pending,0);
});

test('first-launch local fallback confirms pending work and never detaches after setup completed',async t=>{
 const {controller,runtime,state}=await fixture(t);state.credentials=true;await controller.refresh();
 await controller.enableCloud({});const status=await runtime.sync.status('pet-1');assert.ok(status.generation);
 const fence={generation:status.generation,accountId:'account-1'};
 await runtime.sync.stageBaseline({...fence,page:{changes:[],cursor:0,hasMore:false}});
 await runtime.sync.completeAssociation({...fence,cloudPetId:'pet-1'});await runtime.storage.appendEvents([event]);await controller.refresh();
 const before=await runtime.sync.status('pet-1');assert.ok(before.pending>0);
 assert.equal(await controller.continueLocally(),'pending-confirmation-required');
 assert.deepEqual(await runtime.sync.status('pet-1'),before);
 await runtime.storage.completeOnboarding();
 assert.equal(await controller.continueLocally({confirmPending:true}),'cancelled');
 assert.deepEqual(await runtime.sync.status('pet-1'),before);assert.equal(state.credentials,true);
});

test('first-launch confirmed local fallback retains pending records without signing out',async t=>{
 const {controller,runtime,state}=await fixture(t);state.credentials=true;await controller.refresh();await controller.enableCloud({});
 const status=await runtime.sync.status('pet-1');assert.ok(status.generation);const fence={generation:status.generation,accountId:'account-1'};
 await runtime.sync.stageBaseline({...fence,page:{changes:[],cursor:0,hasMore:false}});await runtime.sync.completeAssociation({...fence,cloudPetId:'pet-1'});
 await runtime.storage.appendEvents([event]);await controller.refresh();assert.ok((await runtime.sync.status('pet-1')).pending>0);
 assert.equal(await controller.continueLocally({confirmPending:true}),'ok');
 assert.equal((await runtime.sync.status('pet-1')).state,'local');assert.deepEqual(await runtime.storage.loadEvents(),[event]);
 assert.equal(state.credentials,true);assert.equal(state.signOutCalls,0);assert.equal(state.trialCalls,1);
});

test('first-launch restore confirmation pauses automatic retries until an explicit local decision',async t=>{
 const {controller,runtime,state,api,timers}=await fixture(t,{pristine:true});
 state.credentials=true;state.summary.cloud={canSync:true,canExport:true,source:'trial',expiresAt:8640000000000000};
 state.summary.pets=[{id:'cloud-pet',name:'Basil',eventCount:0}];await controller.refresh();
 let enrollments=0;api.enroll=async()=>{enrollments++;return {petId:'cloud-pet'};};
 api.pull=async after=>{await runtime.storage.appendEvents([event]);return {changes:[],cursor:after,hasMore:false};};
 await controller.enableCloud({confirmedPetId:'cloud-pet',mode:'restore'});controller.setActive(true);await controller.refresh();
 const task=timers.find(timer=>!timer.cancelled)!;assert.ok(task);task.cancelled=true;task.fn();await tick();
 assert.equal(controller.read().problem,'confirmation-required');assert.equal(enrollments,1);
 assert.equal(timers.filter(timer=>!timer.cancelled).length,0);
 await controller.refresh();assert.equal(timers.filter(timer=>!timer.cancelled).length,0);
 assert.equal(controller.read().problem,'confirmation-required');
 assert.equal(await controller.continueLocally(),'ok');assert.deepEqual(await runtime.storage.loadEvents(),[event]);
 assert.equal((await runtime.sync.status('pet-1')).state,'local');
});

test('first-launch local recovery remains available without a configured identity client',async t=>{
 const {runtime}=await fixture(t,{pristine:true});
 assert.equal(typeof controllerModule.continueFirstLaunchLocally,'function');
 await runtime.sync.prepareAssociation({accountId:'account-1',localPetId:'pet-1',deviceId:runtime.deviceId,enrollment:{operationId:'offline-restore',deviceId:runtime.deviceId,localPetId:'pet-1',name:'Basil',confirmedPetId:'cloud-pet'},mode:'restore'});
 assert.equal(await controllerModule.continueFirstLaunchLocally(runtime),'ok');
 assert.equal((await runtime.sync.status('pet-1')).state,'local');assert.equal((await runtime.storage.loadSchedule()).length,12);
 await runtime.storage.completeOnboarding();assert.equal(await controllerModule.continueFirstLaunchLocally(runtime),'cancelled');
});

test('first-launch duplicate email taps dispatch one request and keep the original challenge',async t=>{
 const {controller,state}=await fixture(t);await controller.refresh();
 assert.deepEqual(await Promise.all([controller.requestEmail('person@example.com'),controller.requestEmail('person@example.com')]),['ok','cancelled']);
 assert.deepEqual(state.requested,['person@example.com']);assert.equal(controller.read().codeSentTo,'person@example.com');
 assert.equal(controller.read().problem,null);assert.equal(state.trialCalls,0);
});

test('first-launch duplicate verification taps never replay a consumed code or replace successful sign-in with an error',async t=>{
 const {controller,state,runtime}=await fixture(t);await controller.refresh();await controller.requestEmail('person@example.com');
 assert.deepEqual(await Promise.all([controller.verifyEmail('person@example.com','123456'),controller.verifyEmail('person@example.com','123456')]),['ok','cancelled']);
 assert.equal(state.verifications,1);assert.equal(controller.read().account!.user.id,'account-1');assert.equal(controller.read().problem,null);
 assert.equal(state.trialCalls,0);assert.equal((await runtime.sync.status('pet-1')).state,'local');
});

test('first-launch duplicate social taps keep a successful account instead of reporting an account mismatch',async t=>{
 const {controller,state}=await fixture(t);await controller.refresh();
 assert.deepEqual(await Promise.all([controller.signInSocial('google'),controller.signInSocial('google')]),['ok','cancelled']);
 assert.equal(controller.read().account!.user.id,'account-1');assert.equal(controller.read().problem,null);assert.equal(state.trialCalls,0);
});

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

const historical:Revision={recordId:'["event","cloud-1","one"]',revision:1,sequence:2,operationId:'server-first',deviceId:'other-device',acceptedAt:1000,baseRevision:0,intent:'create',proposal:{type:'pee',at:100,source:'app',note:'First'},before:null,after:{id:'["event","cloud-1","one"]',petId:'cloud-1',kind:'event',revision:1,sequence:2,deleted:false,updatedAt:1000,data:{type:'pee',at:100,source:'app',note:'First'}},reason:'created'};
async function historyFixture(t:TestContext){
 const f=await fixture(t);assert.equal(typeof f.controller.eventHistory,'function');
 f.state.credentials=true;f.state.summary.cloud={canSync:true,canExport:true,source:'trial',expiresAt:8640000000000000};f.state.summary.pets=[{id:'cloud-1',name:'My puppy',eventCount:1}];
 const owner={...await f.runtime.sync.prepareAssociation({accountId:'account-1',localPetId:'pet-1',deviceId:f.runtime.deviceId,enrollment:{operationId:'history-enroll',deviceId:f.runtime.deviceId,localPetId:'pet-1',name:'My puppy',confirmedPetId:'cloud-1'}}),accountId:'account-1'};
 await f.runtime.sync.stageBaseline({...owner,page:{changes:[{id:'cloud-1',petId:'cloud-1',kind:'puppy',revision:1,sequence:1,deleted:false,updatedAt:1000,data:{name:'My puppy'}},{...historical.after,revision:2,sequence:3,updatedAt:2000,data:{type:'pee',at:100,source:'app',note:'Second'}}],cursor:3,hasMore:false}});
 await f.runtime.sync.completeAssociation({...owner,cloudPetId:'cloud-1'});await f.controller.refresh();return {...f,owner};
}

test('cloud history resolves only the enrolled record and leaves local versions trial and account status alone',async t=>{
 const {controller,runtime,state,api}=await historyFixture(t),signal=new AbortController().signal;let requests=0;
 api.history=async(recordId,beforeRevision,received)=>{requests++;assert.equal(recordId,'["event","cloud-1","one"]');assert.equal(beforeRevision,2);assert.equal(received,signal);return {revisions:[historical]};};
 const local=await runtime.history.eventPage('one');assert.deepEqual(await controller.eventHistory('one',2,signal),{revisions:[historical]});
 assert.equal(requests,1);assert.equal(state.trialCalls,0);assert.equal(controller.read().problem,null);assert.deepEqual(await runtime.history.eventPage('one'),local);
});

test('cloud history refuses unauthenticated unenrolled or offline requests while local history stays available',async t=>{
 const {controller,runtime,state,api}=await fixture(t);assert.equal(typeof controller.eventHistory,'function');let requests=0;api.history=async()=>{requests++;return {revisions:[]};};
 await runtime.storage.appendEvents([event]);await controller.refresh();
 await assert.rejects(controller.eventHistory('one'),error=>error instanceof CloudApiError&&error.category==='auth-required');
 state.credentials=true;state.summary.cloud={canSync:true,canExport:true,source:'trial',expiresAt:8640000000000000};await controller.refresh();
 await assert.rejects(controller.eventHistory('one'),error=>error instanceof CloudApiError&&error.category==='forbidden');
 controller.setOnline(false);await assert.rejects(controller.eventHistory('one'),error=>error instanceof CloudApiError&&error.category==='network');
 assert.equal(requests,0);assert.equal((await runtime.history.eventPage('one')).entries.length,1);assert.deepEqual(await runtime.storage.loadEvents(),[event]);
});

test('a remote history access failure never replaces local history or the account problem state',async t=>{
 const {controller,runtime,api}=await historyFixture(t),before=await runtime.history.eventPage('one');
 api.history=async()=>{throw new CloudApiError('expired',402);};
 await assert.rejects(controller.eventHistory('one'),error=>error instanceof CloudApiError&&error.category==='expired');
 assert.deepEqual(await runtime.history.eventPage('one'),before);assert.equal(controller.read().problem,null);
});

for(const action of ['sign-out','account-switch','generation-change','dispose'] as const)test(`a cloud history response after ${action} cannot expose the old request result`,{timeout:5000},async t=>{
 const {controller,runtime,state,api,owner}=await historyFixture(t);let release!:(value:{revisions:Revision[]})=>void,started!:()=>void;
 const entered=new Promise<void>(resolve=>{started=resolve;});api.history=()=>{started();return new Promise(resolve=>{release=resolve;});};
 const request=controller.eventHistory('one');await Promise.race([entered,request.then(()=>assert.fail('The request must await its response.'))]);
 if(action==='sign-out')await controller.signOut({confirmPending:true});
 if(action==='account-switch'){state.summary={...state.summary,user:{...state.summary.user,id:'account-2'}};await controller.refresh();}
 if(action==='generation-change'){await runtime.sync.detach(owner);await runtime.sync.prepareAssociation({accountId:'account-1',localPetId:'pet-1',deviceId:runtime.deviceId,enrollment:{operationId:'new-generation',deviceId:runtime.deviceId,localPetId:'pet-1',name:'My puppy',confirmedPetId:'cloud-1'}});}
 if(action==='dispose')controller.stop();
 release({revisions:[historical]});await assert.rejects(request,error=>error instanceof CloudApiError&&error.category==='conflict');
 assert.equal((await runtime.storage.loadEvents())[0].note,'Second');assert.equal(state.trialCalls,0);
});


test('cloud export works after paid access expires and preserves every local row and pending operation',async t=>{
 let calls=0;
 const f=await fixture(t,{exportCloud:async(expected,ready,signal)=>{calls++;assert.equal(expected,'account-1');assert.equal(signal?.aborted,false);assert.equal(await ready(),true);return 'shared';}});
 f.state.credentials=true;await enrollLocal(f.runtime);await f.runtime.storage.appendEvents([event]);await f.controller.refresh();
 const before=await localTables(f.runtime);assert.equal(f.controller.read().account!.cloud.canSync,false);assert.ok(f.controller.read().sync!.pending>0);
 assert.equal(await f.controller.exportData(),'ok');assert.equal(calls,1);assert.deepEqual(await localTables(f.runtime),before);assert.equal(f.state.trialCalls,0);assert.equal(f.controller.read().exporting,false);assert.equal(f.controller.read().problem,null);
});

test('cloud export pauses an in-flight sync runner and ignores duplicate taps',async t=>{
 let entered!:()=>void,release!:()=>void,aborted=false,calls=0;const started=new Promise<void>(resolve=>{entered=resolve;}),waiting=new Promise<void>(resolve=>{release=resolve;});
 const f=await fixture(t,{exportCloud:async(_expected,ready)=>{calls++;assert.equal(aborted,true);entered();await waiting;assert.equal(await ready(),true);return 'shared';}});
 f.state.credentials=true;f.state.summary.cloud={canSync:true,canExport:true,source:'trial',expiresAt:8640000000000000};await enrollLocal(f.runtime);
 f.api.pull=async(_after,signal)=>new Promise((_,reject)=>signal!.addEventListener('abort',()=>{aborted=true;reject(new Error('cancelled'));},{once:true}));
 f.controller.setActive(true);await f.controller.refresh();const timer=f.timers.find(task=>!task.cancelled)!;timer.cancelled=true;timer.fn();await tick();
 const download=f.controller.exportData();await started;assert.equal(f.controller.read().exporting,true);assert.equal(f.controller.read().running,false);
 assert.equal(await f.controller.exportData(),'cancelled');assert.equal(calls,1);release();assert.equal(await download,'ok');assert.equal(f.controller.read().exporting,false);
});

for(const change of ['account','generation','dispose','offline'] as const)test(`a cloud export after ${change} cannot share another ownership context`,async t=>{
 let entered!:()=>void,release!:()=>void,shares=0,signal:AbortSignal|undefined;const started=new Promise<void>(resolve=>{entered=resolve;}),waiting=new Promise<void>(resolve=>{release=resolve;});
 const f=await fixture(t,{exportCloud:async(_expected,ready,received)=>{signal=received;entered();await waiting;if(!await ready())return 'cancelled';shares++;return 'shared';}});
 f.state.credentials=true;await enrollLocal(f.runtime);await f.runtime.storage.appendEvents([event]);await f.controller.refresh();
 const pending=f.controller.exportData();await started;
 if(change==='account')f.state.summary={...f.state.summary,user:{...f.state.summary.user,id:'account-2'}};
 if(change==='generation'){const owner=await f.runtime.sync.status('pet-1');await f.runtime.sync.detach({generation:owner.generation!,accountId:owner.accountId!});}
 if(change==='dispose')f.controller.stop();if(change==='offline')f.controller.setOnline(false);
 const before=await localTables(f.runtime);release();assert.equal(await pending,'cancelled');assert.equal(shares,0);assert.deepEqual(await localTables(f.runtime),before);
 if(change==='dispose'||change==='offline')assert.equal(signal?.aborted,true);
 assert.equal(f.state.trialCalls,0);assert.equal(f.state.signOutCalls,0);
});

test('export file failure keeps the account and pending work and resumes eligible sync',async t=>{
 const f=await fixture(t,{exportCloud:async()=>{throw new Error('Private file path must not escape');}});f.state.credentials=true;f.state.summary.cloud={canSync:true,canExport:true,source:'trial',expiresAt:8640000000000000};await enrollLocal(f.runtime);await f.runtime.storage.appendEvents([event]);f.controller.setActive(true);await f.controller.refresh();
 const before=await localTables(f.runtime);assert.equal(await f.controller.exportData(),'error');assert.equal(f.controller.read().problem,'export-failed');assert.equal(f.controller.read().account!.user.id,'account-1');assert.equal(f.controller.read().exporting,false);assert.deepEqual(await localTables(f.runtime),before);assert.equal(f.timers.filter(task=>!task.cancelled).length,1);
});

test('anonymous and offline accounts cannot dispatch a cloud export',async t=>{
 let calls=0;const f=await fixture(t,{exportCloud:async()=>{calls++;return 'shared';}});await f.runtime.storage.appendEvents([event]);await f.controller.refresh();const before=await localTables(f.runtime);
 assert.equal(await f.controller.exportData(),'error');assert.equal(f.controller.read().problem,'auth-required');f.state.credentials=true;await f.controller.refresh();f.controller.setOnline(false);assert.equal(await f.controller.exportData(),'error');assert.equal(f.controller.read().problem,'network');assert.equal(calls,0);assert.deepEqual(await localTables(f.runtime),before);
});

test('leaving the account screen cancels an export still queued behind refresh',async t=>{
 let calls=0,entered!:()=>void,release!:()=>void;const started=new Promise<void>(resolve=>{entered=resolve;}),waiting=new Promise<void>(resolve=>{release=resolve;});
 const f=await fixture(t,{exportCloud:async()=>{calls++;return 'shared';}});f.state.credentials=true;await f.controller.refresh();const before=await localTables(f.runtime),account=f.api.account;
 f.api.account=async()=>{entered();await waiting;return account();};
 const refresh=f.controller.refresh();await started;const download=f.controller.exportData();f.controller.cancelExport();release();await refresh;
 assert.equal(await download,'cancelled');assert.equal(calls,0);assert.equal(f.controller.read().exporting,false);assert.deepEqual(await localTables(f.runtime),before);
});

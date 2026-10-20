import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test,{type TestContext} from 'node:test';
import {createAuthClient} from 'better-auth/react';
import {createLocalDatabase,initializeLocalDatabase,type LocalDatabase} from '../local/database.ts';
import {sqliteTestConnection} from '../local/sqlite-test-adapter.ts';
import {createLocalRuntime} from '../local/runtime-factory.ts';
import {CloudApiError,type CloudApi,type CloudAccountSummary} from './api.ts';
import {createAccountController,type AccountController,type IdentityAdapter} from './account-controller.ts';
import {createAccountLifecycleClient,type AccountLifecycle,type DeletionStatus,type LifecycleIdentity} from './account-lifecycle.ts';

const accountId='account-1',receipt='A'.repeat(43),intentId='759182e2-e754-459e-bf99-bf5f3732b522';
const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));
function hold<T=void>(){let resolve!:(value:T|PromiseLike<T>)=>void;const promise=new Promise<T>(done=>{resolve=done;});return {promise,resolve};}
const originalIdentity=():LifecycleIdentity=>({user:{id:accountId,email:'person@example.com',name:'Person'},session:{id:'session-1',createdAt:Date.now()-1000,expiresAt:Date.now()+3600000}});
async function rows(database:LocalDatabase,names:string[]){return database.read(async sql=>Object.fromEntries(await Promise.all(names.map(async name=>[name,await sql.getAllAsync(`SELECT * FROM ${name} ORDER BY rowid`)]))));}
const localTables=['puppies','events','routines','settings','pet_settings','local_revisions'];
const syncTables=['local_sync_owner','local_sync_pets','local_sync_outbox','local_sync_records','local_sync_acks','local_sync_baseline'];

async function fixture(t:TestContext,{enrolled=true,otherPet=false}:{enrolled?:boolean;otherPet?:boolean}={}){
 const directory=await mkdtemp(join(tmpdir(),'puptime-deletion-controller-')),path=join(directory,'local.db');
 let database=await createLocalDatabase(sqliteTestConnection(path));await initializeLocalDatabase(database,()=> 'pet-1');
 await database.write(sql=>sql.runAsync("INSERT INTO puppies(id,name) VALUES ('pet-2','Clover')"));
 const writes=new Set<()=>void>(),controllers:AccountController[]=[],timers:{fn:()=>void;cancelled:boolean}[]=[];
 const afterCommit=()=>{for(const listener of writes)listener();};
 let runtime=await createLocalRuntime(database,'pet-1',afterCommit),controller:AccountController;
 const summary:CloudAccountSummary={user:originalIdentity().user,cloud:{canSync:true,canExport:true,source:'trial',expiresAt:Date.now()+3600000},pets:[]};
 const state={credentials:true,current:originalIdentity() as LifecycleIdentity|null,summary,accountCalls:0,trialCalls:0,enrollCalls:0,pushCalls:0,pullCalls:0,ordinaryAuthCalls:0,signOutCalls:0,exportCalls:0,prepareCalls:0,removeCalls:0,statusCalls:0,emailChallenges:0,emailVerifications:0,providerCalls:0,cancels:[] as string[],newSession:true,signOutMode:'clear' as 'clear'|'leave',secureReadFails:false,status:{status:'pending'} as DeletionStatus,changed:0,order:[] as string[]};
 function freshSession(){if(state.newSession&&state.current)state.current={...state.current,session:{...state.current.session,id:state.current.session.id+'-fresh',createdAt:Date.now()}};}
 const api:CloudApi={config:async()=>({protocolVersion:1,trialDays:14,providers:{apple:true,google:true,email:true},pricingFinalized:false}),account:async()=>{state.accountCalls++;if(!state.credentials)throw new CloudApiError('auth-required',401);return structuredClone(state.summary);},startTrial:async()=>{state.trialCalls++;return {cloud:state.summary.cloud};},enroll:async request=>{state.enrollCalls++;return {petId:request.confirmedPetId??request.localPetId};},push:async mutations=>{state.pushCalls++;return {accepted:[],rejected:mutations.map(value=>({operationId:value.operationId,error:'retry_later' as const}))};},pull:async after=>{state.pullCalls++;return {changes:[],cursor:after,hasMore:false};},history:async()=>({revisions:[]})};
 const identity:IdentityAdapter={requestEmail:async()=>{state.ordinaryAuthCalls++;return {error:null};},verifyEmail:async()=>{state.ordinaryAuthCalls++;return {error:null};},signInSocial:async()=>{state.ordinaryAuthCalls++;return {error:null};},linkSocial:async()=>{state.ordinaryAuthCalls++;return {error:null};},listAccounts:async()=>({data:['apple','google'].map(providerId=>({userId:accountId,providerId})),error:null}),signOut:async()=>{state.signOutCalls++;state.order.push('sign-out');if(state.signOutMode==='clear'){state.credentials=false;state.current=null;}return {error:null};},hasCredentials:async()=>{if(state.secureReadFails)throw new Error('Synthetic secure storage failure');return state.credentials;}};
 const lifecycle:AccountLifecycle={identity:async()=>structuredClone(state.current),requestEmail:async expected=>{assert.equal(expected,accountId);state.emailChallenges++;},verifyEmail:async(expected,code)=>{assert.equal(expected,accountId);assert.equal(code,'123456');state.emailVerifications++;freshSession();},reauthenticate:async(expected,_provider,started)=>{assert.equal(expected,accountId);state.providerCalls++;started(intentId);freshSession();return intentId;},cancelReauthentication:async(expected,id)=>{assert.equal(expected,accountId);state.cancels.push(id);return {success:true};},prepare:async expected=>{assert.equal(expected,accountId);state.prepareCalls++;state.order.push('prepare');assert.equal(await runtime.deletion.read(),null);return {receipt,expiresAt:Date.now()+3600000};},remove:async(expected,capability)=>{assert.equal(expected,accountId);assert.equal(capability,receipt);state.removeCalls++;state.order.push('delete');const saved=await runtime.deletion.read();assert.equal(saved?.phase,'dispatched');assert.equal(saved.accountId,accountId);state.current=null;return {success:true,appleRevocation:'manual'};},status:async capability=>{assert.equal(capability,receipt);state.statusCalls++;return state.status;}};
 const makeController=()=>{const value=createAccountController({runtime,api,identity,lifecycle,exportCloud:async()=>{state.exportCalls++;return 'shared';},changed:()=>{state.changed++;},subscribeLocalWrites:listener=>{writes.add(listener);return()=>{writes.delete(listener);};},defer:fn=>{const timer={fn,cancelled:false};timers.push(timer);return()=>{timer.cancelled=true;};}});controllers.push(value);return value;};
 const other=await createLocalRuntime(database,'pet-2',afterCommit);
 await runtime.storage.appendEvents([{id:'one',type:'pee',at:100,source:'app',note:'Keep Maple history'}]);
 await other.storage.appendEvents([{id:'two',type:'poop',at:200,source:'app',note:'Keep Clover history'}]);
 if(enrolled){const target=otherPet?other:runtime;const fence={...await target.sync.prepareAssociation({accountId,localPetId:target.petId,deviceId:target.deviceId,enrollment:{operationId:'enroll-1',deviceId:target.deviceId,localPetId:target.petId,name:'Maple'}}),accountId};await target.sync.stageBaseline({...fence,page:{changes:[],cursor:0,hasMore:false}});await target.sync.completeAssociation({...fence,cloudPetId:target.petId});}
 controller=makeController();assert.equal(await controller.refresh(),'ok');
 t.after(async()=>{for(const value of controllers)value.stop();await tick();await tick();await database.close();await rm(directory,{recursive:true,force:true});});
 return {get controller(){return controller;},get runtime(){return runtime;},get database(){return database;},state,api,identity,lifecycle,timers,
  async restart(){controller.stop();await tick();await tick();await database.close();database=await createLocalDatabase(sqliteTestConnection(path));await initializeLocalDatabase(database,()=>assert.fail('Restart must keep the puppies'));runtime=await createLocalRuntime(database,'pet-1',afterCommit);controller=makeController();return controller;},
  async ready(){assert.equal(await controller.beginDeletion(),'ok');assert.equal(await controller.requestDeletionCode(),'ok');assert.equal(await controller.verifyDeletionCode('123456'),'ok');assert.equal(controller.read().deletion?.stage,'ready');},
  async seedPending(phase:'prepared'|'dispatched'|'acknowledged'='dispatched'){const owner=await runtime.deletion.owner();await runtime.deletion.save({accountId,generation:owner?.generation??null,receipt,expiresAt:Date.now()+3600000},null);if(phase!=='prepared')await runtime.deletion.markDispatched(receipt);if(phase==='acknowledged')await runtime.deletion.acknowledge(receipt,'manual');},
 };
}

test('deletion needs a new original-owner session and a separate explicit confirmation before saving any receipt',async t=>{
 const f=await fixture(t);await f.controller.beginDeletion();await f.controller.requestDeletionCode();f.state.newSession=false;
 assert.equal(await f.controller.verifyDeletionCode('123456'),'error');assert.equal(f.controller.read().problem,'reauth-incomplete');
 assert.equal(await f.controller.deleteCloudAccount({confirmed:true}),'error');assert.equal(f.state.prepareCalls,0);
 f.state.newSession=true;assert.equal(await f.controller.verifyDeletionCode('123456'),'ok');
 assert.equal(await f.controller.deleteCloudAccount(),'error');assert.equal(f.controller.read().problem,'confirmation-required');
 assert.equal(f.state.prepareCalls,0);assert.equal(f.state.removeCalls,0);assert.equal(await f.runtime.deletion.read(),null);
});

for(const change of ['user','generation','other-puppy-owner','missing-session'] as const)test(`verified deletion refuses changed ${change} before preparing or deleting`,async t=>{
 const f=await fixture(t,{otherPet:change==='other-puppy-owner'});await f.ready();
 if(change==='user')f.state.current={...originalIdentity(),user:{...originalIdentity().user,id:'account-2'}};
 if(change==='missing-session')f.state.current=null;
 if(change==='other-puppy-owner')await f.database.write(sql=>sql.runAsync("UPDATE local_sync_owner SET account_id='account-2'"));
 if(change==='generation')await f.database.write(async sql=>{await sql.runAsync('DELETE FROM local_sync_owner');await sql.runAsync("INSERT INTO local_sync_owner(singleton,generation,account_id,device_id) VALUES (1,'replacement-generation',?,?)",accountId,f.runtime.deviceId);});
 const before=await rows(f.database,[...localTables,...syncTables]);
 assert.equal(await f.controller.deleteCloudAccount({confirmed:true}),'error');assert.equal(f.state.prepareCalls,0);assert.equal(f.state.removeCalls,0);assert.equal(f.state.signOutCalls,0);
 assert.equal(f.controller.read().problem,change==='missing-session'?'auth-required':'account-mismatch');assert.deepEqual(await rows(f.database,[...localTables,...syncTables]),before);
});

for(const enrolled of [false,true])test(`confirmed ${enrolled?'enrolled':'local-only'} deletion persists dispatch before HTTP and preserves every puppy's local records`,async t=>{
 const f=await fixture(t,{enrolled});await f.ready();const before=await rows(f.database,localTables);
 assert.equal(await f.controller.deleteCloudAccount({confirmed:true}),'ok');assert.deepEqual(f.state.order,['prepare','delete','sign-out']);
 assert.equal(f.state.removeCalls,1);assert.equal(f.state.signOutCalls,1);assert.equal(f.state.credentials,false);assert.equal(await f.runtime.deletion.read(),null);assert.equal(await f.runtime.deletion.owner(),null);
 assert.deepEqual(await rows(f.database,localTables),before);for(const value of Object.values(await rows(f.database,syncTables)))assert.deepEqual(value,[]);
 assert.deepEqual(f.controller.read().deletionNotice,{appleRevocation:'manual'});assert.equal(f.controller.read().deletion,null);assert.equal(f.controller.read().account,null);assert.equal(f.state.trialCalls,0);
 await f.restart();assert.equal(await f.controller.refresh(),'ok');assert.deepEqual(f.controller.read().deletionNotice,{appleRevocation:'manual'});
 assert.equal(await f.controller.dismissDeletionNotice(),'ok');assert.equal(await f.runtime.deletion.readNotice(),null);
});

for(const failure of ['save','dispatch'] as const)test(`a real SQLite ${failure} failure prevents DELETE and retains the original cloud owner and outbox`,async t=>{
 const f=await fixture(t);await f.ready();const before=await rows(f.database,[...localTables,...syncTables]);
 await f.database.write(sql=>sql.execAsync(failure==='save'?"CREATE TRIGGER fail_receipt BEFORE INSERT ON local_account_deletion BEGIN SELECT RAISE(ABORT,'receipt disk failure'); END;":"CREATE TRIGGER fail_dispatch BEFORE UPDATE ON local_account_deletion WHEN NEW.phase='dispatched' BEGIN SELECT RAISE(ABORT,'dispatch disk failure'); END;"));
 assert.equal(await f.controller.deleteCloudAccount({confirmed:true}),'error');assert.equal(f.state.removeCalls,0);assert.equal(f.state.signOutCalls,0);assert.equal(f.controller.read().problem,'local-storage');
 assert.deepEqual(await rows(f.database,[...localTables,...syncTables]),before);assert.equal((await f.runtime.deletion.read())?.phase,failure==='save'?undefined:'prepared');
});

test('a lost DELETE response survives disk reopen; refresh, retry and foreground perform status checks without another DELETE',async t=>{
 const f=await fixture(t);await f.ready();const before=await rows(f.database,[...localTables,...syncTables]);
 f.lifecycle.remove=async()=>{f.state.removeCalls++;assert.equal((await f.runtime.deletion.read())?.phase,'dispatched');throw new CloudApiError('network');};
 assert.equal(await f.controller.deleteCloudAccount({confirmed:true}),'error');assert.equal(f.controller.read().problem,'network');assert.equal((await f.runtime.deletion.read())?.phase,'dispatched');
 assert.deepEqual(await rows(f.database,[...localTables,...syncTables]),before);await f.restart();
 const accounts=f.state.accountCalls;
 for(const status of ['unknown','pending','not-started'] as const){f.state.status={status};assert.equal(await f.controller.refresh(),'ok');assert.equal(f.controller.read().deletion?.status,status);assert.equal(await f.controller.checkDeletion(),'ok');}
 f.controller.setActive(true);await f.controller.refresh();await tick();
 assert.equal(f.state.removeCalls,1);assert.equal(f.state.prepareCalls,1);assert.equal(f.state.signOutCalls,0);assert.equal(f.state.accountCalls,accounts);assert.deepEqual(await rows(f.database,[...localTables,...syncTables]),before);
 assert.equal(f.timers.filter(timer=>!timer.cancelled).length,0);
 f.state.status={status:'deleted',appleRevocation:'revoked'};f.state.current=null;
 assert.equal(await f.controller.checkDeletion(),'ok');assert.equal(f.state.removeCalls,1);assert.equal(await f.runtime.deletion.owner(),null);assert.deepEqual(await rows(f.database,localTables),Object.fromEntries(localTables.map(name=>[name,before[name]])));
});

test('a partial deletion retry reuses its saved receipt only after new verification and another explicit confirmation',async t=>{
 const f=await fixture(t);await f.seedPending();await f.controller.refresh();
 assert.equal(await f.controller.deleteCloudAccount({confirmed:true}),'error');assert.equal(f.state.removeCalls,0);
 await f.ready();assert.equal(await f.controller.deleteCloudAccount(),'error');assert.equal(f.state.removeCalls,0);
 assert.equal(await f.controller.deleteCloudAccount({confirmed:true}),'ok');assert.equal(f.state.prepareCalls,0);assert.equal(f.state.removeCalls,1);
});

test('cold restart of pending deletion restores the original account recovery methods without ordinary account enrollment',async t=>{
 const f=await fixture(t);await f.seedPending();await f.restart();const accounts=f.state.accountCalls;
 f.api.account=async()=>{f.state.accountCalls++;throw new CloudApiError('account-deleted',410);};
 assert.equal(await f.controller.refresh(),'ok');assert.equal(f.controller.read().deletion?.stage,'pending');
 assert.equal(await f.controller.beginDeletion(),'ok');
 assert.deepEqual(f.controller.read().config?.providers,{apple:true,google:true,email:true});assert.deepEqual(f.controller.read().linkedProviders,['apple','google']);
 assert.equal(await f.controller.reauthenticateDeletion('apple'),'ok');assert.equal(f.controller.read().deletion?.stage,'ready');
 await f.controller.cancelDeletion();await f.controller.beginDeletion();assert.equal(await f.controller.requestDeletionCode(),'ok');assert.equal(await f.controller.verifyDeletionCode('123456'),'ok');
 assert.equal(f.state.emailChallenges,1);assert.equal(f.state.emailVerifications,1);
 assert.equal(f.state.providerCalls,1);assert.equal(f.state.accountCalls,accounts);assert.equal(f.state.ordinaryAuthCalls,0);assert.equal(f.state.prepareCalls,0);assert.equal(f.state.removeCalls,0);assert.equal(f.state.enrollCalls,0);
});

test('secure storage cleanup failure keeps acknowledged proof and all local state until a cold restart can finish it',async t=>{
 const f=await fixture(t);await f.ready();const before=await rows(f.database,[...localTables,...syncTables]);f.state.signOutMode='leave';
 assert.equal(await f.controller.deleteCloudAccount({confirmed:true}),'error');assert.equal(f.controller.read().problem,'sign-out-failed');assert.equal((await f.runtime.deletion.read())?.phase,'acknowledged');assert.equal(f.controller.read().deletion?.stage,'cleanup');
 assert.deepEqual(await rows(f.database,[...localTables,...syncTables]),before);f.state.signOutMode='clear';await f.restart();
 assert.equal(await f.controller.refresh(),'ok');assert.equal(f.state.removeCalls,1);assert.equal(f.state.statusCalls,0);assert.equal(f.state.prepareCalls,1);assert.equal(f.state.signOutCalls,2);assert.equal(await f.runtime.deletion.read(),null);assert.equal(await f.runtime.deletion.owner(),null);
 assert.deepEqual(await rows(f.database,localTables),Object.fromEntries(localTables.map(name=>[name,before[name]])));
});

test('a throwing secure credential read retains acknowledged recovery and never detaches or repeats deletion',async t=>{
 const f=await fixture(t);await f.ready();const before=await rows(f.database,[...localTables,...syncTables]);f.state.secureReadFails=true;
 assert.equal(await f.controller.deleteCloudAccount({confirmed:true}),'error');assert.equal((await f.runtime.deletion.read())?.phase,'acknowledged');assert.equal(f.state.signOutCalls,0);assert.deepEqual(await rows(f.database,[...localTables,...syncTables]),before);
 f.state.secureReadFails=false;assert.equal(await f.controller.checkDeletion(),'ok');assert.equal(f.state.removeCalls,1);assert.equal(f.state.statusCalls,0);assert.equal(await f.runtime.deletion.owner(),null);
});

test('failed atomic local completion rolls back detach and survives restart after cloud deletion and secure sign-out succeeded',async t=>{
 const f=await fixture(t);await f.ready();const before=await rows(f.database,[...localTables,...syncTables]);
 await f.database.write(sql=>sql.execAsync("CREATE TRIGGER fail_completion BEFORE DELETE ON local_account_deletion BEGIN SELECT RAISE(ABORT,'completion disk failure'); END;"));
 assert.equal(await f.controller.deleteCloudAccount({confirmed:true}),'error');assert.equal((await f.runtime.deletion.read())?.phase,'acknowledged');assert.equal(f.state.credentials,false);assert.equal(f.state.removeCalls,1);assert.deepEqual(await rows(f.database,[...localTables,...syncTables]),before);
 await f.database.write(sql=>sql.execAsync('DROP TRIGGER fail_completion'));await f.restart();assert.equal(await f.controller.refresh(),'ok');assert.equal(f.state.removeCalls,1);assert.equal(f.state.signOutCalls,1);assert.equal(f.state.statusCalls,0);assert.equal(await f.runtime.deletion.read(),null);assert.equal(await f.runtime.deletion.owner(),null);
});

test('a session switch during credential inspection cannot sign out the replacement user while completing an old deletion',async t=>{
 const f=await fixture(t);await f.seedPending('acknowledged');const entered=hold(),credentials=hold<boolean>();
 f.identity.hasCredentials=async()=>{entered.resolve();return credentials.promise;};
 const pending=f.controller.refresh();await entered.promise;
 f.state.current={...originalIdentity(),user:{...originalIdentity().user,id:'account-2'}};
 credentials.resolve(true);
 assert.equal(await pending,'error');assert.equal(f.state.signOutCalls,0,'The replacement user must never reach SDK sign-out.');assert.equal(f.controller.read().problem,'account-mismatch');assert.equal(f.state.credentials,true);assert.equal((await f.runtime.deletion.read())?.phase,'acknowledged');assert.ok(await f.runtime.deletion.owner());
});

test('an acknowledged deletion never signs out another current SDK user or detaches a replacement generation',async t=>{
 for(const change of ['session','generation'] as const){
  const f=await fixture(t);await f.seedPending('acknowledged');
  if(change==='session')f.state.current={...originalIdentity(),user:{...originalIdentity().user,id:'account-2'}};
  else await f.database.write(async sql=>{await sql.runAsync('DELETE FROM local_sync_owner');await sql.runAsync("INSERT INTO local_sync_owner(singleton,generation,account_id,device_id) VALUES (1,'new-generation',?,?)",accountId,f.runtime.deviceId);});
  const before=await rows(f.database,[...localTables,...syncTables,'local_account_deletion']);
  assert.equal(await f.controller.refresh(),'error');assert.equal(f.controller.read().problem,'account-mismatch');assert.equal(f.state.signOutCalls,0);assert.equal(f.state.removeCalls,0);assert.equal(f.state.credentials,true);
  assert.deepEqual(await rows(f.database,[...localTables,...syncTables,'local_account_deletion']),before);
 }
});

test('pending deletion blocks ordinary auth, provider linking, enrollment, sign-out, export and sync while local logging remains available',async t=>{
 const f=await fixture(t);await f.seedPending();await f.controller.refresh();f.controller.setActive(true);await f.controller.refresh();
 const calls=f.state.accountCalls;
 for(const action of [()=>f.controller.requestEmail('person@example.com'),()=>f.controller.verifyEmail('person@example.com','123456'),()=>f.controller.signInSocial('google'),()=>f.controller.connectProvider('apple'),()=>f.controller.enableCloud({}),()=>f.controller.signOut({confirmPending:true}),()=>f.controller.exportData(),()=>f.controller.continueLocally({confirmPending:true})]){
  assert.equal(await action(),'error');assert.equal(f.controller.read().problem,'deletion-pending');
 }
 await f.runtime.storage.appendEvents([{id:'offline-during-deletion',type:'pee',at:300,source:'app'}]);f.controller.invalidate();await tick();
 assert.equal((await f.runtime.storage.loadEvents()).length,2);assert.equal(f.state.ordinaryAuthCalls,0);assert.equal(f.state.trialCalls,0);assert.equal(f.state.enrollCalls,0);assert.equal(f.state.signOutCalls,0);assert.equal(f.state.exportCalls,0);assert.equal(f.state.pushCalls,0);assert.equal(f.state.pullCalls,0);assert.equal(f.state.accountCalls,calls);assert.equal(f.timers.filter(timer=>!timer.cancelled).length,0);
 assert.equal(await f.runtime.deletion.read()!==null,true);assert.ok((await f.runtime.sync.status('pet-1')).pending>0);
});

test('starting deletion aborts and drains an actual in-flight sync request before reading its reauthentication identity',async t=>{
 const f=await fixture(t),entered=hold();let requestSignal:AbortSignal|undefined;
 f.api.pull=async(_after,signal)=>{requestSignal=signal;assert.ok(signal);entered.resolve();return new Promise((_resolve,reject)=>{signal.addEventListener('abort',()=>reject(Object.assign(new Error('Aborted'),{name:'AbortError'})),{once:true});});};
 f.controller.setActive(true);await f.controller.refresh();const timer=f.timers.find(value=>!value.cancelled);assert.ok(timer);timer.cancelled=true;timer.fn();await entered.promise;
 const before=await rows(f.database,[...localTables,...syncTables]);
 f.lifecycle.identity=async()=>{assert.equal(requestSignal?.aborted,true);return f.state.current;};
 assert.equal(await f.controller.beginDeletion(),'ok');assert.equal(requestSignal?.aborted,true);assert.equal(f.controller.read().running,false);assert.equal(f.state.pushCalls,0);assert.equal(f.timers.filter(value=>!value.cancelled).length,0);assert.deepEqual(await rows(f.database,[...localTables,...syncTables]),before);
});

test('provider initiation without a new same-owner session stays unverified and cannot authorize deletion',async t=>{
 const f=await fixture(t);await f.controller.beginDeletion();f.state.newSession=false;
 assert.equal(await f.controller.reauthenticateDeletion('google'),'error');assert.equal(f.controller.read().problem,'reauth-incomplete');assert.notEqual(f.controller.read().deletion?.stage,'ready');
 assert.equal(await f.controller.deleteCloudAccount({confirmed:true}),'error');assert.equal(f.state.prepareCalls,0);assert.equal(f.state.removeCalls,0);
});

for(const announceFirst of [false,true])test(`cancelled provider return ${announceFirst?'with an already announced':'before receiving its'} intent cannot restore verification or dispatch deletion`,async t=>{
 const f=await fixture(t);await f.controller.beginDeletion();const entered=hold(),returning=hold();
 f.lifecycle.reauthenticate=async(_owner,_provider,started)=>{if(announceFirst)started(intentId);entered.resolve();await returning.promise;if(!announceFirst)started(intentId);f.state.current={...originalIdentity(),session:{...originalIdentity().session,id:'session-fresh'}};return intentId;};
 const request=f.controller.reauthenticateDeletion('apple');await entered.promise;await f.controller.cancelDeletion();assert.equal(f.controller.read().deletion,null);returning.resolve();
 assert.equal(await request,'cancelled');await tick();assert.equal(f.controller.read().deletion,null);assert.deepEqual(f.state.cancels,[intentId]);assert.equal(f.state.prepareCalls,0);assert.equal(f.state.removeCalls,0);assert.equal(await f.runtime.deletion.read(),null);
});

test('cancel before a real SDK initiation reply prevents dismiss-then-open of a late provider browser',async t=>{
 const f=await fixture(t),entered=hold(),reply=hold(),order:string[]=[];
 const auth=createAuthClient({baseURL:'https://puptime.test',fetchOptions:{customFetchImpl:async(input)=>{
  const path=new URL(String(input)).pathname;
  if(path==='/api/account/reauth/cancel'){order.push('cancel-request');return new Response('{"success":true}',{headers:{'content-type':'application/json'}});}
  assert.equal(path,'/api/auth/sign-in/social');order.push('social-request');entered.resolve();await reply.promise;
  return new Response(JSON.stringify({reauthIntentId:intentId,url:'https://accounts.example/guarded',redirect:true}),{headers:{'content-type':'application/json'}});
 }},plugins:[{id:'late-browser-proof',fetchPlugins:[{id:'late-browser-proof',name:'Late browser proof',hooks:{onSuccess(context:{request:{url:URL|string}}){if(String(context.request.url).endsWith('/sign-in/social'))order.push('browser-open');}}}]}]});
 const lifecycle=createAccountLifecycleClient({fetch:(path,options)=>auth.$fetch<unknown>(path,options),social:(body,options)=>auth.signIn.social(body,options),dismissBrowser:()=>{order.push('dismiss');}},'https://puptime.test');
 f.lifecycle.reauthenticate=lifecycle.reauthenticate;f.lifecycle.cancelReauthentication=lifecycle.cancelReauthentication;
 await f.controller.beginDeletion();const pending=f.controller.reauthenticateDeletion('google');await entered.promise;await f.controller.cancelDeletion();reply.resolve();
 assert.equal(await pending,'cancelled');await tick();assert.deepEqual(order,['social-request','dismiss','cancel-request']);assert.equal(f.controller.read().deletion,null);assert.equal(f.state.removeCalls,0);assert.equal(f.state.prepareCalls,0);
});

test('cancelling while the initial identity check is pending prevents a late result from reopening account deletion',async t=>{
 const f=await fixture(t),entered=hold(),reply=hold<LifecycleIdentity|null>();f.lifecycle.identity=async()=>{entered.resolve();return reply.promise;};
 const pending=f.controller.beginDeletion();await entered.promise;await f.controller.cancelDeletion();reply.resolve(originalIdentity());
 assert.equal(await pending,'cancelled');assert.equal(f.controller.read().deletion,null);assert.equal(f.state.prepareCalls,0);assert.equal(f.state.removeCalls,0);
});

test('duplicate verification and deletion taps do not consume a code twice or repeat DELETE, and closing during DELETE does not cancel committed cleanup',async t=>{
 const f=await fixture(t);await f.controller.beginDeletion();await f.controller.requestDeletionCode();
 assert.deepEqual(await Promise.all([f.controller.verifyDeletionCode('123456'),f.controller.verifyDeletionCode('123456')]),['ok','cancelled']);assert.equal(f.state.emailVerifications,1);
 const entered=hold(),reply=hold(),original=f.lifecycle.remove;
 f.lifecycle.remove=async(owner,capability)=>{entered.resolve();await reply.promise;return original(owner,capability);};
 const first=f.controller.deleteCloudAccount({confirmed:true});await entered.promise;assert.equal(await f.controller.deleteCloudAccount({confirmed:true}),'cancelled');
 await f.controller.cancelDeletion();assert.equal((await f.runtime.deletion.read())?.phase,'dispatched');assert.equal(f.controller.read().deletion?.canCancel,false);reply.resolve();
 assert.equal(await first,'ok');assert.equal(f.state.removeCalls,1);assert.equal(f.state.prepareCalls,1);assert.equal(await f.runtime.deletion.read(),null);assert.equal(await f.runtime.deletion.owner(),null);
});

test('disposing the screen after DELETE dispatch still completes authorized durable cleanup without replaying the request',async t=>{
 const f=await fixture(t);await f.ready();const before=await rows(f.database,localTables),entered=hold(),reply=hold(),original=f.lifecycle.remove;
 f.lifecycle.remove=async(owner,capability)=>{entered.resolve();await reply.promise;return original(owner,capability);};
 const pending=f.controller.deleteCloudAccount({confirmed:true});await entered.promise;f.controller.stop();reply.resolve();
 assert.equal(await pending,'ok');assert.equal(f.state.removeCalls,1);assert.equal(f.state.signOutCalls,1);assert.equal(await f.runtime.deletion.read(),null);assert.equal(await f.runtime.deletion.owner(),null);assert.deepEqual(await rows(f.database,localTables),before);
});

test('a prepared receipt can be cancelled but status cannot promote it to deletion without a dispatched request',async t=>{
 const f=await fixture(t);await f.seedPending('prepared');f.state.status={status:'deleted',appleRevocation:'manual'};
 assert.equal(await f.controller.refresh(),'error');assert.equal(f.controller.read().problem,'invalid-response');assert.equal((await f.runtime.deletion.read())?.phase,'prepared');assert.equal(f.state.signOutCalls,0);
 await f.controller.cancelDeletion();assert.equal(await f.runtime.deletion.read(),null);assert.equal(f.state.removeCalls,0);assert.ok(await f.runtime.deletion.owner());
});

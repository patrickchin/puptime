import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test,{type TestContext} from 'node:test';
import { createLocalDatabase, initializeLocalDatabase } from '../local/database.ts';
import { sqliteTestConnection } from '../local/sqlite-test-adapter.ts';
import { createNativeStorage } from '../local/native-storage.ts';
import { createLocalSync } from '../local/sync-engine.ts';
import { reconcileMutation } from './reconcile.ts';
import { cloudRecordId } from './record-identity.ts';
import { createCloudApi,CloudApiError,type CloudApi,type CloudAccountSummary } from './api.ts';
import type { CloudRecord,Mutation,MutationResult } from './protocol.ts';
import { cloudRecordSchema } from './protocol.ts';
import * as runner from './runner.ts';
const event={id:'event-1',type:'pee' as const,at:100,source:'app' as const};
const enrollment={operationId:'enroll-1',deviceId:'device-1',localPetId:'local-pet',name:'My puppy'};
const account:CloudAccountSummary={user:{id:'account-1',email:'person@example.com',name:'Person'},cloud:{canSync:true,canExport:true},pets:[]};
async function fixture(t:TestContext,{pristine=false}={}) {
 const directory=await mkdtemp(join(tmpdir(),'puptime-runner-')),path=join(directory,'data.db');
 const database=await createLocalDatabase(sqliteTestConnection(path));t.after(async()=>{await database.close();await rm(directory,{force:true,recursive:true});});
 await initializeLocalDatabase(database,()=> 'local-pet');if(!pristine)await database.write(sql=>sql.runAsync('DELETE FROM routines'));
 const sync=createLocalSync(database),storage=createNativeStorage(database,'local-pet',sync.changeSink('local-pet'));
 return {database,path,sync,storage};
}
async function prepare(sync:ReturnType<typeof createLocalSync>) {return {...await sync.prepareAssociation({accountId:'account-1',localPetId:'local-pet',deviceId:'device-1',enrollment}),accountId:'account-1'};}
async function active(sync:ReturnType<typeof createLocalSync>) {const owner=await prepare(sync);await sync.stageBaseline({...owner,page:{changes:[],cursor:0,hasMore:false}});await sync.completeAssociation({...owner,cloudPetId:'local-pet'});return owner;}
function server() {
 const changes:CloudRecord[]=[],records=new Map<string,CloudRecord>(),operations=new Map<string,MutationResult>(),enrollments=new Set<string>(),calls:string[]=[];
 function commit(mutation:Mutation) {
  if (operations.has(mutation.operationId)) return operations.get(mutation.operationId)!;
  const old=records.get(mutation.recordId)??null,result=reconcileMutation(old,mutation,1000);
  const record={...result.record,revision:(old?.revision??0)+1,sequence:changes.length+1};
  records.set(record.id,record);changes.push(record);
  const accepted={operationId:mutation.operationId,record,sequence:record.sequence,reason:result.reason};operations.set(mutation.operationId,accepted);return accepted;
 }
 const api=createCloudApi(async(path,options)=>{
  calls.push(path);
  if(path==='/api/account')return {data:account,error:null};
  if(path==='/api/cloud/enroll'){const request=options.body as typeof enrollment;enrollments.add(request.operationId);return {data:{petId:request.localPetId},error:null};}
  if(path==='/api/sync/push') {
   const accepted:MutationResult[]=[],rejected:Array<{operationId:string;error:'conflict'}>=[];
   for(const mutation of (options.body as {mutations:Mutation[]}).mutations)try{accepted.push(commit(mutation));}catch{rejected.push({operationId:mutation.operationId,error:'conflict'});}
   return {data:{accepted,rejected},error:null};
  }
  if(path.startsWith('/api/sync/pull?after=')){const after=Number(path.split('=')[1]);if(after>changes.length)return {data:{changes:[],cursor:0,hasMore:false,resyncRequired:true},error:null};const page=changes.filter(record=>record.sequence>after).slice(0,100);return {data:{changes:page,cursor:page.at(-1)?.sequence??after,hasMore:changes.length>(page.at(-1)?.sequence??after)},error:null};}
  throw new Error('Unexpected endpoint');
 });
 return {api,calls,changes,records,commit,enrollments};
}
function make(sync:ReturnType<typeof createLocalSync>,api:Pick<CloudApi,'account'|'enroll'|'push'|'pull'>,sessionAccountId:()=>string|null=()=> 'account-1') {
 assert.equal(typeof runner.createSyncRunner,'function');
 return runner.createSyncRunner({sync,api,petId:'local-pet',deviceId:'device-1',sessionAccountId,changed:()=>{},random:()=>1});
}
const signal=()=>new AbortController().signal;

test('first-launch restore survives a lost enrollment reply and never pushes starter defaults',async t=>{
 const {sync,storage,path}=await fixture(t,{pristine:true});
 const request={...enrollment,name:'Basil',confirmedPetId:'cloud-pet'};
 await sync.prepareAssociation({accountId:'account-1',deviceId:'device-1',localPetId:'local-pet',enrollment:request,mode:'restore'});
 const records=[cloudRecordSchema.parse({id:'cloud-pet',petId:'cloud-pet',kind:'puppy',data:{name:'Basil'},revision:1,sequence:1,deleted:false,updatedAt:1})];
 const requests:unknown[]=[],operations=new Set<string>();let loseReply=true;
 const api:Pick<CloudApi,'account'|'enroll'|'push'|'pull'>={
  account:async()=>({...account,pets:[{id:'cloud-pet',name:'Basil',eventCount:0}]}),
  enroll:async input=>{requests.push(structuredClone(input));operations.add(input.operationId);if(loseReply){loseReply=false;throw new CloudApiError('network');}return {petId:'cloud-pet'};},
  pull:async after=>({changes:records.filter(record=>record.sequence>after),cursor:1,hasMore:false}),
  push:async()=>{throw new Error('A pristine restore must not send local defaults.');},
 };
 const first=runner.createSyncRunner({sync,api,petId:'local-pet',deviceId:'device-1',sessionAccountId:()=> 'account-1',changed:()=>{}});
 assert.equal((await first.run(signal())).state,'retry');
 const reopened=await createLocalDatabase(sqliteTestConnection(path));t.after(()=>reopened.close());
 const resumed=createLocalSync(reopened),second=runner.createSyncRunner({sync:resumed,api,petId:'local-pet',deviceId:'device-1',sessionAccountId:()=> 'account-1',changed:()=>{}});
 assert.equal((await second.run(signal())).state,'synced');
 assert.deepEqual(requests,[request,request]);assert.equal(operations.size,1);
 assert.equal(await storage.loadPuppyName(),'Basil');assert.deepEqual(await storage.loadSchedule(),[]);
 assert.deepEqual(await storage.loadEvents(),[]);assert.equal((await resumed.status('local-pet')).pending,0);
});

test('first-launch restore asks for confirmation when local work arrives during its baseline',async t=>{
 const {sync,storage}=await fixture(t,{pristine:true});
 await sync.prepareAssociation({accountId:'account-1',deviceId:'device-1',localPetId:'local-pet',enrollment:{...enrollment,name:'Basil',confirmedPetId:'cloud-pet'},mode:'restore'});
 const api:Pick<CloudApi,'account'|'enroll'|'push'|'pull'>={account:async()=>account,enroll:async()=>({petId:'cloud-pet'}),pull:async()=>{await storage.appendEvents([event]);return {changes:[],cursor:0,hasMore:false};},push:async()=>{throw new Error('No push is authorized after a restore guard fails.');}};
 const result=await runner.createSyncRunner({sync,api,petId:'local-pet',deviceId:'device-1',sessionAccountId:()=> 'account-1',changed:()=>{}}).run(signal());
 assert.equal(result.problem,'confirmation-required');assert.equal(result.retryAfterMs,null);
 assert.equal((await sync.status('local-pet')).state,'preparing');assert.deepEqual(await storage.loadEvents(),[event]);
});

test('first-launch denied access leaves a prepared restore untouched and never reports it restored',async t=>{
 const {sync,storage}=await fixture(t,{pristine:true});
 await storage.saveFirstLaunchProfile('Local draft');
 await sync.prepareAssociation({accountId:'account-1',deviceId:'device-1',localPetId:'local-pet',enrollment:{...enrollment,name:'Basil',confirmedPetId:'cloud-pet'},mode:'restore'});
 const before=await sync.enrollmentState(),calls:string[]=[];
 const api:Pick<CloudApi,'account'|'enroll'|'push'|'pull'>={account:async()=>({...account,cloud:{canSync:false,canExport:true}}),enroll:async()=>{calls.push('enroll');throw new Error('Forbidden.');},pull:async()=>{calls.push('pull');throw new Error('Forbidden.');},push:async()=>{calls.push('push');throw new Error('Forbidden.');}};
 const result=await make(sync,api).run(signal());
 assert.equal(result.state,'error');assert.equal(result.problem,'forbidden');assert.equal(result.retryAfterMs,null);assert.deepEqual(calls,[]);
 assert.deepEqual(await sync.enrollmentState(),before);assert.equal(await storage.loadPuppyName(),'Local draft');
 assert.equal((await storage.loadSchedule()).length,12);assert.equal((await sync.status('local-pet')).state,'preparing');
});

test('free and signed-in unenrolled profiles never dispatch cloud requests',async t=>{
 const {sync}=await fixture(t),remote=server();
 assert.equal((await make(sync,remote.api,()=>null).run(signal())).state,'idle');
 assert.equal((await make(sync,remote.api).run(signal())).state,'idle');assert.deepEqual(remote.calls,[]);
 await active(sync);assert.equal((await make(sync,remote.api,()=>null).run(signal())).state,'auth-required');assert.deepEqual(remote.calls,[]);
});

test('saved enrollment and lost enrollment responses resume exact intent after a second SQLite connection opens',async t=>{
 const {sync,storage,path}=await fixture(t),remote=server();await storage.appendEvents([event]);await prepare(sync);let first=true;
 const api={...remote.api,enroll:async(...args:Parameters<CloudApi['enroll']>)=>{const result=await remote.api.enroll(...args);if(first){first=false;throw new CloudApiError('network');}return result;}};
 assert.equal((await make(sync,api).run(signal())).state,'retry');assert.equal((await sync.status('local-pet')).state,'preparing');
 const reopened=await createLocalDatabase(sqliteTestConnection(path));t.after(()=>reopened.close());const resumed=createLocalSync(reopened);
 assert.equal((await make(resumed,api).run(signal())).state,'synced');assert.equal(remote.enrollments.size,1);assert.equal((await resumed.status('local-pet')).pending,0);
 assert.equal([...remote.records.values()].filter(record=>record.kind==='event').length,1);
 assert.ok(!remote.calls.includes('/api/cloud/trial'));
});

test('lost push response retries exact IDs after restart and retains edits made during the request',async t=>{
 const {sync,storage,path}=await fixture(t),remote=server();await active(sync);await storage.appendEvents([event]);let first=true;
 const batches:Mutation[][]=[];
 const api={...remote.api,push:async(...args:Parameters<CloudApi['push']>)=>{batches.push(structuredClone(args[0]));const result=await remote.api.push(...args);if(first){first=false;await storage.updateEvent(event.id,{note:'later local edit'});throw new CloudApiError('network');}return result;}};
 assert.equal((await make(sync,api).run(signal())).state,'retry');
 const reopened=await createLocalDatabase(sqliteTestConnection(path));t.after(()=>reopened.close());
 assert.equal((await make(createLocalSync(reopened),api).run(signal())).state,'synced');
 assert.deepEqual(batches[1].slice(0,batches[0].length),batches[0]);assert.equal(remote.changes.length,4);
 assert.equal((remote.records.get(cloudRecordId('event','local-pet',event.id))!.data as Record<string,unknown>).note,'later local edit');
});

test('confirmed rejection waits for the current record beyond the first pull page before recovery',async t=>{
 const {sync,storage}=await fixture(t),remote=server();await active(sync);await storage.appendEvents([{...event,note:'local'}]);let raced=false;
 const api={...remote.api,push:async(...args:Parameters<CloudApi['push']>)=>{
  if(!raced){raced=true;for(let i=0;i<105;i++)remote.commit({protocolVersion:1,operationId:`remote-${i}`,deviceId:'other',recordId:cloudRecordId('event','local-pet',`other-${i}`),petId:'local-pet',kind:'event',baseRevision:0,intent:'create',patch:{type:'pee',at:i,source:'app'}});
   const local=args[0].find(mutation=>mutation.kind==='event')!;remote.commit({...local,operationId:'remote-race',deviceId:'other',patch:{...local.patch,note:'remote'}});
  }return remote.api.push(...args);
 }};
 assert.equal((await make(sync,api).run(signal())).state,'synced');assert.equal((await sync.status('local-pet')).blocked,0);
 assert.equal((remote.records.get(cloudRecordId('event','local-pet',event.id))!.data as Record<string,unknown>).note,'local');
 assert.equal((await storage.loadEvents()).length,106);
});

test('interrupted full baseline resumes without replacing local history or acknowledging pending writes early',async t=>{
 const {sync,storage,database}=await fixture(t),remote=server();const owner=await active(sync);await storage.appendEvents([event]);
 await database.write(sql=>sql.runAsync('UPDATE local_sync_owner SET cursor=999 WHERE generation=?',owner.generation));
 let failed=false;const api={...remote.api,pull:async(...args:Parameters<CloudApi['pull']>)=>{if(args[0]===0&&!failed){failed=true;throw new CloudApiError('network');}return remote.api.pull(...args);}};
 assert.equal((await make(sync,api).run(signal())).state,'retry');assert.equal((await sync.status('local-pet')).cursor,999);assert.deepEqual(await storage.loadEvents(),[event]);assert.ok(await sync.resyncState());
 assert.equal((await make(sync,api).run(signal())).state,'synced');assert.equal(await sync.resyncState(),null);assert.equal((await sync.status('local-pet')).pending,0);
});

test('authentication and access errors pause uploads while transient errors back off without blocking local edits',async t=>{
 for(const [category,status,state] of [['auth-required',401,'auth-required'],['forbidden',403,'error'],['account-deleted',410,'error'],['rate-limited',429,'retry'],['server-error',503,'retry'],['invalid-response',0,'error']] as const){
  const {sync,storage}=await fixture(t);await active(sync);const remote=server();
  const api={...remote.api,account:async()=>{throw new CloudApiError(category,status,status===429?60000:null);}};
  const run=make(sync,api),result=await run.run(signal());assert.equal(result.state,state);if(status===429)assert.equal(result.retryAfterMs,60000);
  await storage.appendEvents([event]);assert.equal((await storage.loadEvents()).length,1);assert.equal((await sync.status('local-pet')).pending,3);
  if(state==='retry'){const again=await run.run(signal());assert.ok(again.retryAfterMs!>=result.retryAfterMs!);assert.ok(again.retryAfterMs!<=60000);}
 }
});

test('sync retries preserve a parsed Retry-After longer than exponential backoff without changing pending work',async t=>{
 const {sync,storage}=await fixture(t);await active(sync);await storage.appendEvents([event]);
 const before=await sync.status('local-pet'),calls:string[]=[];
 const api=createCloudApi(async path=>{calls.push(path);return {data:null,error:{status:503},retryAfter:'120'};});
 const result=await make(sync,api).run(signal());assert.equal(result.state,'retry');assert.equal(result.retryAfterMs,120000);
 assert.deepEqual(calls,['/api/account']);assert.deepEqual(await sync.status('local-pet'),before);assert.deepEqual(await storage.loadEvents(),[event]);
});

test('account change or cancellation during a request cannot dispatch queued data or apply late responses',async t=>{
 const {sync}=await fixture(t);await active(sync);const remote=server();let identity:string|null='account-1';
 const api={...remote.api,account:async()=>{identity='account-2';return account;}};
 assert.equal((await make(sync,api,()=>identity).run(signal())).state,'auth-required');assert.deepEqual(remote.calls,[]);assert.equal((await sync.status('local-pet')).pending,2);
 const cancelled=new AbortController();const cancelApi={...remote.api,account:async()=>{cancelled.abort();return account;}};
 await assert.rejects(make(sync,cancelApi).run(cancelled.signal),/abort/i);assert.equal((await sync.status('local-pet')).pending,2);
});

test('large backlogs continue in bounded runs and retry_later never spins or reports synced',async t=>{
 const {sync,storage}=await fixture(t),remote=server();await active(sync);await storage.appendEvents(Array.from({length:1000},(_,index)=>({...event,id:`event-${index}`})));
 const run=make(sync,remote.api);const first=await run.run(signal());assert.equal(first.state,'pending');assert.ok(remote.calls.length<=20);
 let result=first;for(let i=0;i<10&&result.state==='pending';i++)result=await run.run(signal());assert.equal(result.state,'synced');assert.equal((await sync.status('local-pet')).pending,0);
 await storage.updateEvent('event-0',{note:'pending retry'});let pushes=0;
 const api={...remote.api,push:async(mutations:Mutation[])=>{pushes++;return {accepted:[],rejected:mutations.map(mutation=>({operationId:mutation.operationId,error:'retry_later' as const}))};}};
 assert.equal((await make(sync,api).run(signal())).state,'retry');assert.equal(pushes,1);assert.equal((await sync.status('local-pet')).pending,1);
});

test('every run rechecks server access and denied work resumes only after access returns',async t=>{
 const {sync,storage}=await fixture(t),remote=server();await active(sync);let canSync=true;
 const api={...remote.api,account:async()=>({...account,cloud:{canSync,canExport:true}})},run=make(sync,api);
 assert.equal((await run.run(signal())).state,'synced');await storage.appendEvents([event]);canSync=false;
 const calls=remote.calls.length,denied=await run.run(signal());assert.equal(denied.state,'error');assert.equal(denied.problem,'forbidden');assert.equal(denied.retryAfterMs,null);
 assert.equal(remote.calls.length,calls);assert.equal((await sync.status('local-pet')).pending,1);assert.deepEqual(await storage.loadEvents(),[event]);
 canSync=true;assert.equal((await run.run(signal())).state,'synced');assert.equal((await sync.status('local-pet')).pending,0);assert.equal([...remote.records.values()].filter(record=>record.kind==='event').length,1);
});
test('the actual installed native AbortController can enroll, sync and fence a cancelled run',async t=>{
 const {AbortController:NativeController}=await import('abort-controller');const {sync,storage}=await fixture(t),remote=server();await storage.appendEvents([event]);await prepare(sync);
 const native=new NativeController(),signal=native.signal as unknown as AbortSignal;
 assert.equal((await make(sync,remote.api).run(signal)).state,'synced');assert.ok(remote.changes.some(record=>record.kind==='event'));
 native.abort();const before=remote.calls.length;await assert.rejects(make(sync,remote.api).run(signal),error=>error instanceof Error&&error.name==='AbortError');assert.equal(remote.calls.length,before);
});

test('photo uploads precede profile references and failed transfers retry without losing logs or operation IDs',async t=>{
 const {sync,storage}=await fixture(t);await active(sync);
 const id='img_cccccccccccccccccccccccccccccccc';await storage.savePuppyPhoto(id);await storage.appendEvents([event]);
 const owner=(await sync.status('local-pet')),fence={generation:owner.generation!,accountId:owner.accountId!},pending=await sync.nextBatch(fence),remote=server();
 let fail=true,uploaded=false;
 const api={...remote.api,push:async(...args:Parameters<CloudApi['push']>)=>{assert.equal(uploaded,true);return remote.api.push(...args);}};
 const photos:runner.PhotoSync={has:()=>true,current:async()=>id,download:async()=>{assert.fail('Local photos do not need downloading.');},upload:async(photoId,petId,accountId)=>{assert.equal(photoId,id);assert.equal(petId,'local-pet');assert.equal(accountId,'account-1');if(fail)throw new CloudApiError('network');uploaded=true;}};
 const running=runner.createSyncRunner({sync,api,photos,petId:'local-pet',deviceId:'device-1',sessionAccountId:()=> 'account-1',changed:()=>{}});
 assert.equal((await running.run(signal())).state,'retry');assert.deepEqual(await sync.nextBatch(fence),pending);assert.deepEqual(await storage.loadEvents(),[event]);
 fail=false;assert.equal((await running.run(signal())).state,'synced');
 assert.equal((remote.records.get('local-pet')!.data as {photoId:string}).photoId,id);
 assert.ok(!JSON.stringify(remote.changes).includes('data:image'));
});

test('remote profile images download before projection and account changes fence the reference upload',async t=>{
 const {sync,storage}=await fixture(t);await active(sync);const remote=server(),id='img_dddddddddddddddddddddddddddddddd';
 remote.commit({protocolVersion:1,operationId:'op_remote_photo',deviceId:'device-1',petId:'local-pet',recordId:'local-pet',kind:'puppy',baseRevision:0,intent:'create',patch:{name:'My puppy',photoId:id}});
 const files=new Set<string>();let owner='account-1';
 const photos:runner.PhotoSync={has:id=>files.has(id),current:async()=> (await storage.loadPuppyProfile()).photoId,download:async(id,accountId)=>{assert.equal(accountId,'account-1');files.add(id);return true;},upload:async()=>{owner='another-account';}};
 const running=runner.createSyncRunner({sync,api:remote.api,photos,petId:'local-pet',deviceId:'device-1',sessionAccountId:()=>owner,changed:()=>{}});
 assert.equal((await running.run(signal())).state,'synced');assert.equal(files.has(id),true);assert.equal((await storage.loadPuppyProfile()).photoId,id);
 await storage.savePuppyPhoto('img_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee');
 const before=remote.changes.length;assert.equal((await running.run(signal())).problem,'account-mismatch');assert.equal(remote.changes.length,before);
});

test('many offline photo replacements make progress within each request budget',async t=>{
 const {sync,storage}=await fixture(t);await active(sync);const remote=server();
 for(let i=0;i<30;i++)await storage.savePuppyPhoto(`img_${i.toString(16).padStart(32,'0')}`);
 let uploads=0;
 const photos:runner.PhotoSync={has:()=>true,current:async()=>undefined,download:async()=>false,upload:async()=>{uploads++;}};
 const running=runner.createSyncRunner({sync,api:remote.api,photos,petId:'local-pet',deviceId:'device-1',sessionAccountId:()=> 'account-1',changed:()=>{}});
 let remaining=(await sync.status('local-pet')).pending;
 for(let i=0;i<10&&remaining;i++){
  const beforeCalls=remote.calls.length,beforeUploads=uploads;
  const result=await running.run(signal());
  assert.ok(['pending','synced'].includes(result.state));
  assert.ok(remote.calls.length-beforeCalls+uploads-beforeUploads<=20);
  assert.ok(result.pending<remaining,'Each run must commit some queued references.');remaining=result.pending;
 }
 assert.equal(remaining,0);assert.equal(uploads,30);
 assert.equal((remote.records.get('local-pet')!.data as {photoId:string}).photoId,'img_0000000000000000000000000000001d');
});

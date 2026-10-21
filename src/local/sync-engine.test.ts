import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { createLocalDatabase, initializeLocalDatabase } from './database.ts';
import { sqliteTestConnection } from './sqlite-test-adapter.ts';
import { createNativeStorage } from './native-storage.ts';
import { cloudRecordId } from '../cloud/record-identity.ts';
import type { CloudRecord } from '../cloud/protocol.ts';
import * as engine from './sync-engine.ts';
import { createEvent } from '../domain.ts';
import { createLocalRepository } from './repository.ts';

async function setup(t:TestContext,{pristine=false}={}) {
  const directory=await mkdtemp(join(tmpdir(),'puptime-sync-'));
  const path=join(directory,'data.db');
  const database=await createLocalDatabase(sqliteTestConnection(path));
  t.after(async()=>{await database.close();await rm(directory,{recursive:true,force:true});});
  await initializeLocalDatabase(database,()=> 'local-pet');if(!pristine)await database.write(sql=>sql.runAsync('DELETE FROM routines'));
  assert.equal(typeof engine.createLocalSync,'function');
  const sync=engine.createLocalSync(database);
  const storage=createNativeStorage(database,'local-pet',sync.changeSink('local-pet'));
  return {database,path,sync,storage};
}
const enrollment={operationId:'enroll-1',deviceId:'device-1',localPetId:'local-pet',name:'My puppy'};
const input={accountId:'account-1',localPetId:'local-pet',deviceId:'device-1',enrollment};
const event={id:'event-1',type:'pee' as const,at:100,source:'app' as const};
async function activate(sync:ReturnType<typeof engine.createLocalSync>) {
 const {generation}=await sync.prepareAssociation(input);
 await sync.stageBaseline({generation,accountId:input.accountId,page:{changes:[],cursor:0,hasMore:false}});
 await sync.completeAssociation({generation,accountId:input.accountId,cloudPetId:'local-pet'});
 return {generation,accountId:input.accountId};
}

test('prefixed generation and mutation IDs survive reopen and an unacknowledged retry byte-for-byte',async t=>{
 const {database,path,sync,storage}=await setup(t),fence=await activate(sync);
 assert.match(fence.generation,/^gen_[a-f0-9]{32}$/);
 const generated=createEvent('pee','app',100);
 await storage.appendEvents([generated]);
 assert.deepEqual(await storage.loadEvents(),[generated]);
 const before=await sync.nextBatch(fence);
 assert.ok(before.length>0);
 for(const mutation of before)assert.match(mutation.operationId,/^op_[a-f0-9]{32}$/);
 assert.equal(before.find(mutation=>mutation.kind==='event')!.recordId,cloudRecordId('event','local-pet',generated.id));
 const reopened=await createLocalDatabase(sqliteTestConnection(path));
 try {
  const resumed=engine.createLocalSync(reopened);
  assert.deepEqual(await createNativeStorage(reopened,'local-pet').loadEvents(),[generated]);
  assert.equal(JSON.stringify(await resumed.nextBatch(fence)),JSON.stringify(before));
  assert.equal(JSON.stringify(await resumed.nextBatch(fence)),JSON.stringify(before));
  assert.deepEqual((await database.read(sql=>sql.getAllAsync<{operation_id:string}>('SELECT operation_id FROM local_sync_outbox ORDER BY sequence'))).map(row=>row.operation_id),before.map(row=>row.operationId));
 }finally{await reopened.close();}
});

test('first-launch restore resumes the exact cloud puppy without uploading local starter defaults',async t=>{
 const {database,path,sync,storage}=await setup(t,{pristine:true});
 await storage.saveFirstLaunchProfile('Local draft');
 const records:CloudRecord[]=[
  {id:'cloud-pet',petId:'cloud-pet',kind:'puppy',data:{name:'Basil'},revision:1,sequence:1,deleted:false,updatedAt:1},
  {id:cloudRecordId('routine','cloud-pet','starter-1'),petId:'cloud-pet',kind:'routine',data:{type:'pee',minutes:500,reminder:true},revision:1,sequence:2,deleted:false,updatedAt:1},
  {id:cloudRecordId('routine','cloud-pet','cloud-walk'),petId:'cloud-pet',kind:'routine',data:{type:'walk',minutes:700},revision:1,sequence:3,deleted:false,updatedAt:1},
  {id:cloudRecordId('accountPreferences',null,'preferences'),petId:null,kind:'accountPreferences',data:{language:'es',theme:'soft-play'},revision:1,sequence:4,deleted:false,updatedAt:1},
  {id:cloudRecordId('event','cloud-pet','cloud-log'),petId:'cloud-pet',kind:'event',data:{type:'meal',at:1000,source:'app',note:'Cloud only'},revision:1,sequence:5,deleted:false,updatedAt:1},
 ];
 const request={...input,mode:'restore' as const,enrollment:{...enrollment,name:'Basil',confirmedPetId:'cloud-pet'}};
 const {generation}=await sync.prepareAssociation(request),fence={generation,accountId:'account-1'};
 await sync.stageBaseline({...fence,page:{changes:records.slice(0,2),cursor:2,hasMore:true}});
 const other=await createLocalDatabase(sqliteTestConnection(path));t.after(()=>other.close());
 const resumed=engine.createLocalSync(other),saved=(await resumed.enrollmentState())!;
 assert.deepEqual(await resumed.prepareAssociation(request),{generation});
 await resumed.stageBaseline({...fence,page:{changes:records.slice(2),cursor:5,hasMore:false}});
 await resumed.completeAssociation({...fence,cloudPetId:'cloud-pet'});
 assert.equal(await storage.loadPuppyName(),'Basil');
 assert.deepEqual(await storage.loadSchedule(),[{id:'starter-1',type:'pee',minutes:500,reminder:true},{id:'cloud-walk',type:'walk',minutes:700}]);
 assert.deepEqual(await storage.loadEvents(),[{id:'cloud-log',type:'meal',at:1000,source:'app',note:'Cloud only'}]);
 assert.equal(await storage.loadLanguagePreference(),'es');assert.equal(await storage.loadThemePreference(),'soft-play');
 assert.deepEqual(await resumed.nextBatch(fence),[]);
 assert.equal(saved.mode,'restore');assert.ok(!('mode' in saved.request));
 assert.deepEqual(saved.request,request.enrollment);
 assert.equal((await resumed.status('local-pet')).cursor,5);
 assert.deepEqual((await database.read(sql=>sql.getAllAsync<{id:string}>('SELECT id FROM puppies'))).map(row=>row.id),['local-pet']);
 assert.equal((await database.read(sql=>sql.getFirstAsync<{cloud_pet_id:string}>('SELECT cloud_pet_id FROM local_sync_pets')))!.cloud_pet_id,'cloud-pet');
 assert.equal(await database.read(sql=>sql.getFirstAsync("SELECT value FROM metadata WHERE key='pending_restore_operation'")),null);
});

test('first-launch restore rejects existing local work and rechecks before projecting a staged baseline',async t=>{
 const {database,sync,storage}=await setup(t,{pristine:true});
 const request={...input,mode:'restore' as const,enrollment:{...enrollment,name:'Basil',confirmedPetId:'cloud-pet'}};
 await storage.appendEvents([event]);
 await assert.rejects(sync.prepareAssociation(request),/restore|pristine|confirmation/i);
 assert.equal((await sync.status('local-pet')).state,'local');
 await storage.removeEvent(event.id);
 await assert.rejects(sync.prepareAssociation(request),/restore|pristine|confirmation/i);
 assert.equal((await storage.loadEvents()).length,0);
 const fresh=await setup(t,{pristine:true}),{generation}=await fresh.sync.prepareAssociation(request),fence={generation,accountId:'account-1'};
 await fresh.sync.stageBaseline({...fence,page:{changes:[],cursor:0,hasMore:false}});
 await fresh.storage.appendEvents([{...event,note:'Created during restore'}]);
 const snapshot=()=>fresh.database.read(async sql=>Object.fromEntries(await Promise.all(['metadata','puppies','events','routines','local_revisions','local_sync_owner','local_sync_baseline','local_sync_outbox'].map(async table=>[table,await sql.getAllAsync(`SELECT * FROM ${table} ORDER BY rowid`)]))));
 const before=await snapshot();
 await assert.rejects(fresh.sync.completeAssociation({...fence,cloudPetId:'cloud-pet'}),/restore|pristine|confirmation/i);
 assert.deepEqual(await snapshot(),before);
 assert.deepEqual(await fresh.storage.loadEvents(),[{...event,note:'Created during restore'}]);
 assert.equal((await database.read(sql=>sql.getFirstAsync<{n:number}>('SELECT COUNT(*) n FROM local_sync_owner')))!.n,0);
});

test('first-launch restore requires explicit confirmation and untouched preferences routines and setup',async t=>{
 const plain=await setup(t,{pristine:true});
 await assert.rejects(plain.sync.prepareAssociation({...input,mode:'restore'}),/restore|pristine|confirmation/i);
 const changes:Array<(storage:ReturnType<typeof createNativeStorage>)=>Promise<unknown>>=[
  storage=>storage.saveThemePreference('soft-play'),
  storage=>storage.saveScheduleEntry({id:'starter-1',type:'pee',minutes:500},{id:'starter-1',type:'pee',minutes:420}),
  storage=>storage.completeOnboarding(),
 ];
 for(const change of changes){
  const {sync,storage}=await setup(t,{pristine:true});await change(storage);
  await assert.rejects(sync.prepareAssociation({...input,mode:'restore',enrollment:{...enrollment,confirmedPetId:'cloud-pet'}}),/restore|pristine|confirmation/i);
  assert.equal((await sync.status('local-pet')).state,'local');
 }
});

test('first-launch restore intent clears on cancel and detach without changing later combine behavior',async t=>{
 const {sync,storage,database}=await setup(t,{pristine:true});
 const request={...input,mode:'restore' as const,enrollment:{...enrollment,name:'Basil',confirmedPetId:'cloud-pet'}};
 let saved=await sync.prepareAssociation(request);assert.equal((await sync.enrollmentState())!.mode,'restore');
 await sync.cancelEnrollment({generation:saved.generation,accountId:'account-1',operationId:enrollment.operationId});
 assert.equal(await database.read(sql=>sql.getFirstAsync("SELECT value FROM metadata WHERE key='pending_restore_operation'")),null);
 saved=await sync.prepareAssociation({...request,enrollment:{...request.enrollment,operationId:'second'}});
 await sync.stageBaseline({generation:saved.generation,accountId:'account-1',page:{changes:[],cursor:0,hasMore:false}});
 await sync.detach({generation:saved.generation,accountId:'account-1'});
 assert.equal(await database.read(sql=>sql.getFirstAsync("SELECT value FROM metadata WHERE key='pending_restore_operation'")),null);
 saved=await sync.prepareAssociation({...input,enrollment:{...enrollment,operationId:'combine',confirmedPetId:'cloud-pet'}});
 assert.equal((await sync.enrollmentState())!.mode,undefined);await storage.appendEvents([event]);
 await sync.stageBaseline({generation:saved.generation,accountId:'account-1',page:{changes:[],cursor:0,hasMore:false}});
 await sync.completeAssociation({generation:saved.generation,accountId:'account-1',cloudPetId:'cloud-pet'});
 assert.deepEqual(await storage.loadEvents(),[event]);assert.ok((await sync.status('local-pet')).pending>0);
});

test('first-launch restore handles an empty cloud stub but never silently restores a deleted puppy',async t=>{
 for(const deleted of [false,true]){
  const {sync,storage}=await setup(t,{pristine:true});await storage.saveFirstLaunchProfile('Local draft');
  const request={...input,mode:'restore' as const,enrollment:{...enrollment,name:'Basil',confirmedPetId:'cloud-pet'}};
  const {generation}=await sync.prepareAssociation(request),fence={generation,accountId:'account-1'};
  const changes:CloudRecord[]=deleted?[{id:'cloud-pet',petId:'cloud-pet',kind:'puppy',data:{name:'Basil'},revision:2,sequence:1,deleted:true,updatedAt:1}]:[];
  await sync.stageBaseline({...fence,page:{changes,cursor:deleted?1:0,hasMore:false}});
  if(deleted){
   await assert.rejects(sync.completeAssociation({...fence,cloudPetId:'cloud-pet'}),/restore|confirmation/i);
   assert.equal(await storage.loadPuppyName(),'Local draft');assert.equal((await sync.status('local-pet')).state,'preparing');
  }else{
   await sync.completeAssociation({...fence,cloudPetId:'cloud-pet'});assert.equal(await storage.loadPuppyName(),'Basil');
   assert.deepEqual(await storage.loadSchedule(),[]);assert.deepEqual(await sync.nextBatch(fence),[]);
  }
 }
});

test('explicit event label restoration shares event rollback revisions and upload work',async t=>{
 const {sync,storage,database}=await setup(t);
 await storage.saveCustomActivity('Training');await storage.deleteCustomActivity('Training');
 await storage.appendEvents([event]);const fence=await activate(sync),options={restoreCustomActivities:true};
 const snapshot=()=>database.read(async sql=>Object.fromEntries(await Promise.all(['events','pet_settings','local_revisions','local_sync_outbox'].map(async table=>[table,await sql.getAllAsync(`SELECT * FROM ${table} ORDER BY rowid`)]))));
 let before=await snapshot();
 await assert.rejects(storage.updateEvent('deleted',{type:'custom',customLabel:'Training'},options),/deleted/);
 assert.deepEqual(await snapshot(),before);
 await database.write(sql=>sql.execAsync("CREATE TRIGGER fail_label_queue BEFORE INSERT ON local_sync_outbox WHEN json_extract(NEW.mutation_json,'$.kind')='customActivity' BEGIN SELECT RAISE(ABORT,'label queue failure'); END;"));
 await assert.rejects(storage.updateEvent(event.id,{type:'custom',customLabel:'Training'},options),/label queue failure/);
 assert.deepEqual(await snapshot(),before);
 await database.write(sql=>sql.execAsync('DROP TRIGGER fail_label_queue'));
 const prior=new Set((await sync.nextBatch(fence)).map(row=>row.operationId));
 await storage.updateEvent(event.id,{type:'custom',customLabel:'Training'},options);
 assert.deepEqual(await storage.loadCustomActivities(),['Training']);
 assert.deepEqual((await sync.nextBatch(fence)).filter(row=>!prior.has(row.operationId)).map(row=>row.kind),['event','customActivity']);
 await storage.deleteCustomActivity('Training');before=await snapshot();
 await database.write(sql=>sql.execAsync("CREATE TRIGGER fail_new_event BEFORE INSERT ON events BEGIN SELECT RAISE(ABORT,'event failure'); END;"));
 const custom={...event,id:'new-custom',type:'custom' as const,customLabel:'Training'};
 await assert.rejects(storage.appendEvents([custom],options),/event failure/);assert.deepEqual(await snapshot(),before);
 await database.write(sql=>sql.execAsync('DROP TRIGGER fail_new_event'));
 await storage.importEvents([{...custom,id:'historical-import'}]);assert.deepEqual(await storage.loadCustomActivities(),[]);
 await storage.appendEvents([custom],options);assert.deepEqual(await storage.loadCustomActivities(),['Training']);
});

test('free writes and preparing enrollment never create upload work; activation is restartable',async t=>{
 const {sync,storage,database,path}=await setup(t);
 await storage.appendEvents([event]);
 assert.deepEqual(await sync.status('local-pet'),{state:'local',generation:null,accountId:null,pending:0,blocked:0,cursor:0});
 const {generation}=await sync.prepareAssociation(input);
 assert.deepEqual(await sync.nextBatch({generation,accountId:'account-1'}),[]);
 await storage.updateEvent('event-1',{note:'after prepare'});
 const other=await createLocalDatabase(sqliteTestConnection(path));t.after(()=>other.close());
 await initializeLocalDatabase(other);
 const reopened=engine.createLocalSync(other);
 assert.deepEqual(await reopened.enrollmentState(),{generation,accountId:'account-1',request:enrollment,stagingCursor:0,baselineComplete:false});
 assert.deepEqual(await reopened.prepareAssociation(input),{generation});
 await reopened.stageBaseline({generation,accountId:'account-1',page:{changes:[],cursor:0,hasMore:false}});
 await reopened.completeAssociation({generation,accountId:'account-1',cloudPetId:'local-pet'});
 const batch=await reopened.nextBatch({generation,accountId:'account-1'});
 assert.equal(batch.find(value=>value.kind==='event')!.patch.note,'after prepare');
 const ids=batch.map(value=>value.operationId);
 await reopened.completeAssociation({generation,accountId:'account-1',cloudPetId:'local-pet'});
 assert.deepEqual((await reopened.nextBatch({generation,accountId:'account-1'})).map(value=>value.operationId),ids);
 assert.deepEqual((await storage.loadEvents())[0],{...event,note:'after prepare'});
});

test('incomplete or foreign baselines cannot associate; a failed initial queue rolls back all work',async t=>{
 const {sync,storage,database}=await setup(t);
 await storage.appendEvents(Array.from({length:1000},(_,index)=>({...event,id:`event-${index}`})));
 const owner=await sync.prepareAssociation(input);
 await assert.rejects(sync.completeAssociation({...owner,accountId:'account-1',cloudPetId:'local-pet'}),/baseline/i);
 await assert.rejects(sync.stageBaseline({...owner,accountId:'wrong',page:{changes:[],cursor:0,hasMore:false}}),/owner/i);
 await sync.stageBaseline({...owner,accountId:'account-1',page:{changes:[],cursor:0,hasMore:false}});
 await database.write(sql=>sql.execAsync("CREATE TRIGGER fail_initial_queue AFTER INSERT ON local_sync_outbox WHEN NEW.local_id='event-500' BEGIN SELECT RAISE(ABORT,'queue interruption'); END;"));
 await assert.rejects(sync.completeAssociation({...owner,accountId:'account-1',cloudPetId:'local-pet'}),/queue interruption/);
 assert.equal((await sync.status('local-pet')).pending,0);
 assert.equal((await storage.loadEvents()).length,1000);
 await database.write(sql=>sql.execAsync('DROP TRIGGER fail_initial_queue'));
 await sync.completeAssociation({...owner,accountId:'account-1',cloudPetId:'local-pet'});
 assert.equal((await sync.status('local-pet')).pending,1002);
});

test('joining cloud combines confirmed local fields, remote-only records and cloud preferences',async t=>{
 const {sync,storage}=await setup(t);
 await storage.appendEvents([{...event,note:'local note'}]);
 const records:CloudRecord[]=[
 {id:'cloud-pet',petId:'cloud-pet',kind:'puppy',data:{name:'Cloud puppy'},revision:1,sequence:1,deleted:false,updatedAt:1},
 {id:cloudRecordId('event','cloud-pet','event-1'),petId:'cloud-pet',kind:'event',data:{type:'pee',at:100,source:'app',note:'cloud note',estimated:true},revision:1,sequence:2,deleted:false,updatedAt:1},
 {id:cloudRecordId('event','cloud-pet','remote-only'),petId:'cloud-pet',kind:'event',data:{type:'meal',at:200,source:'app'},revision:1,sequence:3,deleted:false,updatedAt:1},
 {id:cloudRecordId('accountPreferences',null,'preferences'),petId:null,kind:'accountPreferences',data:{theme:'soft-play',language:'es'},revision:1,sequence:4,deleted:false,updatedAt:1},
 ];
 const {generation}=await sync.prepareAssociation({...input,enrollment:{...enrollment,confirmedPetId:'cloud-pet'}});
 await sync.stageBaseline({generation,accountId:'account-1',page:{changes:records.slice(0,2),cursor:2,hasMore:true}});
 await sync.stageBaseline({generation,accountId:'account-1',page:{changes:records.slice(2),cursor:4,hasMore:false}});
 await sync.completeAssociation({generation,accountId:'account-1',cloudPetId:'cloud-pet'});
 assert.equal(await storage.loadPuppyName(),'Cloud puppy'); assert.equal(await storage.loadThemePreference(),'soft-play');
 const history=await storage.loadEvents(); assert.equal(history.length,2);
 const combined=history.find(value=>value.id==='event-1')!;
 assert.equal(combined.note,'local note'); assert.equal(combined.estimated,true);
 const batch=await sync.nextBatch({generation,accountId:'account-1'});
 const change=batch.find(value=>value.kind==='event'&&value.recordId===records[1].id)!;
 assert.equal(change.intent,'patch');assert.equal(change.baseRevision,1);assert.deepEqual(change.patch,{note:'local note'});
 assert.ok(!batch.some(value=>value.kind==='accountPreferences'||value.kind==='puppy'));
});

test('local edits queue immutable exact changes and oversized serialized requests stay recoverable',async t=>{
 const {sync,storage}=await setup(t);const owner=await activate(sync);
 await storage.appendEvents([event]);
 const before=await sync.nextBatch(owner);
 await storage.updateEvent('event-1',{note:'first'});
 await storage.updateEvent('event-1',{at:200});
 const after=await sync.nextBatch(owner);
 assert.deepEqual(after.slice(0,before.length),before);
 assert.deepEqual(after.at(-2)!.patch,{note:'first'});assert.deepEqual(after.at(-1)!.patch,{at:200});
 await storage.appendEvents([{...event,id:'oversized',note:'\u0001'.repeat(12000)}]);
 assert.equal((await sync.status('local-pet')).blocked,1);
 assert.equal((await storage.loadEvents()).find(value=>value.id==='oversized')!.note!.length,12000);
 assert.ok(!(await sync.nextBatch(owner)).some(value=>value.recordId===cloudRecordId('event','local-pet','oversized')));
 await storage.updateEvent('oversized',{note:'corrected'});
 assert.equal((await sync.status('local-pet')).blocked,0);
 assert.equal((await sync.nextBatch(owner)).find(value=>value.recordId===cloudRecordId('event','local-pet','oversized'))!.intent,'create');
});

test('batch limits count UTF-8 request bytes and blocked records do not starve valid work',async t=>{
 const {sync,storage}=await setup(t);const owner=await activate(sync);
 await storage.appendEvents(Array.from({length:60},(_,index)=>({...event,id:`batch-${index}`,note:'训练'.repeat(6000)})));
 // 12000 UTF-16 chars are valid notes, 36000 bytes each. Two exceed a request.
 const batch=await sync.nextBatch(owner);
 assert.ok(batch.length>0&&batch.length<=50);
 assert.ok(Buffer.byteLength(JSON.stringify({mutations:batch}))<65536);
 assert.ok(batch.filter(value=>value.kind==='event').length<=1);
 await storage.appendEvents([{...event,id:'serialized-too-large',note:'\u0001'.repeat(12000)}]);
 assert.equal((await sync.status('local-pet')).blocked,1);
 assert.ok((await sync.nextBatch(owner)).length>0);
});

test('account detach keeps history, fences old responses and requires explicit ownership switch',async t=>{
 const {sync,storage}=await setup(t);const owner=await activate(sync);
 await storage.appendEvents([event]);
 await assert.rejects(sync.prepareAssociation({...input,accountId:'account-2',enrollment:{...enrollment,operationId:'other'}}),/detach|owner/i);
 await assert.rejects(sync.detach({...owner,accountId:'wrong'}),/owner/i);
 await sync.detach(owner);
 assert.equal((await storage.loadEvents()).length,1);
 assert.deepEqual(await sync.nextBatch(owner),[]);
 const next=await sync.prepareAssociation({...input,accountId:'account-2',enrollment:{...enrollment,operationId:'other'}});
 assert.notEqual(next.generation,owner.generation);
 assert.deepEqual(await sync.nextBatch(owner),[]);
});

test('enrollment status is explicit and duplicate committed baseline pages resume safely',async t=>{
 const {sync}=await setup(t);const {generation}=await sync.prepareAssociation(input);
 assert.equal((await sync.status('local-pet')).state,'preparing');
 const page={changes:[],cursor:0,hasMore:false};
 await sync.stageBaseline({generation,accountId:'account-1',page});
 await sync.stageBaseline({generation,accountId:'account-1',page});
 await sync.completeAssociation({generation,accountId:'account-1',cloudPetId:'local-pet'});
 assert.equal((await sync.status('local-pet')).state,'active');
});

test('a corrupt saved server record cannot be mislabeled as an invalid local change',async t=>{
 const {sync,storage,database}=await setup(t);const owner=await activate(sync);
 await storage.appendEvents([event]);
 await database.write(sql=>sql.runAsync('INSERT INTO local_sync_records(generation,record_id,body) VALUES (?,?,?)',owner.generation,cloudRecordId('event','local-pet',event.id),'{}'));
 await assert.rejects(storage.updateEvent(event.id,{note:'must roll back'}));
 assert.equal((await storage.loadEvents())[0].note,undefined);
 assert.equal((await sync.status('local-pet')).blocked,0);
});

test('baseline deletion wins and invalid merged timing retains valid server timing with local proposal queued',async t=>{
 const {sync,storage}=await setup(t);
 await storage.appendEvents([event,{id:'nap-old',type:'nap',at:300,source:'app',note:'local'}]);
 const {generation}=await sync.prepareAssociation({...input,enrollment:{...enrollment,confirmedPetId:'cloud-pet'}});
 const records:CloudRecord[]=[
 {id:cloudRecordId('event','cloud-pet',event.id),petId:'cloud-pet',kind:'event',data:{type:'pee',at:100,source:'app'},revision:2,sequence:2,deleted:true,updatedAt:1},
 {id:cloudRecordId('event','cloud-pet','nap-old'),petId:'cloud-pet',kind:'event',data:{type:'nap',at:100,endedAt:200,source:'app'},revision:1,sequence:3,deleted:false,updatedAt:1},
 ];
 await sync.stageBaseline({generation,accountId:'account-1',page:{changes:records,cursor:3,hasMore:false}});
 await sync.completeAssociation({generation,accountId:'account-1',cloudPetId:'cloud-pet'});
 const history=await storage.loadEvents();assert.ok(!history.some(value=>value.id===event.id));
 const nap=history.find(value=>value.id==='nap-old')!;assert.equal(nap.at,100);assert.equal(nap.endedAt,200);assert.equal(nap.note,'local');
 const pending=await sync.nextBatch({generation,accountId:'account-1'});
 const timing=pending.find(value=>value.recordId===records[1].id);assert.ok(timing?.kind==='event');assert.equal(timing.patch.at,300);
});

test('free offline edits retain discreet local revision history without producing a cloud backlog',async t=>{
 const {database,sync,storage}=await setup(t);
 await storage.appendEvents([event]);await storage.updateEvent(event.id,{note:'recover this'});await storage.removeEvent(event.id);
 const rows=await database.read(sql=>sql.getAllAsync<{before_data:string|null;after_data:string|null;source:string}>('SELECT before_data,after_data,source FROM local_revisions WHERE pet_id=? AND kind=? AND local_id=? ORDER BY sequence','local-pet','event',event.id));
 assert.equal(rows.length,3);assert.equal(rows[0].before_data,null);assert.equal(JSON.parse(rows[1].after_data!).note,'recover this');assert.equal(rows[2].after_data,null);
 assert.ok(rows.every(row=>row.source==='local'));assert.equal((await sync.status('local-pet')).pending,0);
});

test('initial association preserves a locally deleted custom activity and its historical label',async t=>{
 const {sync,storage}=await setup(t);
 await storage.appendEvents([{...event,type:'custom',customLabel:'Training'}]);
 await storage.deleteCustomActivity('Training');
 const {generation}=await sync.prepareAssociation(input);
 const record:CloudRecord={id:cloudRecordId('customActivity','local-pet','custom:training'),petId:'local-pet',kind:'customActivity',data:{label:'Training'},revision:1,sequence:1,deleted:false,updatedAt:1};
 await sync.stageBaseline({generation,accountId:'account-1',page:{changes:[record],cursor:1,hasMore:false}});
 await sync.completeAssociation({generation,accountId:'account-1',cloudPetId:'local-pet'});
 assert.deepEqual(await storage.loadCustomActivities(),[]);assert.equal((await storage.loadEvents())[0].customLabel,'Training');
 const deletion=(await sync.nextBatch({generation,accountId:'account-1'})).find(value=>value.recordId===record.id)!;
 assert.equal(deletion.intent,'delete');assert.equal(deletion.baseRevision,1);
});

test('an oversized serialized note does not block initial combination or valid timing preservation',async t=>{
 const {sync,storage}=await setup(t);const note='\u0001'.repeat(12000);
 await storage.appendEvents([{id:'serialized-nap',type:'nap',at:300,source:'app',note}]);
 const {generation}=await sync.prepareAssociation(input);
 const record:CloudRecord={id:cloudRecordId('event','local-pet','serialized-nap'),petId:'local-pet',kind:'event',data:{type:'nap',at:100,endedAt:200,source:'app'},revision:1,sequence:1,deleted:false,updatedAt:1};
 await sync.stageBaseline({generation,accountId:'account-1',page:{changes:[record],cursor:1,hasMore:false}});
 await sync.completeAssociation({generation,accountId:'account-1',cloudPetId:'local-pet'});
 const saved=(await storage.loadEvents())[0];assert.equal(saved.note,note);assert.equal(saved.at,100);assert.equal(saved.endedAt,200);
 assert.equal((await sync.status('local-pet')).blocked,1);
});

test('two puppy bindings share account ownership without mixing record IDs or duplicate preferences',async t=>{
 const {sync,storage,database}=await setup(t);const owner=await activate(sync);
 await storage.appendEvents([event]);
 await database.write(sql=>sql.runAsync('INSERT INTO puppies(id,name) VALUES (?,?)','pet-2','Second puppy'));
 const other=createNativeStorage(database,'pet-2',sync.changeSink('pet-2'));
 await other.appendEvents([{...event,note:'only second'}]);
 const pending=(await sync.status('local-pet')).pending;
 assert.equal((await sync.status('pet-2')).state,'local');
 const second=await sync.prepareAssociation({...input,localPetId:'pet-2',enrollment:{...enrollment,operationId:'enroll-2',localPetId:'pet-2'}});
 assert.equal(second.generation,owner.generation);
 await sync.stageBaseline({...owner,page:{changes:[],cursor:0,hasMore:false}});
 await sync.completeAssociation({...owner,cloudPetId:'pet-2'});
 const batch=await sync.nextBatch(owner);
 assert.equal(batch.filter(value=>value.kind==='accountPreferences').length,1);
 const events=batch.filter(value=>value.kind==='event');assert.equal(events.length,2);assert.notEqual(events[0].recordId,events[1].recordId);
 assert.equal(events.find(value=>value.petId==='pet-2')!.patch.note,'only second');
 assert.equal((await sync.status('local-pet')).pending,pending+2);
 await sync.detach(owner);assert.equal((await storage.loadEvents()).length,1);assert.equal((await other.loadEvents()).length,1);
});

test('an empty page cannot invent cursor progress or complete another owner enrollment',async t=>{
 const {sync}=await setup(t);const owner=await sync.prepareAssociation(input);
 await assert.rejects(sync.stageBaseline({...owner,accountId:'account-1',page:{changes:[],cursor:10,hasMore:false}}),/cursor/i);
 await assert.rejects(sync.completeAssociation({...owner,accountId:'account-1',cloudPetId:'unconfirmed'}),/baseline|confirm/i);
 assert.equal((await sync.enrollmentState())!.baselineComplete,false);
});

// Engine integration uses the production reconciler with deterministic server
// order. Real Workers database/HTTP behavior is tested separately in server/.
function replicaServer() {
 const records=new Map<string,CloudRecord>();const operations=new Map<string,import('../cloud/protocol.ts').MutationResult>();const changes:CloudRecord[]=[];
 return {
  push(mutations:import('../cloud/protocol.ts').Mutation[]) {
   const accepted:import('../cloud/protocol.ts').MutationResult[]=[];
   for (const mutation of mutations) {
    const previous=operations.get(mutation.operationId);if (previous) {accepted.push(previous);continue;}
    const result=reconcileMutation(records.get(mutation.recordId)??null,mutation,1000);
    const record={...result.record,revision:(records.get(mutation.recordId)?.revision??0)+1,sequence:changes.length+1};
    records.set(record.id,record);changes.push(record);
    const ack={operationId:mutation.operationId,record,sequence:record.sequence,reason:result.reason};operations.set(mutation.operationId,ack);accepted.push(ack);
   }
   return accepted;
  },
  pull(after:number) {const page=changes.filter(record=>record.sequence>after).slice(0,100);return {changes:page,cursor:page.at(-1)?.sequence??after,hasMore:changes.some(record=>record.sequence>(page.at(-1)?.sequence??after))};},
  record(id:string) {return records.get(id)!;},
 };
}
import { reconcileMutation } from '../cloud/reconcile.ts';
async function cycle(sync:ReturnType<typeof engine.createLocalSync>,owner:{generation:string;accountId:string},server:ReturnType<typeof replicaServer>) {
 const accepted=server.push(await sync.nextBatch(owner));const cursor=(await sync.status('local-pet')).cursor;
 await sync.applySync({...owner,accepted,page:server.pull(cursor)});
}

test('acknowledging in-flight work preserves a later local edit and combines independent remote fields',async t=>{
 const {sync,storage}=await setup(t);const owner=await activate(sync),server=replicaServer();
 await cycle(sync,owner,server);await storage.appendEvents([event]);await cycle(sync,owner,server);
 await storage.updateEvent(event.id,{note:'in flight'});const flight=await sync.nextBatch(owner);
 await storage.updateEvent(event.id,{at:200});const later=(await sync.nextBatch(owner)).at(-1)!;
 const accepted=server.push(flight);
 assert.ok(flight[0].kind==='event');
 const remote=server.record(flight[0].recordId);
 server.push([{...flight[0],operationId:'remote-source',deviceId:'other-device',baseRevision:remote.revision,intent:'patch',patch:{source:'widget'}}]);
 await sync.applySync({...owner,accepted,page:server.pull((await sync.status('local-pet')).cursor)});
 assert.deepEqual(await sync.nextBatch(owner),[later]);
 assert.deepEqual((await storage.loadEvents())[0],{...event,at:200,note:'in flight',source:'widget'});
 await cycle(sync,owner,server);assert.equal((await sync.status('local-pet')).pending,0);
 // A retried older acknowledgment must neither roll back the mirror nor edit.
 await sync.applySync({...owner,accepted,page:server.pull((await sync.status('local-pet')).cursor)});
 assert.equal((await storage.loadEvents())[0].at,200);
});

test('unknown acknowledgments and cursor-commit failure leave every pending operation intact',async t=>{
 const {sync,storage,database}=await setup(t);const owner=await activate(sync),server=replicaServer();
 const pending=await sync.nextBatch(owner),accepted=server.push(pending),page=server.pull(0);
 await assert.rejects(sync.applySync({...owner,accepted:[{...accepted[0],operationId:'not-sent'}],page}),/acknowledg|operation/i);
 assert.deepEqual(await sync.nextBatch(owner),pending);
 await database.write(sql=>sql.execAsync("CREATE TRIGGER fail_cursor BEFORE UPDATE ON local_sync_owner WHEN NEW.cursor>OLD.cursor BEGIN SELECT RAISE(ABORT,'cursor interruption'); END;"));
 await assert.rejects(sync.applySync({...owner,accepted,page}),/cursor interruption/);
 assert.deepEqual(await sync.nextBatch(owner),pending);assert.equal((await sync.status('local-pet')).cursor,0);
 await database.write(sql=>sql.execAsync('DROP TRIGGER fail_cursor'));
 await sync.applySync({...owner,accepted,page});assert.equal((await sync.status('local-pet')).pending,0);
 assert.deepEqual(await storage.loadEvents(),[]);
});

test('server deletion hides stale local edits; explicit restore requires the current deletion revision',async t=>{
 const {sync,storage}=await setup(t);const owner=await activate(sync),server=replicaServer();await cycle(sync,owner,server);
 await storage.appendEvents([event]);await cycle(sync,owner,server);
 await storage.updateEvent(event.id,{note:'offline'});const pending=(await sync.nextBatch(owner))[0];
 server.push([{...pending,operationId:'remote-delete',deviceId:'other-device',intent:'delete',patch:{}}]);
 await sync.applySync({...owner,accepted:[],page:server.pull((await sync.status('local-pet')).cursor)});
 assert.deepEqual(await storage.loadEvents(),[]);
 await cycle(sync,owner,server);const deleted=server.record(pending.recordId);
 await assert.rejects(sync.restore({...owner,record:{...deleted,revision:deleted.revision-1},data:{type:'pee',at:100,source:'app'}}),/revision/i);
 await sync.restore({...owner,record:deleted,data:{type:'pee',at:100,source:'app',note:'restored'}});
 assert.equal((await storage.loadEvents())[0].note,'restored');
 assert.equal((await sync.nextBatch(owner))[0].intent,'restore');await cycle(sync,owner,server);assert.equal((await sync.status('local-pet')).pending,0);
});

test('a full resync stages replacement without erasing pending local edits',async t=>{
 const {sync,storage}=await setup(t);const owner=await activate(sync),server=replicaServer();await cycle(sync,owner,server);
 await storage.appendEvents([event]);await cycle(sync,owner,server);
 await storage.updateEvent(event.id,{note:'keep pending'});const pending=await sync.nextBatch(owner);
 await sync.resetBaseline(owner);assert.deepEqual(await sync.nextBatch(owner),[]);
 assert.equal((await storage.loadEvents())[0].note,'keep pending');
 const all=server.pull(0);await sync.stageBaseline({...owner,page:{changes:all.changes.slice(0,1),cursor:1,hasMore:true}});
 await assert.rejects(sync.finishResync(owner),/baseline/i);
 assert.equal((await storage.loadEvents())[0].note,'keep pending');
 await sync.stageBaseline({...owner,page:{changes:all.changes.slice(1),cursor:all.cursor,hasMore:false}});
 await sync.finishResync(owner);
 assert.deepEqual(await sync.nextBatch(owner),pending);assert.equal((await storage.loadEvents())[0].note,'keep pending');
});

test('a response from a detached owner cannot change the next account or its local copy',async t=>{
 const {sync,storage}=await setup(t);const owner=await activate(sync),server=replicaServer();
 await storage.appendEvents([event]);const accepted=server.push(await sync.nextBatch(owner)),page=server.pull(0);
 await sync.detach(owner);const next=await sync.prepareAssociation({...input,accountId:'account-2',enrollment:{...enrollment,operationId:'second-owner'}});
 await storage.updateEvent(event.id,{note:'detached local edit'});
 await sync.applySync({...owner,accepted,page});
 assert.equal((await storage.loadEvents())[0].note,'detached local edit');assert.equal((await sync.status('local-pet')).generation,next.generation);
 assert.equal((await sync.status('local-pet')).accountId,'account-2');
});

test('two SQLite clients combine offline changes and retry a server commit lost before local acknowledgment',async t=>{
 const first=await setup(t),second=await setup(t),server=replicaServer();const one=await activate(first.sync);await cycle(first.sync,one,server);
 const two=await second.sync.prepareAssociation({...input,deviceId:'device-2',enrollment:{...enrollment,deviceId:'device-2',confirmedPetId:'local-pet'}});
 await second.sync.stageBaseline({...two,accountId:'account-1',page:server.pull(0)});await second.sync.completeAssociation({...two,accountId:'account-1',cloudPetId:'local-pet'});
 const other={...two,accountId:'account-1'};
 await first.storage.appendEvents([event]);const flight=await first.sync.nextBatch(one);server.push(flight);
 // Pull can see an already committed create while its acknowledgment is lost.
 await first.sync.applySync({...one,accepted:[],page:server.pull((await first.sync.status('local-pet')).cursor)});
 await cycle(first.sync,one,server);await cycle(second.sync,other,server);
 await first.storage.updateEvent(event.id,{note:'first offline'});await second.storage.updateEvent(event.id,{at:200});
 await cycle(first.sync,one,server);await cycle(second.sync,other,server);await cycle(first.sync,one,server);
 assert.deepEqual(await first.storage.loadEvents(),await second.storage.loadEvents());
 assert.deepEqual((await first.storage.loadEvents())[0],{...event,at:200,note:'first offline'});
});

test('a concurrent initial create conflict becomes a fresh field patch after pulling current cloud state',async t=>{
 const {sync,storage}=await setup(t);const owner=await activate(sync),server=replicaServer();await cycle(sync,owner,server);
 await storage.appendEvents([event]);const pending=(await sync.nextBatch(owner))[0];
 assert.ok(pending.kind==='event');
 server.push([{...pending,operationId:'other-initial-copy',deviceId:'other-device',patch:{...pending.patch,note:'remote independent'}}]);
 assert.throws(()=>server.push([pending]),/exists/i);
 const response={...owner,accepted:[],rejected:[{operationId:pending.operationId,error:'conflict' as const}],page:server.pull((await sync.status('local-pet')).cursor)};
 await sync.applySync(response);
 const next=(await sync.nextBatch(owner))[0];assert.notEqual(next.operationId,pending.operationId);assert.equal(next.intent,'patch');assert.equal(next.baseRevision,1);
 assert.equal((await storage.loadEvents())[0].note,'remote independent');
 await sync.applySync(response);assert.deepEqual(await sync.nextBatch(owner),[next]);
 await cycle(sync,owner,server);assert.equal((await sync.status('local-pet')).pending,0);
});

test('retryable rejections retain exact payloads; invalid work is visible and does not block other records',async t=>{
 const {sync,storage}=await setup(t);const owner=await activate(sync),server=replicaServer();await cycle(sync,owner,server);
 await storage.appendEvents([event,{...event,id:'independent'}]);const pending=await sync.nextBatch(owner),page=server.pull((await sync.status('local-pet')).cursor);
 await sync.applySync({...owner,accepted:[],rejected:[{operationId:pending[0].operationId,error:'retry_later'}],page});
 assert.deepEqual(await sync.nextBatch(owner),pending);
 await sync.applySync({...owner,accepted:[],rejected:[{operationId:pending[0].operationId,error:'invalid_mutation'}],page});
 assert.equal((await sync.status('local-pet')).blocked,1);assert.deepEqual(await sync.nextBatch(owner),[pending[1]]);
 assert.equal((await storage.loadEvents()).length,2);
});

test('blocked local notes survive pulls and correcting them never queues unrelated remote fields',async t=>{
 const {sync,storage}=await setup(t);const owner=await activate(sync),server=replicaServer();await cycle(sync,owner,server);
 await storage.appendEvents([event]);await cycle(sync,owner,server);
 const note='\u0001'.repeat(12000);await storage.updateEvent(event.id,{note});
 const record=server.record(cloudRecordId('event','local-pet',event.id));
 server.push([{protocolVersion:1,operationId:'remote-time',deviceId:'other',recordId:record.id,petId:record.petId,kind:'event',baseRevision:record.revision,intent:'patch',patch:{at:200}}]);
 await sync.applySync({...owner,accepted:[],page:server.pull((await sync.status('local-pet')).cursor)});
 assert.equal((await storage.loadEvents())[0].at,200);assert.equal((await storage.loadEvents())[0].note,note);
 await storage.updateEvent(event.id,{note:'corrected'});
 const next=await sync.nextBatch(owner);assert.equal(next.length,1);assert.deepEqual(next[0].patch,{note:'corrected'});
});

test('a malformed scoped pull rolls back valid acknowledgments and an unbound puppy never joins local history',async t=>{
 const {sync,storage,database}=await setup(t);const owner=await activate(sync),server=replicaServer();
 const pending=await sync.nextBatch(owner),accepted=server.push(pending);
 const wrong:CloudRecord={id:cloudRecordId('event','pet-other','same-id'),petId:'local-pet',kind:'event',data:{type:'meal',at:200,source:'app'},revision:1,sequence:accepted.at(-1)!.sequence+1,deleted:false,updatedAt:1};
 await assert.rejects(sync.applySync({...owner,accepted,page:{changes:[wrong],cursor:wrong.sequence,hasMore:false}}),/identity/i);
 assert.deepEqual(await sync.nextBatch(owner),pending);
 const valid={...wrong,petId:'pet-other'};
 await sync.applySync({...owner,accepted,page:server.pull(0)});
 await sync.applySync({...owner,accepted:[],page:{changes:[valid],cursor:valid.sequence,hasMore:false}});
 assert.deepEqual(await storage.loadEvents(),[]);assert.equal((await database.read(sql=>sql.getFirstAsync<{n:number}>('SELECT COUNT(*) n FROM puppies')))!.n,1);
});

test('restoring a record with its own pending writes waits for their acknowledgments',async t=>{
 const {sync,storage}=await setup(t);const owner=await activate(sync),server=replicaServer();await cycle(sync,owner,server);
 await storage.appendEvents([event]);await cycle(sync,owner,server);
 await storage.updateEvent(event.id,{note:'not yet acknowledged'});const pending=await sync.nextBatch(owner);
 const record=server.record(pending[0].recordId);
 await assert.rejects(sync.restore({...owner,record,data:{type:'pee',at:100,source:'app'}}),/pending|acknowledg/i);
 assert.deepEqual(await sync.nextBatch(owner),pending);assert.equal((await storage.loadEvents())[0].note,'not yet acknowledged');
});

for (const acknowledgeLater of [false,true]) test(`conflict recovery preserves later same-field edits (acknowledged=${acknowledgeLater})`,async t=>{
  const {sync,storage}=await setup(t);const owner=await activate(sync),server=replicaServer();await cycle(sync,owner,server);
  await storage.appendEvents([{...event,note:'first'}]);const original=(await sync.nextBatch(owner))[0];
  await storage.updateEvent(event.id,{note:'later'});const later=(await sync.nextBatch(owner))[1];
  server.push([{...original,operationId:'other-create',deviceId:'other-device'}]);
  const accepted=acknowledgeLater?server.push([later]):[];
  if (acknowledgeLater) {
   await sync.applySync({...owner,accepted,page:server.pull((await sync.status('local-pet')).cursor)});
   assert.equal((await storage.loadEvents())[0].note,'later');
  }
  await sync.applySync({...owner,accepted,rejected:[{operationId:original.operationId,error:'conflict'}],page:server.pull((await sync.status('local-pet')).cursor)});
  assert.equal((await storage.loadEvents())[0].note,'later',`later acknowledged=${acknowledgeLater}`);
  const next=await sync.nextBatch(owner);
  if (!acknowledgeLater) assert.equal(next.at(-1)!.operationId,later.operationId);
  else assert.ok(next.every(mutation=>!('note' in mutation.patch)));
  await cycle(sync,owner,server);
  assert.equal((server.record(original.recordId).data as Record<string,unknown>).note,'later');
});

test('two puppy projections apply account preferences once and preserve independent pending fields',async t=>{
 const {sync,storage,database}=await setup(t);const owner=await activate(sync),server=replicaServer();await cycle(sync,owner,server);
 await database.write(sql=>sql.runAsync('INSERT INTO puppies(id,name) VALUES (?,?)','pet-2','Second puppy'));
 const other=createNativeStorage(database,'pet-2',sync.changeSink('pet-2'));
 await sync.prepareAssociation({...input,localPetId:'pet-2',enrollment:{...enrollment,operationId:'enroll-2',localPetId:'pet-2'}});
 await sync.stageBaseline({...owner,page:server.pull(0)});await sync.completeAssociation({...owner,cloudPetId:'pet-2'});await cycle(sync,owner,server);
 await other.saveThemePreference('soft-play');
 const preferences=server.record(cloudRecordId('accountPreferences',null,'preferences'));
 server.push([{protocolVersion:1,operationId:'remote-language',deviceId:'other-device',recordId:preferences.id,petId:null,kind:'accountPreferences',baseRevision:preferences.revision,intent:'patch',patch:{language:'es'}}]);
 await sync.applySync({...owner,accepted:[],page:server.pull((await sync.status('local-pet')).cursor)});
 assert.equal(await storage.loadLanguagePreference(),'es');assert.equal(await other.loadThemePreference(),'soft-play');
 await cycle(sync,owner,server);assert.equal((server.record(preferences.id).data as Record<string,unknown>).language,'es');assert.equal((server.record(preferences.id).data as Record<string,unknown>).theme,'soft-play');
});

test('oversized escaped restores reject atomically without starving independent work',async t=>{
 const {sync,storage}=await setup(t);const owner=await activate(sync),server=replicaServer();await cycle(sync,owner,server);
 await storage.appendEvents([event]);await cycle(sync,owner,server);
 const record=server.record(cloudRecordId('event','local-pet',event.id));
 await assert.rejects(sync.restore({...owner,record,data:{...record.data,note:'\u0001'.repeat(16384)}}),/size|large|limit/i);
 assert.equal((await sync.status('local-pet')).pending,0);assert.equal((await storage.loadEvents())[0].note,undefined);
 await storage.appendEvents([{...event,id:'independent'}]);
 assert.equal((await sync.nextBatch(owner))[0].recordId,cloudRecordId('event','local-pet','independent'));
});

test('empty incremental cursor advancement rolls back acknowledgments and every local effect',async t=>{
 const {sync,storage}=await setup(t);const owner=await activate(sync),server=replicaServer();await cycle(sync,owner,server);
 const cursor=(await sync.status('local-pet')).cursor;
 await storage.appendEvents([event]);const pending=await sync.nextBatch(owner),accepted=server.push(pending);
 await assert.rejects(sync.applySync({...owner,accepted,page:{changes:[],cursor:cursor+100,hasMore:false}}),/cursor/i);
 assert.equal((await sync.status('local-pet')).cursor,cursor);assert.deepEqual(await sync.nextBatch(owner),pending);assert.deepEqual(await storage.loadEvents(),[event]);
 await cycle(sync,owner,server);assert.equal((await sync.status('local-pet')).pending,0);
});

test('imported historical labels synchronize creation and later deletion without erasing history',async t=>{
 const {sync,storage}=await setup(t);const owner=await activate(sync),server=replicaServer();await cycle(sync,owner,server);
 await storage.importEvents([{...event,type:'custom',customLabel:'Training'}]);
 const activityId=cloudRecordId('customActivity','local-pet','custom:training');
 assert.ok((await sync.nextBatch(owner)).some(mutation=>mutation.recordId===activityId&&mutation.intent==='create'));
 await cycle(sync,owner,server);assert.deepEqual(await storage.loadCustomActivities(),['Training']);assert.equal((await sync.status('local-pet')).pending,0);
 await storage.deleteCustomActivity('Training');
 assert.ok((await sync.nextBatch(owner)).some(mutation=>mutation.recordId===activityId&&mutation.intent==='delete'));
 await cycle(sync,owner,server);assert.equal(server.record(activityId).deleted,true);assert.equal((await storage.loadEvents())[0].customLabel,'Training');
 assert.deepEqual(await storage.loadCustomActivities(),[]);assert.equal((await sync.status('local-pet')).pending,0);
});

test('confirmed enrollment rejection releases only its exact untouched preparation and retains local history',async t=>{
 const {sync,storage}=await setup(t);await storage.appendEvents([event]);const owner=await sync.prepareAssociation(input);
 assert.equal(typeof sync.cancelEnrollment,'function');
 await assert.rejects(sync.cancelEnrollment({...owner,accountId:'account-1',operationId:'wrong'}));
 await sync.cancelEnrollment({...owner,accountId:'account-1',operationId:enrollment.operationId});
 assert.equal((await sync.status('local-pet')).state,'local');assert.deepEqual(await storage.loadEvents(),[event]);
 assert.equal(await sync.enrollmentState(),null);
});

test('enrollment cancellation cannot discard a baseline that already began or another active puppy queue',async t=>{
 const {sync,storage,database}=await setup(t);const owner=await activate(sync);await storage.appendEvents([event]);
 const before=await sync.nextBatch(owner);
 await database.write(sql=>sql.runAsync('INSERT INTO puppies(id,name) VALUES (?,?)','pet-2','Second'));
 const next={...enrollment,operationId:'second-enroll',localPetId:'pet-2'};
 await sync.prepareAssociation({...input,localPetId:'pet-2',enrollment:next});
 assert.equal(typeof sync.cancelEnrollment,'function');
 await sync.cancelEnrollment({...owner,operationId:next.operationId});
 assert.equal((await sync.status('local-pet')).state,'active');assert.deepEqual(await sync.nextBatch(owner),before);
 assert.equal((await sync.status('pet-2')).state,'local');
 await sync.prepareAssociation({...input,localPetId:'pet-2',enrollment:next});
 await sync.stageBaseline({...owner,page:{changes:[],cursor:0,hasMore:false}});
 await assert.rejects(sync.cancelEnrollment({...owner,operationId:next.operationId}),/baseline/i);
 assert.ok(await sync.enrollmentState());
 assert.deepEqual(await database.read(async sql=>(await sql.getAllAsync<{mutation_json:string}>('SELECT mutation_json FROM local_sync_outbox ORDER BY sequence')).map(row=>JSON.parse(row.mutation_json))),before);
});


test('backup recovery explicitly restores synced deletions and rejects pending deletes atomically',async t=>{
 const {database,sync,storage}=await setup(t),owner=await activate(sync),server=replicaServer();await cycle(sync,owner,server);
 const recover=createLocalRepository(database,'local-pet',sync.changeSink('local-pet',{restoreMissing:true})).importEvents;
 const nap={id:'nap-backup',type:'nap' as const,at:200,endedAt:300,source:'widget' as const};
 await storage.appendEvents([event,nap]);await cycle(sync,owner,server);
 await storage.removeEvent(event.id);await storage.removeEvent(nap.id);
 const before=await storage.loadEvents(),pending=await sync.nextBatch(owner);
 await assert.rejects(recover([{...event,id:'new-backup-log'},event,nap]),/pending/);
 assert.deepEqual(await storage.loadEvents(),before);assert.deepEqual(await sync.nextBatch(owner),pending);
 await cycle(sync,owner,server);
 assert.deepEqual(await recover([event,nap]),{imported:2,skipped:0});
 const restored=(await sync.nextBatch(owner)).filter(mutation=>mutation.kind==='event');
 assert.equal(restored.length,2);assert.ok(restored.every(mutation=>mutation.intent==='restore'));
 await cycle(sync,owner,server);
 assert.deepEqual((await storage.loadEvents()).map(item=>item.id).sort(),[event.id,nap.id].sort());
 assert.deepEqual(await recover([event,nap]),{imported:0,skipped:2});
 assert.equal((await sync.status('local-pet')).pending,0);
});

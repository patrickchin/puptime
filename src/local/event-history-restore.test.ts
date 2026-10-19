import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test,{type TestContext} from 'node:test';
import {createLocalDatabase,initializeLocalDatabase,type LocalDatabase} from './database.ts';
import {sqliteTestConnection} from './sqlite-test-adapter.ts';
import {createLocalRuntime} from './runtime-factory.ts';
import {reconcileMutation} from '../cloud/reconcile.ts';
import type {CloudRecord} from '../cloud/protocol.ts';

const first={id:'one',type:'pee' as const,at:100,source:'app' as const,note:'First'};
async function setup(t:TestContext){
 const database=await createLocalDatabase(sqliteTestConnection(':memory:'));t.after(()=>database.close());
 await initializeLocalDatabase(database,()=> 'pet-1');let signals=0;
 const local=await createLocalRuntime(database,'pet-1',()=>{signals++;});
 assert.equal(typeof local.history.restore,'function','Historical restoration must use the actual transactional runtime.');
 return {database,local,signals:()=>signals};
}
async function snapshot(database:LocalDatabase){
 return database.read(async sql=>{
  const tables=await sql.getAllAsync<{name:string}>("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
  return Object.fromEntries(await Promise.all(tables.map(async({name})=>[name,await sql.getAllAsync(`SELECT * FROM "${name}" ORDER BY rowid`)])));
 });
}
const category=(wanted:string)=>(error:unknown)=>error instanceof Error&&'category' in error&&error.category===wanted;
async function owned(local:Awaited<ReturnType<typeof createLocalRuntime>>){
 await local.database.write(sql=>sql.execAsync('DELETE FROM routines'));
 await local.storage.savePuppyName('Basil');
 const owner={...await local.sync.prepareAssociation({accountId:'account-1',localPetId:local.petId,deviceId:local.deviceId,enrollment:{operationId:'enroll',deviceId:local.deviceId,localPetId:local.petId,name:'Basil',confirmedPetId:'cloud-1'}}),accountId:'account-1'};
 const remote:CloudRecord={id:'["event","cloud-1","one"]',petId:'cloud-1',kind:'event',revision:1,sequence:2,deleted:false,updatedAt:1000,data:{type:'pee',at:100,source:'app',note:'First'}};
 await local.sync.stageBaseline({...owner,page:{changes:[{id:'cloud-1',petId:'cloud-1',kind:'puppy',revision:1,sequence:1,deleted:false,updatedAt:1000,data:{name:'Basil'}},remote],cursor:2,hasMore:false}});
 await local.sync.completeAssociation({...owner,cloudPetId:'cloud-1'});
 const initial=await local.sync.nextBatch(owner);assert.equal(initial.length,1);assert.equal(initial[0].kind,'accountPreferences');
 const preferences=reconcileMutation(null,initial[0],1500),preferenceRecord={...preferences.record,revision:1,sequence:3};
 await local.sync.applySync({...owner,accepted:[{operationId:initial[0].operationId,record:preferenceRecord,sequence:3,reason:preferences.reason}],rejected:[],page:{changes:[preferenceRecord],cursor:3,hasMore:false}});
 assert.equal((await local.sync.status(local.petId)).pending,0);
 const current={...remote,revision:2,sequence:4,updatedAt:2000,data:{...remote.data,note:'Second'}};
 await local.sync.applySync({...owner,accepted:[],rejected:[],page:{changes:[current],cursor:4,hasMore:false}});
 return {owner,current};
}

test('free historical restoration retains identity and audit versions, emits one committed signal and never queues upload work',async t=>{
 const {database,local,signals}=await setup(t);await local.storage.appendEvents([first]);await local.storage.updateEvent('one',{note:'Second'});
 const page=await local.history.eventPage('one'),selection={source:'local' as const,sequence:page.entries[1].sequence},beforeSignals=signals();
 assert.deepEqual(await local.history.restore({eventId:'one',selection,expected:page.head}),first);
 assert.deepEqual(await local.storage.loadEvents(),[first]);assert.equal(signals(),beforeSignals+1);assert.equal((await local.sync.status('pet-1')).pending,0);
 const after=await local.history.eventPage('one');assert.equal(after.entries.length,3);assert.equal(after.entries[0].source,'restore');assert.deepEqual(after.entries[0].before,{...first,note:'Second'});assert.deepEqual(after.entries[0].after,first);
 const saved=await snapshot(database);await assert.rejects(local.history.restore({eventId:'one',selection,expected:page.head}),category('stale'));assert.deepEqual(await snapshot(database),saved);
 assert.deepEqual(await local.history.restore({eventId:'one',selection,expected:after.head}),first);assert.deepEqual(await snapshot(database),saved);assert.equal(signals(),beforeSignals+1);
});

test('restoring a deleted estimated custom log preserves provenance and does not reactivate its deleted quick action',async t=>{
 const {local}=await setup(t);const custom={id:'one',type:'custom' as const,customLabel:'Training',at:100,source:'widget' as const,note:'First',estimated:false};
 await local.storage.appendEvents([custom]);const initial=(await local.history.eventPage('one')).entries[0];
 await local.storage.appendEvents([{...custom,estimated:true,note:'Estimate'}]);await local.storage.deleteCustomActivity('Training');await local.storage.removeEvent('one');
 const page=await local.history.eventPage('one');assert.equal(page.head.event,null);
 const restored=await local.history.restore({eventId:'one',selection:{source:'local',sequence:initial.sequence},expected:page.head});
 assert.deepEqual(restored,{...custom,estimated:true});assert.deepEqual(await local.storage.loadCustomActivities(),[]);assert.deepEqual(await local.storage.loadEvents(),[{...custom,estimated:true}]);
 const latest=await local.history.eventPage('one');assert.equal(latest.entries[0].source,'restore');assert.equal(latest.entries[0].before,null);assert.equal((await local.sync.status('pet-1')).pending,0);
});

test('record and revision write failures roll back history restoration and keep the same confirmation retryable',async t=>{
 const {database,local,signals}=await setup(t);await local.storage.appendEvents([first]);await local.storage.updateEvent('one',{note:'Second'});
 const page=await local.history.eventPage('one'),input={eventId:'one',selection:{source:'local' as const,sequence:page.entries[1].sequence},expected:page.head};
 for(const trigger of ["AFTER UPDATE ON events WHEN NEW.id='one'","AFTER INSERT ON local_revisions WHEN NEW.source='restore'"]){
  await database.write(sql=>sql.execAsync(`CREATE TRIGGER fail_history ${trigger} BEGIN SELECT RAISE(ABORT,'synthetic history write failure'); END;`));
  const before=await snapshot(database),count=signals();await assert.rejects(local.history.restore(input),/synthetic history write failure/);assert.deepEqual(await snapshot(database),before);assert.equal(signals(),count);
  await database.write(sql=>sql.execAsync('DROP TRIGGER fail_history'));
 }
 assert.deepEqual(await local.history.restore(input),first);
});

test('a bound historical restoration queues exactly one current-revision restore and survives a lost acknowledgment',async t=>{
 const {database,local,signals}=await setup(t),{owner,current}=await owned(local);
 const page=await local.history.eventPage('one'),count=signals();
 assert.deepEqual(await local.history.restore({eventId:'one',selection:{source:'local',sequence:page.entries[1].sequence},expected:page.head}),first);
 const batch=await local.sync.nextBatch(owner);assert.equal(batch.length,1);assert.equal(batch[0].intent,'restore');assert.equal(batch[0].baseRevision,2);assert.equal(batch[0].recordId,'["event","cloud-1","one"]');assert.equal(batch[0].petId,'cloud-1');assert.deepEqual(batch[0].patch,{type:'pee',at:100,source:'app',note:'First'});assert.equal(signals(),count+1);
 const result=reconcileMutation(current,batch[0],3000),record={...result.record,revision:3,sequence:5};
 assert.deepEqual(await local.sync.nextBatch(owner),batch,'A lost reply must retry the exact committed operation.');
 await local.sync.applySync({...owner,accepted:[{operationId:batch[0].operationId,record,sequence:5,reason:result.reason}],rejected:[],page:{changes:[record],cursor:5,hasMore:false}});
 assert.equal((await local.sync.status('pet-1')).pending,0);assert.deepEqual(await local.storage.loadEvents(),[first]);
 assert.equal((await local.history.eventPage('one')).entries.filter(entry=>entry.source==='restore').length,1);
 assert.equal((await database.read(sql=>sql.getFirstAsync<{n:number}>('SELECT COUNT(*) n FROM local_sync_pets')))!.n,1);
});

test('pending log changes and staged baselines reject restoration without discarding any work',async t=>{
 const {database,local}=await setup(t),{owner}=await owned(local);
 await local.storage.updateEvent('one',{note:'Unsynced'});const page=await local.history.eventPage('one');
 let before=await snapshot(database);await assert.rejects(local.history.restore({eventId:'one',selection:{source:'local',sequence:page.entries.at(-1)!.sequence},expected:page.head}),category('pending'));assert.deepEqual(await snapshot(database),before);
 await local.sync.resetBaseline(owner);const staged=await local.history.eventPage('one');before=await snapshot(database);
 await assert.rejects(local.history.restore({eventId:'one',selection:{source:'local',sequence:staged.entries.at(-1)!.sequence},expected:staged.head}),category('pending'));assert.deepEqual(await snapshot(database),before);
});

test('local edits, remote revisions and an owner switch invalidate an older restoration confirmation',async t=>{
 const {database,local}=await setup(t),{owner,current}=await owned(local);
 const page=await local.history.eventPage('one'),input={eventId:'one',selection:{source:'local' as const,sequence:page.entries.at(-1)!.sequence},expected:page.head};
 const later={...current,revision:3,sequence:5,data:{...current.data,note:'New remote'}};
 await local.sync.applySync({...owner,accepted:[],rejected:[],page:{changes:[later],cursor:5,hasMore:false}});
 let before=await snapshot(database);await assert.rejects(local.history.restore(input),category('stale'));assert.deepEqual(await snapshot(database),before);
 const localPage=await local.history.eventPage('one');await local.storage.updateEvent('one',{note:'New local'});before=await snapshot(database);
 await assert.rejects(local.history.restore({...input,expected:localPage.head}),category('stale'));assert.deepEqual(await snapshot(database),before);
 await local.sync.detach(owner);await local.sync.prepareAssociation({accountId:'account-2',localPetId:'pet-1',deviceId:local.deviceId,enrollment:{operationId:'another-owner',deviceId:local.deviceId,localPetId:'pet-1',name:'Basil'}});
 before=await snapshot(database);await assert.rejects(local.history.restore(input),category('stale'));assert.deepEqual(await snapshot(database),before);
});

test('a failed bound outbox insert leaves the current log history and ownership intact',async t=>{
 const {database,local,signals}=await setup(t);await owned(local);const page=await local.history.eventPage('one');
 await database.write(sql=>sql.execAsync("CREATE TRIGGER fail_history_queue AFTER INSERT ON local_sync_outbox WHEN NEW.local_id='one' BEGIN SELECT RAISE(ABORT,'synthetic history queue failure'); END;"));
 const before=await snapshot(database),count=signals();
 await assert.rejects(local.history.restore({eventId:'one',selection:{source:'local',sequence:page.entries.at(-1)!.sequence},expected:page.head}),/synthetic history queue failure/);
 assert.deepEqual(await snapshot(database),before);assert.equal(signals(),count);
 await database.write(sql=>sql.execAsync('DROP TRIGGER fail_history_queue'));
});

test('an unbound second puppy restores locally without joining another puppy queue or accepting its versions',async t=>{
 const {database,local}=await setup(t),{owner}=await owned(local);const primary=await local.history.eventPage('one');
 await database.write(sql=>sql.runAsync("INSERT INTO puppies(id,name) VALUES ('pet-2','Other')"));const other=await createLocalRuntime(database,'pet-2');
 await other.storage.appendEvents([{...first,note:'Other first'}]);await other.storage.updateEvent('one',{note:'Other second'});const page=await other.history.eventPage('one');
 await other.history.restore({eventId:'one',selection:{source:'local',sequence:page.entries[1].sequence},expected:page.head});
 assert.deepEqual(await local.history.eventPage('one'),primary);assert.deepEqual(await local.sync.nextBatch(owner),[]);assert.equal((await other.storage.loadEvents())[0].note,'Other first');
 const before=await snapshot(database);await assert.rejects(other.history.restore({eventId:'one',selection:{source:'local',sequence:primary.entries[0].sequence},expected:(await other.history.eventPage('one')).head}));assert.deepEqual(await snapshot(database),before);
});

test('unavailable deletion snapshots and deferred nap restoration preserve all retained data',async t=>{
 const {database,local}=await setup(t);await local.storage.appendEvents([first]);await local.storage.removeEvent('one');const deleted=await local.history.eventPage('one');
 let before=await snapshot(database);await assert.rejects(local.history.restore({eventId:'one',selection:{source:'local',sequence:deleted.entries[0].sequence},expected:deleted.head}),category('unavailable'));assert.deepEqual(await snapshot(database),before);
 await local.storage.appendEvents([{id:'nap-existing',type:'nap',at:100,endedAt:200,source:'app'}]);const nap=await local.history.eventPage('nap-existing');before=await snapshot(database);
 await assert.rejects(local.history.restore({eventId:'nap-existing',selection:{source:'local',sequence:nap.entries[0].sequence},expected:nap.head}),category('unsupported'));assert.deepEqual(await snapshot(database),before);
});

test('a free restored version survives reopening with the same identity and no pending upload',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'puptime-history-restore-')),path=join(directory,'local.db');let database=await createLocalDatabase(sqliteTestConnection(path));
 t.after(async()=>{await database.close();await rm(directory,{recursive:true,force:true});});await initializeLocalDatabase(database,()=> 'pet-1');
 const local=await createLocalRuntime(database,'pet-1');assert.equal(typeof local.history.restore,'function');await local.storage.appendEvents([first]);await local.storage.updateEvent('one',{note:'Second'});
 const page=await local.history.eventPage('one');await local.history.restore({eventId:'one',selection:{source:'local',sequence:page.entries[1].sequence},expected:page.head});
 await database.close();database=await createLocalDatabase(sqliteTestConnection(path));await initializeLocalDatabase(database,()=>assert.fail('Do not create another puppy.'));const reopened=await createLocalRuntime(database,'pet-1');
 assert.deepEqual(await reopened.storage.loadEvents(),[first]);assert.equal((await reopened.history.eventPage('one')).entries[0].source,'restore');assert.equal((await reopened.sync.status('pet-1')).pending,0);
});

const cloudFirst={recordId:'["event","cloud-1","one"]',revision:1,sequence:2,operationId:'server-first',deviceId:'other-device',acceptedAt:1000,baseRevision:0,intent:'create' as const,proposal:{type:'pee' as const,at:100,source:'app' as const,note:'First'},before:null,after:{id:'["event","cloud-1","one"]',petId:'cloud-1',kind:'event' as const,revision:1,sequence:2,deleted:false,updatedAt:1000,data:{type:'pee' as const,at:100,source:'app' as const,note:'First'}},reason:'created' as const};
test('a cloud-only older version restores against the current mirror without inventing a local version ID',async t=>{
 const {database,local}=await setup(t),{owner}=await owned(local);const before=await local.history.eventPage('one');
 // A freshly restored device can have the current baseline without earlier local snapshots.
 await database.write(sql=>sql.runAsync('DELETE FROM local_revisions WHERE pet_id=? AND kind=? AND local_id=? AND sequence=?','pet-1','event','one',before.entries.at(-1)!.sequence));
 const page=await local.history.eventPage('one');assert.equal(page.entries.length,1);
 assert.deepEqual(await local.history.restore({eventId:'one',selection:{source:'cloud',revision:cloudFirst},expected:page.head}),first);
 const batch=await local.sync.nextBatch(owner);assert.equal(batch.length,1);assert.equal(batch[0].intent,'restore');assert.equal(batch[0].baseRevision,2);assert.equal(batch[0].recordId,'["event","cloud-1","one"]');assert.equal(batch[0].kind,'event');if(batch[0].kind==='event')assert.equal(batch[0].patch.note,'First');
 const after=await local.history.eventPage('one');assert.equal(after.entries[0].source,'restore');assert.ok(after.entries[0].createdAt>2000);
});

test('cloud version scope deletion and stale local or remote views cannot bypass the history restore guard',async t=>{
 const {database,local}=await setup(t),{owner,current}=await owned(local),page=await local.history.eventPage('one');
 for(const revision of [
  {...cloudFirst,recordId:'["event","cloud-1","other"]',after:{...cloudFirst.after,id:'["event","cloud-1","other"]'}},
  {...cloudFirst,after:{...cloudFirst.after,petId:'cloud-2'}},
 ]){const before=await snapshot(database);await assert.rejects(local.history.restore({eventId:'one',selection:{source:'cloud',revision},expected:page.head}));assert.deepEqual(await snapshot(database),before);}
 const deleted={recordId:current.id,revision:3,sequence:5,operationId:'server-delete',deviceId:'other-device',acceptedAt:3000,baseRevision:2,intent:'delete' as const,proposal:{},before:current,after:{...current,revision:3,sequence:5,deleted:true,updatedAt:3000},reason:'deleted' as const};
 let before=await snapshot(database);await assert.rejects(local.history.restore({eventId:'one',selection:{source:'cloud',revision:deleted},expected:page.head}),category('unavailable'));assert.deepEqual(await snapshot(database),before);
 const newer={...current,revision:3,sequence:5,updatedAt:3000,data:{...current.data,note:'New remote'}};
 await local.sync.applySync({...owner,accepted:[],rejected:[],page:{changes:[newer],cursor:5,hasMore:false}});before=await snapshot(database);
 await assert.rejects(local.history.restore({eventId:'one',selection:{source:'cloud',revision:cloudFirst},expected:page.head}),category('stale'));assert.deepEqual(await snapshot(database),before);
 const fresh=await local.history.eventPage('one');await local.storage.updateEvent('one',{note:'New local'});before=await snapshot(database);
 await assert.rejects(local.history.restore({eventId:'one',selection:{source:'cloud',revision:cloudFirst},expected:fresh.head}),category('stale'));assert.deepEqual(await snapshot(database),before);
});

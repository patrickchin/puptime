import assert from 'node:assert/strict';
import test from 'node:test';
import { createLocalDatabase,initializeLocalDatabase } from './database.ts';
import { sqliteTestConnection } from './sqlite-test-adapter.ts';
import * as runtime from './runtime-factory.ts';
async function database() {const db=await createLocalDatabase(sqliteTestConnection(':memory:'));await initializeLocalDatabase(db,()=> 'pet-1');await db.write(sql=>sql.runAsync('DELETE FROM routines'));return db;}

test('the local runtime shares the storage transaction and engine, retaining free revisions without upload work',async t=>{
 const db=await database();t.after(()=>db.close());let signals=0;
 assert.equal(typeof runtime.createLocalRuntime,'function');
 const local=await runtime.createLocalRuntime(db,'pet-1',()=>{signals++;});
 assert.equal(local.database,db);assert.equal(local.petId,'pet-1');assert.match(local.deviceId,/^dev_[a-f0-9]{32}$/);
 await local.storage.appendEvents([{id:'one',type:'pee',at:100,source:'app'}]);assert.equal(signals,1);
 assert.equal((await local.sync.status('pet-1')).state,'local');assert.equal((await local.sync.status('pet-1')).pending,0);
 assert.equal((await db.read(sql=>sql.getFirstAsync<{n:number}>('SELECT COUNT(*) n FROM local_revisions')))!.n,1);
 const another=await runtime.createLocalRuntime(db,'pet-1');assert.equal(another.deviceId,local.deviceId);
});

test('one changed record creates one revision and upload while no-ops and failed outbox commits create neither',async t=>{
 const db=await database();t.after(()=>db.close());let signals=0;
 const local=await runtime.createLocalRuntime(db,'pet-1',()=>{signals++;});
 const owner={...await local.sync.prepareAssociation({accountId:'account-1',localPetId:'pet-1',deviceId:local.deviceId,enrollment:{operationId:'enrollment',deviceId:local.deviceId,localPetId:'pet-1',name:'My puppy'}}),accountId:'account-1'};
 await local.sync.stageBaseline({...owner,page:{changes:[],cursor:0,hasMore:false}});await local.sync.completeAssociation({...owner,cloudPetId:'pet-1'});
 const counts=()=>db.read(async sql=>({revisions:(await sql.getFirstAsync<{n:number}>('SELECT COUNT(*) n FROM local_revisions'))!.n,pending:(await sql.getFirstAsync<{n:number}>('SELECT COUNT(*) n FROM local_sync_outbox'))!.n}));
 const before=await counts(),event={id:'one',type:'pee' as const,at:100,source:'app' as const};
 await local.storage.appendEvents([event]);
 const created={revisions:before.revisions+1,pending:before.pending+1};assert.deepEqual(await counts(),created);assert.equal(signals,1);
 await local.storage.updateEvent('one',{at:100});await local.storage.appendEvents([event]);await local.storage.removeEvent('missing');
 assert.deepEqual(await counts(),created);assert.equal(signals,1);
 await db.write(sql=>sql.execAsync("CREATE TRIGGER fail_pending AFTER INSERT ON local_sync_outbox WHEN NEW.local_id='one' BEGIN SELECT RAISE(ABORT,'synthetic queue failure'); END;"));
 await assert.rejects(local.storage.updateEvent('one',{note:'must roll back'}),/queue failure/);
 assert.deepEqual(await local.storage.loadEvents(),[event]);assert.deepEqual(await counts(),created);assert.equal(signals,1);
 await db.write(sql=>sql.execAsync('DROP TRIGGER fail_pending'));
 await local.storage.updateEvent('one',{note:'saved'});
 assert.deepEqual(await counts(),{revisions:created.revisions+1,pending:created.pending+1});assert.equal(signals,2);
 assert.deepEqual((await local.sync.nextBatch(owner)).at(-1)!.patch,{note:'saved'});
 await local.storage.removeEvent('one');const deleted=await counts();assert.equal(signals,3);
 await local.storage.removeEvent('one');await assert.rejects(local.storage.updateEvent('one',{note:'stale draft'}),/deleted/i);
 assert.deepEqual(await counts(),deleted);assert.equal(signals,3);
});

test('an invalid retained device identity fails without silently changing history or assigning a new identity',async t=>{
 const db=await database();t.after(()=>db.close());assert.equal(typeof runtime.createLocalRuntime,'function');
 await db.write(async sql=>{await sql.runAsync("INSERT INTO metadata(key,value) VALUES ('cloud_device_id','broken device id')");await sql.runAsync("INSERT INTO events(pet_id,id,type,at,source) VALUES ('pet-1','one','pee',100,'app')");});
 await assert.rejects(runtime.createLocalRuntime(db,'pet-1'));
 assert.equal((await db.read(sql=>sql.getFirstAsync<{value:string}>("SELECT value FROM metadata WHERE key='cloud_device_id'")))!.value,'broken device id');
 assert.equal((await db.read(sql=>sql.getFirstAsync<{n:number}>('SELECT COUNT(*) n FROM events')))!.n,1);
});

test('a cloud-deleted routine rejects an old draft without a local resurrection or new upload',async t=>{
 const db=await database();t.after(()=>db.close());const local=await runtime.createLocalRuntime(db,'pet-1');
 const original={id:'routine',type:'walk' as const,minutes:480,reminder:false};await local.storage.saveSchedule([original]);
 const owner={...await local.sync.prepareAssociation({accountId:'account-1',localPetId:'pet-1',deviceId:local.deviceId,enrollment:{operationId:'enrollment',deviceId:local.deviceId,localPetId:'pet-1',name:'My puppy'}}),accountId:'account-1'};
 await local.sync.stageBaseline({...owner,page:{changes:[],cursor:0,hasMore:false}});await local.sync.completeAssociation({...owner,cloudPetId:'pet-1'});
 const {reconcileMutation}=await import('../cloud/reconcile.ts');let sequence=0;
 const accepted=(await local.sync.nextBatch(owner)).map(mutation=>{const reconciled=reconcileMutation(null,mutation,1000);const record={...reconciled.record,revision:1,sequence:++sequence};return {operationId:mutation.operationId,record,sequence:record.sequence,reason:reconciled.reason};});
 await local.sync.applySync({...owner,accepted,rejected:[],page:{changes:accepted.map(item=>item.record),cursor:sequence,hasMore:false}});
 const routine=accepted.find(item=>item.record.kind==='routine')!.record;
 await local.sync.applySync({...owner,accepted:[],rejected:[],page:{changes:[{...routine,deleted:true,revision:2,sequence:++sequence}],cursor:sequence,hasMore:false}});
 assert.deepEqual(await local.storage.loadSchedule(),[]);
 await assert.rejects(local.storage.saveScheduleEntry({...original,minutes:545},original),/removed/i);
 assert.deepEqual(await local.storage.loadSchedule(),[]);assert.equal((await local.sync.status('pet-1')).pending,0);
});


test('shared offline storage keeps preferences personal and rejects edits to other carers, profile changes and expired access atomically',async t=>{
 const db=await database();t.after(()=>db.close());
 const access={kind:'temporary' as const,permission:'contribute' as const,expiresAt:Date.now()+60000};
 const local=await runtime.createLocalRuntime(db,'pet-1',undefined,undefined,access);
 const fence={...await local.sync.prepareAssociation({accountId:'member',localPetId:'pet-1',deviceId:local.deviceId,enrollment:{operationId:'enrollment',deviceId:local.deviceId,localPetId:'pet-1',name:'My puppy'}}),accountId:'member'};
 const other={id:JSON.stringify(['event','pet-1','other']),petId:'pet-1',kind:'event' as const,revision:1,sequence:1,deleted:false,updatedAt:100,editable:false,data:{type:'pee' as const,at:100,source:'app' as const}};
 await local.sync.stageBaseline({...fence,page:{changes:[other],cursor:1,hasMore:false}});await local.sync.completeAssociation({...fence,cloudPetId:'pet-1'});
 const baseline=(await local.sync.status('pet-1')).pending;
 await local.storage.saveThemePreference('dark');await local.storage.saveWidgetActions(['pee','meal']);
 assert.equal((await local.sync.status('pet-1')).pending,baseline);
 await assert.rejects(local.storage.updateEvent('other',{note:'not mine'}),/own logs/);
 await assert.rejects(local.storage.savePuppyName('Changed'),/access does not allow/);
 await local.storage.appendEvents([{id:'mine',type:'walk',at:200,source:'app'}]);await local.storage.updateEvent('mine',{note:'offline correction'});
 assert.equal((await local.sync.status('pet-1')).pending,baseline+2);
 await assert.rejects(local.storage.saveScheduleEntry({id:'routine',type:'meal',minutes:500}),/access does not allow/);
 access.expiresAt=Date.now()-1;
 await assert.rejects(local.storage.appendEvents([{id:'late',type:'walk',at:300,source:'widget'}]),/access.*ended/i);
 assert.deepEqual((await local.storage.loadEvents()).map(event=>event.id).sort(),['mine','other']);
});

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
 assert.equal(local.database,db);assert.equal(local.petId,'pet-1');assert.match(local.deviceId,/^[a-f0-9]{32}$/);
 await local.storage.appendEvents([{id:'one',type:'pee',at:100,source:'app'}]);assert.equal(signals,1);
 assert.equal((await local.sync.status('pet-1')).state,'local');assert.equal((await local.sync.status('pet-1')).pending,0);
 assert.equal((await db.read(sql=>sql.getFirstAsync<{n:number}>('SELECT COUNT(*) n FROM local_revisions')))!.n,1);
 const another=await runtime.createLocalRuntime(db,'pet-1');assert.equal(another.deviceId,local.deviceId);
});

test('an invalid retained device identity fails without silently changing history or assigning a new identity',async t=>{
 const db=await database();t.after(()=>db.close());assert.equal(typeof runtime.createLocalRuntime,'function');
 await db.write(async sql=>{await sql.runAsync("INSERT INTO metadata(key,value) VALUES ('cloud_device_id','broken device id')");await sql.runAsync("INSERT INTO events(pet_id,id,at,body) VALUES ('pet-1','one',100,?)",JSON.stringify({id:'one',type:'pee',at:100,source:'app'}));});
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

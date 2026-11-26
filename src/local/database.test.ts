import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import {createLocalDatabase,initializeLocalDatabase as initialize,type SqlConnection} from './database.ts';
import { sqliteTestConnection } from './sqlite-test-adapter.ts';
import { STARTER_SCHEDULE } from '../domain.ts';
import {createLocalRuntime} from './runtime-factory.ts';

async function setup(t:TestContext,wrap=(connection:SqlConnection)=>connection) {
  const directory=await mkdtemp(join(tmpdir(),'puptime-initialize-'));
  const path=join(directory,'data.db');
  const database=await createLocalDatabase(wrap(sqliteTestConnection(path)));
  t.after(async()=>{await database.close();await rm(directory,{recursive:true,force:true});});
  return {database,path};
}
async function snapshot(database:Awaited<ReturnType<typeof createLocalDatabase>>) {
  return database.read(async sql=>{
    const schema=await sql.getAllAsync<{name:string;sql:string}>("SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
    const rows:Record<string,Record<string,unknown>[]>=Object.fromEntries(await Promise.all(schema.map(async({name})=>[name,(await sql.getAllAsync<Record<string,unknown>>(`SELECT * FROM "${name.replaceAll('"','""')}" ORDER BY rowid`)).map(row=>({...row}))])));
    return {schema,rows};
  });
}

test('direct initialization is atomic and reopens without reseeding',async t=>{
  const {database,path}=await setup(t);
  assert.deepEqual(await initialize(database,()=> 'pet-1'),{petId:'pet-1'});
  const initial=await snapshot(database);
  assert.equal(initial.rows.puppies.length,1);
  assert.deepEqual(initial.rows.puppies,[{id:'pet-1',name:'My puppy'}]);
  assert.equal(initial.rows.routines.length,STARTER_SCHEDULE.length);
  assert.ok(initial.rows.metadata.some(row=>(row as {key:string;value:string}).key==='schema_version'&&(row as {value:string}).value==='4'));
  assert.ok(initial.rows.metadata.some(row=>(row as {key:string;value:string}).key==='show_onboarding'&&(row as {value:string}).value==='true'));
  assert.ok(!initial.schema.some(row=>row.name==='legacy_snapshots'));
  assert.ok(!initial.rows.metadata.some(row=>(row as {key:string}).key==='migration_complete'));
  await database.write(async sql=>{
    await sql.runAsync('UPDATE puppies SET name=? WHERE id=?','Biscuit','pet-1');
    await sql.runAsync("UPDATE metadata SET value='false' WHERE key='show_onboarding'");
    await sql.runAsync('INSERT INTO settings(key,value) VALUES (?,?)','puptime.theme.v1','soft-play');
  });
  const before=await snapshot(database),reopened=await createLocalDatabase(sqliteTestConnection(path));
  try{
    assert.deepEqual(await initialize(reopened,()=>{throw new Error('Reopen must not generate another ID');}),{petId:'pet-1'});
    assert.deepEqual(await snapshot(reopened),before);
  }finally{await reopened.close();}
});

test('fresh SQL initialization mints one prefixed puppy identity and retains it on reopen',async t=>{
 const {database,path}=await setup(t),first=await initialize(database);
 assert.match(first.petId,/^pet_[a-f0-9]{32}$/);
 const reopened=await createLocalDatabase(sqliteTestConnection(path));
 try {assert.deepEqual(await initialize(reopened),first);}finally{await reopened.close();}
});

test('released pre-checkpoint journals reopen without changing activity, sync state or saved choices',async t=>{
 for(const completed of [true,false]){
  const {database,path}=await setup(t);
  const {petId}=await initialize(database,()=> 'pet_upgrade');
  const runtime=await createLocalRuntime(database,petId);
  if(completed)await runtime.storage.completeOnboarding({puppyName:'Biscuit'});
  await runtime.storage.appendEvents(Array.from({length:1000},(_,i)=>({id:`evt_upgrade_${i}`,type:'pee',at:1000+i,source:'app',note:`Keep ${i}`})));
  const accountId='acct_upgrade';
  const {generation}=await runtime.sync.prepareAssociation({accountId,localPetId:petId,deviceId:runtime.deviceId,enrollment:{operationId:'enr_upgrade',deviceId:runtime.deviceId,localPetId:petId,name:'Biscuit'}});
  await runtime.sync.stageBaseline({generation,accountId,page:{changes:[],cursor:0,hasMore:false}});
  await runtime.sync.completeAssociation({generation,accountId,cloudPetId:petId});
  await database.write(sql=>sql.runAsync("DELETE FROM metadata WHERE key IN ('first_launch_step','notify_on_device')"));
  const before=await snapshot(database);
  const reopened=await createLocalDatabase(sqliteTestConnection(path));
  try{
   assert.deepEqual(await initialize(reopened),{petId});
   const after=await snapshot(reopened);
   const added=after.rows.metadata.filter(row=>!before.rows.metadata.some(old=>old.key===row.key));
   assert.deepEqual(added,[{key:'first_launch_step',value:completed?'done':'welcome'},{key:'notify_on_device',value:'false'}]);
   after.rows.metadata=after.rows.metadata.filter(row=>before.rows.metadata.some(old=>old.key===row.key));
   assert.deepEqual(after,before);
   const next=await createLocalRuntime(reopened,petId);
   assert.equal((await next.storage.loadEvents()).length,1000);
   assert.equal((await next.storage.loadFirstLaunch())?.step??null,completed?null:'welcome');
   assert.equal(await next.storage.loadNotificationDelivery(),false);
   await next.storage.saveNotificationDelivery(true);
   const saved=await snapshot(reopened);
   await initialize(reopened);assert.deepEqual(await snapshot(reopened),saved);
  }finally{await reopened.close();}
 }
});

test('upgrade metadata repair rolls back on failure and preserves invalid saved values',async t=>{
 const {database}=await setup(t);await initialize(database,()=> 'pet_upgrade');
 await database.write(sql=>sql.execAsync("DELETE FROM metadata WHERE key IN ('first_launch_step','notify_on_device'); CREATE TRIGGER fail_delivery_upgrade BEFORE INSERT ON metadata WHEN NEW.key='notify_on_device' BEGIN SELECT RAISE(ABORT,'upgrade failure'); END;"));
 const before=await snapshot(database);
 await assert.rejects(initialize(database),/upgrade failure/);
 assert.deepEqual(await snapshot(database),before);
 await database.write(sql=>sql.execAsync("DROP TRIGGER fail_delivery_upgrade; INSERT INTO metadata VALUES ('first_launch_step','unknown'),('notify_on_device','invalid');"));
 const invalid=await snapshot(database);
 await initialize(database);assert.deepEqual(await snapshot(database),invalid);
 const {storage}=await createLocalRuntime(database,'pet_upgrade');
 await assert.rejects(storage.loadFirstLaunch());await assert.rejects(storage.loadNotificationDelivery());
});

test('initialization failure rolls back and retries',async t=>{
  let inject=true;
  const {database}=await setup(t,connection=>({...connection,async execAsync(sql){
    await connection.execAsync(sql);
    if(inject&&/CREATE TABLE IF NOT EXISTS routines/.test(sql)){
      inject=false;
      await connection.execAsync("CREATE TRIGGER fail_initial_starter BEFORE INSERT ON routines WHEN NEW.id='starter-2' BEGIN SELECT RAISE(ABORT,'initial storage failure'); END;");
    }
  }}));
  await assert.rejects(initialize(database,()=> 'pet-1'),/initial storage failure/);
  assert.deepEqual((await snapshot(database)).schema,[],'DDL and partially inserted puppy/routine must roll back together.');
  assert.deepEqual(await initialize(database,()=> 'pet-1'),{petId:'pet-1'});
  const saved=await snapshot(database);
  assert.equal(saved.rows.puppies.length,1);assert.equal(saved.rows.routines.length,STARTER_SCHEDULE.length);
});

test('separate initializers choose one puppy',async t=>{
  const {database,path}=await setup(t),other=await createLocalDatabase(sqliteTestConnection(path));
  try{
    const results=await Promise.all([initialize(database,()=> 'pet-first'),initialize(other,()=> 'pet-second')]);
    assert.equal(results[0].petId,results[1].petId);
    const saved=await snapshot(database);
    assert.equal(saved.rows.puppies.length,1);assert.equal(saved.rows.routines.length,STARTER_SCHEDULE.length);
  }finally{await other.close();}
});

test('unsupported or incomplete database is unchanged',async t=>{
  const {database}=await setup(t);
  await database.write(sql=>sql.execAsync("CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE development_rows(id INTEGER PRIMARY KEY,note TEXT); INSERT INTO metadata VALUES ('schema_version','3'); INSERT INTO development_rows VALUES(1,'preserve development data');"));
  const old=await snapshot(database);
  await assert.rejects(initialize(database),/unsupported|development/i);
  assert.deepEqual(await snapshot(database),old,'Version rejection must precede new DDL or data changes.');
  await database.write(sql=>sql.execAsync('DROP TABLE development_rows; DROP TABLE metadata;'));
  await initialize(database,()=> 'pet-1');
  await database.write(sql=>sql.runAsync("UPDATE metadata SET value='999' WHERE key='schema_version'"));
  const newer=await snapshot(database);
  await assert.rejects(initialize(database),/unsupported|newer/i);assert.deepEqual(await snapshot(database),newer);
  await database.write(async sql=>{
    await sql.runAsync("UPDATE metadata SET value='4' WHERE key='schema_version'");
    await sql.runAsync("DELETE FROM metadata WHERE key='active_pet_id'");
  });
  const incomplete=await snapshot(database);
  await assert.rejects(initialize(database),/incomplete|active puppy/i);assert.deepEqual(await snapshot(database),incomplete);
});

test('foreign keys and pet-scoped IDs apply on the configured transaction connection',async t=>{
  const {database}=await setup(t);await initialize(database,()=> 'pet-1');
  const event={id:'same',type:'pee',at:100,source:'app'};
  await assert.rejects(database.write(sql=>sql.runAsync('INSERT INTO events(pet_id,id,type,at,source) VALUES(?,?,?,?,?)','missing-pet',event.id,event.type,event.at,event.source)),/FOREIGN KEY/);
  await database.write(async sql=>{
    await sql.runAsync('INSERT INTO puppies(id,name) VALUES (?,?)','pet-2','Second');
    for(const petId of ['pet-1','pet-2'])await sql.runAsync('INSERT INTO events(pet_id,id,type,at,source) VALUES(?,?,?,?,?)',petId,event.id,event.type,event.at,event.source);
  });
  assert.equal((await database.read(sql=>sql.getFirstAsync<{n:number}>('SELECT COUNT(*) n FROM events WHERE id=?',event.id)))!.n,2);
});

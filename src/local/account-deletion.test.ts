import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test,{type TestContext} from 'node:test';
import {createLocalDatabase,initializeLocalDatabase,type LocalDatabase} from './database.ts';
import {sqliteTestConnection} from './sqlite-test-adapter.ts';
import {createAccountDeletion} from './account-deletion.ts';
import {createLocalRuntime} from './runtime-factory.ts';

const receipt='A'.repeat(43),replacement='B'.repeat(42)+'E';
const input={accountId:'account-1',generation:'generation-1',receipt,expiresAt:5000};
const localTables=['metadata','puppies','events','routines','settings','pet_settings','local_revisions'];
const syncTables=['local_sync_owner','local_sync_pets','local_sync_outbox','local_sync_records','local_sync_acks','local_sync_baseline'];
async function snapshot(db:LocalDatabase,tables:string[]) {
  return db.read(async sql=>Object.fromEntries(await Promise.all(tables.map(async name=>[name,(await sql.getAllAsync(`SELECT * FROM ${name} ORDER BY rowid`)).map(row=>({...row as object}))]))));
}
async function fixture(t:TestContext) {
  const directory=await mkdtemp(join(tmpdir(),'puptime-account-deletion-')),path=join(directory,'local.db');
  let db=await createLocalDatabase(sqliteTestConnection(path));
  await initializeLocalDatabase(db,()=> 'pet-1');
  t.after(async()=>{await db.close();await rm(directory,{recursive:true,force:true});});
  const api=()=>createAccountDeletion(db,{now:()=>1000});
  async function reopen() {
    await db.close();db=await createLocalDatabase(sqliteTestConnection(path));
    await initializeLocalDatabase(db,()=>assert.fail('Reopen must retain the original puppy.'));
    return api();
  }
  await db.write(async sql=>{
    await sql.runAsync("INSERT INTO puppies(id,name) VALUES ('pet-2','Clover')");
    for(const pet of ['pet-1','pet-2']) {
      await sql.runAsync("INSERT INTO events(pet_id,id,type,at,source,note) VALUES (?,'event-1','pee',100,'app','kept history')",pet);
      await sql.runAsync("INSERT INTO pet_settings(pet_id,key,value) VALUES (?,'custom-activity','Test')",pet);
      await sql.runAsync("INSERT INTO local_revisions(pet_id,kind,local_id,before_data,after_data,created_at,source) VALUES (?,'event','event-1',NULL,'{}',100,'local')",pet);
    }
    await sql.runAsync("INSERT INTO settings(key,value) VALUES ('theme','day-trails')");
  });
  async function enroll() {
    await db.write(async sql=>{
      await sql.runAsync("INSERT INTO local_sync_owner(singleton,generation,account_id,device_id,pending_pet_id) VALUES (1,'generation-1','account-1','device-1','pet-2')");
      await sql.runAsync("INSERT INTO local_sync_pets(pet_id,generation,cloud_pet_id,enrollment,status) VALUES ('pet-2','generation-1','cloud-pet-2','{}','preparing')");
      await sql.runAsync("INSERT INTO local_sync_outbox(operation_id,generation,local_pet_id,local_kind,local_id,change_json) VALUES ('operation-1','generation-1','pet-2','event','event-1','{}')");
      await sql.runAsync("INSERT INTO local_sync_records(generation,record_id,body) VALUES ('generation-1','record-1','{}')");
      await sql.runAsync("INSERT INTO local_sync_acks(generation,operation_id,local_sequence,mutation_json,result_json) VALUES ('generation-1','ack-1',1,'{}','{}')");
      await sql.runAsync("INSERT INTO local_sync_baseline(generation,record_id,body) VALUES ('generation-1','record-1','{}')");
      await sql.runAsync("INSERT INTO metadata(key,value) VALUES ('pending_restore_operation','restore-1')");
    });
  }
  return {get db(){return db;},api,reopen,enroll};
}

test('supported schema 4 gains only the typed deletion table without resetting any existing data',async t=>{
  const f=await fixture(t);await f.enroll();
  await f.db.write(sql=>sql.execAsync('DROP TABLE local_account_deletion'));
  const old=await snapshot(f.db,[...localTables,...syncTables,'sqlite_sequence']);
  await f.reopen();
  assert.deepEqual(await snapshot(f.db,[...localTables,...syncTables,'sqlite_sequence']),old);
  const schema=await f.db.read(sql=>sql.getFirstAsync<{sql:string}>("SELECT sql FROM sqlite_master WHERE name='local_account_deletion'"));
  assert.ok(schema);assert.doesNotMatch(schema.sql,/JSON|REFERENCES/i);
  assert.equal((await f.db.read(sql=>sql.getFirstAsync<{value:string}>("SELECT value FROM metadata WHERE key='schema_version'")))!.value,'4');
  assert.equal(await f.api().read(),null);assert.equal(await f.api().readNotice(),null);
});

test('every deletion phase survives disk reopen and completion preserves both puppies and local history',async t=>{
  const f=await fixture(t);await f.enroll();
  const beforeLocal=await snapshot(f.db,localTables.filter(name=>name!=='metadata')),beforeSync=await snapshot(f.db,syncTables);
  const runtime=await createLocalRuntime(f.db,'pet-1');
  assert.equal((await runtime.sync.status('pet-1')).accountId,null,'Active puppy is unbound.');
  assert.deepEqual(await runtime.deletion.owner(),{accountId:'account-1',generation:'generation-1'},'Deletion uses the global owner on the other puppy.');
  const prepared=await f.api().save(input,null);
  assert.deepEqual(prepared,{...input,savedAt:1000,phase:'prepared',appleRevocation:null});
  assert.deepEqual(await (await f.reopen()).read(),prepared);
  await f.api().markDispatched(receipt);await f.reopen();
  assert.equal((await f.api().read())!.phase,'dispatched');
  await assert.rejects(f.api().complete(receipt),/not been acknowledged/);
  assert.deepEqual(await snapshot(f.db,syncTables),beforeSync,'An uncertain response retains the complete outbox and owner.');
  await f.api().acknowledge(receipt,'manual');await f.reopen();
  assert.equal((await f.api().read())!.appleRevocation,'manual');
  assert.deepEqual(await snapshot(f.db,syncTables),beforeSync,'Acknowledgment alone has not detached anything.');
  await f.api().complete(receipt);await f.reopen();
  assert.equal(await f.api().read(),null);assert.equal(await f.api().owner(),null);
  assert.deepEqual(await f.api().readNotice(),{appleRevocation:'manual'});
  for(const rows of Object.values(await snapshot(f.db,syncTables)))assert.deepEqual(rows,[],'Only the former owner sync association is cleared.');
  assert.deepEqual(await snapshot(f.db,localTables.filter(name=>name!=='metadata')),beforeLocal);
  const metadata=await f.db.read(sql=>sql.getAllAsync<{key:string;value:string}>('SELECT key,value FROM metadata'));
  assert.ok(!metadata.some(row=>row.key==='pending_restore_operation'));
  assert.ok(!JSON.stringify(metadata).includes(receipt));assert.ok(!JSON.stringify(metadata).includes('account-1'));
  await f.api().dismissNotice();await f.reopen();assert.equal(await f.api().readNotice(),null);
});

test('save compares the expected receipt and original owner before explicitly replacing a pending intent',async t=>{
  const f=await fixture(t);await f.enroll();await f.api().save(input,null);
  const saved=await f.api().read();
  for(const [next,expected] of [
    [{...input,receipt:replacement},null],
    [{...input,receipt:replacement},replacement],
    [{...input,accountId:'account-2',receipt:replacement},receipt],
    [{...input,generation:null,receipt:replacement},receipt],
    [input,receipt],
  ] as const)await assert.rejects(f.api().save(next,expected));
  assert.deepEqual(await f.api().read(),saved);
  await f.api().markDispatched(receipt);
  await f.api().save({...input,receipt:replacement},receipt);
  assert.equal((await f.api().read())!.receipt,replacement);
  assert.equal((await f.api().read())!.phase,'prepared');
  await assert.rejects(f.api().acknowledge(receipt,'manual'),/changed/);
  await assert.rejects(f.api().markDispatched(receipt),/changed/);
  await assert.rejects(f.api().cancelPrepared(receipt),/changed/);
  await f.api().markDispatched(replacement);await f.api().acknowledge(replacement,'revoked');
  await assert.rejects(f.api().save(input,replacement),/cannot be replaced/);
  await assert.rejects(f.api().acknowledge(replacement,'manual'),/changed/);
});

test('all transitions reject changed generation, wrong owner, and null-owner enrollment races without losing intent',async t=>{
  const f=await fixture(t);await f.enroll();await f.api().save(input,null);
  await f.api().markDispatched(receipt);await f.api().acknowledge(receipt,'not-linked');
  for(const update of ["UPDATE local_sync_owner SET account_id='account-2'","UPDATE local_sync_owner SET generation='generation-2'"]) {
    if(update.includes('generation'))await f.db.write(sql=>sql.execAsync('DELETE FROM local_sync_owner'));
    if(update.includes('generation'))await f.db.write(sql=>sql.runAsync("INSERT INTO local_sync_owner(singleton,generation,account_id,device_id) VALUES (1,'generation-2','account-1','device-1')"));
    else await f.db.write(sql=>sql.execAsync(update));
    const before=await snapshot(f.db,[...localTables,...syncTables,'local_account_deletion']);
    for(const action of [()=>f.api().complete(receipt),()=>f.api().acknowledge(receipt,'not-linked'),()=>f.api().markDispatched(receipt),()=>f.api().cancelPrepared(receipt),()=>f.api().save({...input,receipt:replacement},receipt)])await assert.rejects(action(),/changed|replaced/);
    assert.deepEqual(await snapshot(f.db,[...localTables,...syncTables,'local_account_deletion']),before);
  }
  const nullFixture=await fixture(t),local={...input,generation:null};
  await nullFixture.api().save(local,null);await nullFixture.enroll();
  const before=await nullFixture.api().read();
  await assert.rejects(nullFixture.api().markDispatched(receipt),/owner changed/);
  await assert.rejects(nullFixture.api().cancelPrepared(receipt),/owner changed/);
  assert.deepEqual(await nullFixture.api().read(),before);
  await assert.rejects(f.api().save({...input,generation:null,receipt:replacement},receipt));
});

test('cancel clears only prepared intent, and an unenrolled acknowledged deletion can complete',async t=>{
  const f=await fixture(t),local={...input,generation:null},before=await snapshot(f.db,[...localTables,...syncTables]);
  await f.api().save(local,null);await assert.rejects(f.api().acknowledge(receipt,'manual'));
  await f.api().cancelPrepared(receipt);assert.equal(await f.api().read(),null);
  assert.deepEqual(await snapshot(f.db,[...localTables,...syncTables]),before);
  await f.api().save(local,null);await f.api().markDispatched(receipt);
  await assert.rejects(f.api().cancelPrepared(receipt));
  await f.api().acknowledge(receipt,'not-linked');await assert.rejects(f.api().cancelPrepared(receipt));
  await f.api().complete(receipt);assert.deepEqual(await f.api().readNotice(),{appleRevocation:'not-linked'});
});

test('a SQL failure after owner deletion rolls back the whole detach and leaves acknowledged recovery durable',async t=>{
  const f=await fixture(t);await f.enroll();await f.api().save(input,null);await f.api().markDispatched(receipt);await f.api().acknowledge(receipt,'manual');
  await f.db.write(sql=>sql.execAsync("CREATE TRIGGER fail_deletion_notice BEFORE INSERT ON metadata WHEN NEW.key='account_deletion_notice' BEGIN SELECT RAISE(ABORT,'notice disk failure'); END;"));
  const before=await snapshot(f.db,[...localTables,...syncTables,'local_account_deletion']);
  await assert.rejects(f.api().complete(receipt),/notice disk failure/);
  assert.deepEqual(await snapshot(f.db,[...localTables,...syncTables,'local_account_deletion']),before);
  await f.reopen();assert.equal((await f.api().read())!.phase,'acknowledged');
  await f.db.write(sql=>sql.execAsync('DROP TRIGGER fail_deletion_notice'));await f.api().complete(receipt);
  assert.equal(await f.api().read(),null);assert.deepEqual(await f.api().readNotice(),{appleRevocation:'manual'});
});

test('malformed capabilities, expired preparation and invalid outcomes cannot mutate storage',async t=>{
  const f=await fixture(t);const local={...input,generation:null};
  for(const invalid of [
    {...local,receipt:'A'.repeat(42)}, {...local,receipt:'A'.repeat(42)+'B'},
    {...local,receipt:'!'.repeat(43)}, {...local,expiresAt:1000},
    {...local,accountId:'wrong owner'}, {...local,generation:'wrong generation'},
  ])await assert.rejects(f.api().save(invalid,null));
  assert.equal(await f.api().read(),null);
  await f.api().save(local,null);await f.api().markDispatched(receipt);
  await assert.rejects(f.api().acknowledge(receipt,'unknown' as never));
  assert.equal((await f.api().read())!.phase,'dispatched');
});

test('separate SQLite connections cannot overwrite a simultaneously saved intent',async t=>{
  const f=await fixture(t);
  const path=(await f.db.read(sql=>sql.getAllAsync<{name:string;file:string}>('PRAGMA database_list'))).find(row=>row.name==='main')!.file;
  const other=await createLocalDatabase(sqliteTestConnection(path));t.after(()=>other.close());
  const second=createAccountDeletion(other,{now:()=>1000});
  const results=await Promise.allSettled([
    f.api().save({...input,generation:null},null),
    second.save({...input,generation:null,receipt:replacement},null),
  ]);
  assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
  assert.equal(results.filter(result=>result.status==='rejected').length,1);
  assert.deepEqual(await f.api().read(),await second.read());
});

test('silent SQL rejection cannot detach the owner or notify listeners as a successful completion',async t=>{
  const f=await fixture(t);await f.enroll();let notifications=0;
  const deletion=createAccountDeletion(f.db,{now:()=>1000,afterCommit:()=>{notifications++;}});
  await deletion.save(input,null);await deletion.markDispatched(receipt);await deletion.acknowledge(receipt,'revoked');
  assert.equal(notifications,3);
  await f.db.write(sql=>sql.execAsync("CREATE TRIGGER ignore_deletion_completion BEFORE DELETE ON local_account_deletion BEGIN SELECT RAISE(IGNORE); END;"));
  const before=await snapshot(f.db,[...localTables,...syncTables,'local_account_deletion']);
  await assert.rejects(deletion.complete(receipt),/changed/);
  assert.equal(notifications,3,'A rolled-back completion must not publish success.');
  assert.deepEqual(await snapshot(f.db,[...localTables,...syncTables,'local_account_deletion']),before);
  await f.db.write(sql=>sql.execAsync('DROP TRIGGER ignore_deletion_completion'));await deletion.complete(receipt);
  assert.equal(notifications,4);
});

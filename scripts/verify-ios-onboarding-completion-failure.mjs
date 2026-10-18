// Real installed Release completion failure/retry, with an actual SQLite abort.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {cpSync,mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createLocalDatabase} from '../src/local/database.ts';
import {sqliteTestConnection} from '../src/local/sqlite-test-adapter.ts';
import {createLocalRuntime} from '../src/local/runtime-factory.ts';

const udid=process.argv[2],app='com.patrickchin.puptime';
const simctl=(...args)=>execFileSync('xcrun',['simctl',...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const devices=Object.values(JSON.parse(simctl('list','devices','available','-j')).devices).flat();
assert.ok(devices.find(device=>device.udid===udid)?.name.startsWith('Puptime Native Storage '));
const output=mkdtempSync(join(tmpdir(),'puptime-onboarding-failure-'));
const flow=file=>execFileSync(process.env.MAESTRO_BIN??'maestro',['--device',udid,'test',resolve('.maestro/native',file),'--test-output-dir',join(output,file)],{stdio:'inherit',env:{...process.env,MAESTRO_CLI_NO_ANALYTICS:'1'}});
try{simctl('terminate',udid,app);}catch{}
const directory=()=>join(simctl('get_app_container',udid,app,'data'),'Documents/SQLite');
cpSync(directory(),join(output,'previous-synthetic-sqlite'),{recursive:true});
flow('ios-onboarding-practice-prepare.yaml');simctl('terminate',udid,app);
const path=join(directory(),'puptime-v2.db');
const writer=await createLocalDatabase(sqliteTestConnection(path));
const pet=await writer.read(sql=>sql.getFirstAsync("SELECT value FROM metadata WHERE key='active_pet_id'"));
try{
  const {storage}=await createLocalRuntime(writer,pet.value);
  await storage.savePuppyName('Mochi');
  await storage.appendEvents([{id:'retained-before-completion',type:'pee',at:1700000000000,source:'app'}]);
}finally{await writer.close();}
const database=new DatabaseSync(path);database.exec('PRAGMA busy_timeout=5000');
const tables=['metadata','puppies','events','routines','settings','pet_settings','local_revisions','local_sync_owner','local_sync_pets','local_sync_outbox','local_sync_records','local_sync_acks','local_sync_baseline'];
const snapshot=()=>Object.fromEntries(tables.map(table=>[table,database.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all().map(row=>({...row}))]));
try{
  const before=snapshot();assert.equal(before.events.length,1);
  database.exec("CREATE TRIGGER fail_review_completion BEFORE UPDATE OF value ON metadata WHEN OLD.key='show_onboarding' BEGIN SELECT RAISE(ABORT,'injected completion failure'); END;");
  try{flow('ios-onboarding-completion-failure.yaml');}
  finally{database.exec('DROP TRIGGER fail_review_completion');}
  assert.deepEqual(snapshot(),before,'Failed completion must preserve name, existing history, marker, revisions and sync state exactly.');
  console.log('PASS standalone Release failure keeps the final screen and Biscuit draft; actual SQL abort rolls back every durable table.');
  flow('ios-onboarding-completion-retry.yaml');
  const after=snapshot();
  assert.equal(after.puppies.find(row=>row.id===pet.value).name,'Biscuit');
  assert.equal(after.metadata.find(row=>row.key==='show_onboarding').value,'false');
  assert.equal(after.local_revisions.length,before.local_revisions.length+1);
  const without=(rows,key)=>rows.filter(row=>row.key!==key);
  assert.deepEqual(without(after.metadata,'show_onboarding'),without(before.metadata,'show_onboarding'));
  assert.deepEqual(without(after.settings,'puptime.onboarding.v1'),without(before.settings,'puptime.onboarding.v1'));
  assert.deepEqual(after.puppies,before.puppies.map(row=>row.id===pet.value?{...row,name:'Biscuit'}:row));
  assert.equal(after.local_revisions.at(-1).kind,'puppy');
  for(const table of tables.filter(table=>!['metadata','settings','puppies','local_revisions'].includes(table)))assert.deepEqual(after[table],before[table]);
  console.log('PASS retry completes once, preserves the existing event and creates exactly one puppy revision.');
  console.log('Native completion failure evidence and recovery backup:',output);
}finally{database.exec('DROP TRIGGER IF EXISTS fail_review_completion');database.close();}

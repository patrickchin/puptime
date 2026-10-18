// Actual installed iOS Settings/replay checks with production SQLite writes.
// This is a local projection fixture, not proof of HTTP synchronization.
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
assert.ok(devices.find(device=>device.udid===udid)?.name.startsWith('Puptime Native Storage '),'Use the dedicated synthetic simulator.');
const output=mkdtempSync(join(tmpdir(),'puptime-onboarding-settings-'));
const flow=file=>execFileSync(process.env.MAESTRO_BIN??'maestro',['--device',udid,'test',resolve('.maestro/native',file),'--test-output-dir',join(output,file)],{stdio:'inherit',env:{...process.env,MAESTRO_CLI_NO_ANALYTICS:'1'}});
try{simctl('terminate',udid,app);}catch{}
const directory=join(simctl('get_app_container',udid,app,'data'),'Documents/SQLite');
cpSync(directory,join(output,'previous-synthetic-sqlite'),{recursive:true});
const path=join(directory,'puptime-v2.db'),inspection=new DatabaseSync(path);
inspection.exec('PRAGMA busy_timeout=5000');
const tables=['metadata','puppies','events','routines','settings','pet_settings','local_revisions','local_sync_owner','local_sync_pets','local_sync_outbox','local_sync_records','local_sync_acks','local_sync_baseline','legacy_snapshots'];
const snapshot=()=>Object.fromEntries(tables.map(table=>[table,inspection.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all().map(row=>({...row}))]));
let database;
try {
  assert.equal(inspection.prepare('SELECT count(*) n FROM local_sync_owner').get().n,0,'Free local fixture must not impersonate an enrolled owner.');
  const petId=inspection.prepare("SELECT value FROM metadata WHERE key='active_pet_id'").get().value;
  database=await createLocalDatabase(sqliteTestConnection(path));
  const {storage}=await createLocalRuntime(database,petId);
  await storage.savePuppyName('Mochi');
  const now=Date.now();
  await storage.appendEvents(Array.from({length:1000},(_,index)=>({id:`onboarding-review:${index}`,type:index%2?'meal':'pee',at:now-index*300000,source:'app',note:'Synthetic onboarding review history'})));
  flow('ios-puppy-settings-open.yaml');
  const before=snapshot();assert.ok(before.events.length>=1000);
  flow('ios-onboarding-replay-populated.yaml');
  assert.deepEqual(snapshot(),before,'A replay must not write any durable app data, including revisions, preferences or sync state.');
  console.log('PASS populated free replay: full practice, finish and Skip preserve every local table exactly; no fake cloud owner.');
  // Return to the top of Settings before editing the puppy profile.
  flow('ios-puppy-settings-open.yaml');
  const failedBefore=snapshot();
  inspection.exec("CREATE TRIGGER fail_review_rename BEFORE UPDATE OF name ON puppies BEGIN SELECT RAISE(ABORT,'injected rename failure'); END;");
  try{flow('ios-puppy-name-failure.yaml');}
  finally{inspection.exec('DROP TRIGGER fail_review_rename');}
  assert.deepEqual(snapshot(),failedBefore,'Failed rename must roll back all durable state.');
  console.log('PASS actual SQL failure: committed name, populated history, revisions and outbox unchanged; retry prompt preserves attempted text.');
  flow('ios-puppy-name-retry.yaml');
  const after=snapshot();
  assert.deepEqual(after.puppies,failedBefore.puppies.map(pet=>pet.id===petId?{...pet,name:'Retry biscuit'}:pet));
  assert.equal(after.local_revisions.length,failedBefore.local_revisions.length+1);
  for(const table of tables.filter(table=>!['puppies','local_revisions'].includes(table)))assert.deepEqual(after[table],failedBefore[table],`${table}: successful rename must not change unrelated data.`);
  console.log('PASS retry commits one puppy revision while preserving puppy identity, all 1,000 events and unrelated data.');
  flow('ios-puppy-name-draft-open.yaml');
  await storage.savePuppyName('Remote Mochi');
  const projected=snapshot();
  flow('ios-puppy-name-projection.yaml');
  assert.deepEqual(snapshot(),projected,'Cancelling the draft must not overwrite the independently committed name.');
  console.log('PASS independent production-SQLite projection and foreground refresh update the saved label while preserving the open native prompt draft; Cancel writes nothing. This is a projection fixture, not HTTP sync.');
  flow('ios-puppy-name-blank.yaml');
  assert.deepEqual(snapshot(),projected,'Invalid blank rename must not create a revision or change the puppy.');
  console.log('PASS blank rename is rejected without modifying durable state.');
  flow('ios-puppy-name-long.yaml');
  const longName=('Mochi 🐾 '+'Biscuit '.repeat(27)).trim();
  assert.equal(inspection.prepare('SELECT name FROM puppies WHERE id=?').get(petId).name,longName);
  assert.deepEqual(snapshot().events,projected.events);
  console.log('PASS long name with a non-BMP paw character is saved exactly; populated event history remains unchanged.');
  console.log('Native evidence and synthetic recovery backup:',output);
} finally {
  inspection.exec('DROP TRIGGER IF EXISTS fail_review_rename');
  await database?.close();inspection.close();
}

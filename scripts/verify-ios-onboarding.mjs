// Actual installed iOS UI + exact SQLite checks, with synthetic data only.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {cpSync,existsSync,mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';

const udid=process.argv[2],app='com.patrickchin.puptime';
const simctl=(...args)=>execFileSync('xcrun',['simctl',...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const devices=Object.values(JSON.parse(simctl('list','devices','available','-j')).devices).flat();
assert.ok(devices.find(device=>device.udid===udid)?.name.startsWith('Puptime Native Storage '),'Use the dedicated synthetic simulator.');
const output=mkdtempSync(join(tmpdir(),'puptime-onboarding-native-'));
const flow=file=>execFileSync(process.env.MAESTRO_BIN??'maestro',['--device',udid,'test',resolve('.maestro/native',file),'--test-output-dir',join(output,file)],{stdio:'inherit',env:{...process.env,MAESTRO_CLI_NO_ANALYTICS:'1'}});
try{simctl('terminate',udid,app);}catch{}
const previous=join(simctl('get_app_container',udid,app,'data'),'Documents/SQLite');
if(existsSync(previous))cpSync(previous,join(output,'previous-synthetic-sqlite'),{recursive:true});
flow('ios-onboarding-practice-prepare.yaml');
const path=join(simctl('get_app_container',udid,app,'data'),'Documents/SQLite/puptime-v2.db');
const database=new DatabaseSync(path,{readOnly:true});
database.exec('PRAGMA busy_timeout=5000');
const tables=['puppies','events','routines','settings','pet_settings','local_revisions','local_sync_owner','local_sync_pets','local_sync_outbox','legacy_snapshots'];
const snapshot=()=>Object.fromEntries(tables.map(table=>[table,database.prepare(`SELECT * FROM ${table}`).all().map(row=>({...row}))]));
try{
  const before=snapshot();
  assert.equal(before.events.length,0);assert.equal(before.puppies.length,1);
  assert.equal(database.prepare("SELECT value FROM metadata WHERE key='show_onboarding'").get().value,'true');
  flow('ios-onboarding-practice.yaml');
  const after=snapshot();
  for(const table of ['events','routines','pet_settings','local_sync_owner','local_sync_pets','local_sync_outbox','legacy_snapshots'])assert.deepEqual(after[table],before[table],`${table}: practice must not change real puppy history or cloud ownership.`);
  assert.deepEqual(after.puppies,[{...before.puppies[0],name:'Biscuit'}]);
  const settings=rows=>rows.filter(row=>row.key!=='puptime.onboarding.v1');
  assert.deepEqual(settings(after.settings),settings(before.settings));
  assert.equal(database.prepare("SELECT value FROM metadata WHERE key='show_onboarding'").get().value,'false');
  assert.equal(after.local_revisions.length,before.local_revisions.length+1);
  assert.equal(after.local_revisions.at(-1).kind,'puppy');
  assert.equal(JSON.parse(after.local_revisions.at(-1).after_data).name,'Biscuit');
  console.log('PASS actual native practice tour leaves events, routines, preferences, ownership and outbox unchanged; only explicit puppy name and completion are saved.');
  flow('ios-onboarding-after-restart.yaml');
  assert.equal(database.prepare('SELECT name FROM puppies').get().name,'Biscuit');
  assert.equal(database.prepare('SELECT count(*) n FROM events').get().n,0);
  console.log('PASS explicit puppy name and empty real history survive a native restart.');
  console.log('Native evidence and synthetic recovery backup:',output);
}finally{database.close();}

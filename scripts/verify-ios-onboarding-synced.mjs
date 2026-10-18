// Run only after the private official-SDK request/verify/enable qualifier.
// Actual native HTTP synchronization, plus direct inspection of its local
// synthetic Worker store. Never read or print native session credentials.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {cpSync,mkdtempSync,readFileSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createLocalDatabase} from '../src/local/database.ts';
import {sqliteTestConnection} from '../src/local/sqlite-test-adapter.ts';
import {createLocalRuntime} from '../src/local/runtime-factory.ts';

const udid=process.argv[2],app='com.patrickchin.puptime';
const state=JSON.parse(readFileSync('/tmp/puptime-native-cloud-state.json','utf8'));
assert.equal(state.url,'http://127.0.0.1:8793');
const fixture=JSON.parse(readFileSync(join(state.directory,'native-fixture.json'),'utf8'));
assert.match(fixture.email,/^native-[a-f0-9-]{36}@example\.invalid$/);assert.equal(fixture.udid,udid);
const simctl=(...args)=>execFileSync('xcrun',['simctl',...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const devices=Object.values(JSON.parse(simctl('list','devices','available','-j')).devices).flat();
assert.ok(devices.find(device=>device.udid===udid)?.name.startsWith('Puptime Native Storage '));
const output=mkdtempSync(join(tmpdir(),'puptime-onboarding-synced-'));
const flow=file=>execFileSync(process.env.MAESTRO_BIN??'maestro',['--device',udid,'test',resolve('.maestro/native',file),'--test-output-dir',join(output,file)],{stdio:'inherit',env:{...process.env,MAESTRO_CLI_NO_ANALYTICS:'1'}});
try{simctl('terminate',udid,app);}catch{}
const directory=join(simctl('get_app_container',udid,app,'data'),'Documents/SQLite');
cpSync(directory,join(output,'previous-synthetic-sqlite'),{recursive:true});
const path=join(directory,'puptime-v2.db'),inspection=new DatabaseSync(path,{readOnly:true});
inspection.exec('PRAGMA busy_timeout=5000');
const tables=['metadata','puppies','events','routines','settings','pet_settings','local_revisions','local_sync_owner','local_sync_pets','local_sync_outbox','local_sync_records','local_sync_acks','local_sync_baseline'];
const snapshot=()=>Object.fromEntries(tables.map(table=>[table,inspection.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all().map(row=>({...row}))]));
let database,remote,stoppedPid;
try {
  const owner=inspection.prepare('SELECT * FROM local_sync_owner').get();assert.equal(owner.account_id,fixture.userId);
  const pet=inspection.prepare("SELECT * FROM local_sync_pets WHERE status='active'").get();assert.ok(pet.cloud_pet_id);
  database=await createLocalDatabase(sqliteTestConnection(path));
  const {storage}=await createLocalRuntime(database,pet.pet_id);
  await storage.savePuppyName('Mochi');
  const now=Date.now();
  await storage.appendEvents(Array.from({length:1000},(_,index)=>({id:`onboarding-synced:${index}`,type:index%2?'meal':'pee',at:now-index*300000,source:'app',note:'Synthetic synced replay review'})));
  const expected=inspection.prepare('SELECT count(*) n FROM events').get().n;assert.ok(expected>=1001);
  flow('ios-onboarding-synced-ready.yaml');
  assert.equal(inspection.prepare('SELECT count(*) n FROM local_sync_outbox').get().n,0);
  // Administrative inspection verifies the real local service received the
  // fixture through the installed client's ordinary HTTP runner.
  const files=readdirSync(join(state.persist,'v3/do'),{recursive:true}).filter(file=>typeof file==='string'&&file.endsWith('.sqlite'));
  for(const file of files){
    const candidate=new DatabaseSync(join(state.persist,'v3/do',file),{readOnly:true});
    if(candidate.prepare("SELECT name FROM sqlite_master WHERE name='records'").get()&&candidate.prepare("SELECT id FROM records WHERE pet_id=? LIMIT 1").get(pet.cloud_pet_id)){
      assert.equal(remote,undefined,'Synthetic puppy must belong to exactly one account store.');remote=candidate;
    }else candidate.close();
  }
  assert.ok(remote,'Actual local Worker account store must contain the enrolled puppy.');
  const cloudCount=()=>remote.prepare("SELECT count(*) n FROM records WHERE pet_id=? AND kind='event' AND deleted=0").get(pet.cloud_pet_id).n;
  assert.equal(cloudCount(),expected);
  const before=snapshot();
  flow('ios-onboarding-replay-populated.yaml');
  assert.deepEqual(snapshot(),before);assert.equal(cloudCount(),expected);
  console.log('PASS actual enrolled native client uploads 1,000 added events through HTTP; acknowledged replay preserves all local tables, owner, cursors, history and service event count.');
  const pids=execFileSync('lsof',['-t','-iTCP:8793','-sTCP:LISTEN'],{encoding:'utf8'}).trim().split(/\s+/);assert.equal(pids.length,1);
  const pid=Number(pids[0]);const parent=execFileSync('ps',['-p',String(pid),'-o','ppid='],{encoding:'utf8'}).trim();
  assert.ok(execFileSync('ps',['-p',parent,'-o','command='],{encoding:'utf8'}).includes(state.config),'Suspend only this isolated local Worker.');
  process.kill(pid,'SIGSTOP');stoppedPid=pid;
  try {
    flow('ios-onboarding-offline-log.yaml');
    await new Promise(resolve=>setTimeout(resolve,16000));
    const pending=snapshot();assert.ok(pending.local_sync_outbox.length>0);assert.equal(pending.events.length,expected+1);
    flow('ios-onboarding-replay-populated.yaml');
    assert.deepEqual(snapshot(),pending,'Offline replay must preserve queued edits and all sync metadata exactly.');
    assert.equal(cloudCount(),expected);
    console.log('PASS real local service outage: native quick log remains queued; full replay/Skip preserve pending outbox, owner, cursor, populated history and unchanged cloud count.');
  }finally{process.kill(pid,'SIGCONT');stoppedPid=undefined;}
  flow('ios-onboarding-synced-ready.yaml');
  assert.equal(inspection.prepare('SELECT count(*) n FROM local_sync_outbox').get().n,0);assert.equal(cloudCount(),expected+1);
  console.log('PASS normal native client resumes and acknowledges the retained offline log after service recovery.');
  console.log('Native evidence and synthetic recovery backup:',output);
}finally{
  if(stoppedPid)process.kill(stoppedPid,'SIGCONT');
  await database?.close();remote?.close();inspection.close();
}

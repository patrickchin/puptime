// Preserve an existing completed, SDK-owned synthetic installation through an
// actual standalone update and walkthrough replay. Never clear or seed it.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {cpSync,mkdtempSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';

const [udid,release]=process.argv.slice(2),app='com.patrickchin.puptime';
assert.ok(release?.endsWith('/Release-iphonesimulator/Puptime.app'));
const simctl=(...args)=>execFileSync('xcrun',['simctl',...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const device=Object.values(JSON.parse(simctl('list','devices','available','-j')).devices).flat().find(device=>device.udid===udid);
assert.equal(device?.name,'Puptime Native Storage ae0c first-launch history');
const state=JSON.parse(readFileSync('/tmp/puptime-native-cloud-state.json','utf8'));
const fixture=JSON.parse(readFileSync(join(state.directory,'native-fixture.json'),'utf8'));assert.equal(fixture.udid,udid);
assert.match(fixture.email,/^native-[a-f0-9-]{36}@example\.invalid$/);
const output=mkdtempSync(join(tmpdir(),'puptime-first-launch-upgrade-'));
try{simctl('terminate',udid,app);}catch(error){if(!String(error.stderr??'').includes('found nothing to terminate'))throw error;}
const directory=join(simctl('get_app_container',udid,app,'data'),'Documents/SQLite');
const sql=new DatabaseSync(join(directory,'puptime-v2.db'),{readOnly:true});sql.exec('PRAGMA busy_timeout=5000');
const snapshot=()=>Object.fromEntries(sql.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({name})=>[name,sql.prepare(`SELECT * FROM "${name.replaceAll('"','""')}" ORDER BY rowid`).all().map(row=>({...row}))]));
let remote;
try{
 const before=snapshot();assert.equal(before.local_sync_owner[0].account_id,fixture.userId);assert.equal(before.local_sync_outbox.length,0);assert.ok(before.events.length>=1000);
 assert.equal(before.puppies.length,1);assert.equal(before.metadata.find(row=>row.key==='show_onboarding').value,'false');
 assert.equal(before.metadata.find(row=>row.key==='first_launch_step'),undefined,'Use the preserved completed installation from before the first-launch checkpoint existed.');
 cpSync(directory,join(output,'previous-sdk-synthetic-sqlite'),{recursive:true});
 const cloudPet=before.local_sync_pets[0].cloud_pet_id;
 for(const file of readdirSync(join(state.persist,'v3/do'),{recursive:true}).filter(file=>typeof file==='string'&&file.endsWith('.sqlite'))){
  const candidate=new DatabaseSync(join(state.persist,'v3/do',file),{readOnly:true});
  if(candidate.prepare("SELECT name FROM sqlite_master WHERE name='records'").get()&&candidate.prepare('SELECT id FROM records WHERE pet_id=? LIMIT 1').get(cloudPet)){assert.equal(remote,undefined);remote=candidate;}else candidate.close();
 }
 assert.ok(remote);
 const remoteCount=()=>remote.prepare("SELECT count(*) n FROM records WHERE pet_id=? AND kind='event' AND deleted=0").get(cloudPet).n;
 const count=remoteCount();assert.equal(count,before.events.length);
 simctl('install',udid,release);
 const values=['-e','EXPECTED_PUPPY_NAME=.*'+before.puppies[0].name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'.*'];
 const run=(file,name,args=[])=>execFileSync(process.env.MAESTRO_BIN??'maestro',['--device',udid,'test',...args,file,'--test-output-dir',join(output,name)],{stdio:'inherit',env:{...process.env,MAESTRO_CLI_NO_ANALYTICS:'1'}});
 run(resolve('.maestro/native/ios-onboarding-completed-upgrade.yaml'),'upgrade',values);
 assert.deepEqual(snapshot(),before);assert.equal(remoteCount(),count);
 console.log('PASS standalone update skips first-open setup for a completed pre-checkpoint installation; every local table, SDK-owned binding,1000+events and cloud count are unchanged.');
 const file=join(output,'replay.yaml');
 writeFileSync(file,'appId: '+app+'\n---\n- launchApp:\n    stopApp: false\n    permissions: {}\n- waitForAnimationToEnd\n- assertNotVisible:\n    id: screen.firstLaunch\n- tapOn:\n    id: nav.open\n- tapOn:\n    id: nav.settings\n- runFlow: '+resolve('.maestro/native/ios-onboarding-replay-populated.yaml')+'\n');
 run(file,'populated-replay');assert.deepEqual(snapshot(),before);assert.equal(remoteCount(),count);
 console.log('PASS standalone walkthrough practice, complete and Skip preserve every populated SQL table, completion, account ownership, cursor/outbox and actual service count.');
 console.log('Standalone completed-upgrade/replay evidence and recovery backup:',output);
}finally{remote?.close();sql.close();}

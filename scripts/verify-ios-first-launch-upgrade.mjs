// Preserve an existing completed, SDK-owned synthetic installation through an
// actual standalone update, walkthrough replay and read-only local log history.
// Never clear, seed, load cloud versions, or restore a selected version.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {chmodSync,cpSync,mkdtempSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {cloudRecordSchema,eventDataSchema} from '../src/cloud/protocol.ts';
import {cloudRecordId} from '../src/cloud/record-identity.ts';
import {historyRestorePreview} from '../src/event-history-view.ts';
import {eventDataFromSql} from '../src/record-sql.ts';
import {localSchema} from '../src/local/database.ts';

const [udid,release]=process.argv.slice(2),app='com.patrickchin.puptime';
assert.ok(release?.endsWith('/Release-iphonesimulator/Puptime.app'));
const simctl=(...args)=>execFileSync('xcrun',['simctl',...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const device=Object.values(JSON.parse(simctl('list','devices','available','-j')).devices).flat().find(device=>device.udid===udid);
assert.equal(device?.name,'Puptime Native Storage ae0c first-launch history');
assert.equal(device.state,'Booted','Boot the preserved owned fixture without resetting it.');
const state=JSON.parse(readFileSync('/tmp/puptime-native-cloud-state.json','utf8'));
const fixture=JSON.parse(readFileSync(join(state.directory,'native-fixture.json'),'utf8'));assert.equal(fixture.udid,udid);
assert.match(fixture.email,/^native-[a-f0-9-]{36}@example\.invalid$/);
const output=mkdtempSync(join(tmpdir(),'puptime-first-launch-upgrade-'));
let directory=join(simctl('get_app_container',udid,app,'data'),'Documents/SQLite');
let sql=new DatabaseSync(join(directory,'puptime-v2.db'),{readOnly:true});sql.exec('PRAGMA busy_timeout=5000');
const snapshot=()=>{
 const current=join(simctl('get_app_container',udid,app,'data'),'Documents/SQLite');
 if(current!==directory){sql.close();directory=current;sql=new DatabaseSync(join(directory,'puptime-v2.db'),{readOnly:true});sql.exec('PRAGMA busy_timeout=5000');}
 sql.exec('BEGIN');
 try{return Object.fromEntries(sql.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(({name})=>[name,sql.prepare(`SELECT * FROM "${name.replaceAll('"','""')}" ORDER BY rowid`).all().map(row=>({...row}))]));}
 finally{sql.exec('COMMIT');}
};
let remote,before,remoteBefore;
try{
 // Validate the exact preserved fixture and schema before any app termination,
 // installation or UI action. A mismatch is evidence to inspect, never repair.
 const expected=new DatabaseSync(':memory:');
 try{
  expected.exec(localSchema);
  const columns=database=>Object.fromEntries(database.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(({name})=>[name,database.prepare(`PRAGMA table_info("${name.replaceAll('"','""')}")`).all().map(row=>({...row}))]));
  assert.deepEqual(columns(sql),columns(expected),'The retained fixture must match the current typed SQL schema before installation.');
 }finally{expected.close();}
 before=snapshot();assert.equal(before.metadata.find(row=>row.key==='schema_version')?.value,'4');assert.equal(before.local_sync_owner.length,1);assert.equal(before.local_sync_owner[0].account_id,fixture.userId);assert.equal(before.local_sync_outbox.length,0);assert.equal(before.events.length,1002,'Use only the exact retained SDK-owned1002-event recovery fixture.');
 assert.equal(before.local_sync_owner[0].resyncing,0);assert.equal(before.local_sync_owner[0].pending_pet_id,null);
 assert.equal(before.local_sync_pets.length,1);assert.equal(before.local_sync_pets[0].generation,before.local_sync_owner[0].generation);assert.equal(before.local_sync_pets[0].status,'active');
 assert.equal(before.puppies.length,1);assert.equal(before.metadata.find(row=>row.key==='show_onboarding').value,'false');
 assert.equal(before.metadata.find(row=>row.key==='first_launch_step'),undefined,'Use the preserved completed installation from before the first-launch checkpoint existed.');
 const backup=join(output,'previous-sdk-synthetic-sqlite');cpSync(directory,backup,{recursive:true});chmodSync(backup,0o700);
 const manifest=readdirSync(directory).map(name=>{
  const data=readFileSync(join(directory,name)),saved=readFileSync(join(backup,name));assert.deepEqual(saved,data,'Every original SQLite DB/WAL/SHM file must be hash-verified before installation.');chmodSync(join(backup,name),0o600);
  return {name,bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')};
 });
 writeFileSync(join(output,'preservation-manifest.json'),JSON.stringify({udid,files:manifest},null,2)+'\n',{mode:0o600});
 writeFileSync(join(output,'before-all-tables.json'),JSON.stringify(before,null,2)+'\n',{mode:0o600});
 const cloudPet=before.local_sync_pets[0].cloud_pet_id;
 for(const file of readdirSync(join(state.persist,'v3/do'),{recursive:true}).filter(file=>typeof file==='string'&&file.endsWith('.sqlite'))){
  const candidate=new DatabaseSync(join(state.persist,'v3/do',file),{readOnly:true});
  if(candidate.prepare("SELECT name FROM sqlite_master WHERE name='records'").get()&&candidate.prepare('SELECT id FROM records WHERE pet_id=? LIMIT 1').get(cloudPet)){assert.equal(remote,undefined);remote=candidate;}else candidate.close();
 }
 assert.ok(remote);
 const remoteCount=()=>remote.prepare("SELECT count(*) n FROM records WHERE pet_id=? AND kind='event' AND deleted=0").get(cloudPet).n;
 const count=remoteCount();remoteBefore=count;assert.equal(count,before.events.length);
 const petId=before.puppies[0].id;
 const recent=sql.prepare("SELECT sequence,local_id,after_data FROM local_revisions WHERE pet_id=? AND kind='event' ORDER BY sequence DESC LIMIT 50").all(petId);
 let history;
 for(const entry of recent){
  const current=before.events.find(event=>event.pet_id===petId&&event.id===entry.local_id);
  if(!current||!entry.after_data||current.type==='nap')continue;
  const currentData=eventDataFromSql(current);
  const versions=sql.prepare("SELECT sequence,after_data FROM local_revisions WHERE pet_id=? AND kind='event' AND local_id=? ORDER BY sequence DESC LIMIT 50").all(petId,entry.local_id);
  const candidates=versions.filter(row=>row.after_data).map(row=>({...row,data:eventDataSchema.parse(JSON.parse(row.after_data))})).filter(row=>row.data.type!=='nap');
  const owner=before.local_sync_owner[0],binding=before.local_sync_pets.find(row=>row.pet_id===petId);
  const recordId=cloudRecordId('event',binding.cloud_pet_id,entry.local_id);
  const mirror=before.local_sync_records.find(row=>row.generation===owner.generation&&row.record_id===recordId);
  const head={sequence:versions[0].sequence,event:{id:entry.local_id,...currentData},owner:{generation:owner.generation,accountId:owner.account_id},cloudRecord:mirror?cloudRecordSchema.parse(JSON.parse(mirror.body)):null};
  // Reuse the actual UI preview, including sticky estimated provenance.
  const problem=row=>historyRestorePreview({id:entry.local_id,...row.data},head,head.event).problem;
  const different=candidates.find(row=>problem(row)===null);
  const selected=different??candidates.find(row=>problem(row)==='identical');
  if(!selected)continue;
  if(!history||different)history={recentSequence:entry.sequence,selectedSequence:selected.sequence,eventId:entry.local_id,confirm:!!different,note:selected.data.note??''};
  if(different)break;
 }
 assert.ok(history,'The preserved installation needs a readable live non-nap entry in its bounded Recent changes page.');
 const openSettings='- tapOn:\n    id: nav.open\n    retryTapIfNoChange: true\n- extendedWaitUntil:\n    visible:\n      id: nav.drawer\n    timeout: 10000\n- waitForAnimationToEnd\n- scrollUntilVisible:\n    element:\n      id: nav.settings\n    direction: DOWN\n    visibilityPercentage: 100\n    centerElement: false\n    speed: 40\n    waitToSettleTimeoutMs: 1000\n- waitForAnimationToEnd\n- tapOn:\n    id: nav.settings\n    retryTapIfNoChange: true\n- extendedWaitUntil:\n    visible:\n      id: screen.settings\n    timeout: 15000\n';
 try{simctl('terminate',udid,app);}catch(error){if(!/found nothing to terminate|not running|No such process/i.test(String(error.stderr??'')))throw error;}
 simctl('install',udid,release);
 assert.deepEqual(snapshot(),before,'Compare the currently installed app container before launch, including after an OS container relocation.');
 const values=['-e','EXPECTED_PUPPY_NAME=.*'+before.puppies[0].name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'.*'];
 const run=(file,name,args=[])=>execFileSync(process.env.MAESTRO_BIN??'maestro',['--device',udid,'test',...args,file,'--test-output-dir',join(output,name)],{stdio:'inherit',env:{...process.env,MAESTRO_CLI_NO_ANALYTICS:'1'}});
 const upgrade=join(output,'completed-upgrade.yaml');
 writeFileSync(upgrade,'appId: '+app+'\nname: Preserve the completed SDK-owned installation through the standalone update\n---\n- launchApp:\n    permissions: {}\n- extendedWaitUntil:\n    visible:\n      id: screen.today\n    timeout: 90000\n- assertNotVisible:\n    id: screen.onboarding\n- assertNotVisible:\n    id: screen.firstLaunch\n'+openSettings+'- assertVisible:\n    id: settings.puppy.name\n    text: ${EXPECTED_PUPPY_NAME}\n- takeScreenshot: completed-upgrade-keeps-puppy-name\n- tapOn:\n    id: settings.back\n- assertVisible:\n    id: screen.today\n');
 run(upgrade,'upgrade',values);
 assert.deepEqual(snapshot(),before);assert.equal(remoteCount(),count);
 console.log('PASS standalone update skips first-open setup for a completed pre-checkpoint installation; every local table, SDK-owned binding,1000+events and cloud count are unchanged.');
 const file=join(output,'replay.yaml');
 writeFileSync(file,'appId: '+app+'\n---\n- launchApp:\n    stopApp: false\n    permissions: {}\n- waitForAnimationToEnd\n- assertNotVisible:\n    id: screen.firstLaunch\n'+openSettings+'- runFlow: '+JSON.stringify(resolve('.maestro/native/ios-onboarding-replay-populated.yaml'))+'\n');
 run(file,'populated-replay');assert.deepEqual(snapshot(),before);assert.equal(remoteCount(),count);
 console.log('PASS standalone walkthrough practice, complete and Skip preserve every populated SQL table, completion, account ownership, cursor/outbox and actual service count.');
 const historyValues={RECENT_SEQUENCE:String(history.recentSequence),SELECTED_SEQUENCE:String(history.selectedSequence),HISTORY_CONFIRM:history.confirm?'1':'0',HISTORY_HAS_NOTE:history.note?'1':'0',EXPECTED_NOTE:'^'+history.note.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$'};
 writeFileSync(join(output,'read-only-history-selection.json'),JSON.stringify({petId,eventId:history.eventId,recentSequence:history.recentSequence,selectedSequence:history.selectedSequence,confirmationAvailable:history.confirm},null,2)+'\n');
 try{run(resolve('.maestro/native/ios-history-owned-upgrade.yaml'),'owned-read-only-history',Object.entries(historyValues).flatMap(([key,value])=>['-e',`${key}=${value}`]));}
 finally{assert.deepEqual(snapshot(),before,'Read-only owned history and Cancel/Back must preserve every table, owner, cursor, outbox and retained revision, even after a failed UI command.');assert.equal(remoteCount(),count);}
 console.log('PASS standalone SDK-owned Recent changes opens the selected retained local version and returns without writes; confirmation '+(history.confirm?'Cancel verified':'unavailable for the identical current version')+'; every SQL table,1000+events, owner/outbox/cursor and actual remote count unchanged.');
 console.log('Standalone completed-upgrade/replay/read-only-history evidence and recovery backup:',output);
}finally{
 try{
  if(before){const after=snapshot();writeFileSync(join(output,'after-all-tables.json'),JSON.stringify(after,null,2)+'\n',{mode:0o600});assert.deepEqual(after,before,'The entire update/replay/history journey must preserve every table, even after a failed UI command.');}
  if(remoteBefore!==undefined)assert.equal(remote.prepare("SELECT count(*) n FROM records WHERE pet_id=? AND kind='event' AND deleted=0").get(before.local_sync_pets[0].cloud_pet_id).n,remoteBefore);
 }finally{remote?.close();sql.close();}
}

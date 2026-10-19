// Installed free local-history acceptance. Only a dedicated, explicitly marked,
// unowned synthetic fixture may be replaced. No account, credentials or server.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {cpSync,existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createLocalDatabase,initializeLocalDatabase} from '../src/local/database.ts';
import {sqliteTestConnection} from '../src/local/sqlite-test-adapter.ts';
import {createLocalRuntime} from '../src/local/runtime-factory.ts';

const [udid,permission,stage='--open-only']=process.argv.slice(2),app='com.patrickchin.puptime';
assert.equal(permission,'--replace-synthetic','Explicitly authorize replacing this task’s unowned synthetic fixture.');
assert.ok(['--open-only','--local'].includes(stage));
const simctl=(...args)=>execFileSync('xcrun',['simctl',...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const device=Object.values(JSON.parse(simctl('list','devices','available','-j')).devices).flat().find(device=>device.udid===udid);
assert.ok(device?.name.startsWith('Puptime Native Storage ios-history-ui '),'Use this worktree’s dedicated history device.');
assert.equal(device.state,'Booted');
const root=simctl('get_app_container',udid,app,'data'),directory=join(root,'Documents/SQLite'),path=join(directory,'puptime-v2.db');
const output=mkdtempSync(join(tmpdir(),'puptime-ios-history-'));
try{simctl('terminate',udid,app);}catch(error){if(!/found nothing to terminate|not running|No such process/i.test(String(error.stderr??'')))throw error;}
if(existsSync(path)){
 const previous=new DatabaseSync(path,{readOnly:true});
 try{
  assert.equal(previous.prepare('SELECT COUNT(*) n FROM local_sync_owner').get().n,0,'Never replace an account-owned profile.');
  const count=previous.prepare('SELECT COUNT(*) n FROM events').get().n;
  const marker=previous.prepare("SELECT value FROM metadata WHERE key='qualification_fixture'").get()?.value;
  assert.ok(count===0||marker==='native-history-v1','Preserve unmarked populated history.');
  if(count)assert.equal(previous.prepare("SELECT COUNT(*) n FROM events WHERE id NOT LIKE 'history-fixture-%'").get().n,0,'Preserve another fixture’s records.');
 }finally{previous.close();}
 cpSync(directory,join(output,'previous-synthetic-sqlite'),{recursive:true});
}
const seed=join(output,'seed.sqlite'),database=await createLocalDatabase(sqliteTestConnection(seed));
const {petId}=await initializeLocalDatabase(database,()=> 'history-fixture-pet');
const runtime=await createLocalRuntime(database,petId),targetId='history-fixture-target',deletedId='history-fixture-deleted';
let originalSequence,deletedOriginalSequence,deletionSequence,originalAt;
try{
 await runtime.storage.completeOnboarding({puppyName:'History puppy'});
 await runtime.storage.saveLanguagePreference('en');await runtime.storage.saveNotificationDelivery(false);
 const now=Date.now(),population=Array.from({length:1000},(_,index)=>({id:'history-fixture-'+String(index).padStart(4,'0'),type:'pee',at:now-(1020-index)*60000,source:'app'}));
 await runtime.storage.appendEvents(population);
 const target={id:targetId,type:'custom',customLabel:'Training',at:now-300000,source:'widget',note:'First note',estimated:false};
 originalAt=target.at;await runtime.storage.appendEvents([target]);originalSequence=(await runtime.history.eventPage(targetId)).entries[0].sequence;
 for(let version=1;version<=70;version++)await runtime.storage.updateEvent(targetId,{note:'Version '+version});
 await runtime.storage.appendEvents([{...target,at:target.at+60000,note:'Version 70',estimated:true}]);
 await runtime.storage.deleteCustomActivity('Training');
 await runtime.storage.appendEvents([{id:deletedId,type:'custom',customLabel:'Old check',at:now-240000,source:'widget',note:'Deleted note',estimated:true}]);
 deletedOriginalSequence=(await runtime.history.eventPage(deletedId)).entries[0].sequence;
 await runtime.storage.deleteCustomActivity('Old check');await runtime.storage.removeEvent(deletedId);
 deletionSequence=(await runtime.history.eventPage(deletedId)).entries[0].sequence;
 await database.write(sql=>sql.runAsync("INSERT INTO metadata(key,value) VALUES ('qualification_fixture','native-history-v1')"));
}finally{await database.close();}
mkdirSync(directory,{recursive:true});
for(const suffix of ['','-wal','-shm'])rmSync(path+suffix,{force:true});
cpSync(seed,path);
writeFileSync(join(output,'fixture.json'),JSON.stringify({udid,petId,targetId,deletedId,originalSequence,deletedOriginalSequence,deletionSequence,originalAt,population:1000},null,2));
const sql=new DatabaseSync(path);sql.exec('PRAGMA busy_timeout=5000');
const tables=sql.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row=>row.name);
const snapshot=()=>Object.fromEntries(tables.map(name=>[name,sql.prepare(`SELECT * FROM "${name.replaceAll('"','""')}" ORDER BY rowid`).all().map(row=>({...row}))]));
const event=id=>sql.prepare('SELECT * FROM events WHERE pet_id=? AND id=?').get(petId,id);
function run(name,file,values={}){
 const wrapper=join(output,name+'-active.yaml');
 writeFileSync(wrapper,'appId: '+app+'\n---\n- launchApp:\n    stopApp: false\n    permissions: {}\n- waitForAnimationToEnd\n- runFlow: '+JSON.stringify(resolve(file))+'\n');
 execFileSync(process.env.MAESTRO_BIN??'maestro',['--device',udid,'test',...Object.entries(values).flatMap(([key,value])=>['-e',`${key}=${value}`]),wrapper,'--test-output-dir',join(output,name)],{stdio:'inherit',env:{...process.env,MAESTRO_CLI_NO_ANALYTICS:'1'}});
}
function flow(name,body){const file=join(output,name+'.yaml');writeFileSync(file,'appId: '+app+'\n---\n'+body);run(name,file);}
const probePath=join(root,'Documents/row-render-probe.json'),requireProbe=process.env.PUPTIME_HISTORY_REQUIRE_RENDER_PROBE==='1';
let initialRenders;
const renderProof={};
function unchangedRows(phase){
 if(!initialRenders)return;
 const current=JSON.parse(readFileSync(probePath,'utf8')).renders;
 for(const [id,count] of Object.entries(initialRenders))if(id!==targetId)assert.equal(current[id],count,phase+': unchanged underlying row '+id);
 renderProof[phase]={untouchedRows:Object.keys(initialRenders).filter(id=>id!==targetId).length,renders:current};
 writeFileSync(join(output,'render-proof.json'),JSON.stringify(renderProof,null,2));
}
try{
 const before=snapshot(),initialTarget=event(targetId);
 assert.equal(before.events.length,1001);assert.equal(before.local_sync_owner.length,0);assert.equal(before.local_sync_outbox.length,0);
 console.log('Native history fixture:1000 unchanged records,one edited estimated custom log,one deleted log,70+ target versions; no account or upload work. Evidence:',output);
 if(requireProbe){
  flow('initial-populated-page','- extendedWaitUntil:\n    visible:\n      id: screen.today\n    timeout: 90000\n- extendedWaitUntil:\n    notVisible:\n      id: activity.loading\n    timeout: 30000\n- waitForAnimationToEnd\n');
  assert.ok(existsSync(probePath),'The explicit Debug render observer must be active.');
  initialRenders=JSON.parse(readFileSync(probePath,'utf8')).renders;
  assert.equal(Object.keys(initialRenders).length,200,'Initial activity rendering must remain bounded.');
 }
 run('open-history',resolve('.maestro/native/ios-history-open.yaml'));
 assert.equal(event(targetId).note,'Draft before history','Opening history must await the actual editor save.');
 const opened=snapshot();
 // Typing can cross the existing autosave debounce more than once. Opening
 // history must retain those genuine versions and flush the final exact draft.
 assert.ok(opened.local_revisions.length>before.local_revisions.length);
 assert.deepEqual(opened.local_revisions.slice(0,before.local_revisions.length),before.local_revisions);
 assert.ok(opened.local_revisions.slice(before.local_revisions.length).every(row=>row.pet_id===petId&&row.kind==='event'&&row.local_id===targetId&&row.source==='local'));
 assert.equal(JSON.parse(opened.local_revisions.at(-1).after_data).note,'Draft before history');
 assert.deepEqual(opened.events.filter(row=>row.id!==targetId),before.events.filter(row=>row.id!==targetId));
 for(const name of tables.filter(name=>!['events','local_revisions'].includes(name)))assert.deepEqual(opened[name],before[name],name+': opening local history must not change account/settings/other data.');
 assert.equal(event(targetId).at,initialTarget.at);assert.equal(event(targetId).estimated,1);
 unchangedRows('open-history-with-saved-draft');
 console.log('PASS local history opens after committing the exact editor draft;1000 unrelated rows and every account/settings table remain unchanged.');
 if(stage==='--local'){
  run('page-and-cancel',resolve('.maestro/native/ios-history-local-restore.yaml'),{ORIGINAL_SEQUENCE:originalSequence});
  assert.deepEqual(snapshot(),opened,'Selecting versions and cancelling confirmation cannot write anything.');
  unchangedRows('page-select-and-cancel');
  const prepareConfirmation='- scrollUntilVisible:\n    element:\n      id: history.restore\n    direction: DOWN\n    visibilityPercentage: 100\n    centerElement: false\n- waitForAnimationToEnd\n- tapOn:\n    id: history.restore\n- assertVisible:\n    id: history.confirm\n';
  flow('prepare-stale-confirmation',prepareConfirmation);
  const writer=await createLocalDatabase(sqliteTestConnection(path));
  try{const local=await createLocalRuntime(writer,petId);await local.storage.updateEvent(targetId,{note:'Independent newer change'});}finally{await writer.close();}
  const newer=snapshot();
  run('stale-confirmation',resolve('.maestro/native/ios-history-stale-confirm.yaml'));
  assert.deepEqual(snapshot(),newer,'A stale confirmation must preserve the independent committed change.');
  flow('reload-history','- tapOn:\n    id: history.reload\n- extendedWaitUntil:\n    visible:\n      id: history.local.list\n    timeout: 15000\n');
  run('select-after-reload',resolve('.maestro/native/ios-history-local-restore.yaml'),{ORIGINAL_SEQUENCE:originalSequence});
  assert.deepEqual(snapshot(),newer);
  flow('prepare-write-failure',prepareConfirmation);
  sql.exec("CREATE TRIGGER fail_history_ui AFTER UPDATE ON events WHEN NEW.id='history-fixture-target' BEGIN SELECT RAISE(ABORT,'synthetic historical write failure'); END;");
  try{
   const beforeFailure=snapshot();
   run('write-failure',resolve('.maestro/native/ios-history-write-failure.yaml'));
   assert.deepEqual(snapshot(),beforeFailure,'Failed historical restoration must roll back record/revision/upload changes together.');
  }finally{sql.exec('DROP TRIGGER IF EXISTS fail_history_ui');}
  console.log('PASS a newer committed edit invalidates confirmation; an injected actual SQLite write failure preserves all tables and the same selection remains retryable.');
  flow('restore-selected','- scrollUntilVisible:\n    element:\n      id: history.confirm.restore\n    direction: DOWN\n    visibilityPercentage: 100\n    centerElement: false\n- waitForAnimationToEnd\n- tapOn:\n    id: history.confirm.restore\n    repeat: 2\n- extendedWaitUntil:\n    visible:\n      id: history.restored\n    timeout: 15000\n- tapOn:\n    id: history.back\n- assertVisible:\n    id: editor.note.input\n    text: First note\n- tapOn:\n    id: editor.note.input\n- eraseText\n- inputText: After restore\n- tapOn: ^ADJUST TIME$\n- waitForAnimationToEnd\n- scrollUntilVisible:\n    element:\n      id: editor.close\n    direction: UP\n    visibilityPercentage: 100\n    centerElement: false\n- waitForAnimationToEnd\n- tapOn:\n    id: editor.close\n- assertVisible:\n    id: screen.today\n');
  assert.equal(event(targetId).id,targetId);assert.equal(event(targetId).note,'After restore');assert.equal(event(targetId).at,originalAt);assert.equal(event(targetId).estimated,1);assert.equal(event(targetId).source,'widget');
  assert.equal(sql.prepare("SELECT COUNT(*) n FROM local_revisions WHERE local_id=? AND source='restore'").get(targetId).n,1);
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM events').get().n,1001);
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM local_sync_owner').get().n,0);assert.equal(sql.prepare('SELECT COUNT(*) n FROM local_sync_outbox').get().n,0);
  console.log('PASS explicit restore retains target ID/widget source/estimated provenance,creates one restore revision despite repeated taps and refreshes the editor baseline.');
  const deletedBefore=snapshot();
  run('deleted-log',resolve('.maestro/native/ios-history-deleted-restore.yaml'),{DELETION_SEQUENCE:deletionSequence,DELETED_ORIGINAL_SEQUENCE:deletedOriginalSequence});
  assert.equal(event(deletedId).id,deletedId);assert.equal(event(deletedId).note,'Deleted note');assert.equal(event(deletedId).estimated,1);
  const restored=snapshot();assert.equal(restored.events.length,1002);
  assert.deepEqual(restored.events.filter(row=>row.id!==deletedId),deletedBefore.events.filter(row=>row.id!==deletedId));
  assert.equal(sql.prepare("SELECT COUNT(*) n FROM local_revisions WHERE local_id=? AND source='restore'").get(deletedId).n,1);
  assert.deepEqual(restored.local_sync_owner,deletedBefore.local_sync_owner);assert.deepEqual(restored.local_sync_outbox,deletedBefore.local_sync_outbox);
  assert.deepEqual(restored.pet_settings,deletedBefore.pet_settings,'Restoring the historical label must not reactivate a deleted quick action.');
  console.log('PASS Recent changes discovers a deleted log and restores its stable identity/provenance without resurrecting quick actions or changing1001 other events.');
 }
 console.log('Native local history evidence and recovery backup:',output);
}finally{sql.exec('DROP TRIGGER IF EXISTS fail_history_ui');sql.close();}

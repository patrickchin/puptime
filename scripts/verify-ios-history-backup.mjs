// Read-only history on a NEW fixture restored from the preserved synthetic SQL
// backup. This is not an in-place upgrade or a restored authentication session.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {chmodSync,constants,copyFileSync,existsSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {cloudRecordSchema,eventDataSchema} from '../src/cloud/protocol.ts';
import {cloudRecordId} from '../src/cloud/record-identity.ts';
import {historyRestorePreview} from '../src/event-history-view.ts';
import {localSchema} from '../src/local/database.ts';
import {localizedEventLabel} from '../src/localization.ts';
import {eventDataFromSql} from '../src/record-sql.ts';

const [udid,release,backup,...extra]=process.argv.slice(2),app='com.patrickchin.puptime',resume=process.env.PUPTIME_HISTORY_BACKUP_RESUME,a11y=process.env.PUPTIME_HISTORY_ACCESSIBILITY==='1';
assert.equal(extra.length,0);
assert.ok(release?.endsWith('/Release-iphonesimulator/Puptime.app')&&backup,'Supply the installed default Release and explicit preserved backup directory.');
const simctl=(...args)=>execFileSync('xcrun',['simctl',...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const device=Object.values(JSON.parse(simctl('list','devices','available','-j')).devices).flat().find(item=>item.udid===udid);
assert.equal(device?.name,'Puptime Native Storage ios-history-ui backup-owned');assert.equal(device.state,'Booted');
const manifest=JSON.parse(readFileSync(join(backup,'manifest.json'),'utf8'));
assert.equal(manifest.udid,'D931F2F5-783B-431E-A7B2-AD89A1882600');assert.notEqual(udid,manifest.udid);
assert.equal(manifest.rawBackupNeverOpenedWithSQLite,true);
assert.deepEqual(manifest.files.map(file=>file.relative).sort(),['puptime-v2.db','puptime-v2.db-shm','puptime-v2.db-wal']);
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
function originalHashes(){for(const file of manifest.files){const path=join(backup,'SQLite',file.relative);assert.equal(readFileSync(path).length,file.bytes);assert.equal(hash(path),file.sha256,'Keep the raw backup unopened and unchanged.');}}
originalHashes();
execFileSync('codesign',['--verify','--deep','--strict',release]);
let installed=simctl('get_app_container',udid,app,'app');
for(let attempt=0;attempt<10&&!existsSync(join(installed,'main.jsbundle'));attempt++){
 await new Promise(resolve=>setTimeout(resolve,1000));installed=simctl('get_app_container',udid,app,'app');
}
const candidateHash=hash(join(release,'main.jsbundle'));
assert.equal(hash(join(installed,'main.jsbundle')),candidateHash,'Qualify the exact supplied installed candidate.');
const bundle=readFileSync(join(release,'main.jsbundle'));
for(const marker of ['row-render-probe.json','sql-query-probe.json','sql-phase-probe.json','qualification_init_fault','127.0.0.1:8793','localhost:8793'])assert.ok(!bundle.includes(marker));
const directory=join(simctl('get_app_container',udid,app,'data'),'Documents/SQLite');
if(resume){
 const previous=JSON.parse(readFileSync(join(resume,'before-all-tables.json'),'utf8'));
 assert.deepEqual(previous,JSON.parse(readFileSync(join(resume,'after-all-tables.json'),'utf8')),'Never resume after any data change.');
 assert.deepEqual(previous,JSON.parse(readFileSync(join(backup,'all-tables.json'),'utf8')));
 assert.deepEqual(JSON.parse(readFileSync(join(resume,'original-backup-manifest.json'),'utf8')),manifest);
 const logs=readdirSync(join(resume,'native')).map(name=>join(resume,'native',name,'Backup-restored owned history without writes/logs/maestro.log')).filter(existsSync);
 assert.equal(logs.length,1);assert.ok(readFileSync(logs[0],'utf8').includes(`MAESTRO_DEVICE_UDID=${udid},`),'Resume only the exact previously qualified new fixture.');
}else for(const file of manifest.files)assert.equal(existsSync(join(directory,file.relative)),false,'Only an unlaunched fresh task fixture may receive the backup copy.');
const output=mkdtempSync(join(tmpdir(),'puptime-history-backup-owned-'));chmodSync(output,0o700);
const save=(name,data)=>writeFileSync(join(output,name),JSON.stringify(data,null,2)+'\n',{mode:0o600});
save('original-backup-manifest.json',manifest);copyFileSync(new URL(import.meta.url),join(output,'executed-verifier.mjs'));chmodSync(join(output,'executed-verifier.mjs'),0o600);
let sql,before;
try{
 mkdirSync(directory,{recursive:true});
 if(!resume)for(const file of manifest.files){const target=join(directory,file.relative);copyFileSync(join(backup,'SQLite',file.relative),target,constants.COPYFILE_EXCL);chmodSync(target,0o600);assert.equal(hash(target),file.sha256);}
 // Only the new copy is opened by SQLite; the three raw preservation files are
 // never opened, checkpointed, or repaired by SQLite.
 sql=new DatabaseSync(join(directory,'puptime-v2.db'),{readOnly:true});sql.exec('PRAGMA busy_timeout=5000');
 const snapshot=()=>{sql.exec('BEGIN');try{return Object.fromEntries(sql.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(({name})=>[name,sql.prepare(`SELECT * FROM "${name.replaceAll('"','""')}" ORDER BY rowid`).all().map(row=>({...row}))]));}finally{sql.exec('COMMIT');}};
 before=snapshot();assert.deepEqual(before,JSON.parse(readFileSync(join(backup,'all-tables.json'),'utf8')),'The restored SQL copy must exactly match the preserved snapshot before launch.');
 const expected=new DatabaseSync(':memory:');
 try{expected.exec(localSchema);const columns=db=>Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(({name})=>[name,db.prepare(`PRAGMA table_info("${name.replaceAll('"','""')}")`).all().map(row=>({...row}))]));assert.deepEqual(columns(sql),columns(expected));}finally{expected.close();}
 assert.equal(before.events.length,1002);assert.equal(before.puppies.length,1);assert.equal(before.local_sync_owner.length,1);assert.equal(before.local_sync_outbox.length,0);
 assert.equal(before.metadata.find(row=>row.key==='show_onboarding')?.value,'false');assert.equal(before.metadata.find(row=>row.key==='first_launch_step'),undefined);
 const petId=before.puppies[0].id,owner=before.local_sync_owner[0],binding=before.local_sync_pets.find(row=>row.pet_id===petId);
 assert.ok(binding);assert.equal(binding.generation,owner.generation);assert.equal(binding.status,'active');assert.equal(owner.resyncing,0);assert.equal(owner.pending_pet_id,null);
 let selection;
 for(const recent of sql.prepare("SELECT sequence,local_id FROM local_revisions WHERE pet_id=? AND kind='event' ORDER BY sequence DESC LIMIT 50").all(petId)){
  const row=before.events.find(event=>event.pet_id===petId&&event.id===recent.local_id);if(!row||row.type==='nap')continue;
  const versions=sql.prepare("SELECT sequence,after_data FROM local_revisions WHERE pet_id=? AND kind='event' AND local_id=? ORDER BY sequence DESC LIMIT 50").all(petId,recent.local_id);
  const mirror=before.local_sync_records.find(record=>record.generation===owner.generation&&record.record_id===cloudRecordId('event',binding.cloud_pet_id,row.id));
  const head={sequence:versions[0].sequence,event:{id:row.id,...eventDataFromSql(row)},owner:{generation:owner.generation,accountId:owner.account_id},cloudRecord:mirror?cloudRecordSchema.parse(JSON.parse(mirror.body)):null};
  const candidates=versions.filter(version=>version.after_data).map(version=>({...version,data:eventDataSchema.parse(JSON.parse(version.after_data))})).filter(version=>version.data.type!=='nap');
  const problem=version=>historyRestorePreview({id:row.id,...version.data},head,head.event).problem;
  const different=candidates.find(version=>problem(version)===null),chosen=different??candidates.find(version=>problem(version)==='identical');
  if(a11y&&!chosen?.data.note)continue;
  if(chosen&&(!selection||different))selection={recent:recent.sequence,version:chosen.sequence,eventId:row.id,confirm:!!different,note:chosen.data.note??'',labels:chosen.data.type==='custom'?[chosen.data.customLabel]:['en','zh-Hans','es'].map(language=>localizedEventLabel(language,chosen.data.type))};if(different)break;
 }
 assert.ok(selection);save('before-all-tables.json',before);save('read-only-selection.json',selection);
 const escape=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 const values={RECENT_SEQUENCE:String(selection.recent),SELECTED_SEQUENCE:String(selection.version),HISTORY_CONFIRM:selection.confirm?'1':'0',HISTORY_HAS_NOTE:selection.note?'1':'0',EXPECTED_NOTE:'^'+escape(selection.note)+'$',HISTORY_A11Y:a11y?'1':'0',EXPECTED_ACCESSIBILITY:'.*('+selection.labels.map(escape).join('|')+').*'+escape(selection.note)+'.*'};
 const flow=join(output,'backup-owned-read-only.yaml');
 writeFileSync(flow,'appId: '+app+'\nname: Backup-restored owned history without writes\n---\n- launchApp:\n    permissions: {}\n- extendedWaitUntil:\n    visible:\n      id: screen.today\n    timeout: 90000\n- assertNotVisible:\n    id: screen.firstLaunch\n- tapOn:\n    id: nav.open\n    retryTapIfNoChange: true\n- extendedWaitUntil:\n    visible:\n      id: nav.drawer\n    timeout: 15000\n- waitForAnimationToEnd\n- scrollUntilVisible:\n    element:\n      id: nav.settings\n    direction: DOWN\n    visibilityPercentage: 100\n    centerElement: false\n    speed: 40\n    waitToSettleTimeoutMs: 1000\n- tapOn:\n    id: nav.settings\n    retryTapIfNoChange: true\n- extendedWaitUntil:\n    visible:\n      id: screen.settings\n    timeout: 15000\n- runFlow: '+JSON.stringify(resolve('.maestro/native/ios-history-owned-upgrade.yaml'))+'\n');
 try{execFileSync(process.env.MAESTRO_BIN??'maestro',['--device',udid,'test',...Object.entries(values).flatMap(([key,value])=>['-e',`${key}=${value}`]),flow,'--test-output-dir',join(output,'native')],{stdio:'inherit',env:{...process.env,MAESTRO_CLI_NO_ANALYTICS:'1'}});}
 finally{const after=snapshot();save('after-all-tables.json',after);assert.deepEqual(after,before,'Read-only backup-restored history must preserve all14 tables, owner, outbox, mirrors and cursors even after a failed UI command.');}
 originalHashes();
 save('proof.json',{result:'PASS',scope:'Backup-restored NEW synthetic fixture; not original-device in-place upgrade or restored SDK session.',udid,originalDevice:manifest.udid,candidateHash,resumedFrom:resume??null,accessibilityEventAndNote:a11y,tables:Object.keys(before).length,events:before.events.length,ownerUnchanged:true,outbox:0,originalRawBackupHashesUnchanged:true,confirmation:selection.confirm?'Cancel':'identical version, Back only'});
 console.log('PASS backup-restored NEW owned SQL fixture:1002events/all14tables/owner/outbox unchanged through actual local history; original raw backup hashes exact. Not original-device upgrade, authentication or cloud-sync acceptance. Evidence:',output);
}finally{try{sql?.close();}finally{originalHashes();}}

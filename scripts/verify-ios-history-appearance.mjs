// Installed read-only history appearance matrix. No clearState, seed, restore,
// account or auth changes. --preserve-synthetic uses the real language picker,
// retains its preference audit revisions, and never opens SQLite for writing.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {cpSync,existsSync,mkdtempSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {storageKeys} from '../src/local/settings.ts';

const [udid,permission,selected]=process.argv.slice(2),app='com.patrickchin.puptime';
const preserve=permission==='--preserve-synthetic';
assert.ok(preserve||permission==='--configure-synthetic','Use --preserve-synthetic for real language-picker changes, or explicitly authorize legacy backed-up fixture metadata configuration.');
const cases=[
 {name:'light-en',theme:'system',appearance:'light',language:'en',largest:false},
 {name:'dark-es',theme:'system',appearance:'dark',language:'es',largest:false},
 {name:'light-zh',theme:'soft-play',appearance:'light',language:'zh-Hans',largest:false},
 {name:'largest-dark-en',theme:'system',appearance:'dark',language:'en',largest:true},
 {name:'largest-light-es',theme:'puppy-journal',appearance:'light',language:'es',largest:true},
 {name:'largest-dark-zh',theme:'system',appearance:'dark',language:'zh-Hans',largest:true},
];
if(selected)assert.ok(cases.some(item=>item.name===selected),'Choose a named history appearance case.');
// Explicit expected values catch accidentally displaying an English fallback.
const labels={
 en:{EXPECTED_HISTORY:'^Log history$',EXPECTED_CONFIRM:'^Restore this version\\?$',EXPECTED_CONFIRM_BODY:'^Adds a new version[.] Your history is kept[.]$',EXPECTED_RECENT:'^Recent changes$',EXPECTED_ADJUST_TIME:'^ADJUST TIME$'},
 es:{EXPECTED_HISTORY:'^Historial del registro$',EXPECTED_CONFIRM:'^¿Restaurar esta versión\\?$',EXPECTED_CONFIRM_BODY:'^Se añadirá una versión nueva y se conservará el historial[.]$',EXPECTED_RECENT:'^Cambios recientes$',EXPECTED_ADJUST_TIME:'^AJUSTAR HORA$'},
 'zh-Hans':{EXPECTED_HISTORY:'^记录历史$',EXPECTED_CONFIRM:'^恢复此版本？$',EXPECTED_CONFIRM_BODY:'^将新增一个版本，原有历史会保留。$',EXPECTED_RECENT:'^最近更改$',EXPECTED_ADJUST_TIME:'^调整时间$'},
};
const simctl=(...args)=>execFileSync('xcrun',['simctl',...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const device=Object.values(JSON.parse(simctl('list','devices','available','-j')).devices).flat().find(item=>item.udid===udid);
assert.ok(device?.name.startsWith('Puptime Native Storage ios-history-ui '),'Use a child-worktree dedicated history simulator.');
assert.equal(device.state,'Booted');
const directory=join(simctl('get_app_container',udid,app,'data'),'Documents/SQLite'),path=join(directory,'puptime-v2.db');
assert.ok(existsSync(path),'Prepare the existing marked fixture with verify-ios-history.mjs --open-only first.');
const stop=()=>{try{simctl('terminate',udid,app);}catch(error){if(!/found nothing to terminate|not running|No such process/i.test(String(error.stderr??'')))throw error;}};
stop();
const database=new DatabaseSync(path,{readOnly:preserve});database.exec('PRAGMA busy_timeout=5000');
const tables=database.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(row=>row.name);
const snapshot=()=>Object.fromEntries(tables.map(name=>[name,database.prepare(`SELECT * FROM "${name.replaceAll('"','""')}" ORDER BY rowid`).all().map(row=>({...row}))]));
let output,original,preferences;
function preferenceChanges(before,after){
 for(const name of tables.filter(name=>!['settings','local_revisions','sqlite_sequence'].includes(name)))assert.deepEqual(after[name],before[name],`Language picker must preserve ${name}.`);
 assert.deepEqual(after.settings.filter(row=>row.key!==storageKeys.language),before.settings.filter(row=>row.key!==storageKeys.language));
 assert.deepEqual(after.local_revisions.slice(0,before.local_revisions.length),before.local_revisions,'Retain every existing revision.');
 for(const row of after.local_revisions.slice(before.local_revisions.length)){
  assert.equal(row.kind,'accountPreferences');assert.equal(row.local_id,'preferences');assert.equal(row.source,'local');assert.equal(row.pet_id,'history-fixture-pet');
  const {language:oldLanguage,...oldValues}=JSON.parse(row.before_data),{language:newLanguage,...newValues}=JSON.parse(row.after_data);
  assert.notEqual(oldLanguage,newLanguage);assert.deepEqual(newValues,oldValues,'Language picker may change only the actual language preference.');
 }
 for(const row of before.sqlite_sequence??[])if(row.name!=='local_revisions')assert.deepEqual(after.sqlite_sequence.find(value=>value.name===row.name),row);
}
function languagePicker(value,phase){
 if(database.prepare('SELECT value FROM settings WHERE key=?').get(storageKeys.language)?.value===value)return;
 stop();simctl('ui',udid,'content_size','large');
 const file=join(output,phase+'-language.yaml'),before=snapshot();
 const scroll=id=>`- scrollUntilVisible:\n    element:\n      id: ${id}\n    direction: DOWN\n    timeout: 120000\n    speed: 40\n    waitToSettleTimeoutMs: 1000\n    visibilityPercentage: 100\n    centerElement: false\n- waitForAnimationToEnd\n- tapOn:\n    id: ${id}\n    retryTapIfNoChange: true\n`;
 writeFileSync(file,'appId: '+app+'\nname: Real language preference for retained history appearance\n---\n- launchApp:\n    stopApp: false\n    permissions: {}\n- extendedWaitUntil:\n    visible:\n      id: screen.today\n    timeout: 90000\n- tapOn:\n    id: nav.open\n    retryTapIfNoChange: true\n- assertVisible:\n    id: nav.drawer\n- waitForAnimationToEnd\n'+scroll('nav.settings')+'- extendedWaitUntil:\n    visible:\n      id: screen.settings\n    timeout: 15000\n'+scroll('settings.language.open')+'- assertVisible:\n    id: appearance.language.'+value+'\n- tapOn:\n    id: appearance.language.'+value+'\n- extendedWaitUntil:\n    visible:\n      id: screen.settings\n    timeout: 15000\n');
 try{execFileSync(process.env.MAESTRO_BIN??'maestro',['--device',udid,'test',file,'--test-output-dir',join(output,phase+'-language')],{stdio:'inherit',env:{...process.env,MAESTRO_CLI_NO_ANALYTICS:'1'}});}
 finally{preferenceChanges(before,snapshot());}
 assert.equal(database.prepare('SELECT value FROM settings WHERE key=?').get(storageKeys.language)?.value,value);stop();
}
try{
 assert.equal(database.prepare('SELECT count(*) n FROM local_sync_owner').get().n,0,'Preserve account-owned history.');
 assert.equal(database.prepare('SELECT count(*) n FROM local_sync_outbox').get().n,0,'Preserve pending upload work.');
 assert.equal(database.prepare("SELECT value FROM metadata WHERE key='qualification_fixture'").get()?.value,'native-history-v1','Never change an unmarked profile.');
 assert.equal(database.prepare('SELECT count(*) n FROM puppies').get().n,1);
 const petId=database.prepare("SELECT value FROM metadata WHERE key='active_pet_id'").get()?.value;
 assert.equal(petId,'history-fixture-pet');
 const count=database.prepare('SELECT count(*) n FROM events').get().n;
 assert.ok(count===1001||count===1002,'Use the populated history qualifier fixture.');
 assert.equal(database.prepare("SELECT count(*) n FROM events WHERE type='custom'").get().n,1,'Prepare with verify-ios-history.mjs --open-only so the target is the only live custom log.');
 assert.equal(database.prepare("SELECT count(*) n FROM events WHERE id NOT LIKE 'history-fixture-%'").get().n,0,'Preserve another task’s records.');
 const eventId='history-fixture-target',current=database.prepare('SELECT * FROM events WHERE pet_id=? AND id=?').get(petId,eventId);
 assert.ok(current?.note);assert.equal(current.estimated,1);assert.equal(current.source,'widget');
 const versions=database.prepare("SELECT sequence,after_data FROM local_revisions WHERE pet_id=? AND kind='event' AND local_id=? ORDER BY sequence DESC").all(petId,eventId);
 assert.ok(versions.length>=72,'Keep the existing populated version history.');
 const chosen=versions.slice(0,50).find(row=>row.after_data&&JSON.parse(row.after_data).note&&JSON.parse(row.after_data).note!==current.note);
 assert.ok(chosen,'A differing retained version must be available in the first bounded page.');
 const note=JSON.parse(chosen.after_data).note;
 // Expected-note strings are regex selectors; the fixture is synthetic but use
 // literal matching so punctuation never weakens the visible value assertion.
 const expectedNote='^'+note.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$';
 original=snapshot();preferences=[storageKeys.theme,storageKeys.language].map(key=>({key,row:database.prepare('SELECT key,value FROM settings WHERE key=?').get(key)}));
 if(preserve)assert.ok(preferences[1].row,'Preserve mode requires an existing language row so the original value can be restored through the UI.');
 output=mkdtempSync(join(tmpdir(),'puptime-history-appearance-'));
 cpSync(directory,join(output,'previous-synthetic-sqlite'),{recursive:true});
 writeFileSync(join(output,'fixture.json'),JSON.stringify({udid,deviceName:device.name,deviceType:device.deviceTypeIdentifier,petId,eventId,eventCount:count,selectedSequence:chosen.sequence,configuration:preserve?'Real language picker; existing theme retained; SQL read-only':'Legacy guarded preference metadata',cases:cases.filter(item=>!selected||item.name===selected).map(item=>preserve?{...item,theme:preferences[0].row?.value??'system'}:item)},null,2));
 const oldSize=simctl('ui',udid,'content_size'),oldAppearance=simctl('ui',udid,'appearance');
 try{
  for(const item of cases.filter(item=>!selected||item.name===selected)){
   stop();
   if(preserve)languagePicker(item.language,item.name);
   else{
    const set=database.prepare('INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
    set.run(storageKeys.theme,item.theme);set.run(storageKeys.language,item.language);
   }
   simctl('ui',udid,'appearance',item.appearance);
   simctl('ui',udid,'content_size',item.largest?'accessibility-extra-extra-extra-large':'large');
   const before=snapshot(),wrapper=join(output,item.name+'.yaml');
   writeFileSync(wrapper,'appId: '+app+'\n---\n- launchApp:\n    stopApp: false\n    permissions: {}\n- waitForAnimationToEnd\n- setOrientation: PORTRAIT\n- runFlow: '+JSON.stringify(resolve('.maestro/native/ios-history-appearance.yaml'))+'\n');
   const values={...labels[item.language],SELECTED_SEQUENCE:String(chosen.sequence),EXPECTED_NOTE:expectedNote};
   console.log('> Read-only native history appearance:',device.name,item.name,preserve?'; real language picker, existing theme retained. Evidence:':'; guarded theme/language setup only. Evidence:',output);
   try{
    execFileSync(process.env.MAESTRO_BIN??'maestro',['--device',udid,'test',...Object.entries(values).flatMap(([key,value])=>['-e',`${key}=${value}`]),wrapper,'--test-output-dir',join(output,item.name)],{stdio:'inherit',env:{...process.env,MAESTRO_CLI_NO_ANALYTICS:'1'}});
   }finally{
    assert.deepEqual(snapshot(),before,`${item.name}: keyboard focus, version selection, confirmation Cancel/Back and Recent changes must preserve every SQLite table, including after a failed UI command.`);
   }
   console.log('PASS read-only history appearance:',item.name,'; localized list/detail/confirmation/Cancel/Back/Recent changes, real keyboard and every SQLite table unchanged.');
  }
 }finally{
  stop();
  try{
   if(preserve){languagePicker(preferences[1].row.value,'restore-original');preferenceChanges(original,snapshot());assert.deepEqual(snapshot().settings,original.settings,'Original preferences restored through the real UI; preference audit revisions are retained.');}
   else{
    for(const {key,row} of preferences){if(row)database.prepare('INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(row.key,row.value);else database.prepare('DELETE FROM settings WHERE key=?').run(key);}
    assert.deepEqual(snapshot(),original,'Appearance fixture configuration must restore the original settings exactly and preserve every other SQLite table, including after failure.');
   }
  }finally{
   simctl('ui',udid,'content_size',oldSize);simctl('ui',udid,'appearance',oldAppearance);
  }
 }
 console.log(preserve?'PASS original theme/language restored through UI; all prior records retained, only genuine language-preference audit rows added. Actual native screenshot evidence:':'PASS original theme/language and all SQLite data restored. Actual native screenshot evidence:',output);
}finally{database.close();}

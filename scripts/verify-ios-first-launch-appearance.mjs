// Full installed first-open flow, including real keyboard/rotation and exact
// SQL isolation. Only replace a backed-up, unowned synthetic task simulator.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {cpSync,existsSync,mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createLocalDatabase} from '../src/local/database.ts';
import {sqliteTestConnection} from '../src/local/sqlite-test-adapter.ts';
import {createLocalRuntime} from '../src/local/runtime-factory.ts';

const udid=process.argv[2],app='com.patrickchin.puptime';
assert.equal(process.argv[3],'--replace-synthetic');
const simctl=(...args)=>execFileSync('xcrun',['simctl',...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const device=Object.values(JSON.parse(simctl('list','devices','available','-j')).devices).flat().find(device=>device.udid===udid);
assert.ok(device?.name.startsWith('Puptime Native Storage ae0c '),'Use this worktree’s dedicated device.');
const output=mkdtempSync(join(tmpdir(),'puptime-first-launch-appearance-'));
const directory=()=>join(simctl('get_app_container',udid,app,'data'),'Documents/SQLite');
const stop=()=>{try{simctl('terminate',udid,app);}catch(error){if(!String(error.stderr??'').includes('found nothing to terminate'))throw error;}};
stop();
if(existsSync(directory())){
 const previous=new DatabaseSync(join(directory(),'puptime-v2.db'),{readOnly:true});
 try{assert.equal(previous.prepare('SELECT count(*) n FROM local_sync_owner').get().n,0,'Preserve owned history.');}finally{previous.close();}
 cpSync(directory(),join(output,'previous-synthetic-sqlite'),{recursive:true});
}
const labels={
 en:{EXPECTED_WELCOME:'Puppy life, in one place.',EXPECTED_PROFILE:'Puppy’s name?',EXPECTED_ACCOUNT:'Save across devices?',EXPECTED_LOG:'Try a log',EXPECTED_SAMPLE:'.*practice log',EXPECTED_REMINDERS:'A little reminder?',EXPECTED_READY:'You’re all set.'},
 es:{EXPECTED_WELCOME:'Su día a día, en un lugar.',EXPECTED_PROFILE:'¿Cómo se llama tu cachorro?',EXPECTED_ACCOUNT:'¿Usarlo en varios dispositivos?',EXPECTED_LOG:'Prueba un registro',EXPECTED_SAMPLE:'.*registro de práctica',EXPECTED_REMINDERS:'¿Un recordatorio?',EXPECTED_READY:'Todo listo.'},
 'zh-Hans':{EXPECTED_WELCOME:'小狗日常，都在这里。',EXPECTED_PROFILE:'小狗叫什么？',EXPECTED_ACCOUNT:'想在多台设备上使用？',EXPECTED_LOG:'试着记一笔',EXPECTED_SAMPLE:'.*练习记录',EXPECTED_REMINDERS:'需要提醒吗？',EXPECTED_READY:'准备好了。'},
};
const cases=[['system-light-en','system','light','en',false],['system-dark-es','system','dark','es',false],['journal-es','puppy-journal','light','es',false],['soft-play-zh','soft-play','light','zh-Hans',false],['day-trails-en','day-trails','light','en',false],['largest-text','puppy-journal','light','en',true]];
const selected=process.argv[4];if(selected)assert.ok(cases.some(([name])=>name===selected),'Choose a named appearance case.');
let invocation=0;
function run(file,path,values={}){
 // Reactivate inside each new XCTest session without resetting the app draft.
 const wrapper=join(output,`activate-${++invocation}.yaml`);
 writeFileSync(wrapper,'appId: '+app+'\n---\n- launchApp:\n    stopApp: false\n    permissions: {}\n- waitForAnimationToEnd\n- runFlow: '+JSON.stringify(resolve(file))+'\n');
 execFileSync(process.env.MAESTRO_BIN??'maestro',['--device',udid,'test',...Object.entries(values).flatMap(([key,value])=>['-e',`${key}=${value}`]),wrapper,'--test-output-dir',path],{stdio:'inherit',env:{...process.env,MAESTRO_CLI_NO_ANALYTICS:'1'}});
}
function flow(name,body,path){const file=join(output,name+'.yaml');writeFileSync(file,'appId: '+app+'\n---\n'+body);run(file,path);}
const oldSize=simctl('ui',udid,'content_size'),oldAppearance=simctl('ui',udid,'appearance');
try{
 for(const [name,theme,appearance,language,largest] of cases.filter(([name])=>!selected||name===selected)){
  console.log('> Flow full first-open appearance:',name);
  simctl('ui',udid,'appearance',appearance);simctl('ui',udid,'content_size',largest?'accessibility-extra-extra-extra-large':'large');
  const path=join(output,name);
  flow(name+'-prepare','- launchApp:\n    clearState: true\n- extendedWaitUntil:\n    visible:\n      id: setup.step.welcome\n    timeout: 90000\n',join(path,'prepare'));
  stop();
  const nativePath=join(directory(),'puptime-v2.db'),database=await createLocalDatabase(sqliteTestConnection(nativePath));
  try{
   const {value:petId}=await database.read(sql=>sql.getFirstAsync("SELECT value FROM metadata WHERE key='active_pet_id'"));
   const {storage,sync}=await createLocalRuntime(database,petId);assert.equal((await sync.status(petId)).state,'local');
   await storage.saveThemePreference(theme);await storage.saveLanguagePreference(language);
  }finally{await database.close();}
  const sql=new DatabaseSync(nativePath,{readOnly:true});
  const tables=['metadata','puppies','events','routines','settings','pet_settings','local_revisions','local_sync_owner','local_sync_pets','local_sync_outbox','local_sync_records','local_sync_acks','local_sync_baseline'];
  const snapshot=()=>Object.fromEntries(tables.map(table=>[table,sql.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all().map(row=>({...row}))]));
  const value=key=>sql.prepare('SELECT value FROM metadata WHERE key=?').get(key)?.value;
  try{
   const initial=snapshot();assert.equal(initial.puppies.length,1);assert.equal(initial.events.length,0);assert.equal(initial.local_sync_owner.length,0);
   const values={...labels[language],LARGEST_TEXT:String(largest)};
   run(resolve('.maestro/native/ios-first-launch-localized-profile.yaml'),join(path,'profile'),values);
   assert.equal(sql.prepare('SELECT id FROM puppies').get().id,initial.puppies[0].id);assert.equal(sql.prepare('SELECT name FROM puppies').get().name,'Biscuit');
   assert.equal(value('first_launch_step'),'account');assert.equal(sql.prepare('SELECT count(*) n FROM local_revisions').get().n,initial.local_revisions.length+1);
   const before=snapshot();
   run(resolve('.maestro/native/ios-first-launch-localized-practice.yaml'),join(path,'practice'),values);
   const after=snapshot();for(const table of tables.filter(table=>table!=='metadata'))assert.deepEqual(after[table],before[table],`${name}: practice/permission choices preserve ${table}.`);
   assert.equal(value('first_launch_step'),'reminders');assert.equal(value('notify_on_device'),'false');
   flow(name+'-complete','- scrollUntilVisible:\n    element:\n      id: setup.finish\n    direction: DOWN\n    visibilityPercentage: 100\n- waitForAnimationToEnd\n- tapOn:\n    id: setup.finish\n- extendedWaitUntil:\n    visible:\n      id: screen.today\n    timeout: 15000\n',join(path,'complete'));
   assert.equal(value('first_launch_step'),'done');assert.equal(value('show_onboarding'),'false');assert.equal(value('notify_on_device'),'false');
   const completed=snapshot();for(const table of tables.filter(table=>!['metadata','settings'].includes(table)))assert.deepEqual(completed[table],before[table]);
   console.log('PASS full native first-open',name,': localized welcome/profile/account/practice/reminders/ready; one named puppy, zero sample logs/owner/outbox and preserved preferences/rules.');
  }finally{sql.close();}
 }
 console.log('Native full first-open appearance screenshots and synthetic backup:',output);
}finally{
 simctl('ui',udid,'content_size',oldSize);simctl('ui',udid,'appearance',oldAppearance);
}

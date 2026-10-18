// Actual standalone iOS theme/language screens, with explicit fixture settings.
// This script never changes a real device or an account-backed profile.
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
assert.equal(devices.find(device=>device.udid===udid)?.name,'Puptime Native Storage ae0c Onboarding Small','Use this worktree’s dedicated small-screen simulator.');
const output=mkdtempSync(join(tmpdir(),'puptime-onboarding-appearance-'));
const labels={
  en:{EXPECTED_LOG_TITLE:'Little moments. Easier days.',EXPECTED_SKIP:'Skip',EXPECTED_SAMPLE:'.*practice log',EXPECTED_TIMELINE_TITLE:'Get to know their rhythm.',EXPECTED_ROUTINE_TITLE:'A little routine helps.',EXPECTED_READY_TITLE:'Hello, puppy.'},
  'zh-Hans':{EXPECTED_LOG_TITLE:'记录小事，轻松过每一天。',EXPECTED_SKIP:'跳过',EXPECTED_SAMPLE:'.*练习记录',EXPECTED_TIMELINE_TITLE:'慢慢看懂它的节奏。',EXPECTED_ROUTINE_TITLE:'有点规律，更从容。',EXPECTED_READY_TITLE:'你好呀，小狗。'},
  es:{EXPECTED_LOG_TITLE:'Pequeños momentos. Días más fáciles.',EXPECTED_SKIP:'Omitir',EXPECTED_SAMPLE:'.*registro de práctica',EXPECTED_TIMELINE_TITLE:'Conoce su ritmo.',EXPECTED_ROUTINE_TITLE:'Una rutina ayuda.',EXPECTED_READY_TITLE:'Hola, cachorro.'},
};
const cases=[['system-light-en','system','light','en'],['system-dark-es','system','dark','es'],['journal-es','puppy-journal','light','es'],['soft-play-zh','soft-play','light','zh-Hans'],['day-trails-en','day-trails','light','en']];
const flow=(file,directory,values={})=>execFileSync(process.env.MAESTRO_BIN??'maestro',['--device',udid,'test',...Object.entries(values).flatMap(([key,value])=>['-e',`${key}=${value}`]),resolve('.maestro/native',file),'--test-output-dir',directory],{stdio:'inherit',env:{...process.env,MAESTRO_CLI_NO_ANALYTICS:'1'}});
const sqliteDirectory=()=>join(simctl('get_app_container',udid,app,'data'),'Documents/SQLite');
try{simctl('terminate',udid,app);}catch{}
cpSync(sqliteDirectory(),join(output,'previous-synthetic-sqlite'),{recursive:true});
const oldSize=simctl('ui',udid,'content_size'),oldAppearance=simctl('ui',udid,'appearance');
try{
  simctl('ui',udid,'content_size','large');
  for(const [name,theme,appearance,language] of cases){
    const directory=join(output,name);
    console.log('> Flow real native appearance fixture:',name);
    simctl('ui',udid,'appearance',appearance);
    flow('ios-onboarding-practice-prepare.yaml',join(directory,'prepare'));
    simctl('terminate',udid,app);
    const path=join(sqliteDirectory(),'puptime-v2.db');
    const database=await createLocalDatabase(sqliteTestConnection(path));
    try{
      const pet=await database.read(sql=>sql.getFirstAsync("SELECT value FROM metadata WHERE key='active_pet_id'"));
      const runtime=await createLocalRuntime(database,pet.value);
      assert.equal((await runtime.sync.status(pet.value)).state,'local');
      await runtime.storage.saveThemePreference(theme);await runtime.storage.saveLanguagePreference(language);
    }finally{await database.close();}
    const inspection=new DatabaseSync(path,{readOnly:true});
    const tables=['metadata','puppies','events','routines','settings','pet_settings','local_revisions','local_sync_owner','local_sync_pets','local_sync_outbox','local_sync_records','local_sync_acks','local_sync_baseline','legacy_snapshots'];
    const snapshot=()=>Object.fromEntries(tables.map(table=>[table,inspection.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all().map(row=>({...row}))]));
    try{
      const before=snapshot();assert.equal(before.events.length,0);
      flow('ios-onboarding-localized.yaml',join(directory,'walkthrough'),labels[language]);
      const after=snapshot();
      for(const table of tables.filter(table=>!['metadata','settings'].includes(table)))assert.deepEqual(after[table],before[table],`${name}: ${table} must remain unchanged by practice/Not now.`);
      const without=(rows,key)=>rows.filter(row=>row.key!==key);
      assert.deepEqual(without(after.metadata,'show_onboarding'),without(before.metadata,'show_onboarding'));
      assert.deepEqual(without(after.settings,'puptime.onboarding.v1'),without(before.settings,'puptime.onboarding.v1'));
      assert.equal(after.metadata.find(row=>row.key==='show_onboarding').value,'false');
      console.log('PASS actual native theme/language',name,': four steps, localized practice feedback, optional completion and exact data isolation.');
    }finally{inspection.close();}
  }
  console.log('Native appearance screenshots and synthetic recovery backup:',output);
}finally{
  simctl('ui',udid,'content_size',oldSize);simctl('ui',udid,'appearance',oldAppearance);
}

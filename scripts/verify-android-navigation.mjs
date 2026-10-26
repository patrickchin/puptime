// Disposable, worktree-specific Android fixture; never targets personal app data.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {csvToEvents} from '../src/export.ts';
import {createLocalDatabase, initializeLocalDatabase} from '../src/local/database.ts';
import {sqliteTestConnection} from '../src/local/sqlite-test-adapter.ts';
import {createLocalRuntime} from '../src/local/runtime-factory.ts';

const device=process.argv[2], app='com.patrickchin.puptime';
const adb=(...args)=>execFileSync('adb',['-s',device,...args]);
assert.match(adb('emu','avd','name').toString().trim().split('\n')[0].trim(),/^Puptime_(Navigation_d859|UI_Hierarchy_a9f2)$/);
const output=resolve('output/navigation');mkdirSync(output,{recursive:true});
let expectedEvents;
function eventsAt(path){const db=new DatabaseSync(path,{readOnly:true});try{return db.prepare('SELECT * FROM events ORDER BY pet_id,id').all();}finally{db.close();}}
if(process.argv.includes('--seed')){
  const path=resolve(output,`fixture-${Date.now()}.db`);
  const database=await createLocalDatabase(sqliteTestConnection(path));
  const {petId}=await initializeLocalDatabase(database);
  const runtime=await createLocalRuntime(database,petId);
  await runtime.storage.completeOnboarding({puppyName:'Mochi'});
  await runtime.storage.saveLanguagePreference('en');
  await runtime.storage.saveThemePreference('light');
  const now=Date.now();
  await runtime.storage.appendEvents(Array.from({length:1000},(_,index)=>({
    id:`evt_navigation_${index}`,type:['pee','meal','poop','walk'][index%4],at:now-index*20*60000,source:'app',
  })));
  await database.close();
  expectedEvents=eventsAt(path);
  adb('shell','am','force-stop',app);
  adb('shell','run-as',app,'mkdir','-p','files/SQLite');
  adb('shell','run-as',app,'rm','-f','files/SQLite/puptime-v2.db-wal','files/SQLite/puptime-v2.db-shm');
  execFileSync('adb',['-s',device,'shell','-T','run-as',app,'dd','of=files/SQLite/puptime-v2.db'],{input:readFileSync(path)});
}
execFileSync('maestro',['--device',device,'test','.maestro/native/android-navigation.yaml','--test-output-dir',output],{stdio:'inherit',env:{...process.env,MAESTRO_CLI_NO_ANALYTICS:'1'}});
const csv=adb('shell','run-as',app,'ls','cache').toString().split(/\s+/).find(name=>/^puptime-activity-.*\.csv$/.test(name));
assert.ok(csv,'Native export creates a CSV file.');
assert.equal(csvToEvents(adb('exec-out','run-as',app,'cat',`cache/${csv}`).toString()).length,1000,'Export includes all history, beyond the timeline window.');
adb('shell','am','force-stop',app);
const verified=resolve(output,`verified-${Date.now()}.db`);
for(const suffix of ['', '-wal', '-shm']){
  try{writeFileSync(verified+suffix,adb('exec-out','run-as',app,'cat',`files/SQLite/puptime-v2.db${suffix}`));}
  catch(error){if(!suffix)throw error;}
}
const saved=eventsAt(verified);assert.equal(saved.length,1000);
if(expectedEvents)assert.deepEqual(saved,expectedEvents,'Navigation and cancelled import preserve every activity field.');
console.log('PASS Android navigation with 1,000 synthetic events. Evidence: '+output);

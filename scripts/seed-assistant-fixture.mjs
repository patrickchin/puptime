// Only a dedicated synthetic simulator/emulator is eligible for replacement.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync,readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createLocalDatabase,initializeLocalDatabase} from '../src/local/database.ts';
import {sqliteTestConnection} from '../src/local/sqlite-test-adapter.ts';
import {createLocalRuntime} from '../src/local/runtime-factory.ts';
const [platform,device]=process.argv.slice(2),app='com.patrickchin.puptime';
assert.ok(['ios','android'].includes(platform));
const run=(binary,...args)=>execFileSync(binary,args,{encoding:'utf8'}).trim();
if(platform==='ios'){
  const devices=Object.values(JSON.parse(run('xcrun','simctl','list','devices','available','-j')).devices).flat();
  assert.match(devices.find(item=>item.udid===device)?.name??'',/^Puptime Hands Free /);
}else assert.match(run('adb','-s',device,'emu','avd','name'),/^Puptime_Hands_Free_/);
mkdirSync('build',{recursive:true});const path=resolve('build',`assistant-fixture-${platform}-${Date.now()}.db`);
const database=await createLocalDatabase(sqliteTestConnection(path));
const {petId}=await initializeLocalDatabase(database);const runtime=await createLocalRuntime(database,petId);
await runtime.storage.completeOnboarding({puppyName:'Ellie'});await runtime.storage.saveLanguagePreference('en');await runtime.storage.saveThemePreference('light');
const now=Date.now();await runtime.storage.appendEvents(Array.from({length:1000},(_,index)=>({id:`evt_fixture_${index}`,type:['pee','meal','poop','walk'][index%4],at:now-index*20*60000,source:'app',...(index===2?{note:'After breakfast'}:{})})));
await database.close();
if(platform==='ios'){
  try{run('xcrun','simctl','terminate',device,app);}catch{}
  const container=run('xcrun','simctl','get_app_container',device,app,'data'),directory=join(container,'Documents','SQLite');
  mkdirSync(directory,{recursive:true});
  const {copyFileSync,rmSync}=await import('node:fs');for(const suffix of ['-wal','-shm'])rmSync(join(directory,'puptime-v2.db'+suffix),{force:true});
  copyFileSync(path,join(directory,'puptime-v2.db'));
}else{
  run('adb','-s',device,'shell','am','force-stop',app);run('adb','-s',device,'shell','run-as',app,'mkdir','-p','files/SQLite');
  run('adb','-s',device,'shell','run-as',app,'rm','-f','files/SQLite/puptime-v2.db-wal','files/SQLite/puptime-v2.db-shm');
  execFileSync('adb',['-s',device,'shell','-T','run-as',app,'dd','of=files/SQLite/puptime-v2.db'],{input:readFileSync(path)});
}
console.log(`Seeded ${platform} dedicated assistant fixture with 1,000 logs.`);

// Actual installed iOS editor + independent production SQLite writes.
// This represents committed remote projection, not an HTTP-delivery claim.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {cpSync,existsSync,mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createLocalDatabase} from '../src/local/database.ts';
import {sqliteTestConnection} from '../src/local/sqlite-test-adapter.ts';
import {createLocalRuntime} from '../src/local/runtime-factory.ts';
const udid=process.argv[2],app='com.patrickchin.puptime';
const simctl=(...args)=>execFileSync('xcrun',['simctl',...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const devices=Object.values(JSON.parse(simctl('list','devices','available','-j')).devices).flat();
assert.ok(devices.find(device=>device.udid===udid)?.name.startsWith('Puptime Native Storage '),'Use the dedicated synthetic simulator.');
const output=mkdtempSync(join(tmpdir(),'puptime-native-routine-'));
const flow=file=>execFileSync(process.env.MAESTRO_BIN??'maestro',['--device',udid,'test',resolve('.maestro/native',file),'--test-output-dir',join(output,file)],{stdio:'inherit',env:{...process.env,MAESTRO_CLI_NO_ANALYTICS:'1'}});
try{simctl('terminate',udid,app);}catch{}
const previous=join(simctl('get_app_container',udid,app,'data'),'Documents/SQLite');
if(existsSync(previous))cpSync(previous,join(output,'previous-synthetic-sqlite'),{recursive:true});
flow('ios-routine-concurrency-prepare.yaml');
simctl('terminate',udid,app);
const path=join(simctl('get_app_container',udid,app,'data'),'Documents/SQLite/puptime-v2.db');
const database=await createLocalDatabase(sqliteTestConnection(path));
try{
  const pet=await database.read(sql=>sql.getFirstAsync("SELECT value FROM metadata WHERE key='active_pet_id'"));
  const runtime=await createLocalRuntime(database,pet.value);
  assert.equal((await runtime.sync.status(pet.value)).state,'local');
  const original={id:'native-routine-concurrency',type:'walk',minutes:480,reminder:false};
  await runtime.storage.saveSchedule([original]);
  flow('ios-routine-concurrency-open.yaml');
  const remote={...original,minutes:545,reminder:true};
  await runtime.storage.saveScheduleEntry(remote,original);
  flow('ios-routine-concurrency-save.yaml');
  assert.deepEqual(await runtime.storage.loadSchedule(),[{...remote,type:'poop'}]);
  console.log('PASS native routine save preserves independent time/reminder changes while editing its activity type.');
  await runtime.storage.removeScheduleEntry(original.id);
  flow('ios-routine-concurrency-deleted.yaml');
  assert.deepEqual(await runtime.storage.loadSchedule(),[]);
  assert.equal((await runtime.storage.loadEvents()).length,1);
  assert.equal((await runtime.sync.status(pet.value)).pending,0);
  console.log('PASS native routine deletion rejects saving the retained draft, shows accurate removed copy and never resurrects the row.');
  console.log('Synthetic recovery backup and native evidence:',output);
}finally{await database.close();}

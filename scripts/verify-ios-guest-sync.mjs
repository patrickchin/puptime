// Native guest -> official SDK email sign-in -> explicit Enable/Combine.
// Install a dependency-matched app with this isolated local Worker origin first.
// Local OTP previews are private; this does not test real inbox delivery.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync,mkdtempSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {basename,join,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createLocalDatabase} from '../src/local/database.ts';
import {sqliteTestConnection} from '../src/local/sqlite-test-adapter.ts';
import {createLocalRuntime} from '../src/local/runtime-factory.ts';
import {entityId} from '../src/entity-id.ts';
import {eventDataFromSql} from '../src/record-sql.ts';
import {localRecordId} from '../src/cloud/record-identity.ts';

const [udid,argument]=process.argv.slice(2),directory=resolve(argument??''),app='com.patrickchin.puptime';
assert.ok(basename(directory).startsWith('puptime-guest-'),'Use a disposable local guest-sync harness.');
const config=JSON.parse(readFileSync(join(directory,'wrangler.json'),'utf8'));
assert.equal(config.vars.ENVIRONMENT,'local');
assert.match(config.vars.AUTH_BASE_URL,/^http:\/\/127\.0\.0\.1:\d+$/);
const simctl=(...args)=>execFileSync('xcrun',['simctl',...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const devices=Object.values(JSON.parse(simctl('list','devices','available','-j')).devices).flat();
assert.ok(devices.find(device=>device.udid===udid)?.name.startsWith('Puptime Native Storage ')&&devices.find(device=>device.udid===udid)?.name.includes('guest-log-sync'),'Use a dedicated guest-log-sync simulator: this test resets its app data.');
const email=`native-${entityId('usr')}@example.invalid`;
let code='',expectedCount=0;
function flow(name) {
 const startup=join(homedir(),'.maestro/tests'),before=new Set(existsSync(startup)?readdirSync(startup):[]);
 const output=mkdtempSync(join(directory,'private-maestro-'));
 try{
  execFileSync('maestro',['--device',udid,'test','-e',`TEST_EMAIL=${email}`,resolve('.maestro/native',name),'--test-output-dir',output],{stdio:['ignore','pipe','pipe'],env:{...process.env,MAESTRO_CLI_NO_ANALYTICS:'1',MAESTRO_TEST_CODE:code,MAESTRO_EXPECTED_COUNT:String(expectedCount)}});
  console.log('PASS',name);
 }catch(error){
  const raw=String(error.stdout??'')+'\n'+String(error.stderr??'');
  writeFileSync(join(directory,'native-failure.txt'),code?raw.replaceAll(code,'[REDACTED]'):raw,{mode:0o600});
  throw new Error(`Native flow failed: ${name}; redacted console retained in ${directory}.`);
 }finally{
  if(code&&existsSync(startup))for(const folder of readdirSync(startup).filter(folder=>!before.has(folder))){
   const log=join(startup,folder,'maestro.log');if(!existsSync(log))continue;
   const raw=readFileSync(log,'utf8');if(raw.includes(resolve('.maestro/native',name)))writeFileSync(log,raw.replaceAll(code,'[REDACTED]'));
  }
  rmSync(output,{recursive:true,force:true});
 }
}
const databasePath=()=>join(simctl('get_app_container',udid,app,'data'),'Documents/SQLite/puptime-v2.db');
function inspect() {
 const database=new DatabaseSync(databasePath(),{readOnly:true});database.exec('PRAGMA busy_timeout=5000');
 try{
  return {
   events:database.prepare('SELECT * FROM events ORDER BY id').all().map(({id,...row})=>({id,...eventDataFromSql(row)})),
   pets:database.prepare('SELECT * FROM local_sync_pets').all(),
   pending:database.prepare('SELECT COUNT(*) n FROM local_sync_outbox').get().n,
  };
 }finally{database.close();}
}
function localStore(subdirectory,table) {
 for(const file of readdirSync(join(directory,'state/v3',subdirectory),{recursive:true}).filter(file=>typeof file==='string'&&file.endsWith('.sqlite'))){
  const database=new DatabaseSync(join(directory,'state/v3',subdirectory,file),{readOnly:true});
  if(database.prepare("SELECT name FROM sqlite_master WHERE name=?").get(table))return database;
  database.close();
 }
 throw new Error(`Missing isolated ${table} store.`);
}
const ordered=events=>[...events].sort((a,b)=>a.id.localeCompare(b.id));
function remoteEvents(petId) {
 const database=localStore('do','record_events');
 try{
  return ordered(database.prepare("SELECT records.id,records.pet_id,record_events.* FROM records JOIN record_events ON records.id=record_events.record_id WHERE records.kind='event' AND records.deleted=0 AND records.pet_id=?").all(petId).map(({id,pet_id,...row})=>({id:localRecordId({id,petId:pet_id,kind:'event'}),...eventDataFromSql(row)})));
 }finally{database.close();}
}
const results=[];
for(const existing of [false,true]){
 flow('ios-guest-logs-prepare.yaml');
 // Stop only this harness's local service while the real guest logs are made.
 const port=new URL(config.vars.AUTH_BASE_URL).port;
 const pids=execFileSync('lsof',['-t',`-iTCP:${port}`,'-sTCP:LISTEN'],{encoding:'utf8'}).trim().split(/\s+/);
 assert.equal(pids.length,1);const pid=Number(pids[0]);
 const parent=execFileSync('ps',['-p',String(pid),'-o','ppid='],{encoding:'utf8'}).trim();
 assert.ok(execFileSync('ps',['-p',parent,'-o','command='],{encoding:'utf8'}).includes(join(directory,'wrangler.json')),'Suspend only the owned local Worker.');
 process.kill(pid,'SIGSTOP');
 try{flow('ios-guest-logs-offline.yaml');}finally{process.kill(pid,'SIGCONT');}
 const initial=inspect();assert.equal(initial.events.length,3);assert.equal(initial.pets.length,0);
 const database=await createLocalDatabase(sqliteTestConnection(databasePath()));
 try{
  const pet=await database.read(sql=>sql.getFirstAsync("SELECT value FROM metadata WHERE key='active_pet_id'"));
  const {storage}=await createLocalRuntime(database,pet.value),now=Date.now();
  await storage.appendEvents(Array.from({length:114},(_,i)=>({id:entityId('evt'),type:i%3===0?'custom':i%3===1?'nap':'walk',at:now-(i+2)*300000,...(i%3===0?{customLabel:'Training'}:i%3===1?{endedAt:now-(i+1)*300000}:{}),source:i%2?'widget':'app',note:`Guest sync ${existing?'Combine':'Enable'} ${i} 🐶 训练`})));
 }finally{await database.close();}
 const before=inspect();expectedCount=before.events.length;assert.equal(expectedCount,117);
 flow('ios-guest-signin-request.yaml');
 const auth=localStore('d1','local_email_previews');
 try{code=auth.prepare('SELECT code FROM local_email_previews WHERE email=? ORDER BY expires_at DESC LIMIT 1').get(email)?.code;assert.match(code??'',/^\d{6}$/);}
 finally{auth.close();}
 flow('ios-guest-signin-verify.yaml');code='';
 assert.deepEqual(inspect(),before,'Actual native sign-in must preserve guest events, ownership and upload queue.');
 expectedCount+=existing?results[0].count:0;
 flow('ios-guest-sync-enable.yaml');
 const after=inspect(),expected=ordered([...before.events,...(existing?results[0].events:[])]);
 assert.deepEqual(ordered(after.events),expected);assert.equal(after.pending,0);assert.equal(after.pets.length,1);
 const petId=after.pets[0].cloud_pet_id;assert.ok(petId);assert.deepEqual(remoteEvents(petId),expected,'Compare every actual HTTP service record, not only the native Up to date label.');
 simctl('io',udid,'screenshot',join(directory,existing?'combined.png':'enabled.png'));
 simctl('terminate',udid,app);simctl('launch',udid,app);
 flow('ios-cloud-account-ready.yaml');
 assert.deepEqual(ordered(inspect().events),expected,'A cold restart retains every synchronized log.');
 assert.deepEqual(remoteEvents(petId),expected);
 results.push({scenario:existing?'Combine':'Enable',count:expected.length,events:expected});
 console.log(`PASS native ${existing?'Combine':'Enable'}: ${expected.length} exact local and remote logs; empty outbox; cold restart preserves history.`);
}
writeFileSync(join(directory,'result.json'),JSON.stringify({udid,origin:config.vars.AUTH_BASE_URL,scenarios:results.map(({scenario,count})=>({scenario,count})),passed:true},null,2));

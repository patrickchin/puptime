// Isolated native SDK qualification. Local OTP previews stay in the private
// harness; private environment input avoids codes in source files or argv.
// Retain only redacted summaries/post-login screenshots, never raw auth traces.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {cpSync,existsSync,mkdtempSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {basename,join,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createLocalDatabase} from '../src/local/database.ts';
import {sqliteTestConnection} from '../src/local/sqlite-test-adapter.ts';
import {createLocalRuntime} from '../src/local/runtime-factory.ts';
import {cloudRecordId} from '../src/cloud/record-identity.ts';
const [phase,udid]=process.argv.slice(2),app='com.patrickchin.puptime';
assert.ok(['first-launch-local-recovered','first-launch-local-fallback','first-launch-restore-request','first-launch-restore-verify','first-launch-restore','first-launch-request','first-launch-verify','first-launch-enable','request','verify','auth-faults','rate-limited','enable','resume','outage','preview','combine','signout','access-recovery','enrollment-race'].includes(phase),'Use a supported native cloud qualification phase.');
const state=JSON.parse(readFileSync(process.env.PUPTIME_CLOUD_STATE_FILE??'/tmp/puptime-native-cloud-state.json','utf8'));
assert.ok(basename(state.directory).startsWith('puptime-native-cloud-'));assert.equal(state.url,'http://127.0.0.1:8793');
const simctl=(...args)=>execFileSync('xcrun',['simctl',...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const devices=Object.values(JSON.parse(simctl('list','devices','available','-j')).devices).flat();
assert.ok(devices.find(device=>device.udid===udid)?.name.startsWith('Puptime Native Storage '),'Use the dedicated disposable simulator.');
const contextPath=join(state.directory,phase.startsWith('first-launch-')?'first-launch-fixture.json':'native-fixture.json');
const context=['request','first-launch-request'].includes(phase)?{email:`native-${crypto.randomUUID()}@example.invalid`,udid}:JSON.parse(readFileSync(contextPath,'utf8'));
assert.equal(context.udid,udid);
function authDatabase(){
 const files=readdirSync(join(state.persist,'v3/d1'),{recursive:true}).filter(file=>typeof file==='string'&&file.endsWith('.sqlite'));
 for(const file of files){const database=new DatabaseSync(join(state.persist,'v3/d1',file),{readOnly:true});if(database.prepare("SELECT name FROM sqlite_master WHERE name='local_email_previews'").get())return database;database.close();}
 throw new Error('Isolated local auth database not found.');
}
const database=authDatabase();let code='';
function flow(name){
 const startup=join(homedir(),'.maestro/tests'),before=new Set(existsSync(startup)?readdirSync(startup):[]);
 const output=mkdtempSync(join(state.directory,'private-maestro-'));
 try{
  execFileSync(process.env.MAESTRO_BIN??'maestro',['--device',udid,'test','-e',`TEST_EMAIL=${context.email}`,resolve('.maestro/native',name),'--test-output-dir',output],{stdio:['ignore','pipe','pipe'],env:{...process.env,MAESTRO_CLI_NO_ANALYTICS:'1',MAESTRO_TEST_CODE:code,MAESTRO_EXPECTED_COUNT:String(phase==='combine'?context.expectedAfterCombine:context.expectedCount??1)}});
  console.log('PASS',name);
 }catch(error){
  const raw=String(error.stdout??'')+'\n'+String(error.stderr??'');
  const redacted=code?raw.replaceAll(code,'[REDACTED]'):raw;
  writeFileSync(join(state.directory,'native-flow-failure.txt'),redacted,{mode:0o600});
  throw new Error(`Native flow failed: ${name}. Redacted console retained in the isolated harness; raw authentication artifacts discarded.`);
 }finally{
  // Maestro also creates a global startup log outside --test-output-dir.
  // Redact only this run's newly created logs, leaving other tasks untouched.
  if(code&&existsSync(startup))for(const directory of readdirSync(startup).filter(directory=>!before.has(directory))){
    const log=join(startup,directory,'maestro.log');if(!existsSync(log))continue;
    const raw=readFileSync(log,'utf8');if(raw.includes(resolve('.maestro/native',name)))writeFileSync(log,raw.replaceAll(code,'[REDACTED]'));
  }
  rmSync(output,{recursive:true,force:true});
 }
}
const post=async(path,body,cookie='')=>{
    for(let attempt=0;attempt<2;attempt++){
      const response=await fetch(state.url+path,{method:'POST',headers:{origin:state.url,'content-type':'application/json',...(cookie?{cookie}:{})},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(15000)});
      if(response.status===429&&attempt===0){
        const seconds=Number(response.headers.get('retry-after'));
        const delay=Number.isFinite(seconds)&&seconds>0?Math.min(60000,Math.ceil(seconds*1000)):60000;
        console.log('Waiting for the real service rate-limit window before the administrative HTTP fixture retries.');
        await new Promise(resolve=>setTimeout(resolve,delay));continue;
      }
      assert.equal(response.status,200,'The isolated service request must succeed.');return response;
    }
  };

async function fixtureCookie(){
  await post('/api/auth/email-otp/send-verification-otp',{email:context.email,type:'sign-in'});
  code=database.prepare('SELECT code FROM local_email_previews WHERE email=? ORDER BY expires_at DESC LIMIT 1').get(context.email).code;
  const login=await post('/api/auth/sign-in/email-otp',{email:context.email,otp:code});
  assert.equal((await login.json()).user.id,context.userId,'Fixture reauthentication must retain the original owner.');
  const cookie=login.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
  assert.ok(cookie);return cookie;
}
function mutateAuthFixture(query){
  assert.match(context.email,/^native-[a-f0-9-]{36}@example\.invalid$/);
  const path=join(state.directory,'private-native-fixture.sql');
  writeFileSync(path,query,{mode:0o600});
  try{execFileSync('npx',['wrangler','d1','execute','AUTH_DB','--local','--config',state.config,'--persist-to',state.persist,'--file',path,'--json'],{stdio:['ignore','pipe','pipe'],env:{...process.env,CI:'1'}});}
  catch{throw new Error('Isolated native fixture update failed; private output withheld.');}
  finally{rmSync(path,{force:true});}
}
async function verifyLocalRecovery(native){
 const snapshot=()=>Object.fromEntries(['metadata','puppies','events','routines','settings','pet_settings','local_revisions','local_sync_owner','local_sync_pets','local_sync_outbox','local_sync_records','local_sync_acks','local_sync_baseline'].map(table=>[table,native.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all().map(row=>({...row}))]));
 const before=snapshot();assert.equal(before.events.length,2);assert.equal(before.local_sync_owner.length,0);assert.equal(before.local_sync_outbox.length,0);
 flow('ios-first-launch-offline-recovered.yaml');assert.deepEqual(snapshot(),before,'Reconnect never silently changes the explicit local choice.');
 const cookie=await fixtureCookie(),summary=await (await fetch(state.url+'/api/account',{headers:{cookie,origin:state.url}})).json();
 assert.equal(summary.user.id,context.userId);assert.equal(summary.pets[0].eventCount,1);
 console.log('PASS recovered service retains SDK sign-in but never silently re-enrolls/uploads the local choice; every local table and cloud copy stay intact.');
}
try{
 if(phase==='first-launch-local-recovered'){
  const native=new DatabaseSync(join(simctl('get_app_container',udid,app,'data'),'Documents/SQLite/puptime-v2.db'),{readOnly:true});
  try{await verifyLocalRecovery(native);}finally{native.close();}
 }else if(phase==='first-launch-local-fallback'){
  try{simctl('terminate',udid,app);}catch(error){if(!String(error.stderr??'').includes('found nothing to terminate'))throw error;}
  const nativeDirectory=join(simctl('get_app_container',udid,app,'data'),'Documents/SQLite'),nativePath=join(nativeDirectory,'puptime-v2.db');
  const native=new DatabaseSync(nativePath);native.exec('PRAGMA busy_timeout=5000');
  const backup=mkdtempSync(join(state.directory,'first-launch-fallback-backup-'));
  cpSync(nativeDirectory,join(backup,'SQLite'),{recursive:true});
  try{
   assert.equal(native.prepare('SELECT account_id FROM local_sync_owner').get().account_id,context.userId);
   assert.equal(native.prepare('SELECT cloud_pet_id FROM local_sync_pets').get().cloud_pet_id,context.localPetId);
   assert.equal(native.prepare('SELECT count(*) n FROM local_sync_outbox').get().n,0);assert.equal(native.prepare('SELECT count(*) n FROM events').get().n,1);
   native.exec("BEGIN;UPDATE metadata SET value='true' WHERE key='show_onboarding';UPDATE metadata SET value='cloud' WHERE key='first_launch_step';DELETE FROM settings WHERE key='puptime.onboarding.v1';COMMIT;");
   const core=()=>Object.fromEntries(['puppies','events','routines','settings','pet_settings','local_revisions'].map(table=>[table,native.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all().map(row=>({...row}))]));
   const before=core();
   const pids=execFileSync('lsof',['-t','-iTCP:8793','-sTCP:LISTEN'],{encoding:'utf8'}).trim().split(/\s+/);assert.equal(pids.length,1);
   const pid=Number(pids[0]),parent=execFileSync('ps',['-p',String(pid),'-o','ppid='],{encoding:'utf8'}).trim();
   assert.ok(execFileSync('ps',['-p',parent,'-o','command='],{encoding:'utf8'}).includes(state.config),'Pause only the isolated local fixture.');
   process.kill(pid,'SIGSTOP');
   try{
    flow('ios-first-launch-offline-error.yaml');assert.deepEqual(core(),before);
    flow('ios-first-launch-offline-local.yaml');
    assert.equal(native.prepare('SELECT count(*) n FROM events').get().n,2);assert.equal(native.prepare('SELECT count(*) n FROM local_sync_owner').get().n,0);assert.equal(native.prepare('SELECT count(*) n FROM local_sync_outbox').get().n,0);
    console.log('PASS native unfinished cloud setup shows one offline error and completes locally during a real service outage; retained history plus one actual offline log, no owner or upload queue.');
   }finally{process.kill(pid,'SIGCONT');}
   await verifyLocalRecovery(native);
  }finally{native.close();}
 }else if(phase==='first-launch-restore-request'){
  try{simctl('terminate',udid,app);}catch(error){if(!String(error.stderr??'').includes('found nothing to terminate'))throw error;}
  const nativeDirectory=join(simctl('get_app_container',udid,app,'data'),'Documents/SQLite');
  const native=new DatabaseSync(join(nativeDirectory,'puptime-v2.db'),{readOnly:true});
  try{
   assert.equal(native.prepare('SELECT account_id FROM local_sync_owner').get().account_id,context.userId);
   assert.equal(native.prepare('SELECT count(*) n FROM local_sync_outbox').get().n,0,'Back up and acknowledge the synthetic source before resetting it.');
   assert.equal(native.prepare('SELECT count(*) n FROM puppies').get().n,1);
   assert.equal(native.prepare('SELECT cloud_pet_id FROM local_sync_pets').get().cloud_pet_id,context.localPetId);
  }finally{native.close();}
  const backup=mkdtempSync(join(state.directory,'first-launch-source-backup-'));
  cpSync(nativeDirectory,join(backup,'SQLite'),{recursive:true});
  const cookie=await fixtureCookie();
  const summary=await (await fetch(state.url+'/api/account',{headers:{cookie,origin:state.url}})).json();
  assert.equal(summary.user.id,context.userId);assert.equal(summary.pets[0].id,context.localPetId);assert.equal(summary.pets[0].eventCount,1);
  const pull=async()=>{const response=await fetch(state.url+'/api/sync/pull?after=0',{headers:{cookie,origin:state.url}});assert.equal(response.status,200);const page=await response.json();assert.equal(page.hasMore,false);return page;};
  const initial=await pull(),deviceId='first-launch-independent-restore';
  await post('/api/cloud/enroll',{operationId:crypto.randomUUID(),deviceId,localPetId:'first-launch-other-device',name:'Review',confirmedPetId:context.localPetId},cookie);
  const puppy=initial.changes.find(record=>record.kind==='puppy'),routine=initial.changes.find(record=>record.id===cloudRecordId('routine',context.localPetId,'starter-1'));
  const event=initial.changes.find(record=>record.kind==='event'),preferences=initial.changes.find(record=>record.kind==='accountPreferences');
  assert.ok(puppy&&routine&&event&&preferences);
  const mutations=[[puppy,{name:'Basil'}],[routine,{minutes:500,reminder:true}],[event,{note:'Cloud restore review'}],[preferences,{theme:'soft-play',language:'es'}]].map(([record,patch])=>({protocolVersion:1,operationId:crypto.randomUUID(),deviceId,recordId:record.id,petId:record.petId,kind:record.kind,baseRevision:record.revision,intent:'patch',patch}));
  const result=await (await post('/api/sync/push',{mutations},cookie)).json();assert.deepEqual(result.rejected,[]);
  context.restoreBaseline=await pull();context.restoreBackup=backup;
  writeFileSync(contextPath,JSON.stringify(context),{mode:0o600});
  flow('ios-first-launch-restore-request.yaml');
  console.log('PASS source native SQLite backed up, independent same-owner HTTP client customized cloud name/routine/preferences/history, and fresh local setup explicitly requests returning sign-in.');
 }else if(phase==='first-launch-restore-verify'){
  flow('ios-cloud-resend-code.yaml');
  code=database.prepare('SELECT code FROM local_email_previews WHERE email=? ORDER BY expires_at DESC LIMIT 1').get(context.email).code;
  flow('ios-first-launch-account-verify.yaml');
  assert.equal(database.prepare('SELECT id FROM user WHERE email=?').get(context.email).id,context.userId);
   const native=new DatabaseSync(join(simctl('get_app_container',udid,app,'data'),'Documents/SQLite/puptime-v2.db'),{readOnly:true});
  try{
   assert.notEqual(native.prepare('SELECT id FROM puppies').get().id,context.localPetId);
   assert.equal(native.prepare('SELECT count(*) n FROM events').get().n,0);
   assert.equal(native.prepare('SELECT count(*) n FROM local_sync_owner').get().n,0);
   assert.equal(native.prepare('SELECT count(*) n FROM local_sync_outbox').get().n,0);
  }finally{native.close();}
  console.log('PASS actual native SDK returning sign-in exposes the existing cloud puppy on fresh SQLite without restoring or uploading anything.');
 }else if(phase==='first-launch-restore'){
  flow('ios-first-launch-restore.yaml');
  const nativePath=join(simctl('get_app_container',udid,app,'data'),'Documents/SQLite/puptime-v2.db');
  const local=await createLocalDatabase(sqliteTestConnection(nativePath));
  try{
   const pet=await local.read(sql=>sql.getFirstAsync("SELECT value FROM metadata WHERE key='active_pet_id'"));
   assert.notEqual(pet.value,context.localPetId);
   assert.equal((await local.read(sql=>sql.getFirstAsync('SELECT count(*) n FROM puppies'))).n,1);
   assert.equal((await local.read(sql=>sql.getFirstAsync('SELECT count(*) n FROM local_sync_pets'))).n,1);
   const runtime=await createLocalRuntime(local,pet.value),{storage}=runtime;
   assert.equal(await storage.loadPuppyName(),'Basil');assert.equal(await storage.loadLanguagePreference(),'es');assert.equal(await storage.loadThemePreference(),'soft-play');
   const schedule=await storage.loadSchedule(),routine=schedule.find(entry=>entry.id==='starter-1');assert.equal(schedule.length,12);assert.equal(routine.minutes,500);assert.equal(routine.reminder,true);
   const events=await storage.loadEvents();assert.equal(events.length,1);assert.equal(events[0].note,'Cloud restore review');
   assert.equal(await storage.loadNotificationDelivery(),false);assert.equal(await storage.loadFirstLaunch(),null);
   const status=await runtime.sync.status(pet.value);assert.equal(status.accountId,context.userId);assert.equal(status.state,'active');assert.equal(status.pending,0);
   const binding=await local.read(sql=>sql.getFirstAsync('SELECT cloud_pet_id FROM local_sync_pets'));assert.equal(binding.cloud_pet_id,context.localPetId);
  }finally{await local.close();}
  const cookie=await fixtureCookie(),response=await fetch(state.url+'/api/sync/pull?after=0',{headers:{cookie,origin:state.url}});assert.equal(response.status,200);
  assert.deepEqual(await response.json(),context.restoreBaseline,'A pristine restore never uploads name/routine/settings defaults or changes the remote baseline.');
   console.log('PASS actual native restore preserves confirmed cloud ID/name/routine/event/preferences, uses one new stable local puppy, leaves device alerts off, uploads no defaults, and preserves the exact cloud baseline.');
 }else if(phase==='first-launch-request'){
  const native=new DatabaseSync(join(simctl('get_app_container',udid,app,'data'),'Documents/SQLite/puptime-v2.db'),{readOnly:true});
  try{assert.equal(native.prepare('SELECT count(*) n FROM local_sync_owner').get().n,0,'Preserve owned history.');}finally{native.close();}
  writeFileSync(contextPath,JSON.stringify(context),{mode:0o600});
  flow('ios-first-launch-account-request.yaml');
  assert.ok(database.prepare('SELECT id FROM local_email_previews WHERE email=?').get(context.email));
  assert.equal(database.prepare('SELECT id FROM user WHERE email=?').get(context.email),undefined);
  flow('ios-first-launch-account-cancel.yaml');
  assert.equal(database.prepare('SELECT id FROM user WHERE email=?').get(context.email),undefined);
  flow('ios-first-launch-account-email.yaml');
  console.log('PASS actual first-open SDK email request, local challenge exit/return, and explicit resend after restart; no account is created before verification.');
 }else if(phase==='first-launch-verify'){
  code=database.prepare('SELECT code FROM local_email_previews WHERE email=? ORDER BY expires_at DESC LIMIT 1').get(context.email).code;
  mutateAuthFixture(`UPDATE verification SET expiresAt='${new Date(0).toISOString()}' WHERE identifier='sign-in-otp-${context.email}';`);
  flow('ios-cloud-expired-code.yaml');
  assert.equal(database.prepare('SELECT id FROM user WHERE email=?').get(context.email),undefined);
  flow('ios-cloud-resend-code.yaml');
  code=database.prepare('SELECT code FROM local_email_previews WHERE email=? ORDER BY expires_at DESC LIMIT 1').get(context.email).code;
  const correct=code;code=String((Number(code[0])+1)%10)+code.slice(1);
  flow('ios-cloud-wrong-code.yaml');
  assert.equal(database.prepare('SELECT id FROM user WHERE email=?').get(context.email),undefined);
  code=correct;flow('ios-first-launch-account-verify.yaml');
  const user=database.prepare('SELECT id FROM user WHERE email=?').get(context.email);assert.ok(user);
  const native=new DatabaseSync(join(simctl('get_app_container',udid,app,'data'),'Documents/SQLite/puptime-v2.db'),{readOnly:true});
  try{
   assert.equal(native.prepare('SELECT count(*) n FROM events').get().n,0);assert.equal(native.prepare('SELECT name FROM puppies').get().name,'Maple');
   assert.equal(native.prepare('SELECT count(*) n FROM local_sync_owner').get().n,0);assert.equal(native.prepare('SELECT count(*) n FROM local_sync_outbox').get().n,0);
   assert.equal(native.prepare("SELECT value FROM metadata WHERE key='first_launch_step'").get().value,'cloud');
   context.userId=user.id;context.localPetId=native.prepare('SELECT id FROM puppies').get().id;
   writeFileSync(contextPath,JSON.stringify(context),{mode:0o600});
  }finally{native.close();}
  console.log('PASS actual first-open SDK expired/wrong-code recovery and verified new account; Maple/profile remain local, cloud checkpoint resumes without enrollment or upload.');
 }else if(phase==='first-launch-enable'){
  flow('ios-first-launch-account-enable.yaml');
  const native=new DatabaseSync(join(simctl('get_app_container',udid,app,'data'),'Documents/SQLite/puptime-v2.db'),{readOnly:true});
  try{
   let drained=false;for(let i=0;i<120;i++){drained=native.prepare('SELECT count(*) n FROM local_sync_outbox').get().n===0;if(drained)break;await new Promise(resolve=>setTimeout(resolve,250));}assert.ok(drained);
   assert.equal(native.prepare('SELECT account_id FROM local_sync_owner').get().account_id,context.userId);
   assert.equal(native.prepare('SELECT count(*) n FROM events').get().n,1);
   assert.equal(native.prepare('SELECT id FROM puppies').get().id,context.localPetId);
   const binding=native.prepare('SELECT cloud_pet_id FROM local_sync_pets').get();assert.equal(binding.cloud_pet_id,context.localPetId);
   writeFileSync(contextPath,JSON.stringify(context),{mode:0o600});
   const files=readdirSync(join(state.persist,'v3/do'),{recursive:true}).filter(file=>typeof file==='string'&&file.endsWith('.sqlite'));
   let found=0;
   for(const file of files){const remote=new DatabaseSync(join(state.persist,'v3/do',file),{readOnly:true});try{
    if(!remote.prepare("SELECT name FROM sqlite_master WHERE name='records'").get()||!remote.prepare('SELECT id FROM records WHERE pet_id=? LIMIT 1').get(context.localPetId))continue;
    found++;assert.equal(remote.prepare("SELECT count(*) n FROM records WHERE pet_id=? AND kind='event' AND deleted=0").get(context.localPetId).n,1);
    assert.equal(remote.prepare('SELECT count(*) n FROM pets').get().n,1);
   }finally{remote.close();}}assert.equal(found,1);
  }finally{native.close();}
  console.log('PASS explicit first-open enrollment, walkthrough exit and first real log through the official native SDK/HTTP runner; one stable puppy and one acknowledged cloud event.');
 }else if(phase==='request'){
  writeFileSync(contextPath,JSON.stringify(context),{mode:0o600});
  flow('ios-cloud-request-email.yaml');
  assert.ok(database.prepare('SELECT id FROM local_email_previews WHERE email=?').get(context.email));
  console.log('PASS official native SDK requested a local-only preview code.');
 }else if(phase==='rate-limited'){
  code=database.prepare('SELECT code FROM local_email_previews WHERE email=? ORDER BY expires_at DESC LIMIT 1').get(context.email).code;
  flow('ios-cloud-rate-limited-code.yaml');
  console.log('PASS native SDK rate limiting offers a recoverable wait message, without claiming sign-in succeeded.');
 }else if(phase==='verify'||phase==='auth-faults'){
  if(phase==='auth-faults'){
    flow('ios-cloud-cancel-code.yaml');
    assert.equal(database.prepare('SELECT id FROM user WHERE email=?').get(context.email),undefined,'Cancelling a challenge must not create an account.');
    code=database.prepare('SELECT code FROM local_email_previews WHERE email=? ORDER BY expires_at DESC LIMIT 1').get(context.email).code;
    mutateAuthFixture(`UPDATE verification SET expiresAt='${new Date(0).toISOString()}' WHERE identifier='sign-in-otp-${context.email}';`);
    flow('ios-cloud-expired-code.yaml');
    assert.equal(database.prepare('SELECT id FROM user WHERE email=?').get(context.email),undefined,'An expired native challenge must not create an account.');
    flow('ios-cloud-resend-code.yaml');
    code=database.prepare('SELECT code FROM local_email_previews WHERE email=? ORDER BY expires_at DESC LIMIT 1').get(context.email).code;
    await post('/api/auth/sign-in/email-otp',{email:context.email,otp:code});
    flow('ios-cloud-wrong-code.yaml');
    console.log('PASS native challenge cancellation preserves free use; expired and already-consumed codes are rejected by the real SDK/service.');
    // Keep the installed plugin's three-attempt/minute security limit enabled.
    // Multiple fault scenarios share this isolated backend/IP; recovery needs
    // its actual window to elapse rather than clearing the rate-limit table.
    console.log('Waiting for the real OTP rate-limit window before recovery.');
    await new Promise(resolve=>setTimeout(resolve,60000));
  }
  flow('ios-cloud-resend-code.yaml');
  code=database.prepare('SELECT code FROM local_email_previews WHERE email=? ORDER BY expires_at DESC LIMIT 1').get(context.email)?.code;
  assert.match(code??'',/^\d{6}$/);
  const wrong=String((Number(code[0])+1)%10)+code.slice(1);
  // Private per-process environment values and raw traces are discarded after each flow.
  const correct=code;code=wrong;flow('ios-cloud-wrong-code.yaml');code=correct;
  flow('ios-cloud-verify-code.yaml');
  const user=database.prepare('SELECT id FROM user WHERE email=?').get(context.email);assert.ok(user);
  const native=new DatabaseSync(join(simctl('get_app_container',udid,app,'data'),'Documents/SQLite/puptime-v2.db'),{readOnly:true});
  try{assert.equal(native.prepare('SELECT count(*) n FROM events').get().n,1);assert.equal(native.prepare('SELECT count(*) n FROM local_sync_outbox').get().n,0);}finally{native.close();}
  context.userId=user.id;writeFileSync(contextPath,JSON.stringify(context),{mode:0o600});
  console.log('PASS actual SDK sign-in retains one local log, without local association or an upload backlog.');
 }else if(phase==='preview'){
  context.expectedAfterCombine=(context.expectedCount??1)+1;writeFileSync(contextPath,JSON.stringify(context),{mode:0o600});
  flow('ios-cloud-existing-preview.yaml');
  const native=new DatabaseSync(join(simctl('get_app_container',udid,app,'data'),'Documents/SQLite/puptime-v2.db'),{readOnly:true});
  try{
    assert.equal(native.prepare('SELECT count(*) n FROM events').get().n,1);
    assert.equal(native.prepare('SELECT count(*) n FROM local_sync_owner').get().n,0);
    assert.equal(native.prepare('SELECT count(*) n FROM local_sync_outbox').get().n,0);
  }finally{native.close();}
  console.log('PASS cancelling existing-puppy setup preserves local data with no association or upload intent.');
 }else if(phase==='combine'){
  flow('ios-cloud-existing-combine.yaml');
  const native=new DatabaseSync(join(simctl('get_app_container',udid,app,'data'),'Documents/SQLite/puptime-v2.db'),{readOnly:true});
  try{
    assert.equal(native.prepare('SELECT count(*) n FROM events').get().n,context.expectedAfterCombine);
    assert.equal(native.prepare('SELECT count(*) n FROM local_sync_outbox').get().n,0);
    assert.ok(native.prepare('SELECT note FROM events').all().some(row=>row.note==='Independent HTTP client edit'));
  }finally{native.close();}
  context.expectedCount=context.expectedAfterCombine;writeFileSync(contextPath,JSON.stringify(context),{mode:0o600});
  console.log('PASS confirmed existing-cloud association preserves old remote edits and the new local log.');
 }else if(phase==='enrollment-race'){
  assert.match(context.userId,/^[A-Za-z0-9_-]+$/);
  // Crash/restart fixture: production engine saves the original explicit intent
  // before a second real HTTP device wins enrollment. Native SDK credentials
  // remain owned by SecureStore; no session is injected into the installed app.
  simctl('terminate',udid,app);
  const nativePath=join(simctl('get_app_container',udid,app,'data'),'Documents/SQLite/puptime-v2.db');
  const local=await createLocalDatabase(sqliteTestConnection(nativePath));
  try{
    const pet=await local.read(sql=>sql.getFirstAsync("SELECT value FROM metadata WHERE key='active_pet_id'"));
    const runtime=await createLocalRuntime(local,pet.value);assert.equal((await runtime.sync.status(pet.value)).state,'local');
    const cookie=await fixtureCookie();
    const account=await (await fetch(state.url+'/api/account',{headers:{cookie,origin:state.url}})).json();
    assert.deepEqual(account.cloud,{canSync:true,canExport:true});
    await runtime.sync.prepareAssociation({accountId:context.userId,localPetId:pet.value,deviceId:runtime.deviceId,enrollment:{operationId:crypto.randomUUID(),deviceId:runtime.deviceId,localPetId:pet.value,name:'My puppy'}});
    if(!account.pets.length)await post('/api/cloud/enroll',{operationId:crypto.randomUUID(),deviceId:'native-race-other-device',localPetId:'native-race-cloud-pet',name:'Other device puppy'},cookie);
    else assert.equal(account.pets[0].id,'native-race-cloud-pet','Only this synthetic interrupted race may resume.');
  }finally{await local.close();}
  flow('ios-cloud-enrollment-rejected.yaml');
  const native=new DatabaseSync(nativePath,{readOnly:true});
  try{
    assert.equal(native.prepare('SELECT count(*) n FROM local_sync_owner').get().n,0);
    assert.equal(native.prepare('SELECT count(*) n FROM events').get().n,1);
    assert.equal(native.prepare('SELECT count(*) n FROM local_sync_outbox').get().n,0);
    context.expectedCount=2;flow('ios-cloud-outage-log.yaml');flow('ios-cloud-existing-combine.yaml');
    assert.equal(native.prepare('SELECT count(*) n FROM events').get().n,2);
    assert.equal(native.prepare('SELECT count(*) n FROM local_sync_outbox').get().n,0);
  }finally{native.close();}
  writeFileSync(contextPath,JSON.stringify(context),{mode:0o600});
  console.log('PASS installed iOS recovers a real enrollment409 after restart, retains free logging and requires same-puppy confirmation before combining.');
 }else if(phase==='access-recovery'){
  assert.match(context.userId,/^[A-Za-z0-9_-]+$/);flow('ios-cloud-account-ready.yaml');
  const native=new DatabaseSync(join(simctl('get_app_container',udid,app,'data'),'Documents/SQLite/puptime-v2.db'),{readOnly:true});
  try{
    const previousEvents=native.prepare('SELECT * FROM events ORDER BY rowid').all(),originalOwner=native.prepare('SELECT generation,account_id FROM local_sync_owner').get();
    assert.equal(originalOwner.account_id,context.userId);assert.equal(native.prepare('SELECT count(*) n FROM local_sync_outbox').get().n,0);
    const cookie=await fixtureCookie(),before=await fetch(state.url+'/api/account',{headers:{cookie,origin:state.url}});assert.equal(before.status,200);
    const summary=await before.json();assert.equal(summary.user.id,context.userId);assert.deepEqual(summary.cloud,{canSync:true,canExport:true});assert.equal(summary.pets[0].eventCount,previousEvents.length);
    const oldSessions=database.prepare('SELECT id FROM session WHERE userId=?').all(context.userId).map(row=>row.id);assert.ok(oldSessions.length>0);
    mutateAuthFixture(`UPDATE session SET expiresAt='${new Date(0).toISOString()}' WHERE userId='${context.userId}';`);
    assert.ok(database.prepare('SELECT expiresAt FROM session WHERE userId=?').all(context.userId).every(row=>Date.parse(row.expiresAt)===0));
    flow('ios-cloud-session-revoked.yaml');
    context.expectedCount=previousEvents.length+1;writeFileSync(contextPath,JSON.stringify(context),{mode:0o600});flow('ios-cloud-outage-log.yaml');
    assert.equal(native.prepare('SELECT count(*) n FROM events').get().n,context.expectedCount);assert.ok(native.prepare('SELECT count(*) n FROM local_sync_outbox').get().n>0);
    assert.deepEqual(native.prepare('SELECT generation,account_id FROM local_sync_owner').get(),originalOwner);
    for(const event of previousEvents)assert.deepEqual(native.prepare('SELECT * FROM events WHERE id=?').get(event.id),event,'Session loss must not change an existing local log.');
    const denied=await fetch(state.url+'/api/account/export',{headers:{cookie,origin:state.url}});assert.equal(denied.status,401);
    flow('ios-cloud-signin-again.yaml');code=database.prepare('SELECT code FROM local_email_previews WHERE email=? ORDER BY expires_at DESC LIMIT 1').get(context.email).code;flow('ios-cloud-recover-code.yaml');
    const fresh=database.prepare('SELECT id,createdAt,expiresAt FROM session WHERE userId=?').all(context.userId).filter(row=>!oldSessions.includes(row.id)&&Date.parse(row.expiresAt)>Date.now()&&Date.now()-Date.parse(row.createdAt)<600000);
    assert.ok(fresh.length>0,'The actual native SDK must create a new recent same-owner session.');
    assert.equal(native.prepare('SELECT count(*) n FROM events').get().n,context.expectedCount);assert.equal(native.prepare('SELECT count(*) n FROM local_sync_outbox').get().n,0);
    assert.deepEqual(native.prepare('SELECT generation,account_id FROM local_sync_owner').get(),originalOwner);
    for(const event of previousEvents)assert.deepEqual(native.prepare('SELECT * FROM events WHERE id=?').get(event.id),event);
    const renewed=await fixtureCookie(),account=await fetch(state.url+'/api/account',{headers:{cookie:renewed,origin:state.url}});assert.equal(account.status,200);
    const recovered=await account.json();assert.equal(recovered.user.id,context.userId);assert.equal(recovered.pets[0].eventCount,context.expectedCount);
    writeFileSync(contextPath,JSON.stringify(context),{mode:0o600});
    console.log('PASS installed iOS expired SDK session preserves local logs/owner/backlog and refuses private export; genuine same-owner SDK reauthentication creates a fresh session and uploads the pending log without another association.');
  }finally{native.close();}
 }else if(phase==='outage'||phase==='signout'){
  flow('ios-cloud-account-ready.yaml');
  const native=new DatabaseSync(join(simctl('get_app_container',udid,app,'data'),'Documents/SQLite/puptime-v2.db'),{readOnly:true});
  const pids=execFileSync('lsof',['-t','-iTCP:8793','-sTCP:LISTEN'],{encoding:'utf8'}).trim().split(/\s+/);assert.equal(pids.length,1);
  const pid=Number(pids[0]),parent=execFileSync('ps',['-p',String(pid),'-o','ppid='],{encoding:'utf8'}).trim();
  const command=execFileSync('ps',['-p',parent,'-o','command='],{encoding:'utf8'});assert.ok(command.includes(state.config),'Only the isolated local backend may be suspended.');
  assert.equal(native.prepare('SELECT count(*) n FROM local_sync_outbox').get().n,0);
  const previousCloudCount=native.prepare('SELECT count(*) n FROM events').get().n;
  context.expectedCount=previousCloudCount+1;
  writeFileSync(contextPath,JSON.stringify(context),{mode:0o600});
  process.kill(pid,'SIGSTOP');
  try{
    flow('ios-cloud-outage-log.yaml');
    assert.equal(native.prepare('SELECT count(*) n FROM events').get().n,context.expectedCount);
    assert.ok(native.prepare('SELECT count(*) n FROM local_sync_outbox').get().n>0);
    if(phase==='signout'){
      flow('ios-cloud-pending-signout.yaml');
      assert.equal(native.prepare('SELECT count(*) n FROM events').get().n,context.expectedCount);
      assert.equal(native.prepare('SELECT count(*) n FROM local_sync_owner').get().n,0);
      assert.equal(native.prepare('SELECT count(*) n FROM local_sync_outbox').get().n,0);
      console.log('PASS native pending sign-out supports Cancel, clears SDK credentials and detaches without deleting offline logs.');
    }else{
      // Let the configured15s HTTP deadline expire while the local save remains durable.
      await new Promise(resolve=>setTimeout(resolve,16000));
      console.log('PASS installed iOS logging remains durable during a real local service outage.');
    }
  }finally{process.kill(pid,'SIGCONT');}
  try{
    if(phase==='signout'){
      const cookie=await fixtureCookie();
      const response=await fetch(state.url+'/api/account',{headers:{cookie,origin:state.url},redirect:'error'});assert.equal(response.status,200);
      const account=await response.json();assert.equal(account.pets[0].eventCount,previousCloudCount);
      console.log('PASS offline sign-out preserves the cloud copy and never sends its detached pending log.');
    }else{
    let drained=false;
    for(let i=0;i<200;i++){drained=native.prepare('SELECT count(*) n FROM local_sync_outbox').get().n===0;if(drained)break;await new Promise(resolve=>setTimeout(resolve,250));}
    assert.ok(drained,'Native retry must acknowledge the outage backlog automatically after service recovery.');
    console.log('PASS installed iOS automatically synchronizes its retained backlog after service recovery.');
    }
  }finally{native.close();}
 }else{
  flow(phase==='resume'?'ios-cloud-resume.yaml':'ios-cloud-enable.yaml');
  console.log('PASS explicit native enrollment reaches acknowledged sync without a separate activation request.');
  const cookie=await fixtureCookie();
  const pulled=await fetch(state.url+'/api/sync/pull?after=0',{headers:{cookie,origin:state.url},redirect:'error'});assert.equal(pulled.status,200);
  const page=await pulled.json(),event=page.changes.find(record=>record.kind==='event');assert.ok(event,'Native initial history must reach the real HTTP service.');
  assert.equal(page.changes.filter(record=>record.kind==='event').length,context.expectedCount??1);
  const deviceId='native-http-qualification';
  await post('/api/cloud/enroll',{operationId:crypto.randomUUID(),deviceId,localPetId:'http-qualification-pet',name:'Qualification',confirmedPetId:event.petId},cookie);
  // The installed app remains foregrounded and idle on its synced account sheet.
  // No foreground/manual retry action follows this independent client's mutation.
  await new Promise(resolve=>setTimeout(resolve,1000));
  const result=await (await post('/api/sync/push',{mutations:[{protocolVersion:1,operationId:crypto.randomUUID(),deviceId,recordId:event.id,petId:event.petId,kind:'event',baseRevision:event.revision,intent:'patch',patch:{note:'Independent HTTP client edit'}}]},cookie)).json();
  assert.equal(result.rejected.length,0,'Independent same-owner HTTP update must be accepted.');
  const native=new DatabaseSync(join(simctl('get_app_container',udid,app,'data'),'Documents/SQLite/puptime-v2.db'),{readOnly:true});
  try{
    let seen=false;
    for(let i=0;i<100;i++){seen=native.prepare('SELECT note FROM events').all().some(row=>row.note==='Independent HTTP client edit');if(seen)break;await new Promise(resolve=>setTimeout(resolve,100));}
    assert.ok(seen,'Foreground native change subscription must pull the independent HTTP update.');
  }finally{native.close();}
  console.log('PASS installed iOS change channel receives independent HTTP edits and commits them through the normal sync runner.');
 }
}finally{database.close();}

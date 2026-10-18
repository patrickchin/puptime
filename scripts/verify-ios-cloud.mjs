// Isolated native SDK qualification. Local OTP previews stay in the private
// harness; private environment input avoids codes in source files or argv.
// Retain only redacted summaries/post-login screenshots, never raw auth traces.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync,mkdtempSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {basename,join,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
const [phase,udid]=process.argv.slice(2),app='com.patrickchin.puptime';
assert.ok(['request','verify','auth-faults','rate-limited','enable','resume','outage','preview','combine','signout','access-recovery'].includes(phase),'Use request, verify, auth-faults, rate-limited, enable, resume, outage, preview, combine, signout or access-recovery.');
const state=JSON.parse(readFileSync('/tmp/puptime-native-cloud-state.json','utf8'));
assert.ok(basename(state.directory).startsWith('puptime-native-cloud-'));assert.equal(state.url,'http://127.0.0.1:8793');
const simctl=(...args)=>execFileSync('xcrun',['simctl',...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const devices=Object.values(JSON.parse(simctl('list','devices','available','-j')).devices).flat();
assert.ok(devices.find(device=>device.udid===udid)?.name.startsWith('Puptime Native Storage '),'Use the dedicated disposable simulator.');
const contextPath=join(state.directory,'native-fixture.json');
const context=phase==='request'?{email:`native-${crypto.randomUUID()}@example.invalid`,udid}:JSON.parse(readFileSync(contextPath,'utf8'));
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
try{
 if(phase==='request'){
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
    mutateAuthFixture(`UPDATE verification SET expiresAt=0 WHERE identifier='sign-in-otp-${context.email}';`);
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
  assert.equal(database.prepare('SELECT account_id FROM cloud_accounts WHERE account_id=?').get(user.id),undefined,'Sign-in alone must not start a trial.');
  const native=new DatabaseSync(join(simctl('get_app_container',udid,app,'data'),'Documents/SQLite/puptime-v2.db'),{readOnly:true});
  try{assert.equal(native.prepare('SELECT count(*) n FROM events').get().n,1);assert.equal(native.prepare('SELECT count(*) n FROM local_sync_outbox').get().n,0);}finally{native.close();}
  context.userId=user.id;writeFileSync(contextPath,JSON.stringify(context),{mode:0o600});
  console.log('PASS actual SDK sign-in retains one local log, with no trial or upload backlog.');
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
    assert.ok(native.prepare('SELECT body FROM events').all().some(row=>JSON.parse(row.body).note==='Independent HTTP client edit'));
  }finally{native.close();}
  context.expectedCount=context.expectedAfterCombine;writeFileSync(contextPath,JSON.stringify(context),{mode:0o600});
  console.log('PASS confirmed existing-cloud association preserves old remote edits and the new local log.');
 }else if(phase==='access-recovery'){
  assert.match(context.userId,/^[A-Za-z0-9_-]+$/);
  // Restore only this synthetic entitlement after an interrupted qualifier.
  // Persist this non-secret control state before the next injected fault.
  let trial=context.accessRecovery?.trial??database.prepare('SELECT trial_started_at,trial_ends_at FROM cloud_accounts WHERE account_id=?').get(context.userId);
  assert.ok(trial);
  if(trial.trial_ends_at<=Date.now()){
    const started=Date.now();trial={trial_started_at:started,trial_ends_at:started+14*86400000};
    console.log('Restoring an abandoned synthetic entitlement before qualification.');
  }
  context.accessRecovery={trial};writeFileSync(contextPath,JSON.stringify(context),{mode:0o600});
  mutateAuthFixture(`UPDATE cloud_accounts SET trial_started_at=${trial.trial_started_at},trial_ends_at=${trial.trial_ends_at} WHERE account_id='${context.userId}';`);
  flow('ios-cloud-access-restored.yaml');
  flow('ios-cloud-account-ready.yaml');
  const native=new DatabaseSync(join(simctl('get_app_container',udid,app,'data'),'Documents/SQLite/puptime-v2.db'),{readOnly:true});
  const previousCount=native.prepare('SELECT count(*) n FROM events').get().n;
  const originalOwner=native.prepare('SELECT generation,account_id FROM local_sync_owner').get();
  try{
    mutateAuthFixture(`UPDATE cloud_accounts SET trial_started_at=0,trial_ends_at=1 WHERE account_id='${context.userId}';`);
    flow('ios-cloud-access-expired.yaml');
    context.expectedCount=previousCount+1;
    flow('ios-cloud-outage-log.yaml');
    assert.equal(native.prepare('SELECT count(*) n FROM events').get().n,context.expectedCount);
    assert.ok(native.prepare('SELECT count(*) n FROM local_sync_outbox').get().n>0);
    const cookie=await fixtureCookie();
    const account=await (await fetch(state.url+'/api/account',{headers:{cookie,origin:state.url}})).json();
    assert.equal(account.cloud.canSync,false);assert.equal(account.pets[0].eventCount,previousCount);
    const exported=await fetch(state.url+'/api/account/export',{headers:{cookie,origin:state.url}});assert.equal(exported.status,200);
    assert.equal(JSON.parse((await exported.text()).trim().split('\n').at(-1)).type,'complete');
    mutateAuthFixture(`UPDATE cloud_accounts SET trial_started_at=${trial.trial_started_at},trial_ends_at=${trial.trial_ends_at} WHERE account_id='${context.userId}';`);
    flow('ios-cloud-access-restored.yaml');
    assert.equal(native.prepare('SELECT count(*) n FROM local_sync_outbox').get().n,0);
    console.log('PASS installed iOS entitlement expiry keeps local writes/pending work and cloud export; restoring access drains the same history.');
    mutateAuthFixture(`UPDATE session SET expiresAt=0 WHERE userId='${context.userId}';`);
    flow('ios-cloud-session-revoked.yaml');
    context.expectedCount++;
    flow('ios-cloud-outage-log.yaml');
    assert.equal(native.prepare('SELECT count(*) n FROM events').get().n,context.expectedCount);
    assert.ok(native.prepare('SELECT count(*) n FROM local_sync_outbox').get().n>0);
    assert.deepEqual(native.prepare('SELECT generation,account_id FROM local_sync_owner').get(),originalOwner);
    flow('ios-cloud-signin-again.yaml');
    code=database.prepare('SELECT code FROM local_email_previews WHERE email=? ORDER BY expires_at DESC LIMIT 1').get(context.email).code;
    flow('ios-cloud-recover-code.yaml');
    assert.equal(native.prepare('SELECT count(*) n FROM events').get().n,context.expectedCount);
    assert.equal(native.prepare('SELECT count(*) n FROM local_sync_outbox').get().n,0);
    assert.deepEqual(native.prepare('SELECT generation,account_id FROM local_sync_owner').get(),originalOwner);
    assert.deepEqual({...database.prepare('SELECT trial_started_at,trial_ends_at FROM cloud_accounts WHERE account_id=?').get(context.userId)},{...trial});
    delete context.accessRecovery;writeFileSync(contextPath,JSON.stringify(context),{mode:0o600});
    console.log('PASS installed iOS revoked session preserves local logging/owner/backlog; actual SDK reauthentication resumes without another trial or association.');
  }finally{
    native.close();
    mutateAuthFixture(`UPDATE cloud_accounts SET trial_started_at=${trial.trial_started_at},trial_ends_at=${trial.trial_ends_at} WHERE account_id='${context.userId}';`);
  }
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
  const cloud=database.prepare('SELECT trial_started_at,trial_ends_at FROM cloud_accounts WHERE account_id=?').get(context.userId);assert.ok(cloud);assert.equal(cloud.trial_ends_at-cloud.trial_started_at,14*86400000);
  console.log('PASS explicit native activation grants the configured trial and reaches acknowledged sync.');
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
    for(let i=0;i<100;i++){seen=native.prepare('SELECT body FROM events').all().some(row=>JSON.parse(row.body).note==='Independent HTTP client edit');if(seen)break;await new Promise(resolve=>setTimeout(resolve,100));}
    assert.ok(seen,'Foreground native change subscription must pull the independent HTTP update.');
  }finally{native.close();}
  console.log('PASS installed iOS change channel receives independent HTTP edits and commits them through the normal sync runner.');
 }
}finally{database.close();}

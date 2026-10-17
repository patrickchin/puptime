// Isolated native SDK qualification. Local OTP previews stay in the private
// harness; private environment input avoids codes in source files or argv.
// Retain only redacted summaries/post-login screenshots, never raw auth traces.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {basename,join,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
const [phase,udid]=process.argv.slice(2),app='com.patrickchin.puptime';
assert.ok(['request','verify','enable','resume'].includes(phase),'Use request, verify, enable or resume.');
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
  execFileSync(process.env.MAESTRO_BIN??'maestro',['--device',udid,'test','-e',`TEST_EMAIL=${context.email}`,resolve('.maestro/native',name),'--test-output-dir',output],{stdio:['ignore','pipe','pipe'],env:{...process.env,MAESTRO_CLI_NO_ANALYTICS:'1',MAESTRO_TEST_CODE:code}});
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
try{
 if(phase==='request'){
  writeFileSync(contextPath,JSON.stringify(context),{mode:0o600});
  flow('ios-cloud-request-email.yaml');
  assert.ok(database.prepare('SELECT id FROM local_email_previews WHERE email=?').get(context.email));
  console.log('PASS official native SDK requested a local-only preview code.');
 }else if(phase==='verify'){
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
 }else{
  flow(phase==='resume'?'ios-cloud-resume.yaml':'ios-cloud-enable.yaml');
  const cloud=database.prepare('SELECT trial_started_at,trial_ends_at FROM cloud_accounts WHERE account_id=?').get(context.userId);assert.ok(cloud);assert.equal(cloud.trial_ends_at-cloud.trial_started_at,14*86400000);
  console.log('PASS explicit native activation grants the configured trial and reaches acknowledged sync.');
  const post=async(path,body,cookie='')=>{
    const response=await fetch(state.url+path,{method:'POST',headers:{origin:state.url,'content-type':'application/json',...(cookie?{cookie}:{})},body:JSON.stringify(body),redirect:'error'});
    assert.equal(response.status,200,'The isolated service request must succeed.');return response;
  };
  await post('/api/auth/email-otp/send-verification-otp',{email:context.email,type:'sign-in'});
  code=database.prepare('SELECT code FROM local_email_previews WHERE email=? ORDER BY expires_at DESC LIMIT 1').get(context.email).code;
  const login=await post('/api/auth/sign-in/email-otp',{email:context.email,otp:code});
  const cookie=login.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
  assert.ok(cookie);
  const pulled=await fetch(state.url+'/api/sync/pull?after=0',{headers:{cookie,origin:state.url},redirect:'error'});assert.equal(pulled.status,200);
  const page=await pulled.json(),event=page.changes.find(record=>record.kind==='event');assert.ok(event,'Native initial history must reach the real HTTP service.');
  assert.equal(page.changes.filter(record=>record.kind==='event').length,1);
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

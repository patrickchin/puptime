// Isolated LOCAL SDK/file/share qualification. Preparing this script does not
// authorize a native run. Give it the exclusive task simulator only afterward.
//
// 1. node scripts/verify-ios-cloud-export.mjs serve
// 2. Start the normal Debug Metro build with EXPO_PUBLIC_CLOUD_API_URL set to
//    http://127.0.0.1:8899 and EXPO_PUBLIC_CLOUD_ALLOW_LOCAL=1. Install separately.
// 3. node scripts/verify-ios-cloud-export.mjs request UDID --private-auth
// 4. node scripts/verify-ios-cloud-export.mjs verify UDID --private-auth
// 5. node scripts/verify-ios-cloud-export.mjs seed
// 6. node scripts/verify-ios-cloud-export.mjs acceptance UDID --record
// request/verify/resend must never be screen-recorded. Other native phases:
// open, inspect, dismiss, truncate, cancel, swipe, timeout, retry. The recorded
// feedback phase checks only inline truncate/timeout errors and their retries.
// No reset path.
import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createServer,request as httpRequest} from 'node:http';
import {backup,DatabaseSync} from 'node:sqlite';
import {createWriteStream,existsSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,realpathSync,renameSync,rmSync,writeFileSync} from 'node:fs';
import {homedir,tmpdir} from 'node:os';
import {basename,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {cloudRecordId} from '../src/cloud/record-identity.ts';
import {revisionSchema} from '../src/cloud/protocol.ts';

const [phase,udid,...flags]=process.argv.slice(2),app='com.patrickchin.puptime';
const phases=['serve','status','request','resend','verify','seed','open','inspect','dismiss','truncate','cancel','swipe','timeout','retry','acceptance','feedback','self-check'];
assert.ok(phases.includes(phase),'Use serve/status/request/resend/verify/seed/open/inspect/dismiss/truncate/cancel/swipe/timeout/retry/acceptance/feedback/self-check.');
assert.ok(flags.every(flag=>flag==='--private-auth'||flag==='--record'),'No remote target or data replacement flag is supported.');
if(['serve','status','seed','self-check'].includes(phase))assert.equal(udid,undefined,'This phase does not take a target or other arguments.');
const root=realpathSync(process.cwd());
assert.equal(root,realpathSync(fileURLToPath(new URL('..',import.meta.url))),'Run from the containing Puptime checkout.');
assert.equal(JSON.parse(readFileSync('package.json','utf8')).name,'puptime');
const digest=value=>createHash('sha256').update(value).digest('hex');
const pointer=join(tmpdir(),'puptime-ios-cloud-export-'+digest(root).slice(0,12)+'.json');
const front='http://127.0.0.1:8899',back='http://127.0.0.1:8799';
const childEnv={...process.env,CI:'1',WRANGLER_SEND_METRICS:'false',MAESTRO_CLI_NO_ANALYTICS:'1'};
const privateWrite=(path,value)=>{writeFileSync(path+'.new',JSON.stringify(value),{mode:0o600});renameSync(path+'.new',path);};
const readJson=path=>JSON.parse(readFileSync(path,'utf8'));
const cli=args=>execFileSync('npx',['wrangler',...args],{stdio:['ignore','pipe','pipe'],env:childEnv});
const simctl=(...args)=>execFileSync('xcrun',['simctl',...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const tables=['metadata','puppies','events','routines','settings','pet_settings','local_revisions','local_sync_owner','local_sync_pets','local_sync_outbox','local_sync_records','local_sync_acks','local_sync_baseline','sqlite_sequence'];
let state,context,code='',recording,recordingPath,recordingStartedAt=null;

function loadState(){
 const value=readJson(pointer);
 assert.equal(value.root,root);assert.equal(value.origin,front);assert.equal(value.backend,back);
 assert.equal(value.marker,'puptime-ios-cloud-export-v1');
 assert.ok(value.directory.startsWith(join(tmpdir(),'puptime-ios-cloud-export-')));
 assert.equal(value.persist,join(value.directory,'persist'));assert.equal(value.config,join(value.directory,'wrangler.json'));
 return value;
}
async function until(check,message,timeout=15000){
 const end=Date.now()+timeout;
 while(Date.now()<end){if(await check())return;await new Promise(resolve=>setTimeout(resolve,100));}
 throw new Error(message);
}
async function ready(){const response=await fetch(front+'/__export_qualifier',{signal:AbortSignal.timeout(3000)});assert.equal(response.status,200);assert.equal((await response.json()).instance,state.instance);}
function authDatabase(){
 for(const path of readdirSync(join(state.persist,'v3/d1'),{recursive:true}).filter(path=>String(path).endsWith('.sqlite'))){
  const db=new DatabaseSync(join(state.persist,'v3/d1',path),{readOnly:true});
  if(db.prepare("SELECT name FROM sqlite_master WHERE name='local_email_previews'").get())return db;db.close();
 }
 throw new Error('This private harness has no local OTP database.');
}
function authRead(query,...values){const db=authDatabase();try{return db.prepare(query).all(...values).map(row=>({...row}));}finally{db.close();}}
function localSnapshot(){
 const db=new DatabaseSync(context.nativePath,{readOnly:true});
 try{
  const actual=db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(row=>row.name);
  assert.deepEqual(actual,[...tables].sort(),'Inspect every current local table; do not silently omit new tables.');
  return Object.fromEntries(tables.map(table=>[table,db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all().map(row=>({...row}))]));
 }finally{db.close();}
}
function assertLocalUnchanged(){assert.deepEqual(localSnapshot(),readJson(context.baseline),'Every one of the14 local tables must remain unchanged.');}
function loadDevice(){
 const device=Object.values(JSON.parse(simctl('list','devices','available','-j')).devices).flat().find(device=>device.udid===udid);
 assert.ok(device?.name.startsWith('Puptime Native Storage ae0c cloud-export'),'Use a fresh dedicated ae0c cloud-export simulator.');
 assert.equal(device.state,'Booted','Boot/install separately after the native driver is handed over.');
 const data=simctl('get_app_container',udid,app,'data');
 if(context){assert.equal(context.udid,udid);assert.equal(context.data,data,'Preserve the enrolled fixture if the installation/container changed.');}
 return data;
}
function ensurePrivateAuth(){
 assert.ok(flags.includes('--private-auth'),'Explicit --private-auth acknowledges the unrecorded OTP phase.');
 assert.ok(!flags.includes('--record'),'Never record OTP entry.');
 const commands=execFileSync('ps',['-axo','command='],{encoding:'utf8'});
 assert.ok(!commands.split('\n').some(line=>line.includes('simctl')&&line.includes(udid)&&line.includes('recordVideo')),'Stop this device’s screen recording before private authentication.');
}
function flow(name,body,{privateAuth=false,activate=true}={}){
 const output=mkdtempSync(join(state.directory,privateAuth?'private-maestro-auth-':'maestro-export-'));
 const file=join(output,name+'.yaml'),startup=join(homedir(),'.maestro/tests'),before=new Set(existsSync(startup)?readdirSync(startup):[]);
 const activation=activate?'- launchApp:\n    stopApp: false\n    permissions: {}\n- waitForAnimationToEnd\n':'';
 writeFileSync(file,'appId: '+app+'\nname: '+name+'\n---\n'+activation+body,{mode:0o600});
 try{
  execFileSync(process.env.MAESTRO_BIN??'maestro',['--device',udid,'test','-e','TEST_EMAIL='+context.email,file,'--test-output-dir',join(output,'results')],{stdio:['ignore','pipe','pipe'],env:{...childEnv,MAESTRO_TEST_CODE:code}});
 }catch(error){
  const raw=String(error.stdout??'')+'\n'+String(error.stderr??'');
  writeFileSync(join(state.directory,basename(output)+'-'+name+'-redacted-failure.txt'),code?raw.replaceAll(code,'[REDACTED]'):raw,{mode:0o600});
  throw new Error('Native '+name+' failed; only a redacted console is retained in this private harness.');
 }finally{
  // Remove only logs demonstrably belonging to this invocation, never another
  // agent’s startup directory. Screenshots/commands can contain the typed code.
  if(privateAuth&&existsSync(startup))for(const entry of readdirSync(startup).filter(entry=>!before.has(entry))){
   const directory=join(startup,entry),log=join(directory,'maestro.log');
   if(existsSync(log)&&readFileSync(log,'utf8').includes(file))rmSync(directory,{recursive:true,force:true});
  }
  if(privateAuth)rmSync(output,{recursive:true,force:true});
 }
}
const scroll=id=>`- scrollUntilVisible:\n    element:\n      id: ${id}\n    direction: DOWN\n    speed: 40\n    waitToSettleTimeoutMs: 1000\n    visibilityPercentage: 100\n    centerElement: false\n- waitForAnimationToEnd\n`;
const openAccount=`- runFlow:\n    when:\n      visible:\n        id: screen.today\n    commands:\n      - tapOn:\n          id: nav.open\n          retryTapIfNoChange: true\n      - assertVisible:\n          id: nav.drawer\n      - scrollUntilVisible:\n          element:\n            id: nav.settings\n          direction: DOWN\n          speed: 40\n          visibilityPercentage: 100\n          centerElement: false\n      - waitForAnimationToEnd\n      - tapOn:\n          id: nav.settings\n          retryTapIfNoChange: true\n- runFlow:\n    when:\n      visible:\n        id: screen.settings\n    commands:\n      - scrollUntilVisible:\n          element:\n            id: settings.account.open\n          direction: DOWN\n          speed: 40\n          visibilityPercentage: 100\n          centerElement: false\n      - waitForAnimationToEnd\n      - tapOn:\n          id: settings.account.open\n          retryTapIfNoChange: true\n- extendedWaitUntil:\n    visible:\n      id: screen.account\n    timeout: 30000\n`;
function saveContext(){privateWrite(join(state.directory,'fixture.json'),context);}
function mode(value){assert.ok(['normal','truncate','stall'].includes(value));privateWrite(join(state.directory,'control.json'),{mode:value});}
const requests=()=>readJson(join(state.directory,'requests.json'));
function cacheFiles(){const path=join(context.data,'Library/Caches/puptime-cloud-exports');return existsSync(path)?readdirSync(path,{recursive:true}).filter(name=>String(name).endsWith('.ndjson')).map(name=>join(path,name)):[];}
async function emptyCache(){const path=join(context.data,'Library/Caches/puptime-cloud-exports');await until(()=>!existsSync(path)||readdirSync(path).length===0,'Private export files/directories were not cleared.');}
function check(value){
 const now=Date.now(),history=join(state.output,'checks.json'),checks=existsSync(history)?readJson(history):[];
 checks.push({at:new Date(now).toISOString(),recordingStartedAt:recordingStartedAt===null?null:new Date(recordingStartedAt).toISOString(),elapsedSeconds:recordingStartedAt===null?null:(now-recordingStartedAt)/1000,...value});
 writeFileSync(history,JSON.stringify(checks,null,2));
}
function begin(name){check({event:'start',phase:name});}
function evidence(name,details={}){
 const path=join(state.output,name+'.json');
 const value={phase:name,localTableCount:tables.length,localSnapshotSha256:digest(readFileSync(context.baseline)),allLocalTablesUnchanged:true,...details};
 writeFileSync(path,JSON.stringify(value,null,2));
 check({event:'passed',...value});
 console.log('PASS',name);
}
function screenshot(name){simctl('io',udid,'screenshot',join(state.output,name+'.png'));}
async function openExport(){
 assertLocalUnchanged();await emptyCache();mode('normal');
 context.openAfter=requests().length;saveContext();
 flow('export-open',openAccount+scroll('account.export')+'- extendedWaitUntil:\n    visible:\n      id: account.export\n      enabled: true\n    timeout: 30000\n- tapOn:\n    id: account.export\n- extendedWaitUntil:\n    visible: .*puptime-cloud-export.*\n    timeout: 90000\n- assertVisible: ^Copy$\n');
 screenshot('cloud-export-share-sheet');
}
async function inspectExport(){
 assertLocalUnchanged();
 await until(()=>{const rows=requests().slice(context.openAfter);return rows.length===1&&rows[0].complete;},'One actual SDK export must finish through the local proxy.');
 const request=requests().slice(context.openAfter);assert.equal(request.length,1);assert.equal(request[0].mode,'normal');
 const files=cacheFiles();assert.equal(files.length,1,'Inspect the actual native file while the share sheet remains open.');
 const bytes=readFileSync(files[0]),canonical=readFileSync(join(state.directory,request[0].capture));assert.deepEqual(bytes,canonical,'Native output must be byte-exact to this SDK request’s streamed server response.');
 const raw=bytes.toString('utf8');assert.deepEqual(Buffer.from(raw,'utf8'),bytes);
 const lines=raw.trimEnd().split('\n').map(line=>JSON.parse(line));
 assert.equal(lines[0].format,'puptime-cloud-export');assert.equal(lines[0].version,1);assert.equal(lines[0].pets[0].name,'Clover 🐶 小狗');
 const revisions=lines.filter(line=>line.type==='revision').map(({type,...revision})=>revisionSchema.parse(revision));
 assert.equal(revisions.length,1001);assert.ok(revisions.every((revision,index)=>revision.sequence===index+1&&revision.after.petId===context.cloudPet));
 assert.equal(revisions[0].after.data.note,'Cloud export 🐶 小狗 café 0');assert.equal(revisions.at(-1).after.data.note,'Cloud export 🐶 小狗 café 1000');
 assert.deepEqual(lines.at(-1),{type:'complete',cursor:1001});
 evidence('cloud-export-bytes',{revisionCount:1001,byteCount:bytes.length,sha256:digest(bytes),byteExactToActualSdkResponse:true,shareSheetStillOpen:true});
}
async function dismissExport(){
 // iOS26.5 presents a compact activity card with Copy/Save to Files but no
 // Close button. Drag only that card down; do not select a share recipient.
 flow('export-dismiss','- assertVisible: .*puptime-cloud-export.*\n- swipe:\n    start: 50%,60%\n    end: 50%,97%\n    duration: 700\n- waitForAnimationToEnd\n- assertNotVisible: .*puptime-cloud-export.*\n'+scroll('account.export')+'- extendedWaitUntil:\n    visible:\n      id: account.export\n      enabled: true\n    timeout: 30000\n',{activate:false});
 await emptyCache();assertLocalUnchanged();screenshot('cloud-export-dismissed');evidence('cloud-export-dismissed',{cacheEmpty:true});
}
async function failureExport(kind,{inlineFeedback=false}={}){
 assertLocalUnchanged();await emptyCache();mode(kind==='truncate'?'truncate':'stall');const start=requests().length;
 try{
  flow('export-'+kind+'-start',openAccount+scroll('account.export')+'- tapOn:\n    id: account.export\n');
  await until(()=>requests().slice(start).some(row=>row.complete),'The private proxy did not receive the export.');
  if(kind==='cancel'||kind==='swipe'){
   assert.equal(cacheFiles().length,1,'A stalled real stream should leave a private in-progress file before cancellation.');
   const cancellation=kind==='swipe'?'- swipe:\n    start: 50%,7%\n    end: 50%,94%\n    duration: 700\n- extendedWaitUntil:\n    visible:\n      id: screen.settings\n    timeout: 30000\n- assertNotVisible:\n    id: screen.account\n':'- tapOn:\n    id: account.export.cancel\n- extendedWaitUntil:\n    visible:\n      id: account.export\n      enabled: true\n    timeout: 30000\n- assertNotVisible:\n    id: account.error\n';
   flow('export-'+kind,scroll('account.export.cancel')+'- extendedWaitUntil:\n    visible:\n      id: account.export.cancel\n      enabled: true\n    timeout: 15000\n'+cancellation);
  }else{
   const positioning=inlineFeedback?'':'- scrollUntilVisible:\n    element:\n      id: account.error\n    direction: UP\n    speed: 40\n    visibilityPercentage: 100\n    centerElement: false\n- waitForAnimationToEnd\n';
   flow('export-'+kind+'-refused',`- extendedWaitUntil:\n    visible:\n      id: account.export\n      enabled: true\n    timeout: 90000\n${positioning}- assertVisible:\n    id: account.error\n    text: Couldn.t prepare the cloud export.*\n- assertVisible:\n    id: account.export\n    enabled: true\n`);
   // Capture immediately: no navigation/scroll or second driver startup may
   // reposition the error before the readable inline-feedback proof.
   if(inlineFeedback)screenshot('cloud-export-'+kind+'-inline-feedback');
  }
  flow('export-'+kind+'-no-share','- assertNotVisible:\n    id: account.export.cancel\n- assertNotVisible: .*puptime-cloud-export.*\n');
  await emptyCache();assertLocalUnchanged();
  const rows=requests().slice(start);assert.equal(rows.length,1);assert.equal(rows[0].mode,kind==='truncate'?'truncate':'stall');
  if(kind!=='truncate')await until(()=>requests()[start].clientClosed,'The SDK did not cancel its stalled HTTP body.');
  screenshot('cloud-export-'+kind);evidence('cloud-export-'+kind,{cacheEmpty:true,shareOpened:false,actualProxyFault:rows[0].mode,...(inlineFeedback?{inlineFeedback:true,errorAndExportVisibleWithoutPostFailureScroll:true,immediateScreenshot:'cloud-export-'+kind+'-inline-feedback.png'}:{})});
 }finally{mode('normal');}
}
async function requestCode(){
 ensurePrivateAuth();
 const resuming=!!context;
 if(resuming){assert.ok(!context.requested&&!context.verified,'Request never resets a completed challenge.');assert.match(context.email,/^native-export-[a-f0-9-]{36}@example\.invalid$/);}
 const data=loadDevice(),nativePath=join(data,'Documents/SQLite/puptime-v2.db');
 if(existsSync(nativePath)){
  const db=new DatabaseSync(nativePath,{readOnly:true});
  try{assert.equal(db.prepare('SELECT COUNT(*) n FROM local_sync_owner').get().n,0);assert.equal(db.prepare('SELECT COUNT(*) n FROM local_sync_outbox').get().n,0);assert.equal(db.prepare('SELECT COUNT(*) n FROM events').get().n,resuming?1:0,'Fresh installation or the same interrupted one-log account form only.');if(!resuming)await backup(db,join(state.directory,'native-before-request.sqlite'));}finally{db.close();}
 }
 if(!resuming){context={udid,data,nativePath,email:'native-export-'+crypto.randomUUID()+'@example.invalid'};saveContext();}
 const setup=resuming?'':'- runFlow:\n    when:\n      visible:\n        id: screen.(firstLaunch|onboarding)\n    file: '+JSON.stringify(resolve('.maestro/helpers/skip-onboarding.yaml'))+'\n- extendedWaitUntil:\n    visible:\n      id: screen.today\n    timeout: 90000\n- tapOn:\n    id: quick.pee\n';
 flow('export-auth-request',setup+openAccount+'- extendedWaitUntil:\n    visible:\n      id: account.email.input\n    timeout: 30000\n- tapOn:\n    id: account.email.input\n- eraseText\n- setClipboard: ${TEST_EMAIL}\n- pasteText\n- tapOn: ^Email address$\n- waitForAnimationToEnd\n'+scroll('account.sendCode')+'- tapOn:\n    id: account.sendCode\n- extendedWaitUntil:\n    visible:\n      id: account.code.input\n    timeout: 30000\n',{privateAuth:true});
 assert.ok(authRead('SELECT id FROM local_email_previews WHERE email=?',context.email).length);
 const snapshot=localSnapshot();assert.equal(snapshot.events.length,1);assert.equal(snapshot.local_sync_owner.length,0);assert.equal(snapshot.local_sync_outbox.length,0);
 context.baseline=join(state.directory,'native-baseline.json');privateWrite(context.baseline,snapshot);
 const db=new DatabaseSync(nativePath,{readOnly:true});try{await backup(db,join(state.directory,'native-baseline.sqlite'));}finally{db.close();}
 context.requested=true;saveContext();console.log('PASS genuine native SDK requested a private local OTP; one local log and all14-table baseline backed up.');
}
async function verifyCode(){
 ensurePrivateAuth();assert.ok(context.requested&&!context.verified);loadDevice();
 code=authRead('SELECT code FROM local_email_previews WHERE email=? AND expires_at>? ORDER BY expires_at DESC LIMIT 1',context.email,Date.now())[0]?.code;assert.match(code??'',/^\d{6}$/);
 flow('export-auth-verify',scroll('account.code.input')+'- tapOn:\n    id: account.code.input\n- eraseText\n- inputText: ${MAESTRO_TEST_CODE}\n- tapOn: ^Sign-in code$\n- waitForAnimationToEnd\n'+scroll('account.verify')+'- tapOn:\n    id: account.verify\n- extendedWaitUntil:\n    visible:\n      id: account.enable\n    timeout: 30000\n- assertVisible:\n    id: account.local.count\n    text: 1 activity log\n- assertNotVisible:\n    id: account.email.input\n',{privateAuth:true});
 assertLocalUnchanged();const user=authRead('SELECT id FROM user WHERE email=?',context.email);assert.equal(user.length,1);context.userId=user[0].id;
 context.verified=true;saveContext();console.log('PASS actual SDK OTP sign-in; no native enrollment/upload or local SQL change. Private authentication is finished; recording may begin only after seed.');
}
async function resendCode(){
 ensurePrivateAuth();assert.ok(context.requested&&!context.verified);loadDevice();
 flow('export-auth-resend',scroll('account.resend')+'- tapOn:\n    id: account.resend\n- extendedWaitUntil:\n    visible:\n      id: account.code.input\n    timeout: 30000\n',{privateAuth:true});
 assertLocalUnchanged();console.log('PASS real SDK resend for this retained private challenge; no fixture reset.');
}
async function fixturePost(path,body,cookie=''){
 const encoded=JSON.stringify(body);
 for(let attempt=0;attempt<3;attempt++){
  const response=await fetch(back+path,{method:'POST',headers:{origin:front,'content-type':'application/json',...(cookie?{cookie}:{})},body:encoded,redirect:'error',signal:AbortSignal.timeout(15000)});
  if(response.status===429&&attempt<2){
   const seconds=Number(response.headers.get('retry-after')),delay=Number.isFinite(seconds)&&seconds>0?Math.min(60000,Math.ceil(seconds*1000)):60000;
   await response.body?.cancel();console.log('Waiting for the real local service rate-limit window; retrying the identical fixture request.');
   await new Promise(resolve=>setTimeout(resolve,delay));continue;
  }
  assert.equal(response.status,200,'The scoped local HTTP fixture must succeed.');return response;
 }
}
async function fixtureCookie(){
 await fixturePost('/api/auth/email-otp/send-verification-otp',{email:context.email,type:'sign-in'});
 code=authRead('SELECT code FROM local_email_previews WHERE email=? ORDER BY expires_at DESC LIMIT 1',context.email)[0]?.code;assert.match(code??'',/^\d{6}$/);
 const login=await fixturePost('/api/auth/sign-in/email-otp',{email:context.email,otp:code});const identity=await login.json();assert.equal(identity.user.id,context.userId);
 const cookie=login.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');assert.ok(cookie);
 return cookie;
}
async function seedCloud(){
 assert.ok(context.verified&&!context.seeded,'Seed exactly once; retained fixture is never reset.');
 const cookie=await fixtureCookie();
 if(!context.seedPlan){context.seedPlan={pet:'export-pet-'+crypto.randomUUID(),enrollment:crypto.randomUUID(),operations:Array.from({length:1001},()=>crypto.randomUUID())};saveContext();}
 const pet=context.seedPlan.pet,device='export-http-fixture';
 await fixturePost('/api/cloud/enroll',{operationId:context.seedPlan.enrollment,deviceId:device,localPetId:pet,name:'Clover 🐶 小狗'},cookie);
 for(let start=0;start<1001;start+=50){
  const mutations=Array.from({length:Math.min(50,1001-start)},(_,offset)=>({protocolVersion:1,operationId:context.seedPlan.operations[start+offset],deviceId:device,recordId:cloudRecordId('event',pet,'export-'+(start+offset)),petId:pet,kind:'event',baseRevision:0,intent:'create',patch:{type:'pee',at:1000000+start+offset,source:'app',note:'Cloud export 🐶 小狗 café '+(start+offset)}}));
  const result=await(await fixturePost('/api/sync/push',{mutations},cookie)).json();assert.deepEqual(result.rejected,[]);assert.equal(result.accepted.length,mutations.length);
 }
 context.cloudPet=pet;context.seeded=true;saveContext();
 console.log('PASS same-owner independent HTTP fixture seeded1001 Unicode cloud revisions; no native enrollment or data import was performed.');
}
async function serve(){
 if(existsSync(pointer)){const prior=readJson(pointer);assert.ok(!prior.pid||!(()=>{try{process.kill(prior.pid,0);return true;}catch{return false;}})(),'An existing export harness is active. Preserve it.');}
 for(const port of [8799,8899])await new Promise((resolve,reject)=>{const probe=createServer();probe.once('error',reject);probe.listen(port,'127.0.0.1',()=>probe.close(resolve));});
 const directory=mkdtempSync(join(tmpdir(),'puptime-ios-cloud-export-')),persist=join(directory,'persist'),config=join(directory,'wrangler.json');
 const settings={...readJson('wrangler.jsonc'),name:'puptime-ios-cloud-export-local',main:resolve('server/index.ts'),env:undefined,vars:{ENVIRONMENT:'local',AUTH_BASE_URL:front,WEB_ORIGINS:front,AUTH_SECRET:crypto.randomUUID()+crypto.randomUUID()}};
 settings.d1_databases=settings.d1_databases.map(value=>({...value,migrations_dir:resolve(value.migrations_dir)}));privateWrite(config,settings);
 const output=resolve('output/verification/ios-cloud-export',new Date().toISOString().replace(/[:.]/g,'-'));mkdirSync(output,{recursive:true});
 state={marker:'puptime-ios-cloud-export-v1',root,directory,persist,config,origin:front,backend:back,instance:crypto.randomUUID(),output,pid:process.pid};privateWrite(pointer,state);mode('normal');privateWrite(join(directory,'requests.json'),[]);
 cli(['d1','migrations','apply','AUTH_DB','--local','--config',config,'--persist-to',persist]);
 const worker=spawn('npx',['wrangler','dev','--local','--ip','127.0.0.1','--port','8799','--config',config,'--persist-to',persist],{env:childEnv,stdio:['ignore','pipe','pipe'],detached:true});
 const workerLog=createWriteStream(join(directory,'worker-private.log'),{mode:0o600});worker.stdout.pipe(workerLog,{end:false});worker.stderr.pipe(workerLog,{end:false});
 const rows=[];
 const proxy=createServer((request,response)=>{
  if(request.url==='/__export_qualifier'){response.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});response.end(JSON.stringify({instance:state.instance}));return;}
  if(!request.url?.startsWith('/api/')){response.writeHead(404);response.end();return;}
  const exporting=request.method==='POST'&&request.url==='/api/account/export';
  // The local fault proxy needs NDJSON line boundaries, not compressed wire
  // bytes. All account/cookie/request headers otherwise pass through unchanged.
  const upstream=httpRequest(back+request.url,{method:request.method,headers:{...request.headers,'accept-encoding':'identity'}},async incoming=>{
   if(!exporting||incoming.statusCode!==200){response.writeHead(incoming.statusCode,incoming.headers);incoming.pipe(response);return;}
   const {mode}=readJson(join(directory,'control.json')),row={mode,capture:'export-response-'+crypto.randomUUID()+'.ndjson',complete:false,clientClosed:false};rows.push(row);
   const save=()=>privateWrite(join(directory,'requests.json'),rows);save();response.on('close',()=>{row.clientClosed=true;save();});
   const headers={...incoming.headers};delete headers['content-length'];response.writeHead(incoming.statusCode,headers);
   const capture=createWriteStream(join(directory,row.capture),{mode:0o600});let lines=0,ended=false;
   try{
    for await(const chunk of incoming){
     if(!capture.write(chunk))await new Promise(resolve=>capture.once('drain',resolve));
     if(mode==='normal'){if(!response.destroyed&&!response.write(chunk))await new Promise(resolve=>{const done=()=>{response.off('drain',done);response.off('close',done);resolve();};response.once('drain',done);response.once('close',done);});continue;}
     if(ended)continue;
     let end=-1;for(let index=0;index<chunk.length;index++)if(chunk[index]===10&&++lines===(mode==='truncate'?6:1)){end=index+1;break;}
     const part=end<0?chunk:chunk.subarray(0,end);if(!response.destroyed)response.write(part);
     if(end>=0){ended=true;if(mode==='truncate')response.end();}
    }
    await new Promise(resolve=>capture.end(resolve));row.complete=true;save();if(mode==='normal')response.end();
   }catch{capture.destroy();row.failed=true;save();response.destroy();}
  });
  upstream.on('error',()=>{if(!response.headersSent)response.writeHead(503);response.end();});request.pipe(upstream);
 });
 try{
  await until(async()=>{try{return(await fetch(back+'/health',{signal:AbortSignal.timeout(1000)})).ok;}catch{return false;}},'Private Worker did not start.',45000);
  await new Promise((resolve,reject)=>{proxy.once('error',reject);proxy.listen(8899,'127.0.0.1',resolve);});
  console.log('READY isolated native export: '+front+'; private state '+pointer+'; public evidence '+output+'. No native action performed.');
  await new Promise(resolve=>{process.once('SIGINT',resolve);process.once('SIGTERM',resolve);});
 }finally{proxy.closeAllConnections();proxy.close();try{process.kill(-worker.pid,'SIGTERM');}catch{}workerLog.end();console.log('Stopped only this local harness; private fixtures/backups retained at '+directory);}
}

if(phase==='self-check'){
 assert.equal(new Set(tables).size,14);assert.equal(new URL(front).hostname,'127.0.0.1');assert.equal(new URL(back).port,'8799');assert.equal(typeof backup,'function');
 console.log('PASS inert configuration/self-check; no service, simulator, native database or credential accessed.');
}else if(phase==='serve'){await serve();}else{
 state=loadState();await ready();
 if(existsSync(join(state.directory,'fixture.json')))context=readJson(join(state.directory,'fixture.json'));
 if(phase==='status'){console.log(JSON.stringify({ready:true,origin:state.origin,requested:!!context?.requested,verified:!!context?.verified,seeded:!!context?.seeded,output:state.output}));}
 else if(phase==='request'){await requestCode();}
 else{
  assert.ok(context);assert.match(context.email,/^native-export-[a-f0-9-]{36}@example\.invalid$/);
  if(phase==='verify')await verifyCode();else if(phase==='resend')await resendCode();else if(phase==='seed')await seedCloud();else{
   assert.ok(context.seeded&&context.verified);loadDevice();
   // Preserve all failed recordings, screenshots and check timelines. Later
   // attempts share the same immutable fixture/baseline, never the same files.
   state.output=join(state.output,phase+'-'+new Date().toISOString().replace(/[:.]/g,'-'));mkdirSync(state.output,{recursive:true});
   if(phase==='feedback'){
    // One cold restart loads the current Metro source while preserving the
    // genuine SDK session, original native baseline and all cloud fixture IDs.
    assertLocalUnchanged();simctl('terminate',udid,app);simctl('launch',udid,app);assertLocalUnchanged();
   }
   if(flags.includes('--record')){
    assert.ok(['acceptance','feedback'].includes(phase),'Recording is only available after private authentication in acceptance/feedback.');
    recordingStartedAt=Date.now();recordingPath=join(state.directory,'post-auth-export-'+recordingStartedAt+'.mov');recording=spawn('xcrun',['simctl','io',udid,'recordVideo',recordingPath],{stdio:['ignore','pipe','pipe']});recording.stdout.resume();recording.stderr.resume();
   }
   try{
    begin(phase);
    if(phase==='open')await openExport();else if(phase==='inspect')await inspectExport();else if(phase==='dismiss')await dismissExport();
    else if(['truncate','cancel','swipe','timeout'].includes(phase))await failureExport(phase);
    else if(phase==='retry'){await openExport();await inspectExport();await dismissExport();}
    else if(phase==='acceptance'){
     begin('happy-path');
     await openExport();await inspectExport();await dismissExport();
     for(const fault of ['truncate','cancel','swipe','timeout']){begin(fault);await failureExport(fault);begin(fault+'-retry');await openExport();await inspectExport();await dismissExport();}
     assertLocalUnchanged();await emptyCache();evidence('acceptance',{cacheEmpty:true,realSdk:true,cloudRevisionCount:1001,localEnrollment:false,scope:'Fresh local OTP owner, independent populated cloud fixture, actual Expo file/OS share UI and transparent local body faults. No live provider, native sync enrollment or production service claim.'});
    }else if(phase==='feedback'){
     for(const fault of ['truncate','timeout']){begin(fault);await failureExport(fault,{inlineFeedback:true});begin(fault+'-retry');await openExport();await inspectExport();await dismissExport();}
     assertLocalUnchanged();await emptyCache();evidence('feedback',{cacheEmpty:true,realSdk:true,cloudRevisionCount:1001,localEnrollment:false,faults:['truncate','timeout'],successfulByteCheckedRetries:2,noPostFailureScrolling:true,scope:'Current inline-error Metro source after one cold restart; retained local SDK owner and unchanged14-table baseline. Focused truncate/60s-timeout and actual OS-share retries only; earlier full fault matrix remains separate.'});
    }
   }catch(error){check({event:'failed',phase});throw error;}finally{
    mode('normal');
    if(recording){const exited=new Promise(resolve=>recording.once('exit',resolve));recording.kill('SIGINT');await exited;execFileSync('ffmpeg',['-nostdin','-hide_banner','-loglevel','error','-i',recordingPath,'-an','-c:v','libx264','-pix_fmt','yuv420p','-crf','20','-movflags','+faststart',join(state.output,'post-auth-export.mp4')],{stdio:['ignore','pipe','pipe']});writeFileSync(join(state.output,'recording.json'),JSON.stringify({recordingStartedAt:new Date(recordingStartedAt).toISOString(),privateRawBasename:basename(recordingPath),video:'post-auth-export.mp4',phase,privateAuthRecorded:false},null,2));}
   }
  }
 }
}

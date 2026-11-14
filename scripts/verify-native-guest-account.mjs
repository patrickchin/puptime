// Real native SDK + local Better Auth/D1/DO. No session injection or sync mocks.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawn,execFileSync} from 'node:child_process';
import {createServer,request} from 'node:http';
import {createServer as secureServer,request as secureRequest} from 'node:https';
import {connect} from 'node:net';
import {cpSync,existsSync,mkdtempSync,mkdirSync,readFileSync,readdirSync,rmSync,statSync,realpathSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir,homedir} from 'node:os';
import {dirname,isAbsolute,join,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {eventSqlColumns,eventDataFromSql} from '../src/record-sql.ts';
import {cloudRecordId,localRecordId} from '../src/cloud/record-identity.ts';
import {createLocalDatabase} from '../src/local/database.ts';
import {sqliteTestConnection} from '../src/local/sqlite-test-adapter.ts';
import {createLocalRuntime} from '../src/local/runtime-factory.ts';
import {pushResponseSchema,pullPageSchema,mutationSchema} from '../src/cloud/protocol.ts';
import {nativeSnapshot,assertNativeTransition,assertNativeDetached,assertNativeDrained,assertEmptyIosRestoreSources,capturedJson,nativeAuthUiFlags} from './native-account-evidence.mjs';
import {assertArchivedSource,nativeCodeFingerprint} from './native-runtime-inputs.mjs';
import {deleteOwnedSimulator,installTaskCleanup,ownProcess} from './native-task-cleanup.mjs';

const [platform,initialDevice,host,consent,destination='build/guest-account-'+platform,onboarding]=process.argv.slice(2);
let device=initialDevice;
assert.ok(['ios','android'].includes(platform));
assert.ok(onboarding===undefined||['--onboarding-sign-in','--account-deletion','--puppy-comparison','--offline-lifecycle','--account-isolation','--photo-lifecycle','--deletion-faults','--enrolled-runtime-upgrade'].includes(onboarding));
const android=platform==='android',deleting=onboarding==='--account-deletion',onboardingSignIn=onboarding==='--onboarding-sign-in',comparing=onboarding==='--puppy-comparison',offline=onboarding==='--offline-lifecycle',isolating=onboarding==='--account-isolation',photographing=onboarding==='--photo-lifecycle',deletionFaults=onboarding==='--deletion-faults',upgrading=onboarding==='--enrolled-runtime-upgrade';
assert.ok(!(comparing||offline||isolating||photographing||deletionFaults||upgrading)||!android,'Extended lifecycle cases use the dedicated iOS verification path.');
assert.equal(consent,'--replace-synthetic','Use PLATFORM DEVICE HOST --replace-synthetic [OUTPUT].');
const frontPort=Number(process.env.PUPTIME_ACCOUNT_PORT??8797),backPort=frontPort+2;assert.ok(Number.isInteger(frontPort)&&frontPort>1024&&frontPort<65533);
const app='com.patrickchin.puptime',output=resolve(destination),front='https://127.0.0.1:'+frontPort;
const simctl=(...args)=>execFileSync('xcrun',['simctl',...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const adb=(...args)=>execFileSync('adb',['-s',device,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
if(android){assert.match(adb('emu','avd','name'),/^Puptime_(Onboarding_2f17|SignIn_461a)/);assert.ok(existsSync(host),'Supply a debuggable native APK.');}
else{
  const devices=Object.values(JSON.parse(simctl('list','devices','available','-j')).devices).flat();
  assert.match(devices.find(item=>item.udid===device)?.name??'',/^Puptime (2f17 Onboarding|Onboarding CI|SignIn 461a|Account )/);
  assert.ok(existsSync(join(host,'Info.plist')),'Supply a current native simulator host.');
  assert.ok(execFileSync('otool',['-arch','arm64','-s','__TEXT','__entitlements',join(host,'Puptime')],{encoding:'utf8'}).includes('Contents of (__TEXT,__entitlements)'),
    'Build the simulator host with CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- so SecureStore has its simulator entitlements.');
}
mkdirSync(output,{recursive:true});
const privateDir=mkdtempSync(join(tmpdir(),'puptime-2f17-account-')),persist=join(privateDir,'state'),configPath=join(privateDir,'wrangler.json');
const config={...JSON.parse(readFileSync('wrangler.jsonc','utf8')),name:'puptime-2f17-account',main:resolve('server/index.ts'),env:undefined,
  vars:{ENVIRONMENT:'local',AUTH_BASE_URL:front,WEB_ORIGINS:front,AUTH_SECRET:crypto.randomUUID()+crypto.randomUUID()}};
config.d1_databases=config.d1_databases.map(db=>({...db,migrations_dir:resolve(db.migrations_dir)}));
writeFileSync(configPath,JSON.stringify(config),{mode:0o600});
let worker,workerError,stopWorker,proxy,cookie='',code='',auth,iosFixtureHost,setupWindow,completed=false;
const activeStops=new Set();
const temporaryDevices=[];
const requests=new Set(),restoreNative=[],requestCounts={enroll:0,push:0};
// Backend results can be deliberately withheld. Only the native SQLite ack
// assertion below establishes that the SDK persisted a received result.
const wireAccepted=[],wirePages=[],wirePushes=[],wireFailures=[],photoTransfers=[],receipts=[],changeSockets=new Set();
let fault='online',photoFault='online',deleteFault='online',failedDeletes=0,acceptedDeletes=0,failedPhotoUploads=0,corruptPhotoDownloads=0,activeForwarded=0,wireParseErrors=0;
let certificate,activeFlow='startup',flowSequence=0,runtimePhase='older',newerSdkCookie='';
const identityRequests={sendCode:0,verifyCode:0,signOut:0};
let runtimeInputs;const runtimeBundles=new Map(),runtimeProvenance=[];
const authResponses=[];
const authRoutes={'/api/auth/get-session':'session','/api/auth/email-otp/send-verification-otp':'send-code','/api/auth/sign-in/email-otp':'verify-code','/api/auth/sign-out':'sign-out','/api/account':'account'};
const codes=new Set(),checks=[];
function wireFailure(phase,route,encoding,bytes){
 wireParseErrors++;
 const safeEncoding=['gzip','deflate','br','identity'].includes(encoding??'identity')?(encoding??'identity'):'other';
 wireFailures.push({phase,route,encoding:safeEncoding,bytes});
 writeFileSync(join(output,'wire-parse-failures.json'),JSON.stringify(wireFailures.slice(0,32),null,2)+'\n');
}
function redacted(value){
  for(const secret of [...codes,config.vars.AUTH_SECRET,cookie,...cookie.split(';').map(part=>part.trim().split('=').slice(1).join('='))].filter(Boolean))value=value.replaceAll(secret,'[REDACTED]');
  return value;
}
function run(binary,args,env=process.env,cwd=process.cwd()){
  return new Promise((resolveRun,reject)=>{
    if(task.signal){reject(new Error('Native task interrupted.'));return;}
    const child=spawn(binary,args,{env,cwd,detached:true,stdio:['ignore','pipe','pipe']}),stop=ownProcess(child);activeStops.add(stop);let raw='',timedOut=false;
    child.stdout.on('data',data=>{raw+=data;});child.stderr.on('data',data=>{raw+=data;});
    // Include hosted driver startup as well as the flow's own bounded assertions.
    const timer=setTimeout(()=>{timedOut=true;void stop();},binary==='maestro'?600000:240000);
    child.once('error',error=>{clearTimeout(timer);activeStops.delete(stop);reject(error);});child.once('close',status=>{clearTimeout(timer);activeStops.delete(stop);if(status===0&&!timedOut&&!task.signal)resolveRun(raw);else{
      raw=redacted(raw);
      writeFileSync(join(output,'failure-redacted.log'),raw,{mode:0o600});reject(new Error(`${binary} failed (${status}); see redacted log.`));
    }});
  });
}
async function flow(name,env={}){
  activeFlow=name;flowSequence++;
  const startup=join(homedir(),'.maestro/tests'),before=new Set(existsSync(startup)?readdirSync(startup):[]);
  const startedAt=Date.now(),artifacts=join(privateDir,'maestro-'+name+'-'+Date.now());
  try{
    await run('maestro',['--device',device,'test',...Object.entries({TEST_EMAIL:email,...env}).flatMap(([key,value])=>['-e',`${key}=${value}`]),resolve('.maestro/account-preservation',name+'.yaml'),'--test-output-dir',artifacts],
      {...process.env,MAESTRO_CLI_NO_ANALYTICS:'1',TEST_EMAIL:email,MAESTRO_TEST_CODE:code,...env});
    if(name==='prepare')setupWindow={startedAt,finishedAt:Date.now()};
    const screenshots=['native-delete-confirmation.png','native-delete-verify.png','native-deleted-account.png','recovered-account-history.png','my-account-returned-log.png','my-account-signed-in.png','my-account-guest.png','my-account-config-retry.png','same-name-summary.png','same-name-confirmation.png','mismatched-name-summary.png','mismatched-name-confirmation.png','offline-preserved-history.png','pending-signout-cancelled.png','native-photo-saved.png'];
    for(const path of readdirSync(artifacts,{recursive:true}).filter(path=>screenshots.some(name=>String(path).endsWith(name))))
      cpSync(join(artifacts,path),join(output,String(path).split('/').at(-1)));
    console.log('PASS native account phase: '+name);
  }catch(error){
    writeFileSync(join(output,'fixture-native-reach.json'),JSON.stringify({phase:name,configReached:requests.has('/api/config'),sessionReached:[...requests].some(path=>path.startsWith('/api/auth/get-session')),accountReached:requests.has('/api/account')},null,2)+'\n');
    // Raw auth hierarchy/screens stay private and are deleted in finally.
    const hierarchy=existsSync(artifacts)?readdirSync(artifacts,{recursive:true}).map(String).filter(path=>path.includes('hierarchy')&&path.endsWith('.json')).sort().at(-1):undefined;
    let ui={inspected:false};
    try{if(hierarchy&&statSync(join(artifacts,hierarchy)).size<=2097152)ui={inspected:true,fields:nativeAuthUiFlags(JSON.parse(readFileSync(join(artifacts,hierarchy),'utf8')),{email,code})};}catch{/* Keep the actual driver failure; record no unprojected value. */}
    writeFileSync(join(output,'fixture-auth-readiness.json'),JSON.stringify({phase:name,flowSequence,ui,responses:authResponses},null,2)+'\n');
    // These flows never enter a credential. Do not retain auth-code screenshots.
    if(!android&&['prepare','add-logs'].includes(name)){
      try{simctl('io',device,'screenshot',join(output,'failure-'+name+'.png'));}catch{}
      const hierarchy=existsSync(artifacts)?readdirSync(artifacts,{recursive:true}).map(String).filter(path=>path.includes('hierarchy')&&/\.(json|xml)$/.test(path)).sort().at(-1):undefined;
      if(hierarchy)writeFileSync(join(output,'failure-'+name+'-hierarchy.txt'),redacted(readFileSync(join(artifacts,hierarchy),'utf8')).slice(0,262144));
    }
    throw error;
  }finally{
    if(existsSync(startup))for(const directory of readdirSync(startup).filter(value=>!before.has(value))){
      const root=join(startup,directory);
      for(const file of readdirSync(root,{recursive:true}).filter(file=>String(file).endsWith('maestro.log'))){
        const path=join(root,file);let text=readFileSync(path,'utf8');
        if(!text.includes(resolve('.maestro/account-preservation',name+'.yaml')))continue;
        writeFileSync(path,redacted(text));
      }
    }
    rmSync(artifacts,{recursive:true,force:true});
  }
}
let email='native-'+crypto.randomUUID()+'@example.invalid';
const androidSnapshot=join(privateDir,'android-snapshot');
function sqliteDirectory(){
  if(!android)return join(simctl('get_app_container',device,app,'data'),'Documents/SQLite');
  // Stop the disposable app before copying SQLite/WAL, so the snapshot is stable.
  // Every subsequent UI phase reopens the actual account destination.
  adb('shell','am','force-stop',app);rmSync(androidSnapshot,{recursive:true,force:true});mkdirSync(androidSnapshot);
  try{adb('shell','run-as',app,'test','-f','files/SQLite/puptime-v2.db');}catch{return join(androidSnapshot,'files/SQLite');}
  const archive=execFileSync('adb',['-s',device,'exec-out','run-as',app,'tar','-cf','-','files/SQLite'],{stdio:['ignore','pipe','pipe'],maxBuffer:64*1024*1024});
  execFileSync('tar',['-xf','-','-C',androidSnapshot],{input:archive,stdio:['pipe','ignore','pipe']});
  return join(androidSnapshot,'files/SQLite');
}
const database=()=>new DatabaseSync(join(sqliteDirectory(),'puptime-v2.db'),{readOnly:true});
function snapshot(){const db=database();db.exec('BEGIN');try{return {
  tables:nativeSnapshot(db),
  events:db.prepare(`SELECT id,${eventSqlColumns.join(',')} FROM events ORDER BY id`).all().map(row=>({...row})),
  owner:db.prepare('SELECT * FROM local_sync_owner').all(),pending:db.prepare('SELECT COUNT(*) n FROM local_sync_outbox').get().n,
};}finally{db.exec('ROLLBACK');db.close();}}
function emptyRestorePreflight(){
  const state=snapshot();assert.equal(state.events.length,0,'Recovery starts from an empty local database.');
  if(android)return; // Android shared-store qualification remains a separate case.
  simctl('terminate',device,app);
  const data=simctl('get_app_container',device,app,'data');
  const group=execFileSync('plutil',['-extract','ExpoWidgetsAppGroupIdentifier','raw','-o','-',join(host,'Info.plist')],{encoding:'utf8'}).trim();
  assert.ok(group,'Read the actual native AppGroup entitlement.');
  const shared=simctl('get_app_container',device,app,group);
  const preferences=join(shared,'Library/Preferences',group+'.plist');
  const defaults=existsSync(preferences)?JSON.parse(execFileSync('plutil',['-convert','json','-o','-',preferences],{encoding:'utf8'})):{};
  assert.ok(temporaryDevices.includes(device),'An empty restore must use a genuinely new task simulator.');
  const baseline=snapshot().tables;writeFileSync(join(privateDir,'fresh-restore-native-baseline.json'),JSON.stringify({setupWindow,tables:baseline},null,2));
  assertEmptyIosRestoreSources({tables:baseline,sharedDirectory:shared,documentsDirectory:join(data,'Documents'),defaults,freshSetup:setupWindow});
  receipts.push({phase:'empty-device-preflight',all14TablesInspected:true,events:0,activityRevisions:0,exactFreshSetupRevisions:baseline.local_revisions.length,immutableJournalEmpty:true,widgetTimelineHistoryEmpty:true,backupHistoryEmpty:true,newTaskDevice:true});
  checks.push('iOS preflight reads all native tables, immutable shared widget files, every cached widget timeline and local backup history before cloud restore');
}
async function freshIosRestoreDevice(){
  assert.ok(!android&&iosFixtureHost);
  // An app-data clear does not establish an empty AppGroup/keychain/device.
  // A second disposable simulator makes the restoration source independent.
  const groups=JSON.parse(simctl('list','devices','available','-j')).devices;
  const [runtime,devices]=Object.entries(groups).find(([,items])=>items.some(item=>item.udid===device))??[];
  const prior=devices?.find(item=>item.udid===device);assert.ok(runtime&&prior?.deviceTypeIdentifier);
  try{simctl('terminate',device,app);}catch{}
  simctl('shutdown',device);
  device=simctl('create','Puptime Account Restore '+crypto.randomUUID().slice(0,8),prior.deviceTypeIdentifier,runtime);
  temporaryDevices.push(device);simctl('boot',device);
  await run('xcrun',['simctl','bootstatus',device,'-b']);
  simctl('keychain',device,'add-root-cert',join(privateDir,'root.crt'));
  simctl('install',device,iosFixtureHost);
}
async function remote({inspectBehindFault=false,sessionCookie=cookie,allKinds=false}={}){
  const changes=[];let after=0;
  assert.ok(sessionCookie,'Use the actual SDK session observed by the local proxy.');
  for(let pageNumber=0;pageNumber<100;pageNumber++){
  const page=await new Promise((resolvePage,reject)=>{
    const send=inspectBehindFault?request:secureRequest,origin=inspectBehindFault?'http://127.0.0.1:'+backPort:front;
    const req=send(origin+'/api/sync/pull?after='+after,{...(!inspectBehindFault&&certificate?{ca:certificate}:{}),headers:{cookie:sessionCookie,origin:front,host:new URL(front).host}},response=>{
      let body='';response.on('data',data=>{body+=data;});response.on('end',()=>{try{assert.equal(response.statusCode,200);resolvePage(JSON.parse(body));}catch(error){reject(error);}});
    });req.on('error',reject);req.end();
  });changes.push(...page.changes);if(!page.hasMore)break;assert.ok(page.cursor>after);after=page.cursor;assert.ok(pageNumber<99,'Bound the local fixture reader.');
  }
  if(allKinds)return changes;
  return changes.filter(record=>record.kind==='event'&&!record.deleted).sort((a,b)=>localRecordId(a)<localRecordId(b)?-1:localRecordId(a)>localRecordId(b)?1:0);
}
async function assertCloud(events){
  const rows=await remote();assert.equal(rows.length,events.length);
  assert.deepEqual(rows.map(record=>({id:localRecordId(record),...record.data})),events.map(row=>({id:row.id,...eventDataFromSql(row)})));
  assert.ok(rows.every(row=>row.revision===1),'Rejoining must not rewrite existing logs.');
  return rows;
}
async function signIn({associated=false}={}){
  const before=snapshot();await flow('request');
  code=auth.prepare('SELECT code FROM local_email_previews WHERE email=? ORDER BY expires_at DESC LIMIT 1').get(email)?.code;
  assert.match(code??'',/^\d{6}$/);codes.add(code);await flow(associated?'verify-associated':'verify',{EXPECTED_COUNT:String(before.events.length)});code='';
  assert.deepEqual(snapshot(),before,'Sign-in itself must preserve every event and wait for explicit backup confirmation.');
}
function mutateAuth(statement){
 const path=join(privateDir,'private.sql');writeFileSync(path,statement,{mode:0o600});
 try{execFileSync('npx',['wrangler','d1','execute','AUTH_DB','--local','--config',configPath,'--persist-to',persist,'--file',path],{env:childEnv,stdio:['ignore','pipe','pipe']});}finally{rmSync(path,{force:true});}
}
async function verifyAccountIsolation(){
 await flow('prepare');await flow('add-logs',{BATCHES:'4',EXPECTED_COUNT:'12'});await signIn();await flow('enable',{EXPECTED_COUNT:'12'});
 const accountA=snapshot().owner[0].account_id,emailA=email,cookieA=cookie,remoteA=await remote();
 await transport('offline');await flow('add-logs',{BATCHES:'1',EXPECTED_COUNT:'15'});const pending=snapshot();assert.equal(pending.pending,3);
 // Expire only this disposable identity's real server session. No native token injection.
 assert.match(accountA,/^[A-Za-z0-9_-]+$/);mutateAuth(`UPDATE session SET expiresAt='1970-01-01T00:00:00.000Z' WHERE userId='${accountA}'`);
 assert.equal((await inspectSession(cookieA)).status,401);
 await transport('online');await flow('auth-expired',{EXPECTED_COUNT:'15'});assertNativeTransition(pending.tables,snapshot().tables);
 const fencedRequests={...requestCounts};email='native-other-'+crypto.randomUUID()+'@example.invalid';await signIn({associated:true});
 const accountB=await inspectSession(cookie);assert.equal(accountB.status,200);assert.notEqual(accountB.body.user.id,accountA);
 const cookieB=cookie;assert.equal((await remote()).length,0,'A newly authenticated second account must receive none of account A’s records.');
 assertNativeTransition(pending.tables,snapshot().tables);await flow('assert-mismatch',{EXPECTED_COUNT:'15'});
 await flow('sign-out-pending',{ACTION:'cancel',EXPECTED_PENDING:'3'});assertNativeTransition(pending.tables,snapshot().tables);
 await flow('reopen-mismatch',{EXPECTED_COUNT:'15'});assertNativeTransition(pending.tables,snapshot().tables);assert.equal((await remote()).length,0);
 await flow('sign-out-pending',{ACTION:'confirm',EXPECTED_PENDING:'3'});assertNativeDetached(pending.tables,snapshot().tables);assert.equal((await inspectSession(cookieB)).status,401);assert.deepEqual(requestCounts,fencedRequests,'A different signed-in account must not even attempt enrollment or pushing the retained queue.');
 email=emailA;await signIn();await flow('enable',{EXPECTED_COUNT:'15'});assert.equal(snapshot().owner[0].account_id,accountA);assert.deepEqual(snapshot().events,pending.events);assert.deepEqual(snapshot().tables.local_revisions,pending.tables.local_revisions,'Re-combining must retain every original local revision sequence and body.');await assertCloud(pending.events);
 // Existing records retain their identity/revision; the old cookie stays expired.
 assert.equal((await inspectSession(cookieA)).status,401);const final=await remote();for(const prior of remoteA)assert.deepEqual(final.find(record=>record.id===prior.id),prior);
 const reconnected=snapshot();await flow('reopen',{EXPECTED_COUNT:'15'});assertNativeTransition(reconnected.tables,snapshot().tables);assert.deepEqual(snapshot().tables.local_revisions,pending.tables.local_revisions);assert.deepEqual(snapshot().events,pending.events);assert.equal(snapshot().pending,0);
 receipts.push({phase:'expired-session-account-isolation',accountCount:2,preservedEvents:15,pendingBefore:3,wrongAccountEvents:0,all14TablesChecked:true,oldSessionsRejected:true});
 checks.push('Expired real server session retains A’s exact14-table history/queue; actual native OTP sign-in to distinct B cannot sync or retarget it through restart/cancel; explicit logout preserves history, and signing back into A merges pending records without changing old cloud revisions.');
}
async function until(ready,message,timeout=45000){
 const deadline=Date.now()+timeout;
 while(Date.now()<deadline){if(await ready())return;await new Promise(done=>setTimeout(done,200));}
 assert.fail(message);
}
async function transport(mode){fault=mode;if(mode==='offline')for(const socket of changeSockets)socket.destroy();await until(()=>activeForwarded===0,'Settle prior local proxy requests before capturing a transition.');}
async function inspectSession(sessionCookie){
 return new Promise((resolveSession,reject)=>{const req=request('http://127.0.0.1:'+backPort+'/api/account',{headers:{cookie:sessionCookie}},response=>{let body='';response.on('data',part=>{body+=part;});response.on('end',()=>{try{resolveSession({status:response.statusCode,body:JSON.parse(body)});}catch(error){reject(error);}});});req.on('error',reject);req.setTimeout(15000,()=>req.destroy(new Error('Bound the synthetic session inspection.')));req.end();});
}
function drainReceipt(before,acceptedStart,pageStart){
 assert.equal(wireParseErrors,0,'Every captured sync response must be readable.');
 const pending=new Set(before.tables.local_sync_outbox.map(row=>row.operation_id)),accepted=new Map();
 for(const result of wireAccepted.slice(acceptedStart).filter(result=>pending.has(result.operationId))){
  if(accepted.has(result.operationId))assert.deepEqual(result,accepted.get(result.operationId),'A replay must return the identical accepted record.');
  else accepted.set(result.operationId,result);
 }
 const after=snapshot();assertNativeDrained(before.tables,after.tables,[...accepted.values()],wirePages.slice(pageStart));
 receipts.push({phase:'exact-native-drain',pending:pending.size,serverAcceptedUnique:accepted.size,nativePersistedAcknowledgements:after.tables.local_sync_acks.length-before.tables.local_sync_acks.length,events:after.events.length,all14TablesChecked:true});
 return after;
}
async function verifyOfflineLifecycle(){
 await flow('prepare');await flow('add-logs',{BATCHES:'4',EXPECTED_COUNT:'12'});await signIn();await flow('enable',{EXPECTED_COUNT:'12'});
 assert.equal(snapshot().pending,0);await assertCloud(snapshot().events);
 await transport('offline');await flow('add-logs',{BATCHES:'1',EXPECTED_COUNT:'15'});
 await until(()=>snapshot().pending===3,'Capture the three genuinely pending native writes.');
 const queued=snapshot(),acceptedStart=wireAccepted.length,pageStart=wirePages.length;
 assert.equal((await remote({inspectBehindFault:true})).length,12,'An outage cannot upload new native logs.');
 await flow('reopen-offline',{EXPECTED_COUNT:'15'});assertNativeTransition(queued.tables,snapshot().tables);
 await transport('online');await flow('resume-sync');const drained=drainReceipt(queued,acceptedStart,pageStart);await assertCloud(drained.events);
 checks.push('Three enrolled offline writes survive a real native restart and drain with exact original operation/result receipts; all14 tables permit only observed mirrors, acknowledgements and pull cursor changes. Controlled transport outage, not OS airplane mode.');

 await transport('drop-push-response-once');const lostStart=wireAccepted.length,lostPages=wirePages.length,pushStart=wirePushes.length;
 await flow('add-logs',{BATCHES:'1',EXPECTED_COUNT:'18'});await until(()=>fault==='push-offline','Observe an actual server commit whose response is lost.');
 await transport('offline');const lost=snapshot(),committedLost=new Set(wireAccepted.slice(lostStart).map(result=>result.operationId));assert.equal(lost.pending,3);assert.ok(committedLost.size>0);assert.equal((await remote({inspectBehindFault:true})).length,15+committedLost.size);
 await transport('online');await flow('resume-sync');const replayed=drainReceipt(lost,lostStart,lostPages);await assertCloud(replayed.events);
 const mutations=wirePushes.slice(pushStart).flatMap(item=>item.mutations),originals=new Map(lost.tables.local_sync_outbox.map(row=>[row.operation_id,JSON.parse(row.mutation_json)]));
 for(const [operationId,mutation] of originals){const attempts=mutations.filter(item=>item.operationId===operationId);assert.ok(attempts.length>=(committedLost.has(operationId)?2:1),'Retry every real committed operation after its lost acknowledgement.');for(const attempt of attempts)assert.deepEqual(attempt,mutation);}
 checks.push('Losing a real committed push response retries identical operation payloads, records one exact acknowledgement per operation and leaves cloud revisions at1 without duplicates.');

 await transport('offline');await flow('add-logs',{BATCHES:'1',EXPECTED_COUNT:'21'});await until(()=>snapshot().pending===3,'Capture unsent changes before pending logout.');
 const beforeCancel=snapshot(),cloudBefore=await remote({inspectBehindFault:true});
 await flow('sign-out-pending',{ACTION:'cancel',EXPECTED_PENDING:'3'});assertNativeTransition(beforeCancel.tables,snapshot().tables);assert.deepEqual(await remote({inspectBehindFault:true}),cloudBefore);
 await transport('push-offline');const oldSession=cookie;await flow('sign-out-pending',{ACTION:'confirm',EXPECTED_PENDING:'3'});assertNativeDetached(beforeCancel.tables,snapshot().tables);assert.deepEqual(snapshot().events,beforeCancel.events);assert.equal((await inspectSession(oldSession)).status,401,'The real backend must invalidate the old native SDK session when online logout succeeds.');
 await transport('online');await signIn();await flow('enable',{EXPECTED_COUNT:'21'});assert.deepEqual(snapshot().events,beforeCancel.events);assert.equal(snapshot().pending,0);await assertCloud(beforeCancel.events);
 checks.push('Cancelling logout with three unsent writes preserves every table and remote event; explicit logout detaches only expected association rows, keeps all21 logs, and same-account rejoin uploads the missing history without rewriting existing cloud records.');
 await transport('offline');await flow('add-logs',{BATCHES:'1',EXPECTED_COUNT:'24'});const fullyOffline=snapshot(),unconfirmedCookie=cookie;assert.equal(fullyOffline.pending,3);
 await flow('sign-out-pending',{ACTION:'confirm',EXPECTED_PENDING:'3'});assertNativeDetached(fullyOffline.tables,snapshot().tables);assert.equal((await inspectSession(unconfirmedCookie)).status,200,'Offline local signout cannot claim server-side session revocation.');
 await flow('reopen-guest',{EXPECTED_COUNT:'24',OFFLINE:'true'});assertNativeDetached(fullyOffline.tables,snapshot().tables);
 const detached=snapshot(),afterOfflineLogoutRequests={...requestCounts};await transport('online');await flow('reopen-guest',{EXPECTED_COUNT:'24',OFFLINE:'false'});assertNativeTransition(detached.tables,snapshot().tables);assert.deepEqual(requestCounts,afterOfflineLogoutRequests,'Online cold restart must not recover credentials or restart the detached queue implicitly.');assert.equal((await inspectSession(unconfirmedCookie)).status,200);await signIn();await flow('enable',{EXPECTED_COUNT:'24'});assert.deepEqual(snapshot().events,fullyOffline.events);assert.deepEqual(snapshot().tables.local_revisions,fullyOffline.tables.local_revisions);assert.equal(snapshot().pending,0);await assertCloud(fullyOffline.events);
 const rejoined=snapshot();await flow('reopen',{EXPECTED_COUNT:'24'});assertNativeTransition(rejoined.tables,snapshot().tables);
 receipts.push({phase:'fully-offline-logout',localCredentialsCleared:true,serverSessionExplicitlyUnconfirmed:true,retainedEvents:24,pendingBefore:3,sameAccountRejoined:true});
 checks.push('Fully disconnected native logout clears local credentials and detaches only expected association rows while preserving24logs/revisions; backend independently confirms remote session is still unrevoked, so no server-signout claim is made. Guest coldrestart and explicit same-account rejoin recover the unsent writes without duplicates.');
}
function nativePhoto(){
 const tables=snapshot().tables,id=tables.pet_settings.find(row=>row.key==='puptime.puppyPhoto.v1')?.value;
 assert.match(id??'',/^img_[a-f0-9]{32}$/);
 const path=join(simctl('get_app_container',device,app,'data'),'Documents/dog-photos',id+'.jpg'),bytes=readFileSync(path);
 assert.ok(bytes.length>4&&bytes.length<=256*1024);assert.equal(bytes[0],255);assert.equal(bytes[1],216);
 const decoded=join(privateDir,'decoded-'+id+'.png');execFileSync('sips',['-s','format','png',path,'--out',decoded],{stdio:['ignore','pipe','pipe']});
 const size=execFileSync('sips',['-g','pixelWidth','-g','pixelHeight',decoded],{encoding:'utf8'});assert.match(size,/pixelWidth: 512/);assert.match(size,/pixelHeight: 512/);
 return {id,bytes,sha256:createHash('sha256').update(bytes).digest('hex')};
}
function assertNoNativePhotoFiles(){
 const directory=join(simctl('get_app_container',device,app,'data'),'Documents/dog-photos');
 assert.deepEqual(existsSync(directory)?readdirSync(directory):[],[],'Failed download cannot leave a JPEG or temporary partial file.');
}
async function verifyPhotoLifecycle(){
 await flow('prepare');await flow('add-logs',{BATCHES:'4',EXPECTED_COUNT:'12'});
 simctl('addmedia',device,resolve('.maestro/fixtures/profile-test.jpg'));await flow('choose-photo');const photo=nativePhoto(),original=snapshot();
 await signIn();photoFault='upload-offline';await flow('enable-start');
 await until(()=>failedPhotoUploads>0,'Observe an actual native photo upload attempt failing through the controlled proxy.');
 await until(()=>snapshot().pending>0,'Photo upload failure must retain the native pending operations.');
 const waiting=snapshot();assert.ok(!(await remote({allKinds:true})).some(record=>record.kind==='puppy'&&record.data.photoId===photo.id),'Never publish the photo reference before its upload succeeds.');
 await flow('reopen-offline',{EXPECTED_COUNT:'12'});assertNativeTransition(waiting.tables,snapshot().tables);assert.equal(nativePhoto().sha256,photo.sha256);
 photoFault='online';await flow('resume-sync');await assertCloud(original.events);assert.equal(snapshot().pending,0);assert.equal(nativePhoto().sha256,photo.sha256);
 const upload=photoTransfers.filter(item=>item.method==='POST'&&item.status===200&&item.path.endsWith('/'+photo.id));assert.ok(upload.length>0);assert.ok(upload.every(item=>item.requestSHA256===photo.sha256),'The real SDK must upload the actual JPEG bytes, not File metadata or serialized JSON.');
 const cloud=await remote({allKinds:true});assert.ok(cloud.some(record=>record.kind==='puppy'&&record.data.photoId===photo.id));
 await flow('sign-out');await freshIosRestoreDevice();await flow('prepare');emptyRestorePreflight();assertNoNativePhotoFiles();
 const freshBaseline=snapshot();await signIn();photoFault='download-corrupt';await flow('enable-start');
 await until(()=>corruptPhotoDownloads>0,'Observe the native SDK reading an intentionally corrupt JPEG response.');
 await until(()=>snapshot().events.length===0,'An invalid baseline photo must not partially apply its history.');assertNoNativePhotoFiles();
 const failed=snapshot();for(const table of ['events','local_revisions','settings','pet_settings','puppies','routines'])assert.deepEqual(failed.tables[table],freshBaseline.tables[table],'Failed photo restore must retain the exact fresh baseline '+table);await flow('reopen-offline',{EXPECTED_COUNT:'0'});assertNativeTransition(failed.tables,snapshot().tables);assertNoNativePhotoFiles();
 assert.deepEqual(await remote({allKinds:true}),cloud,'Failed photo restore must not rewrite cloud history.');
 photoFault='online';await flow('resume-sync');await until(()=>snapshot().events.length===12,'Retry must finish the genuine empty-device restore.');
 assert.deepEqual(snapshot().events,original.events);assert.equal(snapshot().pending,0);const restored=nativePhoto();assert.equal(restored.id,photo.id);assert.deepEqual(restored.bytes,photo.bytes);
 assert.ok(photoTransfers.some(item=>item.method==='GET'&&item.status===200&&item.responseSHA256===photo.sha256));assert.deepEqual(await remote({allKinds:true}),cloud);
 await flow('reopen',{EXPECTED_COUNT:'12'});assert.deepEqual(snapshot().events,original.events);assert.deepEqual(nativePhoto().bytes,photo.bytes);
 receipts.push({phase:'native-photo-roundtrip',sourceJPEG:true,uiPickerAndCrop:true,width:512,height:512,bytes:photo.bytes.length,sha256:photo.sha256,failedUploads:failedPhotoUploads,rejectedCorruptDownloads:corruptPhotoDownloads,freshDeviceRestore:true,exactRestoredBytes:true});
 checks.push('Real UIKit selection/crop saves a decodable512px JPEG; actual native SDK upload failure keeps its reference/queue safe through restart, retry sends exact JPEG bytes to localR2; corrupt download leaves no partial file or applied history, then retry restores byte-identical photo plus12 original logs on a genuinely fresh device and cold restart.');
}
// Exact historical source/native cuts; the driver source is not installed app JS.
const enrolledCuts=[
 {name:'older',source:'008b4a0b7f4d8a77cc8c13d95f39001534d8fd70',tree:'7e3886c23141b4cb9843782a81566cd2aa714a84',native:'1d278f77e8e1358a1855c854462bde2c85e689f7e270fd2ea88ab0982c814971',js:'793aea3e98318fca08598782e4629e40542182bc2cbd3697f4f3533593ca5da7'},
 {name:'newer',source:'aacd58fd0a7102a629b92dbf8813496870aec21c',tree:'abb69c7d347964ad7a6cd9bcce80a8472544ab2e',native:'49933effc73d92ff29dad23179ca45a267e48708d9b2f2ff8415d4ad253c08c5',js:'cff60a5bc0f74dc39113d58d1e5c4e8d5ccc21dfb426503fbe88cb9938ccaeb6'},
];
const sha256=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const inspectCommand=(binary,args)=>execFileSync(binary,args,{encoding:'utf8',timeout:120000,stdio:['ignore','pipe','pipe']}).trim();
function readEnrolledInputs(){
 const path=process.env.PUPTIME_ENROLLED_RUNTIME_INPUTS;assert.ok(path&&isAbsolute(path));
 assert.equal(realpathSync(path),path,'Use the canonical private manifest path.');
 assert.equal(statSync(path).mode&0o777,0o600);assert.equal(statSync(dirname(path)).mode&0o777,0o700);assert.ok(statSync(path).size<2097152);
 const value=JSON.parse(readFileSync(path,'utf8'));
 assert.deepEqual([value.schemaVersion,value.status,value.stage,value.upgradeExecuted,value.appsInstalled,value.javaScriptModified],[1,'prepared','controlled-origin-enrolled-preparation',false,false,false]);
 assert.match(value.driverSource,/^[a-f0-9]{40}$/);
 for(const file of ['scripts/verify-ios-runtime-upgrade.mjs','scripts/native-runtime-inputs.mjs'])assert.equal(sha256(file),createHash('sha256').update(execFileSync('git',['show',value.driverSource+':'+file])).digest('hex'),'Revalidate the committed preparation code, not an unrelated manifest.');
 assert.equal(value.driverScriptSHA256,sha256('scripts/verify-ios-runtime-upgrade.mjs'));
 assert.equal(value.packageSHA256,sha256('package.json'));assert.equal(value.lockSHA256,sha256('package-lock.json'));
 assert.equal(value.runtimes.length,2);
 for(const [index,expected] of enrolledCuts.entries()){
  const cut=value.runtimes[index],root=join(dirname(path),'inputs',expected.name);
  assert.deepEqual([cut.name,cut.source,cut.tree],[expected.name,expected.source,expected.tree]);
  assert.equal(cut.host,join(root,'host/Puptime.app'));assert.equal(cut.sourceRoot,join(root,'source'));
  assert.equal(realpathSync(cut.host),cut.host);assert.equal(realpathSync(cut.sourceRoot),cut.sourceRoot);
  assert.equal(inspectCommand('git',['rev-parse',cut.source+'^{tree}']),cut.tree);
  const files=Object.fromEntries(inspectCommand('git',['ls-tree','-rz',cut.source]).split('\0').filter(Boolean).map(row=>{const match=row.match(/^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/s);assert.ok(match);return [match[3],{mode:match[1],blobSHA1:match[2]}];}));
  assert.deepEqual(cut.sourceFiles,files);assertArchivedSource(cut.sourceRoot,files);
  assert.equal(sha256(join(cut.sourceRoot,'package.json')),value.packageSHA256);assert.equal(sha256(join(cut.sourceRoot,'package-lock.json')),value.lockSHA256);
  inspectCommand('codesign',['--verify','--deep','--strict',cut.host]);
  assert.equal(cut.signature.deepStrictVerified,true);assert.equal(sha256(join(cut.host,'_CodeSignature/CodeResources')),cut.signature.codeResourcesSHA256);
  assert.equal(sha256(join(cut.host,'Info.plist')),cut.infoPlistSHA256);assert.equal(cut.appGroup,'group.com.patrickchin.puptime');
  assert.equal(inspectCommand('plutil',['-extract','CFBundleIdentifier','raw','-o','-',join(cut.host,'Info.plist')]),app);
  assert.equal(inspectCommand('plutil',['-extract','ExpoWidgetsAppGroupIdentifier','raw','-o','-',join(cut.host,'Info.plist')]),cut.appGroup);
  assert.match(inspectCommand('xcrun',['vtool','-show-build',join(cut.host,'Puptime')]),/platform\s+IOSSIMULATOR/);
  assert.equal(sha256(join(cut.host,'Puptime')),expected.native);assert.equal(sha256(join(cut.host,'main.jsbundle')),expected.js);
  assert.equal(cut.original.nativeExecutableSHA256,expected.native);assert.equal(cut.original.javaScriptSHA256,expected.js);
  assert.deepEqual(nativeCodeFingerprint(cut.host,mkdtempSync(join(privateDir,'native-original-'))),cut.nativeCode);
 }
 return value;
}
function embeddedEntitlements(binary){return inspectCommand('otool',['-arch','arm64','-s','__TEXT','__entitlements',binary]).split('\n').filter(line=>/^[a-f0-9]{8,16}\s/i.test(line)).map(line=>line.trim().split(/\s+/).slice(1).join('')).join('');}
async function historicalBundle(name,bundleEnv){
 const cut=runtimeInputs.runtimes.find(value=>value.name===name);assert.ok(cut);assertArchivedSource(cut.sourceRoot,cut.sourceFiles);
 const directory=mkdtempSync(join(privateDir,'runtime-'+name+'-')),source=join(directory,'source'),bundle=join(directory,'Puptime.app');
 cpSync(cut.sourceRoot,source,{recursive:true});cpSync(cut.host,bundle,{recursive:true});
 symlinkSync(realpathSync('node_modules'),join(source,'node_modules'),'dir');
 const originalEntitlements=embeddedEntitlements(join(bundle,'Puptime'));assert.ok(originalEntitlements);
 await run('node',[resolve('node_modules/expo/bin/cli'),'export:embed','--entry-file','index.ts','--platform','ios','--dev','false','--bytecode','--reset-cache','--max-workers','2','--bundle-output',join(bundle,'main.jsbundle'),'--assets-dest',bundle],bundleEnv,source);
 assert.ok(readFileSync(join(bundle,'main.jsbundle')).includes(Buffer.from(front)),'Use the same controlled origin in both exact historical sources.');
 await run('codesign',['--force','--deep','--sign','-',bundle]);inspectCommand('codesign',['--verify','--deep','--strict',bundle]);
 assert.equal(sha256(join(bundle,'Info.plist')),cut.infoPlistSHA256);assert.equal(embeddedEntitlements(join(bundle,'Puptime')),originalEntitlements);
 const code=nativeCodeFingerprint(bundle,mkdtempSync(join(privateDir,'native-resigned-')));
 const text=values=>Object.fromEntries(Object.entries(values).map(([path,{fileSHA256,...value}])=>[path,value]));
 assert.deepEqual(text(code),text(cut.nativeCode),'Private origin export/signing must preserve every native __text section and architecture.');
 const proof={name,source:cut.source,tree:cut.tree,originalNativeSHA256:cut.original.nativeExecutableSHA256,originalJavaScriptSHA256:cut.original.javaScriptSHA256,controlledJavaScriptSHA256:sha256(join(bundle,'main.jsbundle')),resignedExecutableSHA256:sha256(join(bundle,'Puptime')),nativeTextPreserved:true,embeddedEntitlementsPreserved:true,infoPlistPreserved:true};
 runtimeBundles.set(name,{bundle,proof});runtimeProvenance.push(proof);writeFileSync(join(output,'controlled-runtime-provenance.json'),JSON.stringify({stage:'controlled-origin-bundle-preparation',upgradeExecuted:false,originModified:true,originalInstalledBytes:false,runtimes:runtimeProvenance},null,2)+'\n');
 return bundle;
}
function assertInstalledHistorical(name){const {bundle,proof}=runtimeBundles.get(name),installed=simctl('get_app_container',device,app,'app');assert.equal(sha256(join(installed,'main.jsbundle')),proof.controlledJavaScriptSHA256);assert.equal(sha256(join(installed,'Puptime')),proof.resignedExecutableSHA256);assert.equal(sha256(join(installed,'Info.plist')),sha256(join(bundle,'Info.plist')));proof.installedVerified=true;}
async function verifyEnrolledRuntimeUpgrade(){
 assertInstalledHistorical('older');await flow('prepare');await flow('add-logs',{BATCHES:'4',EXPECTED_COUNT:'12'});await signIn();await flow('enable',{EXPECTED_COUNT:'12'});
 const enrolled=snapshot(),owner=enrolled.owner[0].account_id,cloudBefore=await assertCloud(enrolled.events);assert.equal(enrolled.pending,0);
 await transport('offline');await flow('add-logs',{BATCHES:'1',EXPECTED_COUNT:'15'});await until(()=>snapshot().pending===3,'Capture three original old-runtime pending mutations.');
 simctl('terminate',device,app);const queued=snapshot(),acceptedStart=wireAccepted.length,pageStart=wirePages.length;
 assert.equal((await remote({inspectBehindFault:true})).length,12);const identityBefore={...identityRequests},enrollBefore=requestCounts.enroll;
 const bundle=await historicalBundle('newer',{...childEnv,CI:'false',EXPO_PUBLIC_CLOUD_API_URL:front});
 simctl('install',device,bundle);assertInstalledHistorical('newer');assertNativeTransition(queued.tables,snapshot().tables);
 runtimePhase='newer';await flow('reopen-offline',{EXPECTED_COUNT:'15'});assertNativeTransition(queued.tables,snapshot().tables);assert.deepEqual(identityRequests,identityBefore);assert.equal(requestCounts.enroll,enrollBefore);
 await transport('online');await flow('resume-sync');const drained=drainReceipt(queued,acceptedStart,pageStart);assert.deepEqual(drained.events,queued.events);assert.equal(drained.owner[0].account_id,owner);
 assert.ok(newerSdkCookie,'Observe the actual newer native SDK successful push cookie, not a retained inspector credential.');const identity=await inspectSession(newerSdkCookie);assert.equal(identity.status,200);assert.equal(identity.body.user.id,owner);
 const cloudAfter=await assertCloud(drained.events);for(const record of cloudBefore)assert.deepEqual(cloudAfter.find(value=>value.id===record.id),record);
 assert.deepEqual(identityRequests,identityBefore);assert.equal(requestCounts.enroll,enrollBefore);
 const stable=snapshot();await flow('reopen',{EXPECTED_COUNT:'15'});assertNativeTransition(stable.tables,snapshot().tables);assert.deepEqual(await remote(),cloudAfter);assert.deepEqual(identityRequests,identityBefore);assert.equal(requestCounts.enroll,enrollBefore);
 receipts.push({phase:'enrolled-runtime-replacement',oldLocalEvents:15,oldRemoteEvents:12,pendingPreserved:3,all14TablesChecked:true,savedSdkIdentityVerified:true,noReauthenticationOrEnrollment:true,finalCloudEvents:15,finalRestartExact14Tables:true});
 checks.push('Exact historical old/new sources on their separately attested native hosts, rebuilt only for the same temporary HTTPS origin; real old UI/SDK enrolls12logs and leaves3offline writes. Without uninstall/reset/re-auth, installing newer preserves every table/payload/generation, actual newer SDK drains3exact acknowledgements under the original account, and15cloud records/revisions plus all14tables survive cold restart. Controlled origin/ad-hoc resign, not untouched-original, numeric store, provider or current-candidate qualification.');
}
function deletionState(tables){const row=tables.metadata.find(row=>row.key==='cloud_account_deletion');assert.ok(row);const state=JSON.parse(row.value);assert.equal(state.stage,'unconfirmed');return state;}
async function verifyDeletionFaults(){
 await flow('prepare');await flow('add-logs',{BATCHES:'4',EXPECTED_COUNT:'12'});await signIn();await flow('enable',{EXPECTED_COUNT:'12'});
 await transport('offline');await flow('add-logs',{BATCHES:'1',EXPECTED_COUNT:'15'});await transport('push-offline');
 const pending=snapshot(),accountA=pending.owner[0].account_id,oldSession=cookie,cloud=await remote();assert.equal(pending.pending,3);
 await flow('delete-cancel');assertNativeTransition(pending.tables,snapshot().tables);assert.deepEqual(await remote(),cloud);
 deleteFault='before';await flow('delete-unconfirmed',{RETRY:'false'});assert.ok(failedDeletes>0);assert.equal(auth.prepare('SELECT id FROM user WHERE id=?').all(accountA).length,1);
 const unresolved=snapshot(),marker=deletionState(unresolved.tables);assert.equal(marker.accountId,accountA);
 assertNativeTransition(pending.tables,unresolved.tables,{metadata:unresolved.tables.metadata});assert.deepEqual(unresolved.tables.metadata.filter(row=>row.key!=='cloud_account_deletion'),pending.tables.metadata);
 await flow('reopen-deletion');assertNativeTransition(unresolved.tables,snapshot().tables);const fenced={...requestCounts};
 await flow('add-logs-paused');const beforeRetry=snapshot();assert.equal(beforeRetry.events.length,18);assert.equal(beforeRetry.pending,6);assert.deepEqual(requestCounts,fenced);assert.deepEqual(await remote(),cloud);
 deleteFault='online';await flow('delete-retry-confirm');const after=snapshot();
 assertNativeDetached({...beforeRetry.tables,metadata:beforeRetry.tables.metadata.filter(row=>row.key!=='cloud_account_deletion')},after.tables);
 assert.equal(auth.prepare('SELECT id FROM user WHERE id=?').all(accountA).length,0);assert.equal((await inspectSession(oldSession)).status,401);assert.deepEqual(after.events,beforeRetry.events);
 await flow('reopen-guest',{EXPECTED_COUNT:'18',OFFLINE:'false'});assertNativeTransition(after.tables,snapshot().tables);
 checks.push('Cancelling deletion with pending writes preserves all14tables; request failure before server commit persists only an unresolved marker, retains history/queue across restart and additional local logging, and explicit retry deletes the disposable account while preserving all18logs/revisions locally.');
 // A different disposable identity provides the independent accepted-but-lost branch.
 await transport('online');email='native-delete-lost-'+crypto.randomUUID()+'@example.invalid';await signIn();await flow('enable',{EXPECTED_COUNT:'18'});
 await transport('offline');await flow('add-logs',{BATCHES:'1',EXPECTED_COUNT:'21'});await transport('push-offline');
 const beforeLost=snapshot(),accountB=beforeLost.owner[0].account_id,lostSession=cookie,acceptedBeforeLost=acceptedDeletes;deleteFault='lost';await flow('delete-unconfirmed',{RETRY:'false'});
 assert.equal(acceptedDeletes,acceptedBeforeLost+1,'Observe exactly this second account’s successful backend deletion before deliberately losing its response.');assert.equal(auth.prepare('SELECT id FROM user WHERE id=?').all(accountB).length,0);assert.equal((await inspectSession(lostSession)).status,401);
 const lost=snapshot();assert.equal(deletionState(lost.tables).accountId,accountB);assertNativeTransition(beforeLost.tables,lost.tables,{metadata:lost.tables.metadata});assert.deepEqual(lost.tables.metadata.filter(row=>row.key!=='cloud_account_deletion'),beforeLost.tables.metadata);
 const afterLostRequests={...requestCounts},users=auth.prepare('SELECT id FROM user ORDER BY id').all();await flow('reopen-deletion');assertNativeTransition(lost.tables,snapshot().tables);
 deleteFault='online';await flow('retry-deletion-unconfirmed');assertNativeTransition(lost.tables,snapshot().tables);assert.deepEqual(auth.prepare('SELECT id FROM user ORDER BY id').all(),users);assert.deepEqual(requestCounts,afterLostRequests);
 await flow('add-logs-paused');assert.equal(snapshot().events.length,24);assert.equal(snapshot().pending,6);const final=snapshot();await flow('reopen-deletion');assertNativeTransition(final.tables,snapshot().tables);
 receipts.push({phase:'pending-deletion-faults',cancelExact14Tables:true,preCommitFailureRetriesSafely:true,successfulDeletionLocalEvents:18,acceptedLostResponseRetainsUnresolvedState:true,unconfirmedLocalEvents:24,noAutomaticReplacementIdentity:true});
 checks.push('A server-accepted deletion with lost response leaves the original unresolved barrier/queue intact across restart/retry while local logging remains usable; no automatic replacement account/enrollment or queued upload occurs. Recovery remains explicitly unconfirmed/help-required rather than falsely reported deleted.');
}
// This fixture is deliberately independent of the phone's puppy identity. Only
// the genuine native SDK's explicit confirmation may associate the two copies.
async function fixturePost(path,body){
 assert.ok(cookie);const encoded=JSON.stringify(body);
 return new Promise((resolvePost,reject)=>{
  const req=secureRequest(front+path,{method:'POST',...(certificate?{ca:certificate}:{}),headers:{cookie,origin:front,'content-type':'application/json','content-length':Buffer.byteLength(encoded)}},response=>{
   let value='';response.on('data',part=>{value+=part;});response.on('end',()=>{try{
    const parsed=JSON.parse(value);
    if(response.statusCode!==200){const category=['untrusted_origin','cloud_unavailable','unauthorized','account_deleting','forbidden','not_found','invalid_request'].includes(parsed.error)?parsed.error:'unclassified';writeFileSync(join(output,'fixture-http-error.json'),JSON.stringify({path,status:response.statusCode,category}));assert.equal(response.statusCode,200,'Independent synthetic HTTP fixture failed: '+category);}
    resolvePost(parsed);
   }catch(error){reject(error);}});
  });req.on('error',reject);req.setTimeout(15000,()=>req.destroy(new Error('Local fixture request timed out.')));req.end(encoded);
 });
}
function allLocalTables(){return snapshot().tables;}
async function verifyPuppyComparison(){
 await flow('prepare');await flow('add-logs',{BATCHES:'4',EXPECTED_COUNT:'12'});
 simctl('terminate',device,app);
 const db=database();let phoneId;try{phoneId=db.prepare('SELECT id FROM puppies').get().id;}finally{db.close();}
 const local=await createLocalDatabase(sqliteTestConnection(join(sqliteDirectory(),'puptime-v2.db')));
 try{
  const runtime=await createLocalRuntime(local,phoneId);await runtime.storage.savePuppyName('Biscuit');
  await runtime.storage.appendEvents(Array.from({length:108},(_,i)=>({id:'evt_comparison_phone_'+i,type:'pee',at:Date.now()-86400000-i*60000,source:'app',note:'Artificial comparison history'})));
 }finally{await local.close();}
 assert.equal(snapshot().events.length,120);await signIn();
 const cloudId='pet_comparison_'+crypto.randomUUID().replaceAll('-',''),deviceId='dev_comparison_fixture';assert.notEqual(cloudId,phoneId);
 const enrolled=await fixturePost('/api/cloud/enroll',{operationId:'op_comparison_enroll',deviceId,localPetId:cloudId,name:'Biscuit'});assert.equal(enrolled.petId,cloudId);
 const mutations=[{protocolVersion:1,operationId:'op_comparison_profile',deviceId,recordId:cloudId,petId:cloudId,kind:'puppy',baseRevision:0,intent:'create',patch:{name:'Biscuit'}},...Array.from({length:7},(_,i)=>({protocolVersion:1,operationId:'op_comparison_event_'+i,deviceId,recordId:cloudRecordId('event',cloudId,'evt_comparison_cloud_'+i),petId:cloudId,kind:'event',baseRevision:0,intent:'create',patch:{type:'poop',at:Date.now()-172800000-i*60000,source:'app',note:'Independent artificial cloud history'}}))];
 const seeded=await fixturePost('/api/sync/push',{mutations});assert.deepEqual(seeded.rejected,[]);assert.equal(seeded.accepted.find(result=>result.operationId==='op_comparison_profile')?.record.revision,1);
 for(const [caseName,cloudName] of [['same-name','Biscuit'],['mismatched-name','Maple']]){
  if(caseName==='mismatched-name')assert.deepEqual((await fixturePost('/api/sync/push',{mutations:[{protocolVersion:1,operationId:'op_comparison_rename',deviceId,recordId:cloudId,petId:cloudId,kind:'puppy',baseRevision:1,intent:'patch',patch:{name:cloudName}}]})).rejected,[]);
  const before=allLocalTables(),counts={...requestCounts},cloudBefore=await remote();
  await flow('comparison-preview',{PHONE_NAME:'Biscuit',CLOUD_NAME:cloudName,PHONE_COUNT:'120',CLOUD_COUNT:'7',COMPARISON_CASE:caseName});
  assert.deepEqual(allLocalTables(),before,'Native Cancel and Continue without sync preserve every local table.');
  assert.deepEqual(requestCounts,counts,'Reviewing, cancelling and staying local must not enroll or upload.');
  assert.deepEqual(await remote(),cloudBefore,'The independent cloud history must remain unchanged.');
  checks.push(caseName+': clearly labeled phone/cloud names and counts; native Cancel and Continue without sync preserve every local table and cloud event, with no enroll/push request; local fingerprint '+createHash('sha256').update(JSON.stringify(before)).digest('hex'));
 }
 const phoneBefore=snapshot().events,counts={...requestCounts};await flow('enable',{EXPECTED_COUNT:'127'});
 const after=snapshot();assert.equal(after.events.length,127);assert.equal(after.pending,0);assert.equal(after.owner.length,1);
 assert.deepEqual(after.events.filter(row=>phoneBefore.some(old=>old.id===row.id)),phoneBefore);
 assert.equal(requestCounts.enroll,counts.enroll+1);assert.ok(requestCounts.push>counts.push);
 const actual=database();try{assert.equal(actual.prepare('SELECT cloud_pet_id FROM local_sync_pets WHERE pet_id=?').get(phoneId).cloud_pet_id,cloudId);}finally{actual.close();}
 const cloudBefore=await assertCloud(after.events);await flow('reopen',{EXPECTED_COUNT:'127'});
 assert.deepEqual(snapshot().events,after.events);assert.deepEqual(await remote(),cloudBefore);
 checks.push('Only explicit native confirmation combines the two distinct identities; all127 original events retain their IDs/bodies, cloud event revisions remain1, pending work drains, and cold restart causes no duplicate or cloud rewrite.');
}

const childEnv={...process.env,CI:'1',WRANGLER_SEND_METRICS:'false'};
const task=installTaskCleanup(async()=>{
 for(const socket of changeSockets)socket.destroy();
 proxy?.closeAllConnections();proxy?.close();
 const processesStopped=(await Promise.all([...activeStops,...(stopWorker?[stopWorker]:[])].map(stop=>stop()))).every(Boolean);
 try{auth?.close();}catch{}
 if(android)try{adb('reverse','--remove','tcp:'+frontPort);}catch{}
 let nativeRestored=true;
 for(const [path,original] of restoreNative.reverse())try{if(original===null)rmSync(path,{force:true});else writeFileSync(path,original);}catch{nativeRestored=false;}
 const simulators=temporaryDevices.map(device=>deleteOwnedSimulator({device,privateDirectory:privateDir,preserve:!completed}));
 writeFileSync(join(output,'sdk-task-cleanup.json'),JSON.stringify({status:processesStopped&&nativeRestored&&simulators.every(value=>value.deleted)?'passed':'failed',processesStopped,nativeRestored,simulators},null,2)+'\n');
 if(!processesStopped||!nativeRestored||simulators.some(value=>!value.deleted))process.exitCode=1;
});
try{
  // Own both ports; never attach to another task's backend or account.
  for(const port of [frontPort,backPort])await new Promise((resolveProbe,reject)=>{const server=createServer();server.once('error',reject);server.listen(port,'127.0.0.1',()=>server.close(resolveProbe));});
  if(android){adb('install','-r',resolve(host));adb('shell','run-as',app,'id');}
  else try{simctl('terminate',device,app);}catch{}
  const old=sqliteDirectory();
  if(upgrading){assert.ok(!existsSync(join(old,'puptime-v2.db')),'Start the historical case on a genuinely fresh owned simulator.');runtimeInputs=readEnrolledInputs();}
  if(existsSync(join(old,'puptime-v2.db'))){
    const prior=database();try{assert.equal(prior.prepare('SELECT COUNT(*) n FROM local_sync_owner').get().n,0,'Do not replace another account fixture.');}finally{prior.close();}
    cpSync(old,join(privateDir,'previous-synthetic-sqlite'),{recursive:true});
  }
  await run('npx',['wrangler','d1','migrations','apply','AUTH_DB','--local','--config',configPath,'--persist-to',persist],childEnv);
  worker=spawn('npx',['wrangler','dev','--local','--ip','127.0.0.1','--port',String(backPort),'--config',configPath,'--persist-to',persist],{env:childEnv,stdio:['ignore','pipe','pipe'],detached:true});
  stopWorker=ownProcess(worker);worker.once('error',error=>{workerError=error;});worker.stdout.resume();worker.stderr.resume();
  for(let attempt=0;attempt<160;attempt++){if(workerError)throw workerError;try{if((await fetch('http://127.0.0.1:'+backPort+'/health')).ok)break;}catch{}await new Promise(resolveWait=>setTimeout(resolveWait,250));}
  const keyPath=join(privateDir,'localhost.key'),certPath=join(privateDir,'localhost.crt'),rootPath=join(privateDir,'root.crt'),rootKey=join(privateDir,'root.key'),csr=join(privateDir,'localhost.csr');
  if(!android)simctl('keychain',device,'reset');
  await run('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',rootKey,'-out',rootPath,'-days','1','-subj','/CN=Puptime fixture CA','-addext','basicConstraints=critical,CA:TRUE']);
  await run('openssl',['req','-new','-newkey','rsa:2048','-nodes','-keyout',keyPath,'-out',csr,'-subj','/CN=localhost']);
  const extensions=join(privateDir,'server.cnf');writeFileSync(extensions,'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=IP:127.0.0.1,DNS:localhost\n');
  await run('openssl',['x509','-req','-in',csr,'-CA',rootPath,'-CAkey',rootKey,'-CAcreateserial','-out',certPath,'-days','1','-extfile',extensions]);
  certificate=readFileSync(rootPath);if(!android)simctl('keychain',device,'add-root-cert',rootPath);
  const forward=(req,res)=>{
    requests.add(req.url);
    const pathname=new URL(req.url,front).pathname,route=Object.hasOwn(authRoutes,pathname)?authRoutes[pathname]:undefined;
    if(req.method==='POST'){if(route==='send-code')identityRequests.sendCode++;if(route==='verify-code')identityRequests.verifyCode++;if(route==='sign-out')identityRequests.signOut++;}
    if(route&&['GET','POST'].includes(req.method)){
      const entry={phase:activeFlow,flowSequence,route,method:req.method,status:null,state:'pending'};
      authResponses.push(entry);if(authResponses.length>64)authResponses.shift();
      const record=completed=>{if(entry.state!=='pending')return;entry.status=completed?res.statusCode:null;entry.state=completed?'completed':'closed';};
      res.once('finish',()=>record(true));res.once('close',()=>record(false));
    }

    if(req.method==='POST'&&req.url==='/api/cloud/enroll')requestCounts.enroll++;
    if(req.method==='POST'&&req.url==='/api/sync/push')requestCounts.push++;
    if(req.headers.cookie)cookie=req.headers.cookie;
    const deletingRequest=req.method==='DELETE'&&req.url==='/api/account';
    if(deletingRequest&&deleteFault==='before'){failedDeletes++;req.resume();res.writeHead(503,{'content-type':'application/json'}).end('{"error":"controlled_delete_outage"}');return;}
    const pushing=req.method==='POST'&&req.url==='/api/sync/push',pulling=req.url.startsWith('/api/sync/pull'),photoRequest=req.url.startsWith('/api/photos/');
    if(photoRequest&&req.method==='POST'&&photoFault==='upload-offline'){failedPhotoUploads++;req.resume();res.writeHead(503,{'content-type':'application/json'}).end('{"error":"controlled_photo_outage"}');return;}
    if(photoRequest&&req.method==='GET'&&photoFault==='download-corrupt'){corruptPhotoDownloads++;res.writeHead(200,{'content-type':'image/jpeg'}).end('invalid JPEG');return;}
    if(fault==='offline'){req.socket.destroy();return;}
    if(fault==='push-offline'&&pushing){req.resume();res.writeHead(503,{'content-type':'application/json'}).end('{"error":"controlled_transport_outage"}');return;}
    const body=[];if(pushing||photoRequest&&req.method==='POST'){req.on('data',part=>body.push(part));if(pushing)req.on('end',()=>{try{const bytes=Buffer.concat(body),parsed=capturedJson(bytes,req.headers['content-encoding']);wirePushes.push({mutations:parsed.mutations.map(value=>mutationSchema.parse(value))});}catch{wireFailure('request','push',req.headers['content-encoding'],Buffer.concat(body).length);}});}
    const newerNativePush=upgrading&&runtimePhase==='newer'&&pushing;
    const dropping=pushing&&fault==='drop-push-response-once'||deletingRequest&&deleteFault==='lost';activeForwarded++;
    let finished=false;const finish=()=>{if(!finished){finished=true;activeForwarded--;}};
    // Wrangler rewrites a matching Origin using the upstream scheme. Forwarding
    // the actual backend Host keeps the original HTTPS Origin intact.
    const outgoing=request('http://127.0.0.1:'+backPort+req.url,{method:req.method,headers:{...req.headers,host:'127.0.0.1:'+backPort}},incoming=>{
      const chunks=[];if(pushing||pulling||photoRequest||deletingRequest)incoming.on('data',part=>chunks.push(part));
      incoming.on('end',()=>{
        if(newerNativePush&&incoming.statusCode===200&&typeof req.headers.cookie==='string')newerSdkCookie=req.headers.cookie;
        if(incoming.statusCode===200&&(pushing||pulling))try{const bytes=Buffer.concat(chunks),parsed=capturedJson(bytes,incoming.headers['content-encoding']);if(pushing)wireAccepted.push(...pushResponseSchema.parse(parsed).accepted);else wirePages.push(pullPageSchema.parse(parsed));}catch{wireFailure('response',pushing?'push':'pull',incoming.headers['content-encoding'],Buffer.concat(chunks).length);}
        if(photoRequest)photoTransfers.push({method:req.method,path:req.url,status:incoming.statusCode,...(req.method==='POST'?{requestSHA256:createHash('sha256').update(Buffer.concat(body)).digest('hex')}:{responseSHA256:createHash('sha256').update(Buffer.concat(chunks)).digest('hex')})});
        if(deletingRequest&&incoming.statusCode===200){const reply=capturedJson(Buffer.concat(chunks),incoming.headers['content-encoding']);assert.equal(reply.success,true);acceptedDeletes++;}
        if(dropping&&incoming.statusCode===200){if(pushing)fault='push-offline';res.destroy();}
        else if(dropping){res.writeHead(incoming.statusCode,incoming.headers);res.end(Buffer.concat(chunks));}
        finish();
      });
      incoming.on('error',finish);incoming.on('close',finish);
      if(!dropping){res.writeHead(incoming.statusCode,incoming.headers);incoming.pipe(res);}
    });
    outgoing.on('error',()=>{finish();if(!res.headersSent)res.writeHead(502);res.end();});req.pipe(outgoing);
  };
  proxy=secureServer({key:readFileSync(keyPath),cert:Buffer.concat([readFileSync(certPath),certificate])},forward);
  proxy.on('tlsClientError',error=>writeFileSync(join(output,'fixture-tls-error.txt'),error.message));
  proxy.on('upgrade',(req,socket,head)=>{
    if(fault==='offline'){socket.destroy();return;}
    changeSockets.add(socket);socket.once('close',()=>changeSockets.delete(socket));
    const upstream=connect(backPort,'127.0.0.1',()=>{
      upstream.write(`${req.method} ${req.url} HTTP/1.1\r\n${Object.entries({...req.headers,host:'127.0.0.1:'+backPort}).map(([key,value])=>`${key}: ${value}`).join('\r\n')}\r\n\r\n`);
      if(head.length)upstream.write(head);socket.pipe(upstream).pipe(socket);
    });changeSockets.add(upstream);upstream.once('close',()=>changeSockets.delete(upstream));upstream.on('error',()=>socket.destroy());socket.on('error',()=>upstream.destroy());
  });
  await new Promise(resolveProxy=>proxy.listen(frontPort,'127.0.0.1',resolveProxy));
  // Prove the fixture's HTTPS chain and actual config before the app starts.
  // This request must not count as the native app reaching /api/config.
  await new Promise((resolveReady,reject)=>{
    const settle=error=>{clearTimeout(timer);if(error)reject(error);else resolveReady();};
    const timer=setTimeout(()=>{settle(new Error('Fixture HTTPS config timed out.'));req.destroy();},15000);
    const req=secureRequest(front+'/api/config',{ca:certificate},response=>{let body='';
      response.on('error',settle);response.on('aborted',()=>settle(new Error('Fixture HTTPS config response aborted.')));
      response.on('data',part=>{body+=part;if(Buffer.byteLength(body)>16384)req.destroy(new Error('Fixture HTTPS config exceeded its bounded size.'));});
      response.on('end',()=>{try{assert.equal(response.statusCode,200);const value=JSON.parse(body);assert.equal(value.protocolVersion,1);assert.equal(value.providers.email,true);settle();}catch(error){settle(error);}});
    });
    req.on('error',settle);req.end();
  });
  requests.delete('/api/config');
  writeFileSync(join(output,'fixture-readiness.json'),JSON.stringify({httpsConfigStatus:200,fixtureCertificateValidated:true,emailEnabled:true,nativeAppNotYetLaunched:true},null,2)+'\n');
  for(const file of readdirSync(join(persist,'v3/d1'),{recursive:true}).filter(file=>String(file).endsWith('.sqlite'))){
    const db=new DatabaseSync(join(persist,'v3/d1',file),{readOnly:true});
    if(db.prepare("SELECT name FROM sqlite_master WHERE name='local_email_previews'").get()){auth=db;break;}db.close();
  }
  assert.ok(auth);
  // Expo ignores --reset-cache in CI. Fixture bundles must re-inline the local
  // backend URL rather than reuse transforms from the production build.
  const bundleEnv={...childEnv,CI:'false',EXPO_PUBLIC_CLOUD_API_URL:front};
  if(android){
    adb('reverse','tcp:'+frontPort,'tcp:'+frontPort);
    assert.ok(process.env.ANDROID_HOME||process.env.ANDROID_SDK_ROOT,'Set ANDROID_HOME for the isolated native fixture build.');
    assert.equal(resolve(host),resolve('android/app/build/outputs/apk/debug/app-debug.apk'));
    // Expo's embedded Debug host does not load Metro. Build its normal release JS
    // against HTTPS, trusting only this temporary CA in the Debug source set.
    const manifest=resolve('android/app/src/debug/AndroidManifest.xml'),gradle=resolve('android/app/build.gradle');
    const trust=resolve('android/app/src/debug/res/xml/puptime_fixture_security.xml'),root=resolve('android/app/src/debug/res/raw/puptime_fixture_ca.pem');
    for(const path of [manifest,gradle,trust,root]){
      execFileSync('git',['check-ignore','-q',path]);
      restoreNative.push([path,existsSync(path)?readFileSync(path):null]);
    }
    assert.ok(!readFileSync(manifest,'utf8').includes('networkSecurityConfig'),'Do not replace another native trust configuration.');
    writeFileSync(manifest,readFileSync(manifest,'utf8').replace('<application ','<application android:networkSecurityConfig="@xml/puptime_fixture_security" '));
    mkdirSync(resolve('android/app/src/debug/res/xml'),{recursive:true});mkdirSync(resolve('android/app/src/debug/res/raw'),{recursive:true});
    writeFileSync(trust,'<network-security-config><base-config><trust-anchors><certificates src="system"/><certificates src="@raw/puptime_fixture_ca"/></trust-anchors></base-config></network-security-config>');
    cpSync(rootPath,root);
    if(!/debuggableVariants\s*=\s*\[\s*\]/.test(readFileSync(gradle,'utf8')))
      writeFileSync(gradle,readFileSync(gradle,'utf8').replace('react {','react {\n    debuggableVariants = []'));
    const nativeEnv={...childEnv,EXPO_PUBLIC_CLOUD_API_URL:front};
    const embedded=resolve('android/app/build/generated/assets/react/debug/index.android.bundle');
    await run('node',['node_modules/expo/bin/cli','export:embed','--entry-file','index.ts','--platform','android','--dev','false','--reset-cache','--max-workers','2','--bundle-output',embedded,'--assets-dest',resolve('android/app/build/generated/res/react/debug')],bundleEnv);
    assert.ok(readFileSync(embedded,'utf8').includes(front),'Embed the fixture HTTPS address, never the production API.');
    const init=join(privateDir,'embedded-fixture.gradle');
    writeFileSync(init,"gradle.projectsEvaluated { def app = gradle.rootProject.findProject(':app'); if (app != null) app.tasks.named('createBundleDebugJsAndAssets').configure { onlyIf { false } } }\n");
    await run('./gradlew',[':app:assembleDebug','--init-script',init,'--no-daemon','--stacktrace'],nativeEnv,resolve('android'));
    adb('install','-r',resolve(host));
    console.log('PASS isolated Android HTTPS native build');
  }else{
  if(upgrading){iosFixtureHost=await historicalBundle('older',bundleEnv);simctl('install',device,iosFixtureHost);assertInstalledHistorical('older');}
  else{
  const bundle=join(privateDir,'Puptime.app');cpSync(host,bundle,{recursive:true});iosFixtureHost=bundle;
  await run('node',['node_modules/expo/bin/cli','export:embed','--entry-file','index.ts','--platform','ios','--dev','false','--bytecode','--reset-cache','--max-workers','2','--bundle-output',join(bundle,'main.jsbundle'),'--assets-dest',bundle],
    bundleEnv);
  assert.ok(readFileSync(join(bundle,'main.jsbundle')).includes(Buffer.from(front)),'Embed the fixture HTTPS address, never a cached production API.');
  await run('codesign',['--force','--deep','--sign','-',bundle]);
  simctl('install',device,bundle);
  }
  }
  if(onboardingSignIn){
    await flow('onboarding-request');
    code=auth.prepare('SELECT code FROM local_email_previews WHERE email=? ORDER BY expires_at DESC LIMIT 1').get(email)?.code;
    assert.match(code??'',/^\d{6}$/);codes.add(code);
    await flow('onboarding-verify');code='';
    assert.ok(cookie,'Welcome sign-in must persist the real SDK session.');
    assert.equal(snapshot().events.length,0);assert.equal(snapshot().owner.length,0);assert.equal(snapshot().pending,0);
    assert.ok(!requests.has('/api/cloud/enroll')&&!requests.has('/api/sync/push'),'Sign-in must not enroll or upload.');
    checks.push('welcome email sign-in uses the real SDK, rejects a wrong code, resumes setup after verification and cold restart, and never enrolls or uploads');
  }
  if(comparing)await verifyPuppyComparison();
  if(offline)await verifyOfflineLifecycle();
  if(isolating)await verifyAccountIsolation();
  if(photographing)await verifyPhotoLifecycle();
  if(deletionFaults)await verifyDeletionFaults();
  if(upgrading)await verifyEnrolledRuntimeUpgrade();
  if(!onboardingSignIn&&!deleting&&!comparing&&!offline&&!isolating&&!photographing&&!deletionFaults&&!upgrading){
  await flow('prepare');assert.equal(snapshot().events.length,0);
  assert.ok(requests.has('/api/config'),'The real app must reach this isolated backend before any sign-in attempt.');
  await flow('add-logs',{BATCHES:'4',EXPECTED_COUNT:'12'});const guest=snapshot();assert.equal(guest.events.length,12);assert.equal(guest.owner.length,0);
  assert.ok(guest.events.some(event=>event.note==='Saved before and after sign-in'));
  await signIn();await flow('enable',{EXPECTED_COUNT:'12'});assert.equal(snapshot().pending,0);assert.equal(snapshot().owner.length,1);await assertCloud(guest.events);
  const owner=snapshot().owner[0].account_id;
  checks.push('12 real guest logs keep their IDs and bodies through SDK sign-in and explicit cloud enrollment');
  await flow('add-logs',{BATCHES:'1',EXPECTED_COUNT:'15'});await flow('wait-synced');
  const signed=snapshot();assert.equal(signed.events.length,15);await assertCloud(signed.events);
  await flow('sign-out');assertNativeDetached(signed.tables,snapshot().tables);
  checks.push('3 signed-in logs automatically sync; sign-out keeps all 15 local and remote logs');
  await flow('add-logs',{BATCHES:'2',EXPECTED_COUNT:'21'});const combined=snapshot();assert.equal(combined.events.length,21);
  await signIn();await flow('enable',{EXPECTED_COUNT:'21'});assert.deepEqual(snapshot().events,combined.events);assert.equal(snapshot().pending,0);
  assert.equal(snapshot().owner[0].account_id,owner);
  const cloudBefore=await assertCloud(combined.events);
  checks.push('6 more guest logs merge into the existing account without duplicates or revisions to the original logs');
  await flow('sign-out');cpSync(sqliteDirectory(),join(privateDir,'source-before-recovery'),{recursive:true});
  if(!android)await freshIosRestoreDevice();
  await flow('prepare');emptyRestorePreflight();
  await signIn();await flow('enable',{EXPECTED_COUNT:'21'});
  assert.equal(snapshot().owner[0].account_id,owner);
  assert.deepEqual(snapshot().events,combined.events,'Recover every original ID, timestamp, type and optional field.');assert.equal(snapshot().pending,0);
  assert.deepEqual(await remote(),cloudBefore,'Restoring must not mutate the remote event records.');
  await flow('reopen',{EXPECTED_COUNT:'21'});assert.deepEqual(snapshot().events,combined.events);assert.equal(snapshot().pending,0);
  checks.push('all 21 logs restore into an empty database and survive cold restart, with no remote mutation or outbound backlog');
  }
  if(deleting){
   await flow('prepare');await flow('add-logs',{BATCHES:'4',EXPECTED_COUNT:'12'});await signIn();await flow('enable',{EXPECTED_COUNT:'12'});
   const before=snapshot(),owner=before.owner[0].account_id;
   await flow('delete-cancel');assert.equal(auth.prepare('SELECT id FROM user WHERE id=?').all(owner).length,1);await assertCloud(before.events);
   const mutate=statement=>{const path=join(privateDir,'private.sql');writeFileSync(path,statement,{mode:0o600});execFileSync('npx',['wrangler','d1','execute','AUTH_DB','--local','--config',configPath,'--persist-to',persist,'--file',path],{env:childEnv,stdio:['ignore','pipe','pipe']});rmSync(path,{force:true});};
   mutate(`UPDATE session SET createdAt='1970-01-01T00:00:00.000Z' WHERE userId='${owner}'`);
   await flow('delete-request');code=auth.prepare('SELECT code FROM local_email_previews WHERE email=? ORDER BY expires_at DESC LIMIT 1').get(email)?.code;assert.match(code??'',/^\d{6}$/);codes.add(code);
   await flow('delete-verify');code='';assert.equal(auth.prepare('SELECT id FROM user WHERE id=?').all(owner).length,1);assert.deepEqual(snapshot().events,before.events);
   const now=new Date().toISOString();mutate(`INSERT INTO account(id,accountId,providerId,userId,createdAt,updatedAt) VALUES('acc_native_delete_fixture','synthetic-apple-subject','apple','${owner}','${now}','${now}')`);
   await flow('delete-confirm');assert.equal(auth.prepare('SELECT id FROM user WHERE id=?').all(owner).length,0);assert.deepEqual(snapshot().events,before.events);assert.equal(snapshot().owner.length,0);
   checks.push('native system confirmation cancels safely; stale auth uses real same-account OTP and a new confirmation; confirmed deletion removes the actual account, retains all 12 logs and offers manual Apple cleanup for a tokenless synthetic link');
  }
  assert.equal(task.signal,null);
  rmSync(join(output,'failure-redacted.log'),{force:true});
  writeFileSync(join(output,'verification.json'),JSON.stringify({status:'passed',checks,receipts,...(upgrading?{stage:'controlled-origin-enrolled-runtime-replacement',upgradeExecuted:true,originModified:true,originalInstalledBytes:false,runtimes:runtimeProvenance}:{}),scope:upgrading?'Exact historical source/native pairs with controlled-origin release JS and ad-hoc signing; actual native SDK and isolated local HTTPS Better Auth/D1/SQLite DO. No credential injection, owner data, provider OAuth, untouched-original, numeric store or final current-candidate qualification.':android?'Android Debug native host with normal embedded release JS and isolated local HTTPS Better Auth/D1/SQLite DO; actual native email SDK and Keystore. Its temporary CA is trusted only in the ignored Debug source set, restored after the run. Production onboarding is tested separately in the Release APK. No real email, production account, session injection or mocked sync.':'Release bundle and actual native email SDK with isolated local HTTPS Better Auth/D1/SQLite DO. Simulator trusts the fixture certificate. No real email, production account, session injection or mocked sync.'},null,2)+'\n');
  completed=true;
  console.log('PASS '+(upgrading?'controlled-origin enrolled runtime replacement':deletionFaults?'pending native deletion cancellation, retries and lost response':photographing?'native profile photo failure, roundtrip and restore':isolating?'expired session and account isolation':offline?'offline writes, replay and pending logout':deleting?'native account deletion':comparing?'named puppy comparison':onboardingSignIn?'welcome sign-in and session recovery':android?'guest account preservation and empty-database recovery':'guest account preservation and inspected empty-device recovery')+': '+output);
}finally{await task.run();task.dispose();}

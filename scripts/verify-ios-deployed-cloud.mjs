// Genuine deployed iOS SDK sign-in and synchronization. No reset, seed, SQL
// writer, keychain access, administrative sessions or shared fixture changes.
// request UDID HTTP_AUTH_STATE.json -> prints a new private native state path.
// verify NATIVE_STATE.json -> PUPTIME_AUTH_CODE_FILE supplies the delivered OTP.
// sync NATIVE_STATE.json -> explicit restore, one real quick log and cold reopen.
// observer-request / observer NATIVE_STATE.json -> second genuine OTP verifies
// the server owner/pet/event IDs against native SQLite, then logs out only that
// observer session. The native session/account remain intact.
// incoming-request / incoming NATIVE_STATE.json -> a genuine separate peer
// creates one durable event; SQLite must receive it before any UI interaction.
// Request/verify are private. Cloud/account screens expose the inbox: omit those
// pixels from review videos. No screenshot or raw auth artifact is published.
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {chmodSync,cpSync,existsSync,lstatSync,mkdtempSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {homedir,tmpdir} from 'node:os';
import {basename,dirname,join,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {isDeepStrictEqual} from 'node:util';
import {createCloudApi} from '../src/cloud/api.ts';
import {cloudRecordId,localRecordId} from '../src/cloud/record-identity.ts';
import {cloudRecordSchema,enrollmentSchema,mutationSchema} from '../src/cloud/protocol.ts';
import {eventDataFromSql} from '../src/record-sql.ts';

class Failure extends Error {}
const check=(value,message)=>{if(!value)throw new Failure(message);};
const app='com.patrickchin.puptime',base='https://puptime.pages.dev';
const expectedUdid='6B8DB863-3D3F-4272-9E14-9F1FEA62C8E0',expectedName='Puptime Native Storage ae0c cloud-signin';
const maestro=process.env.MAESTRO_BIN??'maestro';
function privateText(path){const stat=lstatSync(path);check(stat.isFile()&&!stat.isSymbolicLink()&&(stat.mode&0o777)===0o600&&stat.uid===process.getuid(),'Use a regular private0600 file owned by this user.');return readFileSync(path,'utf8');}
function pinnedOriginal(state){
 const record=state.expectedEvent;
 check(typeof state.authRunId==='string'&&state.expectedPetId==='auth-'+state.authRunId&&cloudRecordSchema.safeParse(record).success&&record.kind==='event'&&!record.deleted&&record.revision===1&&record.petId===state.expectedPetId&&record.id===cloudRecordId('event',state.expectedPetId,'auth-event'),'A genuine completed HTTP run must first pin its exact original puppy and full revision1 event. Use baseline-request/baseline for older states.');
 check(isDeepStrictEqual(record.data,{type:'pee',at:record.data.at,source:'app',note:'Genuine OTP qualification'}),'The pinned original event does not match the genuine qualification.');return record;
}
function restoredEvents(state,tables){
 const record=pinnedOriginal(state),owner=tables.local_sync_owner[0],binding=tables.local_sync_pets[0];
 check(tables.puppies.length===1&&tables.puppies[0].id===state.localPetId&&tables.events.length===2&&tables.local_sync_owner.length===1&&owner.account_id===state.userId&&tables.local_sync_outbox.length===0&&tables.local_sync_pets.length===1&&binding.status==='active'&&binding.pet_id===state.localPetId&&binding.cloud_pet_id===state.expectedPetId&&binding.generation===owner.generation,'Restored native data must retain the original local puppy, exact cloud puppy, genuine owner and two acknowledged events.');
 const original=tables.events.find(event=>event.id===localRecordId(record)),added=tables.events.filter(event=>event.id!==localRecordId(record));
 check(original?.pet_id===state.localPetId&&isDeepStrictEqual(eventDataFromSql(original),record.data),'Native restore changed the original event ID or a pinned event field.');
 const mirrors=tables.local_sync_records.filter(row=>row.generation===owner.generation&&row.record_id===record.id);
 check(mirrors.length===1&&isDeepStrictEqual(JSON.parse(mirrors[0].body),record),'Native restore changed the original complete cloud record, revision or sequence.');
 check(added.length===1&&added[0].pet_id===state.localPetId&&added[0].type==='pee'&&added[0].source==='app'&&(!state.nativeEventId||added[0].id===state.nativeEventId),'Native journey must add exactly one new app pee while preserving the original event.');
 return added[0];
}
function mirror(tables,generation,id){
 const rows=tables.local_sync_records.filter(row=>row.generation===generation&&row.record_id===id);
 check(rows.length===1,'Each incoming qualification event needs exactly one cloud mirror.');return JSON.parse(rows[0].body);
}
function incomingStable(state,tables,before){
 const owner=tables.local_sync_owner[0],previous=before.local_sync_owner[0];
 check(tables.local_sync_owner.length===1&&owner.account_id===state.userId&&owner.generation===previous.generation&&owner.device_id===previous.device_id&&owner.pending_pet_id===previous.pending_pet_id&&tables.local_sync_outbox.length===0&&isDeepStrictEqual(tables.puppies,before.puppies)&&isDeepStrictEqual(tables.local_sync_pets,before.local_sync_pets),'Incoming delivery changed the native owner, puppy binding/profile or left pending uploads.');
 for(const event of before.events){
  check(isDeepStrictEqual(tables.events.find(row=>row.id===event.id),event),'Incoming delivery changed one of the original two native events.');
  const id=cloudRecordId('event',state.expectedPetId,event.id),original=mirror(before,previous.generation,id);
  check(cloudRecordSchema.safeParse(original).success&&original.petId===state.expectedPetId&&isDeepStrictEqual(original.data,eventDataFromSql(event))&&isDeepStrictEqual(mirror(tables,owner.generation,id),original),'Incoming delivery changed an original full cloud mirror.');
 }
 check(isDeepStrictEqual(mirror(tables,owner.generation,state.expectedEvent.id),pinnedOriginal(state)),'Incoming delivery changed the pinned original server record.');
}
function incomingComplete(state,tables,before){
 incomingStable(state,tables,before);
 const {mutation,localEventId,record}=state.incoming,owner=tables.local_sync_owner[0];
 check(mutationSchema.safeParse(mutation).success&&mutation.kind==='event'&&mutation.intent==='create'&&mutation.baseRevision===0&&mutation.petId===state.expectedPetId&&mutation.recordId===cloudRecordId('event',state.expectedPetId,localEventId)&&mutation.patch.type==='pee'&&mutation.patch.source==='app'&&mutation.patch.note==='From another device','Incoming intention does not match the one saved peer event.');
 check(cloudRecordSchema.safeParse(record).success&&record.kind==='event'&&!record.deleted&&record.id===mutation.recordId&&record.petId===state.expectedPetId&&record.revision===1&&isDeepStrictEqual(record.data,mutation.patch),'Incoming acknowledgement differs from its durable intention.');
 const added=tables.events.filter(row=>!before.events.some(event=>event.id===row.id));
 check(tables.events.length===3&&added.length===1&&added[0].id===localEventId&&added[0].pet_id===state.localPetId&&isDeepStrictEqual(eventDataFromSql(added[0]),record.data)&&isDeepStrictEqual(mirror(tables,owner.generation,record.id),record)&&owner.cursor>=record.sequence&&owner.resyncing===0,'Idle native delivery must commit precisely the new event ID/all fields/full mirror and advance its cursor.');
}
function incomingServer(state,tables,page){
 const events=page.changes.filter(record=>record.kind==='event'),owner=tables.local_sync_owner[0];
 check(!page.hasMore&&!page.resyncRequired&&events.length===3&&events.every(record=>!record.deleted),'Incoming server readback must contain exactly three live events.');
 for(const event of tables.events){
  const record=events.find(record=>record.id===cloudRecordId('event',state.expectedPetId,event.id));
  check(record?.petId===state.expectedPetId&&isDeepStrictEqual(record.data,eventDataFromSql(event))&&isDeepStrictEqual(record,mirror(tables,owner.generation,record.id)),'Incoming independent server readback differs from a committed native event or full mirror.');
 }
}
function incomingEnrollment(state,account){
 const {enrollment,mutation}=state.incoming;
 check(enrollmentSchema.safeParse(enrollment).success&&enrollment.operationId!==mutation.operationId&&enrollment.deviceId===mutation.deviceId&&enrollment.confirmedPetId===state.expectedPetId&&account.pets.length===1&&account.pets[0].id===state.expectedPetId&&enrollment.name===account.pets[0].name,'Incoming peer enrollment must use its saved unique operation, the same device, explicitly confirmed original puppy and actual preflight name.');return enrollment;
}
function loadNative(path){
 const folder=lstatSync(dirname(path));check(folder.isDirectory()&&(folder.mode&0o777)===0o700&&folder.uid===process.getuid()&&basename(dirname(path)).startsWith('puptime-ios-deployed-'),'Use this qualifier’s private state directory.');
 const state=JSON.parse(privateText(path));check(state.base===base&&state.udid===expectedUdid&&typeof state.email==='string'&&typeof state.userId==='string','Native fixture target/identity is invalid.');pinnedOriginal(state);return state;
}
function save(path,state){writeFileSync(path,JSON.stringify(state,null,2)+'\n',{mode:0o600});}
const simctl=(...args)=>execFileSync('xcrun',['simctl',...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
function device(udid){
 check(udid===expectedUdid,'Use only the newly dedicated deployed-cloud simulator.');
 const value=Object.values(JSON.parse(simctl('list','devices','available','-j')).devices).flat().find(value=>value.udid===udid);
 check(value?.name===expectedName&&value.state==='Booted','Boot the exact dedicated cloud-signin simulator.');
 return join(simctl('get_app_container',udid,app,'data'),'Documents/SQLite');
}
function snapshot(directory){
 const db=new DatabaseSync(join(directory,'puptime-v2.db'),{readOnly:true});db.exec('PRAGMA busy_timeout=5000;BEGIN');
 try{return Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({name})=>[name,db.prepare(`SELECT * FROM "${name.replaceAll('"','""')}" ORDER BY rowid`).all().map(row=>({...row}))]));}
 finally{db.exec('COMMIT');db.close();}
}
function stop(udid){try{simctl('terminate',udid,app);}catch(error){if(!/found nothing to terminate|not running|No such process/i.test(String(error.stderr??'')))throw new Failure('The dedicated app could not be stopped safely.');}}
function flow(state,file,phase,code=''){
 const folder=dirname(state.path),startup=join(homedir(),'.maestro/tests'),previous=new Set(existsSync(startup)?readdirSync(startup):[]);
 const raw=mkdtempSync(join(folder,'private-maestro-')),wrapper=join(raw,'deployed-'+phase+'.yaml');
 writeFileSync(wrapper,'appId: '+app+'\n---\n- runFlow: '+JSON.stringify(resolve('.maestro/native',file))+'\n',{mode:0o600});
 let failure=false;
 try{execFileSync(maestro,['--device',state.udid,'test',wrapper,'--test-output-dir',join(raw,'results')],{stdio:['ignore','pipe','pipe'],env:{...process.env,MAESTRO_CLI_NO_ANALYTICS:'1',MAESTRO_TEST_EMAIL:state.email,MAESTRO_TEST_CODE:code}});}
 catch(error){
  failure=true;let text=String(error.stdout??'')+'\n'+String(error.stderr??'');
  for(const secret of [state.email,code].filter(Boolean))text=text.replaceAll(secret,'[PRIVATE]');
  writeFileSync(join(folder,phase+'-redacted.log'),text,{mode:0o600});
 }finally{
  // Only new global artifacts whose log identifies this exact wrapper belong
  // to this invocation. Remove them rather than retain auth screenshots/values.
  if(existsSync(startup))for(const name of readdirSync(startup).filter(name=>!previous.has(name))){
   const path=join(startup,name),log=join(path,'maestro.log');
   if(existsSync(log)&&readFileSync(log,'utf8').includes(wrapper))rmSync(path,{recursive:true,force:true});
  }
  rmSync(raw,{recursive:true,force:true});
 }
 check(!failure,'Native '+phase+' failed; only redacted private console evidence is retained.');
 console.log('PASS deployed native '+phase+' UI.');
}
function code(){check(process.env.PUPTIME_AUTH_CODE_FILE,'Provide the delivered OTP through PUPTIME_AUTH_CODE_FILE, never argv.');const value=privateText(resolve(process.env.PUPTIME_AUTH_CODE_FILE)).trim();check(/^\d{6}$/.test(value),'Private OTP file must contain six digits.');return value;}
async function incoming(phase,state,path,directory,request){
 const beforePath=join(dirname(path),'incoming-before.json');
 if(phase==='incoming-request'){
  if(!state.incoming){
   check(state.phase==='observed'&&typeof state.nativeEventId==='string','Incoming acceptance starts only after the observed original two-event journey.');
   const before=snapshot(directory);restoredEvents(state,before);incomingStable(state,before,before);
   const runId=crypto.randomUUID(),localEventId='incoming-'+runId,deviceId='incoming-http-'+runId;
   writeFileSync(beforePath,JSON.stringify(before,null,2)+'\n',{mode:0o600,flag:'wx'});
   state.incoming={localEventId,status:'intended',enrollment:{operationId:crypto.randomUUID(),deviceId,localPetId:'incoming-pet-'+runId,confirmedPetId:state.expectedPetId,name:before.puppies[0].name},mutation:{protocolVersion:1,operationId:crypto.randomUUID(),deviceId,recordId:cloudRecordId('event',state.expectedPetId,localEventId),petId:state.expectedPetId,kind:'event',baseRevision:0,intent:'create',patch:{type:'pee',at:Date.now(),source:'app',note:'From another device'}}};
   state.phase='incoming-requested';save(path,state);
  }
  check(state.phase==='incoming-requested'&&state.incoming.status==='intended'&&!state.incoming.cookie&&!state.incoming.enrollmentAttemptedAt&&!state.incoming.pushAttemptedAt,'Do not repeat a partial incoming write. Preserve its intention/snapshots and inspect it before any further action.');
  const before=JSON.parse(privateText(beforePath)),current=snapshot(directory);restoredEvents(state,before);restoredEvents(state,current);incomingStable(state,current,before);
  const response=await request('/api/auth/email-otp/send-verification-otp',{method:'POST',body:{email:state.email,type:'sign-in'}});
  check(response.status===200,'Genuine incoming-peer OTP request failed (HTTP'+response.status+').');
  state.incoming.requestedAt=Date.now();save(path,state);console.log('PASS genuine incoming-peer OTP requested; one unique event intention and original two-event snapshot retained.');return;
 }
 check(state.phase==='incoming-requested'&&state.incoming?.status==='intended'&&!state.incoming.cookie&&!state.incoming.enrollmentAttemptedAt&&!state.incoming.pushAttemptedAt,'Request the incoming challenge first. Partial incoming attempts are retained for inspection and cannot blindly add another event.');
 const before=JSON.parse(privateText(beforePath)),current=snapshot(directory);restoredEvents(state,before);restoredEvents(state,current);incomingStable(state,current,before);
 const otp=code();let login;
 for(let attempt=0;attempt<2;attempt++){
  login=await request('/api/auth/sign-in/email-otp',{method:'POST',body:{email:state.email,otp}});
  if(login.status!==429||attempt)break;
  const value=Number(login.headers.get('retry-after')),wait=Number.isFinite(value)&&value>0?Math.min(60000,Math.ceil(value*1000)):60000;
  await login.body?.cancel();console.log('Waiting for the real incoming-peer sign-in limit before one bounded retry.');await new Promise(resolve=>setTimeout(resolve,wait));
 }
 check(login.status===200,'Genuine incoming-peer sign-in failed (HTTP'+login.status+').');
 const cookie=login.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');check(cookie.includes('session_token='),'Genuine incoming peer returned no session cookie.');
 state.phase='incoming-running';state.incoming.cookie=cookie;save(path,state);
 let passed=false,latest=current;
 try{
  const api=createCloudApi(async(route,options)=>{const response=await request(route,{...options,cookie});return {data:await response.json(),error:response.ok?null:{status:response.status},retryAfter:response.headers.get('retry-after')};});
  const account=await api.account();check(account.user.id===state.userId&&account.user.email.toLowerCase()===state.email.toLowerCase()&&account.pets.length===1&&account.pets[0].id===state.expectedPetId&&account.pets[0].eventCount===2,'Incoming peer does not see the original owner, exact puppy and two-event baseline.');
  const page=await api.pull(0),events=page.changes.filter(record=>record.kind==='event');
  check(!page.hasMore&&!page.resyncRequired&&events.length===2&&events.every(record=>!record.deleted),'Incoming peer must start with exactly the two original live events.');
  for(const event of before.events){const id=cloudRecordId('event',state.expectedPetId,event.id);check(isDeepStrictEqual(events.find(record=>record.id===id),mirror(before,before.local_sync_owner[0].generation,id)),'Incoming peer baseline changed one original full server event.');}
  latest=snapshot(directory);restoredEvents(state,latest);incomingStable(state,latest,before);
  // Use the actual authenticated summary name before applying this saved
  // enrollment. Enrolling a confirmed peer must not create/change records.
  check(state.incoming.enrollment,'Incoming intention lacks its saved peer enrollment; do not invent a replacement for a partial run.');
  state.incoming.enrollment.name=account.pets[0].name;
  const enrollment=incomingEnrollment(state,account);
  state.incoming.status='enrolling';state.incoming.enrollmentAttemptedAt=Date.now();save(path,state);
  writeFileSync(join(dirname(path),'incoming-enrollment-before.json'),JSON.stringify({account,page},null,2)+'\n',{mode:0o600,flag:'wx'});
  const enrolled=await api.enroll(enrollment);check(enrolled.petId===state.expectedPetId,'Incoming peer enrollment returned a different cloud puppy.');
  const afterEnrollment={account:await api.account(),page:await api.pull(0)};
  writeFileSync(join(dirname(path),'incoming-enrollment-after.json'),JSON.stringify(afterEnrollment,null,2)+'\n',{mode:0o600,flag:'wx'});
  check(isDeepStrictEqual(afterEnrollment,{account,page}),'Confirmed peer enrollment changed the account summary, cloud records or pull cursor before the one new event.');
  const afterEnrollmentNative=snapshot(directory);check(isDeepStrictEqual(afterEnrollmentNative,latest),'Confirmed peer enrollment changed native SQLite before the incoming event.');
  state.incoming.enrollmentVerifiedAt=Date.now();state.incoming.enrollmentCursor=page.cursor;save(path,state);
  console.log('PASS genuine peer device explicitly enrolled on the original puppy; account, full cloud records/cursor and native SQLite unchanged.');
  // Persist before the single write. A timeout or failed acknowledgement is
  // deliberately inspected rather than retried with a new operation/event.
  state.incoming.status='submitted';state.incoming.pushAttemptedAt=Date.now();save(path,state);
  const pushed=await api.push([state.incoming.mutation]),record=pushed.accepted[0]?.record;
  check(pushed.accepted.length===1&&pushed.rejected.length===0&&record?.id===state.incoming.mutation.recordId&&record.petId===state.expectedPetId&&!record.deleted&&record.revision===1&&isDeepStrictEqual(record.data,state.incoming.mutation.patch),'Incoming peer event was not acknowledged exactly as intended.');
  state.incoming.record=record;state.incoming.status='accepted';state.incoming.pollStartedAt=Date.now();save(path,state);
  console.log('Waiting up to75 seconds for idle standalone SQLite delivery; no UI launch, foreground, refresh or navigation will occur before convergence.');
  const deadline=Date.now()+75000;let converged=false;
  while(Date.now()<deadline){
   latest=snapshot(directory);incomingStable(state,latest,before);
   if(latest.events.length===3){incomingComplete(state,latest,before);converged=true;break;}
   check(latest.events.length===2,'Idle delivery produced an unexpected event count.');
   await new Promise(resolve=>setTimeout(resolve,1000));
  }
  check(converged,'Idle incoming delivery did not converge within75 seconds. No UI wake/refresh was attempted; preserve snapshots and inspect the existing operation.');
  state.incoming.sqlConvergedAt=Date.now();writeFileSync(join(dirname(path),'incoming-converged.json'),JSON.stringify(latest,null,2)+'\n',{mode:0o600,flag:'wx'});save(path,state);
  console.log('PASS three exact native event IDs/all fields/full mirrors converged while idle; original two, owner, puppy and empty outbox preserved before any UI call.');
  flow(state,'ios-deployed-cloud-incoming.yaml','live-incoming-read-only');
  const afterUi=snapshot(directory);incomingComplete(state,afterUi,before);check(isDeepStrictEqual(afterUi,latest),'Read-only incoming UI assertions changed native SQLite.');
  const summary=await api.account();check(summary.user.id===state.userId&&summary.pets.length===1&&summary.pets[0].id===state.expectedPetId&&summary.pets[0].eventCount===3,'Incoming server summary differs from the native owner, original puppy or three events.');
  incomingServer(state,afterUi,await api.pull(0));check(isDeepStrictEqual(snapshot(directory),afterUi),'Independent incoming HTTP readback changed native SQLite.');
  passed=true;
 }finally{
  state.phase='incoming-failed';save(path,state);
  try{latest=snapshot(directory);}catch{/* Preserve the latest readable snapshot if SQLite itself failed. */}
  writeFileSync(join(dirname(path),'incoming-after.json'),JSON.stringify(latest,null,2)+'\n',{mode:0o600,flag:'wx'});
  const logout=await request('/api/auth/sign-out',{method:'POST',body:{},cookie});
  check(logout.status===200,'Incoming peer sign-out failed; its private genuine session remains for inspection. Native session/account were retained.');
  state.incoming.cookie=null;state.phase=passed?'incoming-complete':'incoming-failed';save(path,state);
 }
 console.log('PASS true standalone incoming delivery, no-launch three-log/Up to date UI and independent server readback; only the HTTP peer logged out. Native session/account/data retained.');
}
async function main(){
 const [phase,first,authPath,...extra]=process.argv.slice(2);
 check(!extra.length&&['request','verify','sync','observer-request','observer','incoming-request','incoming'].includes(phase),'Use request UDID HTTP_STATE or verify|sync|observer-request|observer|incoming-request|incoming NATIVE_STATE.');
 let state,path,directory;
 if(phase==='request'){
  check(authPath,'Provide the retained genuine HTTP sign-up state.');directory=device(first);
  const auth=JSON.parse(privateText(resolve(authPath)));
  check(auth.exactOwner===true&&auth.freshAccountVerified===true&&auth.phase==='complete'&&!auth.cookie&&typeof auth.userId==='string','Use the approved retained owner identity after genuine HTTP logout.');
  check(['https://puptime-api-staging.p-ch.workers.dev',base].includes(auth.base)&&auth.freshInboxProof?.emailSha256===createHash('sha256').update(auth.email.trim().toLowerCase()).digest('hex'),'Retained owner state has an invalid target/proof.');
  pinnedOriginal({...auth,authRunId:auth.runId});
  check(existsSync(join(directory,'puptime-v2.db')),'Launch the signed Pages-configured app once to initialize its fresh local profile before request; do not reset or seed it.');
  stop(first);const before=snapshot(directory);
  check(before.puppies.length===1&&before.events.length===0&&before.local_sync_owner.length===0&&before.local_sync_outbox.length===0,'Preserve existing data: this dedicated setup must have one unowned puppy and zero events/uploads.');
  const folder=mkdtempSync(join(tmpdir(),'puptime-ios-deployed-'));chmodSync(folder,0o700);path=join(folder,'state.json');
  cpSync(directory,join(folder,'previous-synthetic-sqlite'),{recursive:true});
  state={base,udid:first,email:auth.email,userId:auth.userId,authRunId:auth.runId,expectedPetId:auth.expectedPetId,expectedEvent:auth.expectedEvent,phase:'requested',localPetId:before.puppies[0].id,path};save(path,state);
  console.log('Private native state:',path);
  flow(state,'ios-deployed-cloud-request.yaml','request');
  const after=snapshot(directory);check(after.events.length===0&&after.local_sync_owner.length===0&&after.local_sync_outbox.length===0&&after.puppies.length===1&&after.puppies[0].id===state.localPetId,'Request changed puppy identity, events, ownership or uploads.');
  return;
 }
 check(!authPath,'Only request accepts a second path argument.');path=resolve(first);state=loadNative(path);state.path=path;directory=device(state.udid);
 if(phase==='verify'){
  check(state.phase==='requested','Request the native challenge before private verification.');const before=snapshot(directory);
  flow(state,'ios-deployed-cloud-verify.yaml','verify',code());const after=snapshot(directory);
  for(const table of Object.keys(before).filter(name=>name!=='metadata'))check(isDeepStrictEqual(after[table],before[table]),'Native sign-in changed a local table before explicit cloud confirmation.');
  check(after.events.length===0&&after.local_sync_owner.length===0&&after.local_sync_outbox.length===0,'Sign-in implicitly enrolled/uploaded local data.');
  state.phase='verified';save(path,state);console.log('PASS official deployed SDK sign-in preserves the local profile, zero events, owner and outbox until explicit restore.');return;
 }
 if(phase==='sync'){
  check(state.phase==='verified','Verify the genuine native session before explicit restoration.');
  const before=snapshot(directory);
  check(before.puppies.length===1&&before.puppies[0].id===state.localPetId&&before.events.length===0&&before.local_sync_owner.length===0&&before.local_sync_outbox.length===0,'Sync starts only from the preserved verified, unowned zero-event profile; never rerun a partial restore or add another log.');
  writeFileSync(join(dirname(path),'sync-before.json'),JSON.stringify(before,null,2)+'\n',{mode:0o600,flag:'wx'});
  let after;
  // Restore and the real quick log intentionally change durable records. Keep
  // exact private snapshots, including a failed attempt, rather than asserting
  // an unchanged database for this write journey.
  try{flow(state,'ios-deployed-cloud-sync.yaml','restore-log-restart');}
  finally{after=snapshot(directory);writeFileSync(join(dirname(path),'sync-after.json'),JSON.stringify(after,null,2)+'\n',{mode:0o600,flag:'wx'});}
  const added=restoredEvents(state,after);
  check(after.metadata.find(row=>row.key==='show_onboarding')?.value==='false','Completed setup did not survive restart.');
  state.phase='synced';state.cloudPetId=state.expectedPetId;state.nativeEventId=added.id;state.nativeEventIds=after.events.map(row=>row.id).sort();save(path,state);
  console.log('PASS native explicit returning-puppy restore, one real quick log and cold reopen retain the genuine owner, two events and an empty upload queue. Server identity/data comparison requires observer.');return;
 }
 async function request(route,{method='GET',body,cookie=''}={}){
  try{return await fetch(base+route,{method,headers:{origin:base,...(cookie?{cookie}:{}),...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(20000)});}
  catch{throw new Failure('Deployed observer request failed; private details withheld.');}
 }
 if(phase==='incoming-request'||phase==='incoming')return incoming(phase,state,path,directory,request);
 check(state.phase==='synced'||state.phase==='observer-requested'||state.phase==='observed','Complete native synchronization before the independent genuine HTTP observer.');
 if(phase==='observer-request'){
  const response=await request('/api/auth/email-otp/send-verification-otp',{method:'POST',body:{email:state.email,type:'sign-in'}});
  check(response.status===200,'Genuine observer OTP request failed (HTTP'+response.status+').');state.phase='observer-requested';save(path,state);console.log('PASS separate genuine observer OTP requested. No administrative session used.');return;
 }
 check(state.phase==='observer-requested','Request a fresh observer OTP first.');
 const otp=code();let login;
 for(let attempt=0;attempt<2;attempt++){
  login=await request('/api/auth/sign-in/email-otp',{method:'POST',body:{email:state.email,otp}});
  if(login.status!==429||attempt)break;
  const value=Number(login.headers.get('retry-after')),wait=Number.isFinite(value)&&value>0?Math.min(60000,Math.ceil(value*1000)):60000;
  await login.body?.cancel();console.log('Waiting for the real observer sign-in limit before one bounded retry.');await new Promise(resolve=>setTimeout(resolve,wait));
 }
 check(login.status===200,'Genuine observer sign-in failed (HTTP'+login.status+').');
 const cookie=login.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');check(cookie.includes('session_token='),'Genuine observer returned no session cookie.');
 try{
  const before=snapshot(directory);restoredEvents(state,before);
  const api=createCloudApi(async(route,options)=>{const response=await request(route,{...options,cookie});return {data:await response.json(),error:response.ok?null:{status:response.status},retryAfter:response.headers.get('retry-after')};});
  const account=await api.account();check(account.user.id===state.userId&&account.user.email.toLowerCase()===state.email.toLowerCase()&&account.pets.length===1&&account.pets[0].id===state.expectedPetId&&account.pets[0].eventCount===2,'Genuine server identity, original puppy or event count differs from the pinned baseline plus one new log.');
  const page=await api.pull(0),events=page.changes.filter(record=>record.kind==='event'&&!record.deleted);
  check(!page.hasMore&&!page.resyncRequired&&events.length===2&&isDeepStrictEqual(events.find(record=>record.id===state.expectedEvent.id),state.expectedEvent),'Independent server page changed the pinned original record or did not add exactly one event.');
  for(const event of before.events){const remote=events.find(record=>localRecordId(record)===event.id);check(remote?.petId===state.expectedPetId&&isDeepStrictEqual(remote.data,eventDataFromSql(event)),'Independent server event identity/fields differ from the native committed record.');}
  check(isDeepStrictEqual(snapshot(directory),before),'Read-only HTTP observation changed native SQLite.');state.phase='observed';save(path,state);
  console.log('PASS genuine independent Pages HTTP session matches native auth owner, puppy, both event IDs and every event field; native SQLite unchanged.');
 }finally{const result=await request('/api/auth/sign-out',{method:'POST',body:{},cookie});check(result.status===200,'Observer sign-out failed; native session and account remain retained.');}
}
function selfTest(){
 const authRunId=crypto.randomUUID(),petId='auth-'+authRunId;
 const record={id:cloudRecordId('event',petId,'auth-event'),petId,kind:'event',revision:1,sequence:2,deleted:false,updatedAt:1000,data:{type:'pee',at:1000,source:'app',note:'Genuine OTP qualification'}};
 const state={authRunId,expectedPetId:petId,expectedEvent:record,localPetId:'local-puppy',userId:'self-check'};
 const row={pet_id:state.localPetId,id:'auth-event',type:'pee',at:1000,end_state:0,ended_at:null,custom_label:null,note:record.data.note,source:'app',estimated:null};
 const tables={puppies:[{id:state.localPetId}],events:[row,{...row,id:'new-event',at:2000,note:null}],local_sync_owner:[{account_id:state.userId,generation:'generation'}],local_sync_pets:[{pet_id:state.localPetId,cloud_pet_id:petId,generation:'generation',status:'active'}],local_sync_outbox:[],local_sync_records:[{generation:'generation',record_id:record.id,body:JSON.stringify(record)}]};
 check(restoredEvents(state,tables).id==='new-event','The original plus one new native event must pass.');
 const changes=[value=>{value.events[0].note='changed';},value=>{value.events[0].id='changed';},value=>{value.local_sync_pets[0].cloud_pet_id='other';},value=>{value.events.push({...row,id:'extra'});},value=>{value.local_sync_records[0].body=JSON.stringify({...record,sequence:3});}];
 for(const change of changes){const invalid=structuredClone(tables);change(invalid);let rejected=false;try{restoredEvents(state,invalid);}catch{rejected=true;}check(rejected,'Changed original fields/identity/metadata, foreign binding or extra events must reject.');}
 let missing=false;try{pinnedOriginal({...state,expectedEvent:undefined});}catch{missing=true;}check(missing,'An unpinned legacy HTTP state must reject before native setup.');
 const second={...record,id:cloudRecordId('event',petId,'new-event'),sequence:3,updatedAt:2000,data:{type:'pee',at:2000,source:'app'}};
 tables.local_sync_records.push({generation:'generation',record_id:second.id,body:JSON.stringify(second)});
 Object.assign(tables.local_sync_owner[0],{device_id:'native',pending_pet_id:null,cursor:3,resyncing:0});state.nativeEventId='new-event';
 const mutation={protocolVersion:1,operationId:crypto.randomUUID(),deviceId:'incoming-http-self-check',recordId:cloudRecordId('event',petId,'incoming-event'),petId,kind:'event',baseRevision:0,intent:'create',patch:{type:'pee',at:3000,source:'app',note:'From another device'}};
 const third={...record,id:mutation.recordId,sequence:4,updatedAt:3000,data:mutation.patch};state.incoming={localEventId:'incoming-event',mutation,record:third};
 const peerAccount={pets:[{id:petId,name:'Pip'}]};state.incoming.enrollment={operationId:crypto.randomUUID(),deviceId:mutation.deviceId,localPetId:'incoming-pet-self-check',confirmedPetId:petId,name:peerAccount.pets[0].name};incomingEnrollment(state,peerAccount);
 for(const patch of [{deviceId:'foreign'},{confirmedPetId:'foreign'},{name:'Changed'},{operationId:mutation.operationId}]){
  let rejected=false;try{incomingEnrollment({...state,incoming:{...state.incoming,enrollment:{...state.incoming.enrollment,...patch}}},peerAccount);}catch{rejected=true;}check(rejected,'Incoming enrollment must reject a foreign device/puppy, changed name or reused mutation operation.');
 }
 const delivered=structuredClone(tables);delivered.events.push({...row,id:'incoming-event',at:3000,note:'From another device'});delivered.local_sync_records.push({generation:'generation',record_id:third.id,body:JSON.stringify(third)});delivered.local_sync_owner[0].cursor=4;
 incomingComplete(state,delivered,tables);incomingServer(state,delivered,{changes:[record,second,third],hasMore:false});
 for(const change of [value=>{value.events[1].at++;},value=>{value.events[2].note='changed';},value=>{value.events.push({...row,id:'fourth'});},value=>{value.local_sync_owner[0].account_id='foreign';},value=>{value.local_sync_records[2].body=JSON.stringify({...third,revision:2});}]){
  const invalid=structuredClone(delivered);change(invalid);let rejected=false;try{incomingComplete(state,invalid,tables);}catch{rejected=true;}check(rejected,'Incoming guards must reject changed original/new data, extra events, foreign owner or changed complete mirror.');
 }
 let alteredServer=false;try{incomingServer(state,delivered,{changes:[record,{...second,data:{...second.data,at:2001}},third],hasMore:false});}catch{alteredServer=true;}check(alteredServer,'Incoming server readback must reject altered original data.');
 console.log('PASS immutable event/binding, explicit peer enrollment and incoming old/new data/full mirror/server guards. No simulator, credentials, or service calls executed.');
}
try{if(process.argv[2]==='--self-test')selfTest();else await main();}catch(error){console.error(error instanceof Failure?error.message:'Native deployed qualification failed; private identity/response details withheld.');process.exitCode=1;}

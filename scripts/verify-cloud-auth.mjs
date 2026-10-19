// Genuine Better Auth OTP -> production API/SQL acceptance. No seeded identities,
// forged cookies, auth secret, simulator, or changes to shared native fixtures.
// node scripts/verify-cloud-auth.mjs local|staging request [PRIVATE_STATE.json]
// node scripts/verify-cloud-auth.mjs local|staging verify PRIVATE_STATE.json
// Older completed states: baseline-request / baseline privately signs in again,
// pins the original read-only server record, then logs out without new data.
// Then cleanup-request / cleanup with the same state to retire via a second OTP.
// Staging: set PUPTIME_AUTH_TEST_INBOX to a controlled inbox supporting +aliases;
// pipe the delivered six-digit code to verify/cleanup, or use PUPTIME_AUTH_CODE_FILE
// naming an owner-only0600 file. Never supply a code as argv or record code entry.
// Restricted sender: PUPTIME_AUTH_TEST_EXACT_INBOX=1 reads the approved private
// owner inbox file. PUPTIME_AUTH_FRESH_INBOX_PROOF must prove its prior absence.
// Exact-owner cleanup additionally requires PUPTIME_AUTH_TEST_ALLOW_EXACT_CLEANUP=1.
// Staging defaults to Pages. PUPTIME_STAGING_API_ORIGIN may explicitly select
// Pages or the staging Worker; saved state/proofs must match that exact API.
// Both staging transports use the canonical Pages Origin for auth requests.
import {createHash} from 'node:crypto';
import {chmodSync,lstatSync,mkdtempSync,readFileSync,readdirSync,renameSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {basename,dirname,join,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {isDeepStrictEqual} from 'node:util';
import {z} from 'zod';
import {CloudApiError,createCloudApi} from '../src/cloud/api.ts';
import {cloudRecordId} from '../src/cloud/record-identity.ts';
import {cloudRecordSchema} from '../src/cloud/protocol.ts';

class Failure extends Error {}
function check(condition,message){if(!condition)throw new Failure(message);}
const origins={local:'http://127.0.0.1:8793',staging:'https://puptime.pages.dev'};
const stagingOrigins=[origins.staging,'https://puptime-api-staging.p-ch.workers.dev'];
function target(mode,override){
 const base=mode==='local'?origins.local:(override??origins.staging);
 check(mode==='local'||mode==='staging'&&stagingOrigins.includes(base),'PUPTIME_STAGING_API_ORIGIN must exactly match the Pages or staging Worker HTTPS origin.');
 return {base,origin:mode==='local'?base:origins.staging};
}
function privateFile(path){
 const stat=lstatSync(path);
 check(stat.isFile()&&!stat.isSymbolicLink()&&(stat.mode&0o777)===0o600&&stat.uid===process.getuid(),'Private input must be a regular file owned by this user with mode0600.');
 return readFileSync(path,'utf8');
}
function alias(mode,runId){
 if(mode==='local')return `puptime-auth-${runId}@example.invalid`;
 if(process.env.PUPTIME_AUTH_TEST_EXACT_INBOX==='1'){
  const inbox=privateFile('/tmp/puptime-resend-owner-inbox-private').trim().toLowerCase();
  check(z.email().safeParse(inbox).success,'The approved private owner inbox is invalid.');return inbox;
 }
 const inbox=process.env.PUPTIME_AUTH_TEST_INBOX;
 check(z.email().safeParse(inbox).success,'Set PUPTIME_AUTH_TEST_INBOX to a controlled inbox supporting plus aliases.');
 const at=inbox.lastIndexOf('@'),email=inbox.slice(0,at)+'+puptime-auth-'+runId.replaceAll('-','')+inbox.slice(at);
 check(email.slice(0,email.lastIndexOf('@')).length<=64&&z.email().safeParse(email).success,'The controlled inbox address is too long for a unique test alias.');
 return email.toLowerCase();
}
function freshProof(proof,email,base,recent=false){
 check(proof?.base===base&&proof.matches===0&&proof.emailSha256===createHash('sha256').update(email.trim().toLowerCase()).digest('hex')&&Number.isSafeInteger(proof.checkedAt)&&proof.checkedAt>0,'Fresh identity proof must match this exact inbox, target and zero authoritative matches.');
 if(recent)check(Date.now()-proof.checkedAt>=0&&Date.now()-proof.checkedAt<=300000,'Fresh identity proof must be no more than five minutes old.');
 return {base:proof.base,emailSha256:proof.emailSha256,matches:0,checkedAt:proof.checkedAt};
}
function retryDelay(value){
 const seconds=Number(value);
 return Number.isFinite(seconds)&&seconds>0?Math.min(60000,Math.ceil(seconds*1000)):60000;
}
function originalBaseline(state,account,page){
 check(account.user.id===state.userId&&account.user.email.toLowerCase()===state.email&&account.pets.length===1&&account.pets[0].id==='auth-'+state.runId&&account.pets[0].eventCount===1,'Baseline must retain this genuine run’s sole original puppy and event.');
 const petId=account.pets[0].id,events=page.changes.filter(record=>record.kind==='event'),record=events[0];
 check(!page.hasMore&&!page.resyncRequired&&events.length===1&&cloudRecordSchema.safeParse(record).success&&record.petId===petId&&record.id===cloudRecordId('event',petId,'auth-event')&&!record.deleted&&record.revision===1,'Baseline must contain exactly the original, unchanged revision1 auth-event.');
 check(isDeepStrictEqual(record.data,{type:'pee',at:record.data.at,source:'app',note:'Genuine OTP qualification'}),'Baseline original event fields differ from the genuine qualification.');
 return {petId,record};
}
function originalHistory(state,record,history){
 const revision=history.revisions[0];
 check(history.revisions.length===1&&revision.deviceId==='auth-http-'+state.runId&&revision.intent==='create'&&revision.baseRevision===0&&revision.before===null&&revision.reason==='created'&&isDeepStrictEqual(revision.after,record)&&isDeepStrictEqual(revision.proposal,record.data),'Baseline history does not prove the original run-local device and unchanged creation.');
}
function readState(path,mode,base=origins[mode]){
 const folder=lstatSync(dirname(path));
 check(folder.isDirectory()&&!folder.isSymbolicLink()&&(folder.mode&0o777)===0o700&&folder.uid===process.getuid()&&basename(dirname(path)).startsWith('puptime-auth-'),'Use this harness’s private state directory.');
 const value=JSON.parse(privateFile(path));
 check(value.version===1&&value.mode===mode&&z.uuid().safeParse(value.runId).success,'Private state has an invalid mode or run identifier.');
 check(value.base===base,'Private state target differs from the selected API origin. Retained Worker state requires explicit PUPTIME_STAGING_API_ORIGIN=https://puptime-api-staging.p-ch.workers.dev. State, proofs and credentials were not migrated.');
 const tag=value.runId.replaceAll('-','');
 check(z.email().safeParse(value.email).success,'Private state has an invalid inbox.');
 if(value.exactOwner){check(mode==='staging','Exact-owner mode is staging only.');freshProof(value.freshInboxProof,value.email,value.base);}
 else check(mode==='local'?value.email===`puptime-auth-${value.runId}@example.invalid`:value.email.split('@')[0].endsWith('+puptime-auth-'+tag),'Only this run’s generated synthetic email may be used.');
 check(['requested','expired','authenticated','complete','baseline-requested','cleanup-requested','retired'].includes(value.phase),'Private state has an invalid phase.');
 return value;
}
function save(path,state){
 const temporary=path+'.'+crypto.randomUUID()+'.tmp';
 writeFileSync(temporary,JSON.stringify(state,null,2)+'\n',{mode:0o600,flag:'wx'});
 renameSync(temporary,path);
}
function localState(){
 const value=JSON.parse(readFileSync('/tmp/puptime-native-cloud-state.json','utf8'));
 check(value.url===origins.local&&basename(value.directory).startsWith('puptime-native-cloud-'),'Use the existing isolated local service state.');
 return value;
}
function codeFromPreview(state){
 const local=localState(),folder=join(local.persist,'v3/d1');
 for(const file of readdirSync(folder,{recursive:true}).filter(file=>typeof file==='string'&&file.endsWith('.sqlite'))){
  const db=new DatabaseSync(join(folder,file),{readOnly:true});
  try{
   if(!db.prepare("SELECT name FROM sqlite_master WHERE name='local_email_previews'").get())continue;
   const row=db.prepare('SELECT code FROM local_email_previews WHERE email=? ORDER BY expires_at DESC LIMIT 1').get(state.email);
   check(/^\d{6}$/.test(row?.code??''),'No private local OTP preview exists for this run.');return row.code;
  }finally{db.close();}
 }
 throw new Failure('The isolated local auth database was not found.');
}
function deliveredCode(state){
 if(state.mode==='local')return codeFromPreview(state);
 const file=process.env.PUPTIME_AUTH_CODE_FILE;
 check(file||!process.stdin.isTTY,'Supply the delivered code through a private file or piped stdin; terminal entry is not captured.');
 const code=(file?privateFile(resolve(file)):readFileSync(0,'utf8')).trim();
 check(/^\d{6}$/.test(code),'Private OTP input must contain exactly six digits.');return code;
}
function cookies(response){return response.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');}
async function main(){
 const [mode,phase,provided,...extra]=process.argv.slice(2);
 check(!extra.length&&Object.hasOwn(origins,mode)&&['request','verify','baseline-request','baseline','cleanup-request','cleanup'].includes(phase),'Usage: local|staging request|verify|baseline-request|baseline|cleanup-request|cleanup [PRIVATE_STATE.json]. OTPs are never argv.');
 const {base,origin}=target(mode,process.env.PUPTIME_STAGING_API_ORIGIN);
 if(mode==='local')localState();
 let path=provided?resolve(provided):null,state=path?readState(path,mode,base):null;
 check(state||phase==='request','This phase requires the private state path returned by request.');
 if(state?.exactOwner&&phase.startsWith('cleanup'))check(process.env.PUPTIME_AUTH_TEST_ALLOW_EXACT_CLEANUP==='1'&&state.freshAccountVerified===true,'Exact-owner cleanup is disabled. Retain this account for native testing unless separately authorized after fresh-account verification.');
 async function request(route,{method='GET',body,cookie=state?.cookie??''}={}){
  try{return await fetch(base+route,{method,headers:{origin,...(cookie?{cookie}:{}),...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(20000)});}
  catch{throw new Failure('The auth/service request could not complete; private details withheld.');}
 }
 const api=createCloudApi(async(route,options)=>{
  const response=await request(route,options);
  return {data:await response.json(),error:response.ok?null:{status:response.status},retryAfter:response.headers.get('retry-after')};
 });
 async function send(){
  const config=await api.config();
  check(config.providers.email,'Email sign-in is disabled. Configure a permitted sender before requesting a genuine delivered OTP.');
  const response=await request('/api/auth/email-otp/send-verification-otp',{method:'POST',body:{email:state.email,type:'sign-in'},cookie:''});
  check(response.status===200,'OTP request failed (HTTP'+response.status+'); no private response retained.');
  state.requestedAt=Date.now();save(path,state);
  console.log('PASS '+mode+':genuine OTP request accepted; this alone does not prove inbox delivery.');
 }
 async function login(code){
  let response;
  for(let attempt=0;attempt<2;attempt++){
   response=await request('/api/auth/sign-in/email-otp',{method:'POST',body:{email:state.email,otp:code},cookie:''});
   if(response.status!==429||attempt===1)break;
   const delay=retryDelay(response.headers.get('retry-after'));await response.body?.cancel();
   console.log('Waiting '+Math.ceil(delay/1000)+' seconds for the real sign-in rate limit; retrying once without changing the limiter.');
   await new Promise(resolve=>setTimeout(resolve,delay));
  }
  check(response.status===200,'Genuine OTP sign-in failed (HTTP'+response.status+'); code may be expired, incorrect or rate-limited.');
  state.cookie=cookies(response);check(state.cookie.includes('session_token='),'Genuine sign-in returned no session cookie.');
  save(path,state);
  const account=await api.account();
  check(account.user.email.toLowerCase()===state.email,'Authenticated session belongs to another email.');
  if(state.userId)check(account.user.id===state.userId,'Authenticated identity changed between phases.');
  if(state.exactOwner){
   const session=await request('/api/auth/get-session');check(session.status===200,'Fresh exact-owner session could not be checked.');
   const value=await session.json(),createdAt=Date.parse(value?.user?.createdAt);
   check(value?.user?.id===account.user.id&&Number.isFinite(createdAt)&&createdAt>=state.freshInboxProof.checkedAt,'Exact-owner identity predates the authoritative absence proof; no trial/enrollment/deletion is permitted.');
   state.freshAccountVerified=true;state.signupCreatedAt=createdAt;
  }
  state.userId=account.user.id;save(path,state);return account;
 }
 if(phase==='request'){
  if(state)check(['requested','expired'].includes(state.phase)&&!state.cookie&&!state.userId,'Only an unverified challenge may be resent.');
  else{
   const config=await api.config();check(config.providers.email,'Email sign-in is disabled; no challenge or fixture was created.');
   const runId=crypto.randomUUID(),email=alias(mode,runId),exactOwner=mode==='staging'&&process.env.PUPTIME_AUTH_TEST_EXACT_INBOX==='1';
   let proof;
   if(exactOwner){check(process.env.PUPTIME_AUTH_FRESH_INBOX_PROOF,'Exact-owner request requires a private authoritative fresh-inbox proof.');proof=freshProof(JSON.parse(privateFile(resolve(process.env.PUPTIME_AUTH_FRESH_INBOX_PROOF))),email,base,true);}
   const folder=mkdtempSync(join(tmpdir(),'puptime-auth-'+mode+'-'));chmodSync(folder,0o700);
   path=join(folder,'state.json');state={version:1,mode,base,runId,email,phase:'requested',requestedAt:0,cookie:null,userId:null,...(exactOwner?{exactOwner:true,freshInboxProof:proof,freshAccountVerified:false}:{})};save(path,state);
  }
  state.phase='requested';await send();console.log('Private state:',path);return;
 }
 if(phase==='cleanup-request'){
  if(!state.userId&&state.cookie){
   const account=await api.account();check(account.user.email.toLowerCase()===state.email,'Recovery session belongs to another email.');
   state.userId=account.user.id;save(path,state);
  }
  check(state.userId&&state.phase!=='retired','A known synthetic identity is required for normal retirement.');
  state.phase='cleanup-requested';await send();console.log('Private state:',path);return;
 }
 if(phase==='cleanup'){
  check(state.phase==='cleanup-requested'&&state.userId,'Request a fresh real cleanup OTP first.');
  await login(deliveredCode(state));
  const retiredCookie=state.cookie,response=await request('/api/account',{method:'DELETE',body:{confirm:true}});
  check(response.status===200,'Normal synthetic account retirement failed (HTTP'+response.status+'); private state retained for recovery.');
  check((await request('/api/account',{cookie:retiredCookie})).status===401,'Retirement did not revoke the genuine session.');
  state.cookie=null;state.phase='retired';save(path,state);
  console.log('PASS '+mode+':normal account retirement revoked the genuine session. No administrative reset or credentials used.');return;
 }
 if(phase==='baseline-request'){
  check(state.phase==='complete'&&!state.cookie&&state.userId&&!state.expectedPetId&&!state.expectedEvent,'Baseline request requires an older completed, logged-out genuine run without pinned expectations; never overwrite a baseline.');
  state.phase='baseline-requested';await send();console.log('Private state:',path);return;
 }
 if(phase==='baseline'){
  check(state.phase==='baseline-requested'&&state.userId,'Request the original completed run’s fresh baseline OTP first.');
  // A failed read can resume with this saved genuine session. No new account,
  // trial, enrollment or event is created by either baseline phase.
  const account=state.cookie?await api.account():await login(deliveredCode(state));
  const {petId,record}=originalBaseline(state,account,await api.pull(0));
  originalHistory(state,record,await api.history(record.id));
  if(state.expectedPetId||state.expectedEvent)check(state.expectedPetId===petId&&isDeepStrictEqual(state.expectedEvent,record),'An existing immutable baseline cannot be overwritten.');
  else{state.expectedPetId=petId;state.expectedEvent=record;state.baselineProvenance='genuine-session-history';save(path,state);}
  const oldCookie=state.cookie,logout=await request('/api/auth/sign-out',{method:'POST',body:{}});
  check(logout.status===200&&(await request('/api/account',{cookie:oldCookie})).status===401,'Baseline observer logout failed; private state retained.');
  state.cookie=null;state.phase='complete';save(path,state);
  console.log('PASS '+mode+':genuine read-only session pinned the sole original puppy and complete unchanged event, proved its creation device, then logged out.');return;
 }
 check(state.phase==='requested'&&!state.cookie&&!state.userId,'Verify requires this run’s unverified challenge; use cleanup-request for an authenticated failed run.');
 const code=deliveredCode(state);
 if(Date.now()-state.requestedAt>=300000){
  const expired=await request('/api/auth/sign-in/email-otp',{method:'POST',body:{email:state.email,otp:code},cookie:''});
  check(expired.status===400&&!cookies(expired).includes('session_token='),'Expired challenge was not rejected as expected.');
  state.phase='expired';save(path,state);
  throw new Failure('PASS expired challenge rejection. Resend with request and the same private state to complete acceptance.');
 }
 const wrong=(Number(code[0])+1)%10+code.slice(1);
 const rejected=await request('/api/auth/sign-in/email-otp',{method:'POST',body:{email:state.email,otp:wrong},cookie:''});
 check(rejected.status===400&&!cookies(rejected).includes('session_token='),'Incorrect challenge was not rejected without a session.');
 const account=await login(code);state.phase='authenticated';save(path,state);
 check(!account.cloud.canSync&&account.cloud.source==='none'&&account.pets.length===0,'Sign-up implicitly activated cloud or created a puppy.');
 console.log('PASS '+mode+':wrong OTP rejected; genuine sign-in/session has no trial or puppy.');
 const consumed=await request('/api/auth/sign-in/email-otp',{method:'POST',body:{email:state.email,otp:code},cookie:''});
 check(consumed.status===400&&!cookies(consumed).includes('session_token='),'Consumed challenge was not rejected without a new session.');
 const trial=await api.startTrial();check(trial.cloud.canSync&&trial.cloud.source==='trial','Explicit trial activation failed.');
 const localPetId='auth-'+state.runId,deviceId='auth-http-'+state.runId;
 const {petId}=await api.enroll({operationId:crypto.randomUUID(),deviceId,localPetId,name:'Auth qualification puppy'});
 const recordId=cloudRecordId('event',petId,'auth-event'),at=Date.now();
 const pushed=await api.push([{protocolVersion:1,operationId:crypto.randomUUID(),deviceId,recordId,petId,kind:'event',baseRevision:0,intent:'create',patch:{type:'pee',at,source:'app',note:'Genuine OTP qualification'}}]);
 check(pushed.accepted.length===1&&pushed.rejected.length===0,'The genuine session event was not accepted.');
 const page=await api.pull(0),record=page.changes.find(value=>value.id===recordId);
 check(record?.data.at===at&&isDeepStrictEqual(record,pushed.accepted[0].record),'Push/pull did not preserve every field of the actual accepted event.');
 const summary=await api.account();
 const baseline=originalBaseline(state,summary,page);check(baseline.petId===petId,'Account/database summary differs from the explicitly enrolled puppy.');
 state.expectedPetId=petId;state.expectedEvent=baseline.record;state.baselineProvenance='genuine-push-pull';save(path,state);
 console.log('PASS '+mode+':consumed OTP rejected; explicit trial/enrollment and production SDK event push/pull/database summary match.');
 const oldCookie=state.cookie,logout=await request('/api/auth/sign-out',{method:'POST',body:{}});
 check(logout.status===200,'Genuine session logout failed.');
 check((await request('/api/account',{cookie:oldCookie})).status===401&&(await request('/api/sync/pull?after=0',{cookie:oldCookie})).status===401,'Logged-out session still accesses account or database sync.');
 state.cookie=null;state.phase='complete';save(path,state);
 console.log('PASS '+mode+':real logout rejects the old session for account and sync.');
 console.log('Private state:',path);
 console.log(state.exactOwner?'Exact-owner puppy/event retained for native sign-in; cleanup remains disabled without separate explicit authorization.':'Synthetic puppy/event retained after logout. Run cleanup-request then cleanup with a fresh genuine OTP for normal account retirement.');
}
function selfTest(){
 const folder=mkdtempSync(join(tmpdir(),'puptime-auth-self-check-'));chmodSync(folder,0o700);
 try{
  const path=join(folder,'state.json'),runId=crypto.randomUUID(),email=alias('local',runId);
  save(path,{version:1,mode:'local',base:origins.local,runId,email,phase:'requested',requestedAt:Date.now(),cookie:null,userId:null});
  check(readState(path,'local').email===email,'Private state round trip failed.');
  const worker=stagingOrigins[1];
  check(isDeepStrictEqual(target('staging'),{base:origins.staging,origin:origins.staging})&&isDeepStrictEqual(target('staging',worker),{base:worker,origin:origins.staging})&&isDeepStrictEqual(target('local',worker),{base:origins.local,origin:origins.local}),'Staging must default to Pages and both allowed transports must use its canonical Origin without changing local scope.');
  for(const invalid of ['https://example.invalid',worker+'/',worker+'/api','http://puptime.pages.dev',origins.staging+'?target=other']){
   let rejected=false;try{target('staging',invalid);}catch{rejected=true;}check(rejected,'Unexpected staging origins must reject.');
  }
  const legacyPath=join(folder,'legacy.json'),legacy={version:1,mode:'staging',base:worker,runId,email:`fixture+puptime-auth-${runId.replaceAll('-','')}@example.invalid`,phase:'complete',cookie:null,userId:'self-check'};
  save(legacyPath,legacy);const originalState=privateFile(legacyPath);
  let crossed=false;try{readState(legacyPath,'staging');}catch(error){crossed=error instanceof Failure&&error.message.includes('PUPTIME_STAGING_API_ORIGIN');}
  check(crossed&&privateFile(legacyPath)===originalState&&readState(legacyPath,'staging',target('staging',worker).base).base===worker,'Legacy Worker state must reject the Pages default unchanged and require its explicit matching origin.');
  save(legacyPath,{...legacy,base:origins.staging});check(readState(legacyPath,'staging').base===origins.staging,'New Pages state must match the staging default.');
  let reverseCrossed=false;try{readState(legacyPath,'staging',worker);}catch{reverseCrossed=true;}check(reverseCrossed,'Pages state must not replay through the Worker override.');
  chmodSync(path,0o644);let rejected=false;try{privateFile(path);}catch{rejected=true;}check(rejected,'World-readable private input must reject.');
  check(cookies(new Response('',{headers:{'set-cookie':'test=value; HttpOnly; Path=/'}}))==='test=value','Cookie extraction failed.');
  const proof={base:origins.staging,emailSha256:createHash('sha256').update(email).digest('hex'),matches:0,checkedAt:Date.now()};
  freshProof(proof,email,origins.staging,true);
  for(const invalid of [{...proof,matches:1},{...proof,base:origins.local},{...proof,emailSha256:'wrong'},{...proof,checkedAt:Date.now()-300001}]){
   let rejected=false;try{freshProof(invalid,email,origins.staging,true);}catch{rejected=true;}check(rejected,'Contradictory or stale fresh-inbox proof must reject.');
  }
  check(retryDelay('120')===60000&&retryDelay('2')===2000&&retryDelay(null)===60000&&retryDelay('invalid')===60000,'Sign-in rate-limit wait must be bounded.');
  const state={runId,email,userId:'self-check'},petId='auth-'+runId;
  const record={id:cloudRecordId('event',petId,'auth-event'),petId,kind:'event',revision:1,sequence:2,deleted:false,updatedAt:Date.now(),data:{type:'pee',at:Date.now(),source:'app',note:'Genuine OTP qualification'}};
  const account={user:{id:state.userId,email},pets:[{id:petId,eventCount:1}]},page={hasMore:false,changes:[record]};
  check(originalBaseline(state,account,page).record===record,'Baseline must retain the actual received record.');
  const history={revisions:[{deviceId:'auth-http-'+runId,intent:'create',baseRevision:0,before:null,reason:'created',after:record,proposal:record.data}]};originalHistory(state,record,history);
  for(const invalid of [{...page,hasMore:true},{...page,changes:[record,record]},{...page,changes:[{...record,revision:2}]},{...page,changes:[{...record,id:'wrong'}]},{...page,changes:[{...record,data:{...record.data,note:'changed'}}]}]){
   let rejected=false;try{originalBaseline(state,account,invalid);}catch{rejected=true;}check(rejected,'Ambiguous, changed or partial baseline must reject.');
  }
  for(const invalid of [{...account,pets:[...account.pets,...account.pets]},{...account,pets:[{id:'other',eventCount:1}]}]){
   let rejected=false;try{originalBaseline(state,invalid,page);}catch{rejected=true;}check(rejected,'Foreign or multiple puppy baseline must reject.');
  }
  let wrongDevice=false;try{originalHistory(state,record,{revisions:[{...history.revisions[0],deviceId:'other'}]});}catch{wrongDevice=true;}check(wrongDevice,'Foreign creation device must reject.');
  console.log('PASS canonical Pages Origin/default, strict API allowlist/state fences, private files/proof, bounded Retry-After, cookie parsing and original-record guards. No network, credentials, or modeled authentication executed.');
 }finally{rmSync(folder,{recursive:true,force:true});}
}
try{if(process.argv[2]==='--self-test')selfTest();else await main();}
catch(error){console.error(error instanceof Failure?error.message:error instanceof CloudApiError?'Service qualification failed: '+error.category+'. Private details withheld.':'Qualification failed; private input and response details withheld.');process.exitCode=1;}

// Actual installed Expo SDK + isolated local Better Auth/HTTP history journey.
// The private authenticate phase must be unrecorded. Never clear/reseed a store
// or overwrite native-fixture.json / first-launch-fixture.json.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {cpSync,existsSync,mkdtempSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {homedir,tmpdir} from 'node:os';
import {basename,join,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createCloudApi} from '../src/cloud/api.ts';
import {cloudRecordId} from '../src/cloud/record-identity.ts';
import {eventDataFromSql} from '../src/record-sql.ts';

const [phase,udid,permission]=process.argv.slice(2),app='com.patrickchin.puptime';
assert.ok(['authenticate','cloud','stale','offline','verify-offline'].includes(phase),'Use authenticate, cloud, stale or offline in that order; verify-offline only inspects an already submitted saved restoration.');
assert.equal(permission,'--adopt-synthetic','Explicitly authorize adopting only this task’s existing marked synthetic fixture.');
const state=JSON.parse(readFileSync('/tmp/puptime-native-cloud-state.json','utf8'));
assert.ok(basename(state.directory).startsWith('puptime-native-cloud-'));assert.equal(state.url,'http://127.0.0.1:8793');
const simctl=(...args)=>execFileSync('xcrun',['simctl',...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const device=Object.values(JSON.parse(simctl('list','devices','available','-j')).devices).flat().find(item=>item.udid===udid);
assert.ok(device?.name.startsWith('Puptime Native Storage ios-history-ui '),'Use the child worktree’s dedicated history device, never D931.');assert.equal(device.state,'Booted');
assert.match(udid,/^[A-Fa-f0-9-]{36}$/);
const directory=join(simctl('get_app_container',udid,app,'data'),'Documents/SQLite'),path=join(directory,'puptime-v2.db');
assert.ok(existsSync(path),'Prepare the existing marked1001-event fixture first.');
const native=new DatabaseSync(path,{readOnly:true});native.exec('PRAGMA busy_timeout=5000');
const contextPath=join(state.directory,'owned-history-fixture-'+udid+'.json');
const context=existsSync(contextPath)?JSON.parse(readFileSync(contextPath,'utf8')):{udid,email:'owned-history-'+crypto.randomUUID()+'@example.invalid',stage:'new'};
assert.equal(context.udid,udid);assert.match(context.email,/^owned-history-[a-f0-9-]{36}@example\.invalid$/);
const save=()=>writeFileSync(contextPath,JSON.stringify(context,null,2),{mode:0o600});
const tables=()=>native.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(row=>row.name);
const snapshot=()=>Object.fromEntries(tables().map(name=>[name,native.prepare(`SELECT * FROM "${name.replaceAll('"','""')}" ORDER BY rowid`).all().map(row=>({...row}))]));
const targetId='history-fixture-target',petId='history-fixture-pet';
const target=()=>native.prepare('SELECT * FROM events WHERE pet_id=? AND id=?').get(petId,targetId);
const untouched=()=>native.prepare('SELECT * FROM events WHERE pet_id=? AND id<>? ORDER BY id').all(petId,targetId).map(row=>({...row}));
const owner=()=>native.prepare('SELECT * FROM local_sync_owner').get();
const pending=()=>native.prepare('SELECT * FROM local_sync_outbox ORDER BY sequence').all().map(row=>({...row}));
const latestLocal=()=>native.prepare("SELECT sequence,after_data FROM local_revisions WHERE pet_id=? AND kind='event' AND local_id=? ORDER BY sequence DESC LIMIT 1").get(petId,targetId);
const quoteRegex=value=>'^'+value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$';
let authDb,output,code='';
function authDatabase(){
 for(const file of readdirSync(join(state.persist,'v3/d1'),{recursive:true}).filter(file=>typeof file==='string'&&file.endsWith('.sqlite'))){
  const database=new DatabaseSync(join(state.persist,'v3/d1',file),{readOnly:true});
  if(database.prepare("SELECT name FROM sqlite_master WHERE name='local_email_previews'").get())return database;
  database.close();
 }
 throw new Error('Isolated local identity database not found.');
}
async function until(check,message,attempts=480){
 for(let i=0;i<attempts;i++){if(await check())return;await new Promise(resolve=>setTimeout(resolve,250));}assert.fail(message);
}
function run(name,values={},privateAuth=false){
 const file=resolve('.maestro/native/ios-owned-history-'+name+'.yaml');
 const runOutput=privateAuth?mkdtempSync(join(state.directory,'private-owned-history-')):join(output,name);
 const wrapper=join(privateAuth?runOutput:output,name+'-active.yaml');
 writeFileSync(wrapper,'appId: '+app+'\n---\n- launchApp:\n    stopApp: false\n    permissions: {}\n- waitForAnimationToEnd\n- runFlow: '+JSON.stringify(file)+'\n',{mode:0o600});
 const startup=join(homedir(),'.maestro/tests'),before=new Set(existsSync(startup)?readdirSync(startup):[]);
 try{
  execFileSync(process.env.MAESTRO_BIN??'maestro',['--device',udid,'test',...Object.entries(values).flatMap(([key,value])=>['-e',`${key}=${value}`]),wrapper,'--test-output-dir',runOutput],{stdio:privateAuth?['ignore','pipe','pipe']:'inherit',env:{...process.env,MAESTRO_CLI_NO_ANALYTICS:'1',...(privateAuth?{MAESTRO_TEST_CODE:code}:{})}});
 }catch(error){if(privateAuth)throw new Error('Private owned-history authentication flow failed; raw code traces discarded.');throw error;}
 finally{
  if(privateAuth){
   // Remove only this invocation's new global logs/screenshots, which can hold
   // OTP entry. Preserve unrelated task runs even if they start concurrently.
   if(existsSync(startup))for(const name of readdirSync(startup).filter(name=>!before.has(name))){
    const candidate=join(startup,name),log=join(candidate,'maestro.log');
    if(existsSync(log)){
     const text=readFileSync(log,'utf8');
     if(text.includes(wrapper)||text.includes(file))rmSync(candidate,{recursive:true,force:true});
     else if(code&&text.includes(code))writeFileSync(log,text.replaceAll(code,'[REDACTED]'),{mode:0o600});
    }
   }
   rmSync(runOutput,{recursive:true,force:true});
  }
 }
}
async function response(path,{method='GET',body,cookie=''}={}){
 // Maestro runs synchronously. A local peer socket may expire while Node cannot
 // process its close event; do not reuse that stale socket after the UI returns.
 return fetch(state.url+path,{method,headers:{origin:state.url,connection:'close',...(cookie?{cookie}:{}),...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(15000)});
}
async function post(path,body,cookie=''){
 for(let attempt=0;attempt<2;attempt++){
  const result=await response(path,{method:'POST',body,cookie});
  if(result.status===429&&attempt===0){
   const seconds=Number(result.headers.get('retry-after')),delay=Number.isFinite(seconds)&&seconds>0?Math.min(60000,Math.ceil(seconds*1000)):60000;
   console.log('Waiting for the existing local identity rate-limit window; no limiter reset.');
   await new Promise(resolve=>setTimeout(resolve,delay));continue;
  }
  assert.equal(result.status,200,'The isolated authenticated service request must succeed.');return result;
 }
}
async function independentApi(){
 // Real local Better Auth OTP/session endpoints, never signed fake cookies.
 await post('/api/auth/email-otp/send-verification-otp',{email:context.email,type:'sign-in'});
 const otp=authDb.prepare('SELECT code FROM local_email_previews WHERE email=? ORDER BY expires_at DESC LIMIT 1').get(context.email)?.code;
 assert.match(otp??'',/^\d{6}$/);
 const login=await post('/api/auth/sign-in/email-otp',{email:context.email,otp});
 const cookie=login.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');assert.ok(cookie);
 return createCloudApi(async(path,options)=>{
  const result=await response(path,{...options,cookie});return {data:await result.json(),error:result.ok?null:{status:result.status},retryAfter:result.headers.get('retry-after')};
 });
}
async function cloudRows(api){
 const changes=[];let cursor=0;
 for(let page=0;page<30;page++){
  const result=await api.pull(cursor);assert.ok(!result.resyncRequired);changes.push(...result.changes);
  if(!result.hasMore)return changes;
  assert.ok(result.cursor>cursor);cursor=result.cursor;
 }
 assert.fail('Owned synthetic cloud snapshot exceeded its bounded pages.');
}
function currentCloudEvents(rows){
 const current=new Map();
 for(const row of rows)if(!current.has(row.id)||current.get(row.id).sequence<row.sequence)current.set(row.id,row);
 return [...current.values()].filter(row=>row.kind==='event'&&!row.deleted);
}
function binding(){return native.prepare('SELECT * FROM local_sync_pets WHERE pet_id=?').get(petId);}
function mirrored(){const row=native.prepare('SELECT body FROM local_sync_records WHERE generation=? AND record_id=?').get(owner().generation,context.recordId);return row?JSON.parse(row.body):null;}
function assertOwned(){assert.equal(owner()?.account_id,context.userId);assert.equal(owner()?.generation,context.generation);assert.equal(binding()?.cloud_pet_id,context.cloudPetId);}
function assertUntouched(){assert.deepEqual(untouched(),JSON.parse(readFileSync(context.untouchedPath,'utf8')),'All1000 unrelated event IDs and fields must stay exact.');}
function serviceProcess(){
 const pids=execFileSync('lsof',['-t','-iTCP:8793','-sTCP:LISTEN'],{encoding:'utf8'}).trim().split(/\s+/);assert.equal(pids.length,1);
 const pid=Number(pids[0]),parent=execFileSync('ps',['-p',String(pid),'-o','ppid='],{encoding:'utf8'}).trim();
 const command=execFileSync('ps',['-p',parent,'-o','command='],{encoding:'utf8'});
 assert.ok(command.includes(state.config)&&state.config.startsWith(state.directory+'/'),'Pause only the exact isolated local backend.');
 assert.ok(!execFileSync('ps',['-p',String(pid),'-o','stat='],{encoding:'utf8'}).includes('T'),'Do not adopt an already paused process.');return pid;
}
try{
 assert.equal(native.prepare("SELECT value FROM metadata WHERE key='qualification_fixture'").get()?.value,'native-history-v1');
 assert.equal(native.prepare("SELECT value FROM metadata WHERE key='active_pet_id'").get()?.value,petId);
 assert.equal(native.prepare('SELECT count(*) n FROM events').get().n,1001,'Do not adopt a completed1002-event recovery fixture. Prepare --open-only explicitly.');
 assert.equal(native.prepare("SELECT count(*) n FROM events WHERE id NOT LIKE 'history-fixture-%'").get().n,0);
 assert.equal(native.prepare('SELECT count(*) n FROM puppies').get().n,1);
 assert.equal(native.prepare('SELECT value FROM settings WHERE key=?').get('puptime.language.v1')?.value,'en','Use the existing English fixture; this qualifier never changes preferences.');
 assert.equal(target()?.type,'custom');assert.equal(target().custom_label,'Training');assert.equal(target().estimated,1);assert.equal(target().source,'widget');
 authDb=authDatabase();
 if(phase==='authenticate'){
  assert.ok(['new','requested','verified'].includes(context.stage),'This context is already adopted.');
  if(owner()){assert.equal(context.stage,'verified','Only resume this context’s interrupted activation.');assert.equal(owner().account_id,context.userId,'Never adopt another owner.');}
  else assert.equal(pending().length,0);
  if(context.stage==='new'){
   context.backup=mkdtempSync(join(state.directory,'owned-history-before-auth-'));cpSync(directory,join(context.backup,'SQLite'),{recursive:true});
   context.originalTarget={...target()};context.untouchedPath=join(context.backup,'untouched.json');writeFileSync(context.untouchedPath,JSON.stringify(untouched()),{mode:0o600});
   assert.equal(untouched().length,1000);save();
   const before=snapshot();run('request',{TEST_EMAIL:context.email},true);assert.deepEqual(snapshot(),before,'Requesting a code changes no puppy/account/outbox row.');
   context.stage='requested';save();
  }
  if(context.stage==='requested'){
   if(context.verificationAttempted)run('resend',{},true);context.verificationAttempted=true;save();
   code=authDb.prepare('SELECT code FROM local_email_previews WHERE email=? ORDER BY expires_at DESC LIMIT 1').get(context.email)?.code;
   assert.match(code??'',/^\d{6}$/);const before=snapshot();run('verify',{},true);code='';
   assert.deepEqual(snapshot(),before,'Official native sign-in does not activate or enqueue anything.');
   context.userId=authDb.prepare('SELECT id FROM user WHERE email=?').get(context.email)?.id;assert.ok(context.userId);
   assert.equal(authDb.prepare('SELECT account_id FROM cloud_accounts WHERE account_id=?').get(context.userId),undefined);
   context.stage='verified';save();
  }
  run(owner()?'resume-auth':'enable',{},true);
  await until(()=>owner()?.account_id===context.userId&&binding()?.status==='active'&&pending().length===0,'Actual native enrollment/upload must finish.');
  context.generation=owner().generation;context.cloudPetId=binding().cloud_pet_id;context.recordId=cloudRecordId('event',context.cloudPetId,targetId);
  assertUntouched();assert.deepEqual({...target()},context.originalTarget,'Explicit activation preserves the complete target log.');
  const api=await independentApi(),account=await api.account();assert.equal(account.user.id,context.userId);assert.equal(account.pets[0].eventCount,1001);
  context.stage='authenticated';save();
  console.log('PASS unrecorded actual Expo SDK sign-in plus explicit activation/Combine uploaded1001 exact existing logs; no data reset or implicit trial before activation. Separate private context retained.');
 }else{
  assertOwned();assertUntouched();
  output=mkdtempSync(join(tmpdir(),'puptime-owned-history-'+phase+'-'));
  cpSync(directory,join(output,'previous-owned-synthetic-sqlite'),{recursive:true});
  console.log('Recorded owned-history phase:',phase,'; synthetic backup/evidence:',output);
  const api=await independentApi();assert.equal((await api.account()).user.id,context.userId);
  if(phase==='cloud'){
   assert.ok(['authenticated','cloud-seeded'].includes(context.stage));assert.equal(pending().length,0);
   if(context.stage==='authenticated'){
   const start=(await api.history(context.recordId)).revisions[0];assert.ok(start);context.selectedRevision=start.revision;context.selectedCloudNote=start.after.data.note;
   context.httpDevice='owned-history-'+crypto.randomUUID();
   await api.enroll({operationId:crypto.randomUUID(),deviceId:context.httpDevice,localPetId:'owned-http-fixture',confirmedPetId:context.cloudPetId,name:'History puppy'});
   const mutations=Array.from({length:55},(_,index)=>({protocolVersion:1,operationId:crypto.randomUUID(),deviceId:context.httpDevice,recordId:context.recordId,petId:context.cloudPetId,kind:'event',baseRevision:start.revision+index,intent:'patch',patch:{note:'Owned cloud version '+(index+1)}}));
   for(let offset=0;offset<mutations.length;offset+=50){const result=await api.push(mutations.slice(offset,offset+50));assert.deepEqual(result.rejected,[]);}
   context.latestRevision=start.revision+55;context.stage='cloud-seeded';save();
   }else{
    const retained=(await api.history(context.recordId)).revisions[0];
    assert.equal(retained.revision,context.latestRevision,'Resume only the exact retained cloud fixture; never seed more revisions after a failed read.');
    assert.equal(retained.after.data.note,'Owned cloud version 55');
    console.log('Resuming the retained cloud-seeded fixture; no reseeding or reset.');
   }
   await until(()=>mirrored()?.revision===context.latestRevision&&target().note==='Owned cloud version 55'&&pending().length===0,'Actual native WSS/HTTP must project the final independent version.');
   const before=snapshot();run('cloud',{LATEST_REVISION:String(context.latestRevision),SELECTED_REVISION:String(context.selectedRevision),EXPECTED_CLOUD_NOTE:quoteRegex(context.selectedCloudNote)});
   assert.deepEqual(snapshot(),before,'Native cloud reads/paging/selection/Cancel preserve every SQLite table.');
   assertUntouched();context.stage='cloud';save();
   console.log('PASS actual Expo SDK history reads50+older cloud versions; selection/confirmation Cancel change no SQLite table and preserve1000 unrelated logs.');
  }else if(phase==='stale'){
   assert.equal(context.stage,'cloud');assert.equal(pending().length,0);assert.equal(context.staleMutation,undefined,'Inspect a prior submitted stale operation; never blindly submit another remote edit.');
   const prior=latestLocal();context.localSequence=prior.sequence;context.localNote=JSON.parse(prior.after_data).note;
   const current=(await api.history(context.recordId)).revisions[0];
   assert.equal(current.revision,context.latestRevision,'Prepare only the exact retained cloud head.');
   run('stale-prepare',{EXPECTED_CLOUD_NOTE:quoteRegex(context.selectedCloudNote)});
   context.staleMutation={protocolVersion:1,operationId:crypto.randomUUID(),deviceId:context.httpDevice,recordId:context.recordId,petId:context.cloudPetId,kind:'event',baseRevision:current.revision,intent:'patch',patch:{note:'Independent newer owned version'}};
   context.stage='stale-submitted';save();
   const result=await api.push([context.staleMutation]);assert.deepEqual(result.rejected,[]);
   await until(()=>target().note==='Independent newer owned version'&&mirrored()?.revision===current.revision+1,'The foreground account change channel must project the actual remote edit.');
   context.pendingSequence=latestLocal().sequence;const before=snapshot();
   run('stale',{LOCAL_SEQUENCE:String(context.localSequence),EXPECTED_LOCAL_NOTE:quoteRegex(context.localNote)});
   assert.deepEqual(snapshot(),before,'Stale recovery and selecting a local version cannot write any table.');
   assertUntouched();context.stage='stale';save();
   console.log('PASS actual independent HTTP/WSS edit invalidates native restore confirmation; Reload/local selection changes no SQL rows.');
  }else if(phase==='verify-offline'){
   assert.equal(context.stage,'offline-restored','Inspect only the saved completed offline intent; never submit another restore.');assert.ok(context.queuedOperation);assert.equal(pending().length,0);
   const ack=native.prepare('SELECT mutation_json,outcome FROM local_sync_acks WHERE generation=? AND operation_id=?').get(context.generation,context.queuedOperation);assert.equal(ack?.outcome,'accepted');
   const mutation=JSON.parse(ack.mutation_json);assert.equal(mutation.operationId,context.queuedOperation);assert.equal(mutation.intent,'restore');assert.equal(mutation.recordId,context.recordId);assert.equal(mutation.patch.note,context.localNote);
   const selected=JSON.parse(native.prepare('SELECT after_data FROM local_revisions WHERE sequence=? AND pet_id=? AND local_id=?').get(context.localSequence,petId,targetId).after_data);
   assert.deepEqual(eventDataFromSql(target()),selected,'The saved restore must retain every selected event field.');
   const history=(await api.history(context.recordId)).revisions;
   assert.equal(history[0].operationId,context.queuedOperation);assert.equal(history[0].reason,'restored');assert.equal(history[0].revision,mutation.baseRevision+1);assert.deepEqual(history[0].after.data,selected);assert.equal(history.filter(row=>row.operationId===context.queuedOperation).length,1);assert.deepEqual(mirrored(),history[0].after);
   const current=currentCloudEvents(await cloudRows(api));assert.equal(current.length,1001);
   for(const row of native.prepare('SELECT * FROM events ORDER BY id').all()){
    const remote=current.find(value=>value.id===cloudRecordId('event',context.cloudPetId,row.id));assert.ok(remote);assert.deepEqual(remote.data,eventDataFromSql(row),'Every current server event must match the retained local log.');
   }
   assertOwned();assertUntouched();const before=snapshot();
   try{run('synced');}finally{assert.deepEqual(snapshot(),before,'Read-only completion UI must preserve every SQLite table, even after a failed command.');}
   context.stage='complete';save();
   console.log('PASS read-only completion of the saved offline restoration: one exact accepted operation/current revision,1001 distinct current cloud events matching every local field, unchanged1000 unrelated logs and all-table read-only Up to date UI; no restoration replay.');
  }else{
   assert.equal(context.stage,'stale');assert.equal(pending().length,0);
   const beforeTarget={...target()},beforeOwner={...owner()},baseRevision=mirrored().revision;
   const restoreCount=native.prepare("SELECT count(*) n FROM local_revisions WHERE pet_id=? AND local_id=? AND source='restore'").get(petId,targetId).n;
   const serverBefore=(await api.history(context.recordId)).revisions[0];assert.equal(serverBefore.revision,baseRevision);
   const beforeCloud=(await cloudRows(api)).filter(row=>row.kind==='event'&&row.id!==context.recordId);
   const pid=serviceProcess();let queued;
   process.kill(pid,'SIGSTOP');
   try{
    run('restore');await until(()=>pending().length===1,'Offline restoration queues exactly one operation.');
    assert.equal(target().note,context.localNote);assert.equal(target().id,beforeTarget.id);assert.equal(target().at,beforeTarget.at);assert.equal(target().source,'widget');assert.equal(target().estimated,1);assert.equal(target().custom_label,'Training');
    queued=pending();const mutation=JSON.parse(queued[0].mutation_json);assert.equal(mutation.intent,'restore');assert.equal(mutation.baseRevision,baseRevision);assert.equal(mutation.recordId,context.recordId);assert.equal(mutation.patch.note,context.localNote);
    assert.deepEqual({...owner()},beforeOwner);assertUntouched();
    assert.equal(native.prepare("SELECT count(*) n FROM local_revisions WHERE pet_id=? AND local_id=? AND source='restore'").get(petId,targetId).n,restoreCount+1);
    const restored=snapshot();run('pending',{PENDING_SEQUENCE:String(context.pendingSequence)});assert.deepEqual(snapshot(),restored,'Pending restoration denial preserves every SQLite table.');
    run('restart');assert.deepEqual(pending(),queued,'Cold restart preserves the exact queued restore operation.');assert.equal(target().note,context.localNote);assertOwned();assertUntouched();
    context.queuedOperation=mutation.operationId;context.stage='offline-restored';save();
   }finally{process.kill(pid,'SIGCONT');}
   run('reconnect');
   await until(()=>pending().length===0&&mirrored()?.revision===baseRevision+1,'Reconnect must acknowledge the original restore automatically.');
   const history=(await api.history(context.recordId)).revisions;
   assert.equal(history[0].operationId,context.queuedOperation);assert.equal(history[0].reason,'restored');assert.equal(history[0].revision,baseRevision+1);assert.equal(history.filter(row=>row.operationId===context.queuedOperation).length,1);
   assert.equal(history[0].after.data.note,context.localNote);assert.equal(history[0].after.data.estimated,true);assert.equal(history[0].after.data.customLabel,'Training');assert.equal(history[0].after.data.source,'widget');
   const afterCloud=await cloudRows(api);assert.deepEqual(afterCloud.filter(row=>row.kind==='event'&&row.id!==context.recordId),beforeCloud,'No unrelated cloud event changed.');
   assert.equal(currentCloudEvents(afterCloud).length,1001);assertUntouched();assertOwned();
   run('synced');context.stage='complete';save();
   console.log('PASS actual owned offline restoration queues one current-revision intent, denies a second pending restore without writes, survives cold restart and converges on ordinary foreground reconnect to exactly one accepted server revision;1000 unrelated local/cloud logs and provenance stay intact.');
  }
 }
}finally{authDb?.close();native.close();code='';}

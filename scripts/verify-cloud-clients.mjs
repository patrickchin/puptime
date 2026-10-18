// Real HTTP + independent persistent SQLite clients. Authentication is an
// administrative synthetic session, not email/provider-delivery evidence.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync,mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {serializeSignedCookie} from 'better-call';
import {createLocalDatabase,initializeLocalDatabase} from '../src/local/database.ts';
import {sqliteTestConnection} from '../src/local/sqlite-test-adapter.ts';
import {createLocalRuntime} from '../src/local/runtime-factory.ts';
import {createCloudApi,CloudApiError} from '../src/cloud/api.ts';
import {createSyncRunner} from '../src/cloud/runner.ts';
import {cloudRecordId} from '../src/cloud/record-identity.ts';
const mode=process.argv[2]??'local';assert.ok(['local','staging'].includes(mode));
const local=mode==='local'?JSON.parse(readFileSync('/tmp/puptime-native-cloud-state.json','utf8')):null;
const base=local?.url??'https://puptime-api-staging.p-ch.workers.dev';
assert.equal(base,mode==='local'?'http://127.0.0.1:8793':'https://puptime-api-staging.p-ch.workers.dev');
const origin=mode==='local'?base:'https://puptime.pages.dev';
const secret=mode==='local'?readFileSync(join(local.directory,'.dev.vars'),'utf8').match(/^AUTH_SECRET=(.+)$/m)?.[1]:process.env.PUPTIME_STAGING_AUTH_SECRET;
assert.ok(secret?.length>=32,'Supply the private staging auth secret through the environment.');
const directory=mkdtempSync(join(tmpdir(),`puptime-http-${mode}-`)),owners=[],clients=[],channels=[];
function sql(query){
 const path=join(directory,'fixture.sql');writeFileSync(path,query,{mode:0o600});
 const options=local?['--local','--config',local.config,'--persist-to',local.persist]:['--remote','--env','staging'];
 try{execFileSync('npx',['wrangler','d1','execute','AUTH_DB',...options,'--file',path,'--json'],{stdio:['ignore','pipe','pipe'],env:{...process.env,CI:'1'}});}catch(error){const raw=String(error.stdout??'')+'\n'+String(error.stderr??'');const codes=[...raw.matchAll(/(?:code[:\"\s]+)([0-9]{3,6})/gi)].map(match=>match[1]);throw new Error('Administrative fixture SQL failed (exit '+error.status+', numeric codes '+codes.join(',')+'); private output withheld.');}
}
async function fixture(){
 const id=crypto.randomUUID(),token=crypto.randomUUID(),now=Date.now();
 const cookie=(await serializeSignedCookie(mode==='local'?'better-auth.session_token':'__Secure-better-auth.session_token',token,secret,{path:'/',httpOnly:true,secure:mode==='staging'})).split(';')[0];
 const owner={id,cookie};owners.push(owner);
 sql(`INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES ('${id}','HTTP qualification','${id}@example.invalid',1,${now},${now}); INSERT INTO session(id,token,userId,expiresAt,createdAt,updatedAt) VALUES ('${crypto.randomUUID()}','${token}','${id}',${now+3600000},${now},${now});`);
 return owner;
}
async function response(owner,path,{method='GET',body,signal}={}){
 return fetch(base+path,{method,headers:{origin,cookie:owner.cookie,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000)});
}
function transport(owner){let count=0;const api=createCloudApi(async(path,options)=>{
 count++;const result=await response(owner,path,options);return {data:await result.json(),error:result.ok?null:{status:result.status},retryAfter:result.headers.get('retry-after')};
 });return {api,get calls(){return count;}};}
async function until(check,message){for(let i=0;i<150;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,100));}assert.fail(message);}
async function channel(owner){
 // Node's built-in Undici WebSocket supports header options, like the actual
 // React Native constructor. Keep bearer credentials out of the URL/payload.
 const socket=new WebSocket(base.replace(/^http/,'ws')+'/api/sync/changes',{headers:{cookie:owner.cookie,origin}});
 const observed={socket,owner,messages:[],invalid:false,closed:false,opened:false};channels.push(observed);
 socket.addEventListener('open',()=>{observed.opened=true;});
 socket.addEventListener('close',()=>{observed.closed=true;});
 socket.addEventListener('error',()=>{observed.invalid=true;});
 socket.addEventListener('message',event=>{
  try{
   assert.equal(typeof event.data,'string');assert.ok(event.data.length<=256);
   const value=JSON.parse(event.data);assert.deepEqual(Object.keys(value).sort(),['cursor','protocolVersion']);
   assert.equal(value.protocolVersion,1);assert.ok(Number.isSafeInteger(value.cursor)&&value.cursor>=0);
   observed.messages.push(value);
  }catch{observed.invalid=true;}
 });
 await until(()=>observed.opened||observed.invalid,'Authenticated change channel did not open.');assert.equal(observed.invalid,false);
 await until(()=>observed.messages.length>0,'Change channel did not send its initial cursor.');return observed;
}
let primary,remote,sessionId,success=false;
async function open(name,{pristine=false}={}){
 const path=join(directory,name+'.db'),fresh=!existsSync(path),database=await createLocalDatabase(sqliteTestConnection(path));
 await initializeLocalDatabase(database,()=> name);if(fresh&&!pristine)await database.write(sql=>sql.runAsync('DELETE FROM routines'));
 const runtime=await createLocalRuntime(database,name);
 const runner=createSyncRunner({sync:runtime.sync,api:remote.api,petId:name,deviceId:runtime.deviceId,sessionAccountId:()=>sessionId,changed:()=>{},random:()=>1});
 const client={...runtime,name,runner,closed:false,async close(){if(!this.closed){this.closed=true;await database.close();}}};clients.push(client);return client;
}
async function prepare(client,confirmedPetId,mode='combine'){
 const name=mode==='restore'?(await remote.api.account()).pets.find(pet=>pet.id===confirmedPetId).name:'HTTP puppy';
 return client.sync.prepareAssociation({accountId:primary.id,localPetId:client.name,deviceId:client.deviceId,mode,enrollment:{operationId:crypto.randomUUID(),deviceId:client.deviceId,localPetId:client.name,name,...(confirmedPetId?{confirmedPetId}:{})}});
}
async function run(client){const before=remote.calls;const result=await client.runner.run(new AbortController().signal);assert.ok(remote.calls-before<=20,'Each runner invocation must remain bounded.');return result;}
async function drain(client){for(let i=0;i<15;i++){const result=await run(client);if(result.state==='synced')return;assert.ok(['pending','retry'].includes(result.state),`Unexpected runner state: ${result.state}/${result.problem}`);}assert.fail('Backlog failed to finish in bounded runs.');}
async function history(recordId){const result=await response(primary,`/api/records/${encodeURIComponent(recordId)}/history`);assert.equal(result.status,200);return (await result.json()).revisions;}
try{
 primary=await fixture();remote=transport(primary);sessionId=primary.id;
 await remote.api.startTrial();
 const other=await fixture();assert.equal((await response(other,'/api/cloud/trial',{method:'POST',body:{}})).status,200);
 const primaryChannel=await channel(primary),otherChannel=await channel(other);
 let a=await open('local-a');
 const events=Array.from({length:1000},(_,index)=>({id:index===0?'old-export-犬/'+ 'x'.repeat(230):`history-${String(index).padStart(4,'0')}`,type:index%2?'meal':'pee',at:1000000+index,source:'app',note:`Fixture history ${index}`}));
 await a.storage.appendEvents(events);assert.equal((await a.sync.status(a.name)).pending,0);
 await prepare(a);
 let loseEnrollment=true,losePush=true;
 const enroll=remote.api.enroll,push=remote.api.push;
 remote.api.enroll=async(...args)=>{const result=await enroll(...args);if(loseEnrollment){loseEnrollment=false;throw new CloudApiError('network');}return result;};
 remote.api.push=async(...args)=>{const result=await push(...args);if(losePush){losePush=false;throw new CloudApiError('network');}return result;};
 assert.equal((await run(a)).state,'retry');const originalEnrollment=await a.sync.enrollmentState();assert.ok(originalEnrollment);await a.close();a=await open('local-a');assert.deepEqual(await a.sync.enrollmentState(),originalEnrollment);
 assert.equal((await run(a)).state,'retry');assert.ok((await a.sync.status(a.name)).pending>0);await a.close();a=await open('local-a');await drain(a);
 const cloudPet=(await remote.api.account()).pets[0].id;const firstId=cloudRecordId('event',cloudPet,events[0].id);
 assert.equal((await history(firstId)).length,1,'Lost committed push retries must not duplicate history.');
 assert.equal((await remote.api.account()).pets[0].eventCount,1000);
 await until(()=>primaryChannel.messages.some(message=>message.cursor>0),'Committed HTTP changes must reach the actual socket.');
 assert.equal(primaryChannel.invalid,false);assert.equal(otherChannel.invalid,false);assert.ok(otherChannel.messages.every(message=>message.cursor===0),'A second owner must never receive the primary cursor.');
 console.log(`PASS ${mode}:authenticated WebSocket carries only protocol/cursor metadata after actual commits, with independent owner isolation.`);
 console.log(`PASS ${mode}:1000 real HTTP uploads, lost enrollment/push replies and disk restart preserve exact requests/history, including encoded long IDs.`);
 await a.storage.savePuppyName('Cloud Basil');
 await a.storage.saveScheduleEntry({id:'starter-1',type:'pee',minutes:500,reminder:true});
 await a.storage.saveThemePreference('soft-play');await a.storage.saveLanguagePreference('es');await drain(a);
 async function cloudSnapshot(){
  const changes=[];let cursor=0;
  for(let pageNumber=0;pageNumber<20;pageNumber++){
   const page=await remote.api.pull(cursor);changes.push(...page.changes);
   if(!page.hasMore)return {changes,cursor:page.cursor};
   assert.ok(page.cursor>cursor);cursor=page.cursor;
  }
  assert.fail('Synthetic cloud snapshot must finish in bounded pages.');
 }
 const beforeRestore=await cloudSnapshot();
 let restored=await open('restore-c',{pristine:true});await restored.storage.saveFirstLaunchProfile('Fresh local draft');await prepare(restored,cloudPet,'restore');
 const restorePull=remote.api.pull,restorePush=remote.api.push;let restorePages=0,interruptRestore=true;
 remote.api.pull=async(...args)=>{const page=await restorePull(...args);if(interruptRestore&&++restorePages===3){interruptRestore=false;throw new CloudApiError('network');}return page;};
 remote.api.push=async()=>{throw new Error('A pristine restore must never send local defaults.');};
 try{
  assert.equal((await run(restored)).state,'retry');const intent=await restored.sync.enrollmentState();assert.equal(intent.mode,'restore');
  assert.equal(await restored.storage.loadPuppyName(),'Fresh local draft');assert.equal((await restored.storage.loadEvents()).length,0);assert.equal((await restored.storage.loadSchedule()).length,12);
  await restored.close();restored=await open('restore-c',{pristine:true});assert.deepEqual(await restored.sync.enrollmentState(),intent);await drain(restored);
 }finally{remote.api.pull=restorePull;remote.api.push=restorePush;}
 assert.equal(await restored.storage.loadPuppyName(),'Cloud Basil');assert.deepEqual(await restored.storage.loadEvents(),[...events].reverse());
 assert.deepEqual(await restored.storage.loadSchedule(),[{id:'starter-1',type:'pee',minutes:500,reminder:true}]);
 assert.equal(await restored.storage.loadThemePreference(),'soft-play');assert.equal(await restored.storage.loadLanguagePreference(),'es');assert.equal(await restored.storage.loadNotificationDelivery(),false);
 assert.equal((await restored.sync.status(restored.name)).pending,0);
 assert.equal((await restored.database.read(sql=>sql.getFirstAsync('SELECT count(*) n FROM puppies'))).n,1);
 assert.equal((await restored.database.read(sql=>sql.getFirstAsync('SELECT cloud_pet_id FROM local_sync_pets'))).cloud_pet_id,cloudPet);
 assert.deepEqual(await cloudSnapshot(),beforeRestore);
 console.log(`PASS ${mode}:pristine restore resumes a lost middle HTTP baseline after disk restart, restores1000 exact events/name/routine/preferences, retains one local puppy/device opt-out and sends no defaults or cloud changes.`);
 let b=await open('local-b');await prepare(b,cloudPet);
 const pull=remote.api.pull;let pages=0,interrupt=true;
 remote.api.pull=async(...args)=>{const result=await pull(...args);if(interrupt&&++pages===3){interrupt=false;throw new CloudApiError('network');}return result;};
 assert.equal((await run(b)).state,'retry');assert.equal((await b.storage.loadEvents()).length,0,'An incomplete initial baseline must not replace visible local history.');await b.close();b=await open('local-b');await drain(b);
 assert.deepEqual(await b.storage.loadEvents(),[...events].reverse());
 console.log(`PASS ${mode}:a second persistent SQLite client resumes a dropped middle baseline page and restores all1000 exact records atomically.`);
 await a.storage.updateEvent(events[0].id,{note:'Independent A note'});await b.storage.updateEvent(events[0].id,{at:events[0].at+5000});
 let release,entered;const gate=new Promise(resolve=>{release=resolve;}),waiting=new Promise(resolve=>{entered=resolve;});let hold=true;
 remote.api.pull=async(...args)=>{const page=await pull(...args);if(hold){hold=false;entered();await gate;}return page;};
 const bRun=run(b);await Promise.race([waiting,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Concurrent pull did not start.')),15000))]);
 await drain(a);release();await bRun;await drain(b);await drain(a);remote.api.pull=pull;
 for(const client of [a,b]){const record=(await client.storage.loadEvents()).find(event=>event.id===events[0].id);assert.equal(record.note,'Independent A note');assert.equal(record.at,events[0].at+5000);}
 const revisions=await history(firstId);assert.equal(revisions.length,3);assert.equal(revisions[0].reason,'merged');
 console.log(`PASS ${mode}:delayed actual HTTP responses produce concurrent field edits that merge on the server and converge on both clients.`);
 await a.database.write(sql=>sql.runAsync('UPDATE local_sync_owner SET cursor=1000000'));
 await a.storage.updateEvent(events[0].id,{note:'Pending edit survives complete resync'});
 pages=0;interrupt=true;remote.api.pull=async(...args)=>{const page=await pull(...args);if(interrupt&&++pages===4){interrupt=false;throw new CloudApiError('network');}return page;};
 assert.equal((await run(a)).state,'retry');assert.equal((await a.storage.loadEvents()).length,1000);assert.equal((await a.storage.loadEvents()).find(event=>event.id===events[0].id).note,'Pending edit survives complete resync');
 await a.close();a=await open('local-a');await drain(a);remote.api.pull=pull;await drain(b);
 assert.equal((await b.storage.loadEvents()).find(event=>event.id===events[0].id).note,'Pending edit survives complete resync');
 assert.equal((await remote.api.account()).pets[0].eventCount,1000);
 console.log(`PASS ${mode}:interrupted full resync/restart preserves visible history and pending edits without duplication.`);
 const attached=await b.sync.status(b.name);await b.sync.detach({generation:attached.generation,accountId:primary.id});
 assert.equal((await b.storage.loadEvents()).length,1000);
 await b.storage.appendEvents([{id:'detached-offline-event',type:'walk',at:1900000,source:'app'}]);
 await prepare(b,cloudPet);await drain(b);await drain(a);
 assert.equal((await b.storage.loadEvents()).length,1001);assert.equal(new Set((await b.storage.loadEvents()).map(event=>event.id)).size,1001);
 assert.equal((await remote.api.account()).pets[0].eventCount,1001,'Reconnecting detached history must not duplicate the old cloud copy.');
 console.log(`PASS ${mode}:detachment, free offline logging and confirmed reassociation preserve1000 prior records without duplicating them.`);
 const before=remote.calls;sessionId=other.id;assert.equal((await run(a)).problem,'account-mismatch');assert.equal(remote.calls,before);sessionId=primary.id;
 sql(`UPDATE cloud_accounts SET trial_started_at=0,trial_ends_at=1 WHERE account_id='${primary.id}';`);
 await a.storage.appendEvents([{id:'expired-offline-event',type:'poop',at:2000000,source:'app'}]);
 assert.equal((await run(a)).state,'expired');assert.equal((await a.storage.loadEvents()).length,1002);assert.ok((await a.sync.status(a.name)).pending>0);
 const exported=await response(primary,'/api/account/export');assert.equal(exported.status,200);
 const text=await exported.text(),lines=text.trim().split('\n').map(line=>JSON.parse(line));assert.equal(lines[0].type,'manifest');assert.equal(lines.at(-1).type,'complete');assert.ok(lines.some(line=>line.type==='revision'&&line.after.data.note==='Pending edit survives complete resync'));assert.equal(text.includes(primary.cookie),false);
 console.log(`PASS ${mode}:account mismatch dispatches nothing; expiry retains1002 local records/pending work and full authenticated cloud history export.`);
 success=true;
}finally{
 for(const client of clients)await client.close();
 let cleaned=true;
 for(const owner of owners){try{const result=await response(owner,'/api/account',{method:'DELETE',body:{confirm:true}});if(result.status!==200){cleaned=false;console.error('Fixture cleanup requires attention:',result.status);}else for(const observed of channels.filter(item=>item.owner===owner))await until(()=>observed.closed,'Account retirement must close the actual socket.');}catch{cleaned=false;console.error('Fixture cleanup or channel retirement failed.');}}
 for(const observed of channels)observed.socket.close();
 if(cleaned&&channels.length)console.log(`PASS ${mode}:normal account retirement closes both authenticated change channels.`);
 writeFileSync(join(directory,'fixture.sql'),'-- private fixture SQL removed\n',{mode:0o600});
 if(cleaned&&success)rmSync(directory,{recursive:true,force:true});else {
  // Retain identifiers for administrative recovery, never session tokens/cookies.
  writeFileSync(join(directory,'fixture-metadata.json'),JSON.stringify({base,owners:owners.map(owner=>owner.id)}),{mode:0o600});
  console.error('Synthetic SQLite recovery state retained at',directory);
 }
 if(!cleaned)process.exitCode=1;
}

// Real HTTP + independent persistent SQLite clients. Authentication is an
// administrative synthetic session, not email/provider-delivery evidence.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {serializeSignedCookie} from 'better-call';
import {createLocalDatabase,migrateLegacy} from '../src/local/database.ts';
import {legacyKeys,parseLegacySnapshot} from '../src/local/legacy.ts';
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
const directory=mkdtempSync(join(tmpdir(),`puptime-http-${mode}-`)),owners=[],clients=[];
function sql(query){
 const path=join(directory,'fixture.sql');writeFileSync(path,query,{mode:0o600});
 const options=local?['--local','--config',local.config,'--persist-to',local.persist]:['--remote','--env','staging'];
 try{execFileSync('npx',['wrangler','d1','execute','AUTH_DB',...options,'--file',path,'--json'],{stdio:['ignore','pipe','pipe'],env:{...process.env,CI:'1'}});}catch{throw new Error('Administrative fixture SQL failed; private output withheld.');}
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
let primary,remote,sessionId,success=false;
async function open(name){
 const path=join(directory,name+'.db'),database=await createLocalDatabase(sqliteTestConnection(path));
 await migrateLegacy(database,parseLegacySnapshot(legacyKeys.map(key=>[key,key==='puptime.schedule.v1'?'[]':null])),()=>name);
 const runtime=await createLocalRuntime(database,name);
 const runner=createSyncRunner({sync:runtime.sync,api:remote.api,petId:name,deviceId:runtime.deviceId,sessionAccountId:()=>sessionId,changed:()=>{},random:()=>1});
 const client={...runtime,name,runner,closed:false,async close(){if(!this.closed){this.closed=true;await database.close();}}};clients.push(client);return client;
}
async function prepare(client,confirmedPetId){
 return client.sync.prepareAssociation({accountId:primary.id,localPetId:client.name,deviceId:client.deviceId,enrollment:{operationId:crypto.randomUUID(),deviceId:client.deviceId,localPetId:client.name,name:'HTTP puppy',...(confirmedPetId?{confirmedPetId}:{})}});
}
async function run(client){const before=remote.calls;const result=await client.runner.run(new AbortController().signal);assert.ok(remote.calls-before<=20,'Each runner invocation must remain bounded.');return result;}
async function drain(client){for(let i=0;i<15;i++){const result=await run(client);if(result.state==='synced')return;assert.ok(['pending','retry'].includes(result.state),`Unexpected runner state: ${result.state}/${result.problem}`);}assert.fail('Backlog failed to finish in bounded runs.');}
async function history(recordId){const result=await response(primary,`/api/records/${encodeURIComponent(recordId)}/history`);assert.equal(result.status,200);return (await result.json()).revisions;}
try{
 primary=await fixture();remote=transport(primary);sessionId=primary.id;
 await remote.api.startTrial();
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
 console.log(`PASS ${mode}:1000 real HTTP uploads, lost enrollment/push replies and disk restart preserve exact requests/history, including encoded long IDs.`);
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
 const other=await fixture(),before=remote.calls;sessionId=other.id;assert.equal((await run(a)).problem,'account-mismatch');assert.equal(remote.calls,before);sessionId=primary.id;
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
 for(const owner of owners){try{const result=await response(owner,'/api/account',{method:'DELETE',body:{confirm:true}});if(result.status!==200){cleaned=false;console.error('Fixture cleanup requires attention:',result.status);}}catch{cleaned=false;console.error('Fixture cleanup request failed.');}}
 writeFileSync(join(directory,'fixture.sql'),'-- private fixture SQL removed\n',{mode:0o600});
 if(cleaned&&success)rmSync(directory,{recursive:true,force:true});else console.error('Synthetic SQLite recovery state retained at',directory);
}

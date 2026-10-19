// Actual HTTP + production SDK/SQLite history acceptance. Administrative,
// synthetic sessions do not establish email/social-provider delivery.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {serializeSignedCookie} from 'better-call';
import {createCloudApi,CloudApiError} from '../src/cloud/api.ts';
import {cloudRecordId} from '../src/cloud/record-identity.ts';
import {createSyncRunner} from '../src/cloud/runner.ts';
import {createLocalDatabase,initializeLocalDatabase} from '../src/local/database.ts';
import {sqliteTestConnection} from '../src/local/sqlite-test-adapter.ts';
import {createLocalRuntime} from '../src/local/runtime-factory.ts';

const mode=process.argv[2]??'local';
assert.ok(['local','staging'].includes(mode),'Use local or staging.');
const local=mode==='local'?JSON.parse(readFileSync('/tmp/puptime-native-cloud-state.json','utf8')):null;
const base=mode==='local'?local?.url:(process.env.PUPTIME_STAGING_API_ORIGIN??'https://puptime-api-staging.p-ch.workers.dev');
assert.ok(mode==='local'?base==='http://127.0.0.1:8793':['https://puptime-api-staging.p-ch.workers.dev','https://puptime.pages.dev'].includes(base),'Unexpected qualification API origin.');
const origin=local?base:'https://puptime.pages.dev';
const secret=local?readFileSync(join(local.directory,'.dev.vars'),'utf8').match(/^AUTH_SECRET=(.+)$/m)?.[1]:process.env.PUPTIME_STAGING_AUTH_SECRET;
assert.ok(secret?.length>=32,'Supply the private staging auth secret through the environment.');
const directory=mkdtempSync(join(tmpdir(),`puptime-http-history-${mode}-`));
const owners=[],clients=[];
let success=false,primary,remote,requests=0;

// Same private administrative fixture path as verify-cloud-clients. Never
// forward Wrangler output: SQL errors can include a session token. Scrub after
// every call, including failures, rather than leaving credentials for recovery.
function sql(query,read=false){
 const path=join(directory,'fixture.sql');
 writeFileSync(path,query,{mode:0o600});
 try{
  const options=local?['--local','--config',local.config,'--persist-to',local.persist]:['--remote','--env','staging'];
  // Remote --file uses the import API: it emits upload progress even with
  // --json and returns import metadata, not SELECT rows. Private writes stay
  // in the file; only credential-free aggregate reads use --command.
  const output=execFileSync('npx',['wrangler','d1','execute','AUTH_DB',...options,...(read?['--command',query]:['--file',path]),'--json'],{encoding:'utf8',stdio:['ignore','pipe','pipe'],env:{...process.env,CI:'1'}});
  return read?JSON.parse(output):undefined;
 }catch(error){
  const raw=String(error.stdout??'')+'\n'+String(error.stderr??'');
  const codes=[...raw.matchAll(/(?:code[:"\s]+)([0-9]{3,6})/gi)].map(match=>match[1]);
  throw new Error('Administrative history fixture SQL failed ('+(error instanceof SyntaxError?'machine-output parsing':'exit '+error.status)+', numeric codes '+codes.join(',')+'); private output withheld.');
 }
 finally{writeFileSync(path,'-- private fixture SQL removed\n',{mode:0o600});}
}
async function fixture(){
 const id=crypto.randomUUID(),token=crypto.randomUUID(),now=Date.now();
 const cookie=(await serializeSignedCookie(local?'better-auth.session_token':'__Secure-better-auth.session_token',token,secret,{path:'/',httpOnly:true,secure:!local})).split(';')[0];
 const owner={id,cookie};owners.push(owner);
 sql(`INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES ('${id}','History qualification','${id}@example.invalid',1,${now},${now}); INSERT INTO session(id,token,userId,expiresAt,createdAt,updatedAt) VALUES ('${crypto.randomUUID()}','${token}','${id}',${now+3600000},${now},${now});`);
 return owner;
}
async function response(owner,path,{method='GET',body,signal}={}){
 return fetch(base+path,{method,headers:{origin,...(owner?{cookie:owner.cookie}:{}),...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000)});
}
function apiFor(owner){
 return createCloudApi(async(path,options)=>{
  requests++;const result=await response(owner,path,options);
  return {data:await result.json(),error:result.ok?null:{status:result.status},retryAfter:result.headers.get('retry-after')};
 });
}
async function open(name){
 const database=await createLocalDatabase(sqliteTestConnection(join(directory,name+'.db')));
 await initializeLocalDatabase(database,()=>name);
 const runtime=await createLocalRuntime(database,name);
 const runner=createSyncRunner({sync:runtime.sync,api:remote,petId:name,deviceId:runtime.deviceId,sessionAccountId:()=>primary.id,changed:()=>{},random:()=>1});
 const client={...runtime,name,runner,closed:false,async close(){if(!this.closed){this.closed=true;await database.close();}}};
 clients.push(client);return client;
}
async function attach(client,petId){
 await client.sync.prepareAssociation({accountId:primary.id,localPetId:client.petId,deviceId:client.deviceId,mode:'restore',enrollment:{operationId:crypto.randomUUID(),deviceId:client.deviceId,localPetId:client.petId,name:'History puppy',confirmedPetId:petId}});
 await drain(client);
}
async function run(client){
 const before=requests,result=await client.runner.run(new AbortController().signal);
 assert.ok(requests-before<=20,'Each HTTP runner invocation must remain bounded.');return result;
}
async function drain(client){
 for(let i=0;i<15;i++){
  const result=await run(client);if(result.state==='synced')return;
  assert.ok(['pending','retry'].includes(result.state),'History runner must preserve retryable pending work.');
 }
 assert.fail('History fixture did not sync within bounded runs.');
}
async function snapshot(client){
 return client.database.read(async sql=>{
  const tables=await sql.getAllAsync("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
  return Object.fromEntries(await Promise.all(tables.map(async({name})=>[name,await sql.getAllAsync(`SELECT * FROM "${name.replaceAll('"','""')}" ORDER BY rowid`)])));
 });
}
const category=wanted=>error=>error?.category===wanted;
async function unchangedRejection(client,input,wanted){
 const before=await snapshot(client);
 await assert.rejects(client.history.restore(input),category(wanted));
 assert.deepEqual(await snapshot(client),before,`${wanted} confirmation must not change any SQLite table.`);
}
async function push(mutations){
 const result=await remote.push(mutations);assert.deepEqual(result.rejected,[]);assert.equal(result.accepted.length,mutations.length);return result.accepted;
}

try{
 primary=await fixture();remote=apiFor(primary);
 assert.equal((await remote.account()).cloud.canSync,false);
 await remote.startTrial();
 const other=await fixture(),otherApi=apiFor(other);await otherApi.startTrial();
 const petId='history-'+crypto.randomUUID(),deviceId='history-service-device';
 await remote.enroll({operationId:crypto.randomUUID(),deviceId,localPetId:petId,name:'History puppy'});
 const eventId='history / 犬 💩 '+ 'x'.repeat(220),recordId=cloudRecordId('event',petId,eventId);
 const original={type:'custom',customLabel:'Training',at:1000000,source:'widget',note:'First version',estimated:false};
 const mutation=(baseRevision,intent,patch,id=recordId)=>({protocolVersion:1,operationId:crypto.randomUUID(),deviceId,recordId:id,petId,kind:'event',baseRevision,intent,patch});
 const unrelatedId='unrelated-history',unrelatedData={type:'pee',at:900000,source:'app',note:'Untouched'};
 const initial=mutation(0,'create',original);
 await push([initial,mutation(0,'create',unrelatedData,cloudRecordId('event',petId,unrelatedId)),{...mutation(0,'create',{label:'Training'},cloudRecordId('customActivity',petId,'custom:training')),kind:'customActivity'}]);
 await push([mutation(1,'patch',{note:'Second version'})]);
 const merged=await push([mutation(1,'patch',{at:1001000,estimated:true})]);
 assert.equal(merged[0].reason,'merged');assert.equal(merged[0].record.data.note,'Second version');
 await push([mutation(3,'delete',{})]);
 const restored=await push([mutation(4,'restore',original)]);assert.equal(restored[0].reason,'restored');
 await push(Array.from({length:50},(_,index)=>mutation(index+5,'patch',{note:`Version ${index+6}`})));
 const firstPage=(await remote.history(recordId)).revisions;
 assert.deepEqual(firstPage.map(row=>row.revision),Array.from({length:50},(_,index)=>55-index));
 const cursor=firstPage.at(-1).revision,older=(await remote.history(recordId,cursor)).revisions;
 assert.deepEqual(older.map(row=>row.revision),[5,4,3,2,1]);
 assert.deepEqual(older.map(row=>row.reason),['restored','deleted','merged','updated','created']);
 const selected=older.at(-1);assert.equal(selected.operationId,initial.operationId);
 await push([mutation(55,'patch',{note:'Version 56'})]);
 assert.deepEqual((await remote.history(recordId,cursor)).revisions,older,'An older exclusive cursor must remain stable after a newer accepted version.');
 assert.deepEqual((await otherApi.history(recordId)).revisions,[]);
 assert.equal((await response(null,`/api/records/${encodeURIComponent(recordId)}/history`)).status,401);
 const cancelled=new AbortController();cancelled.abort();const beforeCancelled=requests;
 await assert.rejects(remote.history(recordId,undefined,cancelled.signal));assert.equal(requests,beforeCancelled);
 console.log(`PASS ${mode}:strict SDK history validates encoded IDs, all five reasons, 50-row/exclusive-cursor paging, stable older pages, owner isolation and pre-dispatch cancellation.`);

 let a=await open('history-local-a');await attach(a,petId);
 let page=await a.history.eventPage(eventId);
 assert.equal(page.entries.length,1,'A fresh device must have only its current local baseline, not fabricated historical versions.');
 assert.equal(page.head.event.note,'Version 56');assert.equal(page.head.cloudRecord.revision,56);
 const currentVersion=(await remote.history(recordId)).revisions[0],currentTables=await snapshot(a);
 assert.deepEqual(await a.history.restore({eventId,selection:{source:'cloud',revision:currentVersion},expected:page.head}),page.head.event);
 assert.deepEqual(await snapshot(a),currentTables,'The actual current server snapshot must remain an exact local no-op.');
 const contradictory={...currentVersion,proposal:{...currentVersion.proposal,note:'Contradictory immutable version'},after:{...currentVersion.after,data:{...currentVersion.after.data,note:'Contradictory immutable version'}}};
 await unchangedRejection(a,{eventId,selection:{source:'cloud',revision:contradictory},expected:page.head},'unavailable');
 const wrongOrder={...selected,sequence:currentVersion.sequence,after:{...selected.after,sequence:currentVersion.sequence}};
 await unchangedRejection(a,{eventId,selection:{source:'cloud',revision:wrongOrder},expected:page.head},'unavailable');
 console.log(`PASS ${mode}:the actual current server version is a no-op; contradictory immutable data and mismatched revision/sequence ordering preserve every SQLite table.`);
 const beforeLocalEdit=page.head;
 await a.storage.updateEvent(eventId,{note:'Pending local edit'});page=await a.history.eventPage(eventId);
 await unchangedRejection(a,{eventId,selection:{source:'cloud',revision:selected},expected:page.head},'pending');
 await drain(a);
 await unchangedRejection(a,{eventId,selection:{source:'cloud',revision:selected},expected:beforeLocalEdit},'stale');
 const beforeRemote=(await a.history.eventPage(eventId)).head;
 await push([mutation(beforeRemote.cloudRecord.revision,'patch',{note:'New remote version'})]);await drain(a);
 await unchangedRejection(a,{eventId,selection:{source:'cloud',revision:selected},expected:beforeRemote},'stale');
 page=await a.history.eventPage(eventId);const expectedRevision=page.head.cloudRecord.revision;
 const canonical=await a.history.restore({eventId,selection:{source:'cloud',revision:selected},expected:page.head});
 assert.deepEqual(canonical,{id:eventId,...original,estimated:true});
 const owner=await a.sync.status(a.petId),pending=await a.sync.nextBatch(owner);
 assert.equal(pending.length,1);assert.equal(pending[0].intent,'restore');assert.equal(pending[0].baseRevision,expectedRevision);assert.equal(pending[0].recordId,recordId);
 const actualPush=remote.push;let loseReply=true;
 remote.push=async(...args)=>{const result=await actualPush(...args);if(loseReply){loseReply=false;throw new CloudApiError('network');}return result;};
 try{assert.equal((await run(a)).state,'retry');}finally{remote.push=actualPush;}
 const committed=(await remote.history(recordId)).revisions[0];
 assert.equal(committed.operationId,pending[0].operationId);assert.equal(committed.reason,'restored');assert.equal(committed.revision,expectedRevision+1);
 await a.close();a=await open('history-local-a');
 assert.deepEqual(await a.sync.nextBatch(await a.sync.status(a.petId)),pending,'Disk reopen must retain the exact lost-ack restore operation.');
 await drain(a);
 assert.equal((await remote.history(recordId)).revisions[0].revision,expectedRevision+1,'Retry must not create another server version.');
 assert.equal((await a.sync.status(a.petId)).pending,0);
 assert.equal((await a.history.eventPage(eventId)).entries.filter(row=>row.source==='restore').length,1);
 const b=await open('history-local-b');await attach(b,petId);
 for(const client of [a,b]){
  assert.deepEqual((await client.storage.loadEvents()).find(row=>row.id===eventId),canonical);
  assert.deepEqual((await client.storage.loadEvents()).find(row=>row.id===unrelatedId),{id:unrelatedId,...unrelatedData});
 }
 console.log(`PASS ${mode}:cloud-only historical restore uses one current-mirror intent; pending/local-stale/remote-stale guards change no SQLite table; lost HTTP acknowledgment survives disk reopen and converges without duplicate revisions.`);

 await a.storage.deleteCustomActivity('Training');await drain(a);
 const beforeDelete=(await a.history.eventPage(eventId)).head;
 await push([mutation(beforeDelete.cloudRecord.revision,'delete',{})]);await drain(a);await drain(b);
 page=await a.history.eventPage(eventId);assert.equal(page.head.event,null);
 const deleted=(await remote.history(recordId)).revisions[0];assert.equal(deleted.after.deleted,true);
 await unchangedRejection(a,{eventId,selection:{source:'cloud',revision:deleted},expected:page.head},'unavailable');
 const revived=await a.history.restore({eventId,selection:{source:'cloud',revision:selected},expected:page.head});
 assert.deepEqual(revived,canonical);await drain(a);await drain(b);
 for(const client of [a,b]){
  assert.deepEqual((await client.storage.loadEvents()).find(row=>row.id===eventId),canonical);
  assert.deepEqual(await client.storage.loadCustomActivities(),[],'Restoring a custom log must not reactivate its removed quick action.');
 }
 const current=(await remote.history(recordId)).revisions[0];assert.equal(current.reason,'restored');assert.equal(current.before.deleted,true);assert.equal(current.after.data.estimated,true);
 const staleRestore=mutation(current.revision-1,'restore',{...original,note:'Must never overwrite'});
 const rejection=await remote.push([staleRestore]);assert.deepEqual(rejection.accepted,[]);assert.deepEqual(rejection.rejected,[{operationId:staleRestore.operationId,error:'conflict'}]);
 assert.equal((await remote.history(recordId)).revisions[0].revision,current.revision);
 console.log(`PASS ${mode}:deleted historical custom logs restore with the same identity, estimate/source/label and no quick-action reactivation; stale server restores add no revision.`);

 sql(`UPDATE cloud_accounts SET trial_started_at=0,trial_ends_at=1 WHERE account_id='${primary.id}';`);
 await assert.rejects(remote.history(recordId),category('expired'));
 const localPage=await a.history.eventPage(eventId),localSelection=localPage.entries.find(row=>row.after?.note==='New remote version');
 assert.ok(localSelection,'Retain an earlier local cloud-applied snapshot after expiry.');
 const offline=await a.history.restore({eventId,selection:{source:'local',sequence:localSelection.sequence},expected:localPage.head});
 assert.equal(offline.note,'New remote version');assert.equal((await run(a)).state,'expired');assert.ok((await a.sync.status(a.petId)).pending>0);
 const exported=await response(primary,'/api/account/export');assert.equal(exported.status,200);
 const exportText=await exported.text(),lines=exportText.trim().split('\n').map(line=>JSON.parse(line));
 assert.equal(lines[0].type,'manifest');assert.equal(lines.at(-1).type,'complete');
 assert.ok(lines.some(row=>row.type==='revision'&&row.operationId===initial.operationId));assert.ok(lines.some(row=>row.type==='revision'&&row.operationId===current.operationId));
 assert.equal(exportText.includes(primary.cookie),false);
 assert.deepEqual((await a.storage.loadEvents()).find(row=>row.id===unrelatedId),{id:unrelatedId,...unrelatedData});
 console.log(`PASS ${mode}:expiry denies new server history while retained local history remains restorable, pending work survives and the authenticated export retains oldest/latest cloud revisions.`);
 success=true;
}finally{
 for(const client of clients)await client.close();
 let cleaned=true;
 for(const owner of owners){
  try{
   // Keep normal recent-auth retirement retryable even after a slow failed run.
   sql(`UPDATE session SET createdAt=${Date.now()} WHERE userId='${owner.id}';`);
   const result=await response(owner,'/api/account',{method:'DELETE',body:{confirm:true}});
   assert.ok([200,401].includes(result.status),'Normal fixture account retirement failed.');
   assert.equal((await response(owner,'/api/account')).status,401,'Retired fixture credentials must be revoked.');
   const results=sql(`SELECT (SELECT count(*) FROM user WHERE id='${owner.id}') users,(SELECT count(*) FROM session WHERE userId='${owner.id}') sessions,(SELECT count(*) FROM account WHERE userId='${owner.id}') identities,(SELECT count(*) FROM cloud_accounts WHERE account_id='${owner.id}') cloud_accounts;`,true);
   const counts=results.at(-1)?.results?.[0];assert.ok(counts,'Authoritative cleanup query returned no counts.');
   assert.deepEqual(Object.values(counts),[0,0,0,0],'Fixture identity/session/cloud account rows must be gone.');
  }catch{cleaned=false;console.error('History fixture cleanup requires attention; private response/SQL output withheld.');}
 }
 if(cleaned&&success){rmSync(directory,{recursive:true,force:true});console.log(`PASS ${mode}:normal synthetic account retirement revokes both sessions; authoritative D1 fixture row counts are zero; private temporary fixture files removed.`);}
 else{
  writeFileSync(join(directory,'fixture-metadata.json'),JSON.stringify({base,owners:owners.map(owner=>owner.id)}),{mode:0o600});
  console.error('Synthetic history SQLite/recovery identifiers retained at',directory);
 }
 if(!cleaned)process.exitCode=1;
}

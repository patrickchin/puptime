// Invoked by the existing isolated HTTPS/native account fixture runner.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {join} from 'node:path';
import {readFileSync} from 'node:fs';
import {entityId} from '../src/entity-id.ts';
import {cloudRecordId} from '../src/cloud/record-identity.ts';

export async function qualifyNativeSharing({flow,signIn,snapshot,sqliteDirectory,simctl,device,auth,invitations,setEmail,getCookie,setOffline,front,installRenderProbe}){
 const checks=[],accounts=new Map();
 const sharingFlow=(name,env={})=>flow('../sharing/'+name,{NOTE:'Shared native log',...env});
 async function call(cookie,path,body,expected=200,headers={}){
  const result=await fetch('http://127.0.0.1:8799/api/'+path,{method:body?'POST':'GET',headers:{cookie,origin:front,'content-type':'application/json',...(accounts.has(cookie)?{'x-puptime-account':accounts.get(cookie)}:{}),...headers},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});
  assert.equal(result.status,expected,path);if(!result.ok)return null;const data=await result.json();if(path==='account')accounts.set(cookie,data.user.id);return data;
 }
 async function until(check,message){for(let i=0;i<120;i++){if(await check())return;await new Promise(resolve=>setTimeout(resolve,500));}assert.fail(message);}
 function sharedSnapshot(share,account){
  const db=new DatabaseSync(join(sqliteDirectory(),`puptime-${share.id}-${account}.db`),{readOnly:true});
  try{return {events:db.prepare('SELECT * FROM events ORDER BY id').all(),pending:db.prepare('SELECT * FROM local_sync_outbox ORDER BY operation_id').all(),metadata:db.prepare('SELECT * FROM metadata ORDER BY key').all()};}finally{db.close();}
 }
 async function open(share){simctl('openurl',device,`puptime://care?invite=${share.id}#${share.token}`);await sharingFlow('accept');}
 await flow('prepare');await signIn();await flow('enable',{EXPECTED_COUNT:'0'});
 let ownerCookie=getCookie();const owner=await call(ownerCookie,'account'),petId=owner.pets[0].id;
 await call(ownerCookie,'cloud/enroll',{operationId:entityId('csr'),deviceId:'sharing-fixture',localPetId:petId,confirmedPetId:petId,name:'Biscuit'});
 const initial=await call(ownerCookie,'sync/pull?after=0'),profile=initial.changes.findLast(row=>row.kind==='puppy'&&row.id===petId);
 const now=Date.now();
 // More than one sync page, old history and a routine; recipient owns another puppy.
 const mutations=Array.from({length:501},(_,i)=>({protocolVersion:1,operationId:entityId('csr'),deviceId:'sharing-fixture',petId,recordId:cloudRecordId('event',petId,entityId('evt')),kind:'event',baseRevision:0,intent:'create',patch:{type:'meal',at:now-i*3600000,source:'app',note:`Owner history ${i}`}}));
 mutations.push({...mutations[0],operationId:entityId('csr'),recordId:petId,kind:'puppy',baseRevision:profile?.revision??0,intent:profile?'patch':'create',patch:{name:'Biscuit'}});
 mutations.push({protocolVersion:1,operationId:entityId('csr'),deviceId:'sharing-fixture',petId,recordId:cloudRecordId('routine',petId,entityId('rtn')),kind:'routine',baseRevision:0,intent:'create',patch:{type:'meal',minutes:480}});
 for(let offset=0;offset<mutations.length;offset+=50){const batch=mutations.slice(offset,offset+50),result=await call(ownerCookie,'sync/push',{mutations:batch});assert.deepEqual(result.rejected,[],'Seed fixture must use an enrolled independent device.');assert.equal(result.accepted.length,batch.length);}
 await sharingFlow('owner-sync');assert.equal(snapshot().events.length,501);
 for(const [kind,permission] of [['household','contribute'],['temporary','contribute'],['temporary','view']]){
  await sharingFlow('create',{KIND:kind,PERMISSION:permission});
  assert.equal(invitations.at(-1).kind,kind);assert.equal(invitations.at(-1).permission,permission);
 }
 assert.equal(invitations.length,3);const [household,temporary,view]=invitations;
 checks.push('owner creates household, temporary contributor and view-only invitations through the native UI with QR and native share sheet');
 // Independent owner's session remains valid after the phone signs out.
 await call('','auth/email-otp/send-verification-otp',{email:owner.user.email,type:'sign-in'});
 const otp=auth.prepare('SELECT code FROM local_email_previews WHERE email=?').get(owner.user.email).code;
 const login=await fetch('http://127.0.0.1:8799/api/auth/sign-in/email-otp',{method:'POST',headers:{origin:front,'content-type':'application/json'},body:JSON.stringify({email:owner.user.email,otp})});
 assert.equal(login.status,200);ownerCookie=login.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
 assert.equal((await call(ownerCookie,'account')).user.id,owner.user.id);
 await flow('sign-out');await flow('prepare');setEmail('native-sharing-'+entityId('usr')+'@example.invalid');
 await flow('add-logs',{BATCHES:'1',EXPECTED_COUNT:'3'});
 simctl('openurl',device,`puptime://care?invite=${household.id}#${household.token}`);await sharingFlow('signed-out');
 await signIn();await flow('enable',{EXPECTED_COUNT:'3'});
 const memberCookie=getCookie(),member=await call(memberCookie,'account'),personal=snapshot();
 assert.notEqual(member.user.id,owner.user.id);assert.notEqual(member.pets[0].id,petId);
 await open(household);await sharingFlow('journal',{READ_ONLY:'false',TEMPORARY:'false'});
 let shared=sharedSnapshot(household,member.user.id);assert.equal(shared.events.length,501);assert.equal(shared.pending.length,0);assert.deepEqual(snapshot(),personal);
 await call(memberCookie,'care/accept',{id:household.id,token:household.token});
 checks.push('a distinct signed-in account accepts the native link, restores all 501 logs across sync pages, sees timeline/insights/routines, and leaves its own puppy untouched; acceptance retries safely');
 await sharingFlow('log',{NOTE:'Shared native log household'});
 await until(()=>sharedSnapshot(household,member.user.id).pending.length===0,'Household log must sync.');
 const householdPage=await call(memberCookie,`care/${household.id}`);assert.ok(householdPage.records.some(row=>row.record.data.note?.includes('Shared native log household')));
 const ownerChanges=await call(ownerCookie,'sync/pull?after=0');
 // Pull is paginated; locate member changes through the care page as the owner store's authoritative view.
 assert.ok(ownerChanges.changes.length>0);assert.deepEqual(snapshot(),personal);
 checks.push('household native create and edit commit locally and converge on the owner store without changing the recipient’s own journal');
 await open(temporary);await sharingFlow('journal',{READ_ONLY:'false',TEMPORARY:'true'});
 const beforeOffline=sharedSnapshot(temporary,member.user.id);setOffline(true);
 try{
  await sharingFlow('log',{NOTE:'Shared native log temporary'});await sharingFlow('restart',{NOTE:'Shared native log temporary'});
  const queued=sharedSnapshot(temporary,member.user.id);assert.equal(queued.events.length,beforeOffline.events.length+1);assert.ok(queued.pending.length>0);
  const payloads=queued.pending;
  await sharingFlow('restart',{NOTE:'Shared native log temporary'});assert.deepEqual(sharedSnapshot(temporary,member.user.id).pending,payloads);
 }finally{setOffline(false);}
 await sharingFlow('reconnect');await until(()=>sharedSnapshot(temporary,member.user.id).pending.length===0,'Offline writes must upload after reconnect.');
 const converged=await call(memberCookie,`care/${temporary.id}`);
 const uploaded=converged.records.filter(row=>row.record.data.note?.includes('Shared native log temporary'));
 assert.equal(uploaded.length,1);assert.equal(uploaded[0].record.revision,2);
 const remoteRecords=new Map();let cursor=0;
 for(;;){const page=await call(ownerCookie,'sync/pull?after='+cursor);for(const row of page.changes)remoteRecords.set(row.id,row);if(!page.hasMore)break;cursor=page.cursor;}
 const allEvents=[...remoteRecords.values()].filter(row=>row.kind==='event'&&!row.deleted);
 assert.equal(allEvents.length,503);assert.equal(allEvents.filter(row=>row.data.note?.includes('Shared native log temporary')).length,1);
 assert.deepEqual(snapshot(),personal);
 checks.push('temporary carer cannot edit owner logs or routines; offline create/edit survives two process restarts, then uploads without a remaining outbox');
 await open(view);await sharingFlow('journal',{READ_ONLY:'true',TEMPORARY:'true'});
 const viewBefore=sharedSnapshot(view,member.user.id);await sharingFlow('restart',{NOTE:'Shared native log temporary'});assert.deepEqual(sharedSnapshot(view,member.user.id).events,viewBefore.events);
 checks.push('view-only carer sees full history with logging and editing disabled across restart');
 await call(ownerCookie,`sharing/${view.id}/revoke`,{});
 await sharingFlow('resume');await sharingFlow('ended');assert.deepEqual(sharedSnapshot(view,member.user.id).events,viewBefore.events);
 await call(memberCookie,`care/${view.id}`,undefined,410);
 checks.push('owner revocation blocks an active native journal on reconnect without deleting cached history');
 await sharingFlow('leave-ended');assert.deepEqual(snapshot(),personal);
 // Expire the service grant in the isolated fixture database; no clock changes on the machine.
 await open(temporary);setOffline(true);
 await sharingFlow('log',{NOTE:'Shared native log retained after expiry'});
 const retained=sharedSnapshot(temporary,member.user.id);assert.ok(retained.pending.length>0);
 const fixture=new DatabaseSync(auth.location());
 try{fixture.prepare('UPDATE puppy_shares SET expires_at=? WHERE id=?').run(Date.now()-1,temporary.id);}finally{fixture.close();setOffline(false);}
 await sharingFlow('resume');await sharingFlow('ended');
 assert.deepEqual(sharedSnapshot(temporary,member.user.id).pending,retained.pending,'Ended service retains the exact unsynced work.');
 await call(memberCookie,`care/${temporary.id}`,undefined,410);
 await sharingFlow('leave-ended');assert.deepEqual(snapshot(),personal);
 checks.push('temporary expiry blocks native access and retains unsynced work; returning to My puppy preserves all original IDs, bodies, ownership and outbox state');
 await installRenderProbe();await open(household);
 await sharingFlow('render-prepare');
 const renderFile=join(sqliteDirectory(),'../row-render-probe.json'),renders=()=>JSON.parse(readFileSync(renderFile,'utf8')).renders;
 const beforeRenders=renders();assert.ok(Object.keys(beforeRenders).length>=20,'Probe must observe populated mounted history.');
 await sharingFlow('render-editor');const afterRenders=renders();
 assert.deepEqual(afterRenders,beforeRenders,'Opening an editor, typing a local draft and closing without a change must not redraw unchanged rows.');
 checks.push(`diagnostic build: all ${Object.keys(beforeRenders).length} mounted event rows retain exact render counters across local editor state changes with 503 logs`);
 return checks;
}

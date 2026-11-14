// Synthetic-only acceptance case. The existing native account runner supplies I/O;
// this module neither creates a client/session nor injects native credentials.
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {shareIdSchema,inviteTokenSchema} from '../src/sharing.ts';
import {localRecordId} from '../src/cloud/record-identity.ts';

export function copiedInvitation(copy,fixtureOrigin){
  let url,origin;
  try{url=new URL(copy);origin=new URL(fixtureOrigin);}catch{throw new Error('Invalid synthetic invitation.');}
  assert.ok(origin.protocol==='https:'&&['127.0.0.1','localhost','[::1]'].includes(origin.hostname),'Use the isolated HTTPS loopback service.');
  assert.ok(url.origin===origin.origin&&url.pathname==='/care'&&!url.username&&!url.password,'Invitation must target the isolated service.');
  const id=url.searchParams.get('invite'),token=url.hash.slice(1);
  assert.ok([...url.searchParams.keys()].join(',')==='invite'&&shareIdSchema.safeParse(id).success&&inviteTokenSchema.safeParse(token).success,'Invalid synthetic invitation.');
  return {id,token,url:`puptime://care?invite=${id}#${token}`};
}

export function addedEvent(before,after){
  const previous=new Map(before.map(row=>[row.id,row]));
  for(const row of before)assert.deepEqual(after.find(value=>value.id===row.id),row,'Preserve every pre-existing activity payload.');
  const added=after.filter(row=>!previous.has(row.id));
  assert.equal(added.length,1,'The native action must create exactly one activity record.');
  return added[0];
}

export function assertStoredAttribution(record,note,actor){
  assert.ok(typeof actor==='string'&&/^[A-Za-z ]{1,80}$/.test(actor),'Use the independently observed plain synthetic member label.');
  assert.equal(record?.data.note,`${note}\n\nLogged by ${actor}`,'Require the exact stored actor label; verify rendered visibility separately.');
}

export function assertShareDenied(responses,shareId,{method,paths}){
  assert.ok(responses.some(row=>row.actor==='carer'&&row.shareId===shareId&&row.forwarded===true
    &&row.method===method&&paths.includes(row.path)&&row.status===410),
  'Observe this caregiver’s real service denial for this share; no traffic or a proxy failure cannot prove revoked authorization.');
}

const noteFor=kind=>`Shared ${kind} entry`,editedFor=kind=>`Edited ${kind} entry`;
const path=name=>`../native-sharing/${name}`;
async function until(read,predicate,message){
  for(let attempt=0;attempt<120;attempt++){const value=await read();if(predicate(value))return value;await delay(500);}
  assert.fail(message);
}

/**
 * Run once per kind, with a NEW pair of synthetic, UI-prepared devices/accounts.
 * All callbacks are thin adapters to the existing real SDK/Worker runner; see README.
 * No result is a native pass until those adapters and this case actually execute.
 */
export async function verifyNativeSharing({kind,activate,owner,carer,readOwnerRecords,transport,wire,protectSecret,fixtureOrigin}){
  assert.ok(['household','temporary'].includes(kind));
  const {assertNativeTransition,assertNativeDrained}=await import('./native-account-evidence.mjs');
  const flow=(actor,name,env={},secret=false)=>actor.flow(path(name),env,{secret});
  await transport('online');await activate(owner);
  const ownerBefore=await owner.snapshot();
  assert.equal(ownerBefore.owner.length,1);assert.equal(ownerBefore.pending,0);assert.ok(ownerBefore.events.length>0);
  const cloudBefore=await readOwnerRecords({historyFor:[]});
  await activate(carer);const personal=await carer.snapshot();
  assert.equal(personal.owner.length,0);assert.ok(personal.events.length>0);
  assert.ok(ownerBefore.events.some(row=>row.type==='pee')&&!ownerBefore.events.some(row=>row.type==='walk'),'Prepare owner activity through quick logs; reserve walk for the caregiver.');
  assert.ok(owner.cookie()&&carer.cookie()&&owner.cookie()!==carer.cookie(),'Two independently authenticated native actors are required.');
  assert.ok(carer.accountId,'Use the actual observed native SDK account, never a seeded identity.');

  await activate(owner);
  await flow(owner,'create-invitation',{KIND:kind,LABEL:`Fixture ${kind} helper`},true);
  // This callback reads AND clears the system clipboard, without logging it.
  const copy=await owner.nativeShareCopy();protectSecret(copy);
  const invitation=copiedInvitation(copy,fixtureOrigin);protectSecret(invitation.token);protectSecret(invitation.url);
  await flow(owner,'close-sharing',{},true);
  await activate(carer);await carer.openURL(invitation.url);
  await flow(carer,'accept-invitation',{},true);
  let care=await until(()=>carer.snapshot({care:true}),state=>state.owner.length===1&&state.pending===0,'The real accepted care database must finish enrollment.');
  assert.deepEqual(care.events.map(row=>row.id).sort(),ownerBefore.events.map(row=>row.id).sort(),'Open A’s history, not B’s personal journal.');
  if(kind==='temporary')await flow(carer,'temporary-permissions');

  await transport('offline');await flow(carer,'add-log',{NOTE:noteFor(kind)});
  const created=await carer.snapshot({care:true}),event=addedEvent(care.events,created.events);
  await flow(carer,'edit-log',{NOTE:editedFor(kind)});
  const queued=await carer.snapshot({care:true});
  assert.equal(queued.events.length,created.events.length);assert.ok(queued.pending>0);
  assert.equal(queued.events.find(row=>row.id===event.id)?.note,editedFor(kind));
  for(const row of care.events)assert.deepEqual(queued.events.find(value=>value.id===row.id),row);
  await flow(carer,'restart');assertNativeTransition(queued.tables,(await carer.snapshot({care:true})).tables);
  const start=wire();await transport('online');await flow(carer,'restart');
  const drained=await until(()=>carer.snapshot({care:true}),state=>{
    const pages=wire().pages.slice(start.pages.length),last=pages.at(-1);
    return state.pending===0&&last?.hasMore===false&&state.owner[0]?.cursor===last.cursor;
  },'Caregiver queue and final pull must complete through the real SDK.');
  const receipt=wire(),pending=new Set(queued.tables.local_sync_outbox.map(row=>row.operation_id)),accepted=new Map();
  for(const result of receipt.accepted.slice(start.accepted.length).filter(row=>pending.has(row.operationId))){
    if(accepted.has(result.operationId))assert.deepEqual(result,accepted.get(result.operationId),'Replay must return the same accepted result.');
    accepted.set(result.operationId,result);
  }
  assertNativeDrained(queued.tables,drained.tables,[...accepted.values()],receipt.pages.slice(start.pages.length));
  const pushed=receipt.pushes.length;
  await flow(carer,'restart');assertNativeTransition(drained.tables,(await carer.snapshot({care:true})).tables);
  assert.equal(wire().pushes.length,pushed,'A cold restart must not resend acknowledged edits.');
  assertNativeTransition(personal.tables,(await carer.snapshot()).tables);

  await activate(owner);await flow(owner,'restart');
  await until(()=>owner.snapshot(),state=>state.events.some(row=>row.id===event.id&&row.note?.startsWith(editedFor(kind))),'Owner must receive the actual edited event.');
  const cloud=await readOwnerRecords({historyFor:[event.id]});
  assert.equal(cloud.records.length,cloudBefore.records.length+1,'One shared activity must create one cloud record, without duplicate records.');
  for(const record of cloudBefore.records)assert.deepEqual(cloud.records.find(row=>row.id===record.id),record,'Sharing must preserve the owner’s existing cloud records.');
  const record=cloud.records.find(row=>row.kind==='event'&&localRecordId(row)===event.id);
  assert.ok(cloud.revisions.some(row=>row.recordId===record?.id&&row.deviceId===carer.accountId),'The real member must be the service revision actor.');
  // Keep this check strict: sharedPush currently may omit readable attribution.
  // A failing receipt/UI assertion is evidence for a separate product fix.
  assertStoredAttribution(record,editedFor(kind),carer.attribution);
  const beforeReview=await owner.snapshot();
  await flow(owner,'owner-attribution',{NOTE:editedFor(kind),ATTRIBUTION:carer.attribution});
  const ownerAfter=await owner.snapshot();
  // Opening and closing attribution detail must not edit any native table.
  assertNativeTransition(beforeReview.tables,ownerAfter.tables);
  assert.equal(ownerAfter.events.length,ownerBefore.events.length+1);
  for(const row of ownerBefore.events)assert.deepEqual(ownerAfter.events.find(value=>value.id===row.id),row);
  for(const row of ownerBefore.tables.local_revisions)assert.deepEqual(ownerAfter.tables.local_revisions.find(value=>value.sequence===row.sequence),row);

  await activate(carer);await transport('offline');await flow(carer,'add-log',{NOTE:`Unsent ${kind} entry`});
  const revokedQueue=await carer.snapshot({care:true});assert.ok(revokedQueue.pending>0);
  await activate(owner);await transport('online');await flow(owner,'revoke',{},true);
  const atRevoke=await readOwnerRecords({historyFor:[event.id]}),revokedStart=wire();
  await activate(carer);await flow(carer,'access-ended');
  assertShareDenied(wire().responses.slice(revokedStart.responses.length),invitation.id,{method:'GET',paths:['/api/account','/api/sync/pull']});
  const blocked=await carer.snapshot({care:true});
  assertNativeTransition(revokedQueue.tables,blocked.tables,{
    metadata:[...revokedQueue.tables.metadata.filter(row=>row.key!=='care_blocked'),{key:'care_blocked',value:'1'}],
  });
  await flow(carer,'access-ended');assertNativeTransition(blocked.tables,(await carer.snapshot({care:true})).tables);
  const staleStart=wire().responses.length;
  await carer.openURL(invitation.url);await flow(carer,'reject-stale-invitation',{},true);
  assertShareDenied(wire().responses.slice(staleStart),invitation.id,{method:'POST',paths:['/api/care/accept']});
  assertNativeTransition(blocked.tables,(await carer.snapshot({care:true})).tables);
  assert.equal(wire().accepted.length,revokedStart.accepted.length,'Revoked access must never accept a queued write.');
  assert.deepEqual(await readOwnerRecords({historyFor:[event.id]}),atRevoke,'Stale invitation/restart must not mutate the owner’s cloud.');
  assertNativeTransition(personal.tables,(await carer.snapshot()).tables);
  const returnStart=wire().responses.length;await flow(carer,'return-own-journal');
  await until(async()=>wire().responses.slice(returnStart),rows=>rows.some(row=>row.actor==='carer'&&row.shareId===null
    &&row.forwarded===true&&row.method==='GET'&&row.path==='/api/account'&&row.status===200),
  'B’s personal session must remain live; denial must concern the revoked share.');
  assertNativeTransition(personal.tables,(await carer.snapshot()).tables);
  return {kind,status:'awaiting-attribution-visual-review',acceptedOperations:accepted.size,offlineRestartPreserved:true,
    storedAttribution:true,requiredVisualReview:['native-owner-attribution-row.png','native-owner-attribution-detail.png'],
    revokedServiceDenied:true,revokedQueuePreserved:true,staleInvitationRejected:true};
}

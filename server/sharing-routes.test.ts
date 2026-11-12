import {env} from 'cloudflare:workers';
import {applyD1Migrations} from 'cloudflare:test';
import {beforeAll,expect,inject,test} from 'vitest';
import worker from './index';
import {entityId} from '../src/entity-id';
import type {CreateShare} from '../src/sharing';
import {cloudRecordId} from '../src/cloud/record-identity';
import {secretHash} from './sharing-routes';
import {accountPhotoKey} from './photo-storage';

beforeAll(()=>applyD1Migrations(env.AUTH_DB,inject('migrations')));
const settings={...env,ENVIRONMENT:'local' as const,AUTH_BASE_URL:'https://puptime.test',WEB_ORIGINS:'https://puptime.test',AUTH_SECRET:'local-test-secret-with-at-least-32-characters'};
type Person={id:string;cookie:string;ip:string};let clientNumber=20;
const nobody={id:'',cookie:'',ip:'192.0.2.240'};
function call(person:Person,path:string,body?:object,extra:Record<string,string>={},runtime:Cloudflare.Env=settings){
 return worker.fetch(new Request('https://puptime.test/api/'+path,{method:body?'POST':'GET',headers:{origin:'https://puptime.test','content-type':'application/json','cf-connecting-ip':person.ip,cookie:person.cookie,'x-puptime-account':person.id,...extra},...(body?{body:JSON.stringify(body)}:{})}),runtime);
}
async function person():Promise<Person>{
 const result={...nobody,ip:`192.0.2.${clientNumber++}`},email=`sharing-${crypto.randomUUID()}@example.invalid`;
 expect((await call(result,'auth/email-otp/send-verification-otp',{email,type:'sign-in'})).status).toBe(200);
 const otp=await env.AUTH_DB.prepare('SELECT code FROM local_email_previews WHERE email=?').bind(email).first<{code:string}>();
 const login=await call(result,'auth/sign-in/email-otp',{email,otp:otp!.code});expect(login.status).toBe(200);
 result.cookie=login.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
 const account=await (await call(result,'account')).json<{user:{id:string}}>();result.id=account.user.id;await env.AUTH_DB.prepare('UPDATE user SET name=? WHERE id=?').bind('Alex',result.id).run();return result;
}
async function puppy(){
 const owner=await person(),petId=entityId('pet');
 expect((await call(owner,'cloud/enroll',{operationId:entityId('csr'),deviceId:'test-device',localPetId:petId,name:'Biscuit'})).status).toBe(200);
 return {owner,petId};
}
async function invite(owner:Person,petId:string,kind:'household'|'temporary'='temporary',permission:'view'|'contribute'='contribute'){
 const input:CreateShare={id:entityId('shr'),token:entityId('inv'),petId,kind,permission,label:'Alex',expiresAt:kind==='temporary'?Date.now()+86400000:null};
 const response=await call(owner,'sharing',input);expect(response.status).toBe(201);return input;
}
async function accept(input:CreateShare,member?:Person){
 member??=await person();
 const response=await call(member,'care/accept',{id:input.id,token:input.token,name:'Alex'});expect(response.status).toBe(200);
 return {...member,cookie:[member.cookie,...response.headers.getSetCookie().map(value=>value.split(';')[0])].filter(Boolean).join('; ')};
}
const event=(localId=entityId('evt'))=>({kind:'event',requestId:entityId('csr'),localId,intent:'create',patch:{type:'walk',at:Date.now(),source:'app',note:'Around the park'}});

test('temporary care requires a normal account, keeps retry-safe attribution and syncs to the owner',async()=>{
 const {owner,petId}=await puppy(),input=await invite(owner,petId),guest=await accept(input),entry=event();
 const usersBefore=await env.AUTH_DB.prepare('SELECT COUNT(*) AS n FROM user').first<{n:number}>();
 expect((await call(nobody,`care/${input.id}`)).status).toBe(401);
 const saved=await call(guest,`care/${input.id}/logs`,entry);expect(saved.status).toBe(200);
 const record=await saved.json<{record:{id:string;revision:number;data:{note:string}}}>();
 expect(record.record.data.note).toBe('Around the park\n\nLogged by Alex');
 expect((await (await call(guest,`care/${input.id}/logs`,entry)).json())).toEqual(record);
 const pulled=await (await call(owner,'sync/pull?after=0')).json<{changes:{id:string}[]}>();expect(pulled.changes).toHaveLength(1);
 expect(pulled.changes[0].id).toBe(cloudRecordId('event',petId,entry.localId));
 expect(await env.AUTH_DB.prepare('SELECT COUNT(*) AS n FROM user').first()).toEqual(usersBefore);
 const snapshot=await call(guest,`care/${input.id}`);expect(snapshot.headers.get('cache-control')).toBe('no-store');expect(snapshot.headers.get('referrer-policy')).toBe('no-referrer');
 const data=await snapshot.json<{records:{canEdit:boolean}[]}>();expect(data.records[0].canEdit).toBe(true);
 const stored=await env.AUTH_DB.prepare('SELECT token_hash FROM puppy_shares WHERE id=?').bind(input.id).first<{token_hash:string}>();expect(stored!.token_hash).toBe(await secretHash(input.token));expect(stored!.token_hash).not.toContain(input.token);
 expect((await call(guest,'account')).status).toBe(200);expect((await (await call(guest,'sync/pull?after=0')).json<{changes:unknown[]}>()).changes).toHaveLength(0);
 expect((await call(nobody,'care/accept',{id:input.id,token:input.token})).status).toBe(401);
});

test('guest writes are fenced by puppy, invitation, author, permission, expiry and revocation',async()=>{
 const {owner,petId}=await puppy(),input=await invite(owner,petId),guest=await accept(input),other=await accept(await invite(owner,petId)),entry=event();
 // Each accepted invitation is bound to one authenticated carer.
 expect(other.cookie).not.toBe(guest.cookie);
 expect((await call(guest,`care/${input.id}/logs`,entry)).status).toBe(200);
 const edit={...entry,intent:'patch',requestId:entityId('csr'),expectedRevision:1,patch:{note:'Corrected'}};
 expect((await call(other,`care/${(await (await call(other,'care/puppies')).json<{puppies:{id:string}[]}>()).puppies[0].id}/logs`,edit)).status).toBe(403);
 expect((await call(guest,`care/${input.id}/logs`,edit)).status).toBe(200);
 const routine={kind:'routine',requestId:entityId('csr'),localId:entityId('rtn'),intent:'create',patch:{type:'meal',minutes:480}};
 expect((await call(guest,`care/${input.id}/logs`,routine)).status).toBe(403);
 const view=await invite(owner,petId,'temporary','view'),viewer=await accept(view);
 expect((await call(viewer,`care/${view.id}`)).status).toBe(200);expect((await call(viewer,`care/${view.id}/logs`,event())).status).toBe(403);
 expect((await call(guest,`care/${view.id}`)).status).toBe(401);
 expect((await call(guest,`care/${input.id}/logs`,{...event(),petId:'other-puppy'})).status).toBe(400);
 expect((await call(owner,`sharing/${input.id}/revoke`,{})).status).toBe(200);
 expect((await call(guest,`care/${input.id}`)).status).toBe(410);expect((await call(guest,`care/${input.id}/logs`,entry)).status).toBe(410);
 await env.AUTH_DB.prepare('UPDATE puppy_shares SET expires_at=? WHERE id=?').bind(Date.now()-1,view.id).run();
 expect((await call(viewer,`care/${view.id}`)).status).toBe(410);
});

test('household membership requires sign-in, is claimed once, survives invitation expiry and can be removed',async()=>{
 const {owner,petId}=await puppy(),input=await invite(owner,petId,'household'),member=await person(),other=await person();
 expect((await call(nobody,'care/accept',{id:input.id,token:input.token})).status).toBe(401);
 await accept(input,member);await accept(input,member);
 expect((await call(other,'care/accept',{id:input.id,token:input.token})).status).toBe(409);
 expect((await call(other,`care/${input.id}`)).status).toBe(401);
 const routine={kind:'routine',requestId:entityId('csr'),localId:entityId('rtn'),intent:'create',patch:{type:'meal',minutes:480}};
 expect((await call(member,`care/${input.id}/logs`,routine)).status).toBe(200);
 expect((await call(member,`sharing/${input.id}/revoke`,{})).status).toBe(404);
 await env.AUTH_DB.prepare('UPDATE puppy_shares SET invite_expires_at=0 WHERE id=?').bind(input.id).run();
 expect((await call(member,`care/${input.id}`)).status).toBe(200);
 const puppies=await (await call(member,'care/puppies')).json<{puppies:{name:string}[]}>();expect(puppies.puppies).toHaveLength(1);expect(puppies.puppies[0].name).toBe('Biscuit');
 expect((await call(member,'account')).status).toBe(200);
 expect((await call(owner,`sharing/${input.id}/revoke`,{})).status).toBe(200);expect((await call(member,`care/${input.id}/logs`,event())).status).toBe(410);
});

test('creation and management reject account switching, foreign puppies, cross-site requests and invalid durations',async()=>{
 const {owner,petId}=await puppy(),other=await person(),input=await invite(owner,petId);
 expect((await call(owner,'sharing',input)).status).toBe(200);
 const created=await call(owner,`sharing?petId=${petId}`);expect(await created.text()).not.toContain(input.token);
 expect((await call(other,`sharing?petId=${petId}`)).status).toBe(200);
 expect((await (await call(other,`sharing?petId=${petId}`)).json<{shares:unknown[]}>()).shares).toHaveLength(0);
 expect((await call(other,'sharing',{...input,id:entityId('shr'),token:entityId('inv')})).status).toBe(404);
 expect((await call(owner,'sharing',input,{'x-puptime-account':other.id})).status).toBe(409);
 expect((await call(owner,'sharing',input,{origin:'https://bad.example'})).status).toBe(403);
 expect((await call(owner,'sharing',{...input,id:entityId('shr'),expiresAt:Date.now()+31*86400000})).status).toBe(400);
 expect((await call(nobody,'care/preview',{id:input.id,token:entityId('inv')})).status).toBe(410);
 expect((await call(nobody,'care/accept',{id:input.id,token:input.token},{origin:'https://bad.example'})).status).toBe(403);
});

test('all carers see full puppy history and account deletion fences all grants',async()=>{
 const {owner,petId}=await puppy(),input=await invite(owner,petId),guest=await accept(input);
 const recordId=cloudRecordId('event',petId,entityId('evt'));
 await call(owner,'sync/push',{mutations:[{protocolVersion:1,operationId:entityId('csr'),deviceId:'test-device',petId,recordId,kind:'event',baseRevision:0,intent:'create',patch:{type:'meal',at:Date.now()-10*86400000,source:'app'}}]});
 const temp=await (await call(guest,`care/${input.id}`)).json<{records:unknown[]}>();expect(temp.records).toHaveLength(1);
 const household=await invite(owner,petId,'household'),member=await person();await accept(household,member);
 expect((await (await call(member,`care/${household.id}`)).json<{records:unknown[]}>()).records).toHaveLength(1);
 await env.AUTH_DB.prepare("INSERT INTO cloud_accounts(account_id,state) VALUES(?,'deleting')").bind(owner.id).run();
 expect((await call(guest,`care/${input.id}`)).status).toBe(410);expect((await call(member,`care/${household.id}`)).status).toBe(410);
 expect((await call(member,`care/${household.id}/logs`,event())).status).toBe(410);
});


test('the native sync protocol scopes complete history to one puppy, protects authorship, supports offline retries and fences expired access',async()=>{
 const {owner,petId}=await puppy(),input=await invite(owner,petId),guest=await accept(input),headers={'x-puptime-share':input.id};
 // Create a profile revision and history older than seven days, plus private account preferences.
 const ownerEvent=event(),recordId=cloudRecordId('event',petId,ownerEvent.localId);
 const ownerMutation={protocolVersion:1,operationId:entityId('csr'),deviceId:'test-device',petId,recordId,kind:'event',baseRevision:0,intent:'create',patch:{...ownerEvent.patch,at:Date.now()-20*86400000}};
 await call(owner,'sync/push',{mutations:[ownerMutation]});
 await call(owner,'sync/push',{mutations:[{...ownerMutation,operationId:entityId('csr'),recordId:petId,kind:'puppy',patch:{name:'Biscuit'}}]});
 await call(owner,'sync/push',{mutations:[{...ownerMutation,operationId:entityId('csr'),recordId:cloudRecordId('accountPreferences',null,'preferences'),petId:null,kind:'accountPreferences',patch:{language:'es'}}]});
 const summary=await (await call(guest,'account',undefined,headers)).json<{user:{id:string};pets:{id:string}[]}>();
 expect(summary.user.id).toBe(guest.id);expect(summary.pets.map(p=>p.id)).toEqual([petId]);
 const enrollment={operationId:entityId('csr'),deviceId:'guest-device',localPetId:entityId('pet'),confirmedPetId:petId,name:'Biscuit'};
 expect((await call(guest,'cloud/enroll',enrollment,headers)).status).toBe(200);
 const baseline=await (await call(guest,'sync/pull?after=0',undefined,headers)).json<{changes:{kind:string;id:string;editable:boolean}[];cursor:number}>();
 expect(baseline.changes.map(r=>r.kind)).toEqual(['event','puppy']);expect(baseline.changes[0].editable).toBe(false);
 const ownId=cloudRecordId('event',petId,entityId('evt')),mutation={...ownerMutation,operationId:entityId('csr'),recordId:ownId,deviceId:'spoofed-owner-device',patch:{type:'walk',source:'widget',at:Date.now()}};
 const first=await (await call(guest,'sync/push',{mutations:[mutation]},headers)).json<{accepted:{record:{editable:boolean}}[]}>();expect(first.accepted).toHaveLength(1);expect(first.accepted[0].record.editable).toBe(true);
 expect(await (await call(guest,'sync/push',{mutations:[mutation]},headers)).json()).toEqual(first);
 const illegal=[{...mutation,operationId:entityId('csr'),recordId,baseRevision:1,intent:'patch',patch:{note:'spoofed'}},{...mutation,operationId:entityId('csr'),recordId:petId,kind:'puppy',baseRevision:1,intent:'patch',patch:{name:'Changed'}},{...mutation,operationId:entityId('csr'),petId:'foreign',recordId:cloudRecordId('event','foreign','one')}];
 const denied=await (await call(guest,'sync/push',{mutations:illegal},headers)).json<{accepted:unknown[];rejected:unknown[]}>();expect(denied.accepted).toHaveLength(0);expect(denied.rejected).toHaveLength(3);
 const corrected=await (await call(guest,'sync/push',{mutations:[{...mutation,operationId:entityId('csr'),intent:'patch',baseRevision:1,patch:{note:'Corrected offline'}}]},headers)).json<{accepted:unknown[]}>();expect(corrected.accepted).toHaveLength(1);
 const history=await (await call(guest,`records/${encodeURIComponent(ownId)}/history`,undefined,headers)).json<{revisions:{deviceId:string}[]}>();expect(history.revisions.map(r=>r.deviceId)).toEqual([guest.id,guest.id]);
 const fullNote={...mutation,operationId:entityId('csr'),recordId:cloudRecordId('event',petId,entityId('evt')),patch:{...mutation.patch,note:'x'.repeat(16384)}};
 const noteResult=await (await call(guest,'sync/push',{mutations:[fullNote]},headers)).json<{accepted:{record:{data:{note:string}}}[]}>();expect(noteResult.accepted[0].record.data.note).toBe(fullNote.patch.note);
 expect((await call(owner,'account',undefined,{...headers,'x-puptime-account':guest.id})).status).toBe(409);
 await env.AUTH_DB.prepare('UPDATE puppy_shares SET expires_at=? WHERE id=?').bind(Date.now()-1,input.id).run();
 for(const path of ['account','sync/pull?after=0',`records/${encodeURIComponent(ownId)}/history`])expect((await call(guest,path,undefined,headers)).status).toBe(410);
 expect((await call(guest,'sync/push',{mutations:[mutation]},headers)).status).toBe(410);
 expect((await (await call(guest,'care/puppies')).json<{puppies:unknown[]}>()).puppies).toHaveLength(0);
});

async function seedInvitations(owner:Person,petId:string,count:number,options:{memberId?:string;expiredInvite?:boolean;expiredAccess?:boolean;revoked?:boolean}={}){
 const now=Date.now();
 await env.AUTH_DB.batch(Array.from({length:count},()=>env.AUTH_DB.prepare(`INSERT INTO puppy_shares(id,owner_id,pet_id,kind,permission,label,token_hash,expires_at,invite_expires_at,member_id,revoked_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
  entityId('shr'),owner.id,petId,options.expiredAccess?'temporary':'household','contribute','Seed invitation',entityId('inv'),options.expiredAccess?now-1000:null,options.expiredInvite?now-1000:now+86400000,options.memberId??null,options.revoked?now:null,now,
 )));
}

// Inject a state change immediately before the actual mutation, after all route
// reads and authentication. The real D1 statement, schema, and auth still run.
function beforeMutation(match:RegExp,change:()=>Promise<unknown>):Cloudflare.Env{
 function wrapped(statement:D1PreparedStatement):D1PreparedStatement{
  return new Proxy(statement,{get(target,key){
   if(key==='bind')return (...values:unknown[])=>wrapped(target.bind(...values));
   if(key==='run')return async()=>{await change();return target.run();};
   const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
  }});
 }
 return {...settings,AUTH_DB:new Proxy(env.AUTH_DB,{get(target,key){
  if(key==='prepare')return (sql:string)=>{const statement=target.prepare(sql);return match.test(sql)?wrapped(statement):statement;};
  const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
 }})};
}

test('expired unaccepted household invitations release capacity without needing UI revocation',async()=>{
 const {owner,petId}=await puppy();
 await seedInvitations(owner,petId,100,{expiredInvite:true});
 await invite(owner,petId,'household');
 const listed=await (await call(owner,`sharing?petId=${petId}`)).json<{shares:{accepted:boolean;inviteExpiresAt:number}[]}>();
 expect(listed.shares[0].inviteExpiresAt).toBeGreaterThan(Date.now());
});

test('capacity counts accepted household members after invitation expiry and serializes concurrent creators',async()=>{
 const {owner,petId}=await puppy(),member=await person();
 await seedInvitations(owner,petId,99,{memberId:member.id,expiredInvite:true});
 await seedInvitations(owner,petId,1,{expiredInvite:true});
 await seedInvitations(owner,petId,1,{expiredAccess:true});
 await seedInvitations(owner,petId,1,{revoked:true});
 const drafts=Array.from({length:2},():CreateShare=>({id:entityId('shr'),token:entityId('inv'),petId,kind:'household',permission:'contribute',label:'Last slot',expiresAt:null}));
 let arrivals=0,release!:()=>void;const bothReady=new Promise<void>(resolve=>{release=resolve;});
 const runtime=beforeMutation(/^INSERT INTO puppy_shares\(/,async()=>{if(++arrivals===2)release();await bothReady;});
 const results=await Promise.all(drafts.map(input=>call(owner,'sharing',input,{},runtime)));
 expect(results.map(result=>result.status).sort()).toEqual([201,429]);
 const winner=drafts[results.findIndex(result=>result.status===201)];
 expect((await call(owner,'sharing',winner)).status).toBe(200);
 expect(await env.AUTH_DB.prepare('SELECT COUNT(*) AS n FROM puppy_shares WHERE owner_id=? AND member_id IS NOT NULL').bind(owner.id).first()).toEqual({n:99});
 expect(await env.AUTH_DB.prepare('SELECT COUNT(*) AS n FROM puppy_shares WHERE id IN (?,?)').bind(drafts[0].id,drafts[1].id).first()).toEqual({n:1});
});

test('accepted grants for deleting members release capacity even while their invitation deadline remains valid',async()=>{
 const {owner,petId}=await puppy(),healthy=await person(),deleting=await person();
 await seedInvitations(owner,petId,99,{memberId:healthy.id,expiredInvite:true});
 await seedInvitations(owner,petId,1,{memberId:deleting.id});
 await env.AUTH_DB.prepare("INSERT INTO cloud_accounts(account_id,state) VALUES(?,'deleting')").bind(deleting.id).run();
 await invite(owner,petId,'household');
 const extra:CreateShare={id:entityId('shr'),token:entityId('inv'),petId,kind:'household',permission:'contribute',label:'Beyond capacity',expiresAt:null};
 expect((await call(owner,'sharing',extra)).status).toBe(429);
 expect(await env.AUTH_DB.prepare('SELECT COUNT(*) AS n FROM puppy_shares WHERE owner_id=? AND member_id=?').bind(owner.id,healthy.id).first()).toEqual({n:99});
});

test('concurrent identical creates replay the same invitation while different content conflicts',async()=>{
 const {owner,petId}=await puppy(),input:CreateShare={id:entityId('shr'),token:entityId('inv'),petId,kind:'household',permission:'contribute',label:'Same invitation',expiresAt:null};
 let arrivals=0,release!:()=>void;const bothReady=new Promise<void>(resolve=>{release=resolve;});
 const runtime=beforeMutation(/^INSERT INTO puppy_shares\(/,async()=>{if(++arrivals===2)release();await bothReady;});
 const results=await Promise.all([call(owner,'sharing',input,{},runtime),call(owner,'sharing',input,{},runtime)]);
 expect(results.map(result=>result.status).sort()).toEqual([200,201]);
 expect(await results[0].json()).toEqual(await results[1].json());
 expect((await call(owner,'sharing',{...input,label:'Different request'})).status).toBe(409);
 expect(await env.AUTH_DB.prepare('SELECT COUNT(*) AS n FROM puppy_shares WHERE id=?').bind(input.id).first()).toEqual({n:1});
});

test.each(['invitation-expired','access-expired','revoked','owner-deleting','member-deleting'] as const)('acceptance rechecks %s atomically after authentication',async condition=>{
 const {owner,petId}=await puppy(),input=await invite(owner,petId,condition==='access-expired'?'temporary':'household'),member=await person();
 const runtime=beforeMutation(/^UPDATE puppy_shares AS s SET member_id=/,async()=>{
  if(condition==='invitation-expired')return env.AUTH_DB.prepare('UPDATE puppy_shares SET invite_expires_at=0 WHERE id=?').bind(input.id).run();
  if(condition==='access-expired')return env.AUTH_DB.prepare('UPDATE puppy_shares SET expires_at=0 WHERE id=?').bind(input.id).run();
  if(condition==='revoked')return env.AUTH_DB.prepare('UPDATE puppy_shares SET revoked_at=? WHERE id=?').bind(Date.now(),input.id).run();
  return env.AUTH_DB.prepare("INSERT INTO cloud_accounts(account_id,state) VALUES(?,'deleting') ON CONFLICT(account_id) DO UPDATE SET state='deleting'").bind(condition==='owner-deleting'?owner.id:member.id).run();
 });
 expect((await call(member,'care/accept',{id:input.id,token:input.token},{},runtime)).status).toBe(410);
 expect(await env.AUTH_DB.prepare('SELECT member_id FROM puppy_shares WHERE id=?').bind(input.id).first()).toEqual({member_id:null});
});

test('acceptance is claimed once and successful household acceptance remains retryable after invitation expiry',async()=>{
 const {owner,petId}=await puppy(),input=await invite(owner,petId,'household'),members=await Promise.all([person(),person()]);
 const results=await Promise.all(members.map(member=>call(member,'care/accept',{id:input.id,token:input.token})));
 expect(results.map(result=>result.status).sort()).toEqual([200,409]);
 const winner=members[results.findIndex(result=>result.status===200)];
 await env.AUTH_DB.prepare('UPDATE puppy_shares SET invite_expires_at=0 WHERE id=?').bind(input.id).run();
 const retries=await Promise.all([call(winner,'care/accept',{id:input.id,token:input.token}),call(winner,'care/accept',{id:input.id,token:input.token})]);
 expect(retries.map(result=>result.status)).toEqual([200,200]);
 expect((await call(winner,`care/${input.id}`)).status).toBe(200);
 await call(owner,`sharing/${input.id}/revoke`,{});
 expect((await call(winner,'care/accept',{id:input.id,token:input.token})).status).toBe(410);
});

test('creation rechecks account availability at its atomic insertion',async()=>{
 const {owner,petId}=await puppy(),input:CreateShare={id:entityId('shr'),token:entityId('inv'),petId,kind:'household',permission:'contribute',label:'Delayed creation',expiresAt:null};
 const runtime=beforeMutation(/^INSERT INTO puppy_shares\(/,()=>env.AUTH_DB.prepare("INSERT INTO cloud_accounts(account_id,state) VALUES(?,'deleting')").bind(owner.id).run());
 expect((await call(owner,'sharing',input,{},runtime)).status).toBe(410);
 expect(await env.AUTH_DB.prepare('SELECT id FROM puppy_shares WHERE id=?').bind(input.id).first()).toBeNull();
});

test('shared sync rejects a second independently started nap as invalid and accepts its explicit end-time correction',async()=>{
 const {owner,petId}=await puppy(),input=await invite(owner,petId,'household'),member=await accept(input),headers={'x-puptime-share':input.id};
 const at=Date.now()-60000;
 const ownerNap={protocolVersion:1,operationId:entityId('csr'),deviceId:'test-device',petId,recordId:cloudRecordId('event',petId,entityId('evt')),kind:'event',baseRevision:0,intent:'create',patch:{type:'nap',at,endedAt:null,source:'app'}};
 const ownerSaved=await (await call(owner,'sync/push',{mutations:[ownerNap]})).json<{accepted:unknown[];rejected:unknown[]}>();
 expect(ownerSaved.accepted).toHaveLength(1);expect(ownerSaved.rejected).toEqual([]);
 const memberNap={...ownerNap,operationId:entityId('csr'),deviceId:'member-device',recordId:cloudRecordId('event',petId,entityId('evt')),patch:{...ownerNap.patch,at:at+1000}};
 for(let retry=0;retry<2;retry++){
  const rejected=await (await call(member,'sync/push',{mutations:[memberNap]},headers)).json();
  expect(rejected).toEqual({accepted:[],rejected:[{operationId:memberNap.operationId,error:'invalid_mutation'}]});
 }
 const afterRejection=await (await call(owner,'sync/pull?after=0')).json<{changes:{id:string}[]}>();
 expect(afterRejection.changes.map(record=>record.id)).toEqual([ownerNap.recordId]);
 // A rejected operation has no acknowledgment or partial record to prevent the
 // member from correcting the same draft and retrying its stable operation ID.
 const corrected={...memberNap,patch:{...memberNap.patch,endedAt:at+30000}};
 const saved=await (await call(member,'sync/push',{mutations:[corrected]},headers)).json<{accepted:{record:{id:string;data:{endedAt:number}}}[];rejected:unknown[]}>();
 expect(saved.rejected).toEqual([]);expect(saved.accepted).toHaveLength(1);
 expect(saved.accepted[0].record).toMatchObject({id:memberNap.recordId,data:{endedAt:at+30000}});
 expect(await (await call(member,'sync/push',{mutations:[corrected]},headers)).json()).toEqual(saved);
 const history=await (await call(owner,'sync/pull?after=0')).json<{changes:{data:{endedAt:number|null}}[]}>();
 expect(history.changes).toHaveLength(2);
 expect(history.changes.filter(record=>record.data.endedAt===null)).toHaveLength(1);
});

test.each(['invitation-expired','revoked','access-expired','owner-deleting','member-deleting'] as const)('shared photos and sync use the same eligibility when %s',async condition=>{
 const {owner,petId}=await puppy(),input=await invite(owner,petId,condition==='invitation-expired'?'household':'temporary'),member=await accept(input),headers={'x-puptime-share':input.id};
 const photoId=entityId('img'),privatePhotoId=entityId('img'),jpeg=new Uint8Array([255,216,255,219,0,255,217]);
 await env.PUPPY_PHOTOS!.put(accountPhotoKey(owner.id,photoId),jpeg,{httpMetadata:{contentType:'image/jpeg'},customMetadata:{petId}});
 await env.PUPPY_PHOTOS!.put(accountPhotoKey(owner.id,privatePhotoId),jpeg,{httpMetadata:{contentType:'image/jpeg'},customMetadata:{petId:'another-puppy'}});
 const visible=await call(member,`photos/${photoId}`,undefined,headers);
 expect(visible.status).toBe(200);expect(new Uint8Array(await visible.arrayBuffer())).toEqual(jpeg);
 expect((await call(member,`photos/${privatePhotoId}`,undefined,headers)).status).toBe(404);
 if(condition==='invitation-expired')await env.AUTH_DB.prepare('UPDATE puppy_shares SET invite_expires_at=0 WHERE id=?').bind(input.id).run();
 else if(condition==='revoked')await call(owner,`sharing/${input.id}/revoke`,{});
 else if(condition==='access-expired')await env.AUTH_DB.prepare('UPDATE puppy_shares SET expires_at=0 WHERE id=?').bind(input.id).run();
 else await env.AUTH_DB.prepare("INSERT INTO cloud_accounts(account_id,state) VALUES(?,'deleting')").bind(condition==='owner-deleting'?owner.id:member.id).run();
 for(const path of [`photos/${photoId}`,'account','sync/pull?after=0']){
  const response=await call(member,path,undefined,headers);
  expect(response.status).toBe(condition==='invitation-expired'?200:410);
  await response.arrayBuffer();
 }
});

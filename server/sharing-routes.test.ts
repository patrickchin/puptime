import {env} from 'cloudflare:workers';
import {applyD1Migrations} from 'cloudflare:test';
import {beforeAll,expect,inject,test} from 'vitest';
import worker from './index';
import {entityId} from '../src/entity-id';
import type {CreateShare} from '../src/sharing';
import {cloudRecordId} from '../src/cloud/record-identity';
import {secretHash} from './sharing-routes';

beforeAll(()=>applyD1Migrations(env.AUTH_DB,inject('migrations')));
const settings={...env,ENVIRONMENT:'local' as const,AUTH_BASE_URL:'https://puptime.test',WEB_ORIGINS:'https://puptime.test',AUTH_SECRET:'local-test-secret-with-at-least-32-characters'};
type Person={id:string;cookie:string;ip:string};let clientNumber=20;
const nobody={id:'',cookie:'',ip:'192.0.2.240'};
function call(person:Person,path:string,body?:object,extra:Record<string,string>={}){
 return worker.fetch(new Request('https://puptime.test/api/'+path,{method:body?'POST':'GET',headers:{origin:'https://puptime.test','content-type':'application/json','cf-connecting-ip':person.ip,cookie:person.cookie,'x-puptime-account':person.id,...extra},...(body?{body:JSON.stringify(body)}:{})}),settings);
}
async function person():Promise<Person>{
 const result={...nobody,ip:`192.0.2.${clientNumber++}`},email=`sharing-${crypto.randomUUID()}@example.invalid`;
 expect((await call(result,'auth/email-otp/send-verification-otp',{email,type:'sign-in'})).status).toBe(200);
 const otp=await env.AUTH_DB.prepare('SELECT code FROM local_email_previews WHERE email=?').bind(email).first<{code:string}>();
 const login=await call(result,'auth/sign-in/email-otp',{email,otp:otp!.code});expect(login.status).toBe(200);
 result.cookie=login.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
 const account=await (await call(result,'account')).json<{user:{id:string}}>();result.id=account.user.id;return result;
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
async function accept(input:CreateShare,member=nobody){
 const response=await call(member,'care/accept',{id:input.id,token:input.token,name:'Alex'});expect(response.status).toBe(200);
 return {...member,cookie:[member.cookie,...response.headers.getSetCookie().map(value=>value.split(';')[0])].filter(Boolean).join('; ')};
}
const event=(localId=entityId('evt'))=>({kind:'event',requestId:entityId('csr'),localId,intent:'create',patch:{type:'walk',at:Date.now(),source:'app',note:'Around the park'}});

test('temporary care opens without an account, keeps retry-safe attribution and syncs to the owner',async()=>{
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
 expect((await call(guest,'account')).status).toBe(401);expect((await call(guest,'sync/pull?after=0')).status).toBe(401);expect((await call(guest,'v1/puppies')).status).toBe(401);
});

test('guest writes are fenced by puppy, invitation, author, permission, expiry and revocation',async()=>{
 const {owner,petId}=await puppy(),input=await invite(owner,petId),guest=await accept(input),other=await accept(input),entry=event();
 // A second browser has its own actor even when it opens the same invitation.
 expect(other.cookie).not.toBe(guest.cookie);
 expect((await call(guest,`care/${input.id}/logs`,entry)).status).toBe(200);
 const edit={...entry,intent:'patch',requestId:entityId('csr'),expectedRevision:1,patch:{note:'Corrected'}};
 expect((await call(other,`care/${input.id}/logs`,edit)).status).toBe(403);
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

test('temporary snapshots exclude old history and other puppies, household sees full history, deletion fences all grants',async()=>{
 const {owner,petId}=await puppy(),input=await invite(owner,petId),guest=await accept(input);
 const recordId=cloudRecordId('event',petId,entityId('evt'));
 await call(owner,'sync/push',{mutations:[{protocolVersion:1,operationId:entityId('csr'),deviceId:'test-device',petId,recordId,kind:'event',baseRevision:0,intent:'create',patch:{type:'meal',at:Date.now()-10*86400000,source:'app'}}]});
 const temp=await (await call(guest,`care/${input.id}`)).json<{records:unknown[]}>();expect(temp.records).toHaveLength(0);
 const household=await invite(owner,petId,'household'),member=await person();await accept(household,member);
 expect((await (await call(member,`care/${household.id}`)).json<{records:unknown[]}>()).records).toHaveLength(1);
 await env.AUTH_DB.prepare("INSERT INTO cloud_accounts(account_id,state) VALUES(?,'deleting')").bind(owner.id).run();
 expect((await call(guest,`care/${input.id}`)).status).toBe(410);expect((await call(member,`care/${household.id}`)).status).toBe(410);
 expect((await call(member,`care/${household.id}/logs`,event())).status).toBe(410);
});

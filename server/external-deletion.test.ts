import { env } from 'cloudflare:workers';
import { applyD1Migrations, runInDurableObject } from 'cloudflare:test';
import { beforeAll, expect, inject, test } from 'vitest';
import { createWebDeletionClient } from '../src/web/account-deletion';
import { createAuth } from './auth';
import { entityId } from '../src/entity-id';
import { onRequest } from '../functions/api/[[path]]';
import worker from './index';

const origin='https://puptime.pages.dev';
const settings={...env,ENVIRONMENT:'local' as const,AUTH_BASE_URL:origin,WEB_ORIGINS:origin,AUTH_SECRET:'synthetic-deletion-test-secret-at-least-thirty-two-characters'};
beforeAll(()=>applyD1Migrations(env.AUTH_DB,inject('migrations')));
let sequence=10;
function browser(){
 let cookie='',loseDeleteResponse=false;
 const paths:string[]=[],ip=`192.0.2.${sequence++}`;
 const transport:typeof fetch=async(input,init)=>{
  const headers=new Headers(init?.headers);headers.set('origin',origin);headers.set('cf-connecting-ip',ip);if(cookie)headers.set('cookie',cookie);
  const request=new Request(String(input),{...init,headers,redirect:'manual'});paths.push(`${request.method} ${new URL(request.url).pathname}`);
  const response=await onRequest({request,env:{PUPTIME_API:{fetch:async request=>worker.fetch(request,settings)}}});
  const updates=response.headers.getSetCookie();if(updates.length)cookie=updates.map(value=>value.split(';')[0]).join('; ');
  if(loseDeleteResponse&&request.method==='DELETE'){loseDeleteResponse=false;throw new TypeError('Synthetic lost response');}
  return response;
 };
 return {client:createWebDeletionClient(origin,transport),paths,get cookie(){return cookie;},set cookie(value:string){cookie=value;},loseNextDelete(){loseDeleteResponse=true;}};
}
async function fixture(provider:'email'|'google'|'apple'='email'){
 const id=entityId('usr'),email=`deletion-${id}@example.invalid`,now=Date.now();
 await env.AUTH_DB.prepare('INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,?,1,?,?)').bind(id,'Synthetic owner',email,now,now).run();
 if(provider!=='email'){
  const context=await createAuth(settings).$context;
  await context.adapter.create({model:'account',data:{userId:id,providerId:provider,accountId:'synthetic-'+provider+'-'+id,createdAt:new Date(),updatedAt:new Date()}});
 }
 await runInDurableObject(env.ACCOUNTS.getByName(id),instance=>{
  instance.enrollForClient({operationId:'op_'+crypto.randomUUID().replaceAll('-',''),deviceId:'dev_synthetic',localPetId:'pet_synthetic',name:'Synthetic puppy'});
  instance.apply({protocolVersion:1,operationId:'op_'+crypto.randomUUID().replaceAll('-',''),deviceId:'dev_synthetic',recordId:'evt_synthetic',petId:'pet_synthetic',kind:'event',baseRevision:0,intent:'create',patch:{type:'pee',at:100,source:'app',note:'Wholly artificial history'}});
 });
 return {id,email};
}
async function otp(email:string){return (await env.AUTH_DB.prepare('SELECT code FROM local_email_previews WHERE email=? ORDER BY expires_at DESC').bind(email).first<{code:string}>())!.code;}
async function cloudState(id:string){return runInDurableObject(env.ACCOUNTS.getByName(id),(_instance,state)=>({
 records:state.storage.sql.exec('SELECT * FROM records ORDER BY id').toArray(),
 history:state.storage.sql.exec('SELECT * FROM revisions ORDER BY sequence').toArray(),
 retired:state.storage.sql.exec("SELECT value FROM account_state WHERE key='retired'").toArray(),
}));}
function noHistoryReads(paths:string[]){expect(paths.some(path=>/sync|cloud\/enroll|\/api\/account$/.test(path)&&!path.startsWith('DELETE '))).toBe(false);}

test.each(['email','google','apple'] as const)('existing %s account verifies without another identity and cancel preserves cloud history',async provider=>{
 const owner=await fixture(provider),before=await cloudState(owner.id),browserSession=browser();
 await browserSession.client.requestCode(owner.email);
 expect(await browserSession.client.verify(owner.email,await otp(owner.email))).toEqual({id:owner.id,email:owner.email});
 expect((await env.AUTH_DB.prepare('SELECT id FROM user WHERE email=?').bind(owner.email).all()).results).toEqual([{id:owner.id}]);
 await browserSession.client.cancel();
 expect(await cloudState(owner.id)).toEqual(before);expect(await env.AUTH_DB.prepare('SELECT id FROM session WHERE userId=?').bind(owner.id).first()).toBeNull();
 noHistoryReads(browserSession.paths);
});

test('unknown addresses do not send a code or create a user; ordinary native email signup remains enabled',async()=>{
 const email='unknown-'+entityId('usr')+'@example.invalid',b=browser();
 await b.client.requestCode(email);
 expect(await env.AUTH_DB.prepare('SELECT id FROM local_email_previews WHERE email=?').bind(email).first()).toBeNull();
 await expect(b.client.verify(email,'000000')).rejects.toMatchObject({kind:'code'});
 expect(await env.AUTH_DB.prepare('SELECT id FROM user WHERE email=?').bind(email).first()).toBeNull();
 const headers={origin,'content-type':'application/json','cf-connecting-ip':`198.51.100.${sequence++}`};
 expect((await worker.fetch(new Request(origin+'/api/auth/email-otp/send-verification-otp',{method:'POST',headers,body:JSON.stringify({email,type:'sign-in'})}),settings)).status).toBe(200);
 // Even an otherwise valid code issued by the ordinary signup endpoint must
 // not create an account through the deletion page.
 await expect(b.client.verify(email,await otp(email))).rejects.toMatchObject({kind:'code'});
 expect(await env.AUTH_DB.prepare('SELECT id FROM user WHERE email=?').bind(email).first()).toBeNull();
 expect((await worker.fetch(new Request(origin+'/api/auth/email-otp/send-verification-otp',{method:'POST',headers,body:JSON.stringify({email,type:'sign-in'})}),settings)).status).toBe(200);
 expect((await worker.fetch(new Request(origin+'/api/auth/sign-in/email-otp',{method:'POST',headers,body:JSON.stringify({email,otp:await otp(email)})}),settings)).status).toBe(200);
 expect(await env.AUTH_DB.prepare('SELECT id FROM user WHERE email=?').bind(email).first()).not.toBeNull();
});

test('expired verification and cross-site requests preserve account and records',async()=>{
 const owner=await fixture(),before=await cloudState(owner.id),b=browser();await b.client.requestCode(owner.email);
 const code=await otp(owner.email);
 await env.AUTH_DB.prepare('UPDATE verification SET expiresAt=? WHERE identifier=?').bind(Date.now()-1000,`sign-in-otp-${owner.email}`).run();
 await expect(b.client.verify(owner.email,code)).rejects.toMatchObject({kind:'code'});
 const response=await worker.fetch(new Request(origin+'/api/auth/email-otp/send-verification-otp',{method:'POST',headers:{origin:'https://untrusted.example','content-type':'application/json','x-puptime-purpose':'account-deletion'},body:JSON.stringify({email:owner.email,type:'sign-in'})}),settings);
 expect(response.status).toBe(403);expect(await cloudState(owner.id)).toEqual(before);
});

test('a changed browser account cannot delete either history with stale confirmation',async()=>{
 const owner=await fixture(),other=await fixture(),before=await cloudState(owner.id),otherBefore=await cloudState(other.id),a=browser(),b=browser();
 for(const [fixture,session] of [[owner,a],[other,b]] as const){await session.client.requestCode(fixture.email);await session.client.verify(fixture.email,await otp(fixture.email));}
 a.cookie=b.cookie;await expect(a.client.remove(owner.id)).rejects.toMatchObject({kind:'mismatch'});
 expect(await cloudState(owner.id)).toEqual(before);expect(await cloudState(other.id)).toEqual(otherBefore);
});

test('explicit deletion retires populated cloud history, and a lost accepted response never recreates it',async()=>{
 const owner=await fixture(),b=browser();await b.client.requestCode(owner.email);const code=await otp(owner.email);
 await b.client.verify(owner.email,code);expect((await cloudState(owner.id)).records).toHaveLength(1);
 b.loseNextDelete();await expect(b.client.remove(owner.id)).rejects.toMatchObject({kind:'unconfirmed'});
 expect(b.paths.filter(path=>path==='DELETE /api/account')).toHaveLength(1);
 expect(await env.AUTH_DB.prepare('SELECT id FROM user WHERE id=?').bind(owner.id).first()).toBeNull();
 expect(await cloudState(owner.id)).toEqual({records:[],history:[],retired:[{value:1}]});
 await b.client.requestCode(owner.email);await expect(b.client.verify(owner.email,code)).rejects.toMatchObject({kind:'code'});
 expect(await env.AUTH_DB.prepare('SELECT id FROM user WHERE email=?').bind(owner.email).first()).toBeNull();
 expect(b.paths.filter(path=>path==='DELETE /api/account')).toHaveLength(1);noHistoryReads(b.paths);
});

test('expired session requires fresh same-account verification before an accepted deletion',async()=>{
 const owner=await fixture(),b=browser();await b.client.requestCode(owner.email);await b.client.verify(owner.email,await otp(owner.email));
 const before=await cloudState(owner.id);await env.AUTH_DB.prepare('UPDATE session SET createdAt=0 WHERE userId=?').bind(owner.id).run();
 await expect(b.client.remove(owner.id)).rejects.toMatchObject({kind:'reauth'});
 expect(b.paths).not.toContain('DELETE /api/account');expect(await cloudState(owner.id)).toEqual(before);
 await b.client.requestCode(owner.email);expect(await b.client.verify(owner.email,await otp(owner.email))).toEqual(owner);
 expect(await b.client.remove(owner.id)).toEqual({appleManual:false});
 expect(await cloudState(owner.id)).toEqual({records:[],history:[],retired:[{value:1}]});
});

test('the deletion-only purpose retains the SDK email-request throttle',async()=>{
 const b=browser(),email='limited-'+entityId('usr')+'@example.invalid';
 for(let attempt=0;attempt<3;attempt++)await b.client.requestCode(email);
 await expect(b.client.requestCode(email)).rejects.toMatchObject({kind:'rate'});
 expect(await env.AUTH_DB.prepare('SELECT id FROM user WHERE email=?').bind(email).first()).toBeNull();
});

test('a missing rollout capability blocks the SDK before any sign-in request',async()=>{
 const paths:string[]=[];
 const client=createWebDeletionClient(origin,async input=>{paths.push(String(input));return Response.json({error:'not_found'},{status:404});});
 await expect(client.requestCode('unreachable@example.invalid')).rejects.toMatchObject({kind:'service'});
 await expect(client.verify('unreachable@example.invalid','123456')).rejects.toMatchObject({kind:'service'});
 expect(paths).toEqual([origin+'/api/account/deletion-options',origin+'/api/account/deletion-options']);
});

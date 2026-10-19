import { env } from 'cloudflare:workers';
import { applyD1Migrations } from 'cloudflare:test';
import { beforeAll, expect, inject, test } from 'vitest';
import worker from './index';
import { createAuth } from './auth';
const origin='https://puptime.test';
const settings={...env,ENVIRONMENT:'local' as const,AUTH_BASE_URL:origin,WEB_ORIGINS:origin,AUTH_SECRET:'web-test-secret-at-least-thirty-two-characters',GOOGLE_CLIENT_ID:'synthetic-google-client',GOOGLE_CLIENT_SECRET:'synthetic-secret'};
let index=0;
beforeAll(()=>applyD1Migrations(env.AUTH_DB,inject('migrations')));
async function owner(){
 const email=`web-${crypto.randomUUID()}@example.invalid`,ip=`198.51.100.${++index}`;
 const post=(path:string,body:object)=>worker.fetch(new Request(origin+'/api/auth/'+path,{method:'POST',headers:{origin,'cf-connecting-ip':ip,'content-type':'application/json'},body:JSON.stringify(body)}),settings);
 expect((await post('email-otp/send-verification-otp',{email,type:'sign-in'})).status).toBe(200);
 const preview=await env.AUTH_DB.prepare('SELECT code FROM local_email_previews WHERE email=?').bind(email).first<{code:string}>();
 const login=await post('sign-in/email-otp',{email,otp:preview!.code});expect(login.status).toBe(200);
 const cookie=login.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
 const response=await worker.fetch(new Request(origin+'/api/account',{headers:{origin,cookie}}),settings);
 return {cookie,ip,...await response.json<{user:{id:string}}> ()};
}
for(const action of ['delete','link'] as const)test(`${action} fences browser cookie changes against the expected user without changing either account`,async()=>{
 const a=await owner(),b=await owner();
 for(const expected of [a.user.id,'stale-or-invalid-user',' ']){
  const response=await worker.fetch(new Request(origin+(action==='delete'?'/api/account':'/api/auth/link-social'),{method:action==='delete'?'DELETE':'POST',headers:{origin,cookie:b.cookie,'cf-connecting-ip':b.ip,'content-type':'application/json','x-puptime-account':expected},body:JSON.stringify(action==='delete'?{confirm:true}:{provider:'google',callbackURL:origin+'/account'})}),settings);
  expect(response.status).toBe(409);
 }
 for(const fixture of [a,b])expect((await worker.fetch(new Request(origin+'/api/account',{headers:{origin,cookie:fixture.cookie}}),settings)).status).toBe(200);
 expect((await env.AUTH_DB.prepare('SELECT id FROM account WHERE userId IN (?,?)').bind(a.user.id,b.user.id).all()).results).toEqual([]);
});
test('linking without auth fails and callers without the new header retain the existing contract',async()=>{
 const a=await owner();
 const link=(cookie?:string,expected?:string)=>worker.fetch(new Request(origin+'/api/auth/link-social',{method:'POST',headers:{origin,'content-type':'application/json','cf-connecting-ip':`198.51.100.${++index}`,...(cookie?{cookie}:{}),...(expected!==undefined?{'x-puptime-account':expected}:{})},body:JSON.stringify({provider:'google',callbackURL:origin+'/account'})}),settings);
 expect((await link()).status).toBe(401);expect((await link(undefined,a.user.id)).status).toBe(401);expect((await link(a.cookie,a.user.id)).status).toBe(200);expect((await link(a.cookie)).status).toBe(200);
 const deleted=await worker.fetch(new Request(origin+'/api/account',{method:'DELETE',headers:{origin,cookie:a.cookie,'content-type':'application/json'},body:'{"confirm":true}'}),settings);
 expect(deleted.status).toBe(200);
});

test('POST browser export binds its displayed user and retains the existing streaming GET contract',async()=>{
 const a=await owner(),b=await owner();
 const download=(expected:string,cookie=b.cookie)=>worker.fetch(new Request(origin+'/api/account/export',{method:'POST',headers:{origin,cookie,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({expectedAccount:expected})}),settings);
 expect((await download('')).status).toBe(400);expect((await download('stale-owner')).status).toBe(409);
 const refused=await download(a.user.id);expect(refused.status).toBe(409);expect(refused.headers.has('content-disposition')).toBe(false);expect(await refused.text()).not.toContain(b.user.id);
 const valid=await download(b.user.id);expect(valid.status).toBe(200);expect(valid.headers.get('content-disposition')).toContain('attachment');expect((await valid.text()).trim().split('\n').map(row=>JSON.parse(row).type)).toEqual(['manifest','complete']);
 expect((await worker.fetch(new Request(origin+'/api/account/export',{headers:{origin,cookie:a.cookie}}),settings)).status).toBe(200);
});
test('same-owner OTP reauthentication refreshes a stale session without allowing signup',async()=>{
 const a=await owner();await env.AUTH_DB.prepare('UPDATE session SET createdAt=0 WHERE userId=?').bind(a.user.id).run();await env.AUTH_DB.prepare("INSERT INTO cloud_accounts(account_id,state) VALUES (?,'deleting')").bind(a.user.id).run();
 const email=(await env.AUTH_DB.prepare('SELECT email FROM user WHERE id=?').bind(a.user.id).first<{email:string}>())!.email;
 const sent=await worker.fetch(new Request(origin+'/api/auth/email-otp/send-verification-otp',{method:'POST',headers:{origin,cookie:a.cookie,'cf-connecting-ip':a.ip,'content-type':'application/json'},body:JSON.stringify({email,type:'sign-in'})}),settings);expect(sent.status).toBe(200);
 const preview=await env.AUTH_DB.prepare('SELECT code FROM local_email_previews WHERE email=? ORDER BY expires_at DESC').bind(email).first<{code:string}>();
 const verify=(expected:string,cookie=a.cookie)=>worker.fetch(new Request(origin+'/api/account/reauth',{method:'POST',headers:{origin,cookie,'cf-connecting-ip':a.ip,'content-type':'application/json','x-puptime-account':expected},body:JSON.stringify({otp:preview!.code})}),settings);
 expect((await verify('wrong-owner')).status).toBe(409);const aged=Date.now()-172800000;await env.AUTH_DB.prepare('UPDATE session SET createdAt=?,updatedAt=?,expiresAt=? WHERE userId=?').bind(aged,aged,Date.now()+28*86400000,a.user.id).run();const verified=await verify(a.user.id);expect(verified.status).toBe(200);expect((await verified.json<{user:{id:string}}>()).user.id).toBe(a.user.id);expect(verified.headers.getSetCookie().length).toBeGreaterThan(0);const freshCookie=verified.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');const fresh=await createAuth(settings).api.getSession({headers:new Headers({cookie:freshCookie}),query:{disableRefresh:true}});expect(fresh?.user.id).toBe(a.user.id);expect(new Date(fresh!.session.createdAt).getTime()).toBeGreaterThan(Date.now()-10000);
 await env.AUTH_DB.prepare('DELETE FROM session WHERE userId=?').bind(a.user.id).run();await env.AUTH_DB.prepare('DELETE FROM user WHERE id=?').bind(a.user.id).run();expect((await verify(a.user.id)).status).toBe(401);expect(await env.AUTH_DB.prepare('SELECT id FROM user WHERE email=?').bind(email).first()).toBeNull();
});

test('reauthentication SDK refuses a missing user even when its OTP was issued before account removal',async()=>{
 const email=`web-no-recreate-${crypto.randomUUID()}@example.invalid`,ip=`198.51.100.${++index}`;
 const sent=await worker.fetch(new Request(origin+'/api/auth/email-otp/send-verification-otp',{method:'POST',headers:{origin,'cf-connecting-ip':ip,'content-type':'application/json'},body:JSON.stringify({email,type:'sign-in'})}),settings);expect(sent.status).toBe(200);
 const preview=await env.AUTH_DB.prepare('SELECT code FROM local_email_previews WHERE email=?').bind(email).first<{code:string}>();
 const response=await createAuth(settings,{disableEmailSignUp:true}).api.signInEmailOTP({body:{email,otp:preview!.code},asResponse:true});expect(response.status).toBe(400);expect(await env.AUTH_DB.prepare('SELECT id FROM user WHERE email=?').bind(email).first()).toBeNull();
});

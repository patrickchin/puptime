import {env} from 'cloudflare:workers';
import {applyD1Migrations} from 'cloudflare:test';
import {createAuthClient} from 'better-auth/client';
import {emailOTPClient} from 'better-auth/client/plugins';
import {beforeAll,expect,inject,test,vi} from 'vitest';
import {onRequest} from '../functions/api/[[path]]';
import {createCloudApi,createSdkRequest} from '../src/cloud/api';
import {cloudRecordId} from '../src/cloud/record-identity';
import worker from './index';

beforeAll(()=>applyD1Migrations(env.AUTH_DB,inject('migrations')));
const origin='https://puptime.pages.dev';
const settings={...env,ENVIRONMENT:'local' as const,AUTH_BASE_URL:'https://puptime-api-staging.p-ch.workers.dev',WEB_ORIGINS:origin,AUTH_SECRET:'local-test-secret-with-at-least-32-characters'};
const binding={fetch:async(request:Request)=>worker.fetch(request,settings)};

test('a missing Pages service binding fails closed without a public fetch fallback',async()=>{
 const external=vi.spyOn(globalThis,'fetch');
 try{
  const response=await onRequest({request:new Request(origin+'/api/account'),env:{}});
  expect(response.status).toBe(503);expect(await response.json()).toEqual({error:'service_unavailable'});
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('content-type')).toContain('application/json');expect(external).not.toHaveBeenCalled();
 }finally{external.mockRestore();}
});

test('Pages forwards the original request and response including encoded paths bodies cookies redirects and errors',async()=>{
 const id=cloudRecordId('event','pet-1','活动 /%?#:💩');
 const request=new Request(origin+'/api/records/'+encodeURIComponent(id)+'/history?beforeRevision=5',{
  method:'POST',headers:{cookie:'synthetic=opaque',origin,'expo-origin':'puptime://','cf-connecting-ip':'192.0.2.245','content-type':'application/json'},body:'{"synthetic":true}',redirect:'manual',
 });
 for(const status of [200,307,429,503]){
  const headers=new Headers({'cache-control':'no-store','retry-after':'3','location':origin+'/api/auth/callback/google'});
  headers.append('set-cookie','first=one; Secure; HttpOnly; Path=/');headers.append('set-cookie','second=two; Secure; HttpOnly; Path=/');
  const upstream=new Response('synthetic response',{status,headers});
  const forwarded=await onRequest({request,env:{PUPTIME_API:{fetch:async received=>{
   expect(received).toBe(request);expect(received.url).toBe(request.url);expect(await received.clone().text()).toBe('{"synthetic":true}');
   expect(received.headers.get('cookie')).toBe('synthetic=opaque');return upstream;
  }}}});
  expect(forwarded).toBe(upstream);expect(forwarded.status).toBe(status);
  expect(forwarded.headers.getSetCookie()).toEqual(headers.getSetCookie());
  expect(forwarded.headers.get('location')).toBe(origin+'/api/auth/callback/google');
  expect(forwarded.headers.get('retry-after')).toBe('3');
 }
});

function client(ip:string){
 let cookie='';
 const forward=(request:Request)=>onRequest({request,env:{PUPTIME_API:binding}});
 // Test-only browser cookie transport, matching client-api.test.ts. Production
 // iOS retains Better Auth's Expo/SecureStore transport rather than this jar.
 const auth=createAuthClient({baseURL:origin,plugins:[emailOTPClient()],fetchOptions:{customFetchImpl:async(url,init)=>{
  const headers=new Headers(init?.headers);headers.set('origin',origin);headers.set('cf-connecting-ip',ip);if(cookie)headers.set('cookie',cookie);
  const response=await forward(new Request(String(url),{...init,headers,redirect:'manual'}));
  const updates=response.headers.getSetCookie();if(updates.length)cookie=updates.map(value=>value.split(';')[0]).join('; ');
  return response;
 }}});
 const api=createCloudApi(createSdkRequest((url,options)=>auth.$fetch<unknown>(url,options),origin));
 return {api,auth,async login(){
  const email=`pages-${crypto.randomUUID()}@example.invalid`;
  expect((await auth.emailOtp.sendVerificationOtp({email,type:'sign-in'})).error).toBeNull();
  const preview=await env.AUTH_DB.prepare('SELECT code FROM local_email_previews WHERE email=?').bind(email).first<{code:string}>();
  expect(preview).not.toBeNull();expect((await auth.signIn.emailOtp({email,otp:preview!.code})).error).toBeNull();
 },request(path:string,body?:object,extra:Record<string,string>={}){
  return forward(new Request(origin+path,{method:body?'POST':'GET',headers:{origin,'cf-connecting-ip':ip,...(cookie?{cookie}:{}),...(body?{'content-type':'application/json'}:{}),...extra},...(body?{body:JSON.stringify(body)}:{})}));
 }};
}

function nextMessage(socket:WebSocket):Promise<unknown>{
 return new Promise((resolve,reject)=>{
  const timeout=setTimeout(()=>{socket.removeEventListener('message',message);reject(new Error('Expected an account invalidation.'));},3000);
  const message=(event:{data?:unknown})=>{clearTimeout(timeout);socket.removeEventListener('message',message);resolve(JSON.parse(String(event.data)));};
  socket.addEventListener('message',message);
 });
}

test('installed SDK sign-in sync scoped history and WebSocket invalidations work through Pages on the existing auth base',async()=>{
 const user=client('192.0.2.246');
 expect((await user.api.config()).providers.email).toBe(true);
 expect((await user.request('/api/account')).status).toBe(401);
 expect((await user.request('/api/sync/changes',undefined,{upgrade:'websocket'})).status).toBe(401);
 await user.login();
 const account=await user.api.account();expect(account.cloud).toEqual({canSync:true,canExport:true});expect(account.pets).toEqual([]);
 expect(await user.api.enroll({operationId:'pages-enroll',deviceId:'pages-device',localPetId:'pages-pet',name:'Pages puppy'})).toEqual({petId:'pages-pet'});
 expect((await user.request('/api/cloud/enroll',{}, {origin:'https://untrusted.example'})).status).toBe(403);
 expect((await user.request('/api/sync/changes',undefined,{upgrade:'websocket',origin:'https://untrusted.example'})).status).toBe(403);
 const response=await user.request('/api/sync/changes',undefined,{upgrade:'websocket'});
 expect(response.status).toBe(101);expect(response.webSocket).not.toBeNull();
 const socket=response.webSocket!;
 try{
  const initial=nextMessage(socket);socket.accept();expect(await initial).toEqual({protocolVersion:1,cursor:0});
  const id=cloudRecordId('event','pages-pet','活动 /%?#:💩');
  const creation={protocolVersion:1 as const,operationId:'pages-create',deviceId:'pages-device',recordId:id,petId:'pages-pet',kind:'event' as const,baseRevision:0,intent:'create' as const,patch:{type:'pee' as const,at:100,source:'app' as const,note:'First Pages version'}};
  const changed=nextMessage(socket);expect((await user.api.push([creation])).accepted).toHaveLength(1);expect(await changed).toEqual({protocolVersion:1,cursor:1});
  const updated=nextMessage(socket);expect((await user.api.push([{...creation,operationId:'pages-edit',baseRevision:1,intent:'patch',patch:{note:'Second Pages version'}}])).accepted).toHaveLength(1);expect(await updated).toEqual({protocolVersion:1,cursor:2});
  const history=await user.api.history(id);expect(history.revisions.map(revision=>revision.revision)).toEqual([2,1]);
  expect(history.revisions[0].after.data).toMatchObject({note:'Second Pages version'});
  expect((await user.api.history(id,2)).revisions.map(revision=>revision.revision)).toEqual([1]);
  expect((await user.api.pull(0)).changes.at(-1)?.id).toBe(id);
  const other=client('192.0.2.247');await other.login();
  await other.api.enroll({operationId:'pages-other-enroll',deviceId:'pages-other-device',localPetId:'pages-other-pet',name:'Other puppy'});
  expect(await other.api.history(id)).toEqual({revisions:[]});expect((await other.api.pull(0)).changes).toEqual([]);
  expect((await other.auth.signOut()).error).toBeNull();
 }finally{socket.close();}
 expect((await user.auth.signOut()).error).toBeNull();
 await expect(user.api.account()).rejects.toMatchObject({category:'auth-required',status:401});
 expect((await user.request('/api/sync/changes',undefined,{upgrade:'websocket'})).status).toBe(401);
});

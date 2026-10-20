import assert from 'node:assert/strict';
import test from 'node:test';
import {createAuthClient} from 'better-auth/react';
import {Hono} from 'hono';
import type { Mutation } from './protocol.ts';
import * as api from './api.ts';
const config={protocolVersion:1,providers:{apple:false,google:true,email:false}};
const account={user:{id:'account-1',email:'person@example.com',name:'Person'},cloud:{canSync:false,canExport:true},pets:[]};
const event:Mutation={protocolVersion:1,operationId:'op-1',deviceId:'device-1',recordId:'event-1',petId:'pet-1',baseRevision:0,intent:'create',kind:'event',patch:{type:'pee',at:100,source:'app'}};
function client(request:import('./api.ts').CloudRequest) {assert.equal(typeof api.createCloudApi,'function');return api.createCloudApi(request);}

test('cloud base configuration accepts explicit secure origins and development loopback only',()=>{
 assert.equal(typeof api.cloudBaseUrl,'function');
 assert.equal(api.cloudBaseUrl(undefined),null);assert.equal(api.cloudBaseUrl(''),null);
 assert.equal(api.cloudBaseUrl('https://puptime-api-staging.p-ch.workers.dev/'),'https://puptime-api-staging.p-ch.workers.dev');
 for (const value of ['http://example.com','http://127.0.0.1:8787','https://harpapro.com','https://auth.harpapro.com','https://user:secret@example.com','https://example.com/api','https://example.com/?token=secret','https://example.com/#x']) assert.throws(()=>api.cloudBaseUrl(value));
 assert.equal(api.cloudBaseUrl('http://127.0.0.1:8787',true),'http://127.0.0.1:8787');assert.equal(api.cloudBaseUrl('http://localhost:8787',true),'http://localhost:8787');
 assert.throws(()=>api.cloudBaseUrl('http://192.168.1.1:8787',true));
});

test('config and account validate the development access contract without activation requests',async()=>{
 const paths:string[]=[];const cloud=client(async path=>{paths.push(path);return {data:path.endsWith('config')?config:account,error:null};});
 assert.deepEqual(await cloud.config(),config);assert.deepEqual(await cloud.account(),account);assert.equal('startTrial' in cloud,false);
 assert.deepEqual(paths,['/api/config','/api/account']);
 for (const response of [{...config,providers:{...config.providers,email:'yes'}},{...config,protocolVersion:2}]) await assert.rejects(client(async()=>({data:response,error:null})).config(),/invalid-response/);
 for (const response of [{...account,user:{...account.user,id:'bad account'}},{...account,cloud:{...account.cloud,canSync:'yes'}},{...account,pets:[{id:'pet',name:'Pip',eventCount:-1}]}]) await assert.rejects(client(async()=>({data:response,error:null})).account(),/invalid-response/);
});

test('enrollment and pull responses reject mismatched identities, malformed pages and unsafe cursor requests',async()=>{
 const enrollment={operationId:'enroll-1',deviceId:'device-1',localPetId:'pet-1',name:'Pip'};
 assert.deepEqual(await client(async()=>({data:{petId:'pet-1'},error:null})).enroll(enrollment),{petId:'pet-1'});
 await assert.rejects(client(async()=>({data:{petId:'other'},error:null})).enroll(enrollment),/invalid-response/);
 let calls=0;const cloud=client(async path=>{calls++;assert.equal(path,'/api/sync/pull?after=3');return {data:{changes:[],cursor:3,hasMore:false},error:null};});
 assert.deepEqual(await cloud.pull(3),{changes:[],cursor:3,hasMore:false});
 await assert.rejects(cloud.pull(-1));await assert.rejects(cloud.pull(Number.MAX_SAFE_INTEGER+1));assert.equal(calls,1);
 await assert.rejects(client(async()=>({data:{changes:[],cursor:2,hasMore:true},error:null})).pull(0),/invalid-response/);
});

test('push enforces count and escaped UTF8 byte limits before dispatch and validates exact response operation coverage',async()=>{
 let calls=0;const cloud=client(async(path,options)=>{calls++;assert.equal(path,'/api/sync/push');assert.deepEqual(options.body,{mutations:[event]});return {data:{accepted:[],rejected:[{operationId:event.operationId,error:'conflict'}]},error:null};});
 assert.equal((await cloud.push([event])).rejected.length,1);
 await assert.rejects(cloud.push([]));await assert.rejects(cloud.push(Array(51).fill(event)));await assert.rejects(cloud.push([{...event,patch:{...event.patch,note:'\u0001'.repeat(16384)}}]));assert.equal(calls,1);
 for (const response of [{accepted:[],rejected:[]},{accepted:[],rejected:[{operationId:'unknown',error:'conflict'}]},{accepted:[],rejected:[{operationId:event.operationId,error:'conflict'},{operationId:event.operationId,error:'conflict'}]}]) await assert.rejects(client(async()=>({data:response,error:null})).push([event]),/invalid-response/);
});

test('API errors preserve actionable status and bounded retry timing without retaining server contents',async()=>{
 for (const [status,category] of [[401,'auth-required'],[402,'invalid-request'],[403,'forbidden'],[409,'conflict'],[410,'account-deleted'],[429,'rate-limited'],[503,'server-error']] as const) {
  try {await client(async()=>({data:null,error:{status,message:'PRIVATE note token'},retryAfter:'120'})).account();assert.fail('must reject');}
  catch(error) {assert.ok(error instanceof api.CloudApiError);assert.equal(error.status,status);assert.equal(error.category,category);assert.equal(error.retryAfterMs,120000);assert.ok(!JSON.stringify(error).includes('PRIVATE'));assert.ok(!String(error).includes('PRIVATE'));}
 }
 await assert.rejects(client(async()=>{throw new Error('SECRET transport message');}).account(),error=>error instanceof api.CloudApiError&&error.category==='network'&&!String(error).includes('SECRET'));
});

test('Retry-After preserves seconds and HTTP dates up to the platform-safe timer bound',async t=>{
 const now=Date.UTC(2026,9,20,12);t.mock.method(Date,'now',()=>now);
 for(const [header,expected] of [
  ['120',120000],[new Date(now+120000).toUTCString(),120000],
  ['0',0],[new Date(now-120000).toUTCString(),0],
  ['2147483648',2147483647],[new Date(now+2147484000).toUTCString(),2147483647],
  ['not-a-date',null],['9'.repeat(400),null],
 ] as const)await assert.rejects(client(async()=>({data:null,error:{status:429},retryAfter:header})).config(),error=>error instanceof api.CloudApiError&&error.retryAfterMs===expected);
});

test('aborted calls never dispatch and late responses cannot become usable account results',async()=>{
 const controller=new AbortController();controller.abort();let calls=0;
 await assert.rejects(client(async()=>{calls++;return {data:account,error:null};}).account(controller.signal),/abort/i);assert.equal(calls,0);
 const late=new AbortController();await assert.rejects(client(async()=>{late.abort();return {data:account,error:null};}).account(late.signal),/abort/i);
});

test('SDK request adapter fixes the credential origin, disables redirects and SDK retries, and receives rotation hooks',async()=>{
 assert.equal(typeof api.createSdkRequest,'function');
 const controller=new AbortController();let calls=0;
 const request=api.createSdkRequest(async(url,options)=>{calls++;assert.equal(url,'https://puptime.test/api/account');assert.equal(options.redirect,'error');assert.equal(options.retry,0);assert.equal(options.credentials,'omit');assert.equal(options.timeout,15000);assert.equal(options.signal,controller.signal);options.onResponse({response:new Response('{}',{headers:{'retry-after':'3','set-cookie':'better-auth.session_token=PRIVATE'}})});return {data:account,error:null};},'https://puptime.test');
 assert.deepEqual(await request('/api/account',{method:'GET',signal:controller.signal}),{data:account,error:null,retryAfter:'3'});
 for(const path of ['https://other.example/api/account','//other.example/api/account','/api/../private','/api/auth/get-session','/api/account?url=https://other.example','/api/cloud/trial']) await assert.rejects(request(path,{method:'GET'}));
 await assert.rejects(request('/api/cloud/trial',{method:'POST',body:{}}),error=>error instanceof api.CloudApiError&&error.category==='invalid-request');
 assert.equal(calls,1);
});

test('the installed auth SDK delivers canonical history identities and cursors to the server route without double encoding',async()=>{
 const histories=new Map<string,import('./protocol.ts').Revision[]>();
 for(const localId of ['one','a'.repeat(200)+' /%?#:💩']){
  const id=JSON.stringify(['event','pet-1',localId]);
  const before={id,petId:'pet-1',kind:'event' as const,revision:1,sequence:1,deleted:false,updatedAt:1000,data:{type:'pee' as const,at:100,source:'app' as const,note:'First'}};
  const after={...before,revision:2,sequence:2,updatedAt:2000,data:{...before.data,note:'Second'}};
  histories.set(id,[
   {recordId:id,revision:2,sequence:2,operationId:'op-2',deviceId:'device-1',acceptedAt:2000,baseRevision:1,intent:'patch',proposal:{note:'Second'},before,after,reason:'updated'},
   {recordId:id,revision:1,sequence:1,operationId:'op-1',deviceId:'device-1',acceptedAt:1000,baseRevision:0,intent:'create',proposal:before.data,before:null,after:before,reason:'created'},
  ]);
 }
 const received:{id:string;before:number}[]=[];
 const server=new Hono().get('/api/records/:id/history',context=>{
  const id=context.req.param('id'),before=Number(context.req.query('beforeRevision')??Number.MAX_SAFE_INTEGER);
  received.push({id,before});
  return context.json({revisions:(histories.get(id)??[]).filter(revision=>revision.revision<before).slice(0,1)});
 });
 const urls:string[]=[];
 const auth=createAuthClient({baseURL:'https://puptime.test',fetchOptions:{customFetchImpl:async(input,init)=>{
  const request=new Request(input,init);urls.push(request.url);
  assert.equal(new URL(request.url).origin,'https://puptime.test');
  return server.fetch(request);
 }}});
 const cloud=client(api.createSdkRequest((url,options)=>auth.$fetch(url,options),'https://puptime.test'));
 for(const [id,revisions] of histories){
  assert.deepEqual(await cloud.history(id),{revisions:[revisions[0]]});
  assert.deepEqual(await cloud.history(id,2),{revisions:[revisions[1]]});
  assert.deepEqual(received.splice(0),[{id,before:Number.MAX_SAFE_INTEGER},{id,before:2}]);
  assert.equal(urls.shift(),'https://puptime.test/api/records/'+encodeURIComponent(id)+'/history');
  assert.equal(urls.shift(),'https://puptime.test/api/records/'+encodeURIComponent(id)+'/history?beforeRevision=2');
 }
});


test('configuration and access reject obsolete billing fields rather than retaining a legacy wire contract',async()=>{
 for(const extra of [{trialDays:14},{pricingFinalized:false},{unexpected:true}])await assert.rejects(client(async()=>({data:{...config,...extra},error:null})).config(),error=>error instanceof api.CloudApiError&&error.category==='invalid-response');
 for(const extra of [{source:'trial'},{source:'paid'},{expiresAt:null},{unexpected:true}])await assert.rejects(client(async()=>({data:{...account,cloud:{...account.cloud,...extra}},error:null})).account(),error=>error instanceof api.CloudApiError&&error.category==='invalid-response');
 for(const canSync of [false,true])for(const canExport of [false,true]){
  const expected={...account,cloud:{canSync,canExport}};
  assert.deepEqual(await client(async()=>({data:expected,error:null})).account(),expected);
 }
});
test('installed React Native abort signals support requests and cancellation without throwIfAborted',async()=>{
 const {AbortController:NativeController}=await import('abort-controller');const native=new NativeController();
 const signal=native.signal as unknown as AbortSignal;assert.equal(typeof signal.throwIfAborted,'undefined');
 let calls=0;
 const request=api.createSdkRequest(async()=>{calls++;return {data:account,error:null};},'https://puptime.test');
 const cloud=client(request);assert.deepEqual(await cloud.account(signal),account);assert.equal(calls,1);
 native.abort();await assert.rejects(cloud.account(signal),error=>error instanceof Error&&error.name==='AbortError');assert.equal(calls,1);
});

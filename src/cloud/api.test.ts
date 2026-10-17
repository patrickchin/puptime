import assert from 'node:assert/strict';
import test from 'node:test';
import type { Mutation } from './protocol.ts';
import * as api from './api.ts';
const config={protocolVersion:1,trialDays:14,providers:{apple:false,google:true,email:false},pricingFinalized:false};
const account={user:{id:'account-1',email:'person@example.com',name:'Person'},cloud:{canSync:false,canExport:true,source:'none',expiresAt:null},pets:[]};
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

test('config, account and explicit trial responses validate all data without performing other actions',async()=>{
 const paths:string[]=[];const cloud=client(async path=>{paths.push(path);return {data:path.endsWith('config')?config:path.endsWith('trial')?{cloud:account.cloud}:account,error:null};});
 assert.deepEqual(await cloud.config(),config);assert.deepEqual(await cloud.account(),account);assert.deepEqual(await cloud.startTrial(),{cloud:account.cloud});
 assert.deepEqual(paths,['/api/config','/api/account','/api/cloud/trial']);
 for (const response of [{...config,providers:{...config.providers,email:'yes'}},{...config,protocolVersion:2}]) await assert.rejects(client(async()=>({data:response,error:null})).config(),/invalid-response/);
 for (const response of [{...account,user:{...account.user,id:'bad account'}},{...account,cloud:{...account.cloud,canSync:true}},{...account,pets:[{id:'pet',name:'Pip',eventCount:-1}]}]) await assert.rejects(client(async()=>({data:response,error:null})).account(),/invalid-response/);
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
 for (const [status,category] of [[401,'auth-required'],[402,'expired'],[403,'forbidden'],[409,'conflict'],[410,'account-deleted'],[429,'rate-limited'],[503,'server-error']] as const) {
  try {await client(async()=>({data:null,error:{status,message:'PRIVATE note token'},retryAfter:'120'})).account();assert.fail('must reject');}
  catch(error) {assert.ok(error instanceof api.CloudApiError);assert.equal(error.status,status);assert.equal(error.category,category);assert.equal(error.retryAfterMs,60000);assert.ok(!JSON.stringify(error).includes('PRIVATE'));assert.ok(!String(error).includes('PRIVATE'));}
 }
 await assert.rejects(client(async()=>{throw new Error('SECRET transport message');}).account(),error=>error instanceof api.CloudApiError&&error.category==='network'&&!String(error).includes('SECRET'));
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
 for(const path of ['https://other.example/api/account','//other.example/api/account','/api/../private','/api/auth/get-session','/api/account?url=https://other.example']) await assert.rejects(request(path,{method:'GET'}));
 assert.equal(calls,1);
});


test('trial duration is validated configuration and legacy staging defaults to its verified fourteen days',async()=>{
 const {trialDays,...legacy}=config;
 assert.equal((await client(async()=>({data:legacy,error:null})).config()).trialDays,14);
 assert.equal((await client(async()=>({data:{...config,trialDays:21},error:null})).config()).trialDays,21);
 await assert.rejects(client(async()=>({data:{...config,trialDays:0},error:null})).config(),/invalid-response/);
});
test('installed React Native abort signals support requests and cancellation without throwIfAborted',async()=>{
 const {AbortController:NativeController}=await import('abort-controller');const native=new NativeController();
 const signal=native.signal as unknown as AbortSignal;assert.equal(typeof signal.throwIfAborted,'undefined');
 let calls=0;
 const request=api.createSdkRequest(async()=>{calls++;return {data:account,error:null};},'https://puptime.test');
 const cloud=client(request);assert.deepEqual(await cloud.account(signal),account);assert.equal(calls,1);
 native.abort();await assert.rejects(cloud.account(signal),error=>error instanceof Error&&error.name==='AbortError');assert.equal(calls,1);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {createAuthClient} from 'better-auth/react';
import {CloudApiError,type CloudErrorCategory} from './api.ts';
import {createAccountLifecycleClient} from './account-lifecycle.ts';

const origin='https://puptime.test',owner='owner-1';
const receipt=Buffer.alloc(32,1).toString('base64url');
const intent='759182e2-e754-459e-bf99-bf5f3732b522';
const session={user:{id:owner,email:'person@example.com',name:'Person'},session:{id:'session-1',createdAt:'2026-10-20T00:00:00.000Z',expiresAt:'2026-10-21T00:00:00.000Z'}};
type Client=Parameters<typeof createAccountLifecycleClient>[0];
type Options=Parameters<Client['fetch']>[1];
function requestOptions(options:Options){const {signal,onResponse,...request}=options;assert.ok(signal);assert.equal(typeof onResponse,'function');return request;}
function fixture(respond:(path:string,options:Options)=>Promise<{data:unknown;error:{status:number}|null}>|{data:unknown;error:{status:number}|null}){
 const calls:{path:string;options:Options}[]=[];
 const client=createAccountLifecycleClient({fetch:async(path,options)=>{calls.push({path,options});return respond(path,options);},social:async()=>{assert.fail('Unexpected social signup');}},origin);
 return {client,calls};
}
const succeeds=(data:unknown)=>({data,error:null});
const hasError=(category:CloudErrorCategory,status?:number)=>(error:unknown)=>error instanceof CloudApiError&&error.category===category&&(status===undefined||error.status===status)&&!String(error).includes('PRIVATE');

function sdkFixture(responseBody:unknown,{status=200,raw=false,browser,beforeResponse}: {status?:number;raw?:boolean;browser?:()=>Promise<void>;beforeResponse?:()=>Promise<void>}={}){
 const order:string[]=[],cookies:string[]=[],calls:{url:string;options:RequestInit}[]=[];
 let original:Response|undefined,browserCalls=0;
 const auth=createAuthClient({baseURL:origin,fetchOptions:{retry:0,redirect:'error',credentials:'omit',timeout:15000,customFetchImpl:async(input,options)=>{
  calls.push({url:String(input),options:options??{}});order.push('request');
  await beforeResponse?.();
  original=new Response(raw?String(responseBody):JSON.stringify(responseBody),{status,headers:{'content-type':'application/json','set-cookie':'better-auth.oauth_state=synthetic-state; HttpOnly; Secure','x-response-proof':'original'}});
  return original;
 }},plugins:[{id:'native-hook-proof',fetchPlugins:[{id:'native-hook-proof',name:'Native cookie and browser hook ordering',hooks:{
  onResponse(context:{response:Response}){order.push('plugin-response');assert.equal(context.response,original);assert.equal(context.response.bodyUsed,false);},
  async onSuccess(context:{response:Response;data:unknown}){
   order.push('cookie-hook');assert.equal(context.response,original);assert.equal(context.response.headers.get('x-response-proof'),'original');assert.deepEqual(context.data,responseBody);
   cookies.push(context.response.headers.get('set-cookie')!);
   // Expo's installed plugin opens its browser from this same onSuccess phase.
   order.push('browser');browserCalls++;await browser?.();
  },
 } }]}]});
 const client=createAccountLifecycleClient({fetch:(path,options)=>auth.$fetch<unknown>(path,options),social:(body,options)=>auth.signIn.social(body,options)},origin);
 return {client,calls,order,cookies,get browserCalls(){return browserCalls;}};
}

test('installed SDK refuses an ordinary or malformed successful social response before any cookie/browser success hook',async()=>{
 for(const [data,raw] of [[{url:'https://accounts.example/ordinary-signup',redirect:true},false],[{reauthIntentId:'not-a-uuid',redirect:true},false],[null,false],['PRIVATE malformed response',true]] as const){
  const sdk=sdkFixture(data,{raw});let starts=0;
  await assert.rejects(sdk.client.reauthenticate(owner,'google',()=>{starts++;}),hasError('invalid-response'));
  assert.equal(starts,0);assert.equal(sdk.browserCalls,0);assert.deepEqual(sdk.cookies,[]);assert.deepEqual(sdk.order,['request']);assert.equal(sdk.calls.length,1);
 }
});

test('a cancelled initiation can reject its late guarded intent before the installed SDK opens any browser',async()=>{
 let reply!:()=>void,entered!:()=>void;const waiting=new Promise<void>(resolve=>{entered=resolve;}),response=new Promise<void>(resolve=>{reply=resolve;});
 const sdk=sdkFixture({reauthIntentId:intent,url:'https://accounts.example/guarded',redirect:true},{beforeResponse:async()=>{entered();await response;}});
 let accepted=true;
 const pending=sdk.client.reauthenticate(owner,'google',()=>{sdk.order.push(accepted?'accepted':'cancelled');return accepted;});
 const rejected=assert.rejects(pending);
 await waiting;accepted=false;reply();
 await rejected;assert.equal(sdk.browserCalls,0);assert.deepEqual(sdk.cookies,[]);assert.deepEqual(sdk.order,['request','cancelled']);assert.equal(sdk.calls.length,1);
});

test('installed SDK announces guarded reauthentication before preserved cookie and browser hooks, and waits for the browser',async()=>{
 for(const provider of ['apple','google'] as const){
  let closeBrowser!:()=>void;
  const browserClosed=new Promise<void>(resolve=>{closeBrowser=resolve;});
  let enteredBrowser!:()=>void;
  const browserEntered=new Promise<void>(resolve=>{enteredBrowser=resolve;});
  const response={reauthIntentId:intent,url:'https://accounts.example/guarded',redirect:true};
  const sdk=sdkFixture(response,{browser:async()=>{enteredBrowser();await browserClosed;}});
  let settled=false;
  const pending=sdk.client.reauthenticate(owner,provider,value=>{assert.equal(value,intent);sdk.order.push('started');}).then(value=>{settled=true;return value;});
  await browserEntered;
  assert.equal(settled,false);assert.deepEqual(sdk.order,['request','started','plugin-response','cookie-hook','browser']);
  assert.equal(sdk.browserCalls,1);assert.deepEqual(sdk.cookies,['better-auth.oauth_state=synthetic-state; HttpOnly; Secure']);
  const [call]=sdk.calls;assert.equal(call.url,origin+'/api/auth/sign-in/social');assert.equal(call.options.method,'POST');assert.equal(call.options.redirect,'error');
  assert.deepEqual(JSON.parse(String(call.options.body)),{provider,callbackURL:'puptime://account',errorCallbackURL:'puptime://account'});
  const headers=new Headers(call.options.headers);assert.equal(headers.get('x-puptime-account'),owner);assert.equal(headers.get('x-puptime-reauth'),'account-deletion');
  closeBrowser();assert.equal(await pending,intent);assert.equal(sdk.calls.length,1);
 }
});

test('a guarded HTTP failure never announces or opens reauthentication, and preserves only its safe status',async()=>{
 for(const [status,category] of [[401,'auth-required'],[403,'forbidden'],[409,'conflict'],[429,'rate-limited'],[503,'server-error']] as const){
  const sdk=sdkFixture({message:'PRIVATE server details'},{status});let starts=0;
  await assert.rejects(sdk.client.reauthenticate(owner,'apple',()=>{starts++;}),hasError(category,status));
  assert.equal(starts,0);assert.equal(sdk.browserCalls,0);assert.deepEqual(sdk.cookies,[]);assert.equal(sdk.calls.length,1);
 }
});

test('identity accepts actual SDK Date values, ISO strings and millisecond dates while dropping credentials and unrelated fields',async()=>{
 const created=Date.parse(session.session.createdAt),expires=Date.parse(session.session.expiresAt);
 for(const [createdAt,expiresAt] of [[session.session.createdAt,session.session.expiresAt],[new Date(created),new Date(expires)],[created,expires]]){
  const {client,calls}=fixture(()=>succeeds({...session,user:{...session.user,private:'PRIVATE'},session:{...session.session,createdAt,expiresAt,token:'PRIVATE'},cookie:'PRIVATE'}));
  assert.deepEqual(await client.identity(),{user:session.user,session:{id:'session-1',createdAt:created,expiresAt:expires}});
  assert.deepEqual(calls.map(call=>({...call,options:requestOptions(call.options)})),[{path:origin+'/api/auth/get-session',options:{method:'GET',credentials:'omit',redirect:'error',retry:0,timeout:15000}}]);
 }
 assert.equal(await fixture(()=>succeeds(null)).client.identity(),null);
 for(const data of [{...session,session:{...session.session,createdAt:'not-a-date'}},{...session,session:{...session.session,expiresAt:-1}},{...session,user:{...session.user,id:'bad owner'}},{...session,user:{...session.user,email:'invalid'}},{...session,session:{...session.session,id:undefined}}]){
  await assert.rejects(fixture(()=>succeeds(data)).client.identity(),hasError('invalid-response'));
 }
});

test('email reauthentication derives its address from the current original owner and refuses missing or switched sessions',async()=>{
 const {client,calls}=fixture(path=>succeeds(path.endsWith('/get-session')?session:{success:true}));
 await client.requestEmail(owner);
 assert.deepEqual(calls.map(call=>({path:call.path,method:call.options.method,body:call.options.body})),[
  {path:origin+'/api/auth/get-session',method:'GET',body:undefined},
  {path:origin+'/api/auth/email-otp/send-verification-otp',method:'POST',body:{email:'person@example.com',type:'sign-in'}},
 ]);
 for(const [data,category] of [[null,'auth-required'],[{...session,user:{...session.user,id:'other-owner'}},'conflict']] as const){
  const denied=fixture(()=>succeeds(data));await assert.rejects(denied.client.requestEmail(owner),hasError(category));
  assert.deepEqual(denied.calls.map(call=>call.path),[origin+'/api/auth/get-session']);
 }
});

test('email codes use only the guarded owner-bound reauthentication endpoint and reject an account mismatch',async()=>{
 const {client,calls}=fixture(()=>succeeds({user:{id:owner,email:'PRIVATE'}}));
 await client.verifyEmail(owner,'123456');
 assert.equal(calls.length,1);assert.equal(calls[0].path,origin+'/api/account/reauth');assert.deepEqual(calls[0].options.body,{otp:'123456'});assert.deepEqual(calls[0].options.headers,{'x-puptime-account':owner});
 for(const code of ['12345','1234567',' 123456','abcdef'])await assert.rejects(client.verifyEmail(owner,code),hasError('invalid-request',400));
 assert.equal(calls.length,1);
 await assert.rejects(fixture(()=>succeeds({user:{id:'other-owner'}})).client.verifyEmail(owner,'123456'),hasError('invalid-response'));
});

test('preparation, explicit deletion and receipt-only status stay distinct fixed-origin SDK operations',async()=>{
 const {client,calls}=fixture(path=>succeeds(path.endsWith('/prepare')?{receipt,expiresAt:12345}:path.endsWith('/status')?{status:'deleted',appleRevocation:'manual'}:{success:true,message:'User deleted',appleRevocation:'manual',private:'PRIVATE'}));
 assert.deepEqual(await client.prepare(owner),{receipt,expiresAt:12345});
 assert.deepEqual(await client.remove(owner,receipt),{success:true,appleRevocation:'manual'});
 assert.deepEqual(await client.status(receipt),{status:'deleted',appleRevocation:'manual'});
 assert.deepEqual(calls.map(call=>({...call,options:requestOptions(call.options)})),[
  {path:origin+'/api/account/deletion/prepare',options:{method:'POST',body:{},headers:{'x-puptime-account':owner},credentials:'omit',redirect:'error',retry:0,timeout:15000}},
  {path:origin+'/api/account',options:{method:'DELETE',body:{confirm:true,receipt},headers:{'x-puptime-account':owner},credentials:'omit',redirect:'error',retry:0,timeout:60000}},
  {path:origin+'/api/account/deletion/status',options:{method:'POST',body:{receipt},credentials:'omit',redirect:'error',retry:0,timeout:15000}},
 ]);
});

test('installed SDK never retries deletion or falls back to another account or endpoint after a failed or lost response',async()=>{
 for(const failure of [401,409,429,503,'lost'] as const){
  const calls:string[]=[];
  const auth=createAuthClient({baseURL:origin,fetchOptions:{retry:3,customFetchImpl:async(input,options)=>{
   calls.push(String(input));assert.equal(options?.method,'DELETE');assert.equal(options?.redirect,'error');assert.equal(options?.credentials,'omit');
   if(failure==='lost')throw new Error('PRIVATE response lost after deletion');
   return new Response(JSON.stringify({message:'PRIVATE details'}),{status:failure,headers:{'content-type':'application/json'}});
  }}});
  const client=createAccountLifecycleClient({fetch:(path,options)=>auth.$fetch<unknown>(path,options),social:async()=>{assert.fail('Unexpected signup fallback');}},origin,{requestTimeoutMs:25,deletionTimeoutMs:25});
  await assert.rejects(client.remove(owner,receipt),hasError(failure==='lost'?'network':failure===401?'auth-required':failure===409?'conflict':failure===429?'rate-limited':'server-error',failure==='lost'?undefined:failure));
  assert.deepEqual(calls,[origin+'/api/account']);
 }
});

for(const [operation,status] of [['delete',200],['delete',503],['status',200]] as const)test(`the full ${operation} deadline aborts a stalled ${status} JSON body after headers without a success hook`,async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 let stream:ReadableStreamDefaultController<Uint8Array>|undefined,requestSignal:AbortSignal|undefined,successes=0,settled=false,error:unknown,calls=0;
 const auth=createAuthClient({baseURL:origin,fetchOptions:{customFetchImpl:async(_input,options)=>{
  calls++;requestSignal=options?.signal??undefined;assert.ok(requestSignal);
  return new Response(new ReadableStream<Uint8Array>({start(controller){stream=controller;controller.enqueue(new TextEncoder().encode('{"success":'));requestSignal!.addEventListener('abort',()=>controller.error(new Error('Synthetic aborted body')),{once:true});}}),{status,headers:{'content-type':'application/json','set-cookie':'better-auth.session_token=must-not-persist'}});
 }},plugins:[{id:'body-success-proof',fetchPlugins:[{id:'body-success-proof',name:'Body success proof',hooks:{onSuccess(){successes++;}}}]}]});
 const client=createAccountLifecycleClient({fetch:(path,options)=>auth.$fetch<unknown>(path,options),social:async()=>assert.fail('No social fallback')},origin);
 const pending=(operation==='delete'?client.remove(owner,receipt):client.status(receipt)).then(()=>{settled=true;},failure=>{settled=true;error=failure;});
 try{
  await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(settled,false);assert.equal(calls,1);
  t.mock.timers.tick(60001);await new Promise<void>(resolve=>setImmediate(resolve));
  assert.equal(settled,true,'Headers must not end the complete JSON response deadline.');assert.ok(hasError('network')(error));assert.equal(requestSignal?.aborted,true);assert.equal(successes,0);assert.equal(calls,1);
 }finally{try{stream?.error(new Error('Test cleanup'));}catch{}await pending;t.mock.timers.reset();}
});

test('a guarded initiation deadline ends before waiting for the person to finish the native browser',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let entered!:()=>void,finish!:()=>void;
 const enteredBrowser=new Promise<void>(resolve=>{entered=resolve;}),finishedBrowser=new Promise<void>(resolve=>{finish=resolve;});
 const sdk=sdkFixture({reauthIntentId:intent,url:'https://accounts.example/guarded',redirect:true},{browser:async()=>{entered();await finishedBrowser;}});
 const pending=sdk.client.reauthenticate(owner,'google',()=>true);
 try{await enteredBrowser;t.mock.timers.tick(60001);assert.equal(sdk.calls[0].options.signal?.aborted,false);finish();assert.equal(await pending,intent);assert.equal(sdk.browserCalls,1);}
 finally{finish();await pending.catch(()=>{});t.mock.timers.reset();}
});

test('an oversized streamed lifecycle reply is rejected before credential success hooks without retaining its private body',async()=>{
 let successes=0,calls=0;const bytes=new TextEncoder().encode(JSON.stringify({success:true,appleRevocation:'manual',private:'PRIVATE'.repeat(12000)}));
 const auth=createAuthClient({baseURL:origin,fetchOptions:{customFetchImpl:async()=>{calls++;let offset=0;return new Response(new ReadableStream<Uint8Array>({pull(controller){if(offset>=bytes.length)controller.close();else{controller.enqueue(bytes.slice(offset,offset+8192));offset+=8192;}}}),{headers:{'content-type':'application/json','set-cookie':'better-auth.session_token=must-not-persist'}});}},plugins:[{id:'large-body-proof',fetchPlugins:[{id:'large-body-proof',name:'Large body proof',hooks:{onSuccess(){successes++;}}}]}]});
 const client=createAccountLifecycleClient({fetch:(path,options)=>auth.$fetch<unknown>(path,options),social:async()=>assert.fail('No social fallback')},origin);
 await assert.rejects(client.remove(owner,receipt),hasError('invalid-response'));assert.equal(successes,0);assert.equal(calls,1);
});

test('receipts and complete status responses are validated without treating unknown, pending or malformed data as deletion',async()=>{
 for(const status of ['unknown','pending','not-started'] as const)assert.deepEqual(await fixture(()=>succeeds({status})).client.status(receipt),{status});
 for(const appleRevocation of ['not-linked','revoked','manual'] as const)assert.deepEqual(await fixture(()=>succeeds({status:'deleted',appleRevocation})).client.status(receipt),{status:'deleted',appleRevocation});
 for(const data of [{status:'deleted'},{status:'deleted',appleRevocation:'success'},{status:'pending',appleRevocation:'revoked'},{status:'unknown',user:{id:owner}},{success:true}])await assert.rejects(fixture(()=>succeeds(data)).client.status(receipt),hasError('invalid-response'));
 for(const data of [{receipt:receipt.slice(0,-1)+'B',expiresAt:12345},{receipt,expiresAt:'12345'},{receipt,expiresAt:12345,private:'PRIVATE'}])await assert.rejects(fixture(()=>succeeds(data)).client.prepare(owner),hasError('invalid-response'));
 const {client,calls}=fixture(()=>{assert.fail('Invalid receipt must not dispatch');});
 for(const invalid of ['',receipt+'A',receipt.slice(1),receipt.slice(0,-1)+'B',' '.repeat(43)]){
  await assert.rejects(async()=>client.remove(owner,invalid));await assert.rejects(async()=>client.status(invalid));
 }
 assert.equal(calls.length,0);
});

test('cancellation dismisses the owned browser before the original-owner-bound server cancellation request',async()=>{
 const order:string[]=[];
 const client=createAccountLifecycleClient({dismissBrowser:()=>{order.push('dismiss');},fetch:async(path,options)=>{
  order.push('cancel');assert.equal(path,origin+'/api/account/reauth/cancel');assert.equal(options.method,'POST');assert.deepEqual(options.headers,{'x-puptime-account':owner});assert.deepEqual(options.body,{intentId:intent});return succeeds({success:true});
 },social:async()=>{assert.fail('Unexpected social request');}},origin);
 assert.deepEqual(await client.cancelReauthentication(owner,intent),{success:true});assert.deepEqual(order,['dismiss','cancel']);
});

test('network and HTTP errors expose only actionable categories, never private transport or response details',async()=>{
 for(const [status,category] of [[0,'network'],[400,'invalid-request'],[401,'auth-required'],[402,'expired'],[403,'forbidden'],[409,'conflict'],[410,'account-deleted'],[429,'rate-limited'],[503,'server-error']] as const){
  const {client,calls}=fixture(()=>({data:{message:'PRIVATE'},error:{status}}));await assert.rejects(client.prepare(owner),hasError(category,status));assert.equal(calls.length,1);
 }
 await assert.rejects(fixture(()=>{throw new Error('PRIVATE network response');}).client.identity(),hasError('network'));
 const client=createAccountLifecycleClient({fetch:async()=>succeeds(null),social:async()=>{throw new Error('PRIVATE browser transport');}},origin);
 await assert.rejects(client.reauthenticate(owner,'google',()=>{assert.fail('Failed transport cannot announce initiation');}),hasError('network'));
});

test('unsafe cloud origins are rejected before any SDK operation',()=>{
 for(const value of ['', 'https://harpapro.com','https://auth.harpapro.com','https://puptime.test/api','https://puptime.test/?token=PRIVATE','https://user:PRIVATE@puptime.test','http://elsewhere.test'])assert.throws(()=>createAccountLifecycleClient({fetch:async()=>{assert.fail('Invalid origin must not dispatch');},social:async()=>{assert.fail('Invalid origin must not dispatch');}},value));
});

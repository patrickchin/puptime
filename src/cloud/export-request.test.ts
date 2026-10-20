import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuthClient } from 'better-auth/react';
import { CloudApiError } from './api.ts';
import { createCloudExportRequest } from './export-request.ts';

const origin='https://puptime.test',encoder=new TextEncoder();
const snapshot=JSON.stringify({type:'manifest',format:'puptime-cloud-export',version:1,exportedAt:100,pets:[{id:'pet-1',name:'小狗 🐶',eventCount:0}]})+'\n'+JSON.stringify({type:'complete',cursor:0})+'\n';
function destination(fail=false){
 const chunks:Uint8Array[]=[];let closed=false,aborted=false;
 return {stream:new WritableStream<Uint8Array>({write(value){if(fail)throw new Error('private file path');chunks.push(value.slice());},close(){closed=true;},abort(){aborted=true;}}),get closed(){return closed;},get aborted(){return aborted;},text:()=>Buffer.concat(chunks).toString('utf8')};
}
function exportResponse(raw=snapshot){
 const bytes=encoder.encode(raw);let offset=0;
 const response=new Response(new ReadableStream<Uint8Array>({pull(controller){if(offset===bytes.length)controller.close();else controller.enqueue(bytes.slice(offset,++offset));}}),{headers:{'content-type':'application/x-ndjson; charset=utf-8','set-cookie':'better-auth.session_token=synthetic-renewed; HttpOnly; Secure','x-auth-proof':'retained','content-length':String(bytes.length)}});
 // The original body must only be read as a stream, never as text/blob/JSON.
 for(const method of ['text','json','blob','arrayBuffer'] as const)Object.defineProperty(response,method,{value:()=>{throw new Error('Full export accumulation');}});
 return response;
}
function fixture(fetcher:typeof fetch,output:ReturnType<typeof destination>,timeoutMs=1000){
 let successes=0;const cookies:string[]=[];
 const auth=createAuthClient({baseURL:origin,fetchOptions:{customFetchImpl:fetcher},plugins:[{id:'cookie-hook-proof',fetchPlugins:[{id:'cookie-hook-proof',name:'Cookie persistence proof',hooks:{onSuccess(context:{response:Response;data:unknown}){
  assert.equal(output.closed,true);assert.deepEqual(context.data,{complete:true});assert.equal(context.response.headers.get('x-auth-proof'),'retained');assert.equal(context.response.headers.get('content-length'),null);
  cookies.push(context.response.headers.get('set-cookie')!);successes++;
 }}}]}]});
 return {request:createCloudExportRequest((url,options)=>auth.$fetch<unknown>(url,options),origin,timeoutMs),cookies,get successes(){return successes;}};
}

test('the installed SDK POST is fixed-origin, account-bound and streaming, with cookies delivered after file completion',async()=>{
 const output=destination();let signal:AbortSignal|undefined;
 const external=new AbortController();
 const client=fixture(async(input,init)=>{
  assert.equal(String(input),origin+'/api/account/export');assert.equal(init?.method,'POST');assert.equal(init?.credentials,'omit');assert.equal(init?.redirect,'error');
  assert.equal(new Headers(init?.headers).get('content-type'),'application/x-www-form-urlencoded');assert.equal(String(init?.body),'expectedAccount=owner-1');
  signal=init?.signal??undefined;assert.ok(signal);assert.notEqual(signal,external.signal);
  const response=exportResponse();response.headers.append('set-cookie','better-auth.other=synthetic-second; Secure');return response;
 },output,100);
 await client.request('owner-1',output.stream,external.signal);
 assert.equal(output.text(),snapshot);assert.equal(output.closed,true);assert.equal(client.successes,1);assert.match(client.cookies[0],/synthetic-renewed/);assert.match(client.cookies[0],/synthetic-second/);
 external.abort();await new Promise(resolve=>setTimeout(resolve,125));assert.equal(signal!.aborted,false);
});

test('malformed/truncated streams and disk failure never reach success or a share continuation',async()=>{
 for(const [raw,fail] of [[snapshot.split('\n')[0]+'\n',false],[snapshot,true],['private malformed payload',false]] as const){
  const output=destination(fail),client=fixture(async()=>exportResponse(raw),output);let shared=false;
  await assert.rejects(client.request('owner-1',output.stream).then(()=>{shared=true;}),error=>error instanceof CloudApiError&&error.category==='invalid-response'&&!String(error).includes('private'));
  assert.equal(shared,false);assert.equal(output.closed,false);assert.equal(client.successes,0);
 }
});

test('HTTP errors map existing cloud categories without parsing private response bodies',async()=>{
 for(const [status,category] of [[400,'invalid-request'],[401,'auth-required'],[402,'invalid-request'],[403,'forbidden'],[409,'conflict'],[410,'account-deleted'],[429,'rate-limited'],[503,'server-error']] as const){
  const output=destination();let cancelled=false;
  const client=fixture(async()=>new Response(new ReadableStream({cancel(){cancelled=true;}}),{status}),output);
  await assert.rejects(client.request('owner-1',output.stream),error=>error instanceof CloudApiError&&error.category===category&&error.status===status);
  assert.equal(cancelled,true);assert.equal(output.closed,false);assert.equal(client.successes,0);
 }
});

test('whole-body timeout cancels a source after headers and does not create a shareable export',async()=>{
 const output=destination();let cancelled=false;
 const client=fixture(async()=>new Response(new ReadableStream<Uint8Array>({start(controller){controller.enqueue(encoder.encode(snapshot.split('\n')[0]+'\n'));},cancel(){cancelled=true;}}),{headers:{'content-type':'application/x-ndjson'}}),output,20);
 await assert.rejects(client.request('owner-1',output.stream),error=>error instanceof CloudApiError&&error.category==='network');
 assert.equal(cancelled,true);assert.equal(output.aborted,true);assert.equal(output.closed,false);assert.equal(client.successes,0);
});

test('whole-request timeout also covers stalled headers and redacts network failures',async()=>{
 const output=destination();let calls=0;
 const client=fixture(async(_input,init)=>{calls++;return new Promise<Response>((_resolve,reject)=>{init!.signal!.addEventListener('abort',()=>reject(new Error('private credential transport')),{once:true});});},output,20);
 await assert.rejects(client.request('owner-1',output.stream),error=>error instanceof CloudApiError&&error.category==='network'&&!String(error).includes('private'));
 assert.equal(calls,1);assert.equal(client.successes,0);
});

test('external cancellation prevents dispatch and aborts an active body without being recategorized as network failure',async()=>{
 const early=new AbortController();early.abort();let calls=0;
 const output=destination(),client=fixture(async()=>{calls++;return exportResponse();},output);
 await assert.rejects(client.request('owner-1',output.stream,early.signal),{name:'AbortError'});assert.equal(calls,0);
 const later=new AbortController(),activeOutput=destination();let cancelled=false,started!:()=>void;
 const bodyStarted=new Promise<void>(resolve=>{started=resolve;});
 const active=fixture(async()=>new Response(new ReadableStream<Uint8Array>({start(controller){controller.enqueue(encoder.encode(snapshot.split('\n')[0]+'\n'));started();},cancel(){cancelled=true;}}),{headers:{'content-type':'application/x-ndjson'}}),activeOutput);
 const pending=active.request('owner-1',activeOutput.stream,later.signal);await bodyStarted;later.abort();
 await assert.rejects(pending,{name:'AbortError'});assert.equal(cancelled,true);assert.equal(active.successes,0);
});

test('unsafe origins and malformed owner identifiers fail before SDK dispatch',async()=>{
 const output=destination();let calls=0;const fetcher=async()=>{calls++;return {data:null,error:null};};
 for(const value of ['https://elsewhere.test/api','https://harpapro.com','https://puptime.test/?secret=1','https://name:password@puptime.test'])assert.throws(()=>createCloudExportRequest(fetcher,value));
 await assert.rejects(createCloudExportRequest(fetcher,origin)('bad owner',output.stream),error=>error instanceof CloudApiError&&error.category==='invalid-request');assert.equal(calls,0);
});

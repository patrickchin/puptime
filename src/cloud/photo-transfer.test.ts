import assert from 'node:assert/strict';
import test from 'node:test';
import {createAuthClient} from 'better-auth/react';
import {createPhotoTransfer} from './photo-transfer.ts';
import {CloudApiError} from './api.ts';
const origin='https://puptime.test',id='img_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',bytes=new Uint8Array([255,216,255,219,0,255,217]);

test('SDK photo transfer sends raw JPEG bytes, fences the account and preserves auth response hooks',async()=>{
 let successes=0,cookie='';
 const auth=createAuthClient({baseURL:origin,fetchOptions:{customFetchImpl:async(input,init)=>{
  assert.equal(new Headers(init?.headers).get('x-puptime-account'),'owner-1');
  if(init?.method==='POST'){
   assert.equal(String(input),`${origin}/api/photos/pet-1/${id}`);
   assert.equal(new Headers(init.headers).get('content-type'),'image/jpeg');
   assert.deepEqual(new Uint8Array(await new Response(init.body).arrayBuffer()),bytes);
   return Response.json({photoId:id});
  }
  return new Response(bytes,{headers:{'content-type':'image/jpeg','set-cookie':'session=renewed; Secure'}});
 },plugins:[{id:'observe',name:'Observe photo transport',hooks:{onSuccess:async context=>{successes++;cookie=context.response.headers.get('set-cookie')??cookie;}}}]}});
 const transfer=createPhotoTransfer((url,options)=>auth.$fetch<unknown>(url,options),origin),signal=new AbortController().signal;
 await transfer.upload(id,'pet-1','owner-1',new Blob([bytes]),signal);
 assert.deepEqual(await transfer.download(id,'owner-1',signal),bytes);
 assert.equal(successes,2);assert.equal(cookie,'session=renewed; Secure');
});

test('downloads reject oversized or malformed images and preserve missing-file and cancellation semantics',async()=>{
 for(const response of [new Response('bad',{headers:{'content-type':'image/jpeg'}}),new Response(new Uint8Array(256*1024+1),{headers:{'content-type':'image/jpeg'}}),new Response(bytes,{headers:{'content-type':'text/html'}})]){
  const auth=createAuthClient({baseURL:origin,fetchOptions:{customFetchImpl:async()=>response}}),transfer=createPhotoTransfer((url,options)=>auth.$fetch<unknown>(url,options),origin);
  await assert.rejects(transfer.download(id,'owner-1',new AbortController().signal),error=>error instanceof CloudApiError&&error.category==='invalid-response');
 }
 const auth=createAuthClient({baseURL:origin,fetchOptions:{customFetchImpl:async()=>new Response('',{status:404})}}),transfer=createPhotoTransfer((url,options)=>auth.$fetch<unknown>(url,options),origin);
 assert.equal(await transfer.download(id,'owner-1',new AbortController().signal),null);
 const abort=new AbortController();abort.abort();await assert.rejects(transfer.download(id,'owner-1',abort.signal),{name:'AbortError'});
});


test('the photo timeout covers a stalled response body after headers',async()=>{
 let cancelled=false;
 const auth=createAuthClient({baseURL:origin,fetchOptions:{customFetchImpl:async()=>new Response(new ReadableStream<Uint8Array>({start(controller){controller.enqueue(bytes);},cancel(){cancelled=true;}}),{headers:{'content-type':'image/jpeg'}})}});
 const transfer=createPhotoTransfer((url,options)=>auth.$fetch<unknown>(url,options),origin,20);
 await assert.rejects(transfer.download(id,'owner-1',new AbortController().signal),error=>error instanceof CloudApiError&&error.category==='network');
 assert.equal(cancelled,true);
});

test('photo diagnostics retain actual HTTP failures and validation status without image or identity data',async()=>{
 const events:import('./sync-diagnostics.ts').CloudDiagnosticInput[]=[];
 const auth=createAuthClient({baseURL:origin,fetchOptions:{customFetchImpl:async()=>Response.json({message:'PRIVATE_RESPONSE'},{status:400})}});
 const transfer=createPhotoTransfer((url,options)=>auth.$fetch<unknown>(url,options),origin,15000,entry=>events.push(entry));
 await assert.rejects(transfer.upload(id,'pet-PRIVATE','owner-PRIVATE',new Blob([bytes]),new AbortController().signal),error=>error instanceof CloudApiError&&error.status===400);
 assert.equal(events[0].route,'photo-upload');assert.equal(events[0].status,400);assert.equal(events[0].category,'invalid-request');
 assert.ok(!JSON.stringify(events).includes('PRIVATE'));assert.ok(!JSON.stringify(events).includes(id));
 const success=createAuthClient({baseURL:origin,fetchOptions:{customFetchImpl:async()=>Response.json({photoId:id},{status:201})}});
 await createPhotoTransfer((url,options)=>success.$fetch<unknown>(url,options),origin,15000,entry=>events.push(entry)).upload(id,'pet-PRIVATE','owner-PRIVATE',new Blob([bytes]),new AbortController().signal);
 assert.equal(events.at(-1)?.result,'success');assert.equal(events.at(-1)?.status,201);
 const invalid=createAuthClient({baseURL:origin,fetchOptions:{customFetchImpl:async()=>new Response('PRIVATE_BAD_IMAGE',{headers:{'content-type':'image/jpeg'}})}});
 const download=createPhotoTransfer((url,options)=>invalid.$fetch<unknown>(url,options),origin,15000,entry=>events.push(entry));
 await assert.rejects(download.download(id,'owner-PRIVATE',new AbortController().signal),error=>error instanceof CloudApiError&&error.category==='invalid-response'&&error.status===200);
 assert.equal(events.at(-1)?.route,'photo-download');assert.equal(events.at(-1)?.status,200);assert.equal(events.at(-1)?.category,'invalid-response');
 assert.ok(!JSON.stringify(events).includes('PRIVATE'));
});

test('observing an Expo-style response does not replace the SDK response with an undefined context response',async()=>{
 for(const status of [200,400]){
  const events:import('./sync-diagnostics.ts').CloudDiagnosticInput[]=[];
  const auth=createAuthClient({baseURL:origin,fetchOptions:{customFetchImpl:async()=>{
   // expo/fetch returns its own Response class, unlike Node's global Response.
   const native=Response.json(status===200?{photoId:id}:{error:'invalid_photo'},{status});
   const response=new Proxy(native,{getPrototypeOf:()=>null,get:(target,key)=>{const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});
   assert.equal(response instanceof Response,false);
   return response;
  }}});
  const transfer=createPhotoTransfer((url,options)=>auth.$fetch<unknown>(url,options),origin,15000,entry=>events.push(entry));
  const request=transfer.upload(id,'pet-1','owner-1',bytes,new AbortController().signal);
  if(status===200)await request;
  else await assert.rejects(request,error=>error instanceof CloudApiError&&error.status===400);
  assert.equal(events[0].status,status);assert.equal(events[0].result,status===200?'success':'error');
 }
});

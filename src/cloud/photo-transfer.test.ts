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

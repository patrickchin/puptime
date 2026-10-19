import assert from 'node:assert/strict';
import test from 'node:test';
import { writeCloudExport } from './export-stream.ts';

const encoder=new TextEncoder();
const manifest={type:'manifest',format:'puptime-cloud-export',version:1,exportedAt:100,pets:[{id:'pet-1',name:'Clover 🐶 小狗',eventCount:1}]};
const revision={type:'revision',recordId:'event-1',revision:1,sequence:1,operationId:'operation-1',deviceId:'device-1',acceptedAt:100,baseRevision:0,intent:'create',proposal:{type:'pee',at:100,source:'app',note:'小狗 🐶 café'},before:null,after:{id:'event-1',petId:'pet-1',revision:1,sequence:1,deleted:false,updatedAt:100,kind:'event',data:{type:'pee',at:100,source:'app',note:'小狗 🐶 café'}},reason:'created'};
const text=(lines:unknown[])=>lines.map(value=>JSON.stringify(value)+'\n').join('');
function response(value:string,step=1024){const bytes=encoder.encode(value);let offset=0;return new Response(new ReadableStream<Uint8Array>({pull(controller){if(offset>=bytes.length){controller.close();return;}controller.enqueue(bytes.slice(offset,offset+=step));}}),{headers:{'content-type':'application/x-ndjson; charset=utf-8'}});}
function destination(fail=false){const chunks:Uint8Array[]=[];let closed=false,aborted=false;return {stream:new WritableStream<Uint8Array>({write(value){if(fail)throw new Error('Disk full: private path');chunks.push(value.slice());},close(){closed=true;},abort(){aborted=true;}}),get closed(){return closed;},get aborted(){return aborted;},text(){return Buffer.concat(chunks).toString('utf8');}};}

test('exports empty and populated snapshots with byte-exact split UTF-8 and a validated completion',async()=>{
 for(const lines of [[manifest,{type:'complete',cursor:0}],[manifest,revision,{type:'complete',cursor:1}]]){
  const raw=text(lines),output=destination();assert.deepEqual(await writeCloudExport(response(raw,1),output.stream),{cursor:lines.length===3?1:0});assert.equal(output.text(),raw);assert.equal(output.closed,true);assert.equal(output.aborted,false);
 }
});

test('truncated, reordered, foreign-puppy and trailing exports never close a shareable file',async()=>{
 const bad=[
  '',text([manifest]),text([manifest,revision]),text([manifest,{type:'complete',cursor:1}]),
  text([manifest,{...revision,sequence:2,after:{...revision.after,sequence:2}},{type:'complete',cursor:2}]),
  text([manifest,{...revision,after:{...revision.after,petId:'someone-else'}},{type:'complete',cursor:1}]),
  text([manifest,revision,{type:'complete',cursor:1}])+' ',
  text([manifest,{type:'complete',cursor:0},{type:'complete',cursor:0}]),
  text([{...manifest,pets:[manifest.pets[0],manifest.pets[0]]},{type:'complete',cursor:0}]),
  text([manifest,{type:'complete',cursor:0}]).trimEnd(),
  text([manifest])+'x'.repeat(1024*1024+1),
 ];
 for(const raw of bad){const output=destination();await assert.rejects(writeCloudExport(response(raw),output.stream),{message:'invalid-response'});assert.equal(output.closed,false);assert.equal(output.aborted,true);}
});

test('network and disk failures are redacted and abort the destination',async()=>{
 const broken=new Response(new ReadableStream<Uint8Array>({start(controller){controller.enqueue(encoder.encode(text([manifest])));controller.error(new Error('private server token'));}}),{headers:{'content-type':'application/x-ndjson'}});
 for(const [input,output] of [[broken,destination()],[response(text([manifest,{type:'complete',cursor:0}])),destination(true)]] as const){await assert.rejects(writeCloudExport(input,output.stream),{message:'invalid-response'});assert.equal(output.closed,false);}
});

test('cancellation releases a stalled source without sharing a partial export',async()=>{
 let cancelled=false;const aborter=new AbortController(),output=destination();
 const input=new Response(new ReadableStream<Uint8Array>({start(controller){controller.enqueue(encoder.encode(text([manifest])));},cancel(){cancelled=true;}}),{headers:{'content-type':'application/x-ndjson'}});
 const writing=writeCloudExport(input,output.stream,aborter.signal);await new Promise(resolve=>setTimeout(resolve,0));aborter.abort();await assert.rejects(writing,{name:'AbortError'});assert.equal(cancelled,true);assert.equal(output.aborted,true);assert.equal(output.closed,false);
});

test('HTML or failed HTTP responses cannot become a cloud export',async()=>{
 for(const input of [new Response('<html>Sign in</html>'),new Response(text([manifest,{type:'complete',cursor:0}]),{status:401,headers:{'content-type':'application/x-ndjson'}})]){const output=destination();await assert.rejects(writeCloudExport(input,output.stream),{message:'invalid-response'});assert.equal(output.aborted,true);assert.equal(output.closed,false);}
});

// A decoder replacing bad UTF-8 would silently corrupt a user's downloaded note.
test('invalid UTF-8 cannot be accepted as replacement characters in an export',async()=>{
 const raw=encoder.encode(text([manifest,revision,{type:'complete',cursor:1}]));
 const target=raw.indexOf(0xf0);assert.ok(target>=0);raw[target]=0xff;
 const output=destination();await assert.rejects(writeCloudExport(new Response(raw,{headers:{'content-type':'application/x-ndjson'}}),output.stream),{message:'invalid-response'});assert.equal(output.closed,false);assert.equal(output.aborted,true);
});

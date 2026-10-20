import assert from 'node:assert/strict';
import test from 'node:test';
import * as protocol from './protocol.ts';
import {CloudApiError,createCloudApi,createSdkRequest} from './api.ts';

const id='["event","pet-1","one"]';
const one={id,petId:'pet-1',kind:'event' as const,revision:1,sequence:1,deleted:false,updatedAt:1000,data:{type:'pee' as const,at:100,source:'app' as const,note:'First'}};
const two={...one,revision:2,sequence:3,updatedAt:2000,data:{...one.data,note:'Second'}};
const first={recordId:id,revision:1,sequence:1,operationId:'op-1',deviceId:'device-1',acceptedAt:1000,baseRevision:0,intent:'create' as const,proposal:one.data,before:null,after:one,reason:'created' as const};
const second={recordId:id,revision:2,sequence:3,operationId:'op-2',deviceId:'device-2',acceptedAt:2000,baseRevision:1,intent:'patch' as const,proposal:{note:'Second'},before:one,after:two,reason:'updated' as const};

test('cloud revisions validate immutable before/after identity, scope, proposal and committed ordering',()=>{
 assert.equal(typeof protocol.revisionSchema?.parse,'function');
 assert.deepEqual(protocol.revisionSchema.parse(first),first);assert.deepEqual(protocol.revisionSchema.parse(second),second);
 const invalid=[
  {...second,recordId:'another-record'}, {...second,revision:3}, {...second,sequence:4},
  {...second,before:{...one,petId:'another-pet'}}, {...second,before:{...one,id:'another-record'}},
  {...second,before:{...one,kind:'routine',data:{type:'meal',minutes:100}}},
  {...second,before:{...one,revision:2}}, {...second,before:{...one,sequence:3}},
  {...second,baseRevision:3}, {...second,acceptedAt:1.5}, {...second,operationId:'bad identity'},
  {...second,proposal:{note:12}}, {...second,proposal:{unknown:true}}, {...second,extra:'private'},
  {...first,before:one}, {...second,before:null},
 ];
 for(const value of invalid)assert.equal(protocol.revisionSchema.safeParse(value).success,false);
});

test('SDK history requests retain the fixed credential origin and encode a long Unicode record ID as one segment',async()=>{
 const longId='["event","pet-1","'+'a'.repeat(200)+' /💩"]';
 const revision={...first,recordId:longId,after:{...one,id:longId}};let calls=0;
 const controller=new AbortController();
 const cloud=createCloudApi(createSdkRequest(async(url,options)=>{
  calls++;assert.equal(url,'https://puptime.test/api/records/:recordId/history?beforeRevision=5');assert.deepEqual(options.params,{recordId:longId});
  assert.equal(options.method,'GET');assert.equal(options.body,undefined);assert.equal(options.signal,controller.signal);assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');assert.equal(options.retry,0);
  return {data:{revisions:[revision]},error:null};
 },'https://puptime.test'));
 assert.equal(typeof cloud.history,'function');assert.deepEqual(await cloud.history(longId,5,controller.signal),{revisions:[revision]});assert.equal(calls,1);
});

test('history response pages reject foreign records or pets, bad order, duplicates and entries beyond the cursor',async()=>{
 const read=(data:unknown)=>createCloudApi(async()=>({data,error:null}));
 assert.equal(typeof read({}).history,'function');
 assert.deepEqual(await read({revisions:[second,first]}).history(id),{revisions:[second,first]});
 for(const revisions of [
  [first,second],[second,second],Array(51).fill(first),
  [{...first,recordId:'different',after:{...one,id:'different'}}],
  [{...first,after:{...one,petId:'other-pet'}}],
  [{...second,proposal:{note:'x'.repeat(16385)}}],
 ])await assert.rejects(read({revisions}).history(id),error=>error instanceof CloudApiError&&error.category==='invalid-response');
 await assert.rejects(read({revisions:[second]}).history(id,2),/invalid-response/);
 await assert.rejects(read({revisions:[],extra:true}).history(id),/invalid-response/);
});

test('history arguments and unsafe SDK routes never dispatch credentialed requests',async()=>{
 let calls=0;const cloud=createCloudApi(async()=>{calls++;return {data:{revisions:[]},error:null};});assert.equal(typeof cloud.history,'function');
 for(const before of [0,-1,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1])await assert.rejects(cloud.history(id,before));
 for(const value of ['', 'bad\nidentity', '.', '..'])await assert.rejects(cloud.history(value));assert.equal(calls,0);
 const request=createSdkRequest(async()=>{calls++;return {data:{revisions:[]},error:null};},'https://puptime.test');
 for(const path of ['/api/records/../history','/api/records/%2e%2e/history','/api/records/%ZZ/history','/api/records/a/history?url=https://other.example','/api/records/a/history#private','/api/records/a/history?beforeRevision=0','/api/records/a/history?beforeRevision=9007199254740992'])await assert.rejects(request(path,{method:'GET'}));
 assert.equal(calls,0);
});

test('cloud history preserves cancellation and actionable failures without retaining private server contents',async()=>{
 const aborted=new AbortController();aborted.abort();let calls=0;
 const cloud=createCloudApi(async()=>{calls++;return {data:{revisions:[]},error:null};});assert.equal(typeof cloud.history,'function');
 await assert.rejects(cloud.history(id,undefined,aborted.signal),/abort/i);assert.equal(calls,0);
 const late=new AbortController();const delayed=createCloudApi(async()=>{late.abort();return {data:{revisions:[first]},error:null};});await assert.rejects(delayed.history(id,undefined,late.signal),/abort/i);
 for(const [status,category] of [[401,'auth-required'],[402,'invalid-request'],[403,'forbidden'],[429,'rate-limited']] as const){
  const failed=createCloudApi(async()=>({data:{private:'PRIVATE NOTE'},error:{status},retryAfter:'2'}));
  await assert.rejects(failed.history(id),error=>error instanceof CloudApiError&&error.category===category&&error.retryAfterMs===2000&&!String(error).includes('PRIVATE'));
 }
 await assert.rejects(createCloudApi(async()=>{throw new Error('PRIVATE TRANSPORT');}).history(id),error=>error instanceof CloudApiError&&error.category==='network'&&!String(error).includes('PRIVATE'));
});

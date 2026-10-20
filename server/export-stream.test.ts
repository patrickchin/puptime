import { env } from 'cloudflare:workers';
import { applyD1Migrations, runInDurableObject } from 'cloudflare:test';
import { beforeAll, expect, inject, test } from 'vitest';
import { writeCloudExport } from '../src/cloud/export-stream';
import type { Mutation } from '../src/cloud/protocol';
import worker from './index';

const origin='https://puptime.test';
const settings={...env,ENVIRONMENT:'local' as const,AUTH_BASE_URL:origin,WEB_ORIGINS:origin,AUTH_SECRET:'export-runtime-test-secret-at-least-thirty-two-characters'};
const note='小狗 🐶 café, "quoted"\nsecond line';
beforeAll(()=>applyD1Migrations(env.AUTH_DB,inject('migrations')));

async function owner(){
 const email=`export-${crypto.randomUUID()}@example.invalid`,ip='198.51.100.240';
 const post=(path:string,body:object)=>worker.fetch(new Request(origin+'/api/auth/'+path,{method:'POST',headers:{origin,'cf-connecting-ip':ip,'content-type':'application/json'},body:JSON.stringify(body)}),settings);
 expect((await post('email-otp/send-verification-otp',{email,type:'sign-in'})).status).toBe(200);
 const preview=await env.AUTH_DB.prepare('SELECT code FROM local_email_previews WHERE email=?').bind(email).first<{code:string}>();
 const login=await post('sign-in/email-otp',{email,otp:preview!.code});expect(login.status).toBe(200);
 const cookie=login.headers.getSetCookie().map(value=>value.split(';')[0]).join('; '),{user}=await login.json<{user:{id:string}}>();
 return {id:user.id,cookie};
}
function event(id='history-event'):Mutation{return {protocolVersion:1,operationId:crypto.randomUUID(),deviceId:'export-device',recordId:id,petId:'export-pet',kind:'event',baseRevision:0,intent:'create',patch:{type:'pee',at:100,source:'app',note}};}

test('100,000 revisions cross real guarded HTTP and DO streaming in one export RPC, with a bounded snapshot and retirement interruption',async context=>{
 const user=await owner(),store=env.ACCOUNTS.get(env.ACCOUNTS.idFromName(user.id));
 await store.enroll({operationId:crypto.randomUUID(),deviceId:'export-device',localPetId:'export-pet',name:'Clover 🐶 小狗'});
 await store.apply(event());
 // Fixture-only bulk history keeps the normalized live record and its head
 // consistent. No 100,000-item array, alternate export implementation or live DB.
 const savedBytes=await runInDurableObject(store,(_instance,state)=>{
  state.storage.transactionSync(()=>{
   state.storage.sql.exec(`WITH RECURSIVE n(v) AS (SELECT 2 UNION ALL SELECT v+1 FROM n WHERE v<100000)
    INSERT INTO revisions(sequence,record_id,revision,body)
    SELECT v,'history-event',v,json_set(body,'$.revision',v,'$.sequence',v,'$.operationId','bulk-'||v,
     '$.baseRevision',v-1,'$.intent','patch','$.reason','updated','$.proposal',json_object('note',?),
     '$.before',json_set(json_extract(body,'$.after'),'$.revision',v-1,'$.sequence',v-1),
     '$.after.revision',v,'$.after.sequence',v)
    FROM n CROSS JOIN (SELECT body FROM revisions WHERE sequence=1)`,note);
   state.storage.sql.exec("UPDATE records SET revision=100000,sequence=100000 WHERE id='history-event'");
  });
  return state.storage.sql.exec<{bytes:number}>('SELECT SUM(length(CAST(body AS BLOB))) AS bytes FROM revisions').one().bytes;
 });
 let calls=0;
 // Count calls but forward every operation to the actual runtime binding. The
 // old 100-row Worker paging exhausts this budget; no response data is mocked.
 const counted={...settings,ACCOUNTS:{idFromName:env.ACCOUNTS.idFromName.bind(env.ACCOUNTS),get:(id:DurableObjectId)=>{
  const actual=env.ACCOUNTS.get(id);
  return new Proxy(actual,{get(target,key){const value=Reflect.get(target,key,target);if(typeof value!=='function')return value;return (...args:unknown[])=>{if(++calls>1000)throw new Error('Test export RPC budget exceeded');return Reflect.apply(value,target,args);};}});
 }}} as unknown as Cloudflare.Env;
 const download=(expected=user.id)=>worker.fetch(new Request(origin+'/api/account/export',{method:'POST',headers:{origin,cookie:user.cookie,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({expectedAccount:expected})}),counted);
 const denied=await download('someone-else');expect(denied.status).toBe(409);expect(calls).toBe(0);
 const response=await download();expect(response.status).toBe(200);expect(response.headers.get('content-disposition')).toContain('attachment');
 let bytes=0,lines=0,maxChunk=0,prefix='',concurrent=false;
 const decoder=new TextDecoder();
 try{
  expect(await writeCloudExport(response,new WritableStream<Uint8Array>({async write(chunk){
   bytes+=chunk.byteLength;maxChunk=Math.max(maxChunk,chunk.byteLength);for(const byte of chunk)if(byte===10)lines++;
   if(prefix.length<8192)prefix+=decoder.decode(chunk,{stream:true});
   if(!concurrent){concurrent=true;expect((await store.apply(event('after-snapshot'))).sequence).toBe(100001);}
  }}))).toEqual({cursor:100000});
 }finally{expect(calls).toBe(1);}
 expect(lines).toBe(100002);expect(bytes).toBeGreaterThan(32*1024*1024);expect(maxChunk).toBeLessThan(1024*1024);
 const first=prefix.split('\n');expect(JSON.parse(first[0]).pets).toEqual([{id:'export-pet',name:'Clover 🐶 小狗',eventCount:1}]);expect(JSON.parse(first[1]).after.data.note).toBe(note);
 const encoder=new TextEncoder();expect(bytes).toBe(savedBytes+100000*encoder.encode('{"type":"revision",').length+encoder.encode(first[0]+'\n'+JSON.stringify({type:'complete',cursor:100000})+'\n').byteLength);
 await context.annotate(JSON.stringify({revisions:100000,bytes,lines,maxChunk,exportRPCs:calls}),'export-proof');
 expect((await store.history('after-snapshot'))[0].sequence).toBe(100001);
 // A separate stream is interrupted after its first received chunk, while most
 // of the history is still unread. Retirement cannot emit a success footer.
 const interrupted=await download(),reader=interrupted.body!.getReader();expect((await reader.read()).done).toBe(false);
 await store.retire();let completed=false;
 await expect((async()=>{for(;;){const part=await reader.read();if(part.done){completed=true;return;}}})()).rejects.toThrow();
 expect(completed).toBe(false);expect(calls).toBe(2);reader.releaseLock();
},120000);

test.each(['gap','malformed-body'] as const)('a saved %s cannot receive a successful export completion',async fault=>{
 const user=await owner(),store=env.ACCOUNTS.get(env.ACCOUNTS.idFromName(user.id));
 await store.enroll({operationId:crypto.randomUUID(),deviceId:'export-device',localPetId:'export-pet',name:'Synthetic puppy'});
 await store.apply(event());await store.apply(event('second-event'));
 await runInDurableObject(store,(_instance,state)=>{
  if(fault==='gap')state.storage.sql.exec('DELETE FROM revisions WHERE sequence=1');
  else state.storage.sql.exec("UPDATE revisions SET body='[]' WHERE sequence=1");
 });
 const response=await worker.fetch(new Request(origin+'/api/account/export',{headers:{origin,cookie:user.cookie}}),settings);
 let closed=false;
 await expect(writeCloudExport(response,new WritableStream({close(){closed=true;}}))).rejects.toThrow('invalid-response');
 expect(closed).toBe(false);
});

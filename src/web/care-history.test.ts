import assert from 'node:assert/strict';
import test from 'node:test';
import {createCareHistory} from './care-history.ts';
import {CareError,type CareClient,type CareRow,type CarePage} from './care-client.ts';
const row=(sequence:number):CareRow=>({localId:`evt_${sequence}`,canEdit:true,record:{id:`evt_${sequence}`,petId:'pet_test',kind:'event',revision:1,sequence,deleted:false,updatedAt:sequence,data:{type:'pee',at:sequence,source:'app'}}});
const base:Omit<CarePage,'records'|'nextCursor'>={puppyName:'Biscuit',ownerName:'Alex',actorName:'Sam',share:{id:'shr_'+'a'.repeat(32),petId:'pet_test',kind:'household',permission:'contribute',label:'Household',expiresAt:null,inviteExpiresAt:100,memberName:'Sam',accepted:true,revoked:false,createdAt:1}};
function fixture(count=200){
 let rows=Array.from({length:count},(_,index)=>row(count-index));let gate:Promise<void>|null=null,fail:Error|null=null,calls=0;
 const client:Pick<CareClient,'page'>={page:async(_id,kind='event',before=0)=>{
  if(kind==='routine')return {...base,records:[],nextCursor:null};calls++;if(gate)await gate;if(fail)throw fail;
  const matching=rows.filter(row=>!before||row.record.sequence<before);return {...base,records:matching.slice(0,50),nextCursor:matching.length>50?matching[49].record.sequence:null};
 }};
 const history=createCareHistory(client,base.share.id);
 return {history,client,get rows(){return rows;},set rows(next){rows=next;},set gate(next:Promise<void>|null){gate=next;},set fail(next:Error|null){fail=next;},get calls(){return calls;},async initialize(){history.initialize(await client.page(base.share.id),[]);},page(){const state=history.read();assert.ok('page' in state);return state.page;}};
}
const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));

test('polling retains loaded history, removes deleted rows, and preserves unchanged row identities',async()=>{
 const f=fixture();await f.initialize();await f.history.more();const before=f.page();assert.equal(before.records.length,100);
 f.rows=f.rows.filter(row=>row.localId!=='evt_180');f.rows[10]={...f.rows[10],record:{...f.rows[10].record,revision:2}};
 await f.history.refresh();const after=f.page();assert.equal(after.records.length,100);assert.equal(after.records.some(row=>row.localId==='evt_180'),false);
 const byId=new Map(before.records.map(row=>[row.localId,row]));assert.equal(after.records.filter(row=>byId.get(row.localId)===row).length,98);
 assert.equal(after.nextCursor,100);
});

test('pagination waits for an in-flight refresh and appends to its current cursor',async()=>{
 const f=fixture();await f.initialize();await f.history.more();let release!:()=>void;f.gate=new Promise<void>(resolve=>{release=resolve;});
 const refresh=f.history.refresh();await tick();const more=f.history.more();assert.equal(f.history.read().kind,'refreshing');
 f.gate=null;release();await Promise.all([refresh,more]);assert.equal(f.page().records.length,150);assert.equal(new Set(f.page().records.map(row=>row.localId)).size,150);assert.equal(f.page().nextCursor,51);
});

test('duplicate refreshes and load-more clicks share one operation and failures keep the cursor retryable',async()=>{
 const f=fixture();await f.initialize();const first=f.history.more(),duplicate=f.history.more();assert.equal(first,duplicate);await first;assert.equal(f.page().records.length,100);
 const refresh=f.history.refresh();assert.equal(f.history.refresh(),refresh);await refresh;
 f.fail=new CareError(0);await f.history.more();assert.equal(f.page().records.length,100);assert.equal(f.history.read().kind,'ready');
 f.fail=null;await f.history.more();assert.equal(f.page().records.length,150);
});

test('access revocation clears rows, and completions from a reset history cannot restore them',async()=>{
 const f=fixture();await f.initialize();f.fail=new CareError(410);await f.history.refresh();assert.equal(f.history.read().kind,'unavailable');
 f.fail=null;await f.initialize();let release!:()=>void;f.gate=new Promise<void>(resolve=>{release=resolve;});
 const pending=f.history.refresh();await tick();f.history.reset();release();await pending;assert.deepEqual(f.history.read(),{kind:'empty'});
});

test('a successful write queues a fresh read behind a poll that already captured an older revision',async()=>{
 const f=fixture();await f.initialize();let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
 const read=f.client.page;let delay=true;
 f.client.page=async(...args)=>{const response=await read(...args);if(args[1]==='event'&&delay){delay=false;await gate;}return response;};
 const poll=f.history.refresh();await tick();
 f.rows=f.rows.map((row,index)=>index===0?{...row,record:{...row.record,revision:2}}:row);
 const acknowledged=f.history.refreshAfterWrite();assert.notEqual(acknowledged,poll);
 release();await Promise.all([poll,acknowledged]);assert.equal(f.page().records[0].record.revision,2);
});

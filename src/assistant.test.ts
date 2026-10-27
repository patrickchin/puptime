import assert from 'node:assert/strict';
import test from 'node:test';
import {assistantNeedsReview,assistantRequestSchema,validateAssistantPlan,type AssistantRequest} from './assistant.ts';
import {createAssistantClient} from './assistant-client.ts';
import {CloudApiError} from './cloud/api.ts';

const input:AssistantRequest={text:'Ellie peed and pooped an hour ago',now:Date.UTC(2026,9,27,12),timezone:'Asia/Shanghai',locale:'en',puppy:{id:'pet_ellie',name:'Ellie'},customActivities:[],recentEvents:[],confirmBeforeSaving:true,conversation:[]};
const log={kind:'log' as const,puppyId:'pet_ellie',type:'pee' as const,at:input.now-3600000,endedAt:null,customLabel:null,note:null};
const plan={reply:'Ready to log both.',needsClarification:false,actions:[log,{...log,type:'poop' as const,note:'A bit runny today.'}]};

test('a multi-log proposal preserves the exact time, separate activities and relevant note',()=>{
  assert.deepEqual(validateAssistantPlan(plan,input),plan);
  assert.equal(assistantNeedsReview(plan,true),true);assert.equal(assistantNeedsReview(plan,false),false);
  assert.equal(assistantNeedsReview({...plan,actions:[{kind:'navigate',screen:'insights'}]},true),false);
  assert.equal(assistantNeedsReview({...plan,actions:[{kind:'set_confirmation',enabled:false}]},true),false);
});
test('proposals reject arbitrary dogs, unsupported actions, future times and malformed activity data',()=>{
  for(const action of [{...log,puppyId:'pet_roger'},{...log,at:input.now+1},{...log,type:'poop',endedAt:input.now},{...log,type:'nap',endedAt:log.at-1},{...log,type:'custom'},{...log,note:'x'.repeat(301)},{kind:'delete_account'},{kind:'navigate',screen:'https://example.com'}])assert.throws(()=>validateAssistantPlan({...plan,actions:[action]},input));
  assert.throws(()=>validateAssistantPlan({...plan,needsClarification:true},input));
  assert.throws(()=>validateAssistantPlan({...plan,actions:[{kind:'set_confirmation',enabled:false},{kind:'set_confirmation',enabled:true}]},input));
  assert.deepEqual(validateAssistantPlan({reply:'Which dog?',needsClarification:true,actions:[]},input).actions,[]);
});
test('edits must target a provided recent record and keep valid nap bounds',()=>{
  const edit={kind:'edit_log',puppyId:input.puppy.id,eventId:'evt_last',at:null,endedAt:null,note:'Runny today'};
  assert.throws(()=>validateAssistantPlan({...plan,actions:[edit]},input));
  const context={...input,recentEvents:[{id:'evt_last',type:'poop' as const,at:log.at}]};
  assert.equal(validateAssistantPlan({...plan,actions:[edit]},context).actions.length,1);
  assert.throws(()=>validateAssistantPlan({...plan,actions:[edit,edit]},context));
  assert.throws(()=>validateAssistantPlan({...plan,actions:[{...edit,note:null,endedAt:input.now}]},context));
});
test('request bounds reject invalid timezones, excess context and executable-looking extra fields',()=>{
  assert.deepEqual(assistantRequestSchema.parse(input),input);
  for(const request of [{...input,timezone:'Not/AZone'},{...input,text:' '},{...input,text:'x'.repeat(2001)},{...input,apiKey:'secret'},{...input,conversation:Array(11).fill({role:'user',text:'hi'})}])assert.throws(()=>assistantRequestSchema.parse(request));
});
test('client validates at both boundaries, uses fixed routes, and ignores late cancelled responses',async()=>{
  const calls:string[]=[],client=createAssistantClient(async(path,options)=>{calls.push(path);if(path.endsWith('status'))return {data:{available:true},error:null};assert.deepEqual(options.body,input);return {data:plan,error:null};});
  assert.deepEqual(await client.status(),{available:true});assert.deepEqual(await client.plan(input),plan);
  assert.deepEqual(calls,['/api/assistant/status','/api/assistant/plan']);
  await assert.rejects(createAssistantClient(async()=>({data:{...plan,actions:[{...log,puppyId:'other'}]},error:null})).plan(input));
  const aborter=new AbortController();await assert.rejects(createAssistantClient(async()=>{aborter.abort();return {data:plan,error:null};}).plan(input,aborter.signal),/abort/i);
  await assert.rejects(createAssistantClient(async()=>({data:{error:'SECRET'},error:{status:401}})).plan(input),error=>error instanceof CloudApiError&&error.status===401&&!String(error).includes('SECRET'));
});

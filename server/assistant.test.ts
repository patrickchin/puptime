import {env} from 'cloudflare:workers';
import {applyD1Migrations} from 'cloudflare:test';
import {afterEach,beforeAll,expect,inject,test,vi} from 'vitest';
import worker from './index';
import {planAssistant} from './assistant';
import {getAccountStore} from './account-store';
import type {AssistantRequest} from '../src/assistant';

beforeAll(()=>applyD1Migrations(env.AUTH_DB,inject('migrations')));
afterEach(()=>vi.restoreAllMocks());
const settings={...env,ENVIRONMENT:'local' as const,AUTH_BASE_URL:'https://puptime.test',WEB_ORIGINS:'https://puptime.test',AUTH_SECRET:'local-test-secret-with-at-least-32-characters'};
const input:AssistantRequest={text:'Ellie peed and pooped an hour ago. The poop was runny.',now:Date.now(),timezone:'Asia/Shanghai',locale:'en',puppy:{id:'pet_ellie',name:'Ellie'},customActivities:[],recentEvents:[],confirmBeforeSaving:true,conversation:[]};
const action={kind:'log',puppyId:input.puppy.id,type:'pee',at:input.now-3600000,endedAt:null,customLabel:null,note:null};
const proposal={reply:'Ready to log both activities.',needsClarification:false,actions:[action,{...action,type:'poop',note:'Runny.'}]};
const provider={OPENAI_API_KEY:'test-only-not-a-real-key',OPENAI_MODEL:'test-structured-model'};
const modelResponse=(value:unknown)=>Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(value)}]}]});
async function call(path:string,body?:object,cookie='',extra:Record<string,string>={},configured=true){return worker.fetch(new Request(`https://puptime.test/api/${path}`,{method:body?'POST':'GET',headers:{origin:'https://puptime.test','content-type':'application/json',cookie,...extra},...(body?{body:JSON.stringify(body)}:{})}),{...settings,...(configured?provider:{})});}
async function owner(){
  const email=`assistant-${crypto.randomUUID()}@example.invalid`,ip=`192.0.2.${Math.floor(Math.random()*200)+1}`;
  const post=(path:string,body:object)=>worker.fetch(new Request(`https://puptime.test/api/auth/${path}`,{method:'POST',headers:{origin:'https://puptime.test','content-type':'application/json','cf-connecting-ip':ip},body:JSON.stringify(body)}),settings);
  expect((await post('email-otp/send-verification-otp',{email,type:'sign-in'})).status).toBe(200);
  const preview=await env.AUTH_DB.prepare('SELECT code FROM local_email_previews WHERE email=?').bind(email).first<{code:string}>();
  const login=await post('sign-in/email-otp',{email,otp:preview!.code});expect(login.status).toBe(200);
  const cookie=login.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
  const account=await (await call('account',undefined,cookie)).json<{user:{id:string}}>();return {cookie,id:account.user.id};
}
test('model request uses bounded structured output, fixed provider origin, no storage, and no server credentials in user input',async()=>{
  const fetcher=vi.spyOn(globalThis,'fetch').mockImplementation(async(url,options)=>{
    expect(url).toBe('https://api.openai.com/v1/responses');expect(options!.redirect).toBe('error');
    const body=JSON.parse(String(options!.body));expect(body.store).toBe(false);expect(body.model).toBe(provider.OPENAI_MODEL);
    expect(body.text.format.strict).toBe(true);expect(body.text.format.schema.additionalProperties).toBe(false);
    expect(JSON.parse(body.input)).toEqual(input);expect(body.input).not.toContain(provider.OPENAI_API_KEY);
    return modelResponse(proposal);
  });
  expect(await planAssistant(input,provider)).toEqual(proposal);expect(fetcher).toHaveBeenCalledOnce();
});
test('malformed, incomplete, refused, cross-pet and unsupported provider output is never executable',async()=>{
  const fetcher=vi.spyOn(globalThis,'fetch');
  for(const response of [new Response('PRIVATE PROVIDER ERROR',{status:429}),Response.json({status:'incomplete',output:[]}),Response.json({status:'completed',output:[{type:'message',content:[{type:'refusal',refusal:'No.'}]}]}),modelResponse({...proposal,actions:[{...action,puppyId:'pet_other'}]}),modelResponse({...proposal,actions:[{kind:'delete_account'}]})]){
    fetcher.mockResolvedValueOnce(response);await expect(planAssistant(input,provider)).rejects.toThrow();
  }
});
test('planning requires a session and trusted origin before any provider call',async()=>{
  const fetcher=vi.spyOn(globalThis,'fetch');
  expect((await call('assistant/plan',input)).status).toBe(401);
  const user=await owner();
  expect((await call('assistant/plan',input,user.cookie,{origin:'https://untrusted.example'})).status).toBe(403);
  expect(fetcher).not.toHaveBeenCalled();
});
test('an authenticated proposal leaves the cloud journal empty and reports missing setup without exposing secrets',async()=>{
  const user=await owner();
  expect(await (await call('assistant/status',undefined,user.cookie,{},false)).json()).toEqual({available:false});
  expect((await call('assistant/plan',input,user.cookie,{},false)).status).toBe(503);
  vi.spyOn(globalThis,'fetch').mockResolvedValue(modelResponse(proposal));
  const response=await call('assistant/plan',input,user.cookie);
  expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('no-store');expect(await response.json()).toEqual(proposal);
  const account=await (await call('account',undefined,user.cookie)).json<{pets:unknown[]}>();expect(account.pets).toEqual([]);
  expect(await (await call('sync/pull?after=0',undefined,user.cookie)).json()).toEqual({changes:[],cursor:0,hasMore:false});
});
test('account budget is shared across sessions and refuses excess calls before the provider',async()=>{
  const user=await owner(),store=getAccountStore(settings,user.id);
  for(let index=0;index<10;index++)expect(await store.allowAssistantRequest()).toBe(true);
  const fetcher=vi.spyOn(globalThis,'fetch');const response=await call('assistant/plan',input,user.cookie);
  expect(response.status).toBe(429);expect(response.headers.get('retry-after')).toBe('60');expect(fetcher).not.toHaveBeenCalled();
});
test('invalid request context and stale clocks cannot reach the model',async()=>{
  const user=await owner(),fetcher=vi.spyOn(globalThis,'fetch');
  expect((await call('assistant/plan',{...input,text:'x'.repeat(2001)},user.cookie)).status).toBe(400);
  expect((await call('assistant/plan',{...input,now:0},user.cookie)).status).toBe(400);expect(fetcher).not.toHaveBeenCalled();
});

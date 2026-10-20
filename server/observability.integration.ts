import { env } from 'cloudflare:workers';
import { applyD1Migrations,createExecutionContext,runInDurableObject,waitOnExecutionContext } from 'cloudflare:test';
import { beforeAll,beforeEach,expect,inject,test } from 'vitest';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import * as Sentry from '@sentry/cloudflare';
import { wrapRequestHandler } from '@sentry/cloudflare/request';
import { parseEnvelope,type Envelope } from '@sentry/core';
import { z } from 'zod';
import { ReconciliationError } from '../src/cloud/reconcile';
import { apiSentryOptions,unexpectedError } from './observability';
import worker from './index';

const sink=()=>inject('sentryTestOrigin');
const records=async()=>await(await fetch(sink()+'/records')).json() as {path:string;body:string}[];
const poison='synthetic-private-note-code-receipt-user-7bfc';
beforeAll(()=>applyD1Migrations(env.AUTH_DB,inject('migrations')));
beforeEach(async()=>{await fetch(sink()+'/records',{method:'DELETE'});});
function decoded(body:string){return parseEnvelope(new TextEncoder().encode(body));}
async function request(app:{fetch:typeof worker.fetch},input:Request,settings:Cloudflare.Env=env){
 const context=createExecutionContext();const response=await app.fetch(input,settings,context);await waitOnExecutionContext(context);return response;
}
function scenario(action:(settings:Cloudflare.Env)=>unknown){
 const app=new Hono<{Bindings:Cloudflare.Env}>();
 app.get('/scenario',async context=>{await action(context.env);return context.body(null,204);});
 app.onError(error=>{if(unexpectedError(error))Sentry.captureException(error);return new Response(null,{status:503});});
 return {fetch(input:Request,settings:Cloudflare.Env,context?:ExecutionContext){return wrapRequestHandler({options:apiSentryOptions(settings),request:input,context},()=>app.fetch(input,settings,context));}};
}
const failEnv=(extra:Partial<Cloudflare.Env>={})=>({...env,...extra,get CLOUD_TRIAL_DAYS():string{throw new Error(poison);}});

test('unexpected HTTP503 sends one real SDK envelope to the isolated HTTP sink',async()=>{
 const response=await request(worker,new Request('https://puptime.test/api/config?code='+poison,{headers:{cookie:poison,authorization:'Bearer '+poison,'x-puptime-account':poison,'cf-connecting-ip':'192.0.2.20'}}),failEnv());
 expect(response.status).toBe(503);expect(await response.json()).toEqual({error:'service_unavailable'});
 const received=await records();expect(received).toHaveLength(1);expect(received[0].body).not.toContain(poison);
 const envelope=decoded(received[0].body);expect(envelope[1].map(([h])=>h.type)).toEqual(['event']);
 const event=envelope[1][0][1];expect(event).toMatchObject({level:'error',tags:{surface:'api'},exception:{values:[{type:'Error',value:'Unexpected Puptime API error'}]}});
 expect(event).not.toHaveProperty('request');expect(event).not.toHaveProperty('user');expect(event).not.toHaveProperty('contexts');
});

test.each([undefined,'not-a-dsn','http://public@outside.example/42','https://public@outside.example/42'])('missing or invalid DSN is disabled with no egress: %s',async dsn=>{
 expect((await request(worker,new Request('https://puptime.test/api/config'),failEnv({SENTRY_DSN:dsn}))).status).toBe(503);
 expect(await records()).toEqual([]);
});

test('a previously enabled invocation cannot enable diagnostics for the next missing-DSN invocation',async()=>{
 await request(worker,new Request('https://puptime.test/api/config'),failEnv());expect(await records()).toHaveLength(1);
 await fetch(sink()+'/records',{method:'DELETE'});
 await request(worker,new Request('https://puptime.test/api/config'),failEnv({SENTRY_DSN:undefined}));expect(await records()).toEqual([]);
});

test('an unavailable ingestion service does not change API responses or retry the failed request',async()=>{
 await fetch(sink()+'/fail',{method:'POST'});
 const response=await request(worker,new Request('https://puptime.test/api/config'),failEnv());
 expect(response.status).toBe(503);expect(await response.json()).toEqual({error:'service_unavailable'});
 expect(await records()).toHaveLength(1);
 expect((await request(worker,new Request('https://puptime.test/health'))).status).toBe(200);
 expect(await records()).toHaveLength(1);
});

test('normal requests and expected authentication, not-found and body-limit failures send nothing',async()=>{
 expect((await request(worker,new Request('https://puptime.test/health'))).status).toBe(200);
 expect((await request(worker,new Request('https://puptime.test/api/account'))).status).toBe(401);
 expect((await request(worker,new Request('https://puptime.test/not-a-route'))).status).toBe(404);
 expect((await request(worker,new Request('https://puptime.test/api/auth/sign-in/email-otp',{method:'POST',body:poison.repeat(2000)}))).status).toBe(413);
 expect(await records()).toEqual([]);
});

test.each(['http','validation','reconciliation'] as const)('the SDK filters expected %s errors at its error boundary',async kind=>{
 const error=kind==='http'?new HTTPException(409):kind==='validation'?z.string().safeParse(null).error!:new ReconciliationError(poison);
 const app=scenario(()=>{Sentry.captureException(error);throw error;});
 expect((await request(app,new Request('https://puptime.test/scenario'))).status).toBe(503);
 expect(await records()).toEqual([]);
});

test('final SDK envelope allowlist removes poison from fields, headers, attachments and every non-error item',async()=>{
 const app=scenario(async()=>{
  const payload={debug_meta:{images:[{type:'sourcemap',debug_id:'11111111-2222-3333-4444-555555555555',code_file:'/private/'+poison+'/index.ts'},{type:'sourcemap',debug_id:poison,code_file:poison}]},event_id:crypto.randomUUID().replaceAll('-',''),type:'error',message:poison,user:{id:poison,email:poison+'@example.invalid'},request:{url:'https://puptime.test/'+poison,headers:{cookie:poison},data:poison},tags:{owner:poison},extra:{sql:'SELECT '+poison},contexts:{private:{note:poison}},breadcrumbs:[{message:poison}],exception:{values:[{type:poison,value:poison,stacktrace:{frames:[{filename:'/private/'+poison+'/index.ts',lineno:12,colno:3,function:poison,vars:{note:poison},pre_context:[poison],context_line:poison},{filename:poison+'.js',lineno:13}]}}]}};
  await Sentry.getClient()!.sendEnvelope([{trace:{transaction:poison},privateHeader:poison},[
   [{type:'event',privateHeader:poison},payload],
   ...['attachment','session','transaction','profile','replay_recording','check_in','log','trace_metric','span','raw_security'].map(type=>[{type,filename:poison},{private:poison}]),
  ]] as unknown as Envelope);
 });
 expect((await request(app,new Request('https://puptime.test/scenario?query='+poison))).status).toBe(204);
 const received=await records();expect(received).toHaveLength(1);expect(received[0].body).not.toContain(poison);
 const envelope=decoded(received[0].body);expect(Object.keys(envelope[0]).sort()).toEqual(['sdk','sent_at']);expect(envelope[1].map(([h])=>h.type)).toEqual(['event']);
 expect(envelope[1][0][1]).toMatchObject({debug_meta:{images:[{type:'sourcemap',debug_id:'11111111-2222-3333-4444-555555555555',code_file:'index.ts'}]},exception:{values:[{type:'Error',stacktrace:{frames:[{filename:'index.ts',lineno:12,colno:3,in_app:true}]}}]}});
});

test('official capture APIs cannot send attachments, logs, metrics, check-ins or traces',async()=>{
 const app=scenario(async()=>{
  Sentry.getCurrentScope().addAttachment({filename:poison,data:poison});
  Sentry.addBreadcrumb({message:poison});Sentry.setUser({id:poison,email:poison+'@example.invalid'});
  Sentry.setExtra('note',poison);Sentry.setContext('sql',{query:poison});Sentry.setTag('receipt',poison);
  Sentry.captureException(new Error(poison),{attachments:[{filename:poison,data:poison}]});
  Sentry.logger.info(poison);Sentry.metrics.count(poison,1);Sentry.captureCheckIn({monitorSlug:poison,status:'ok'});
  await Sentry.startSpan({name:poison},async()=>undefined);
 });
 expect((await request(app,new Request('https://puptime.test/scenario'))).status).toBe(204);
 const received=await records();expect(received).toHaveLength(1);expect(received[0].body).not.toContain(poison);
 expect(decoded(received[0].body)[1].map(([h])=>h.type)).toEqual(['event']);
});

test('concurrent requests retain two isolated diagnostics without either account or puppy details',async()=>{
 const response=await Promise.all([1,2].map(i=>request(worker,new Request('https://puptime.test/api/config?account='+poison+i),{...env,get CLOUD_TRIAL_DAYS():string{throw new Error(poison+i);}})));
 expect(response.map(r=>r.status)).toEqual([503,503]);const received=await records();expect(received).toHaveLength(2);
 expect(JSON.stringify(received)).not.toContain(poison);
 const ids=received.map(row=>(decoded(row.body)[1][0][1] as {event_id:string}).event_id);expect(new Set(ids).size).toBe(2);
});

test('an actual Durable Object RPC failure preserves HTTP503 and reports once without SQL',async()=>{
 const store=env.ACCOUNTS.get(env.ACCOUNTS.idFromName(crypto.randomUUID()));
 await runInDurableObject(store,(_instance,state)=>{state.storage.sql.exec('DROP TABLE pets');});
 const app=scenario(async settings=>{await settings.ACCOUNTS.get(settings.ACCOUNTS.idFromString(store.id.toString())).summary();});
 expect((await request(app,new Request('https://puptime.test/scenario'))).status).toBe(503);
 await expect.poll(records).toHaveLength(1);
 const received=await records();expect(received[0].body).not.toContain('SELECT');expect(received[0].body).not.toContain('records WHERE');
 expect(decoded(received[0].body)[1].map(([h])=>h.type)).toEqual(['event']);
});

test('a late real DO export-stream failure is reported after the RPC scope without a completion footer',async()=>{
 const store=env.ACCOUNTS.get(env.ACCOUNTS.idFromName(crypto.randomUUID()));
 await store.enroll({operationId:crypto.randomUUID(),deviceId:'sentry-test-device',localPetId:'sentry-test-pet',name:poison});
 await store.apply({protocolVersion:1,operationId:crypto.randomUUID(),deviceId:'sentry-test-device',recordId:'sentry-test-event',petId:'sentry-test-pet',kind:'event',baseRevision:0,intent:'create',patch:{type:'pee',at:100,source:'app',note:poison}});
 await runInDurableObject(store,(_instance,state)=>{state.storage.sql.exec("UPDATE revisions SET body='[]'");});
 const response=await store.exportStream();expect(response.status).toBe(200);
 await expect(response.arrayBuffer()).rejects.toThrow();
 await expect.poll(records).toHaveLength(1);
 const received=await records();expect(received[0].body).not.toContain(poison);expect(received[0].body).not.toContain('SELECT');
});

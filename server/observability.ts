import * as Sentry from '@sentry/cloudflare';
import type { CloudflareOptions } from '@sentry/cloudflare';
import type { Envelope, EventItem, ErrorEvent, Integration, StackFrame } from '@sentry/core';
import { wrapRequestHandler } from '@sentry/cloudflare/request';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { ReconciliationError } from '../src/cloud/reconcile';

// The public request wrapper deliberately leaves D1/RPC bindings untouched.
Sentry.setAsyncLocalStorageAsyncContextStrategy();

const sourceFiles=new Set(['index.js','worker.js','puptime-api-staging','index.ts','account-store.ts','account-routes.ts','account-lifecycle.ts','account-reauth.ts','auth.ts','auth-timestamps.ts','entitlements.ts','observability.ts']);
const routes=new Set(['GET /health','GET /api/config','GET /api/account','DELETE /api/account','POST /api/account/export','GET /api/account/export','GET /api/pull','POST /api/push','GET /api/changes','POST /api/enroll']);
const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const hexId=/^[0-9a-f]{32}$/i;
const environment=(env:Cloudflare.Env)=>env.ENVIRONMENT==='production'?'production':env.ENVIRONMENT==='staging'?'staging':'local';

export function unexpectedError(error:unknown):boolean {
  return !(error instanceof z.ZodError || error instanceof ReconciliationError || (error instanceof HTTPException && error.status<500));
}
function configuredDsn(env:Cloudflare.Env):string|undefined {
  if(!env.SENTRY_DSN)return;
  try {
    const url=new URL(env.SENTRY_DSN);
    const local=env.ENVIRONMENT==='local'&&url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname);
    const hosted=url.protocol==='https:'&&/^o\d+\.ingest(?:\.(?:de|us))?\.sentry\.io$/.test(url.hostname);
    if((local||hosted)&&url.username&&!url.password&&/^\/\d+$/.test(url.pathname)&&!url.search&&!url.hash)return env.SENTRY_DSN;
  }catch{ /* Invalid/missing configuration disables diagnostics. */ }
}
function sourceFile(value:unknown):string|undefined {
  if(typeof value!=='string')return;
  const name=value.split(/[\\/]/).at(-1);
  return name&&sourceFiles.has(name)?name:undefined;
}
function frames(input:StackFrame[]|undefined):StackFrame[]|undefined {
  const safe=input?.slice(-30).flatMap(frame=>{
    const filename=sourceFile(frame.filename);
    if(!filename)return [];
    return [{filename,...(Number.isSafeInteger(frame.lineno)&&frame.lineno!>0&&frame.lineno!<=10_000_000?{lineno:frame.lineno}:{}),...(Number.isSafeInteger(frame.colno)&&frame.colno!>=0&&frame.colno!<=10_000_000?{colno:frame.colno}:{}),in_app:true}];
  });
  return safe?.length?safe:undefined;
}
function safeEvent(event:ErrorEvent,env:Cloudflare.Env):ErrorEvent|null {
  if(!hexId.test(event.event_id??''))return null;
  const exception=event.exception?.values?.[0];
  const type=['Error','TypeError','RangeError','ReferenceError','SyntaxError','URIError','EvalError'].includes(exception?.type??'')?exception!.type:'Error';
  const stack=frames(exception?.stacktrace?.frames);
  const images=event.debug_meta?.images?.slice(0,8).flatMap(image=>{
    const code_file=sourceFile('code_file' in image?image.code_file:undefined);
    return image.type==='sourcemap'&&'debug_id' in image&&uuid.test(String(image.debug_id))&&code_file?[{type:'sourcemap' as const,debug_id:String(image.debug_id),code_file}]:[];
  });
  return {
    type:undefined,event_id:event.event_id,timestamp:Date.now()/1000,platform:'javascript',level:'error',
    environment:environment(env),
    ...(env.SENTRY_RELEASE&&/^[0-9a-f]{40}$/.test(env.SENTRY_RELEASE)?{release:`puptime-api@${env.SENTRY_RELEASE}`} : {}),
    tags:{surface:'api'},
    ...(event.transaction&&routes.has(event.transaction)?{transaction:event.transaction}:{}),
    exception:{values:[{type,value:'Unexpected Puptime API error',...(stack?{stacktrace:{frames:stack}}:{})}]},
    ...(images?.length?{debug_meta:{images}}:{}),
  };
}
function boundary(env:Cloudflare.Env):Integration {
  return {name:'PuptimeErrorAllowlist',setup(client){
    // The final envelope boundary also excludes attachments and SDK-added
    // session/log/metric/span items, not just fields on an error event.
    client.on('beforeEnvelope',(envelope:Envelope)=>{
      const items:EventItem[]=[];
      for(const [header,payload] of envelope[1]) {
        if(header.type!=='event'||!payload||typeof payload!=='object')continue;
        const event=safeEvent(payload as ErrorEvent,env);
        if(event)items.push([{type:'event'},event]);
      }
      // Relay identifies the event from this header, not the payload's ID.
      // Derive it only from the already sanitized event, never the input header.
      envelope[0]={...(items[0]?{event_id:items[0][1].event_id}:{}),sdk:{name:'sentry.javascript.cloudflare',version:Sentry.SDK_VERSION},sent_at:new Date().toISOString()};
      envelope[1]=items;
    });
  }};
}

export function apiSentryOptions(env:Cloudflare.Env):CloudflareOptions {
  const dsn=configuredDsn(env);
  return {
    dsn,enabled:Boolean(dsn),debug:false,cacheClient:false,
    environment:environment(env),
    ...(env.SENTRY_RELEASE&&/^[0-9a-f]{40}$/.test(env.SENTRY_RELEASE)?{release:`puptime-api@${env.SENTRY_RELEASE}`} : {}),
    defaultIntegrations:false,integrations:[boundary(env)],
    maxBreadcrumbs:0,beforeBreadcrumb:()=>null,sendClientReports:false,
    tracesSampleRate:0,tracesSampler:()=>0,tracePropagationTargets:[],rpcTracePropagationBindings:[],
    beforeSendLog:()=>null,beforeSendMetric:()=>null,
    dataCollection:{userInfo:false,cookies:false,httpHeaders:false,httpBodies:[],urlQueryParams:false,databaseQueryData:false,queues:false,stackFrameVariables:false,frameContextLines:0,graphQL:{document:false,variables:false},genAI:{inputs:false,outputs:false}},
    transportOptions:{bufferSize:8},
    beforeSend(event,hint){
      if(!unexpectedError(hint.originalException))return null;
      hint.attachments=[];
      return safeEvent(event,env);
    },
  };
}

export function reportExportFailure(error:unknown,env:Cloudflare.Env,context:DurableObjectState):void {
  try {
    const options=apiSentryOptions(env);
    if(!options.enabled||!unexpectedError(error))return;
    // A stream can fail after the RPC returned and its SDK scope was disposed.
    // Use the official isolated client lifecycle for that late error only.
    context.waitUntil(wrapRequestHandler({options,request:new Request('https://account.internal/export'),context:{waitUntil:promise=>context.waitUntil(promise),passThroughOnException(){}}},()=>{
      Sentry.captureException(error);
      return new Response(null,{status:204});
    }).then(()=>undefined,()=>undefined));
  }catch{ /* Diagnostics cannot change export success/failure or local data. */ }
}

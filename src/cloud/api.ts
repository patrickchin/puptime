import { z } from 'zod';
import { enrollmentSchema, identifierSchema, mutationSchema, pullPageSchema, pushResponseSchema, recordIdSchema, revisionSchema, type Enrollment, type Mutation, type Revision } from './protocol.ts';
import {localRecordId} from './record-identity.ts';

// React Native's maintained AbortController polyfill exposes aborted, but not
// the newer throwIfAborted()/reason API. Preserve native and browser cancellation.
export function throwIfAborted(signal?:AbortSignal):void {
  if(signal?.aborted)throw signal.reason??Object.assign(new Error('Aborted'),{name:'AbortError'});
}
export function cloudBaseUrl(value:string|undefined,allowLocal=false):string|null {
  if (!value) return null;
  const url=new URL(value),host=url.hostname.toLowerCase();
  if (url.username||url.password||url.search||url.hash||url.pathname!=='/'
    ||host==='harpapro.com'||host.endsWith('.harpapro.com')
    ||(url.protocol!=='https:'&&!(allowLocal&&url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(host)))) throw new Error('Invalid Puptime cloud origin.');
  return url.origin;
}
export const cloudConfigSchema=z.strictObject({protocolVersion:z.literal(1),trialDays:z.number().int().min(1).max(30).default(14),providers:z.strictObject({apple:z.boolean(),google:z.boolean(),email:z.boolean()}),pricingFinalized:z.boolean()});
export const cloudAccessSchema=z.strictObject({canSync:z.boolean(),canExport:z.boolean(),source:z.enum(['none','trial','paid']),expiresAt:z.number().int().min(0).max(8640000000000000).nullable()})
  .refine(value=>value.canSync===(value.source!=='none')&&(value.source==='none'?value.expiresAt===null:value.expiresAt!==null));
export const cloudAccountSchema=z.strictObject({user:z.strictObject({id:identifierSchema,email:z.email().max(320),name:z.string().max(256)}),cloud:cloudAccessSchema,pets:z.array(z.strictObject({id:identifierSchema,name:z.string().min(1).max(256),eventCount:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)}))});
export type CloudConfig=z.infer<typeof cloudConfigSchema>;
export type CloudAccountSummary=z.infer<typeof cloudAccountSchema>;
export type CloudErrorCategory='network'|'invalid-request'|'invalid-response'|'auth-required'|'expired'|'forbidden'|'conflict'|'account-deleted'|'rate-limited'|'server-error';
export class CloudApiError extends Error {
  readonly category:CloudErrorCategory;
  readonly status:number;
  readonly retryAfterMs:number|null;
  constructor(category:CloudErrorCategory,status=0,retryAfterMs:number|null=null) {super(category);this.name='CloudApiError';this.category=category;this.status=status;this.retryAfterMs=retryAfterMs;}
}
type RequestOptions={method:'GET'|'POST';body?:object;signal?:AbortSignal};
type RequestResult={data:unknown;error:{status:number}|null;retryAfter?:string|null};
export type CloudRequest=(path:string,options:RequestOptions)=>Promise<RequestResult>;
type SdkOptions=RequestOptions&{params?:{recordId:string};redirect:'error';credentials:'omit';retry:0;timeout:number;onResponse:(context:{response:Response})=>void};
const historyRecordId=recordIdSchema.refine(value=>value!=='.'&&value!=='..');
const historyCursor=z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
function historyRoute(path:string,options:RequestOptions):{recordId:string;beforeRevision?:string}|null {
  const match=/^\/api\/records\/([^/?#]+)\/history(?:\?beforeRevision=([1-9]\d*))?$/.exec(path);
  if(!match||options.method!=='GET'||options.body!==undefined)return null;
  try {
    const id=decodeURIComponent(match[1]);
    if(!historyRecordId.safeParse(id).success||encodeURIComponent(id)!==match[1]
      ||(match[2]!==undefined&&!historyCursor.safeParse(Number(match[2])).success))return null;
    return {recordId:id,beforeRevision:match[2]};
  } catch {return null;}
}
export function createSdkRequest(fetchClient:(url:string,options:SdkOptions)=>Promise<Omit<RequestResult,'retryAfter'>>,origin:string):CloudRequest {
  const base=cloudBaseUrl(origin,true);if (!base) throw new Error('Cloud origin is missing.');
  return async(path,options)=>{
    const history=historyRoute(path,options);
    if (!/^\/api\/(?:config|account|cloud\/(?:trial|enroll)|sync\/push|sync\/pull\?after=\d+)$/.test(path)&&!history) throw new CloudApiError('invalid-request',400);
    throwIfAborted(options.signal);
    let retryAfter:string|null=null;
    // Better Auth encodes path parameters itself; a pre-encoded literal ID would
    // be encoded twice and silently query history for a different record.
    const sdkPath=history?`/api/records/:recordId/history${history.beforeRevision===undefined?'':`?beforeRevision=${history.beforeRevision}`}`:path;
    const result=await fetchClient(`${base}${sdkPath}`,{...options,...(history?{params:{recordId:history.recordId}}:{}),redirect:'error',credentials:'omit',retry:0,timeout:15000,onResponse:({response})=>{retryAfter=response.headers.get('retry-after');}});
    return {...result,retryAfter};
  };
}
function retryDelay(value:string|null|undefined):number|null {
  if (!value) return null;
  const milliseconds=/^\d+$/.test(value)?Number(value)*1000:Date.parse(value)-Date.now();
  return Number.isFinite(milliseconds)?Math.max(0,Math.min(60000,milliseconds)):null;
}
function category(status:number):CloudErrorCategory {
  const categories:Record<number,CloudErrorCategory>={401:'auth-required',402:'expired',403:'forbidden',409:'conflict',410:'account-deleted',429:'rate-limited'};
  return categories[status]??(status>=500?'server-error':'invalid-request');
}
export function createCloudApi(request:CloudRequest) {
  async function call<Schema extends z.ZodType>(path:string,schema:Schema,body?:object,signal?:AbortSignal):Promise<z.infer<Schema>> {
    throwIfAborted(signal);
    let result:RequestResult;
    try {result=await request(path,{method:body?'POST':'GET',...(body?{body}:{}),signal});}
    catch {throwIfAborted(signal);throw new CloudApiError('network');}
    throwIfAborted(signal);
    if (result.error) throw new CloudApiError(category(result.error.status),result.error.status,retryDelay(result.retryAfter));
    const parsed=schema.safeParse(result.data);
    if (!parsed.success) throw new CloudApiError('invalid-response');
    return parsed.data;
  }
  return {
    config:(signal?:AbortSignal)=>call('/api/config',cloudConfigSchema,undefined,signal),
    account:(signal?:AbortSignal)=>call('/api/account',cloudAccountSchema,undefined,signal),
    startTrial:(signal?:AbortSignal)=>call('/api/cloud/trial',z.strictObject({cloud:cloudAccessSchema}),{},signal),
    async enroll(input:Enrollment,signal?:AbortSignal) {
      const request=enrollmentSchema.parse(input);
      return call('/api/cloud/enroll',z.strictObject({petId:identifierSchema}).refine(value=>value.petId===(request.confirmedPetId??request.localPetId)),request,signal);
    },
    async push(input:Mutation[],signal?:AbortSignal) {
      const mutations=z.array(mutationSchema).min(1).max(50).parse(input);
      const ids=new Set(mutations.map(mutation=>mutation.operationId));
      if (ids.size!==mutations.length||new TextEncoder().encode(JSON.stringify({mutations})).byteLength>=65536) throw new CloudApiError('invalid-request',400);
      return call('/api/sync/push',pushResponseSchema.refine(response=>response.accepted.length+response.rejected.length===ids.size&&[...response.accepted,...response.rejected].every(result=>ids.has(result.operationId))),{mutations},signal);
    },
    async pull(after:number,signal?:AbortSignal) {z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).parse(after);return call(`/api/sync/pull?after=${after}`,pullPageSchema,undefined,signal);},
    async history(recordId:string,beforeRevision?:number,signal?:AbortSignal):Promise<{revisions:Revision[]}> {
      historyRecordId.parse(recordId);if(beforeRevision!==undefined)historyCursor.parse(beforeRevision);
      const page=z.strictObject({revisions:z.array(revisionSchema).max(50)}).refine(({revisions})=>{
        try{return revisions.every((revision,index)=>{
          localRecordId(revision.after);
          return revision.recordId===recordId&&(beforeRevision===undefined||revision.revision<beforeRevision)
            && (index===0||(revision.revision<revisions[index-1].revision&&revision.sequence<revisions[index-1].sequence));
        });}catch{return false;}
      },'Invalid history scope or page order.');
      return call(`/api/records/${encodeURIComponent(recordId)}/history${beforeRevision===undefined?'':`?beforeRevision=${beforeRevision}`}`,page,undefined,signal);
    },
  };
}
export type CloudApi=ReturnType<typeof createCloudApi>;

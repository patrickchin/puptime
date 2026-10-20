import {z} from 'zod';
import {cloudBaseUrl,cloudErrorCategory,CloudApiError} from './api.ts';
import {identifierSchema} from './protocol.ts';

export const appleRevocationSchema=z.enum(['not-linked','revoked','manual']);
export const deletionReceiptSchema=z.string().regex(/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/);
const timestamp=z.number().int().min(0).max(8640000000000000);
const date=z.union([z.date(),z.string(),timestamp]).transform(value=>new Date(value).getTime()).pipe(timestamp);
const identitySchema=z.object({user:z.object({id:identifierSchema,email:z.email().max(320),name:z.string().max(256)}),session:z.object({id:identifierSchema,createdAt:date,expiresAt:date})});
const statusSchema=z.union([
 z.strictObject({status:z.enum(['not-started','pending','unknown'])}),
 z.strictObject({status:z.literal('deleted'),appleRevocation:appleRevocationSchema}),
]);
export type LifecycleIdentity=z.infer<typeof identitySchema>;
export type DeletionStatus=z.infer<typeof statusSchema>;
type SdkOptions={method:'GET'|'POST'|'DELETE';body?:object;headers?:Record<string,string>;credentials:'omit';redirect:'error';retry:0;timeout:number;signal:AbortSignal;onResponse:(context:{response:Response})=>Promise<void>};
type SdkResult={data:unknown;error:{status:number}|null};
type SocialResult={data?:unknown;error:{status:number}|null};
type Client={fetch:(path:string,options:SdkOptions)=>Promise<SdkResult>;social:(body:{provider:'apple'|'google';callbackURL:string;errorCallbackURL:string},options:{headers:Record<string,string>;body?:{receipt:string};credentials:'omit';redirect:'error';retry:0;timeout:number;signal:AbortSignal;onResponse:(context:{response:Response})=>Promise<void>})=>Promise<SocialResult>;dismissBrowser?:()=>void};

async function lifecycleBody(response:Response,signal:AbortSignal):Promise<string>{
 if(signal.aborted)throw new CloudApiError('network');
 const reader=response.clone().body?.getReader();if(!reader)throw new CloudApiError('invalid-response');
 let abort!:()=>void,complete=false,length=0;const chunks:Uint8Array[]=[];
 const aborted=new Promise<never>((_,reject)=>{abort=()=>reject(new CloudApiError('network'));signal.addEventListener('abort',abort,{once:true});});
 try{
  while(true){
   const part=await Promise.race([reader.read(),aborted]);
   if(part.done){complete=true;break;}
   length+=part.value.byteLength;if(length>65536)throw new CloudApiError('invalid-response');chunks.push(part.value);
  }
  if(signal.aborted)throw new CloudApiError('network');
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  return new TextDecoder('utf-8',{fatal:true,ignoreBOM:false}).decode(bytes);
 }finally{
  signal.removeEventListener('abort',abort);
  if(!complete){void reader.cancel().catch(()=>{});void response.body?.cancel().catch(()=>{});}reader.releaseLock();
 }
}

// Keep all session, cookie and native browser handling in the installed SDK.
// A successful OAuth initiation alone never proves that its browser completed.
export function createAccountLifecycleClient(client:Client,origin:string,{requestTimeoutMs=15000,deletionTimeoutMs=60000}:{requestTimeoutMs?:number;deletionTimeoutMs?:number}={}) {
 const base=cloudBaseUrl(origin,true);if(!base)throw new Error('Cloud origin is missing.');
 const ownerHeaders=(accountId:string)=>({'x-puptime-account':identifierSchema.parse(accountId)});
 async function call<Schema extends z.ZodType>(path:string,schema:Schema,body?:object,accountId?:string,method:'GET'|'POST'|'DELETE'=body?'POST':'GET'):Promise<z.infer<Schema>> {
  let result:SdkResult;
  const timeout=method==='DELETE'?deletionTimeoutMs:requestTimeoutMs,aborter=new AbortController(),timer=setTimeout(()=>aborter.abort(),timeout);
  // Better Fetch stops its timeout at headers. Drain a bounded clone before
  // its JSON/cookie hooks, retaining the original native response and headers.
  try{result=await client.fetch(base+path,{method,...(body?{body}:{}),...(accountId?{headers:ownerHeaders(accountId)}:{}),credentials:'omit',redirect:'error',retry:0,timeout,signal:aborter.signal,onResponse:async({response})=>{await lifecycleBody(response,aborter.signal);}});if(aborter.signal.aborted)throw new CloudApiError('network');}
  catch(error){throw error instanceof CloudApiError?error:new CloudApiError('network');}
  finally{clearTimeout(timer);}
  if(result.error)throw new CloudApiError(result.error.status?cloudErrorCategory(result.error.status):'network',result.error.status);
  const parsed=schema.safeParse(result.data);if(!parsed.success)throw new CloudApiError('invalid-response');return parsed.data;
 }
 async function socialProof(accountId:string,provider:'apple'|'google',started:(intentId:string)=>boolean|void,receipt?:string){
   identifierSchema.parse(accountId);z.enum(['apple','google']).parse(provider);if(receipt!==undefined)deletionReceiptSchema.parse(receipt);
   const intentSchema=receipt===undefined?z.object({reauthIntentId:z.uuid()}):z.object({recoveryIntentId:z.uuid()});
   function intentId(data:unknown){const value=intentSchema.safeParse(data);if(!value.success)throw new CloudApiError('invalid-response');return 'recoveryIntentId' in value.data?value.data.recoveryIntentId:value.data.reauthIntentId;}
   let result:SocialResult;
   const aborter=new AbortController(),timer=setTimeout(()=>aborter.abort(),requestTimeoutMs);
   try{result=await client.social({provider,callbackURL:'puptime://account',errorCallbackURL:'puptime://account'},{headers:{...ownerHeaders(accountId),'x-puptime-reauth':receipt===undefined?'account-deletion':'account-deletion-recovery'},...(receipt===undefined?{}:{body:{receipt}}),credentials:'omit',redirect:'error',retry:0,timeout:requestTimeoutMs,signal:aborter.signal,onResponse:async({response})=>{
    const body=await lifecycleBody(response,aborter.signal);
    if(!response.ok)return;
    const id=intentId(await Promise.resolve().then(()=>JSON.parse(body)).catch(()=>null));
    // Refuse an old server's ordinary signup response before Expo opens it.
    if(started(id)===false)throw new CloudApiError('conflict');
    clearTimeout(timer); // The following native browser waits for the person.
   }});}
   catch(error){if(error instanceof CloudApiError)throw error;throw new CloudApiError('network');}
   finally{clearTimeout(timer);}
   if(result.error)throw new CloudApiError(result.error.status?cloudErrorCategory(result.error.status):'network',result.error.status);
   return intentId(result.data);
 }
 async function identity():Promise<LifecycleIdentity|null>{return call('/api/auth/get-session',identitySchema.nullable());}
 return {
  identity,
  async requestEmail(accountId:string){
   const current=await identity();if(!current)throw new CloudApiError('auth-required',401);
   if(current.user.id!==accountId)throw new CloudApiError('conflict',409);
   await call('/api/auth/email-otp/send-verification-otp',z.object({success:z.literal(true)}),{email:current.user.email,type:'sign-in'});
  },
  async verifyEmail(accountId:string,code:string){
   if(!/^\d{6}$/.test(code))throw new CloudApiError('invalid-request',400);
   // This route derives the original user's email and disables account signup.
   await call('/api/account/reauth',z.object({user:z.object({id:z.literal(accountId)})}),{otp:code},accountId);
  },
  reauthenticate:(accountId:string,provider:'apple'|'google',started:(intentId:string)=>boolean|void)=>socialProof(accountId,provider,started),
  recoverSocial:(accountId:string,receipt:string,provider:'apple'|'google',started:(intentId:string)=>boolean|void)=>socialProof(accountId,provider,started,deletionReceiptSchema.parse(receipt)),
  requestRecoveryEmail:(accountId:string,receipt:string)=>call('/api/account/recovery/email/start',z.object({success:z.literal(true),recoveryIntentId:z.uuid()}),{receipt:deletionReceiptSchema.parse(receipt)},accountId),
  async verifyRecoveryEmail(accountId:string,receipt:string,intentId:string,code:string){
   if(!/^\d{6}$/.test(code))throw new CloudApiError('invalid-request',400);
   await call('/api/account/recovery/email/verify',z.object({user:z.object({id:z.literal(accountId)})}),{receipt:deletionReceiptSchema.parse(receipt),intentId:z.uuid().parse(intentId),otp:code},accountId);
  },
  cancelRecovery:(accountId:string,receipt:string,intentId:string)=>{client.dismissBrowser?.();return call('/api/account/recovery/cancel',z.object({success:z.literal(true)}),{receipt:deletionReceiptSchema.parse(receipt),intentId:z.uuid().parse(intentId)},accountId);},
  cancelReauthentication:(accountId:string,intentId:string)=>{client.dismissBrowser?.();return call('/api/account/reauth/cancel',z.object({success:z.literal(true)}),{intentId:z.string().uuid().parse(intentId)},accountId);},
  prepare:(accountId:string)=>call('/api/account/deletion/prepare',z.strictObject({receipt:deletionReceiptSchema,expiresAt:timestamp}),{},accountId),
  remove:(accountId:string,receipt:string)=>call('/api/account',z.object({success:z.literal(true),appleRevocation:appleRevocationSchema}),{confirm:true,receipt:deletionReceiptSchema.parse(receipt)},accountId,'DELETE'),
  status:(receipt:string):Promise<DeletionStatus>=>call('/api/account/deletion/status',statusSchema,{receipt:deletionReceiptSchema.parse(receipt)}),
 };
}
export type AccountLifecycle=ReturnType<typeof createAccountLifecycleClient>;

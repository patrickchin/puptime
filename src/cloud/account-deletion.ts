import { z } from 'zod';
import {cloudBaseUrl} from './api.ts';

export class AccountDeletionError extends Error {
 readonly kind:'auth'|'mismatch'|'reauth'|'code'|'rate'|'service'|'network'|'unconfirmed';
 constructor(kind:AccountDeletionError['kind']){super(kind);this.kind=kind;}
}
type Fetch=(url:string,options:{method:'GET'|'POST'|'DELETE';body?:object;headers?:Record<string,string>;query?:Record<string,boolean>;retry:0;redirect:'error';timeout:number})=>Promise<{data:unknown;error:{status:number;error?:unknown}|null}>;
const sessionSchema=z.object({user:z.object({id:z.string().min(1),email:z.email()}),session:z.object({createdAt:z.coerce.date()})});

// Uses the existing Expo/Better Auth SDK transport and SecureStore, never a browser cookie jar.
export function createAccountDeletionApi(fetch:Fetch,origin:string){
 const base=cloudBaseUrl(origin,true);if(!base)throw new Error('Cloud origin is missing.');
 async function call(path:string,method:'GET'|'POST'|'DELETE',expected?:string,body?:object){
  let result;
  try{result=await fetch(base+path,{method,body,...(expected?{headers:{'x-puptime-account':expected}}:{}),...(path.endsWith('/get-session')?{query:{disableCookieCache:true}}:{}),retry:0,redirect:'error',timeout:15000});}
  catch{throw new AccountDeletionError('network');}
  if(result.error){const {status,error}=result.error;throw new AccountDeletionError(error==='reauthentication_required'?'reauth':status===409?'mismatch':status===401?'auth':status===429?'rate':status>=500?'service':'code');}
  return result.data;
 }
 async function sameUser(expected:string){
  const value=await call('/api/auth/get-session','GET');if(!value)throw new AccountDeletionError('auth');
  const session=sessionSchema.safeParse(value);if(!session.success)throw new AccountDeletionError('service');
  if(session.data.user.id!==expected)throw new AccountDeletionError('mismatch');return session.data;
 }
 async function freshUser(expected:string){
  const value=await sameUser(expected),age=Date.now()-value.session.createdAt.getTime();
  if(!Number.isFinite(age)||age<0||age>=600000)throw new AccountDeletionError('reauth');return value;
 }
 return {
  check:async(expected:string)=>{await freshUser(expected);},
  requestCode:async(expected:string)=>{const value=await sameUser(expected);await call('/api/auth/email-otp/send-verification-otp','POST',undefined,{email:value.user.email,type:'sign-in'});},
  verify:async(expected:string,otp:string)=>{if(!/^\d{6}$/.test(otp))throw new AccountDeletionError('code');await sameUser(expected);await call('/api/account/reauth','POST',expected,{otp});await freshUser(expected);},
  async remove(expected:string,beforeDispatch:()=>Promise<void>){
   await freshUser(expected);await beforeDispatch();
   try{
    const value=await call('/api/account','DELETE',expected,{confirm:true});
    const reply=z.object({success:z.literal(true),message:z.literal('User deleted'),appleRevocation:z.unknown().optional()}).safeParse(value);
    if(!reply.success)throw new AccountDeletionError('unconfirmed');
    return {appleManual:!['not-linked','revoked'].includes(String(reply.data.appleRevocation))};
   }catch(error){if(error instanceof AccountDeletionError&&['auth','network','service'].includes(error.kind))throw new AccountDeletionError('unconfirmed');throw error;}
  },
 };
}
export type AccountDeletionApi=ReturnType<typeof createAccountDeletionApi>;

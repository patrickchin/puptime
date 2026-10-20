import { createAuthClient } from 'better-auth/react';
import { emailOTPClient } from 'better-auth/client/plugins';
import { z } from 'zod';
import { cloudAccountSchema, cloudConfigSchema } from '../cloud/api.ts';

export type Provider='apple'|'google';
type AccountErrorKind='network'|'service'|'auth'|'mismatch'|'reauth'|'code'|'rate'|'unconfirmed'|'storage';
export class AccountError extends Error {
 readonly kind:AccountErrorKind;
 constructor(kind:AccountErrorKind){super(kind);this.kind=kind;}
}
export function checkResult<T>(result:{data:T;error:{status:number}|null}):T {
 if(result.error)throw new AccountError(result.error.status===409?'mismatch':result.error.status===429?'rate':result.error.status>=500?'service':result.error.status===401?'auth':'code');
 return result.data;
}
// Browser credentials stay in the server's HttpOnly cookies. Native SecureStore
// and the puppy synchronization controller deliberately are not imported here.
export function createWebAccountClient(origin:string,customFetchImpl:typeof fetch=fetch){
 const url=new URL(origin);
 if(url.origin!==origin||url.username||url.password||url.hostname==='harpapro.com'||url.hostname.endsWith('.harpapro.com')
  ||(url.protocol!=='https:'&&!(url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname))))throw new Error('Invalid account origin.');
 const auth=createAuthClient({baseURL:origin,plugins:[emailOTPClient()],fetchOptions:{customFetchImpl,credentials:'include',redirect:'error',timeout:15000,retry:0}});
 async function json(path:'/api/account'|'/api/config',method:'GET'|'DELETE'='GET',expected?:string){
  try{
   const result=await auth.$fetch<unknown>(origin+path,{method,credentials:'include',redirect:'error',retry:0,...(method==='DELETE'?{body:{confirm:true},headers:{'x-puptime-account':z.string().min(1).parse(expected)}}:{})});
   if(result.error){
    const detail=(result.error as {error?:unknown}).error;
    throw new AccountError(detail==='reauthentication_required'?'reauth':detail==='account_mismatch'?'mismatch':result.error.status===401?'auth':result.error.status===429?'rate':'service');
   }
   return result.data;
  }catch(error){if(error instanceof AccountError)throw error;throw new AccountError('network');}
 }
 async function sameUser(expected:string){
  const session=checkResult(await auth.getSession({query:{disableCookieCache:true}}));
  if(!session)throw new AccountError('auth');if(session.user.id!==expected)throw new AccountError('mismatch');return session;
 }
 async function freshUser(expected:string){
  const session=await sameUser(expected);
  const age=Date.now()-new Date(session.session.createdAt).getTime();if(!Number.isFinite(age)||age<0||age>=600000)throw new AccountError('reauth');
  return session;
 }
 return {auth,origin,
  async config(){return cloudConfigSchema.parse(await json('/api/config'));},
  async summary(expected:string){await sameUser(expected);const value=cloudAccountSchema.parse(await json('/api/account'));if(value.user.id!==expected)throw new AccountError('mismatch');return value;},
  async providers(expected:string){
   await sameUser(expected);const rows=checkResult(await auth.listAccounts());
   const accounts=z.array(z.object({userId:z.string().min(1),providerId:z.string().min(1)})).parse(rows);
   if(accounts.some(account=>account.userId!==expected))throw new AccountError('mismatch');
   return [...new Set(accounts.map(account=>account.providerId).filter((provider):provider is Provider=>provider==='apple'||provider==='google'))];
  },
  async link(provider:Provider,expected:string){await sameUser(expected);return checkResult(await auth.linkSocial({provider,callbackURL:origin+'/account',errorCallbackURL:origin+'/account',fetchOptions:{headers:{'x-puptime-account':expected}}}));},
  async reauthenticate(expected:string,otp:string){
   await sameUser(expected);
   checkResult(await auth.$fetch(origin+'/api/account/reauth',{method:'POST',body:{otp},headers:{'x-puptime-account':expected}}));
   await freshUser(expected);
  },
  async remove(expected:string,beforeDispatch:()=>void=()=>{}){
   await freshUser(expected);beforeDispatch();
   try{
    const value=await json('/api/account','DELETE',expected);
    const parsed=z.object({success:z.literal(true),message:z.literal('User deleted'),appleRevocation:z.unknown().optional()}).safeParse(value);
    if(!parsed.success)throw new AccountError('unconfirmed');
    const outcome=z.enum(['not-linked','revoked','manual']).safeParse(parsed.data.appleRevocation);
    return {appleRevocation:outcome.success?outcome.data:'manual' as const};
   }catch(error){if(error instanceof AccountError&&['network','auth','service'].includes(error.kind))throw new AccountError('unconfirmed');throw error;}
  },sameUser,freshUser,
 };
}
let client:ReturnType<typeof createWebAccountClient>|undefined;
export function getWebAccountClient(){
 if(typeof window==='undefined')throw new Error('Account client requires a browser.');
 return client??=createWebAccountClient(window.location.origin);
}

import { createAuthClient } from 'better-auth/client';
import { emailOTPClient } from 'better-auth/client/plugins';
import { z } from 'zod';
import { cloudBaseUrl } from '../cloud/api.ts';
import { AccountDeletionError, createAccountDeletionApi } from '../cloud/account-deletion.ts';

const identity=z.object({id:z.string().min(1),email:z.email()});
const optionsSchema=z.object({existingAccountOnly:z.literal(true),email:z.literal(true)});
export type DeletionIdentity=z.infer<typeof identity>;

// Browser cookies stay HttpOnly; no tokens, codes or identity are persisted by
// this page. The purpose header narrows sign-in to existing users server-side.
export function createWebDeletionClient(origin:string,customFetchImpl?:typeof fetch){
 const base=cloudBaseUrl(origin,true)!;
 const auth=createAuthClient({baseURL:base,plugins:[emailOTPClient()],fetchOptions:{
  credentials:'include',redirect:'error',retry:0,timeout:15000,
  headers:{'x-puptime-purpose':'account-deletion'},...(customFetchImpl?{customFetchImpl}:{}),
 }});
 const deletion=createAccountDeletionApi((url,options)=>auth.$fetch(url,options),base);
 function check(error:{status?:number}|null){
  if(error)throw new AccountDeletionError(error.status===429?'rate':(error.status??0)>=500?'service':'code');
 }
 async function ready(){
  const result=await auth.$fetch(base+'/api/account/deletion-options');
  if(result.error||!optionsSchema.safeParse(result.data).success)throw new AccountDeletionError('service');
 }
 return {
  async requestCode(email:string){await ready();check((await auth.emailOtp.sendVerificationOtp({email,type:'sign-in'})).error);},
  async verify(email:string,otp:string):Promise<DeletionIdentity>{
   if(!/^\d{6}$/.test(otp))throw new AccountDeletionError('code');
   await ready();
   const result=await auth.signIn.emailOtp({email,otp});check(result.error);
   const user=identity.safeParse(result.data?.user);
   if(!user.success||user.data.email.toLowerCase()!==email.toLowerCase())throw new AccountDeletionError('mismatch');
   return user.data;
  },
  remove:(expected:string)=>deletion.remove(expected,async()=>{}),
  async cancel(){check((await auth.signOut()).error);},
 };
}

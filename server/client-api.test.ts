import { env } from 'cloudflare:workers';
import { applyD1Migrations } from 'cloudflare:test';
import { createAuthClient } from 'better-auth/client';
import { emailOTPClient } from 'better-auth/client/plugins';
import { beforeAll, expect, inject, test } from 'vitest';
import { createCloudApi, createSdkRequest } from '../src/cloud/api';
import { cloudRecordId } from '../src/cloud/record-identity';
import worker from './index';
import * as controllers from '../src/cloud/account-controller';

beforeAll(()=>applyD1Migrations(env.AUTH_DB,inject('migrations')));

test('installed auth SDK signs in without billing and only explicit enrollment enables bounded sync',async()=>{
 const settings={...env,ENVIRONMENT:'local' as const,AUTH_BASE_URL:'https://puptime.test',WEB_ORIGINS:'https://puptime.test',AUTH_SECRET:'local-test-secret-with-at-least-32-characters'};
 const paths:string[]=[];let cookie='';
 // Test-only browser cookie transport. Native uses the official Expo plugin and
 // SecureStore; this test makes no claim about that native runtime boundary.
 const auth=createAuthClient({baseURL:'https://puptime.test',plugins:[emailOTPClient()],fetchOptions:{customFetchImpl:async(url,init)=>{
  paths.push(new URL(String(url)).pathname);
  const headers=new Headers(init?.headers);headers.set('origin','https://puptime.test');headers.set('cf-connecting-ip','192.0.2.199');
  if(cookie) headers.set('cookie',cookie);
  // workerd only supports follow/manual. Direct handler dispatch never follows
  // redirects, so manual represents the SDK's native redirect=error boundary.
  const response=await worker.fetch(new Request(String(url),{...init,headers,redirect:'manual'}),settings);
  const updates=response.headers.getSetCookie();if(updates.length) cookie=updates.map(value=>value.split(';')[0]).join('; ');
  return response;
 }}});
 expect(typeof controllers.createIdentityAdapter).toBe('function');
 const identity=controllers.createIdentityAdapter({emailOtp:auth.emailOtp,signIn:auth.signIn,linkSocial:auth.linkSocial,listAccounts:auth.listAccounts,signOut:auth.signOut,getCookie:async()=>cookie});
 const api=createCloudApi(createSdkRequest((url,options)=>auth.$fetch<unknown>(url,options),'https://puptime.test'));
 expect(await api.config()).toEqual({protocolVersion:1,providers:{apple:false,google:false,email:true}});
 const email=`sdk-${crypto.randomUUID()}@example.com`;
 expect((await identity.requestEmail(email)).error).toBeNull();
 const preview=await env.AUTH_DB.prepare('SELECT code FROM local_email_previews WHERE email=?').bind(email).first<{code:string}>();
 expect((await identity.verifyEmail(email,preview!.code)).error).toBeNull();
 expect(await identity.hasCredentials()).toBe(true);
 const signedIn=await api.account();expect(signedIn.cloud).toEqual({canSync:true,canExport:true});expect(signedIn.pets).toEqual([]);
 expect(paths).not.toContain('/api/cloud/trial');expect(paths).not.toContain('/api/cloud/enroll');expect(paths).not.toContain('/api/sync/push');
 expect(await env.AUTH_DB.prepare('SELECT account_id FROM cloud_accounts WHERE account_id=?').bind(signedIn.user.id).first()).toBeNull();
 const enrollment={operationId:'enroll-sdk',deviceId:'device-sdk',localPetId:'pet-sdk',name:'SDK puppy'};
 expect(await api.enroll(enrollment)).toEqual({petId:'pet-sdk'});
 const mutation={protocolVersion:1 as const,operationId:'operation-sdk',deviceId:'device-sdk',recordId:cloudRecordId('event','pet-sdk','活动-'.repeat(80)),petId:'pet-sdk',kind:'event' as const,baseRevision:0,intent:'create' as const,patch:{type:'pee' as const,at:100,source:'app' as const}};
 expect((await api.push([mutation])).accepted).toHaveLength(1);
 expect((await api.pull(0)).changes[0].id).toBe(mutation.recordId);
 expect(paths.every(path=>!path.includes('/api/auth/api/'))).toBe(true);
 expect((await identity.signOut()).error).toBeNull();
 await expect(api.account()).rejects.toMatchObject({category:'auth-required',status:401});
});

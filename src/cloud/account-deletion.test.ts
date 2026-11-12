import assert from 'node:assert/strict';
import test from 'node:test';
import {AccountDeletionError,createAccountDeletionApi} from './account-deletion.ts';

function fixture(){
 const calls:{path:string;options:unknown}[]=[],state={id:'usr_owner',createdAt:Date.now(),status:200,error:undefined as unknown,body:{success:true,message:'User deleted',appleRevocation:'revoked'} as unknown};
 const api=createAccountDeletionApi(async(url,options)=>{
  const path=new URL(url).pathname;calls.push({path,options});
  if(path.endsWith('/get-session'))return {data:{user:{id:state.id,email:'owner@example.invalid'},session:{createdAt:new Date(state.createdAt).toISOString()}},error:null};
  if(path.endsWith('/reauth'))state.createdAt=Date.now();
  return {data:state.body,error:state.status===200?null:{status:state.status,error:state.error}};
 },'https://puptime.test');return {api,state,calls};
}
test('native deletion checks immutable ownership and recency before persisting or dispatching',async()=>{
 const {api,state,calls}=fixture();let saved=0;
 state.id='usr_other';await assert.rejects(api.remove('usr_owner',async()=>{saved++;}),error=>error instanceof AccountDeletionError&&error.kind==='mismatch');
 state.id='usr_owner';state.createdAt=0;await assert.rejects(api.remove('usr_owner',async()=>{saved++;}),error=>error instanceof AccountDeletionError&&error.kind==='reauth');
 assert.equal(saved,0);assert.equal(calls.some(call=>call.path==='/api/account'),false);
 state.createdAt=Date.now();await assert.rejects(api.remove('usr_owner',async()=>{throw new Error('No storage');}));assert.equal(calls.some(call=>call.path==='/api/account'),false);
 await api.remove('usr_owner',async()=>{saved++;});assert.equal(saved,1);assert.deepEqual(calls.at(-1)?.options,{method:'DELETE',body:{confirm:true},headers:{'x-puptime-account':'usr_owner'},retry:0,redirect:'error',timeout:15000});
});
test('native verification uses the same-user endpoint and never the ordinary signup-capable endpoint',async()=>{
 const {api,calls,state}=fixture();state.createdAt=0;await api.requestCode('usr_owner');await api.verify('usr_owner','012345');
 const verify=calls.find(call=>call.path==='/api/account/reauth');assert.ok(verify);assert.deepEqual((verify.options as {body:object}).body,{otp:'012345'});assert.ok(calls.every(call=>call.path!=='/api/auth/sign-in/email-otp'));
 state.id='usr_other';const before=calls.length;await assert.rejects(api.verify('usr_owner','012345'));assert.equal(calls.length,before+1);
});
test('a lost or malformed deletion response stays uncertain and unknown Apple results request manual cleanup',async()=>{
 const {api,state}=fixture();state.status=503;await assert.rejects(api.remove('usr_owner',async()=>{}),error=>error instanceof AccountDeletionError&&error.kind==='unconfirmed');
 state.status=200;state.body={success:false};await assert.rejects(api.remove('usr_owner',async()=>{}),error=>error instanceof AccountDeletionError&&error.kind==='unconfirmed');
 state.body={success:true,message:'User deleted'};assert.deepEqual(await api.remove('usr_owner',async()=>{}),{appleManual:true});
});

test('native deletion refuses unsafe origins before credential transport is invoked',()=>{
 for(const origin of ['http://public.example','https://harpapro.com','https://puptime.test/account','https://user:secret@puptime.test'])assert.throws(()=>createAccountDeletionApi(async()=>{throw new Error('Never send credentials');},origin));
});

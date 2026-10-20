import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import test from 'node:test';
import {requestAppleIdToken} from './apple-native.ts';

const sha256=async(value:string)=>createHash('sha256').update(value).digest('hex');
test('each Apple system request binds a fresh secure nonce to the SDK token without inventing identity fields',async()=>{
 const sheetNonces:string[]=[];
 const options={isAvailable:async()=>true,randomBytes:async(count:number)=>randomBytes(count),sha256,signIn:async(nonce:string)=>{sheetNonces.push(nonce);return {identityToken:'signed-provider-token',fullName:{givenName:'Puppy',familyName:'Person'}};}};
 const first=await requestAppleIdToken(options),second=await requestAppleIdToken(options);
 assert.match(first!.nonce,/^[a-f0-9]{64}$/);assert.notEqual(first!.nonce,second!.nonce);
 assert.deepEqual(sheetNonces,[await sha256(first!.nonce),await sha256(second!.nonce)]);
 assert.deepEqual(first!.user,{name:{firstName:'Puppy',lastName:'Person'}});
 const returning=await requestAppleIdToken({...options,signIn:async()=>({identityToken:'returning-token',fullName:null})});
 assert.equal(returning!.user,undefined);assert.equal(returning!.token,'returning-token');
});

test('Apple cancellation is quiet, while unavailable, malformed nonce and missing-token results fail closed',async()=>{
 let sheets=0;
 const options={isAvailable:async()=>true,randomBytes:async(count:number)=>randomBytes(count),sha256,signIn:async()=>{sheets++;return {identityToken:'token'};}};
 assert.equal(await requestAppleIdToken({...options,signIn:async()=>{throw {code:'ERR_REQUEST_CANCELED'};}}),null);
 await assert.rejects(requestAppleIdToken({...options,isAvailable:async()=>false}),/unavailable/);
 await assert.rejects(requestAppleIdToken({...options,randomBytes:async()=>new Uint8Array(0)}),/nonce/);
 await assert.rejects(requestAppleIdToken({...options,sha256:async()=>''}),/nonce/);
 for(const identityToken of [null,'',' '])await assert.rejects(requestAppleIdToken({...options,signIn:async()=>({identityToken})}),/no identity token/);
 await assert.rejects(requestAppleIdToken({...options,signIn:async()=>{throw new Error('private provider response');}}),error=>error instanceof Error&&error.message==='Apple authentication did not complete.');
 assert.equal(sheets,0);
});

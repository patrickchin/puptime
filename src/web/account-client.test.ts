import assert from 'node:assert/strict';
import test from 'node:test';
import { AccountError, createWebAccountClient } from './account-client.ts';
const origin='https://puptime.test';
function fixture(){
 const calls:{url:string;method:string;headers:Headers;credentials:RequestCredentials|undefined}[]=[];
 const state={userId:'owner-a',createdAt:Date.now(),throwDelete:false,deleteStatus:200,deleteBody:{success:true,message:'User deleted'} as object};
 const client=createWebAccountClient(origin,async(input,init)=>{
  const url=String(input);calls.push({url,method:init?.method??'GET',headers:new Headers(init?.headers),credentials:init?.credentials});
  if(url.includes('/get-session'))return Response.json({session:{id:'session',userId:state.userId,createdAt:new Date(state.createdAt).toISOString(),expiresAt:new Date(Date.now()+3600000).toISOString()},user:{id:state.userId,email:'fixture@example.invalid',name:'Fixture'}});
  if(url.endsWith('/api/account')&&init?.method==='DELETE'){if(state.throwDelete)throw new TypeError('synthetic disconnect');return Response.json(state.deleteBody,{status:state.deleteStatus});}
  if(url.includes('/link-social'))return Response.json({url:'https://accounts.google.com/synthetic',redirect:false});
  if(url.endsWith('/list-accounts'))return Response.json([{userId:state.userId,providerId:'google',accessToken:'synthetic-private-field'}]);
  return Response.json({user:{id:state.userId,email:'fixture@example.invalid',name:'Fixture'},cloud:{canSync:false,canExport:true},pets:[]});
 });
 return {client,calls,state};
}
test('browser account operations use same-origin SDK cookies and immutable expected-user headers',async()=>{
 const {client,calls}=fixture();await client.link('google','owner-a');await client.remove('owner-a');
 for(const call of calls){assert.equal(new URL(call.url).origin,origin);assert.equal(call.credentials,'include');}
 for(const call of calls.filter(call=>call.url.endsWith('/link-social')||call.method==='DELETE'))assert.equal(call.headers.get('x-puptime-account'),'owner-a');
 assert.deepEqual(await client.providers('owner-a'),['google']);
});
test('wrong-user and stale authentication cannot submit a destructive request',async()=>{
 const {client,calls,state}=fixture();state.userId='owner-b';await assert.rejects(client.remove('owner-a'),error=>error instanceof AccountError&&error.kind==='mismatch');
 state.userId='owner-a';state.createdAt=0;await assert.rejects(client.remove('owner-a'),error=>error instanceof AccountError&&error.kind==='reauth');
 state.createdAt=Date.now()+60000;await assert.rejects(client.freshUser('owner-a'),error=>error instanceof AccountError&&error.kind==='reauth');
 assert.equal(calls.some(call=>call.method==='DELETE'),false);
});
test('deletion distinguishes recent-auth refusal, account mismatch and uncertain acknowledgments',async()=>{
 const {client,state}=fixture();
 for(const [status,body,kind] of [[401,{error:'reauthentication_required'},'reauth'],[409,{error:'account_mismatch'},'mismatch'],[401,{error:'unauthorized'},'unconfirmed'],[200,{success:false},'unconfirmed'],[503,{error:'upstream_failed'},'unconfirmed'],[500,{error:'internal'},'unconfirmed']] as const){
  state.deleteStatus=status;state.deleteBody=body;await assert.rejects(client.remove('owner-a'),error=>error instanceof AccountError&&error.kind===kind);
 }
 state.throwDelete=true;await assert.rejects(client.remove('owner-a'),error=>error instanceof AccountError&&error.kind==='unconfirmed');
});
test('unsafe origins are rejected before creating a browser client',()=>{
 for(const value of ['http://public.example','https://harpapro.com','https://puptime.test/path','https://user:password@puptime.test'])assert.throws(()=>createWebAccountClient(value));
});

test('deletion persistence runs after fresh verification and before dispatch, and a failed guard prevents DELETE',async()=>{
 const {client,calls}=fixture();let saved=false;
 await assert.rejects(client.remove('owner-a',()=>{assert.equal(calls.some(call=>call.method==='DELETE'),false);throw new AccountError('storage');}),error=>error instanceof AccountError&&error.kind==='storage');assert.equal(calls.some(call=>call.method==='DELETE'),false);
 await client.remove('owner-a',()=>{assert.equal(calls.some(call=>call.method==='DELETE'),false);saved=true;});assert.equal(saved,true);assert.equal(calls.filter(call=>call.method==='DELETE').length,1);
});

test('confirmed deletion exposes only the Apple outcome and uses manual guidance for older or unknown replies',async()=>{
 const {client,state}=fixture();
 for(const outcome of ['not-linked','revoked','manual'] as const){
  state.deleteBody={success:true,message:'User deleted',appleRevocation:outcome,accessToken:'synthetic-private-token'};
  assert.deepEqual(await client.remove('owner-a'),{appleRevocation:outcome});
 }
 for(const extra of [{},{appleRevocation:'unrecognized'},{appleRevocation:null}]){
  state.deleteBody={success:true,message:'User deleted',...extra};
  assert.deepEqual(await client.remove('owner-a'),{appleRevocation:'manual'});
 }
});

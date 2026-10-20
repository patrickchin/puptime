import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createGoogleIdTokenRequest,nativeGoogleConfig} from './google-native.ts';

const config={iosClientId:'synthetic-ios.apps.googleusercontent.com',webClientId:'synthetic-server.apps.googleusercontent.com'};
test('the public iOS client has its matching native return scheme and a separate server audience',()=>{
 for(const client of Object.values(nativeGoogleConfig))assert.match(client,/^[\w-]+\.apps\.googleusercontent\.com$/);
 assert.notEqual(nativeGoogleConfig.iosClientId,nativeGoogleConfig.webClientId);
 const app=JSON.parse(readFileSync(new URL('../../app.json',import.meta.url),'utf8')).expo;
 const plugin=app.plugins.find((value:unknown)=>Array.isArray(value)&&value[0]==='@react-native-google-signin/google-signin');
 assert.equal(plugin[1].iosUrlScheme,nativeGoogleConfig.iosClientId.split('.').reverse().join('.'));
});
test('Google iOS uses the server audience without API/offline access and forwards only the signed identity token',async()=>{
 const configurations:unknown[]=[],requests:unknown[]=[];
 const request=createGoogleIdTokenRequest({configure:options=>{configurations.push(options);},signIn:async()=>{requests.push('interactive');return {type:'success',data:{idToken:'signed-id-token',accessToken:'private-api-token',serverAuthCode:'private-code',user:{email:'private@example.invalid'}}};}},config);
 assert.deepEqual(await request(),{token:'signed-id-token'});assert.deepEqual(await request(),{token:'signed-id-token'});
 assert.deepEqual(configurations,[{...config,offlineAccess:false}]);assert.deepEqual(requests,['interactive','interactive']);
});

test('Google cancellation is distinct from success; absent IDs or tokens never create credentials',async()=>{
 let configured=0,requests=0;
 const sdk={configure:()=>{configured++;},signIn:async()=>{requests++;return {type:'cancelled' as const,data:null};}};
 assert.equal(await createGoogleIdTokenRequest(sdk,config)(),null);
 for(const missing of ['iosClientId','webClientId'] as const)await assert.rejects(createGoogleIdTokenRequest(sdk,{...config,[missing]:''})(),/not configured/);
 assert.equal(configured,1);assert.equal(requests,1);
 for(const idToken of [null,'',' '])await assert.rejects(createGoogleIdTokenRequest({...sdk,signIn:async()=>({type:'success',data:{idToken}})},config)(),/no identity token/);
});

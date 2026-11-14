import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createFetch} from '@better-fetch/fetch';
import {createProductionAuthFence} from './production-auth-fence.mjs';

const config={origin:'https://qa.example.invalid',provider:'google',email:'qa@example.invalid',protectedEmails:['tracking@example.invalid']};
const user={id:'usr_test_inventory',email:config.email},google={type:'success',data:{user:{email:config.email},idToken:'private-provider-token'}};
function authenticated(options={}){
 const fence=createProductionAuthFence({...config,...options});fence.googleNative(google);
 const request=fence.authorize(config.origin+'/api/auth/sign-in/social',{method:'POST',body:JSON.stringify({provider:'google',idToken:{token:'private-provider-token'}})});
 fence.observe(request,200,{user,token:'private-session-token'});return fence;
}
test('only exact selected auth routes and safe reads can pass',()=>{
 for(const [path,method,body] of [['/api/cloud/enroll','POST',{}],['/api/sync/push','POST',{}],['/api/sync/pull?after=0','GET'],['/api/photos/img_test','POST',{}],['/api/account','DELETE'],['/api/auth/delete-user','POST',{}],['/api/auth/link-social','POST',{}],['/api/exports','GET'],['/api/config?escape=1','GET'],['/api/config#fragment','GET'],['/api/%61ccount','GET']]){
  const fence=createProductionAuthFence(config);assert.throws(()=>fence.authorize(config.origin+path,{method,...(body?{body:JSON.stringify(body)}:{})}));assert.equal(fence.receipt().blocked,1);
 }
 for(const origin of ['https://other.example.invalid','http://qa.example.invalid','https://user@qa.example.invalid'])assert.throws(()=>createProductionAuthFence(config).authorize(origin+'/api/account'));
 for(const path of ['/api/config','/api/account','/api/auth/get-session','/api/auth/list-accounts'])assert.equal(createProductionAuthFence(config).authorize(config.origin+path).method,'GET');
 assert.throws(()=>createProductionAuthFence(config).denySocket());
});
test('the pinned production fetch adapter passes URL objects and serialized JSON through the same fence',async()=>{
 const fence=createProductionAuthFence(config);fence.googleNative(google);let calls=0;
 const sdk=createFetch({baseURL:config.origin,customFetchImpl:async(input,options)=>{
  assert.ok(input instanceof URL);const request=fence.authorize(input,options);calls++;
  if(request.method==='POST')assert.equal(typeof options.body,'string');
  return Response.json({ok:true});
 }});
 await sdk('/api/config',{method:'GET'});await sdk('/api/auth/sign-in/social',{method:'POST',body:{provider:'google',idToken:{token:google.data.idToken}}});assert.equal(calls,2);
 await assert.rejects(()=>sdk('/api/cloud/enroll',{method:'POST',body:{}}));assert.equal(calls,2);
 for(const target of [config.origin+'/api/sync/pull?after=0','https://other.example.invalid/api/account'])assert.throws(()=>createProductionAuthFence(config).authorize(new URL(target)));
});
test('wrong/protected native identity is rejected before its token can be forwarded',()=>{
 for(const wrong of ['tracking@example.invalid','other@example.invalid',undefined]){
  const fence=createProductionAuthFence(config);assert.throws(()=>fence.googleNative({type:'success',data:{user:{email:wrong}}}));
  assert.throws(()=>fence.authorize(config.origin+'/api/auth/sign-in/social',{method:'POST',body:JSON.stringify({provider:'google',idToken:{token:'private-provider-token'}})}));
 }
 assert.throws(()=>createProductionAuthFence({...config,email:config.protectedEmails[0]}));
 const fence=createProductionAuthFence(config);fence.googleNative({type:'cancelled'});assert.equal(fence.receipt().nativeGoogleIdentityMatched,false);
 assert.throws(()=>createProductionAuthFence({...config,email:'malformed'}));assert.throws(()=>createProductionAuthFence({...config,protectedEmails:[]}));
 for(const missing of [undefined,null,'',' '])assert.throws(()=>createProductionAuthFence(config).googleNative({type:'success',data:{user:{email:config.email},idToken:missing}}));
 const bound=createProductionAuthFence(config);bound.googleNative(google);assert.throws(()=>bound.authorize(config.origin+'/api/auth/sign-in/social',{method:'POST',body:JSON.stringify({provider:'google',idToken:{token:'different-provider-token'}})}));assert.ok(!JSON.stringify(bound.receipt()).includes(google.data.idToken));
});
test('non-JSON and HTTP/transport failures retain only finite route/status evidence and end the case',()=>{
 const request={method:'POST',path:'/api/auth/sign-in/social'};
 for(const status of [403,502]){const fence=createProductionAuthFence(config);fence.nonJson(request,status);assert.deepEqual(fence.receipt().requests,[{...request,status}]);assert.equal(fence.receipt().failure,'non-json');}
 for(const status of [0,400,401,403,429,500]){const fence=createProductionAuthFence(config);fence.observe(request,status,{private:'never recorded'});assert.equal(fence.receipt().failure,status===0?'transport':'http');assert.ok(!JSON.stringify(fence.receipt()).includes('never recorded'));}
 const guest=createProductionAuthFence(config);guest.observe({method:'GET',path:'/api/account'},401,null);assert.equal(guest.receipt().failure,null);
 const native=createProductionAuthFence(config);native.providerFailure();assert.equal(native.receipt().failure,'native-provider');assert.throws(()=>native.authorize(config.origin+'/api/account'));
});
test('SDK and account identities must agree; any existing puppy stops and protects inventory',()=>{
 for(const wrong of [{...user,email:'tracking@example.invalid'},{...user,id:'usr_different'}])assert.throws(()=>authenticated().observe({method:'GET',path:'/api/account'},200,{user:wrong,pets:[]}));
 assert.throws(()=>authenticated({protectedAccountIds:[user.id]}));
 for(const pets of [[],[{id:'pet_existing',name:'Never copied',eventCount:0}],[{id:'pet_existing',eventCount:2}]]){
  const fence=authenticated();fence.observe({method:'GET',path:'/api/account'},200,{user,pets});
  const receipt=fence.receipt();assert.equal(receipt.inventory.status,pets.length?'existing-cloud-data-preserved':'inventory-complete');
  assert.ok(!JSON.stringify(receipt).includes('private-'));assert.ok(!JSON.stringify(receipt).includes('Never copied'));
  assert.throws(()=>fence.authorize(config.origin+'/api/account'));
 }
 assert.throws(()=>createProductionAuthFence(config).observe({method:'GET',path:'/api/account'},200,{user,pets:[]}));
 const read=authenticated();assert.throws(()=>read.observe({method:'GET',path:'/api/auth/get-session'},200,{user:{...user,id:'usr_different'}}));
});
test('email requests are bounded and only target the private allowed inbox',()=>{
 const emailConfig={...config,provider:'email'},path=config.origin+'/api/auth/email-otp/send-verification-otp';
 const fence=createProductionAuthFence(emailConfig),body=JSON.stringify({email:config.email,type:'sign-in'});
 assert.throws(()=>createProductionAuthFence(emailConfig).beforeGoogle());
 fence.authorize(path,{method:'POST',body});assert.throws(()=>fence.authorize(path,{method:'POST',body}));
 for(const wrong of ['tracking@example.invalid','other@example.invalid'])assert.throws(()=>createProductionAuthFence(emailConfig).authorize(path,{method:'POST',body:JSON.stringify({email:wrong,type:'sign-in'})}));
 assert.throws(()=>createProductionAuthFence(emailConfig).authorize(config.origin+'/api/auth/sign-in/social',{method:'POST',body:JSON.stringify({provider:'google',idToken:{token:'private-token'}})}));
 const login=createProductionAuthFence(emailConfig),verify=login.authorize(config.origin+'/api/auth/sign-in/email-otp',{method:'POST',body:JSON.stringify({email:config.email,otp:'123456'})});
 login.observe(verify,200,{user,token:'private-session'});login.observe({method:'GET',path:'/api/account'},200,{user,pets:[]});assert.ok(!JSON.stringify(login.receipt()).includes('123456'));assert.ok(!JSON.stringify(login.receipt()).includes('private-session'));
});
test('the actual generated bridge requires private activation before native Google or any auth POST',async()=>{
 const source=readFileSync(new URL('./prepare-ios-production-auth-inventory.mjs',import.meta.url),'utf8');
 const template=source.match(/writeFileSync\(join\(checkout,'src\/cloud\/qa-production-auth.ts'\),`([\s\S]*?)`,\{mode:0o600\}\);/)?.[1];assert.ok(template);
 let sequence=0;
 async function bridge(provider='google',active=false){
  const callback='http://127.0.0.1:12345/private',state={active,posts:0,native:0},key='__puptimePrivateHandoffTest'+sequence++;
  globalThis[key]=async(input,options={})=>{
   const url=String(input);
   if(url===callback+'/config')return Response.json({...config,provider});
   if(url===callback+'/handoff')return Response.json({active:state.active});
   if(url===callback+'/receipt')return Response.json({});
   assert.ok(url.startsWith(config.origin+'/api/'));
   if(options.method==='POST'){state.posts++;return Response.json({user,token:'private-session-token'});}
   return Response.json({providers:{google:true,email:true}});
  };
  const code=template.replace("import {fetch as rawFetch} from 'expo/fetch';",`const rawFetch=globalThis[${JSON.stringify(key)}];`)
   .replace("import {createProductionAuthFence} from './qa-production-fence.mjs';",`import {createProductionAuthFence} from ${JSON.stringify(new URL('./production-auth-fence.mjs',import.meta.url).href)};`)
   .replace('${JSON.stringify(callback)}',JSON.stringify(callback));
  try{return {module:await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64')),state,sdk:{signIn:async()=>{state.native++;return google;}}};}finally{delete globalThis[key];}
 }
 const waiting=await bridge();await waiting.module.inventoryFetch(config.origin+'/api/config',{method:'GET'});
 await assert.rejects(()=>waiting.module.fencedGoogle(waiting.sdk).signIn());assert.equal(waiting.state.native,0);assert.equal(waiting.state.posts,0);
 const emailWaiting=await bridge('email');await assert.rejects(()=>emailWaiting.module.inventoryFetch(config.origin+'/api/auth/email-otp/send-verification-otp',{method:'POST',body:JSON.stringify({email:config.email,type:'sign-in'})}));assert.equal(emailWaiting.state.posts,0);
 const expired=await bridge('google',true);await expired.module.fencedGoogle(expired.sdk).signIn();expired.state.active=false;
 await assert.rejects(()=>expired.module.inventoryFetch(config.origin+'/api/auth/sign-in/social',{method:'POST',body:JSON.stringify({provider:'google',idToken:{token:google.data.idToken}})}));assert.equal(expired.state.native,1);assert.equal(expired.state.posts,0);
 const enabled=await bridge('google',true);await enabled.module.fencedGoogle(enabled.sdk).signIn();
 await enabled.module.inventoryFetch(config.origin+'/api/auth/sign-in/social',{method:'POST',body:JSON.stringify({provider:'google',idToken:{token:google.data.idToken}})});assert.equal(enabled.state.native,1);assert.equal(enabled.state.posts,1);
 await assert.rejects(()=>enabled.module.inventoryFetch(config.origin+'/api/cloud/enroll',{method:'POST',body:'{}'}));assert.equal(enabled.state.posts,1);
});

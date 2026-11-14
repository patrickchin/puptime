import assert from 'node:assert/strict';
import test from 'node:test';
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
test('wrong/protected native identity is rejected before its token can be forwarded',()=>{
 for(const wrong of ['tracking@example.invalid','other@example.invalid',undefined]){
  const fence=createProductionAuthFence(config);assert.throws(()=>fence.googleNative({type:'success',data:{user:{email:wrong}}}));
  assert.throws(()=>fence.authorize(config.origin+'/api/auth/sign-in/social',{method:'POST',body:JSON.stringify({provider:'google',idToken:{token:'private-provider-token'}})}));
 }
 assert.throws(()=>createProductionAuthFence({...config,email:config.protectedEmails[0]}));
 const fence=createProductionAuthFence(config);fence.googleNative({type:'cancelled'});assert.equal(fence.receipt().nativeGoogleIdentityMatched,false);
 assert.throws(()=>createProductionAuthFence({...config,email:'malformed'}));assert.throws(()=>createProductionAuthFence({...config,protectedEmails:[]}));
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
 assert.throws(()=>fence.beforeGoogle());
 fence.authorize(path,{method:'POST',body});assert.throws(()=>fence.authorize(path,{method:'POST',body}));
 for(const wrong of ['tracking@example.invalid','other@example.invalid'])assert.throws(()=>createProductionAuthFence(emailConfig).authorize(path,{method:'POST',body:JSON.stringify({email:wrong,type:'sign-in'})}));
 assert.throws(()=>createProductionAuthFence(emailConfig).authorize(config.origin+'/api/auth/sign-in/social',{method:'POST',body:JSON.stringify({provider:'google',idToken:{token:'private-token'}})}));
 const login=createProductionAuthFence(emailConfig),verify=login.authorize(config.origin+'/api/auth/sign-in/email-otp',{method:'POST',body:JSON.stringify({email:config.email,otp:'123456'})});
 login.observe(verify,200,{user,token:'private-session'});login.observe({method:'GET',path:'/api/account'},200,{user,pets:[]});assert.ok(!JSON.stringify(login.receipt()).includes('123456'));assert.ok(!JSON.stringify(login.receipt()).includes('private-session'));
});

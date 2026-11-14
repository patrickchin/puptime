// Test-only, fail-closed production authentication inventory. No network or storage.
// Real identities/configuration and every returned inventory stay private.
const email=value=>typeof value==='string'?value.trim().toLowerCase():'';
const identity=value=>value&&typeof value.id==='string'&&/^[A-Za-z0-9_-]{1,200}$/.test(value.id)&&typeof value.email==='string'?{id:value.id,email:email(value.email)}:null;
export function createProductionAuthFence(config){
 const origin=new URL(config.origin);
 if(origin.protocol!=='https:'||origin.origin!==config.origin||origin.username||origin.password||origin.hostname==='harpapro.com'||origin.hostname.endsWith('.harpapro.com'))throw new Error('Invalid production origin.');
 const validEmail=value=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email(value));
 if(!['google','email'].includes(config.provider)||!validEmail(config.email)||!Array.isArray(config.protectedEmails)||!config.protectedEmails.length||!config.protectedEmails.every(validEmail)||config.protectedAccountIds!==undefined&&!Array.isArray(config.protectedAccountIds))throw new Error('Explicit private identity fences are required.');
 const expected=email(config.email),protectedEmails=config.protectedEmails.map(email),protectedIds=config.protectedAccountIds??[];
 if(protectedEmails.includes(expected))throw new Error('The tracking identity is protected.');
 let googleVerified=false,sdkUser=null,inventory=null,blocked=0,requests=[],emailSends=0,signIns=0;
 const reject=()=>{blocked++;throw new Error('Production inventory fence rejected the operation.');};
 function checkedUser(value){const user=identity(value);if(!user||user.email!==expected||protectedEmails.includes(user.email)||protectedIds.includes(user.id))return reject();return user;}
 return {
  beforeGoogle(){if(config.provider!=='google'||inventory)return reject();},
  googleNative(response){
   if(config.provider!=='google'||inventory)return reject();
   if(response?.type==='cancelled')return;
   if(response?.type!=='success'||email(response.data?.user?.email)!==expected||protectedEmails.includes(email(response.data?.user?.email)))return reject();
   googleVerified=true;
  },
  authorize(input,options={}){
   if(inventory)return reject();
   let url;try{url=new URL(typeof input==='string'?input:input.url);}catch{return reject();}
   if(url.origin!==origin.origin||url.username||url.password||url.search||url.hash)return reject();
   const method=String(options.method??input?.method??'GET').toUpperCase(),path=url.pathname;
   if(method==='GET'&&['/api/config','/api/account','/api/auth/get-session','/api/auth/list-accounts'].includes(path))return {method,path};
   let body;try{body=typeof options.body==='string'?JSON.parse(options.body):null;}catch{return reject();}
   if(method!=='POST'||!body||typeof body!=='object'||Array.isArray(body))return reject();
   if(config.provider==='google'&&path==='/api/auth/sign-in/social'&&body.provider==='google'&&googleVerified&&body.idToken?.token&&++signIns===1)return {method,path};
   if(config.provider==='email'&&email(body.email)===expected){
    if(path==='/api/auth/email-otp/send-verification-otp'&&body.type==='sign-in'&&++emailSends===1)return {method,path};
    if(path==='/api/auth/sign-in/email-otp'&&typeof body.otp==='string'&&/^\d{6}$/.test(body.otp)&&++signIns===1)return {method,path};
   }
   return reject();
  },
  observe(request,status,payload){
   requests.push({...request,status:Number.isInteger(status)?status:0});
   if(status<200||status>=300)return;
   if(['/api/auth/sign-in/social','/api/auth/sign-in/email-otp'].includes(request.path))sdkUser=checkedUser(payload?.user);
   if(request.path==='/api/auth/get-session'&&payload?.user){const user=checkedUser(payload.user);if(sdkUser&&user.id!==sdkUser.id)return reject();}
   if(request.path==='/api/account'){
    const user=checkedUser(payload?.user);
    if(!sdkUser||user.id!==sdkUser.id||!Array.isArray(payload.pets))return reject();
    const pets=payload.pets.map(pet=>{if(!pet||typeof pet.id!=='string'||!Number.isSafeInteger(pet.eventCount)||pet.eventCount<0)return reject();return {id:pet.id,eventCount:pet.eventCount};});
    inventory={status:pets.length?'existing-cloud-data-preserved':'inventory-complete',user,pets};
   }
  },
  denySocket:reject,
  receipt(){return {provider:config.provider,nativeGoogleIdentityMatched:googleVerified,sdkUser,inventory,blocked,requests:requests.map(row=>({...row}))};},
 };
}

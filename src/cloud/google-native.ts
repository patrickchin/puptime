export const nativeGoogleConfig={
 iosClientId:'809758465510-jnjkvg56do270gbco4djj8s8l7fgsi9j.apps.googleusercontent.com',
 webClientId:'809758465510-nuln5dtq8g08g42qgsceb407dit72omm.apps.googleusercontent.com',
};

export type GoogleIdToken={token:string};
type GoogleSdk={
 configure:(options:{iosClientId:string;webClientId:string;offlineAccess:false})=>void;
 signIn:()=>Promise<{type:'cancelled';data:null}|{type:'success';data:{idToken:string|null}}>;
};

// Google's iOS SDK owns presentation and credential storage. Better Auth only
// receives its signed ID token; no Google API access or refresh token is needed.
export function createGoogleIdTokenRequest(sdk:GoogleSdk,config=nativeGoogleConfig):()=>Promise<GoogleIdToken|null> {
 let configured=false;
 return async()=>{
  if(!configured){
   for(const client of [config.iosClientId,config.webClientId])if(!/^[\w-]+\.apps\.googleusercontent\.com$/.test(client))throw new Error('Google sign-in is not configured.');
   sdk.configure({...config,offlineAccess:false});configured=true;
  }
  const response=await sdk.signIn();
  if(response.type==='cancelled')return null;
  if(!response.data.idToken?.trim())throw new Error('Google authentication returned no identity token.');
  return {token:response.data.idToken};
 };
}

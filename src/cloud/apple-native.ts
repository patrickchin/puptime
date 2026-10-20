export type AppleIdToken={token:string;nonce:string;user?:{name:{firstName?:string;lastName?:string}}};

// The platform adapter supplies Expo's secure primitives and the system sheet.
export async function requestAppleIdToken({isAvailable,randomBytes,sha256,signIn}:{
 isAvailable:()=>Promise<boolean>;randomBytes:(count:number)=>Promise<Uint8Array>;
 sha256:(value:string)=>Promise<string>;
 signIn:(nonce:string)=>Promise<{identityToken:string|null;fullName?:{givenName?:string|null;familyName?:string|null}|null}>;
}):Promise<AppleIdToken|null> {
 if(!await isAvailable())throw new Error('Apple authentication is unavailable.');
 const bytes=await randomBytes(32);
 if(bytes.length!==32)throw new Error('Apple authentication nonce is unavailable.');
 const nonce=Array.from(bytes,value=>value.toString(16).padStart(2,'0')).join('');
 const digest=await sha256(nonce);
 if(!/^[a-f0-9]{64}$/.test(digest))throw new Error('Apple authentication nonce is unavailable.');
 let credential:Awaited<ReturnType<typeof signIn>>;
 try{credential=await signIn(digest);}
 catch(error){if(error&&typeof error==='object'&&'code' in error&&error.code==='ERR_REQUEST_CANCELED')return null;throw new Error('Apple authentication did not complete.');}
 if(!credential.identityToken?.trim())throw new Error('Apple authentication returned no identity token.');
 const firstName=credential.fullName?.givenName??undefined,lastName=credential.fullName?.familyName??undefined;
 return {token:credential.identityToken,nonce,...(firstName||lastName?{user:{name:{...(firstName?{firstName}:{}),...(lastName?{lastName}:{})}}}:{})};
}

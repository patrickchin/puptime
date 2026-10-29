import { websiteStyles } from './brand';
import { useEffect, useRef, useState } from 'react';
import Head from 'expo-router/head';
import { useRouter } from 'expo-router';
import { Image } from 'react-native';
import { AccountError, checkResult, getWebAccountClient, type Provider } from './account-client';
import type { CloudAccountSummary, CloudConfig } from '../cloud/api';
import { WebsiteAnalytics, openAnalyticsSettings } from './WebsiteAnalytics';
import { captureWebsiteEvent } from './telemetry';

type Client=ReturnType<typeof getWebAccountClient>;
type ReturnData={intent:'sign-in';provider:Provider}|{intent:'link'|'reauth';userId:string;provider?:Provider};
type ReturnIntent=ReturnData&{at:number};
const returnKey='puptime.account.return',deletionPrefix='puptime.account.deletion.';
function readDeletion(preferred?:string){
 try{const ids=Object.keys(localStorage).filter(key=>key.startsWith(deletionPrefix)&&key.length>deletionPrefix.length&&Number.isFinite(Number(localStorage.getItem(key)))).map(key=>key.slice(deletionPrefix.length));return preferred&&ids.includes(preferred)?preferred:ids[0]??null;}catch{return null;}
}
function saveDeletion(userId:string){try{localStorage.setItem(deletionPrefix+userId,String(Date.now()));}catch{throw new AccountError('storage');}}
function clearDeletion(userId:string){try{localStorage.removeItem(deletionPrefix+userId);}catch{/* Keep the safe unresolved barrier if storage becomes unavailable. */}}
const providerName=(provider:Provider)=>provider==='apple'?'Apple':'Google';
const messages={network:'Couldn’t reach Puptime. Check your connection and try again.',service:'The account service is unavailable. Try again shortly.',auth:'Sign in again to continue.',mismatch:'You’re signed into a different account. Return to your original account before continuing.',reauth:'Sign in again before deleting your cloud account.',code:'That code didn’t work. Check it or request another.',rate:'Too many attempts. Wait a moment, then try again.',unconfirmed:'The deletion response was lost. We haven’t confirmed whether your cloud account was deleted. Your iPhone’s local logs are kept.',storage:'Allow temporary session storage to continue with Apple or Google, or use an email code.'};
function saveReturn(value:ReturnData){
 try{sessionStorage.setItem(returnKey,JSON.stringify({...value,at:Date.now()}));}catch{throw new AccountError('storage');}
}
function takeReturn():ReturnIntent|null{
 try{
  const raw=sessionStorage.getItem(returnKey);if(!raw)return null;
  const value=JSON.parse(raw);
  const valid=['sign-in','link','reauth'].includes(value?.intent)&&(value.intent==='sign-in'||typeof value.userId==='string'&&value.userId.length>0)
   &&Number.isFinite(value.at)&&Date.now()-value.at>=0&&Date.now()-value.at<1800000
   &&(value.provider===undefined||['apple','google'].includes(value.provider));
  sessionStorage.removeItem(returnKey);
  return valid?value:null;
 }catch{return null;}
}
export default function AccountPage(){
 const [client,setClient]=useState<Client|null>(null);
 useEffect(()=>{setClient(getWebAccountClient());},[]);
 return <div className="account-page">
  <Head><title>Your account | Puptime</title><link rel="icon" href="/brand-icon.svg" type="image/svg+xml"/><meta name="robots" content="noindex, nofollow"/><meta name="referrer" content="strict-origin"/></Head>
  <style>{css}</style>
  <header className="account-header"><a className="account-brand" href="/"><img src="/brand-icon.svg" width="38" height="38" alt=""/><span>Puptime</span></a><nav aria-label="Website"><a href="/puppy-care/">Puppy care</a><a href="/">Home</a></nav></header>
  <main className="account-layout"><aside className="account-intro"><Image source={require('../../assets/mascots/scruffy-terrier.png')} style={{width:184,height:184,alignSelf:'flex-start'}} resizeMode="contain" accessibilityLabel="Puptime’s scruffy terrier"/><h1>Your Puptime.</h1><p>A little peace of mind, wherever puppy life takes you.</p></aside>
   <section className="account-content" aria-label="Your account">{client?<AccountContent client={client}/>:<p role="status">Loading account…</p>}</section>
  </main>
  <footer className="account-footer"><a href="https://github.com/patrickchin/puptime/blob/main/PRIVACY.md">Privacy</a><button type="button" className="text-button" onClick={openAnalyticsSettings}>Analytics settings</button></footer>
  <WebsiteAnalytics path="/account"/>
 </div>;
}
function AccountContent({client}:{client:Client}){
 const router=useRouter();
 const session=client.auth.useSession(),user=session.data?.user;
 const [config,setConfig]=useState<CloudConfig|null>(null),[summary,setSummary]=useState<CloudAccountSummary|null>(null),[linked,setLinked]=useState<Provider[]|null>(null);
 const [email,setEmail]=useState(''),[sent,setSent]=useState<string|null>(null),[code,setCode]=useState('');
 const [notice,setNotice]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState<string|null>(null),[loading,setLoading]=useState(true),[revision,setRevision]=useState(0);
 const [appleManual,setAppleManual]=useState(false);
 const [reauth,setReauth]=useState<string|null>(null),[confirmation,setConfirmation]=useState<string|null>(null),[uncertain,setUncertain]=useState<string|null>(null);
 const mounted=useRef(true),locked=useRef(false),epoch=useRef(0),pending=useRef<ReturnIntent|null>(null),callbackFailed=useRef(false),dialog=useRef<HTMLDialogElement>(null),userId=useRef(user?.id);userId.current=user?.id;
 useEffect(()=>{
  mounted.current=true;pending.current=takeReturn();
  const url=new URL(window.location.href);
  callbackFailed.current=url.searchParams.has('error');
  if(url.search){if(callbackFailed.current)setError('Sign-in wasn’t completed. Use your original sign-in method, then connect Apple or Google from your account.');router.setParams(Object.fromEntries([...url.searchParams.keys()].map(key=>[key,undefined])));}
  const unresolved=readDeletion(userId.current);if(unresolved){setUncertain(unresolved);setError(messages.unconfirmed);}
  const changed=(event:StorageEvent)=>{if(event.key===null||event.key.startsWith(deletionPrefix)){const unresolved=readDeletion(userId.current);if(unresolved){setUncertain(unresolved);setError(messages.unconfirmed);setConfirmation(null);setReauth(null);setSent(null);setCode('');}}};window.addEventListener('storage',changed);
  return()=>{mounted.current=false;epoch.current++;window.removeEventListener('storage',changed);};
 },[router]);
 useEffect(()=>{
  const unresolved=readDeletion(user?.id);if(unresolved&&unresolved!==uncertain){setUncertain(unresolved);setError(messages.unconfirmed);}
  const ticket=++epoch.current;setSummary(null);setLinked(null);setLoading(true);setConfirmation(null);
  if(session.isPending)return;
  void(async()=>{
   try{
    const nextConfig=await client.config();if(!mounted.current||ticket!==epoch.current)return;setConfig(nextConfig);
    if(user){
     const [account,providers]=await Promise.all([client.summary(user.id),(nextConfig.providers.apple||nextConfig.providers.google)?client.providers(user.id):Promise.resolve([] as Provider[])]);
     if(!mounted.current||ticket!==epoch.current||userId.current!==user.id)return;
     setSummary(account);setLinked(providers);
    }
    const returning=pending.current;pending.current=null;
    if(returning){
     if(returning.intent==='sign-in'){captureWebsiteEvent('website_account',{action:'sign_in',result:user?'success':'error'});}
     else if(!user||user.id!==returning.userId)setError(messages.mismatch);
     else if(returning.intent==='reauth'){
      setReauth(returning.userId);
      if(!callbackFailed.current){await client.freshUser(returning.userId);if(!mounted.current||ticket!==epoch.current||userId.current!==returning.userId)return;setReauth(null);setNotice('Signed in again. Choose Delete cloud account to continue.');}
     }
     else if(returning.provider){const providers=await client.providers(user.id);if(!mounted.current||ticket!==epoch.current)return;setLinked(providers);const connected=providers.includes(returning.provider);captureWebsiteEvent('website_account',{action:'link_provider',result:connected?'success':'error'});if(connected)setNotice(`${providerName(returning.provider)} connected.`);else setError('The sign-in method wasn’t connected. Try again with the same email shown above.');}
    }
   }catch(reason){if(mounted.current&&ticket===epoch.current)setError(reason instanceof AccountError?messages[reason.kind]:messages.service);}
   finally{if(mounted.current&&ticket===epoch.current)setLoading(false);}
  })();
 },[client,user?.id,session.isPending,revision]);
 useEffect(()=>{if(confirmation)dialog.current?.showModal();else dialog.current?.close();},[confirmation]);
 async function run(name:string,action:()=>Promise<void>){
  if(locked.current)return;locked.current=true;setBusy(name);setError('');setNotice('');
  try{await action();}
  catch(reason){
   if(!mounted.current)return;
   let kind=reason instanceof AccountError?reason.kind:'network';if(uncertain&&kind==='auth')kind='unconfirmed';
   if(kind==='reauth'){setConfirmation(null);setReauth(uncertain??userId.current??null);setSent(null);setCode('');}
   if(kind==='unconfirmed'){const expected=uncertain??confirmation??userId.current;if(expected)setUncertain(expected);setConfirmation(null);}
   if(kind==='mismatch'||kind==='auth'){setConfirmation(null);setReauth(null);setSummary(null);setLinked(null);void session.refetch();}
   const action=name==='email'?'request_code':name==='verify'||name==='apple'||name==='google'?'sign_in':name.startsWith('link-')?'link_provider':name==='delete'?'delete':name==='sign-out'?'sign_out':null;
   if(action)captureWebsiteEvent('website_account',{action,result:'error'});
   if(kind==='storage'&&name==='delete')setConfirmation(null);
   setError(kind==='storage'&&name==='delete'?'Allow browser storage before deleting your cloud account.':messages[kind]);
  }finally{locked.current=false;if(mounted.current)setBusy(null);}
 }
 async function requestCode(){
  const destination=reauth?(await client.sameUser(reauth)).user.email:email.trim();if(!destination)return;
  checkResult(await client.auth.emailOtp.sendVerificationOtp({email:destination,type:'sign-in'}));
  captureWebsiteEvent('website_account',{action:'request_code',result:'success'});
  if(mounted.current){setSent(destination);setCode('');}
 }
 async function verifyCode(){
  if(!sent)return;const expected=reauth;
  if(expected)await client.reauthenticate(expected,code);else checkResult(await client.auth.signIn.emailOtp({email:sent,otp:code}));
  captureWebsiteEvent('website_account',{action:'sign_in',result:'success'});
  if(mounted.current){setSent(null);setCode('');setReauth(null);if(expected)setNotice(uncertain?'Signed in again. Choose Retry deletion to review a new confirmation.':'Signed in again. Choose Delete cloud account to continue.');}
  await session.refetch();
 }
 async function social(provider:Provider){
  if(reauth)saveReturn({intent:'reauth',userId:reauth,provider});
  else saveReturn({intent:'sign-in',provider});
  captureWebsiteEvent('website_account',{action:'sign_in',result:'started'});
  checkResult(await client.auth.signIn.social({provider,callbackURL:client.origin+'/account',errorCallbackURL:client.origin+'/account'}));
 }
 async function connect(provider:Provider){
  if(!user)return;saveReturn({intent:'link',provider,userId:user.id});captureWebsiteEvent('website_account',{action:'link_provider',result:'started'});await client.link(provider,user.id);
 }
 async function openDeletion(){
  const expected=uncertain??user?.id;if(!expected)return;await client.freshUser(expected);setConfirmation(expected);
 }
 async function remove(){
  const expected=confirmation;if(!expected)return;
  let outcome;
  try{outcome=await client.remove(expected,()=>{saveDeletion(expected);setUncertain(expected);});}
  catch(reason){if(readDeletion(expected)===expected)setUncertain(expected);throw reason;}
  if(!mounted.current)return;setConfirmation(null);setUncertain(null);clearDeletion(expected);setSummary(null);setLinked(null);setNotice('Cloud account deleted. Your iPhone’s local logs are kept.');
  setAppleManual(outcome.appleRevocation==='manual');
  captureWebsiteEvent('website_account',{action:'delete',result:'success'});await session.refetch();
 }
 const disabled=!!busy||session.isRefetching;
 const signInForm=<div className="account-form">
  {reauth?<h2>Confirm it’s you</h2>:<h2>Sign in</h2>}
  {!uncertain&&(config?.providers.apple||config?.providers.google)?<div className="account-social">{(['apple','google'] as const).filter(provider=>config?.providers[provider]&&(!reauth||linked?.includes(provider))).map(provider=><button key={provider} disabled={disabled} type="button" onClick={()=>{void run(provider,()=>social(provider));}}>{busy===provider?'Opening…':`${reauth?'Verify':'Continue'} with ${providerName(provider)}`}</button>)}</div>:null}
  {config?.providers.email?<form onSubmit={event=>{event.preventDefault();void run(sent?'verify':'email',sent?verifyCode:requestCode);}}>
   {sent?<><p className="account-muted">Code sent to {sent}</p><label htmlFor="email-code">Email code</label><input id="email-code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={event=>setCode(event.target.value.replace(/\D/g,'').slice(0,6))} required disabled={disabled}/></>:!reauth?<><label htmlFor="email-address">Email address</label><input id="email-address" name="email" type="email" autoComplete="email" value={email} onChange={event=>setEmail(event.target.value)} required disabled={disabled}/></>:null}
   <button className="account-primary" disabled={disabled||(!!sent&&code.length!==6)}>{busy==='email'||busy==='verify'?'Working…':sent?'Continue':'Email me a code'}</button>
   {sent?<div className="account-inline"><button type="button" className="text-button" disabled={disabled} onClick={()=>{void run('email',requestCode);}}>Resend code</button><button type="button" className="text-button" disabled={disabled} onClick={()=>{setSent(null);setCode('');}}>Back</button></div>:null}
  </form>:null}
  {!config?.providers.email&&!config?.providers.apple&&!config?.providers.google?<p>Sign-in isn’t available yet. Your iPhone’s local logs are kept.</p>:null}
  {reauth?<button type="button" className="text-button" disabled={disabled} onClick={()=>{setReauth(null);setSent(null);setCode('');}}>Cancel</button>:null}
 </div>;
 return <>
  {error?<div role="alert" className="account-error">{error}</div>:null}
  {notice?<p role="status" className="account-notice">{notice}</p>:null}
  {appleManual?<p>Apple access wasn’t confirmed as revoked. In <a href="https://account.apple.com/">your Apple Account</a>, open Sign-In and Security → Sign in with Apple, then stop using Puptime.</p>:null}
  {uncertain?<div><p>We won’t create another account or restart sync automatically.</p>{reauth?signInForm:<button type="button" disabled={disabled} onClick={()=>{void run('delete-check',openDeletion);}}>Retry deletion</button>}<p><a href="https://github.com/patrickchin/puptime/issues">Get help</a></p></div>:loading||session.isPending?<p role="status">Loading account…</p>:!user?signInForm:<>
   <p className="account-email">{user.email}</p>
   {reauth?signInForm:<>
    <dl className="account-status"><div><dt>Cloud access</dt><dd>{summary?.cloud.canSync?'Available':'Sync paused'}</dd></div><div><dt>Saved puppies</dt><dd>{summary?.pets.length??'—'}</dd></div></dl>
    {(config?.providers.apple||config?.providers.google)?<div className="account-methods">{linked===null?<button disabled={disabled} onClick={()=>setRevision(value=>value+1)}>Refresh sign-in methods</button>:(['apple','google'] as const).filter(provider=>config?.providers[provider]).map(provider=>linked.includes(provider)?<p key={provider} className="account-connected">✓ {providerName(provider)} connected</p>:<button key={provider} disabled={disabled} onClick={()=>{void run('link-'+provider,()=>connect(provider));}}>{busy==='link-'+provider?'Opening…':'Connect '+providerName(provider)}</button>)}</div>:null}
    {summary?.cloud.canExport?<form action="/api/account/export" method="post" onSubmit={()=>captureWebsiteEvent('website_account',{action:'export',result:'started'})}><input type="hidden" name="expectedAccount" value={user.id}/><input type="hidden" name="profilePhotos" value="1"/><button type="submit" className="account-download">Download cloud data <span aria-hidden="true">↓</span></button></form>:null}
    <p className="account-muted">Cloud data only. Unsynced changes stay on your iPhone.</p>
    <p><a href="/care">Open shared puppies</a></p>
    <div className="account-controls"><button className="text-button" disabled={disabled} onClick={()=>{void run('sign-out',async()=>{checkResult(await client.auth.signOut());await session.refetch();setSummary(null);setLinked(null);captureWebsiteEvent('website_account',{action:'sign_out',result:'success'});});}}>Sign out</button><button className="text-button account-danger" disabled={disabled} onClick={()=>{void run('delete-check',openDeletion);}}>Delete cloud account</button></div>
   </>}
  </>}
  {!loading&&!uncertain&&!reauth&&error?<button type="button" className="text-button" disabled={disabled} onClick={()=>{setError('');setRevision(value=>value+1);void session.refetch();}}>Try again</button>:null}
  <dialog ref={dialog} className="account-dialog" aria-labelledby="delete-account-title" onCancel={event=>{if(!busy){setConfirmation(null);captureWebsiteEvent('website_account',{action:'delete',result:'cancelled'});}else event.preventDefault();}} onClose={()=>setConfirmation(null)}>
   <h2 id="delete-account-title">Delete cloud account?</h2><p>{user?.email}</p><p>Your account and cloud backup will be deleted. Logs saved on your iPhone stay there. Other signed-in devices lose cloud access.</p>
   <div className="account-inline"><button autoFocus disabled={!!busy} onClick={()=>{setConfirmation(null);captureWebsiteEvent('website_account',{action:'delete',result:'cancelled'});}}>Cancel</button><button className="account-delete" disabled={!!busy} onClick={()=>{void run('delete',remove);}}>{busy==='delete'?'Deleting…':'Delete cloud account'}</button></div>
  </dialog>
 </>;
}

const css=websiteStyles + `
.account-page{--surface:var(--white);--line:var(--border);--danger:#a32d26;min-height:100vh;height:max-content;flex-shrink:0;background:var(--paper);color:var(--ink);font:17px/1.5 'Red Hat Text',sans-serif}
.account-page *{box-sizing:border-box}.account-page a{color:var(--green);text-underline-offset:4px}.account-page button,.account-page input{font:inherit}.account-page button{cursor:pointer}.account-page button:disabled{cursor:wait;opacity:.55}.account-page :focus-visible{outline:3px solid var(--green);outline-offset:4px}.account-header,.account-footer{max-width:1240px;margin:auto;padding:24px 40px;display:flex;align-items:center;justify-content:space-between;gap:24px}.account-brand{display:flex;gap:12px;align-items:center;text-decoration:none;font-size:25px;font-weight:800}.account-header nav,.account-footer{display:flex;gap:28px}.account-header nav a{text-decoration:none;min-height:44px;display:flex;align-items:center}.account-layout{max-width:1080px;margin:54px auto 100px;padding:0 40px;display:grid;grid-template-columns:1fr 1fr;gap:100px;align-items:start}.account-intro h1{font-family:'Red Hat Display',sans-serif;font-size:58px;line-height:1.04;letter-spacing:-2px;margin:24px 0 18px;font-weight:900}.account-intro p{font-size:21px;max-width:330px;color:var(--muted)}.account-content{padding-top:38px;min-width:0}.account-content h2{font-size:26px;margin:0 0 24px;letter-spacing:-.4px}.account-form,.account-methods{display:grid;gap:14px}.account-form form{display:grid;gap:12px}.account-social{display:grid;gap:12px;margin-bottom:8px}.account-content button:not(.text-button),.account-download{border:1px solid var(--line);border-radius:12px;min-height:52px;padding:12px 18px;background:var(--surface);color:var(--green);font-weight:650}.account-content input{width:100%;border:1px solid var(--line);border-radius:10px;min-height:54px;background:var(--surface);color:var(--ink);padding:12px 14px}.account-content label{font-weight:600}.account-content button.account-primary{background:var(--green);border-color:var(--green);color:white}.text-button{border:0;background:transparent;padding:10px 0;min-height:44px;color:var(--green);text-align:left;text-decoration:underline;text-underline-offset:4px}.account-inline,.account-controls{display:flex;gap:24px;justify-content:space-between;flex-wrap:wrap}.account-muted{font-size:14px;color:var(--muted);margin:10px 0 20px}.account-email{font-size:23px;font-weight:650;overflow-wrap:anywhere;margin:0 0 30px}.account-status{margin:0 0 32px;padding-bottom:26px;border-bottom:1px solid var(--line)}.account-status div{display:flex;justify-content:space-between;gap:16px;margin:12px 0}.account-status dt{color:var(--muted)}.account-status dd{margin:0;font-weight:600;text-align:right}.account-methods{margin-bottom:26px}.account-connected{margin:6px 0;color:var(--green)}.account-download{display:flex;width:100%;justify-content:space-between;text-decoration:none}.account-controls{border-top:1px solid var(--line);padding-top:14px;margin-top:30px}.account-content .account-danger{color:var(--danger)}.account-error,.account-notice{padding:16px 0;margin:0 0 22px;border-bottom:1px solid var(--line);overflow-wrap:anywhere}.account-error{color:var(--danger)}.account-notice{color:var(--green)}.account-dialog{border:1px solid var(--line);border-radius:18px;max-width:500px;width:calc(100% - 32px);background:var(--surface);color:var(--ink);padding:28px}.account-dialog::backdrop{background:#17231e66}.account-dialog p{overflow-wrap:anywhere}.account-content button.account-delete{background:var(--danger);color:white;border-color:var(--danger)}.account-footer{justify-content:flex-start;border-top:1px solid var(--line);font-size:14px}
@media(max-width:760px){.account-header,.account-footer{padding:18px 22px;flex-wrap:wrap}.account-header nav{gap:18px}.account-layout{display:block;margin:15px auto 60px;padding:0 24px}.account-intro{display:flex;align-items:center;gap:18px;flex-wrap:wrap}.account-intro>div{width:84px!important;height:84px!important}.account-intro h1{font-family:'Red Hat Display',sans-serif;font-size:32px;margin:0;letter-spacing:-1.2px}.account-intro p{display:none}.account-content{padding-top:30px;max-width:470px;margin:auto}.account-email{font-size:21px}.account-controls{gap:12px}.account-dialog{padding:22px}}
`;

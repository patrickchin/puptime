import { websiteStyles } from './brand';
import { useEffect, useRef, useState } from 'react';
import Head from 'expo-router/head';
import { useRouter } from 'expo-router';
import { Image } from 'react-native';
import { AccountError, accountErrorMessages as messages, checkResult, getWebAccountClient, type Provider } from './account-client';
import type { CloudAccountSummary, CloudConfig } from '../cloud/api';
import { WebsiteAnalytics, openAnalyticsSettings } from './WebsiteAnalytics';
import { captureWebsiteEvent } from './telemetry';
import { ProviderIcon, WebSignIn } from './WebSignIn';
import { publicSiteHref } from './origins';

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
  <a className="account-skip" href="#account-content">Skip to account</a>
  <header className="account-header"><a className="account-brand" href={publicSiteHref()}><img src="/brand-icon.svg" width="32" height="32" alt=""/><span>Puptime</span></a><a className="account-home" href={publicSiteHref()}><span aria-hidden="true">←</span> Back to Puptime</a></header>
  <main className="account-layout"><aside className="account-intro"><Image source={require('../../assets/mascots/scruffy-terrier.png')} style={{width:280,height:280}} resizeMode="contain" accessibilityLabel="Puptime’s scruffy terrier"/><p className="account-intro-title">Puppy life,<br/>together.</p><p>Your account, cloud backup,<br/>and shared puppy care.</p></aside>
   <section className="account-content" id="account-content" tabIndex={-1} aria-label="Your account">{client?<AccountContent client={client}/>:<AccountLoading/>}</section>
  </main>
  <footer className="account-footer"><a href="https://github.com/patrickchin/puptime/blob/main/PRIVACY.md">Privacy</a><button type="button" className="text-button" onClick={openAnalyticsSettings}>Analytics settings</button></footer>
  <WebsiteAnalytics path="/account"/>
 </div>;
}
function AccountLoading(){return <div className="account-loading"><h1>Your account</h1><p role="status">Checking your sign-in…</p><div aria-hidden="true"/><div aria-hidden="true"/></div>;}
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
    const [nextConfig,account,providers]=await Promise.all([client.config(),user?client.summary(user.id):Promise.resolve(null),user?client.providers(user.id):Promise.resolve([] as Provider[])]);
    if(!mounted.current||ticket!==epoch.current||userId.current!==user?.id)return;
    setConfig(nextConfig);setSummary(account);setLinked(user?providers:null);
    const returning=pending.current;pending.current=null;
    if(returning){
     if(returning.intent==='sign-in'){captureWebsiteEvent('website_account',{action:'sign_in',result:user?'success':'error'});}
     else if(!user||user.id!==returning.userId)setError(messages.mismatch);
     else if(returning.intent==='reauth'){
      setReauth(returning.userId);
      if(!callbackFailed.current){await client.freshUser(returning.userId);if(!mounted.current||ticket!==epoch.current||userId.current!==returning.userId)return;setReauth(null);setNotice('Signed in again. Choose Delete cloud account to continue.');}
     }
     else if(returning.provider){const connected=providers.includes(returning.provider);captureWebsiteEvent('website_account',{action:'link_provider',result:connected?'success':'error'});if(connected)setNotice(`${providerName(returning.provider)} connected.`);else setError('The sign-in method wasn’t connected. Try again with the same email shown above.');}
    }
   }catch(reason){if(mounted.current&&ticket===epoch.current)setError(reason instanceof AccountError?messages[reason.kind]:messages.service);}
   finally{if(mounted.current&&ticket===epoch.current)setLoading(false);}
  })();
 },[client,user?.id,session.isPending,revision]);
 useEffect(()=>{if(confirmation)dialog.current?.showModal();else dialog.current?.close();},[confirmation]);
 async function run(name:string,action:()=>Promise<void>){
  if(locked.current)return false;locked.current=true;setBusy(name);setError('');setNotice('');
  try{await action();return true;}
  catch(reason){
   if(!mounted.current)return false;
   let kind=reason instanceof AccountError?reason.kind:'network';if(uncertain&&kind==='auth')kind='unconfirmed';
   if(kind==='reauth'){setConfirmation(null);setReauth(uncertain??userId.current??null);setSent(null);setCode('');}
   if(kind==='unconfirmed'){const expected=uncertain??confirmation??userId.current;if(expected)setUncertain(expected);setConfirmation(null);}
   if(kind==='mismatch'||kind==='auth'){setConfirmation(null);setReauth(null);setSummary(null);setLinked(null);void session.refetch();}
   const action=name==='email'?'request_code':name==='verify'||name==='apple'||name==='google'?'sign_in':name.startsWith('link-')?'link_provider':name==='delete'?'delete':name==='sign-out'?'sign_out':null;
   if(action)captureWebsiteEvent('website_account',{action,result:'error'});
   if(kind==='storage'&&name==='delete')setConfirmation(null);
   setError(kind==='storage'&&name==='delete'?'Allow browser storage before deleting your cloud account.':kind==='code'&&name==='email'?messages.email:kind==='code'&&(name==='apple'||name==='google')?messages.provider:messages[kind]);
   return false;
  }finally{locked.current=false;if(mounted.current)setBusy(null);}
 }
 async function requestCode(){
  const destination=reauth?(await client.sameUser(reauth)).user.email:email.trim();if(!destination)return;
  checkResult(await client.auth.emailOtp.sendVerificationOtp({email:destination,type:'sign-in'}));
  captureWebsiteEvent('website_account',{action:'request_code',result:'success'});
  if(mounted.current){if(sent)setNotice('A new code has been sent.');setSent(destination);setCode('');}
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
 const showingSignIn=!!reauth||!loading&&!session.isPending&&!user&&!uncertain;
 const signInForm=<div className="account-form"><WebSignIn headingLevel={reauth?2:1} providers={config?{email:config.providers.email,apple:!uncertain&&config.providers.apple&&(!reauth||!!linked?.includes('apple')),google:!uncertain&&config.providers.google&&(!reauth||!!linked?.includes('google'))}:null}
   email={email} onEmail={setEmail} sent={sent} code={code} onCode={setCode} busy={busy} disabled={disabled} error={error} codeInvalid={error===messages.code} reauth={!!reauth} onRetryConfig={()=>setRevision(value=>value+1)}
   onSubmit={()=>{void run(sent?'verify':'email',sent?verifyCode:requestCode);}} onSocial={provider=>{void run(provider,()=>social(provider));}}
   onResend={()=>run('email',requestCode)} onBack={()=>{setSent(null);setCode('');setError('');setNotice('');}}/>
  {reauth?<button type="button" className="text-button" disabled={disabled} onClick={()=>{setReauth(null);setSent(null);setCode('');}}>Cancel</button>:null}
 </div>;
 return <>
  {error&&!showingSignIn?<div role="alert" className="account-error">{error}</div>:null}
  {notice?<p role="status" className="account-notice">{notice}</p>:null}
  {appleManual?<p>Apple access wasn’t confirmed as revoked. In <a href="https://account.apple.com/">your Apple Account</a>, open Sign-In and Security → Sign in with Apple, then stop using Puptime.</p>:null}
  {uncertain?<div><h1>Account recovery</h1><p>We won’t create another account or restart sync automatically.</p>{reauth?signInForm:<button type="button" disabled={disabled} onClick={()=>{void run('delete-check',openDeletion);}}>Retry deletion</button>}<p><a href="https://github.com/patrickchin/puptime/issues">Get help</a></p></div>:loading||session.isPending?<AccountLoading/>:!user?signInForm:<>
   <h1>Your account</h1>
   <p className="account-email">{user.email}</p>
   {reauth?signInForm:<>
    <dl className="account-status"><div><dt>Cloud access</dt><dd>{summary?.cloud.canSync?'Available':'Sync paused'}</dd></div><div><dt>Saved puppies</dt><dd>{summary?.pets.length??'—'}</dd></div></dl>
    {(config?.providers.apple||config?.providers.google)?<div className="account-methods">{linked===null?<button disabled={disabled} onClick={()=>setRevision(value=>value+1)}>Refresh sign-in methods</button>:(['apple','google'] as const).filter(provider=>config?.providers[provider]).map(provider=>linked.includes(provider)?<p key={provider} className="account-connected"><ProviderIcon provider={provider}/>{providerName(provider)} connected</p>:<button key={provider} disabled={disabled} onClick={()=>{void run('link-'+provider,()=>connect(provider));}}>{busy==='link-'+provider?'Opening…':'Connect '+providerName(provider)}</button>)}</div>:null}
    {summary?.cloud.canExport?<form action="/api/account/export" method="post" onSubmit={()=>captureWebsiteEvent('website_account',{action:'export',result:'started'})}><input type="hidden" name="expectedAccount" value={user.id}/><input type="hidden" name="profilePhotos" value="1"/><button type="submit" className="account-download">Download cloud data <span aria-hidden="true">↓</span></button></form>:null}
    <p className="account-muted">Cloud data only. Unsynced changes stay on your iPhone.</p>
    <p><a href="/care">Open shared puppies</a></p>
    <div className="account-controls"><button className="text-button" disabled={disabled} onClick={()=>{void run('sign-out',async()=>{checkResult(await client.auth.signOut());await session.refetch();setSummary(null);setLinked(null);captureWebsiteEvent('website_account',{action:'sign_out',result:'success'});});}}>Sign out</button><button className="text-button account-danger" disabled={disabled} onClick={()=>{void run('delete-check',openDeletion);}}>Delete cloud account</button></div>
   </>}
  </>}
  {!loading&&!uncertain&&!reauth&&error&&(!config||!!user&&!summary)?<button type="button" className="text-button" disabled={disabled} onClick={()=>{setError('');setRevision(value=>value+1);void session.refetch();}}>Try again</button>:null}
  <dialog ref={dialog} className="account-dialog" aria-labelledby="delete-account-title" onCancel={event=>{if(!busy){setConfirmation(null);captureWebsiteEvent('website_account',{action:'delete',result:'cancelled'});}else event.preventDefault();}} onClose={()=>setConfirmation(null)}>
   <h2 id="delete-account-title">Delete cloud account?</h2><p>{user?.email}</p><p>Your account and cloud backup will be deleted. Logs saved on your iPhone stay there. Other signed-in devices lose cloud access.</p>
   <div className="account-inline"><button autoFocus disabled={!!busy} onClick={()=>{setConfirmation(null);captureWebsiteEvent('website_account',{action:'delete',result:'cancelled'});}}>Cancel</button><button className="account-delete" disabled={!!busy} onClick={()=>{void run('delete',remove);}}>{busy==='delete'?'Deleting…':'Delete cloud account'}</button></div>
  </dialog>
 </>;
}

const css=websiteStyles + `
/* Restore document scrolling after Expo's native reset, including short windows and zoom. */
body:has(.account-page:not(.care-page)){overflow-y:auto}
#root:has(.account-page:not(.care-page)){height:auto;min-height:100%}
.account-page{--surface:var(--white);--line:var(--border);--danger:#a32d26;min-height:100svh;height:max-content;flex-shrink:0;background:var(--paper);color:var(--ink);font:16px/1.5 'Red Hat Text',sans-serif}
.account-page *{box-sizing:border-box}.account-page a{color:var(--green);text-underline-offset:4px}.account-page button,.account-page input{font:inherit}.account-page button{cursor:pointer}.account-page button:disabled{cursor:default;opacity:.6}.account-page :focus-visible{outline:3px solid var(--green);outline-offset:4px}
.account-header,.account-footer{max-width:1200px;margin:auto;padding:24px 40px;display:flex;align-items:center;justify-content:space-between;gap:24px}.account-brand{display:flex;gap:10px;align-items:center;text-decoration:none;font-size:24px;font-weight:700;letter-spacing:-.7px}.account-home{display:flex;gap:10px;align-items:center;min-height:44px;font-size:14px;text-decoration:none}.account-home:hover{text-decoration:underline}
/* A 1040px plane: 480px illustration + 80px gutter + 480px form; form inset 48px per side. */
.account-layout{max-width:1120px;margin:32px auto 64px;padding:0 40px;display:grid;grid-template-columns:1fr 1fr;gap:80px;align-items:center}.account-intro{background:var(--mint);border-radius:24px;min-height:560px;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:32px 40px;text-align:center}.account-intro p{font-size:16px;line-height:1.6;color:var(--muted);margin:16px 0 0}.account-intro p.account-intro-title{font-family:'Red Hat Display',sans-serif;font-size:32px;line-height:1.1;letter-spacing:-1px;font-weight:900;color:var(--ink);margin:12px 0 0}
.account-content{min-width:0;padding:24px 0;max-width:384px;width:100%;margin:auto}.account-content h1{font-family:'Red Hat Display',sans-serif;font-size:32px;line-height:1.15;letter-spacing:-1px;margin:0 0 24px}.account-content h2{font-size:24px;margin:0 0 24px;letter-spacing:-.4px}.account-form{display:grid;gap:16px}
.account-content button:not(.text-button):not([class^="sign-in-"]),.account-download{border:1px solid var(--line);border-radius:999px;min-height:52px;padding:12px 18px;background:var(--surface);color:var(--green);font-weight:600}.text-button{border:0;background:transparent;padding:10px 0;min-height:44px;color:var(--green);text-align:left;text-decoration:underline;text-underline-offset:4px}.account-inline,.account-controls{display:flex;gap:24px;justify-content:space-between;flex-wrap:wrap}.account-muted{font-size:14px;color:var(--muted);margin:10px 0 20px}.account-email{font-size:18px;font-weight:600;overflow-wrap:anywhere;margin:0 0 24px}.account-status{margin:0 0 24px;padding-bottom:20px;border-bottom:1px solid var(--line)}.account-status div{display:flex;justify-content:space-between;gap:16px;margin:12px 0}.account-status dt{color:var(--muted)}.account-status dd{margin:0;font-weight:400;text-align:right;font-variant-numeric:tabular-nums}.account-methods{display:grid;gap:12px;margin-bottom:24px}.account-connected{display:flex;align-items:center;gap:10px;margin:6px 0;color:var(--green)}.account-download{display:flex;width:100%;justify-content:space-between;text-decoration:none}.account-controls{border-top:1px solid var(--line);padding-top:14px;margin-top:24px}.account-content .account-danger{color:var(--danger)}.account-error,.account-notice{font-size:14px;padding:12px 16px;margin:0 0 20px;overflow-wrap:anywhere;border-radius:8px}.account-error{color:var(--danger);background:#faebe6}.account-notice{color:var(--green);background:var(--mint)}
.account-dialog{border:1px solid var(--line);border-radius:24px;max-width:500px;width:calc(100% - 32px);background:var(--surface);color:var(--ink);padding:28px}.account-dialog::backdrop{background:#17231e66}.account-dialog p{overflow-wrap:anywhere}.account-content button.account-delete{background:var(--danger);color:white;border-color:var(--danger)}.account-footer{justify-content:center;font-size:13px;padding-top:0;padding-bottom:24px}.account-footer a{min-height:44px;display:flex;align-items:center}.account-loading p{color:var(--muted)}.account-loading>div{height:52px;border-radius:999px;background:var(--mint);margin:16px 0}.account-skip{position:fixed;top:12px;left:12px;transform:translateY(-180%);padding:12px 20px;z-index:20;background:var(--white)}.account-skip:focus{transform:none}
@media(max-width:900px){.account-layout{gap:40px;padding:0 32px}.account-intro{padding:24px;min-height:520px}.account-intro>div{width:220px!important;height:220px!important}}
@media(max-width:680px){.account-header{padding:16px 24px}.account-brand{font-size:22px}.account-home{font-size:13px;gap:6px}.account-layout{display:block;margin:24px auto 40px;padding:0 24px}.account-intro{display:none}.account-content{padding:0;max-width:384px}.account-content h1{font-size:28px}.account-footer{padding:0 24px 24px;gap:24px}.account-dialog{padding:22px}}
`;

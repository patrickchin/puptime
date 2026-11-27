import { privacyPath } from '../src/public-site';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import Head from 'expo-router/head';
import { AccountDeletionError } from '../src/cloud/account-deletion';
import { createWebDeletionClient, type DeletionIdentity } from '../src/web/account-deletion';
import { SiteFooter, SiteHeader } from '../src/web/SiteChrome';

type Step='email'|'code'|'confirm'|'done';
type Operation='send'|'verify'|'delete'|'signout';
const statusMessages={send:'Sending code…',verify:'Verifying…',delete:'Deleting cloud account…',signout:'Signing out…'};
const messages={
 code:'That code is invalid or has expired. Request a new code and try again.',
 rate:'Too many attempts. Wait a little before trying again.',
 service:'Account verification is unavailable. Please try again later.',
 network:'Could not reach Puptime. Check your connection and try again.',
 auth:'Sign in again to review this deletion.',
 mismatch:'The signed-in account changed. Sign in again before reviewing a new deletion.',
 reauth:'Your verification expired. Sign in again to review this deletion.',
 unconfirmed:'We could not confirm the result. Sign in again with the same email to check your account. Deletion will not continue automatically.',
};

export default function DeleteAccount(){
 const client=useRef<ReturnType<typeof createWebDeletionClient>|null>(null);
 const locked=useRef(false),heading=useRef<HTMLHeadingElement>(null);
 const [step,setStep]=useState<Step>('email'),[email,setEmail]=useState(''),[code,setCode]=useState('');
 const [user,setUser]=useState<DeletionIdentity|null>(null),[confirmed,setConfirmed]=useState(false);
 const [operation,setOperation]=useState<Operation|null>(null),[error,setError]=useState(''),[appleManual,setAppleManual]=useState(false);
 const busy=operation!==null;
 useEffect(()=>{client.current=createWebDeletionClient(window.location.origin);},[]);
 useEffect(()=>{if(step!=='email')heading.current?.focus();},[step]);
 function reset(){setCode('');setUser(null);setConfirmed(false);setStep('email');}
 async function act(operation:Operation,work:()=>Promise<void>){
  if(locked.current||!client.current)return;
  locked.current=true;setOperation(operation);setError('');
  try{await work();}catch(value){
   const kind=value instanceof AccountDeletionError?value.kind:'network';
   if(['auth','mismatch','reauth','unconfirmed'].includes(kind))reset();
   setError(messages[kind]);
  }finally{locked.current=false;setOperation(null);}
 }
 function send(event:FormEvent){event.preventDefault();const address=email.trim().toLowerCase();void act('send',async()=>{
  await client.current!.requestCode(address);setEmail(address);setCode('');setStep('code');
 });}
 function verify(event:FormEvent){event.preventDefault();void act('verify',async()=>{
  const original=await client.current!.verify(email,code);setCode('');setUser(original);setConfirmed(false);setStep('confirm');
 });}
 function remove(event:FormEvent){event.preventDefault();if(!user||!confirmed)return;const original=user;void act('delete',async()=>{
  const result=await client.current!.remove(original.id);setAppleManual(result.appleManual);setUser(null);setEmail('');setConfirmed(false);setStep('done');
 });}
 function cancel(){void act('signout',async()=>{await client.current!.cancel();reset();});}
 return <div className="marketing-site care-page site-page deletion-page">
  <Head><title>Delete your account | Puptime</title><meta name="robots" content="noindex, nofollow"/><meta name="referrer" content="no-referrer"/></Head>
  <SiteHeader path="/delete-account"/>
  <main className="deletion-content" aria-busy={busy}>
   <h1 ref={heading} tabIndex={-1}>{step==='done'?'Cloud account deleted':'Delete your Puptime account'}</h1>
   {step==='email'&&<>
    <p>Verify the email on your existing account. You can delete your cloud account here without installing Puptime.</p>
    <form onSubmit={send}>
     <label htmlFor="deletion-email">Account email</label>
     <input id="deletion-email" type="email" autoComplete="email" maxLength={320} required value={email} onChange={event=>setEmail(event.target.value)} disabled={busy}/>
     <button className="submit-action" disabled={busy}>Send verification code</button>
    </form>
    <details><summary>Used Google or Sign in with Apple?</summary><p>Use the email shown in Puptime’s My account screen. If you chose Hide My Email with Apple, use that account’s private relay address.</p></details>
   </>}
   {step==='code'&&<>
    <p>If an account exists for <strong>{email}</strong>, a six-digit code has been sent. It expires in five minutes.</p>
    <form onSubmit={verify}>
     <label htmlFor="deletion-code">Verification code</label>
     <input id="deletion-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={event=>setCode(event.target.value)} disabled={busy}/>
     <button className="submit-action" disabled={busy}>Verify and review deletion</button>
    </form>
    <button className="text-button" disabled={busy} onClick={()=>{reset();setError('');}}>Change email or request a new code</button>
   </>}
   {step==='confirm'&&user&&<>
    <p className="account-identity">Verified account<br/><strong>{user.email}</strong></p>
    <p>This permanently removes your account, sign-in methods, cloud puppy profiles, photos and cloud activity history from the live service.</p>
    <p>Logs on your phones and files you downloaded stay with you. Contributions to someone else’s puppy history remain in their account.</p>
    <form onSubmit={remove}>
     <label className="confirmation"><input type="checkbox" required checked={confirmed} onChange={event=>setConfirmed(event.target.checked)} disabled={busy}/><span>I want to delete the cloud account shown above.</span></label>
     <button className="submit-action danger" disabled={busy||!confirmed}>Delete cloud account</button>
    </form>
    <button className="text-button" disabled={busy} onClick={cancel}>Cancel and sign out</button>
   </>}
   {step==='done'&&<>
    <p>Your account and its cloud records have been removed from the live service. Local phone logs and downloaded files remain.</p>
    {appleManual&&<p>Apple did not confirm authorization revocation. Remove Puptime from <a href="https://account.apple.com/">your Apple Account’s Sign in with Apple settings</a>.</p>}
    <a className="text-action" href="/">Back to Puptime</a>
   </>}
   {operation&&<p role="status">{statusMessages[operation]}</p>}
   {error&&<p role="alert">{error}</p>}
   {step!=='done'&&<aside><p>Backup copies kept by our hosting provider, Cloudflare, can remain for up to 30 days after deletion before they’re erased. Older Puptime installs can’t bring a deleted account back.</p><p>You can also delete your cloud account in Puptime’s My account screen after recent sign-in.</p><a href={privacyPath}>Read the privacy policy</a></aside>}
  </main>
  <SiteFooter path="/delete-account"/>
 </div>;
}

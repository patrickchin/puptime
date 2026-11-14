import { useEffect, useRef, useState, type FormEvent } from 'react';
import Head from 'expo-router/head';
import { AccountDeletionError } from '../src/cloud/account-deletion';
import { createWebDeletionClient, type DeletionIdentity } from '../src/web/account-deletion';
import { marketingStyles } from '../src/web/marketing-styles';
import { websiteTheme } from '../src/web/brand';

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
 return <div className="marketing-site care-page deletion-page">
  <Head><title>Delete your account | Puptime</title><meta name="robots" content="noindex, nofollow"/><meta name="referrer" content="no-referrer"/><link rel="icon" href="/brand-icon.png" type="image/png"/></Head>
  <style>{marketingStyles+css}</style>
  <header className="site-header"><a className="site-brand" href="/"><img src="/brand-icon.png" width="38" height="38" alt=""/>Puptime</a><nav aria-label="Website"><a href="/">Home</a><a href="https://github.com/patrickchin/puptime/blob/main/PRIVACY.md">Privacy</a></nav></header>
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
   {step!=='done'&&<aside><p>Deletion does not erase provider-managed recovery copies immediately. Cloudflare recovery copies can remain for up to 30 days; a non-content retirement marker prevents old clients from restoring the deleted account.</p><p>You can also delete your cloud account in Puptime’s My account screen after recent sign-in.</p><a href="https://github.com/patrickchin/puptime/blob/main/PRIVACY.md">Read the privacy policy</a></aside>}
  </main>
 </div>;
}
const css=`.deletion-page{min-height:100svh}.deletion-content{max-width:640px;margin:48px auto;padding:0 24px 64px}.deletion-content h1{font-size:clamp(32px,5vw,44px);line-height:1.05;margin-bottom:24px}.deletion-content h1:focus{outline:none}.deletion-content p{margin:18px 0;overflow-wrap:anywhere}.deletion-content form{margin:28px 0 12px}.deletion-content label{display:block;font-size:16px;font-weight:700;margin-bottom:8px}.deletion-content input:not([type=checkbox]){width:100%;min-height:52px;border:1px solid var(--border);border-radius:4px;padding:12px;background:var(--white);color:var(--ink);font:inherit}.deletion-content input:focus-visible{outline:3px solid var(--green);outline-offset:3px}.deletion-content .submit-action{display:block;width:100%;min-height:52px;padding:14px 20px;margin-top:20px;border:1px solid var(--green);border-radius:4px;background:var(--green);color:var(--white);font-weight:700}.deletion-content button:disabled{opacity:.5;cursor:default}.deletion-content .danger{background:${websiteTheme.danger};border-color:${websiteTheme.danger}}.deletion-content .text-button{padding:10px 0;min-height:44px;border:0;background:none;text-decoration:underline;text-underline-offset:4px;font-size:16px}.deletion-content details{font-size:16px;margin-top:24px}.deletion-content summary{min-height:44px;padding:10px 0;cursor:pointer}.deletion-content aside{margin-top:40px;border-top:1px solid var(--border);padding-top:8px;font-size:14px;color:var(--muted)}.deletion-content aside a,.deletion-content p a{text-decoration:underline;text-underline-offset:4px}.deletion-content .account-identity{padding:18px 0;border-bottom:1px solid var(--border);margin-bottom:24px}.deletion-content .confirmation{display:flex;align-items:flex-start;gap:12px;font-weight:400;font-size:16px}.deletion-content input[type=checkbox]{flex:none;width:20px;height:20px;margin:2px 0;accent-color:var(--green)}.deletion-content [role=alert]{color:${websiteTheme.danger};font-weight:700}@media(max-width:600px){.deletion-content{margin-top:32px}.deletion-page .site-header{padding:16px}.deletion-page .site-header nav{gap:16px;font-size:14px}}`;

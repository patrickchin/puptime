import { useEffect, useState } from 'react';
import Head from 'expo-router/head';
import { marketingStyles } from './marketing-styles';
import { nativeCareLink } from './app-link';

export function AppHandoffPage({ invitation=false }: { invitation?:boolean }) {
 const [href,setHref]=useState<string|null>(invitation?null:'puptime://');
 const [ready,setReady]=useState(!invitation);
 useEffect(()=>{if(invitation){setHref(nativeCareLink(window.location.href));setReady(true);}},[invitation]);
 const invalid=ready&&!href;
 return <div className="marketing-site care-page app-handoff">
  <Head><title>{`${invitation?'Shared puppy care':'Your account'} | Puptime`}</title><meta name="robots" content="noindex, nofollow"/><meta name="referrer" content="no-referrer"/><link rel="icon" href="/brand-icon.png" type="image/png"/></Head>
  <style>{marketingStyles+css}</style>
  <header className="site-header"><a className="site-brand" href="/"><img src="/brand-icon.png" width="38" height="38" alt=""/>Puptime</a><nav aria-label="Website"><a href="/">Home</a><a href="/puppy-care/">Puppy care</a></nav></header>
  <main className="handoff-content">
   <h1>{invalid?'Check your invitation':invitation?'Puppy care is in the app.':'Your account is in the app.'}</h1>
   <p>{invalid?'This invitation link is incomplete or invalid. Ask the puppy’s owner for the original link.':invitation?'Open Puptime to accept an invitation or see puppies shared with you.':'Sign in, manage cloud backup, and export your data in Puptime.'}</p>
   {href?<a className="primary-action" href={href}>Open Puptime <span aria-hidden="true">↗</span></a>:!ready?<p role="status">Checking invitation…</p>:null}
   <p className="handoff-help"><a href="https://github.com/patrickchin/puptime">Get Puptime</a> · <a href="https://github.com/patrickchin/puptime/issues">Get help</a></p>
  </main>
 </div>;
}
const css=`.app-handoff{min-height:100svh}.app-handoff .handoff-content{max-width:680px;margin:72px auto;padding:0 24px 64px}.app-handoff h1{font-size:clamp(32px,5vw,48px);line-height:1.1;margin-bottom:24px}.app-handoff main>p{margin:0;max-width:48ch}.app-handoff .handoff-help{font-size:14px;margin-top:36px}.app-handoff .handoff-help a{text-decoration:underline;text-underline-offset:4px}@media(max-width:600px){.app-handoff .handoff-content{margin-top:48px}.app-handoff .site-header{padding:16px;gap:12px}.app-handoff .site-header nav{gap:12px}.app-handoff .site-header nav a{font-size:14px;white-space:nowrap}.app-handoff .site-brand{font-size:22px}}`;

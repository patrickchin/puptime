import { supportPath } from '../public-site';
import { useEffect, useRef, useState } from 'react';
import Head from 'expo-router/head';
import { SiteFooter, SiteHeader } from './SiteChrome';
import { handoffDevice, nativeCareLink, type HandoffDevice } from './app-link';

export function AppHandoffPage({ invitation=false }: { invitation?:boolean }) {
 const [href,setHref]=useState<string|null>(invitation?null:'puptime://');
 const [ready,setReady]=useState(!invitation);
 useEffect(()=>{if(invitation){setHref(nativeCareLink(window.location.href));setReady(true);}},[invitation]);
 const [device,setDevice]=useState<HandoffDevice|null>(null);
 const [notOpened,setNotOpened]=useState(false);
 const stopWatching=useRef<(()=>void)|null>(null);
 useEffect(()=>{setDevice(handoffDevice(navigator.userAgent,navigator.maxTouchPoints));return()=>stopWatching.current?.();},[]);
 const watchOpen=()=>{
  stopWatching.current?.();setNotOpened(false);
  const left=()=>stopWatching.current?.(),visibility=()=>{if(document.visibilityState==='hidden')left();};
  const timer=window.setTimeout(()=>{stopWatching.current?.();if(document.visibilityState==='visible')setNotOpened(true);},1800);
  window.addEventListener('pagehide',left);window.addEventListener('blur',left);document.addEventListener('visibilitychange',visibility);
  stopWatching.current=()=>{window.clearTimeout(timer);window.removeEventListener('pagehide',left);window.removeEventListener('blur',left);document.removeEventListener('visibilitychange',visibility);stopWatching.current=null;};
 };
 const invalid=ready&&!href,invite=!!href?.startsWith('puptime://care'),desktop=device==='desktop';
 return <div className="marketing-site care-page site-page app-handoff">
  <Head><title>{`${invitation?'Shared puppy care':'Your account'} | Puptime`}</title><meta name="robots" content="noindex, nofollow"/><meta name="referrer" content="no-referrer"/></Head>
  <SiteHeader path={invitation?'/care':'/account'}/>
  <main className="handoff-content">
   <h1>{invalid?'Check your invitation':invite?'You’re invited to help care for a puppy.':invitation?'Shared puppies are in the app.':'Your account is in the app.'}</h1>
   <p>{invalid?'This invitation link is incomplete or invalid. Ask the puppy’s owner for the original link.':invite?'Open Puptime to accept the invitation. The shared puppy then appears in your app.':invitation?'Open Puptime to accept an invitation or see puppies shared with you.':'Sign in, manage cloud backup, and export your data in Puptime.'}</p>
   {href&&desktop&&<p className="handoff-desktop">{invite?'Open this invitation link on your phone, where Puptime is installed.':'Puptime is a phone app. Open it on your phone to continue.'}</p>}
   {href?<a className={desktop?'text-action':'primary-action'} href={href} onClick={watchOpen}>Open Puptime{!desktop&&<span aria-hidden="true">→</span>}</a>:!ready?<p role="status">Checking invitation…</p>:null}
   <div role="status">{notOpened&&<p className="handoff-fallback"><strong>Puptime didn’t open?</strong> Install it first, then come back to this {invitation?'link':'page'}. <a href="/download/android.apk">Get the Android APK</a>. The iPhone app isn’t publicly available yet.</p>}</div>
   {!invitation&&<p className="handoff-help"><a href="/delete-account">Delete your cloud account on the web</a></p>}
   <p className="handoff-help"><a href="/download/android.apk">Download Android APK</a> · <a href={supportPath}>Get help</a></p>
  </main>
  <SiteFooter path={invitation?'/care':'/account'}/>
 </div>;
}

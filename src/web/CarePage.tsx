import {memo,useCallback,useEffect,useRef,useState} from 'react';
import Head from 'expo-router/head';
import {getWebAccountClient,checkResult} from './account-client';
import {createCareClient,CareError,type CareClient,type CarePage as Page,type CarePreview,type CareRow} from './care-client';
import {shareIdSchema,inviteTokenSchema,reuseCareRows as reuseRows,careEditPatch,type CareWrite} from '../sharing';
import {entityId} from '../entity-id';
import {eventTypes,type EventType} from '../domain';
import {websiteStyles} from './brand';

const activityNames:Record<EventType,string>={pee:'Pee',poop:'Poop',meal:'Meal',pottyTrip:'Potty break',walk:'Walk',nap:'Nap',custom:'Other activity'};
const dateTime=(at:number)=>new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(at);
const inputTime=(at:number)=>{const date=new Date(at);return new Date(at-date.getTimezoneOffset()*60000).toISOString().slice(0,16);};
const problem=(reason:unknown)=>reason instanceof Error?reason.message:'Couldn’t load Puptime. Try again.';
export default function CarePage(){
 const [client,setClient]=useState<CareClient|null>(null),[id,setId]=useState<string|null>(null),[token,setToken]=useState<string|null>(null),[initialError,setInitialError]=useState('');
 useEffect(()=>{
  setClient(createCareClient(window.location.origin));
  const url=new URL(window.location.href),candidate=url.searchParams.get('invite');
  if(candidate){
   if(!shareIdSchema.safeParse(candidate).success){setInitialError('This invitation link is invalid. Ask the owner for a new one.');return;}
   setId(candidate);
   try{
    const key=`puptime.care.invite.${candidate}`,secret=url.hash.slice(1)||sessionStorage.getItem(key);
    if(secret&&inviteTokenSchema.safeParse(secret).success){setToken(secret);sessionStorage.setItem(key,secret);}
   }catch{if(inviteTokenSchema.safeParse(url.hash.slice(1)).success)setToken(url.hash.slice(1));}
   // Invitation credentials never enter API URLs, referrers or analytics.
   if(url.hash)window.history.replaceState(window.history.state,'',url.pathname+url.search);
  }
 },[]);
 return <div className="account-page care-page"><Head><title>Shared puppy care | Puptime</title><meta name="robots" content="noindex, nofollow"/><meta name="referrer" content="no-referrer"/></Head><style>{css}</style>
  <header><a className="care-brand" href="/"><img src="/brand-icon.svg" width="32" height="32" alt=""/>Puptime</a><a href="/care">Shared puppies</a></header>
  <main>{initialError?<p role="alert">{initialError}</p>:client?<CareContent client={client} id={id} token={token} clearToken={()=>{if(id)try{sessionStorage.removeItem(`puptime.care.invite.${id}`);}catch{}setToken(null);}}/>:<p role="status">Loading puppy care…</p>}</main>
 </div>;
}
function CareContent({client,id,token,clearToken}:{client:CareClient;id:string|null;token:string|null;clearToken:()=>void}){
 const [preview,setPreview]=useState<CarePreview|null>(null),[page,setPage]=useState<Page|null>(null),[routines,setRoutines]=useState<CareRow[]>([]),[puppies,setPuppies]=useState<{id:string;name:string;ownerName:string}[]|null>(null);
 const [error,setError]=useState(''),[loading,setLoading]=useState(true),[accepting,setAccepting]=useState(false),[name,setName]=useState(''),[signedIn,setSignedIn]=useState(false),[retry,setRetry]=useState(0);
 const generation=useRef(0),acceptLock=useRef(false);
 const [newLog,setNewLog]=useState(false),[newRoutine,setNewRoutine]=useState(false),[busy,setBusy]=useState(false);
 const active=useRef(true);useEffect(()=>{active.current=true;return()=>{active.current=false;generation.current++;};},[]);
 useEffect(()=>{
  const ticket=++generation.current;setLoading(true);setError('');setPage(null);setPreview(null);
  void(async()=>{
   try{
    if(!id){const result=await client.puppies();if(ticket===generation.current)setPuppies(result.puppies);return;}
    try{
     const [logs,routine]=await Promise.all([client.page(id),allRoutines(client,id)]);
     if(ticket===generation.current){setPage(logs);setRoutines(routine);if(token)clearToken();}return;
    }catch(reason){if(!(reason instanceof CareError)||reason.status!==401||!token)throw reason;}
    const next=await client.preview(id,token);if(ticket===generation.current)setPreview(next);
   }catch(reason){if(ticket===generation.current)setError(problem(reason));}
   finally{if(ticket===generation.current)setLoading(false);}
  })();
 },[client,id,retry,signedIn]);
 const refresh=useCallback(async()=>{
  if(!id)return;const ticket=generation.current;
  try{
   const [logs,routine]=await Promise.all([client.page(id),allRoutines(client,id)]);
   if(active.current&&ticket===generation.current){setPage(previous=>({...logs,records:reuseRows(previous?.records??[],logs.records)}));setRoutines(previous=>reuseRows(previous,routine));setError('');}
  }catch(reason){if(active.current&&ticket===generation.current){setError(problem(reason));if(reason instanceof CareError&&[401,403,410].includes(reason.status)){setPage(null);setRoutines([]);}}}
 },[client,id]);
 useEffect(()=>{
  if(!page||busy)return;
  const timer=setInterval(()=>{if(document.visibilityState==='visible')void refresh();},15000);
  return()=>clearInterval(timer);
 },[!!page,busy,refresh]);
 const write=useCallback(async(input:CareWrite)=>{if(!id)return;await client.write(id,input);await refresh();},[client,id,refresh]);
 async function accept(){
  if(!id||!token||acceptLock.current)return;acceptLock.current=true;setAccepting(true);setError('');
  try{await client.accept(id,token,name);clearToken();setRetry(value=>value+1);}
  catch(reason){setError(problem(reason));}finally{acceptLock.current=false;if(active.current)setAccepting(false);}
 }
 async function more(){
  if(!id||!page?.nextCursor||busy)return;setBusy(true);const ticket=generation.current;
  try{const next=await client.page(id,'event',page.nextCursor);if(active.current&&ticket===generation.current)setPage(current=>current?{...current,records:[...current.records,...next.records.filter(row=>!current.records.some(old=>old.record.id===row.record.id))],nextCursor:next.nextCursor}:current);}
  catch(reason){setError(problem(reason));}finally{if(active.current)setBusy(false);}
 }
 if(loading)return <p role="status">Loading puppy care…</p>;
 if(!id)return <><p className="eyebrow">YOUR HOUSEHOLD</p><h1>Shared puppies</h1>{error?<p role="alert" className="care-error">{error}</p>:null}{puppies?<>{puppies.length?<ul className="puppy-list">{puppies.map(puppy=><li key={puppy.id}><a href={`/care?invite=${puppy.id}`}><strong>{puppy.name}</strong><span>Shared by {puppy.ownerName||'their owner'}</span></a></li>)}</ul>:<p>No puppies have been shared with this account yet. Open the invitation your household member sent you.</p>}<a href="/account">Your account</a></>:<><p>Sign in to see puppies shared with you. For temporary care, open your invitation link.</p><CareSignIn onSignedIn={()=>{setSignedIn(true);setRetry(value=>value+1);}}/></>}</>;
 if(!page)return <>{error?<p role="alert" className="care-error">{error}</p>:null}{preview?<>
  <p className="eyebrow">SHARED BY {preview.ownerName||'THEIR OWNER'}</p><h1>You’re looking after {preview.puppyName}.</h1>
  <p>{preview.share.kind==='household'?'Join the household to see the full history, record activities and manage routines. Your access continues until the owner removes it.':`${preview.share.permission==='view'?'View recent logs and routines':'View recent logs, routines and add activities'}. Access ends ${dateTime(preview.share.expiresAt!)}.`}</p>
  {preview.share.kind==='temporary'?<label className="care-field">Your name <span className="muted">(optional)</span><input autoComplete="given-name" maxLength={80} value={name} onChange={event=>setName(event.target.value)}/></label>:<CareSignIn onSignedIn={()=>setSignedIn(true)}/>}
  <button className="primary" disabled={accepting||preview.share.kind==='household'&&!signedIn} onClick={()=>{void accept();}}>{accepting?'Opening…':preview.share.kind==='household'?'Join household':'Open puppy logs'}</button>
 </>:<><h1>Access unavailable</h1><p>Open your original invitation, or ask the puppy’s owner for a new one.</p><button onClick={()=>setRetry(value=>value+1)}>Try again</button></>}</>;
 const household=page.share.kind==='household',canAdd=page.share.permission==='contribute';
 return <>
  <p className="eyebrow">{household?'HOUSEHOLD MEMBER':'TEMPORARY CARE'} · {household?'UNTIL REMOVED':`ENDS ${dateTime(page.share.expiresAt!)}`}</p>
  <h1>{page.puppyName}</h1><p className="muted">Shared by {page.ownerName||'their owner'} · {page.actorName}</p>
  {household?<p><a href={`puptime://care?invite=${page.share.id}`}>Open in Puptime</a></p>:null}
  {error?<p role="alert" className="care-error">{error}</p>:null}
  <div className="care-actions">{canAdd?<button className="primary" onClick={()=>setNewLog(true)}>Log an activity</button>:<span className="care-pill">View only</span>}<button onClick={()=>{void refresh();}}>Refresh logs</button></div>
  {newLog?<CareEditor kind="event" write={write} onClose={()=>setNewLog(false)}/>:null}
  <section aria-labelledby="routine-heading"><div className="section-heading"><h2 id="routine-heading">Daily routine</h2>{household?<button onClick={()=>setNewRoutine(true)}>Add routine</button>:null}</div>
   {newRoutine?<CareEditor kind="routine" write={write} onClose={()=>setNewRoutine(false)}/>:null}
   {routines.length?routines.slice().sort((a,b)=>('minutes' in a.record.data?a.record.data.minutes:0)-('minutes' in b.record.data?b.record.data.minutes:0)).map(row=><CareLogRow key={row.record.id} row={row} write={write} allowEdit={household}/>):<p className="muted">No routine set up yet.</p>}
  </section>
  <section aria-labelledby="logs-heading"><h2 id="logs-heading">{household?'Puppy logs':'Recent logs · last 7 days'}</h2>
   {page.records.length?page.records.slice().sort((a,b)=>('at' in b.record.data?b.record.data.at:0)-('at' in a.record.data?a.record.data.at:0)).map(row=><CareLogRow key={row.record.id} row={row} write={write} allowEdit={canAdd&&row.canEdit}/>):<p className="muted">No logs here yet.</p>}
   {page.nextCursor?<button disabled={busy} onClick={()=>{void more();}}>{busy?'Loading…':'Load more logs'}</button>:null}
  </section>
 </>;
}
async function allRoutines(client:CareClient,id:string){const rows:CareRow[]=[];let after=0;do{const page=await client.page(id,'routine',after);rows.push(...page.records);if(page.nextCursor===null)return rows;after=page.nextCursor;}while(rows.length<1000);throw new Error('Too many routines to display.');}
const CareLogRow=memo(function CareLogRow({row,write,allowEdit}:{row:CareRow;write:(input:CareWrite)=>Promise<void>;allowEdit:boolean}){
 const [editing,setEditing]=useState<CareRow|null>(null),record=row.record,data=record.data;
 if(record.kind!=='event'&&record.kind!=='routine'||!('type' in data))return null;
 return <article className="care-row" data-record={record.id}><div><strong>{data.type==='custom'&&'customLabel' in data?data.customLabel:activityNames[data.type]}</strong><p className="muted">{'at' in data?dateTime(data.at):'minutes' in data?new Intl.DateTimeFormat(undefined,{hour:'numeric',minute:'2-digit'}).format(new Date(2000,0,1,Math.floor(data.minutes/60),data.minutes%60)):''}{'endedAt' in data?data.endedAt===null?' · Nap in progress':data.endedAt!==undefined?` · Ended ${dateTime(data.endedAt)}`:'':''}</p>{'note' in data&&data.note?<p className="care-note">{data.note}</p>:null}</div>
  {allowEdit?<button onClick={()=>setEditing(value=>value?null:row)}>{editing?'Cancel':'Edit'}</button>:null}
  {editing?<CareEditor kind={record.kind} row={editing} write={write} onClose={()=>setEditing(null)}/>:null}
 </article>;
});
function CareEditor({kind,row,write,onClose}:{kind:'event'|'routine';row?:CareRow;write:(input:CareWrite)=>Promise<void>;onClose:()=>void}){
 const data=row?.record.data;
 const [type,setType]=useState<EventType>(data&&'type' in data?data.type:'walk'),[at,setAt]=useState(data&&'at' in data?inputTime(data.at):inputTime(Date.now())),[endedAt,setEndedAt]=useState(data&&'endedAt' in data&&typeof data.endedAt==='number'?inputTime(data.endedAt):'');
 const [time,setTime]=useState(data&&'minutes' in data?`${String(Math.floor(data.minutes/60)).padStart(2,'0')}:${String(data.minutes%60).padStart(2,'0')}`:'09:00');
 const [customLabel,setCustomLabel]=useState(data&&'customLabel' in data?data.customLabel??'':''),[note,setNote]=useState(data&&'note' in data?data.note?.replace(/(?:^|\n\n)Logged by [^\n]+$/,'')??'':'');
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[deleting,setDeleting]=useState(false);
 const draft=useRef<{fingerprint:string;requestId:string;localId:string}|null>(null),locked=useRef(false);
 async function save(remove=false){
  if(locked.current)return;locked.current=true;setBusy(true);setError('');
  try{
   const patch=remove?{}:careEditPatch(row,kind==='event'?{type,at:new Date(at).getTime(),source:'app' as const,note,...(type==='nap'?{endedAt:endedAt?new Date(endedAt).getTime():null}:{}),...(type==='custom'?{customLabel}:{})}:{type,minutes:Number(time.slice(0,2))*60+Number(time.slice(3)),...(type==='custom'?{customLabel}:{})});
   if(!remove&&row&&!Object.keys(patch).length){onClose();return;}
   const fingerprint=JSON.stringify({patch,remove,revision:row?.record.revision});
   if(draft.current?.fingerprint!==fingerprint)draft.current={fingerprint,requestId:entityId('csr'),localId:row?.localId??entityId(kind==='event'?'evt':'rtn')};
   await write({kind,requestId:draft.current.requestId,localId:draft.current.localId,intent:remove?'delete':row?'patch':'create',...(row?{expectedRevision:row.record.revision}:{}),patch} as CareWrite);onClose();
  }catch(reason){setError(problem(reason));}finally{locked.current=false;setBusy(false);}
 }
 return <form className="care-editor" onSubmit={event=>{event.preventDefault();void save();}}><h3>{row?'Edit':kind==='event'?'Log an activity':'Add routine'}</h3>
  {error?<p role="alert" className="care-error">{error}</p>:null}
  <label>Activity<select value={type} disabled={busy||!!row} onChange={event=>setType(event.target.value as EventType)}>{eventTypes.map(value=><option key={value} value={value}>{activityNames[value]}</option>)}</select></label>
  {type==='custom'?<label>Activity name<input value={customLabel} onChange={event=>setCustomLabel(event.target.value)} required maxLength={40} disabled={busy}/></label>:null}
  {kind==='event'?<><label>Date and time<input type="datetime-local" value={at} onChange={event=>setAt(event.target.value)} required disabled={busy}/></label>{type==='nap'?<label>Nap ended <span className="muted">(leave empty while sleeping)</span><input type="datetime-local" value={endedAt} min={at} onChange={event=>setEndedAt(event.target.value)} disabled={busy}/></label>:null}<label>Note <span className="muted">(optional)</span><textarea maxLength={16000} value={note} onChange={event=>setNote(event.target.value)} disabled={busy}/></label></>:<label>Time<input type="time" required value={time} onChange={event=>setTime(event.target.value)} disabled={busy}/></label>}
  <div className="care-actions"><button className="primary" disabled={busy}>{busy?'Saving…':'Save'}</button><button type="button" onClick={onClose} disabled={busy}>Cancel</button>{row?<button type="button" className="danger" disabled={busy} onClick={()=>{if(deleting)void save(true);else setDeleting(true);}}>{deleting?'Confirm delete':'Delete'}</button>:null}</div>
 </form>;
}
function CareSignIn({onSignedIn}:{onSignedIn:()=>void}){
 const client=getWebAccountClient(),session=client.auth.useSession();
 const [email,setEmail]=useState(''),[sent,setSent]=useState<string|null>(null),[code,setCode]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[providers,setProviders]=useState<{apple:boolean;google:boolean;email:boolean}|null>(null);
 const locked=useRef(false),notified=useRef<string|null>(null);
 useEffect(()=>{if(session.data?.user&&notified.current!==session.data.user.id){notified.current=session.data.user.id;onSignedIn();}},[session.data?.user.id,onSignedIn]);
 useEffect(()=>{void client.config().then(value=>setProviders(value.providers)).catch(reason=>setError(problem(reason)));},[client]);
 async function signIn(provider?:'apple'|'google'){
  if(locked.current)return;locked.current=true;setBusy(true);setError('');
  try{
   if(provider){checkResult(await client.auth.signIn.social({provider,callbackURL:window.location.href,errorCallbackURL:window.location.href}));return;}
   if(!sent){checkResult(await client.auth.emailOtp.sendVerificationOtp({email:email.trim(),type:'sign-in'}));setSent(email.trim());}
   else{checkResult(await client.auth.signIn.emailOtp({email:sent,otp:code}));await session.refetch();}
  }catch{setError('Sign-in wasn’t completed. Check your code or try again.');}finally{locked.current=false;setBusy(false);}
 }
 if(session.isPending)return <p role="status">Checking sign-in…</p>;
 if(session.data?.user)return <p className="care-signed-in">Signed in as {session.data.user.email}</p>;
 return <div className="care-sign-in"><h2>Sign in to your household</h2>{error?<p role="alert" className="care-error">{error}</p>:null}
  {(['apple','google'] as const).filter(provider=>providers?.[provider]).map(provider=><button key={provider} disabled={busy} onClick={()=>{void signIn(provider);}}>Continue with {provider==='apple'?'Apple':'Google'}</button>)}
  {providers?.email?<form onSubmit={event=>{event.preventDefault();void signIn();}}>{sent?<><p>Code sent to {sent}</p><label>Email code<input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={event=>setCode(event.target.value.replace(/\D/g,''))} disabled={busy}/></label></>:<label>Email address<input type="email" autoComplete="email" value={email} onChange={event=>setEmail(event.target.value)} required disabled={busy}/></label>}<button disabled={busy}>{busy?'Working…':sent?'Sign in':'Email me a code'}</button>{sent?<button type="button" disabled={busy} onClick={()=>{setSent(null);setCode('');}}>Use another email or resend</button>:null}</form>:providers&&!providers.apple&&!providers.google?<p>Sign-in is unavailable. Try again later.</p>:null}
 </div>;
}
const css=`${websiteStyles}
html,body,#root{min-height:100%;margin:0}.care-page{min-height:100vh;background:var(--paper);color:var(--ink);font-size:16px;line-height:1.55}.care-page *{box-sizing:border-box}.care-page header{max-width:900px;margin:auto;padding:20px 24px;display:flex;align-items:center;justify-content:space-between;gap:20px}.care-brand{font-family:'Red Hat Display',sans-serif;font-size:23px;display:flex;align-items:center;gap:10px;text-decoration:none}.care-page main{width:100%;max-width:720px;margin:24px auto;padding:0 24px 64px}.care-page h1{font-family:'Red Hat Display',sans-serif;font-size:clamp(30px,6vw,48px);line-height:1.15;letter-spacing:-1px;margin:12px 0 16px;overflow-wrap:anywhere}.care-page h2{font-size:22px;line-height:1.3}.care-page h3{margin:0}.care-page a{color:var(--green);text-underline-offset:4px}.care-page a:focus-visible,.care-page button:focus-visible,.care-page input:focus-visible,.care-page select:focus-visible,.care-page textarea:focus-visible{outline:3px solid var(--green);outline-offset:3px}.care-page button{font:inherit;font-weight:600;cursor:pointer;min-height:48px;border:1px solid var(--border);border-radius:12px;padding:10px 16px;color:var(--ink);background:var(--white)}.care-page button:hover{background:var(--mint)}.care-page button:active{opacity:.75}.care-page button:disabled{opacity:.55;cursor:default}.care-page button.primary{background:var(--green);color:var(--white);border-color:var(--green)}.care-page .danger{color:#9e3025}.eyebrow{font-size:12px;font-weight:700;letter-spacing:.09em;color:var(--muted);margin:0}.care-page .muted{color:var(--muted)}.care-actions{display:flex;gap:10px;flex-wrap:wrap;margin:20px 0}.care-page section{border-top:1px solid var(--border);margin-top:32px;padding-top:10px}.section-heading{display:flex;align-items:center;justify-content:space-between;gap:16px}.care-row{padding:18px 0;border-top:1px solid var(--border);display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap}.care-row>div:first-child{flex:1;min-width:160px}.care-row p{margin:5px 0}.care-note{white-space:pre-wrap;overflow-wrap:anywhere}.care-editor{width:100%;padding:20px;background:var(--white);border:1px solid var(--border);border-radius:16px;margin:16px 0;display:flex;gap:16px;flex-direction:column}.care-page label{display:flex;flex-direction:column;gap:8px;font-weight:600;margin:16px 0}.care-page input,.care-page select,.care-page textarea{font:inherit;color:var(--ink);background:var(--white);border:1px solid var(--border);border-radius:10px;min-height:48px;width:100%;max-width:100%;padding:10px}.care-page textarea{min-height:100px;resize:vertical}.care-sign-in{padding:20px 0}.care-sign-in>button{margin:0 8px 12px 0}.care-sign-in form button{margin:0 8px 8px 0}.care-error{color:#9e3025;border-left:3px solid currentColor;padding:12px;background:#fcece7}.care-pill{padding:10px 16px;border:1px solid var(--border);border-radius:12px}.puppy-list{list-style:none;padding:0}.puppy-list li{border-top:1px solid var(--border)}.puppy-list a{display:flex;flex-direction:column;gap:5px;padding:20px 0}.care-signed-in{overflow-wrap:anywhere}
@media(prefers-color-scheme:dark){.care-page{--paper:#142a22;--white:#20382e;--ink:#f5f0e5;--muted:#c1cec3;--border:#52675a;--green:#d5e5c5;--mint:#304a3b}.care-page button.primary{color:#173b30}.care-page .danger{color:#ffb7a5}.care-error{color:#ffb7a5;background:#402c26}}
@media(max-width:400px){.care-page header{padding:16px}.care-page main{padding:0 16px 48px}.care-editor{padding:14px}}
`;

// Synthetic native-sharing I/O; the account runner still owns SDK/service setup.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {existsSync,readFileSync,readdirSync,rmSync,cpSync,mkdirSync,mkdtempSync,statSync} from 'node:fs';
import {homedir,tmpdir} from 'node:os';
import {basename,join,resolve} from 'node:path';
import {getSessionCookie} from 'better-auth/cookies';
import {identifierSchema,pullPageSchema,revisionSchema} from '../src/cloud/protocol.ts';
import {sharedPuppiesSchema,shareIdSchema,inviteTokenSchema,shareListSchema} from '../src/sharing.ts';
import {localRecordId} from '../src/cloud/record-identity.ts';
import {eventSqlColumns} from '../src/record-sql.ts';
import {nativeSnapshot} from './native-account-evidence.mjs';

const app='com.patrickchin.puptime',selectionKey='puptime.active-care';
const secretFlows=new Set(['create-invitation','close-sharing','accept-invitation','revoke','reject-stale-invitation','open-in-app']);
const images=new Set(['native-owner-attribution-row.png','native-owner-attribution-detail.png','native-revoked-care-access.png']);

export function readSharingSnapshot(dataDirectory,{care=false,accountId,shareId}={}){
  let filename='puptime-v2.db';
  if(care){
    // Installed AsyncStorage's current iOS location and inline/external contract.
    const storage=join(dataDirectory,'Library/Application Support',app,'RCTAsyncLocalStorage_V1');
    const manifest=JSON.parse(readFileSync(join(storage,'manifest.json'),'utf8'));
    let value=manifest[selectionKey];
    if(value===null)value=readFileSync(join(storage,createHash('md5').update(selectionKey).digest('hex')),'utf8');
    assert.equal(typeof value,'string','Read the actual persisted care selection.');
    const selected=JSON.parse(value),puppy=sharedPuppiesSchema.shape.puppies.element.parse(selected);
    identifierSchema.parse(accountId);shareIdSchema.parse(shareId);
    assert.equal(selected.accountId,accountId,'The care database must belong to the observed SDK account.');
    assert.equal(puppy.id,shareId,'Read the actually accepted share, never a guessed database.');
    filename=`puptime-${puppy.id}-${accountId}.db`;
  }
  const db=new DatabaseSync(join(dataDirectory,'Documents/SQLite',filename),{readOnly:true});
  db.exec('BEGIN');
  try{return {tables:nativeSnapshot(db),events:db.prepare(`SELECT id,${eventSqlColumns.join(',')} FROM events ORDER BY id`).all().map(row=>({...row})),
    owner:db.prepare('SELECT * FROM local_sync_owner').all(),pending:db.prepare('SELECT COUNT(*) n FROM local_sync_outbox').get().n};}
  finally{db.exec('ROLLBACK');db.close();}
}

// Tickets contain no public fields. Session cookies and invite bodies never enter receipts.
export function createSharingObserver({ownerEmail,carerEmail,protectSecret}){
  assert.notEqual(ownerEmail,carerEmail);
  const actors=new Map([['owner',{email:ownerEmail}],['carer',{email:carerEmail}]]);
  for(const actor of actors.values())assert.match(actor.email,/^native-[a-z0-9-]+@example\.invalid$/);
  const sessions=new Map(),tickets=new WeakMap(),responses=[];
  return {
    actor(name){const value=actors.get(name);assert.ok(value);return {...value};},
    begin({method,url,headers}){
      const path=new URL(url,'https://127.0.0.1').pathname,cookie=headers.cookie??'';
      const session=getSessionCookie(new Headers({cookie})),actor=session?sessions.get(session):undefined;
      if(cookie)protectSecret(cookie);if(session)protectSecret(session);
      const expected=headers['x-puptime-account'],scoped=headers['x-puptime-share'];
      if(actor&&expected!==undefined)assert.equal(expected,actors.get(actor).accountId,'Native account header must match the observed SDK session.');
      if(scoped!==undefined)shareIdSchema.parse(scoped);
      const ticket=Object.freeze({});tickets.set(ticket,{method,path,cookie,session,actor,expected,shareId:scoped??null});return ticket;
    },
    requestBody(ticket,body){
      const state=tickets.get(ticket);assert.ok(state);
      if(state.path==='/api/care/accept'){
        shareIdSchema.parse(body.id);inviteTokenSchema.parse(body.token);protectSecret(body.token);state.shareId=body.id;
      }
      if(state.path==='/api/sharing'&&body?.token)protectSecret(body.token);
    },
    finish(ticket,status,body){
      const state=tickets.get(ticket);assert.ok(state);tickets.delete(ticket);
      if(status===200&&['/api/account','/api/auth/get-session'].includes(state.path)&&body?.user){
        const entry=[...actors].find(([,actor])=>actor.email===body.user.email);
        assert.ok(entry&&state.session,'Bind only a synthetic identity observed in the actual SDK account/session response.');
        const [name,actor]=entry,id=identifierSchema.parse(body.user.id);
        if(state.expected!==undefined)assert.equal(state.expected,id,'Account response must match the exact request header.');
        assert.ok(!actor.accountId||actor.accountId===id,'An actor cannot silently change app accounts.');
        assert.ok(!sessions.has(state.session)||sessions.get(state.session)===name,'Never reuse one session for both actors.');
        Object.assign(actor,{accountId:id,cookie:state.cookie,name:body.user.name??''});sessions.set(state.session,name);state.actor=name;
      }
      if(status===200&&state.path==='/api/care/accept'){
        assert.ok(state.actor&&state.shareId&&body.id===state.shareId,'Acceptance must be bound to the observed actor and exact request.');
        actors.get(state.actor).shareId=state.shareId;
      }
      if(['/api/account','/api/sync/push','/api/sync/pull','/api/care/accept'].includes(state.path))
        responses.push({actor:state.actor??null,shareId:state.shareId,forwarded:true,method:state.method,path:state.path,status});
    },
    membership(value){
      // Called only with A's independent authenticated service list response.
      for(const share of shareListSchema.parse(value).shares)for(const actor of actors.values())if(actor.shareId===share.id){
        const label=share.memberName||share.label;assert.match(label,/^[A-Za-z ]{1,80}$/);actor.attribution=label;
      }
    },
    responses(){return responses.map(row=>({...row}));},
  };
}

// `execute` must capture output quietly and reject without printing its args/output.
// These flows never contain an OTP; initial auth remains in the existing runner.
export async function runSharingFlow({device,name,env={},secret=false,execute,output,startup=join(homedir(),'.maestro/tests')}){
  name=basename(name);assert.match(name,/^[a-z-]+$/);
  assert.ok(!secretFlows.has(name)||secret,'Invite-bearing phases must suppress every driver artifact.');
  assert.ok(Object.values(env).every(value=>typeof value==='string'&&!/inv_[a-f0-9]{32}|puptime:\/\/|https?:\/\//.test(value)),'No invitation or credential in Maestro arguments.');
  const flow=resolve('.maestro/native-sharing',name+'.yaml');assert.ok(existsSync(flow));
  const before=new Set(existsSync(startup)?readdirSync(startup):[]),artifacts=mkdtempSync(join(tmpdir(),'puptime-sharing-driver-'));
  try{
    await execute('maestro',['--device',device,'test',...Object.entries(env).flatMap(([key,value])=>['-e',`${key}=${value}`]),flow,'--test-output-dir',artifacts],{MAESTRO_CLI_NO_ANALYTICS:'1'});
  }catch{throw new Error('Native sharing phase failed: '+name);}
  finally{
    try{
      // Keep explicit post-accept glyph evidence on red cases; no implicit failure
      // image/hierarchy or secret-phase output may survive.
      if(!secret){mkdirSync(output,{recursive:true});let bytes=0;for(const file of readdirSync(artifacts,{recursive:true}).map(String))if(images.has(basename(file))){const source=join(artifacts,file),size=statSync(source).size;assert.ok(size<=4194304&&(bytes+=size)<=8388608,'Bound synthetic sharing screenshots.');cpSync(source,join(output,basename(file)));}}
    }finally{
      rmSync(artifacts,{recursive:true,force:true});
      // The caller owns the one native slot. Remove its newly created global logs too.
      if(existsSync(startup))for(const directory of readdirSync(startup))if(!before.has(directory))rmSync(join(startup,directory),{recursive:true,force:true});
    }
  }
}

export function createSharingActors({devices,emails,observer,bridge,output,protectSecret}){
  assert.notEqual(devices.owner,devices.carer);let active=null,switching=false;
  const actors=Object.fromEntries(['owner','carer'].map(name=>[name,{
    name,device:devices[name],
    get accountId(){return observer.actor(name).accountId;},get attribution(){return observer.actor(name).attribution;},
    cookie:()=>observer.actor(name).cookie,
    async snapshot({care=false}={}){const observed=observer.actor(name);return readSharingSnapshot(await bridge.dataDirectory(devices[name]),{care,accountId:observed.accountId,shareId:observed.shareId});},
    flow:(path,env,options)=>{assert.equal(active,name);return runSharingFlow({device:devices[name],name:path,env,...options,execute:bridge.execute,output});},
    async nativeShareCopy(){assert.equal(active,name);try{const value=await bridge.simctl(['pbpaste',devices[name]]);protectSecret(value);return value;}catch{throw new Error('Native sharing clipboard read failed.');}finally{try{await bridge.simctl(['pbcopy',devices[name]],'');}catch{throw new Error('Native sharing clipboard clearing failed.');}}},
    async openURL(value){
      assert.equal(active,name);const url=new URL(value);assert.equal(url.protocol,'puptime:');assert.equal(url.hostname,'care');
      assert.ok(!url.username&&!url.password&&!url.port&&url.pathname===''&&[...url.searchParams.keys()].join(',')==='invite');
      shareIdSchema.parse(url.searchParams.get('invite'));inviteTokenSchema.parse(url.hash.slice(1));protectSecret(value);
      try{await bridge.simctl(['openurl',devices[name],value]);}catch{throw new Error('Native synthetic invitation handoff failed.');}
      await actors[name].flow('open-in-app',{}, {secret:true});
    },
  }]));
  return {...actors,async activate(actor){
    assert.ok(actors[actor.name]===actor&&!switching,'Use one serial, owned actor context.');switching=true;
    try{await bridge.activate({previous:active?devices[active]:null,device:actor.device,email:emails[actor.name]});active=actor.name;}
    finally{switching=false;}
  }};
}

// Direct local service reads bypass the native observer; never inject into an app.
export async function readOwnerSharingRecords({get,historyFor=[],observer}){
  const latest=new Map();let after=0;
  for(let index=0;index<100;index++){
    const page=pullPageSchema.parse(await get('/api/sync/pull?after='+after));
    assert.ok(!page.resyncRequired&&page.cursor>=after&&page.changes.every(row=>row.sequence>after),'Read a complete forward-only owner history.');
    for(const row of page.changes)latest.set(row.id,row);
    if(!page.hasMore)break;assert.ok(page.cursor>after&&index<99);after=page.cursor;
  }
  const records=[...latest.values()].filter(row=>!row.deleted).sort((a,b)=>a.id.localeCompare(b.id)),revisions=[];
  for(const puppy of records.filter(row=>row.kind==='puppy'))observer.membership(await get('/api/sharing?petId='+encodeURIComponent(puppy.id)));
  for(const localId of historyFor){
    const record=records.find(row=>row.kind==='event'&&localRecordId(row)===localId);assert.ok(record);
    let before=Number.MAX_SAFE_INTEGER;
    for(let index=0;index<100;index++){
      const value=await get(`/api/records/${encodeURIComponent(record.id)}/history?beforeRevision=${before}`);
      assert.ok(Array.isArray(value.revisions));const page=value.revisions.map(row=>revisionSchema.parse(row));revisions.push(...page);
      assert.ok(page.every((row,index)=>row.recordId===record.id&&row.revision<before&&(!index||row.revision<page[index-1].revision)),'Read this event’s descending revision history.');
      if(page.length<50)break;const next=Math.min(...page.map(row=>row.after.revision));assert.ok(next<before&&index<99);before=next;
    }
  }
  return {records,revisions};
}

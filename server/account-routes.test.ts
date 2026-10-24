import { env } from 'cloudflare:workers';
import { applyD1Migrations, runInDurableObject } from 'cloudflare:test';
import { beforeAll, expect, inject, test } from 'vitest';
import worker from './index';
import type { Mutation } from '../src/cloud/protocol';

beforeAll(() => applyD1Migrations(env.AUTH_DB, inject('migrations')));
const settings = { ...env, ENVIRONMENT: 'local' as const, AUTH_BASE_URL: 'https://puptime.test', WEB_ORIGINS: 'https://puptime.test', AUTH_SECRET: 'local-test-secret-with-at-least-32-characters' };
let clientNumber = 10;
type Owner = { cookie: string; id: string; ip: string };
async function call(owner: Owner | null, path: string, body?: object,headers:Record<string,string>={}) {
  return worker.fetch(new Request(`https://puptime.test/api/${path}`, {
    method: body ? 'POST' : 'GET', headers: { origin: 'https://puptime.test', 'cf-connecting-ip': owner?.ip ?? '192.0.2.254',
      ...(owner ? { cookie: owner.cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}),...headers },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }), settings);
}
async function owner(email = `${crypto.randomUUID()}@example.com`): Promise<Owner> {
  const ip = `192.0.2.${clientNumber++}`;
  const post = (path: string, body: object) => worker.fetch(new Request(`https://puptime.test/api/auth/${path}`, {
    method: 'POST', headers: { origin: 'https://puptime.test', 'cf-connecting-ip': ip, 'content-type': 'application/json' }, body: JSON.stringify(body),
  }), settings);
  expect((await post('email-otp/send-verification-otp', { email, type: 'sign-in' })).status).toBe(200);
  const preview = await env.AUTH_DB.prepare('SELECT code FROM local_email_previews WHERE email = ?').bind(email).first<{ code: string }>();
  const login = await post('sign-in/email-otp', { email, otp: preview!.code });
  expect(login.status).toBe(200);
  const cookie = login.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
  const session = await call({ cookie, id: '', ip }, 'account');
  const data = await session.json<{ user: { id: string } }>();
  return { cookie, id: data.user.id, ip };
}
function event(recordId = 'event-1', petId = 'pet-1'): Mutation {
  return { protocolVersion: 1, operationId: crypto.randomUUID(), deviceId: 'test-device', recordId, petId, kind: 'event', baseRevision: 0, intent: 'create', patch: { type: 'pee', at: 100, source: 'app', note: 'Private care note' } };
}
async function enroll(user: Owner, petId = 'pet-1') {
  const response = await call(user, 'cloud/enroll', { operationId: crypto.randomUUID(), deviceId: 'test-device', localPetId: petId, name: 'Pip' });
  expect(response.status).toBe(200);
}

test('sign-in grants development access without billing but does not silently enroll or write a puppy', async () => {
  const user = await owner();
  const account = await (await call(user, 'account')).json<{ cloud: { canSync: boolean }; pets: unknown[] }>();
  expect(account.cloud.canSync).toBe(true);
  expect(account.pets).toEqual([]);
  const premature = await (await call(user, 'sync/push', { mutations: [event()] })).json<{accepted:unknown[];rejected:{error:string}[]}>();
  expect(premature.accepted).toEqual([]);
  expect(premature.rejected).toHaveLength(1);
  expect(premature.rejected[0].error).toBe('conflict');
  expect(await (await call(user,'sync/pull?after=0')).json()).toEqual({changes:[],cursor:0,hasMore:false});
  expect((await call(user,'cloud/trial',{})).status).toBe(404);
  expect(await env.AUTH_DB.prepare('SELECT account_id FROM cloud_accounts WHERE account_id=?').bind(user.id).first()).toBeNull();
  expect((await call(null, 'account/export')).status).toBe(401);
});

test('explicit enrollment synchronizes only the authenticated owner data', async () => {
  const user = await owner(); await enroll(user);
  const input = event();
  const pushed = await (await call(user, 'sync/push', { mutations: [input] })).json<{ accepted: unknown[]; rejected: unknown[] }>();
  expect(pushed.accepted.length).toBe(1); expect(pushed.rejected).toEqual([]);
  const changes = await (await call(user, 'sync/pull?after=0')).json<{ changes: { id: string }[] }>();
  expect(changes.changes.map((item) => item.id)).toEqual(['event-1']);
  const other = await owner(); await enroll(other, 'pet-other');
  expect(await (await call(other, 'sync/pull?after=0')).json()).toEqual({ changes: [], cursor: 0, hasMore: false });
  const denied = await (await call(other, 'sync/push', { mutations: [input] })).json<{ accepted: unknown[]; rejected: { operationId: string }[] }>();
  expect(denied.accepted).toEqual([]); expect(denied.rejected[0].operationId).toBe(input.operationId);
});

test('existing puppy history requires explicit confirmation before another device attaches', async () => {
  const user = await owner(); await enroll(user);
  await call(user, 'sync/push', { mutations: [event()] });
  const request = { operationId: crypto.randomUUID(), deviceId: 'second-device', localPetId: 'local-pet-2', name: 'Other local puppy' };
  expect((await call(user, 'cloud/enroll', request)).status).toBe(409);
  const account = await (await call(user, 'account')).json<{ pets: unknown[] }>();
  expect(account.pets).toEqual([{ id: 'pet-1', name: 'Pip', eventCount: 1 }]);
  expect(await (await call(user, 'cloud/enroll', { ...request, confirmedPetId: 'pet-1' })).json()).toEqual({ petId: 'pet-1' });
});

test('partial mutation batches acknowledge only durable changes and retries do not duplicate history', async () => {
  const user = await owner(); await enroll(user);
  const first = event();
  const invalid = { ...event('missing'), intent: 'patch', patch: { note: 'not created' } };
  const response = await (await call(user, 'sync/push', { mutations: [first, invalid] })).json<{ accepted: unknown[]; rejected: unknown[] }>();
  expect(response.accepted.length).toBe(1); expect(response.rejected.length).toBe(1);
  await call(user, 'sync/push', { mutations: [first] });
  const history = await (await call(user, 'records/event-1/history')).json<{ revisions: unknown[] }>();
  expect(history.revisions.length).toBe(1);
});

test('private sync and full export need no subscription or trial activation', async () => {
  const user = await owner(); await enroll(user);
  await call(user, 'sync/push', { mutations: [event()] });
  expect(await env.AUTH_DB.prepare('SELECT account_id FROM cloud_accounts WHERE account_id=?').bind(user.id).first()).toBeNull();
  expect((await call(user, 'sync/pull?after=0')).status).toBe(200);
  const response = await call(user, 'account/export');
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain('application/x-ndjson');
  const lines = new TextDecoder().decode(await response.arrayBuffer()).trim().split('\n').map((line) => JSON.parse(line));
  expect(lines[0].type).toBe('manifest');
  expect(lines.some((line) => line.type === 'revision' && line.after.data.note === 'Private care note')).toBe(true);
  expect(lines.at(-1)).toEqual({ type: 'complete', cursor: 1 });
  expect(JSON.stringify(lines)).not.toContain('session_token');
});

test('untrusted origins cannot activate cloud using an existing session cookie', async () => {
  const user = await owner();
  const response = await worker.fetch(new Request('https://puptime.test/api/cloud/enroll', {
    method: 'POST', headers: { origin: 'https://untrusted.example', cookie: user.cookie, 'content-type': 'application/json' }, body: '{}',
  }), settings);
  expect(response.status).toBe(403);
});


test('multi-page export stays at its captured snapshot while later edits remain saved', async () => {
  const user = await owner(); await enroll(user);
  const mutations = Array.from({ length: 101 }, (_, index) => event(`history-${index}`));
  for (let index = 0; index < mutations.length; index += 50) {
    const response = await call(user, 'sync/push', { mutations: mutations.slice(index, index + 50) });
    expect(response.status).toBe(200);
  }
  const snapshot = await call(user, 'account/export');
  await call(user, 'sync/push', { mutations: [event('later-than-export')] });
  const lines = new TextDecoder().decode(await snapshot.arrayBuffer()).trim().split('\n').map((line) => JSON.parse(line));
  const revisions = lines.filter((line) => line.type === 'revision');
  expect(revisions.length).toBe(101);
  expect(new Set(revisions.map((line) => line.sequence)).size).toBe(101);
  expect(revisions.some((line) => line.recordId === 'later-than-export')).toBe(false);
  expect(lines.at(-1)).toEqual({ type: 'complete', cursor: 101 });
  expect((await (await call(user, 'sync/pull?after=101')).json<{ changes: { id: string }[] }>()).changes[0].id).toBe('later-than-export');
});

async function deleteAccount(user: Owner) {
  return worker.fetch(new Request('https://puptime.test/api/account', {
    method: 'DELETE', headers: { origin: 'https://puptime.test', cookie: user.cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ confirm: true }),
  }), settings);
}

test('explicit account deletion revokes sessions and removes all cloud history', async () => {
  const user = await owner(); await enroll(user);
  await call(user, 'sync/push', { mutations: [event()] });
  expect((await deleteAccount(user)).status).toBe(200);
  expect((await call(user, 'account')).status).toBe(401);
  expect((await call(user, 'account/export')).status).toBe(401);
  expect(await env.AUTH_DB.prepare('SELECT id FROM user WHERE id = ?').bind(user.id).first()).toBeNull();
  const object = env.ACCOUNTS.get(env.ACCOUNTS.idFromName(user.id));
  await runInDurableObject(object, (instance, state) => {
    for (const table of ['records', 'revisions', 'operations', 'pets', 'enrollments', 'enrolled_devices']) {
      expect(state.storage.sql.exec<{ count: number }>(`SELECT COUNT(*) AS count FROM ${table}`).one().count).toBe(0);
    }
    expect(() => instance.apply(event())).toThrow('deleted');
    expect(() => instance.enroll({ operationId: 'old-device', deviceId: 'test-device', localPetId: 'pet-1', name: 'Old puppy' })).toThrow('deleted');
  });
});

test('account deletion removes only its exact email verification identifiers', async () => {
  const email = `${crypto.randomUUID()}@example.com`;
  const user = await owner(email);
  const identifiers = ['sign-in', 'email-verification', 'forget-password', 'change-email']
    .flatMap((type) => [`${type}-otp-${email}`, `${type}-otp-m${email}`]);
  for (const identifier of identifiers) {
    await env.AUTH_DB.prepare('INSERT INTO verification(id, identifier, value, expiresAt, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), identifier, 'pending-code', Date.now() + 300000, Date.now(), Date.now()).run();
  }
  expect((await deleteAccount(user)).status).toBe(200);
  const remaining = await env.AUTH_DB.prepare('SELECT identifier FROM verification WHERE value = ? ORDER BY identifier').bind('pending-code').all<{ identifier: string }>();
  expect(remaining.results.map((row) => row.identifier)).toEqual(identifiers.filter((identifier) => identifier.endsWith(`m${email}`)).sort());
});

test('account deletion requires recent authentication and preserves data on rejection', async () => {
  const user = await owner(); await enroll(user);
  await call(user, 'sync/push', { mutations: [event()] });
  await env.AUTH_DB.prepare('UPDATE session SET createdAt = 0 WHERE userId = ?').bind(user.id).run();
  const response = await deleteAccount(user);
  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({ error: 'reauthentication_required' });
  expect((await call(user, 'account')).status).toBe(200);
  expect((await (await call(user, 'sync/pull?after=0')).json<{ changes: unknown[] }>()).changes.length).toBe(1);
});

test('an interrupted deletion can be retried without reopening access to retained history', async () => {
  const user = await owner(); await enroll(user);
  await env.AUTH_DB.prepare("INSERT INTO cloud_accounts(account_id,state) VALUES (?,'deleting')").bind(user.id).run();
  expect((await call(user, 'account/export')).status).toBe(410);
  expect((await deleteAccount(user)).status).toBe(200);
  expect((await call(user, 'account')).status).toBe(401);
});

test('scoped long Unicode record IDs survive push and URL-encoded history lookup', async () => {
  const user = await owner(); await enroll(user);
  const id = JSON.stringify(['event', 'pet-1', '训练 "quoted" \\ '.repeat(20)]);
  expect(id.length).toBeGreaterThan(256);
  expect(id.length).toBeLessThanOrEqual(2048);
  const pushed = await call(user, 'sync/push', { mutations: [event(id)] });
  expect(pushed.status).toBe(200);
  expect((await pushed.json<{ accepted: unknown[] }>()).accepted).toHaveLength(1);
  const response = await call(user, `records/${encodeURIComponent(id)}/history`);
  expect(response.status).toBe(200);
  expect((await response.json<{ revisions: { recordId: string }[] }>()).revisions[0].recordId).toBe(id);
});

async function changes(user:Owner|null,origin='https://puptime.test') {
 return worker.fetch(new Request('https://puptime.test/api/sync/changes',{headers:{upgrade:'websocket',origin,...(user?{cookie:user.cookie}:{})}}),settings);
}
function observeSocket(socket:WebSocket) {
 const messages:unknown[]=[];let closed=false;
 socket.accept();socket.addEventListener('message',event=>{messages.push(JSON.parse(String(event.data)));});socket.addEventListener('close',()=>{closed=true;});
 return {messages,get closed(){return closed;}};
}
const settleSocket=()=>new Promise(resolve=>setTimeout(resolve,30));
test('change channel accepts a new signed-in account without billing and rejects anonymous, wrong-origin and expired sessions',async()=>{
 expect((await changes(null)).status).toBe(401);
 const user=await owner();const fresh=await changes(user);expect(fresh.status).toBe(101);fresh.webSocket!.accept();fresh.webSocket!.close();
 await enroll(user);expect((await changes(user,'https://untrusted.example')).status).toBe(403);
 await env.AUTH_DB.prepare('UPDATE session SET expiresAt=0 WHERE userId=?').bind(user.id).run();
 expect((await changes(user)).status).toBe(401);
});
test('change channel sends durable metadata only to its owner, with no duplicate invalidation',async()=>{
 const user=await owner(),other=await owner();await enroll(user);await enroll(other,'other-pet');
 const response=await changes(user),otherResponse=await changes(other);expect(response.status).toBe(101);expect(otherResponse.status).toBe(101);
 const socket=response.webSocket!,otherSocket=otherResponse.webSocket!;
 try {
  const seen=observeSocket(socket),otherSeen=observeSocket(otherSocket);await settleSocket();
  expect(seen.messages).toEqual([{protocolVersion:1,cursor:0}]);expect(otherSeen.messages).toEqual([{protocolVersion:1,cursor:0}]);
  const input=event();await call(user,'sync/push',{mutations:[input]});await settleSocket();
  expect(seen.messages).toEqual([{protocolVersion:1,cursor:0},{protocolVersion:1,cursor:1}]);
  expect(otherSeen.messages).toEqual([{protocolVersion:1,cursor:0}]);
  await call(user,'sync/push',{mutations:[input]});await settleSocket();expect(seen.messages.length).toBe(2);
 }finally{socket.close();otherSocket.close();}
});
test('revoked or ISO-expired sessions and deleting accounts stop change metadata; deletion closes its channel',async()=>{
 for(const condition of ['revoked','expired','deleting','deleted'] as const){
  const user=await owner();await enroll(user);const response=await changes(user);expect(response.status).toBe(101);
  const socket=response.webSocket!,seen=observeSocket(socket);await settleSocket();
  if(condition==='revoked')await env.AUTH_DB.prepare('DELETE FROM session WHERE userId=?').bind(user.id).run();
  if(condition==='expired')await env.AUTH_DB.prepare('UPDATE session SET expiresAt=? WHERE userId=?').bind(new Date(Date.now()-1000).toISOString(),user.id).run();
  if(condition==='deleting')await env.AUTH_DB.prepare("INSERT INTO cloud_accounts(account_id,state) VALUES (?,'deleting')").bind(user.id).run();
  if(condition==='deleted')expect((await deleteAccount(user)).status).toBe(200);
  else await runInDurableObject(env.ACCOUNTS.getByName(user.id),async instance=>{instance.apply(event());});
  await settleSocket();expect(seen.messages).toEqual([{protocolVersion:1,cursor:0}]);expect(seen.closed).toBe(true);socket.close();
 }
});
test('hibernation reconstruction restores only owner/session references and still revalidates expiry',async()=>{
 const user=await owner();await enroll(user);const response=await changes(user);expect(response.status).toBe(101);
 const socket=response.webSocket!,seen=observeSocket(socket);await settleSocket();
 try{
  await runInDurableObject(env.ACCOUNTS.getByName(user.id),async(instance,state)=>{
   const attachment=state.getWebSockets()[0].deserializeAttachment() as Record<string,string>;
   expect(Object.keys(attachment).sort()).toEqual(['accountId','sessionId']);expect(attachment.accountId).toBe(user.id);expect(JSON.stringify(attachment)).not.toContain(user.cookie);
   const {AccountStore}=await import('./account-store');
   const reconstructed=new AccountStore(state,settings);
   reconstructed.apply(event());
  });
  await settleSocket();expect(seen.messages).toEqual([{protocolVersion:1,cursor:0},{protocolVersion:1,cursor:1}]);
  await env.AUTH_DB.prepare('UPDATE session SET expiresAt=0 WHERE userId=?').bind(user.id).run();
  await runInDurableObject(env.ACCOUNTS.getByName(user.id),async(instance,state)=>{
   const {AccountStore}=await import('./account-store');new AccountStore(state,settings).apply(event('later'));
  });
  await settleSocket();expect(seen.messages.length).toBe(2);expect(seen.closed).toBe(true);
 }finally{socket.close();}
});
test('an abnormal peer close is acknowledged with a valid WebSocket close code',async()=>{
 const user=await owner();await enroll(user);const response=await changes(user);expect(response.status).toBe(101);
 const socket=response.webSocket!;observeSocket(socket);await settleSocket();
 await runInDurableObject(env.ACCOUNTS.getByName(user.id),async(instance,state)=>{
  expect(()=>instance.webSocketClose(state.getWebSockets()[0],1006)).not.toThrow();
 });
 socket.close();
});

test('authenticated cloud history validates for the client across merge delete restore paging and owner isolation',async()=>{
 const user=await owner();await enroll(user);const recordId='["event","pet-1","history / 💩"]';
 expect((await call(user,'cloud/enroll',{operationId:crypto.randomUUID(),deviceId:'other-device',localPetId:'other-local',name:'Pip',confirmedPetId:'pet-1'})).status).toBe(200);
 const created=event(recordId);if(created.kind!=='event')throw new Error('Expected an event fixture.');
 const operations:Mutation[]=[created,
  {...created,operationId:crypto.randomUUID(),baseRevision:1,intent:'patch',patch:{note:'Updated note'}},
  {...created,operationId:crypto.randomUUID(),deviceId:'other-device',baseRevision:1,intent:'patch',patch:{at:200}},
  {...created,operationId:crypto.randomUUID(),baseRevision:3,intent:'delete',patch:{}},
  {...created,operationId:crypto.randomUUID(),baseRevision:4,intent:'restore',patch:{type:'pee',at:100,source:'app',note:'Updated note'}},
 ];
 for(const mutation of operations){const response=await call(user,'sync/push',{mutations:[mutation]});expect(response.status).toBe(200);expect((await response.json<{rejected:unknown[]}>()).rejected).toEqual([]);}
 const history=await (await call(user,`records/${encodeURIComponent(recordId)}/history`)).json<{revisions:unknown[]}>();
 const protocol=await import('../src/cloud/protocol');expect(typeof protocol.revisionSchema?.parse).toBe('function');
 const revisions=history.revisions.map(value=>protocol.revisionSchema.parse(value));
 expect(revisions.map(value=>value.reason)).toEqual(['restored','deleted','merged','updated','created']);
 expect(revisions.map(value=>value.revision)).toEqual([5,4,3,2,1]);
 expect(revisions[2].after.data).toEqual({type:'pee',at:200,source:'app',note:'Updated note'});
 const oldPath=`records/${encodeURIComponent(recordId)}/history?beforeRevision=4`;
 const old=await (await call(user,oldPath)).json<{revisions:{revision:number}[]}>();expect(old.revisions.map(value=>value.revision)).toEqual([3,2,1]);
 await call(user,'sync/push',{mutations:[{...created,operationId:crypto.randomUUID(),baseRevision:5,intent:'patch',patch:{note:'Later'}}]});
 expect(await (await call(user,oldPath)).json()).toEqual(old);
 const other=await owner();await enroll(other,'other-pet');expect(await (await call(other,`records/${encodeURIComponent(recordId)}/history`)).json()).toEqual({revisions:[]});
 expect((await call(null,`records/${encodeURIComponent(recordId)}/history`)).status).toBe(401);
 await env.AUTH_DB.prepare('UPDATE session SET expiresAt=? WHERE userId=?').bind(new Date(Date.now()-1000).toISOString(),user.id).run();
 expect((await call(user,`records/${encodeURIComponent(recordId)}/history`)).status).toBe(401);
});

test('photo capability keeps legacy sync, name edits, history and exports compatible',async()=>{
 const user=await owner();await enroll(user);
 const photos={'x-puptime-profile-photos':'1'},photo='img_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
 const mutation:Mutation={protocolVersion:1,operationId:'op_photo_create',deviceId:'test-device',recordId:'pet-1',petId:'pet-1',kind:'puppy',baseRevision:0,intent:'create',patch:{name:'Pip',photoId:photo}};
 const created=await call(user,'sync/push',{mutations:[mutation]},photos);
 expect(created.status).toBe(200);
 expect(await created.json()).toMatchObject({accepted:[{record:{data:{name:'Pip',photoId:photo}}}]});
 const legacy=await (await call(user,'sync/pull?after=0')).json<{changes:{data:object}[];cursor:number}>();
 expect(legacy.changes[0].data).toEqual({name:'Pip'});expect(legacy.cursor).toBe(1);
 const renamed=await call(user,'sync/push',{mutations:[{...mutation,operationId:'op_old_rename',baseRevision:1,intent:'patch',patch:{name:'Biscuit'}}]});
 expect(await renamed.json()).toMatchObject({accepted:[{record:{data:{name:'Biscuit'}}}]});
 const modern=await (await call(user,'sync/pull?after=0',undefined,photos)).json<{changes:{data:object}[]}>();
 expect(modern.changes.at(-1)?.data).toEqual({name:'Biscuit',photoId:photo});
 await call(user,'sync/push',{mutations:[{...mutation,operationId:'op_photo_remove',baseRevision:2,intent:'patch',patch:{photoId:null}}]},photos);
 const history=await (await call(user,'records/pet-1/history')).json<{revisions:unknown[]}>();
 expect(JSON.stringify(history)).not.toContain('"photoId"');
 const {revisionSchema}=await import('../src/cloud/protocol');
 history.revisions.forEach(revision=>expect(revisionSchema.safeParse(revision).success).toBe(true));
 const oldExport=await (await call(user,'account/export')).text();
 expect(oldExport).not.toContain('"photoId"');
 const fullExport=await (await call(user,'account/export',undefined,photos)).text();
 expect(fullExport).toContain(photo);
});

test('private photo objects are binary, immutable, account-scoped and deleted with the account',async()=>{
 const user=await owner(),other=await owner();await enroll(user);await enroll(other);
 const photoId='img_11111111111111111111111111111111',jpeg=new Uint8Array([255,216,255,219,0,255,217]);
 const photoCall=(who:Owner|null,path:string,body?:Uint8Array,expected=who?.id)=>worker.fetch(new Request('https://puptime.test/api/'+path,{method:body?'POST':'GET',headers:{origin:'https://puptime.test','cf-connecting-ip':who?.ip??'192.0.2.254',...(who?{cookie:who.cookie}:{}),'x-puptime-account':expected??'',...(body?{'content-type':'image/jpeg'}:{})},...(body?{body}: {})}),settings);
 expect((await photoCall(null,`photos/${photoId}`)).status).toBe(401);
 expect((await photoCall(user,`photos/pet-1/${photoId}`,jpeg,other.id)).status).toBe(409);
 expect((await photoCall(user,`photos/foreign-pet/${photoId}`,jpeg)).status).toBe(404);
 expect((await photoCall(user,`photos/pet-1/${photoId}`,jpeg)).status).toBe(200);
 expect((await photoCall(user,`photos/pet-1/${photoId}`,jpeg)).status).toBe(200);
 expect((await photoCall(user,`photos/pet-1/${photoId}`,new Uint8Array([255,216,255,220,0,255,217]))).status).toBe(409);
 const stored=await photoCall(user,`photos/${photoId}`);
 expect(stored.headers.get('content-type')).toBe('image/jpeg');expect(stored.headers.get('cache-control')).toBe('no-store');
 expect(new Uint8Array(await stored.arrayBuffer())).toEqual(jpeg);
 expect((await photoCall(other,`photos/${photoId}`)).status).toBe(404);
 expect((await photoCall(user,`photos/pet-1/img_22222222222222222222222222222222`,new TextEncoder().encode('not a JPEG'))).status).toBe(400);
 expect((await photoCall(user,`photos/pet-1/img_22222222222222222222222222222222`,new Uint8Array(256*1024+1))).status).toBe(413);
 const deleted=await worker.fetch(new Request('https://puptime.test/api/account',{method:'DELETE',headers:{cookie:user.cookie,origin:'https://puptime.test','content-type':'application/json','x-puptime-account':user.id},body:JSON.stringify({confirm:true})}),settings);
 expect(deleted.status).toBe(200);
 expect((await env.PUPPY_PHOTOS!.list({prefix:`accounts/${user.id}/`})).objects).toEqual([]);
});


test('account deletion fences a photo upload that finishes after object cleanup began',async()=>{
 const user=await owner();await enroll(user);const bucket=env.PUPPY_PHOTOS!,photoId='img_33333333333333333333333333333333';
 const settingsDuringDeletion={...settings,PUPPY_PHOTOS:{head:bucket.head.bind(bucket),delete:bucket.delete.bind(bucket),put:async(...args:Parameters<R2Bucket['put']>)=>{
  const result=await bucket.put(...args);
  await env.AUTH_DB.prepare("INSERT INTO cloud_accounts(account_id,state) VALUES (?,'deleting') ON CONFLICT(account_id) DO UPDATE SET state='deleting'").bind(user.id).run();return result;
 }} as unknown as R2Bucket};
 const response=await worker.fetch(new Request(`https://puptime.test/api/photos/pet-1/${photoId}`,{method:'POST',headers:{cookie:user.cookie,origin:'https://puptime.test','x-puptime-account':user.id,'content-type':'image/jpeg'},body:new Uint8Array([255,216,255,219,0,255,217])}),settingsDuringDeletion);
 expect(response.status).toBe(410);expect((await bucket.list({prefix:`accounts/${user.id}/`})).objects).toEqual([]);
});

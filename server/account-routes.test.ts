import { env } from 'cloudflare:workers';
import { applyD1Migrations, runInDurableObject } from 'cloudflare:test';
import { beforeAll, expect, inject, test } from 'vitest';
import worker from './index';
import type { Mutation } from '../src/cloud/protocol';

beforeAll(() => applyD1Migrations(env.AUTH_DB, inject('migrations')));
const settings = { ...env, ENVIRONMENT: 'local' as const, AUTH_BASE_URL: 'https://puptime.test', WEB_ORIGINS: 'https://puptime.test', AUTH_SECRET: 'local-test-secret-with-at-least-32-characters' };
let clientNumber = 10;
type Owner = { cookie: string; id: string; ip: string };
async function call(owner: Owner | null, path: string, body?: object) {
  return worker.fetch(new Request(`https://puptime.test/api/${path}`, {
    method: body ? 'POST' : 'GET', headers: { origin: 'https://puptime.test', 'cf-connecting-ip': owner?.ip ?? '192.0.2.254',
      ...(owner ? { cookie: owner.cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
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
  expect((await call(user, 'cloud/trial', {})).status).toBe(200);
  const response = await call(user, 'cloud/enroll', { operationId: crypto.randomUUID(), deviceId: 'test-device', localPetId: petId, name: 'Pip' });
  expect(response.status).toBe(200);
}

test('sign-in does not enable sync or silently enroll a local puppy', async () => {
  const user = await owner();
  const account = await (await call(user, 'account')).json<{ cloud: { canSync: boolean }; pets: unknown[] }>();
  expect(account.cloud.canSync).toBe(false);
  expect(account.pets).toEqual([]);
  expect((await call(user, 'sync/push', { mutations: [event()] })).status).toBe(402);
  expect((await call(null, 'account/export')).status).toBe(401);
});

test('explicit activation and enrollment synchronize only the authenticated owner data', async () => {
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

test('expired access stops sync while full private export remains available', async () => {
  const user = await owner(); await enroll(user);
  await call(user, 'sync/push', { mutations: [event()] });
  await env.AUTH_DB.prepare('UPDATE cloud_accounts SET trial_started_at = 0, trial_ends_at = 1 WHERE account_id = ?').bind(user.id).run();
  expect((await call(user, 'sync/pull?after=0')).status).toBe(402);
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
  const response = await worker.fetch(new Request('https://puptime.test/api/cloud/trial', {
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
  await env.AUTH_DB.prepare("UPDATE cloud_accounts SET state = 'deleting' WHERE account_id = ?").bind(user.id).run();
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
test('change channel rejects anonymous, unentitled, wrong-origin and expired sessions',async()=>{
 expect((await changes(null)).status).toBe(401);
 const user=await owner();expect((await changes(user)).status).toBe(402);
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
test('revoked sessions and expired access stop subsequent change metadata; deleting the account closes its channel',async()=>{
 for(const condition of ['revoked','expired','deleted'] as const){
  const user=await owner();await enroll(user);const response=await changes(user);expect(response.status).toBe(101);
  const socket=response.webSocket!,seen=observeSocket(socket);await settleSocket();
  if(condition==='revoked')await env.AUTH_DB.prepare('DELETE FROM session WHERE userId=?').bind(user.id).run();
  if(condition==='expired')await env.AUTH_DB.prepare('UPDATE cloud_accounts SET trial_started_at=0,trial_ends_at=1 WHERE account_id=?').bind(user.id).run();
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

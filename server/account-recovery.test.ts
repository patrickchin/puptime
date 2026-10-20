import { env } from 'cloudflare:workers';
import { applyD1Migrations } from 'cloudflare:test';
import { generateKeyPair, SignJWT } from 'jose';
import { afterEach, beforeAll, expect, inject, test, vi } from 'vitest';
import { createAuth } from './auth';
import { hashCapability } from './account-reauth';
import { emailRecoveryIntent, recoveryMode } from './account-recovery';
import worker from './index';

const base = 'https://puptime.test';
const settings = { ...env, ENVIRONMENT: 'local' as const, AUTH_BASE_URL: base, WEB_ORIGINS: base, AUTH_SECRET: 'recovery-test-secret-at-least-thirty-two-characters', APPLE_CLIENT_ID: 'com.puptime.test.web', APPLE_CLIENT_SECRET: 'synthetic', GOOGLE_CLIENT_ID: 'synthetic.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'synthetic' };
type Provider = 'apple' | 'google';
let key: Awaited<ReturnType<typeof generateKeyPair>>['privateKey'], ip = 0;
beforeAll(async () => { await applyD1Migrations(env.AUTH_DB, inject('migrations')); key = (await generateKeyPair('RS256')).privateKey; });
afterEach(() => vi.restoreAllMocks());
const cookies = (response: Response) => response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
function call(path: string, body?: object, options: { cookie?: string; expected?: string; headers?: HeadersInit; method?: string; env?: Cloudflare.Env } = {}) {
  ip++;
  return worker.fetch(new Request(base + '/api/' + path, { method: options.method ?? (body ? 'POST' : 'GET'), headers: { origin: base, 'cf-connecting-ip': `198.19.${Math.floor(ip / 250)}.${ip % 250 + 1}`, ...(body ? { 'content-type': 'application/json' } : {}), ...(options.cookie ? { cookie: options.cookie } : {}), ...(options.expected ? { 'x-puptime-account': options.expected } : {}), ...options.headers }, ...(body ? { body: JSON.stringify(body) } : {}) }), options.env ?? settings);
}
async function preview(email: string) { return (await env.AUTH_DB.prepare('SELECT code FROM local_email_previews WHERE email=? ORDER BY expires_at DESC').bind(email).first<{ code: string }>())!.code; }
async function owner(provider: Provider = 'google') {
  const email = `recovery-${crypto.randomUUID()}@example.invalid`;
  expect((await call('auth/email-otp/send-verification-otp', { email, type: 'sign-in' })).status).toBe(200);
  const login = await call('auth/sign-in/email-otp', { email, otp: await preview(email) }); expect(login.status).toBe(200);
  const cookie = cookies(login), session = (await createAuth(settings).api.getSession({ headers: new Headers({ cookie }), query: { disableRefresh: true } }))!;
  const subject = crypto.randomUUID(), accountRowId = crypto.randomUUID(), now = Date.now();
  await env.AUTH_DB.prepare('INSERT INTO account(id,accountId,providerId,userId,accessToken,refreshToken,idToken,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?)').bind(accountRowId, subject, provider, session.user.id, 'old-access', 'old-refresh', 'old-id', now, now).run();
  const prepared = await call('account/deletion/prepare', {}, { cookie, expected: session.user.id }); expect(prepared.status).toBe(200);
  const { receipt } = await prepared.json<{ receipt: string }>();
  return { email, user: session.user, session: session.session, cookie, provider, subject, accountRowId, receipt };
}
type Owner = Awaited<ReturnType<typeof owner>>;
async function revoke(a: Owner, pending = true) {
  await env.AUTH_DB.prepare('DELETE FROM session WHERE userId=?').bind(a.user.id).run();
  if (pending) {
    await env.AUTH_DB.prepare("INSERT INTO cloud_accounts(account_id,state) VALUES(?,'deleting')").bind(a.user.id).run();
    await env.AUTH_DB.prepare("UPDATE account_deletion_receipts SET phase='deleting' WHERE receipt_hash=?").bind(await hashCapability(a.receipt)).run();
  }
}
async function identity(a: Owner) {
  const accounts = (await env.AUTH_DB.prepare('SELECT * FROM account WHERE userId=?').bind(a.user.id).all()).results;
  return { users: (await env.AUTH_DB.prepare('SELECT * FROM user WHERE id=?').bind(a.user.id).all()).results,
    accounts: await Promise.all(accounts.map(async row => Object.fromEntries(await Promise.all(Object.entries(row).map(async ([key, value]) =>
      [key, ['accessToken', 'refreshToken', 'idToken', 'password'].includes(key) && typeof value === 'string' ? await hashCapability(value) : value]))))) };
}
async function sessions(a: Owner) { return (await env.AUTH_DB.prepare('SELECT id FROM session WHERE userId=?').bind(a.user.id).all()).results; }
async function begin(a: Owner, extra: object = {}, options: Parameters<typeof call>[2] = {}) {
  const response = await call('auth/sign-in/social', { provider: a.provider, callbackURL: base + '/account', errorCallbackURL: base + '/account', disableRedirect: true, receipt: a.receipt, ...extra }, { expected: a.user.id, headers: { 'x-puptime-reauth': recoveryMode }, ...options });
  expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
  const data = await response.json<{ url: string; recoveryIntentId: string }>(), url = new URL(data.url);
  const state = url.searchParams.get('state')!;
  expect(url.searchParams.get('code_challenge_method')).toBe('S256'); expect(data.url).not.toContain(a.receipt);
  const row = await env.AUTH_DB.prepare('SELECT * FROM account_recovery_intents WHERE id=?').bind(data.recoveryIntentId).first();
  expect(row).toMatchObject({ receipt_hash: await hashCapability(a.receipt), account_id: a.user.id, provider_account_id: a.accountRowId, identity_value: a.subject, state_hash: await hashCapability(state) });
  const sdkState = await env.AUTH_DB.prepare('SELECT value FROM verification WHERE identifier=?').bind('auth-state:' + state).first<{ value: string }>();
  expect(sdkState!.value).not.toContain(a.receipt); expect(sdkState!.value).not.toContain(a.subject); expect(sdkState!.value).not.toContain(a.email);
  return { state, cookie: cookies(response), id: data.recoveryIntentId };
}
type Flow = Awaited<ReturnType<typeof begin>>;
async function providerReply(a: Owner, changes: { subject?: string; email?: string | null } = {}) {
  const token = await new SignJWT({ ...(changes.email === null ? {} : { email: changes.email ?? a.email }), email_verified: true, name: 'Untrusted replacement profile' }).setProtectedHeader({ alg: 'RS256' }).setSubject(changes.subject ?? a.subject).setIssuer(a.provider === 'apple' ? 'https://appleid.apple.com' : 'https://accounts.google.com').setAudience(a.provider === 'apple' ? settings.APPLE_CLIENT_ID : settings.GOOGLE_CLIENT_ID).setIssuedAt().setExpirationTime('5m').sign(key);
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    if (String(input) === 'https://appleid.apple.com/auth/revoke') return new Response(null, { status: 200 });
    expect(String(input)).toBe(a.provider === 'apple' ? 'https://appleid.apple.com/auth/token' : 'https://oauth2.googleapis.com/token');
    return Response.json({ access_token: 'new-access', refresh_token: 'new-refresh', token_type: 'Bearer', expires_in: 300, id_token: token });
  });
}
async function callback(a: Owner, flow: Flow, configured = settings, badCookie = false) {
  const params = new URLSearchParams({ code: 'synthetic-recovery', state: flow.state });
  const headers = { origin: a.provider === 'apple' ? 'https://appleid.apple.com' : base, cookie: badCookie ? '' : flow.cookie, 'cf-connecting-ip': '198.20.0.' + (++ip % 250 + 1) };
  let response = await worker.fetch(new Request(base + '/api/auth/callback/' + a.provider + (a.provider === 'google' ? '?' + params : ''), { method: a.provider === 'apple' ? 'POST' : 'GET', headers: { ...headers, ...(a.provider === 'apple' ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) }, ...(a.provider === 'apple' ? { body: params.toString() } : {}), redirect: 'manual' }), configured);
  if (a.provider === 'apple') response = await worker.fetch(new Request(response.headers.get('location')!, { headers: { ...headers, origin: base }, redirect: 'manual' }), configured);
  return response;
}
async function emailStart(a: Owner, options: Parameters<typeof call>[2] = {}) {
  const response = await call('account/recovery/email/start', { receipt: a.receipt }, { expected: a.user.id, ...options });
  expect(response.status).toBe(200); const data = await response.json<{ success: boolean; recoveryIntentId: string }>();
  expect(data).toEqual({ success: true, recoveryIntentId: expect.any(String) }); expect(JSON.stringify(data)).not.toContain(a.email);
  return { id: data.recoveryIntentId, otp: await preview(a.email) };
}
function emailVerify(a: Owner, flow: { id: string; otp: string }, options: Parameters<typeof call>[2] = {}) {
  return call('account/recovery/email/verify', { receipt: a.receipt, intentId: flow.id, otp: flow.otp }, { expected: a.user.id, ...options });
}
async function current(response: Response) { return createAuth(settings).api.getSession({ headers: new Headers({ cookie: cookies(response) }), query: { disableRefresh: true } }); }
const status = async (a: Owner) => (await call('account/deletion/status', { receipt: a.receipt })).json();
function beforeConsume(change: () => Promise<void>): Cloudflare.Env {
  let changed = false;
  const wrap = (statement: D1PreparedStatement): D1PreparedStatement => new Proxy(statement, { get(target, property) {
    if (property === 'bind') return (...values: unknown[]) => wrap(target.bind(...values));
    if (property === 'first') return async (...args: Parameters<D1PreparedStatement['first']>) => { if (!changed) { changed = true; await change(); } return target.first(...args); };
    const value = Reflect.get(target, property, target); return typeof value === 'function' ? value.bind(target) : value;
  } });
  const db = new Proxy(env.AUTH_DB, { get(target, property) {
    if (property === 'prepare') return (sql: string) => sql.startsWith('DELETE FROM account_recovery_intents WHERE id=? AND account_id=?') ? wrap(target.prepare(sql)) : target.prepare(sql);
    const value = Reflect.get(target, property, target); return typeof value === 'function' && property !== 'constructor' ? value.bind(target) : value;
  } });
  return { ...settings, AUTH_DB: db };
}

for (const provider of ['apple', 'google'] as const) test(provider + ' recovers a revoked source through real SDK/D1 with unchanged identity, links, credentials and pending outcome', async () => {
  const a = await owner(provider); await revoke(a); const before = await identity(a), flow = await begin(a); await providerReply(a);
  const response = await callback(a, flow); expect(response.headers.get('location')).toBe(base + '/account'); expect((await current(response))?.user.id).toBe(a.user.id);
  expect(await identity(a)).toEqual(before); expect(await sessions(a)).toHaveLength(1); expect(await status(a)).toEqual({ status: 'pending' });
  expect(await env.AUTH_DB.prepare('SELECT id FROM account_recovery_intents WHERE id=?').bind(flow.id).first()).toBeNull();
  expect((await callback(a, flow)).headers.get('location')).not.toBe(base + '/account'); expect(await sessions(a)).toHaveLength(1);
});
test('Apple omitted email resolves only the original captured subject and verified mailbox', async () => {
  const a = await owner('apple'); await revoke(a); const flow = await begin(a), before = await identity(a); await providerReply(a, { email: null });
  const response = await callback(a, flow); expect((await current(response))?.user.id).toBe(a.user.id); expect(await identity(a)).toEqual(before);
});
for (const source of ['absent', 'revoked', 'iso-expired', 'numeric-expired'] as const) test(source + ' source session can use owned email proof but the existing live-source mode remains closed', async () => {
  const a = await owner(), before = await identity(a);
  if (source === 'revoked' || source === 'absent') await revoke(a);
  else await env.AUTH_DB.prepare('UPDATE session SET expiresAt=? WHERE id=?').bind(source === 'iso-expired' ? new Date(Date.now() - 60000).toISOString() : Date.now() - 60000, a.session.id).run();
  const live = await call('auth/sign-in/social', { provider: a.provider, callbackURL: base + '/account' }, { cookie: a.cookie, expected: a.user.id, headers: { 'x-puptime-reauth': 'account-deletion' } }); expect(live.status).toBe(401);
  const flow = await emailStart(a, source === 'absent' ? {} : { cookie: a.cookie });
  const response = await emailVerify(a, flow); expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
  const recovered = await current(response); expect(recovered?.user.id).toBe(a.user.id); expect(Date.now() - new Date(recovered!.session.createdAt).getTime()).toBeLessThan(10000); expect(await identity(a)).toEqual(before);
  expect((await emailVerify(a, flow)).status).toBe(403); expect(await sessions(a)).toHaveLength(1);
});
for (const invalid of ['new-subject', 'same-email-unlinked', 'wrong-owner', 'cancelled', 'missing-intent', 'expired-intent', 'expired-unused-receipt', 'removed-receipt', 'removed-user', 'removed-link', 'changed-link', 'bad-cookie'] as const) test(invalid + ' callback cannot fall back to signup, linking, token/profile writes or a session', async () => {
  const a = await owner(), b = await owner(); await revoke(a, false); const flow = await begin(a);
  let subject = a.subject, email = a.email;
  if (invalid === 'new-subject' || invalid === 'same-email-unlinked') { subject = crypto.randomUUID(); if (invalid === 'new-subject') email = 'unknown-' + crypto.randomUUID() + '@example.invalid'; }
  if (invalid === 'wrong-owner') { subject = b.subject; email = b.email; }
  if (invalid === 'cancelled') expect((await call('account/recovery/cancel', { receipt: a.receipt, intentId: flow.id }, { expected: a.user.id })).status).toBe(200);
  if (invalid === 'missing-intent') await env.AUTH_DB.prepare('DELETE FROM account_recovery_intents WHERE id=?').bind(flow.id).run();
  if (invalid === 'expired-intent') await env.AUTH_DB.prepare('UPDATE account_recovery_intents SET created_at=0,expires_at=1 WHERE id=?').bind(flow.id).run();
  if (invalid === 'expired-unused-receipt') await env.AUTH_DB.prepare('UPDATE account_deletion_receipts SET created_at=0,expires_at=1 WHERE receipt_hash=?').bind(await hashCapability(a.receipt)).run();
  if (invalid === 'removed-receipt') await env.AUTH_DB.prepare('DELETE FROM account_deletion_receipts WHERE receipt_hash=?').bind(await hashCapability(a.receipt)).run();
  if (invalid === 'removed-user') await env.AUTH_DB.prepare('DELETE FROM user WHERE id=?').bind(a.user.id).run();
  if (invalid === 'removed-link') await env.AUTH_DB.prepare('DELETE FROM account WHERE id=?').bind(a.accountRowId).run();
  if (invalid === 'changed-link') await env.AUTH_DB.prepare('UPDATE account SET accountId=? WHERE id=?').bind('changed', a.accountRowId).run();
  const before = await identity(a), other = await identity(b); await providerReply(a, { subject, email });
  const response = await callback(a, flow, settings, invalid === 'bad-cookie'); expect(response.headers.get('location')).not.toBe(base + '/account');
  expect(await identity(a)).toEqual(before); expect(await identity(b)).toEqual(other); expect(await sessions(a)).toHaveLength(0);
});
test('concurrent real callbacks consume one intent and issue at most one original-owner session', async () => {
  const a = await owner(); await revoke(a); const flow = await begin(a), before = await identity(a); await providerReply(a);
  const responses = await Promise.all([callback(a, flow), callback(a, flow)]);
  expect(responses.filter(response => response.headers.get('location') === base + '/account')).toHaveLength(1); expect(await sessions(a)).toHaveLength(1); expect(await identity(a)).toEqual(before);
});
for (const method of ['email', 'google'] as const) for (const race of ['cancel', 'receipt-removed', 'receipt-expired', 'completed', 'user-removed', 'identity-changed', 'intent-expired'] as const) test(method + ' ' + race + ' between proof validation and session admission fails closed in actual D1', async () => {
  const a = await owner(); await revoke(a, false); const flow = method === 'email' ? await emailStart(a) : await begin(a);
  const configured = beforeConsume(async () => {
    if (race === 'cancel') await env.AUTH_DB.prepare('DELETE FROM account_recovery_intents WHERE id=?').bind(flow.id).run();
    if (race === 'receipt-removed') await env.AUTH_DB.prepare('DELETE FROM account_deletion_receipts WHERE receipt_hash=?').bind(await hashCapability(a.receipt)).run();
    if (race === 'receipt-expired') await env.AUTH_DB.prepare('UPDATE account_deletion_receipts SET created_at=0,expires_at=1 WHERE receipt_hash=?').bind(await hashCapability(a.receipt)).run();
    if (race === 'completed') await env.AUTH_DB.prepare("UPDATE account_deletion_receipts SET phase='completed',apple_revocation='not-linked' WHERE receipt_hash=?").bind(await hashCapability(a.receipt)).run();
    if (race === 'user-removed') await env.AUTH_DB.prepare('DELETE FROM user WHERE id=?').bind(a.user.id).run();
    if (race === 'identity-changed') {
      if (method === 'email') await env.AUTH_DB.prepare('UPDATE user SET email=? WHERE id=?').bind('changed-' + a.email, a.user.id).run();
      else await env.AUTH_DB.prepare('UPDATE account SET accountId=? WHERE id=?').bind('changed-subject', a.accountRowId).run();
    }
    if (race === 'intent-expired') await env.AUTH_DB.prepare('UPDATE account_recovery_intents SET created_at=0,expires_at=1 WHERE id=?').bind(flow.id).run();
  });
  if (method === 'email') expect((await emailVerify(a, flow as { id: string; otp: string }, { env: configured })).status).toBe(403);
  else { await providerReply(a); expect((await callback(a, flow as Flow, configured as typeof settings)).headers.get('location')).not.toBe(base + '/account'); }
  expect(await sessions(a)).toHaveLength(0);
  expect((await env.AUTH_DB.prepare('SELECT id FROM user WHERE email=?').bind(a.email).all()).results).toHaveLength(race === 'user-removed' || race === 'identity-changed' && method === 'email' ? 0 : 1);
});
test('callback cannot replace another owner session that appeared after recovery began', async () => {
  const a = await owner(), b = await owner(); await revoke(a); const flow = await begin(a); await providerReply(a);
  const response = await callback(a, { ...flow, cookie: flow.cookie + '; ' + b.cookie });
  expect(response.status).toBe(403); expect(await response.json()).toEqual({ error: 'recovery_unavailable' }); expect(await sessions(a)).toHaveLength(0);
  expect((await createAuth(settings).api.getSession({ headers: new Headers({ cookie: b.cookie }) }))?.user.id).toBe(b.user.id);
});
for (const invalid of ['wrong-code', 'cancelled', 'wrong-receipt', 'wrong-owner', 'expired-intent', 'removed-user', 'unverified-user', 'changed-email'] as const) test(invalid + ' owned email verification returns a generic error without promotion or replacement', async () => {
  const a = await owner(), b = await owner(); await revoke(a); const flow = await emailStart(a);
  if (invalid === 'wrong-code') flow.otp = flow.otp === '000000' ? '000001' : '000000';
  if (invalid === 'cancelled') await call('account/recovery/cancel', { receipt: a.receipt, intentId: flow.id }, { expected: a.user.id });
  if (invalid === 'expired-intent') await env.AUTH_DB.prepare('UPDATE account_recovery_intents SET created_at=0,expires_at=1 WHERE id=?').bind(flow.id).run();
  if (invalid === 'removed-user') await env.AUTH_DB.prepare('DELETE FROM user WHERE id=?').bind(a.user.id).run();
  if (invalid === 'unverified-user') await env.AUTH_DB.prepare('UPDATE user SET emailVerified=0 WHERE id=?').bind(a.user.id).run();
  if (invalid === 'changed-email') await env.AUTH_DB.prepare('UPDATE user SET email=? WHERE id=?').bind('changed-' + a.email, a.user.id).run();
  const before = await identity(a), other = await identity(b);
  const response = invalid === 'wrong-receipt' ? await emailVerify({ ...a, receipt: b.receipt }, flow) : await emailVerify(a, flow, invalid === 'wrong-owner' ? { expected: b.user.id } : {});
  expect(response.status).toBe(403); expect(await response.json()).toEqual({ error: 'recovery_unavailable' }); expect(await identity(a)).toEqual(before); expect(await identity(b)).toEqual(other); expect(await sessions(a)).toHaveLength(0);
});
test('public SDK write hooks stop unverified-email promotion even after the wrapper precheck races', async () => {
  const a = await owner(); await revoke(a); const flow = await emailStart(a), intent = await emailRecoveryIntent(env.AUTH_DB, flow.id, a.receipt, a.user.id);
  await env.AUTH_DB.prepare('UPDATE user SET emailVerified=0 WHERE id=?').bind(a.user.id).run(); const before = await identity(a);
  const response = await createAuth(settings, { recovery: intent }).api.signInEmailOTP({ body: { email: intent.identity, otp: flow.otp }, asResponse: true });
  expect(response.status).toBe(403); expect(await identity(a)).toEqual(before); expect(await sessions(a)).toHaveLength(0);
});
test('concurrent email verification cannot create duplicate sessions', async () => {
  const a = await owner(); await revoke(a); const flow = await emailStart(a), before = await identity(a);
  const responses = await Promise.all([emailVerify(a, flow), emailVerify(a, flow)]);
  expect(responses.filter(response => response.status === 200)).toHaveLength(1); expect(await sessions(a)).toHaveLength(1); expect(await identity(a)).toEqual(before);
});
test('failed SDK session insertion consumes the challenge without pretending authentication succeeded', async () => {
  const a = await owner(); await revoke(a); const flow = await emailStart(a), before = await identity(a);
  await env.AUTH_DB.exec(`CREATE TRIGGER recovery_session_failure BEFORE INSERT ON session WHEN NEW.userId='${a.user.id.replaceAll("'", "''")}' BEGIN SELECT RAISE(ABORT,'synthetic-session-write-failure'); END;`);
  try { expect((await emailVerify(a, flow)).status).not.toBe(200); } finally { await env.AUTH_DB.exec('DROP TRIGGER recovery_session_failure'); }
  expect(await sessions(a)).toHaveLength(0); expect(await identity(a)).toEqual(before);
  expect(await env.AUTH_DB.prepare('SELECT id FROM account_recovery_intents WHERE id=?').bind(flow.id).first()).toBeNull(); expect((await emailVerify(a, flow)).status).toBe(403);
});
test('receipt alone and another valid session cannot authenticate, delete or replace that session', async () => {
  const a = await owner(), b = await owner(); await revoke(a); const before = await identity(a);
  expect((await call('account/recovery/email/start', { receipt: a.receipt }, { cookie: b.cookie, expected: a.user.id })).status).toBe(403);
  expect((await call('auth/sign-in/social', { receipt: a.receipt, provider: 'google', callbackURL: base + '/account' }, { cookie: b.cookie, expected: a.user.id, headers: { 'x-puptime-reauth': recoveryMode } })).status).toBe(403);
  expect((await call('account', { confirm: true, receipt: a.receipt }, { expected: a.user.id, method: 'DELETE' })).status).toBe(401);
  expect(await (await call('auth/get-session', undefined, { headers: { authorization: 'Bearer ' + a.receipt } })).json()).toBeNull();
  expect(await identity(a)).toEqual(before); expect((await createAuth(settings).api.getSession({ headers: new Headers({ cookie: b.cookie }) }))?.user.id).toBe(b.user.id);
});
test('started proof survives 30-day expiry and unrelated prepare cleanup, then needs a newly confirmed authenticated DELETE', async () => {
  const a = await owner(), b = await owner(); await revoke(a);
  await env.AUTH_DB.prepare('UPDATE account_deletion_receipts SET created_at=0,expires_at=1 WHERE receipt_hash=?').bind(await hashCapability(a.receipt)).run();
  expect(await status(a)).toEqual({ status: 'pending' }); expect((await call('account/deletion/prepare', {}, { cookie: b.cookie, expected: b.user.id })).status).toBe(200);
  expect(await status(a)).toEqual({ status: 'pending' }); const flow = await emailStart(a), response = await emailVerify(a, flow); expect(response.status).toBe(200);
  expect(await status(a)).toEqual({ status: 'pending' }); expect(await sessions(a)).toHaveLength(1);
  const deleted = await call('account', { confirm: true, receipt: a.receipt }, { cookie: cookies(response), expected: a.user.id, method: 'DELETE' });
  expect(deleted.status).toBe(200); expect(await status(a)).toEqual({ status: 'deleted', appleRevocation: 'not-linked' });
  const hash = await hashCapability(a.receipt);
  expect(await env.AUTH_DB.prepare('SELECT * FROM account_deletion_receipts WHERE receipt_hash=?').bind(hash).first()).toBeNull();
  expect(await env.AUTH_DB.prepare('SELECT * FROM account_deletion_completions WHERE receipt_hash=?').bind(hash).first()).toEqual({ receipt_hash: hash, apple_revocation: 'not-linked' });
  expect((await call('account/recovery/email/start', { receipt: a.receipt }, { expected: a.user.id })).status).toBe(403);
});
test('unused prepared status expires, while capped renewal retains every started owner binding until confirmed completion', async () => {
  const a = await owner(); const original = a.receipt, started: string[] = [];
  await env.AUTH_DB.prepare('UPDATE account_deletion_receipts SET created_at=0,expires_at=1 WHERE receipt_hash=?').bind(await hashCapability(original)).run();
  expect(await status(a)).toEqual({ status: 'unknown' }); expect((await call('account/recovery/email/start', { receipt: original }, { expected: a.user.id })).status).toBe(403);
  for (let n = 0; n < 5; n++) {
    const response = await call('account/deletion/prepare', {}, { cookie: a.cookie, expected: a.user.id }); expect(response.status).toBe(200);
    const receipt = (await response.json<{ receipt: string }>()).receipt; started.push(receipt);
    await env.AUTH_DB.prepare("UPDATE account_deletion_receipts SET phase='deleting',created_at=0,expires_at=1 WHERE receipt_hash=?").bind(await hashCapability(receipt)).run();
  }
  expect((await call('account/deletion/prepare', {}, { cookie: a.cookie, expected: a.user.id })).status).toBe(429);
  expect((await env.AUTH_DB.prepare('SELECT receipt_hash FROM account_deletion_receipts WHERE account_id=?').bind(a.user.id).all()).results).toHaveLength(5);
  expect((await call('account', { confirm: true, receipt: started[0] }, { cookie: a.cookie, expected: a.user.id, method: 'DELETE' })).status).toBe(200);
  expect((await env.AUTH_DB.prepare('SELECT receipt_hash FROM account_deletion_receipts WHERE account_id=?').bind(a.user.id).all()).results).toHaveLength(0);
  for (const receipt of started) expect(await status({ ...a, receipt })).toEqual({ status: 'deleted', appleRevocation: 'not-linked' });
  expect(await status(a)).toEqual({ status: 'unknown' });
});
test('email sends are atomically bounded per original owner and receipt across changing IPs, with opaque counter keys', async () => {
  const a = await owner(); await revoke(a); const responses = await Promise.all(Array.from({ length: 8 }, () => call('account/recovery/email/start', { receipt: a.receipt }, { expected: a.user.id })));
  expect(responses.filter(response => response.status === 200)).toHaveLength(1); expect(responses.filter(response => response.status === 429)).toHaveLength(7);
  expect((await env.AUTH_DB.prepare('SELECT id FROM local_email_previews WHERE email=?').bind(a.email).all()).results).toHaveLength(2);
  const keys = (await env.AUTH_DB.prepare('SELECT key FROM account_recovery_limits').all()).results.map(row => row.key).join(' ');
  for (const value of [a.receipt, a.email, a.subject, a.user.id]) expect(keys).not.toContain(value);
  const retryAfter = Number(responses.find(response => response.status === 429)!.headers.get('retry-after')); expect(retryAfter).toBeGreaterThan(0); expect(retryAfter).toBeLessThanOrEqual(600);
});
test('email send cooldown follows the owner across receipts, and one IP has the SDK-equivalent three-send ceiling', async () => {
  const a = await owner(), more = await call('account/deletion/prepare', {}, { cookie: a.cookie, expected: a.user.id });
  const second = (await more.json<{ receipt: string }>()).receipt; await revoke(a); await emailStart(a);
  expect((await call('account/recovery/email/start', { receipt: second }, { expected: a.user.id })).status).toBe(429);
  const headers = { 'cf-connecting-ip': '192.0.2.232' };
  for (let n = 0; n < 4; n++) {
    const target = await owner(); await revoke(target);
    expect((await call('account/recovery/email/start', { receipt: target.receipt }, { expected: target.user.id, headers })).status).toBe(n < 3 ? 200 : 429);
  }
});
test('normal SDK limiter pruning cannot reset an unexpired recovery owner window', async () => {
  const a = await owner(); await revoke(a); await emailStart(a);
  for (let n = 0; n < 4; n++) expect((await call('account/recovery/email/start', { receipt: a.receipt }, { expected: a.user.id })).status).toBe(429);
  const options = { headers: { 'cf-connecting-ip': '192.0.2.233' } };
  expect((await call('auth/get-session', undefined, options)).status).toBe(200);
  const future = Date.now() + 120000; vi.spyOn(Date, 'now').mockReturnValue(future);
  // A real router limit reset performs the SDK's global rateLimit-table prune.
  // Two minutes expire its window, but not our original owner's ten minutes.
  expect((await call('auth/get-session', undefined, options)).status).toBe(200);
  expect((await call('account/recovery/email/start', { receipt: a.receipt }, { expected: a.user.id })).status).toBe(429);
});
test('one IP cannot bypass the wrapper limiter using invalid receipts, and untrusted or forged input stays generic', async () => {
  const a = await owner(); await revoke(a); const headers = { 'cf-connecting-ip': '192.0.2.231' };
  for (let n = 0; n < 30; n++) expect((await call('account/recovery/email/start', { receipt: 'a'.repeat(43) }, { expected: a.user.id, headers })).status).toBe(403);
  expect((await call('account/recovery/email/start', { receipt: a.receipt }, { expected: a.user.id, headers })).status).toBe(429);
  for (const extra of [{ email: a.email }, { additionalData: { receipt: a.receipt } }, { idToken: { token: 'forged' } }, { callbackURL: 'puptime://account?receipt=' + a.receipt }]) {
    const response = await call('auth/sign-in/social', { provider: a.provider, callbackURL: 'puptime://account', receipt: a.receipt, ...extra }, { expected: a.user.id, headers: { 'x-puptime-reauth': recoveryMode } });
    expect(response.status).toBe(403); expect(await response.json()).toEqual({ error: 'recovery_unavailable' });
  }
  expect((await call('account/recovery/email/start', { receipt: a.receipt }, { expected: a.user.id, headers: { origin: 'https://untrusted.invalid' } })).status).toBe(403);
});

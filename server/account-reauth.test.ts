import { env } from 'cloudflare:workers';
import { applyD1Migrations, runInDurableObject } from 'cloudflare:test';
import { generateKeyPair, SignJWT } from 'jose';
import { afterEach, beforeAll, expect, inject, test, vi } from 'vitest';
import { createAuth } from './auth';
import { hashCapability } from './account-reauth';
import worker from './index';

const base = 'https://puptime.test';
const settings = { ...env, ENVIRONMENT: 'local' as const, AUTH_BASE_URL: base, WEB_ORIGINS: base, AUTH_SECRET: 'reauth-test-secret-at-least-thirty-two-characters', APPLE_CLIENT_ID: 'com.puptime.test.web', APPLE_CLIENT_SECRET: 'synthetic', GOOGLE_CLIENT_ID: 'synthetic.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'synthetic' };
type Provider = 'apple' | 'google';
let key: Awaited<ReturnType<typeof generateKeyPair>>['privateKey'], address = 0;
beforeAll(async () => { await applyD1Migrations(env.AUTH_DB, inject('migrations')); key = (await generateKeyPair('RS256')).privateKey; });
afterEach(() => vi.restoreAllMocks());
function nextIP() { address++; return `198.18.${Math.floor(address / 250)}.${address % 250 + 1}`; }
const cookies = (response: Response) => response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
function call(path: string, body?: object, options: { method?: string; cookie?: string; headers?: HeadersInit; env?: Cloudflare.Env } = {}) {
  return worker.fetch(new Request(base + '/api/' + path, { method: options.method ?? (body ? 'POST' : 'GET'), headers: { origin: base, 'cf-connecting-ip': nextIP(), ...(body ? { 'content-type': 'application/json' } : {}), ...(options.cookie ? { cookie: options.cookie } : {}), ...options.headers }, ...(body ? { body: JSON.stringify(body) } : {}) }), options.env ?? settings);
}
async function owner(provider: Provider = 'google', deleting = false) {
  const email = `reauth-${crypto.randomUUID()}@example.invalid`;
  expect((await call('auth/email-otp/send-verification-otp', { email, type: 'sign-in' })).status).toBe(200);
  const preview = await env.AUTH_DB.prepare('SELECT code FROM local_email_previews WHERE email=?').bind(email).first<{ code: string }>();
  const login = await call('auth/sign-in/email-otp', { email, otp: preview!.code }); expect(login.status).toBe(200);
  const cookie = cookies(login), session = (await createAuth(settings).api.getSession({ headers: new Headers({ cookie }), query: { disableRefresh: true } }))!;
  const subject = crypto.randomUUID(), accountId = crypto.randomUUID(), now = Date.now();
  await env.AUTH_DB.prepare('INSERT INTO account(id,accountId,providerId,userId,accessToken,refreshToken,idToken,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?)').bind(accountId, subject, provider, session.user.id, 'old-access', 'old-refresh', 'old-id', now, now).run();
  if (deleting) await env.AUTH_DB.prepare("INSERT INTO cloud_accounts(account_id,state) VALUES(?,'deleting')").bind(session.user.id).run();
  return { cookie, user: session.user, session: session.session, subject, provider, accountId };
}
type Owner = Awaited<ReturnType<typeof owner>>;
async function begin(a: Owner, extra: object = {}) {
  const response = await call('auth/sign-in/social', { provider: a.provider, callbackURL: base + '/account', errorCallbackURL: base + '/account', disableRedirect: true, ...extra }, { cookie: a.cookie, headers: { 'x-puptime-reauth': 'account-deletion', 'x-puptime-account': a.user.id } });
  expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
  const data = await response.json<{ url: string; reauthIntentId: string }>(), url = new URL(data.url), state = url.searchParams.get('state')!;
  const row = await env.AUTH_DB.prepare('SELECT * FROM account_reauth_intents WHERE id=?').bind(data.reauthIntentId).first();
  expect(row).toMatchObject({ account_id: a.user.id, source_session_id: a.session.id, provider_id: a.provider, state_hash: await hashCapability(state) });
  expect(JSON.stringify(row)).not.toContain(state);
  return { state, stateCookie: cookies(response), id: data.reauthIntentId, url };
}
type Flow = Awaited<ReturnType<typeof begin>>;
async function reply(a: Owner, changes: { subject?: string; email?: string | null; provider?: Provider } = {}) {
  const provider = changes.provider ?? a.provider;
  const token = await new SignJWT({ ...(changes.email === null ? {} : { email: changes.email ?? a.user.email }), email_verified: true, name: 'Fresh provider' }).setProtectedHeader({ alg: 'RS256' }).setSubject(changes.subject ?? a.subject).setIssuer(provider === 'apple' ? 'https://appleid.apple.com' : 'https://accounts.google.com').setAudience(provider === 'apple' ? settings.APPLE_CLIENT_ID : settings.GOOGLE_CLIENT_ID).setIssuedAt().setExpirationTime('5m').sign(key);
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    if (String(input) === 'https://appleid.apple.com/auth/revoke') return new Response(null, { status: 200 });
    expect(String(input)).toBe(provider === 'apple' ? 'https://appleid.apple.com/auth/token' : 'https://oauth2.googleapis.com/token');
    return Response.json({ access_token: 'new-access', refresh_token: 'new-refresh', token_type: 'Bearer', expires_in: 300, id_token: token });
  });
}
async function callback(flow: Flow, provider: Provider, options: { env?: Cloudflare.Env; badCookie?: boolean; form?: boolean } = {}) {
  const params = new URLSearchParams({ code: 'synthetic', state: flow.state });
  const headers = { cookie: options.badCookie ? '' : flow.stateCookie, origin: options.form ? 'https://appleid.apple.com' : base, 'cf-connecting-ip': nextIP() };
  let response = await worker.fetch(new Request(base + '/api/auth/callback/' + provider + (options.form ? '' : '?' + params), { method: options.form ? 'POST' : 'GET', headers: { ...headers, ...(options.form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) }, ...(options.form ? { body: params.toString() } : {}), redirect: 'manual' }), options.env ?? settings);
  if (options.form) { expect(response.status).toBe(302); response = await worker.fetch(new Request(response.headers.get('location')!, { headers: { ...headers, origin: base }, redirect: 'manual' }), options.env ?? settings); }
  const location = response.headers.get('location'); return { response, location: location ? new URL(location) : null };
}
async function snapshot(a: Owner) {
  const protect = async (rows: Record<string, unknown>[]) => Promise.all(rows.map(async row => Object.fromEntries(await Promise.all(Object.entries(row).map(async ([key, value]) => [key, ['token', 'accessToken', 'refreshToken', 'idToken', 'password'].includes(key) && typeof value === 'string' ? await hashCapability(value) : value])))));
  const result = { users: (await env.AUTH_DB.prepare('SELECT * FROM user WHERE id=?').bind(a.user.id).all()).results, accounts: (await env.AUTH_DB.prepare('SELECT * FROM account WHERE userId=?').bind(a.user.id).all()).results, sessions: (await env.AUTH_DB.prepare('SELECT * FROM session WHERE userId=?').bind(a.user.id).all()).results };
  return { users: result.users, accounts: await protect(result.accounts), sessions: await protect(result.sessions) };
}
async function success(a: Owner, result: Awaited<ReturnType<typeof callback>>, before: Awaited<ReturnType<typeof snapshot>>) {
  expect(result.response.status).toBe(302); expect(result.location?.href).toBe(base + '/account'); const after = await snapshot(a);
  expect(after.users).toEqual(before.users); expect(after.accounts).toEqual(before.accounts); expect(after.sessions).toHaveLength(before.sessions.length + 1);
  const current = await createAuth(settings).api.getSession({ headers: new Headers({ cookie: cookies(result.response) }), query: { disableRefresh: true } });
  expect(current?.user.id).toBe(a.user.id); expect(new Date(current!.session.createdAt).getTime()).toBeGreaterThan(Date.now() - 10000);
}
for (const provider of ['apple', 'google'] as const) test(provider + ' actual HTTP starter and callback refresh the deleting original owner without credential writes', async () => {
  const a = await owner(provider, true); await env.AUTH_DB.prepare('UPDATE session SET createdAt=? WHERE id=?').bind(new Date(Date.now() - 86400000).toISOString(), a.session.id).run();
  const before = await snapshot(a), flow = await begin(a); await reply(a); await success(a, await callback(flow, provider, { form: provider === 'apple' }), before);
  expect(await env.AUTH_DB.prepare('SELECT id FROM account_reauth_intents WHERE id=?').bind(flow.id).first()).toBeNull();
});
test('normal provider login still updates tokens after guarded reauthentication', async () => {
  const a = await owner(), first = await begin(a); await reply(a); expect((await callback(first, a.provider)).location?.href).toBe(base + '/account');
  const started = await call('auth/sign-in/social', { provider: a.provider, callbackURL: base + '/account', disableRedirect: true });
  const url = new URL((await started.json<{ url: string }>()).url), normal = { state: url.searchParams.get('state')!, stateCookie: cookies(started), id: '', url };
  expect((await callback(normal, a.provider)).location?.href).toBe(base + '/account');
  expect(await env.AUTH_DB.prepare('SELECT accessToken FROM account WHERE id=?').bind(a.accountId).first()).toEqual({ accessToken: 'new-access' });
});
test('client-supplied additionalData cannot replace server-trusted original-owner binding', async () => {
  const a = await owner('google', true), before = await snapshot(a), flow = await begin(a, { additionalData: { serverContext: { puptimeReauth: { accountId: 'forged' } }, puptimeReauth: { accountId: 'forged' } } });
  await reply(a); await success(a, await callback(flow, 'google'), before);
});
for (const mode of ['wrong-owner', 'new-subject', 'new-subject-same-email', 'missing-owner', 'revoked-session', 'expired-session-iso', 'expired-session-numeric', 'expired-intent', 'missing-mapping', 'wrong-provider', 'bad-cookie', 'cancelled'] as const) test(mode + ' cannot produce a replacement identity or session', async () => {
  const a = await owner('google', true), other = mode === 'wrong-owner' ? await owner() : null, flow = await begin(a);
  if (mode === 'missing-owner') await env.AUTH_DB.prepare('DELETE FROM user WHERE id=?').bind(a.user.id).run();
  if (mode === 'revoked-session') await env.AUTH_DB.prepare('DELETE FROM session WHERE id=?').bind(a.session.id).run();
  if (mode.startsWith('expired-session')) await env.AUTH_DB.prepare('UPDATE session SET expiresAt=? WHERE id=?').bind(mode.endsWith('iso') ? new Date(Date.now() - 60000).toISOString() : Date.now() - 60000, a.session.id).run();
  if (mode === 'expired-intent') await env.AUTH_DB.prepare('UPDATE account_reauth_intents SET created_at=0,expires_at=1 WHERE id=?').bind(flow.id).run();
  if (mode === 'missing-mapping') await env.AUTH_DB.prepare('DELETE FROM account_reauth_intents WHERE id=?').bind(flow.id).run();
  if (mode === 'cancelled') expect((await call('account/reauth/cancel', { intentId: flow.id }, { cookie: a.cookie, headers: { 'x-puptime-account': a.user.id } })).status).toBe(200);
  const before = await snapshot(a), allBefore = (await env.AUTH_DB.prepare('SELECT id,email FROM user ORDER BY id').all()).results, otherBefore = other ? await snapshot(other) : null;
  await reply(a, { subject: mode.startsWith('new-subject') ? crypto.randomUUID() : other?.subject, email: mode === 'new-subject' ? `new-${crypto.randomUUID()}@example.invalid` : undefined, provider: mode === 'wrong-provider' ? 'apple' : 'google' });
  const result = await callback(flow, mode === 'wrong-provider' ? 'apple' : 'google', { badCookie: mode === 'bad-cookie' });
  expect(result.location?.searchParams.get('error')).toBeTruthy(); expect(result.response.headers.getSetCookie().some(value => value.includes('session_token='))).toBe(false);
  expect(await snapshot(a)).toEqual(before); expect((await env.AUTH_DB.prepare('SELECT id,email FROM user ORDER BY id').all()).results).toEqual(allBefore); if (other) expect(await snapshot(other)).toEqual(otherBefore);
});
test('Apple omitted email resolves only through its existing linked raw subject and owner', async () => { const a = await owner('apple', true), before = await snapshot(a), flow = await begin(a); await reply(a, { email: null }); await success(a, await callback(flow, 'apple', { form: true }), before); });
test('Apple unknown subject with omitted email stays rejected without invented email', async () => { const a = await owner('apple', true), before = await snapshot(a), flow = await begin(a); await reply(a, { email: null, subject: crypto.randomUUID() }); expect((await callback(flow, 'apple')).location?.searchParams.get('error')).toBe('email_not_found'); expect(await snapshot(a)).toEqual(before); });
test('normal Apple omitted-email callback retains its existing rejection behavior', async () => {
  const a = await owner('apple'), start = await call('auth/sign-in/social', { provider: 'apple', callbackURL: base + '/account', disableRedirect: true }); const url = new URL((await start.json<{ url: string }>()).url), before = await snapshot(a); await reply(a, { email: null });
  expect((await callback({ state: url.searchParams.get('state')!, stateCookie: cookies(start), id: '', url }, 'apple')).location?.searchParams.get('error')).toBe('email_not_found'); expect(await snapshot(a)).toEqual(before);
});
test('consumed OAuth callback cannot create another session', async () => { const a = await owner('google', true), flow = await begin(a); await reply(a); expect((await callback(flow, 'google')).location?.href).toBe(base + '/account'); const before = await snapshot(a); expect((await callback(flow, 'google')).location?.searchParams.get('error')).toBeTruthy(); expect(await snapshot(a)).toEqual(before); });

// Gate only the test's public D1 binding, never add hooks or switches to product
// code. Both SQL and the SDK still execute against the real local database.
function gatedDatabase(gates: { before?: (sql: string, method: string) => Promise<void>; after?: (sql: string, method: string, result: unknown) => Promise<void> }): D1Database {
  const wrap = (statement: D1PreparedStatement, sql: string): D1PreparedStatement => new Proxy(statement, { get(target, name) {
    if (name === 'bind') return (...values: unknown[]) => wrap(target.bind(...values), sql);
    const value = Reflect.get(target, name);
    if (['all', 'first', 'run', 'raw'].includes(String(name))) return async (...args: unknown[]) => { await gates.before?.(sql, String(name)); const result = await value.apply(target, args); await gates.after?.(sql, String(name), result); return result; };
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  return new Proxy(env.AUTH_DB, { get(target, name) { if (name === 'prepare') return (sql: string) => wrap(target.prepare(sql), sql); const value = Reflect.get(target, name); return typeof value === 'function' ? value.bind(target) : value; } });
}
test('two already-validated callbacks atomically consume one original-owner authorization', async () => {
  const a = await owner('google', true), flow = await begin(a); await reply(a); let readers = 0, consumes = 0, release!: () => void; const bothRead = new Promise<void>(resolve => { release = resolve; });
  const db = gatedDatabase({ after: async (sql, method) => { if (method === 'all' && sql.toLowerCase().includes('from "verification"')) { readers++; if (readers === 2) release(); await bothRead; } }, before: async sql => { if (sql.startsWith('DELETE FROM account_reauth_intents WHERE id=')) consumes++; } });
  const before = await snapshot(a), results = await Promise.all([callback(flow, 'google', { env: { ...settings, AUTH_DB: db } }), callback(flow, 'google', { env: { ...settings, AUTH_DB: db } })]);
  expect(readers).toBeGreaterThanOrEqual(2); expect(consumes).toBe(2); expect(results.filter(result => result.location?.href === base + '/account')).toHaveLength(1); expect((await snapshot(a)).sessions).toHaveLength(before.sessions.length + 1); expect((await snapshot(a)).accounts).toEqual(before.accounts);
});
for (const condition of ['revoked', 'expired-iso'] as const) test(condition + ' source session between validation and creation is fenced atomically', async () => {
  const a = await owner('google', true), flow = await begin(a); await reply(a); let entered!: () => void, release!: () => void; const ready = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  const db = gatedDatabase({ before: async sql => { if (sql.startsWith('DELETE FROM account_reauth_intents WHERE id=')) { entered(); await gate; } } });
  const response = callback(flow, 'google', { env: { ...settings, AUTH_DB: db } }); await ready;
  if (condition === 'revoked') await env.AUTH_DB.prepare('DELETE FROM session WHERE id=?').bind(a.session.id).run();
  else await env.AUTH_DB.prepare('UPDATE session SET expiresAt=? WHERE id=?').bind(new Date(Date.now() - 60000).toISOString(), a.session.id).run();
  release(); expect((await response).location?.searchParams.get('error')).toBeTruthy(); expect((await snapshot(a)).sessions).toHaveLength(condition === 'revoked' ? 0 : 1);
});
test('ordinary returning-provider credential update still hits migration0003', async () => {
  const a = await owner('google', true), start = await call('auth/sign-in/social', { provider: 'google', callbackURL: base + '/account', disableRedirect: true }), url = new URL((await start.json<{ url: string }>()).url), before = await snapshot(a); await reply(a);
  const result = await callback({ state: url.searchParams.get('state')!, stateCookie: cookies(start), id: '', url }, 'google'); expect(result.location?.href).not.toBe(base + '/account'); expect(await snapshot(a)).toEqual(before);
});
test('starter rejects forged modes, expected owners, providers, direct tokens, signup and untrusted origins before creating an intent', async () => {
  const a = await owner(), b = await owner(), original = (await env.AUTH_DB.prepare('SELECT * FROM account_reauth_intents').all()).results;
  const cases: { body?: object; headers?: Record<string, string>; cookie?: string; path?: string; status: number }[] = [
    { headers: { 'x-puptime-reauth': 'other' }, status: 400 }, { headers: { 'x-puptime-account': '' }, status: 400 }, { headers: { 'x-puptime-account': b.user.id }, status: 409 }, { headers: { 'x-puptime-account': 'x'.repeat(257) }, status: 400 },
    { cookie: '', status: 401 }, { cookie: b.cookie, status: 409 }, { body: { provider: 'apple' }, status: 409 }, { body: { provider: 'unsupported' }, status: 400 }, { body: { idToken: { token: 'untrusted' } }, status: 400 }, { body: { requestSignUp: true }, status: 400 }, { body: { callbackURL: 'x'.repeat(2049) }, status: 400 },
    { headers: { origin: 'https://untrusted.example' }, status: 403 }, { headers: { origin: '', 'sec-fetch-site': 'cross-site' }, status: 403 }, { headers: { origin: '', 'expo-origin': 'other://' }, status: 403 }, { path: 'auth/link-social', status: 400 },
  ];
  for (const entry of cases) {
    const response = await call(entry.path ?? 'auth/sign-in/social', { provider: 'google', callbackURL: base + '/account', ...entry.body }, { cookie: entry.cookie ?? a.cookie, headers: { 'x-puptime-reauth': 'account-deletion', 'x-puptime-account': a.user.id, ...entry.headers } }); expect(response.status).toBe(entry.status);
  }
  expect((await env.AUTH_DB.prepare('SELECT * FROM account_reauth_intents').all()).results).toEqual(original);
  const malformed = await worker.fetch(new Request(base + '/api/auth/sign-in/social', { method: 'POST', headers: { origin: base, cookie: a.cookie, 'content-type': 'application/json', 'x-puptime-reauth': 'account-deletion', 'x-puptime-account': a.user.id }, body: '{' }), settings); expect(malformed.status).toBe(400);
});
test('starter rejects missing expected owner, wrong callback origin and ISO-expired session without issuing usable state', async () => {
  const a = await owner();
  expect((await call('auth/sign-in/social', { provider: 'google', callbackURL: base + '/account' }, { cookie: a.cookie, headers: { 'x-puptime-reauth': 'account-deletion' } })).status).toBe(400);
  expect((await call('auth/sign-in/social', { provider: 'google', callbackURL: 'https://untrusted.example/account' }, { cookie: a.cookie, headers: { 'x-puptime-reauth': 'account-deletion', 'x-puptime-account': a.user.id } })).status).toBe(403);
  await env.AUTH_DB.prepare('UPDATE session SET expiresAt=? WHERE id=?').bind(new Date(Date.now() - 60000).toISOString(), a.session.id).run();
  expect((await call('auth/sign-in/social', { provider: 'google', callbackURL: base + '/account' }, { cookie: a.cookie, headers: { 'x-puptime-reauth': 'account-deletion', 'x-puptime-account': a.user.id } })).status).toBe(401);
  expect((await env.AUTH_DB.prepare('SELECT id FROM account_reauth_intents WHERE account_id=?').bind(a.user.id).all()).results).toHaveLength(0);
});
test('intents have a bounded lifetime and per-owner active count, with failed persistence returning no provider URL', async () => {
  const a = await owner(); for (let index = 0; index < 5; index++) await begin(a);
  const response = await call('auth/sign-in/social', { provider: 'google', callbackURL: base + '/account', disableRedirect: true }, { cookie: a.cookie, headers: { 'x-puptime-reauth': 'account-deletion', 'x-puptime-account': a.user.id } }); expect(response.status).toBe(409); expect(await response.json()).toEqual({ error: 'reauthentication_unavailable' });
  expect((await env.AUTH_DB.prepare('SELECT expires_at-created_at AS lifetime FROM account_reauth_intents WHERE account_id=?').bind(a.user.id).all<{ lifetime: number }>()).results.every(row => row.lifetime === 600000)).toBe(true);
  await env.AUTH_DB.prepare('UPDATE account_reauth_intents SET created_at=0,expires_at=1 WHERE account_id=?').bind(a.user.id).run(); await begin(a); expect((await env.AUTH_DB.prepare('SELECT id FROM account_reauth_intents WHERE account_id=?').bind(a.user.id).all()).results).toHaveLength(1);
});

async function prepare(a: Owner) {
  const response = await call('account/deletion/prepare', {}, { cookie: a.cookie, headers: { 'x-puptime-account': a.user.id } }); expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
  return response.json<{ receipt: string; expiresAt: number }>();
}
function remove(a: Owner, receipt?: string, options: { env?: Cloudflare.Env; cookie?: string; expected?: string } = {}) {
  return call('account', { confirm: true, ...(receipt ? { receipt } : {}) }, { method: 'DELETE', cookie: options.cookie ?? a.cookie, headers: { 'x-puptime-account': options.expected ?? a.user.id }, env: options.env });
}
function status(receipt: string, headers: Record<string, string> = {}) { return call('account/deletion/status', { receipt }, { headers }); }
test('prepared receipt is 32 random bytes, stored only as a hash, bounded and incapable of signing in or deleting', async () => {
  const a = await owner(), receipt = await prepare(a); expect(receipt.receipt).toMatch(/^[A-Za-z0-9_-]{43}$/); expect(receipt.expiresAt).toBeGreaterThan(Date.now() + 29 * 86400000);
  const row = await env.AUTH_DB.prepare('SELECT * FROM account_deletion_receipts WHERE receipt_hash=?').bind(await hashCapability(receipt.receipt)).first(); expect(row).toMatchObject({ account_id: a.user.id, phase: 'prepared' }); expect(JSON.stringify(row)).not.toContain(receipt.receipt);
  const before = await snapshot(a); expect(await (await status(receipt.receipt)).json()).toEqual({ status: 'not-started' });
  expect((await remove(a, receipt.receipt, { cookie: '' })).status).toBe(401);
  expect((await call('auth/sign-in/social', { provider: 'google', callbackURL: base + '/account', receipt: receipt.receipt }, { headers: { 'x-puptime-reauth': 'account-deletion', 'x-puptime-account': a.user.id } })).status).toBe(400);
  expect((await call('auth/get-session', undefined, { headers: { authorization: 'Bearer ' + receipt.receipt } })).status).toBe(200); expect(await snapshot(a)).toEqual(before);
});
test('lost successful DELETE is resolved anonymously by receipt with cookies and all auth content removed atomically', async () => {
  const a = await owner(), b = await owner(), other = await snapshot(b), receipt = await prepare(a);
  const response = await remove(a, receipt.receipt); expect(response.status).toBe(200); expect(await response.json()).toEqual({ success: true, message: 'User deleted', appleRevocation: 'not-linked' });
  expect(response.headers.getSetCookie().some(value => value.includes('session_token=;') && value.includes('Max-Age=0'))).toBe(true); expect(await snapshot(a)).toEqual({ users: [], accounts: [], sessions: [] }); expect(await snapshot(b)).toEqual(other);
  expect(await env.AUTH_DB.prepare('SELECT account_id FROM cloud_accounts WHERE account_id=?').bind(a.user.id).first()).toBeNull();
  // Discard the successful response. Only this pre-saved, status-only receipt
  // survives; recovery neither authenticates nor submits another deletion.
  const recovered = await status(receipt.receipt); expect(recovered.headers.get('cache-control')).toBe('no-store'); expect(await recovered.json()).toEqual({ status: 'deleted', appleRevocation: 'not-linked' });
  expect(await createAuth(settings).api.getSession({ headers: new Headers({ cookie: a.cookie }), query: { disableRefresh: true } })).toBeNull(); expect((await remove(a, receipt.receipt)).status).toBe(401);
  expect(await (await status('A'.repeat(43))).json()).toEqual({ status: 'unknown' });
});
for (const appleRevocation of ['not-linked', 'revoked', 'manual'] as const) test(appleRevocation + ' durable completion survives arbitrary offline age and cleanup without retaining an owner', async () => {
  const a = await owner(appleRevocation === 'not-linked' ? 'google' : 'apple'), b = await owner(), receipts = [];
  for (let n = 0; n < 5; n++) receipts.push(await prepare(a));
  if (appleRevocation !== 'not-linked') vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: appleRevocation === 'revoked' ? 200 : 503 }));
  const removed = await remove(a, receipts[0].receipt); expect(removed.status).toBe(200);
  expect(await removed.json()).toEqual({ success: true, message: 'User deleted', appleRevocation });
  const future = Date.now() + 100 * 365 * 86400000; vi.spyOn(Date, 'now').mockReturnValue(future);
  // Simulate another freshly authenticated owner at the later cleanup time.
  await env.AUTH_DB.prepare('UPDATE session SET createdAt=?,expiresAt=? WHERE id=?').bind(future, future + 86400000, b.session.id).run();
  const other = await snapshot(b);
  for (const reference of receipts) {
    const response = await status(reference.receipt); expect(response.headers.get('cache-control')).toBe('no-store'); expect(response.headers.getSetCookie()).toEqual([]);
    expect(await response.json()).toEqual({ status: 'deleted', appleRevocation });
  }
  await prepare(b); expect(await snapshot(b)).toEqual(other);
  expect(await snapshot(a)).toEqual({ users: [], accounts: [], sessions: [] });
  expect((await env.AUTH_DB.prepare('SELECT * FROM account_deletion_receipts WHERE account_id=?').bind(a.user.id).all()).results).toEqual([]);
  for (const reference of receipts) {
    const hash = await hashCapability(reference.receipt);
    expect(await env.AUTH_DB.prepare('SELECT * FROM account_deletion_completions WHERE receipt_hash=?').bind(hash).first()).toEqual({ receipt_hash: hash, apple_revocation: appleRevocation });
    expect(await (await status(reference.receipt)).json()).toEqual({ status: 'deleted', appleRevocation });
  }
  expect(await (await status('A'.repeat(43))).json()).toEqual({ status: 'unknown' });
  const headers = { 'x-puptime-account': a.user.id };
  const recovery = await call('account/recovery/email/start', { receipt: receipts[0].receipt }, { headers });
  expect(recovery.status).toBe(403); expect(await recovery.json()).toEqual({ error: 'recovery_unavailable' });
  const social = await call('auth/sign-in/social', { provider: a.provider, callbackURL: base + '/account', receipt: receipts[0].receipt }, { headers: { ...headers, 'x-puptime-reauth': 'account-deletion-recovery' } });
  expect(social.status).toBe(403); expect(await social.json()).toEqual({ error: 'recovery_unavailable' });
  expect((await remove(a, receipts[0].receipt)).status).toBe(401);
});
for (const dates of ['stale-iso', 'future-iso', 'expired-iso', 'stale-numeric', 'future-numeric', 'expired-numeric'] as const) test(dates + ' actual session cannot prepare or confirm deletion', async () => {
  const a = await owner(), receipt = await prepare(a), numeric = dates.endsWith('numeric'), expired = dates.startsWith('expired'), future = dates.startsWith('future');
  const timestamp = Date.now() + (future ? 60000 : -86400000), value = numeric ? timestamp : new Date(timestamp).toISOString();
  await env.AUTH_DB.prepare(`UPDATE session SET ${expired ? 'expiresAt' : 'createdAt'}=? WHERE id=?`).bind(value, a.session.id).run(); const before = await snapshot(a);
  const options = { cookie: a.cookie, headers: { 'x-puptime-account': a.user.id } };
  expect((await call('account/deletion/prepare', {}, options)).status).toBe(401); expect((await remove(a, receipt.receipt)).status).toBe(401); expect(await snapshot(a)).toEqual(expired ? { ...before, sessions: [] } : before); expect(await (await status(receipt.receipt)).json()).toEqual({ status: 'not-started' });
});
test('numeric compatible fresh session still prepares and confirms deletion', async () => { const a = await owner(), now = Date.now(); await env.AUTH_DB.prepare('UPDATE session SET createdAt=?,expiresAt=? WHERE id=?').bind(now, now + 86400000, a.session.id).run(); const receipt = await prepare(a); expect((await remove(a, receipt.receipt)).status).toBe(200); });
test('prepare and status enforce exact schemas, owner/origin bounds, capability expiry and no query-string receipt', async () => {
  const a = await owner(), b = await owner();
  for (const [headers, cookie, expectedStatus] of [[{}, a.cookie, 400], [{ 'x-puptime-account': b.user.id }, a.cookie, 409], [{ 'x-puptime-account': a.user.id }, '', 401], [{ 'x-puptime-account': a.user.id, origin: 'https://untrusted.example' }, a.cookie, 403]] as const) expect((await call('account/deletion/prepare', {}, { cookie, headers })).status).toBe(expectedStatus);
  const receipt = await prepare(a); for (const value of ['', 'A'.repeat(42), 'A'.repeat(44), '💩'.repeat(43)]) expect((await status(value)).status).toBe(400);
  expect((await status(receipt.receipt, { origin: 'https://untrusted.example' })).status).toBe(403); expect((await status(receipt.receipt, { origin: '', 'sec-fetch-site': 'cross-site' })).status).toBe(403);
  expect((await call('account/deletion/status?receipt=' + receipt.receipt)).status).toBe(404);
  await env.AUTH_DB.prepare('UPDATE account_deletion_receipts SET created_at=0,expires_at=1 WHERE receipt_hash=?').bind(await hashCapability(receipt.receipt)).run(); expect(await (await status(receipt.receipt)).json()).toEqual({ status: 'unknown' }); expect((await remove(a, receipt.receipt)).status).toBe(409);
});
test('wrong-owner and unissued receipts cannot mutate either account; pending status is never deletion permission', async () => {
  const a = await owner(), b = await owner(), receipt = await prepare(a), aBefore = await snapshot(a), bBefore = await snapshot(b);
  for (const [who, token, options] of [[b, receipt.receipt, {}], [a, 'A'.repeat(43), {}], [a, receipt.receipt, { cookie: b.cookie }]] as const) expect((await remove(who, token, options)).status).toBe(409);
  expect((await call('account', { confirm: true, receipt: receipt.receipt }, { method: 'DELETE', cookie: a.cookie })).status).toBe(400);
  expect((await call('account', { receipt: receipt.receipt }, { method: 'DELETE', cookie: a.cookie, headers: { 'x-puptime-account': a.user.id } })).status).toBe(400);
  expect(await snapshot(a)).toEqual(aBefore); expect(await snapshot(b)).toEqual(bBefore);
});
test('receipt preparation persistence failure has no cloud or authentication side effect', async () => {
  const a = await owner(), before = await snapshot(a); await env.AUTH_DB.exec("CREATE TRIGGER reject_prepare BEFORE INSERT ON account_deletion_receipts BEGIN SELECT RAISE(ABORT,'synthetic-prepare-failure'); END;");
  try { const response = await call('account/deletion/prepare', {}, { cookie: a.cookie, headers: { 'x-puptime-account': a.user.id } }); expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: 'service_unavailable' }); expect(await snapshot(a)).toEqual(before); expect(await env.AUTH_DB.prepare('SELECT state FROM cloud_accounts WHERE account_id=?').bind(a.user.id).first()).toBeNull(); } finally { await env.AUTH_DB.exec('DROP TRIGGER reject_prepare'); }
});
for (const failure of ['content', 'child-cascade', 'receipt-completion', 'receipt-removal'] as const) test(failure + ' failure retains auth and an honest pending receipt; recovery requires another confirmation', async () => {
  const a = await owner(), receipt = await prepare(a), before = await snapshot(a);
  const broken = failure === 'content' ? { ...settings, ACCOUNTS: { idFromName: env.ACCOUNTS.idFromName.bind(env.ACCOUNTS), get: () => ({ retire: async () => { throw new Error('synthetic-content-failure'); } }) } } as unknown as Cloudflare.Env : settings;
  if (failure !== 'content') await env.AUTH_DB.exec(failure === 'child-cascade' ? "CREATE TRIGGER reject_final BEFORE DELETE ON account BEGIN SELECT RAISE(ABORT,'synthetic-child-failure'); END;" : failure === 'receipt-completion' ? "CREATE TRIGGER reject_final BEFORE INSERT ON account_deletion_completions BEGIN SELECT RAISE(ABORT,'synthetic-completion-failure'); END;" : "CREATE TRIGGER reject_final BEFORE DELETE ON account_deletion_receipts BEGIN SELECT RAISE(ABORT,'synthetic-removal-failure'); END;");
  try { const response = await remove(a, receipt.receipt, { env: broken }); expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: 'service_unavailable' }); expect(await snapshot(a)).toEqual(before); expect(await (await status(receipt.receipt)).json()).toEqual({ status: 'pending' }); }
  finally { if (failure !== 'content') await env.AUTH_DB.exec('DROP TRIGGER reject_final'); }
  const row = await env.AUTH_DB.prepare('SELECT phase,attempt_id,attempt_until FROM account_deletion_receipts WHERE receipt_hash=?').bind(await hashCapability(receipt.receipt)).first(); expect(row).toMatchObject({ phase: failure === 'content' ? 'deleting' : 'cloud-retired', attempt_id: null, attempt_until: null });
  expect(await env.AUTH_DB.prepare('SELECT * FROM account_deletion_completions WHERE receipt_hash=?').bind(await hashCapability(receipt.receipt)).first()).toBeNull();
  await env.AUTH_DB.prepare('UPDATE session SET createdAt=? WHERE id=?').bind(new Date(Date.now() - 86400000).toISOString(), a.session.id).run(); const flow = await begin(a); await reply(a); const refreshed = await callback(flow, a.provider); expect(refreshed.location?.href).toBe(base + '/account'); expect(await (await status(receipt.receipt)).json()).toEqual({ status: 'pending' });
  const explicitRetry = await remove({ ...a, cookie: cookies(refreshed.response) }, receipt.receipt); expect(explicitRetry.status).toBe(200); expect(await (await status(receipt.receipt)).json()).toEqual({ status: 'deleted', appleRevocation: 'not-linked' });
});
test('concurrent receipt and legacy confirmations serialize before retirement', async () => {
  const a = await owner(), first = await prepare(a), second = await prepare(a); let entered!: () => void, release!: () => void, retires = 0;
  const ready = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  const controlled = { ...settings, ACCOUNTS: { idFromName: env.ACCOUNTS.idFromName.bind(env.ACCOUNTS), get: (id: DurableObjectId) => ({ retire: async () => { retires++; entered(); await gate; return env.ACCOUNTS.get(id).retire(); } }) } } as unknown as Cloudflare.Env;
  const pending = remove(a, first.receipt, { env: controlled }); await ready;
  try { expect((await remove(a, second.receipt, { env: controlled })).status).toBe(409); expect((await remove(a, undefined, { env: controlled })).status).toBe(409); expect(retires).toBe(1); } finally { release(); }
  expect((await pending).status).toBe(200); for (const receipt of [first, second]) expect(await (await status(receipt.receipt)).json()).toEqual({ status: 'deleted', appleRevocation: 'not-linked' });
});
test('stale deletion lease allows a new explicitly confirmed attempt, while active lease never does', async () => {
  const a = await owner(), receipt = await prepare(a), hash = await hashCapability(receipt.receipt);
  await env.AUTH_DB.prepare("UPDATE account_deletion_receipts SET phase='deleting',attempt_id='interrupted',attempt_until=? WHERE receipt_hash=?").bind(Date.now() + 60000, hash).run(); expect((await remove(a, receipt.receipt)).status).toBe(409);
  await env.AUTH_DB.prepare('UPDATE account_deletion_receipts SET attempt_until=0 WHERE receipt_hash=?').bind(hash).run(); expect(await (await status(receipt.receipt)).json()).toEqual({ status: 'pending' }); expect((await remove(a, receipt.receipt)).status).toBe(200);
});
test('completion acknowledgement failure remains recoverable after atomic auth removal', async () => {
  const a = await owner(), receipt = await prepare(a), db = gatedDatabase({ before: async sql => { if (sql.startsWith('SELECT receipt_hash FROM account_deletion_completions WHERE receipt_hash=')) throw new Error('synthetic-lost-acknowledgement'); } });
  expect((await remove(a, receipt.receipt, { env: { ...settings, AUTH_DB: db } })).status).toBe(503); expect(await snapshot(a)).toEqual({ users: [], accounts: [], sessions: [] }); expect(await (await status(receipt.receipt)).json()).toEqual({ status: 'deleted', appleRevocation: 'not-linked' });
});
test('status cannot miss both proofs when completion commits during its lookup', async () => {
  const a = await owner(), receipt = await prepare(a); let completed = false;
  const db = gatedDatabase({ before: async sql => {
    if (!completed && sql.includes('FROM account_deletion_receipts') && sql.includes('receipt_hash=?')) {
      completed = true; expect((await remove(a, receipt.receipt)).status).toBe(200);
    }
  } });
  const response = await call('account/deletion/status', { receipt: receipt.receipt }, { env: { ...settings, AUTH_DB: db } });
  expect(completed).toBe(true); expect(response.status).toBe(200); expect(await response.json()).toEqual({ status: 'deleted', appleRevocation: 'not-linked' });
});
test('ISO session expiry closes an already-open live metadata socket; numeric compatibility remains covered', async () => {
  const a = await owner(); expect((await call('cloud/trial', {}, { cookie: a.cookie })).status).toBe(200); expect((await call('cloud/enroll', { operationId: crypto.randomUUID(), deviceId: 'socket-device', localPetId: 'socket-pet', name: 'Pip' }, { cookie: a.cookie })).status).toBe(200);
  const response = await worker.fetch(new Request(base + '/api/sync/changes', { headers: { origin: base, cookie: a.cookie, upgrade: 'websocket' } }), settings); expect(response.status).toBe(101); const socket = response.webSocket!; socket.accept(); let closed = false; const messages: unknown[] = []; socket.addEventListener('close', () => { closed = true; }); socket.addEventListener('message', event => { messages.push(JSON.parse(String(event.data))); }); await new Promise(resolve => setTimeout(resolve, 30));
  try { expect(messages).toHaveLength(1); await env.AUTH_DB.prepare('UPDATE session SET expiresAt=? WHERE id=?').bind(new Date(Date.now() - 60000).toISOString(), a.session.id).run(); await runInDurableObject(env.ACCOUNTS.getByName(a.user.id), instance => { instance.apply({ protocolVersion: 1, operationId: crypto.randomUUID(), deviceId: 'socket-device', recordId: 'socket-event', petId: 'socket-pet', kind: 'event', baseRevision: 0, intent: 'create', patch: { type: 'pee', at: 100, source: 'app' } }); }); await new Promise(resolve => setTimeout(resolve, 30)); expect(messages).toHaveLength(1); expect(closed).toBe(true); } finally { socket.close(); }
});

for (const representation of ['iso', 'numeric'] as const) test(representation + ' future source creation rejects guarded callback without a new session', async () => {
  const a = await owner('google', true), flow = await begin(a), future = Date.now() + 60000;
  await env.AUTH_DB.prepare('UPDATE session SET createdAt=? WHERE id=?').bind(representation === 'iso' ? new Date(future).toISOString() : future, a.session.id).run(); const before = await snapshot(a); await reply(a);
  expect((await callback(flow, 'google')).location?.searchParams.get('error')).toBeTruthy(); expect(await snapshot(a)).toEqual(before);
});
test('future source creation cannot receive a reauth provider URL, and numeric live source remains compatible', async () => {
  const a = await owner(), future = new Date(Date.now() + 60000).toISOString(); await env.AUTH_DB.prepare('UPDATE session SET createdAt=? WHERE id=?').bind(future, a.session.id).run();
  const rejected = await call('auth/sign-in/social', { provider: 'google', callbackURL: base + '/account' }, { cookie: a.cookie, headers: { 'x-puptime-reauth': 'account-deletion', 'x-puptime-account': a.user.id } }); expect(rejected.status).toBe(409); expect(await rejected.json()).toEqual({ error: 'reauthentication_unavailable' });
  const now = Date.now(); await env.AUTH_DB.prepare('UPDATE session SET createdAt=?,expiresAt=? WHERE id=?').bind(now - 86400000, now + 86400000, a.session.id).run(); const flow = await begin(a), before = await snapshot(a); await reply(a); await success(a, await callback(flow, a.provider), before);
});
test('bounded receipts and cross-owner cancellation preserve a usable original owner', async () => {
  const a = await owner(), b = await owner(), flow = await begin(a);
  expect((await call('account/reauth/cancel', { intentId: flow.id }, { cookie: b.cookie, headers: { 'x-puptime-account': a.user.id } })).status).toBe(409);
  expect((await call('account/reauth/cancel', { intentId: flow.id }, { cookie: b.cookie, headers: { 'x-puptime-account': b.user.id } })).status).toBe(200); expect(await env.AUTH_DB.prepare('SELECT id FROM account_reauth_intents WHERE id=?').bind(flow.id).first()).not.toBeNull();
  for (let index = 0; index < 5; index++) await prepare(a);
  expect((await call('account/deletion/prepare', {}, { cookie: a.cookie, headers: { 'x-puptime-account': a.user.id } })).status).toBe(200);
  expect((await env.AUTH_DB.prepare('SELECT receipt_hash FROM account_deletion_receipts WHERE account_id=?').bind(a.user.id).all()).results).toHaveLength(5);
  // The backwards-compatible web confirmation reuses its owner's prepared
  // receipt, so reaching the preparation cap cannot prevent cloud deletion.
  expect((await remove(a)).status).toBe(200); expect((await snapshot(b)).users).toHaveLength(1);
});
test('invalid status input is also non-cacheable, and a receipt is not an SDK bearer session', async () => {
  const a = await owner(), receipt = await prepare(a), invalid = await status('invalid'); expect(invalid.status).toBe(400); expect(invalid.headers.get('cache-control')).toBe('no-store');
  const session = await call('auth/get-session', undefined, { headers: { authorization: 'Bearer ' + receipt.receipt } }); expect(await session.json()).toBeNull();
});

test('expired receipt and intent never strand a deleting original owner or auto-finalize after reauthentication', async () => {
  const a = await owner(), oldReceipt = await prepare(a);
  await env.AUTH_DB.exec("CREATE TRIGGER expired_recovery_failure BEFORE DELETE ON account BEGIN SELECT RAISE(ABORT,'synthetic-auth-cleanup-failure'); END;");
  try { expect((await remove(a, oldReceipt.receipt)).status).toBe(503); } finally { await env.AUTH_DB.exec('DROP TRIGGER expired_recovery_failure'); }
  expect(await env.AUTH_DB.prepare('SELECT state FROM cloud_accounts WHERE account_id=?').bind(a.user.id).first()).toEqual({ state: 'deleting' });
  await env.AUTH_DB.prepare('UPDATE account_deletion_receipts SET created_at=0,expires_at=1 WHERE receipt_hash=?').bind(await hashCapability(oldReceipt.receipt)).run();
  await env.AUTH_DB.prepare('UPDATE session SET createdAt=? WHERE id=?').bind(new Date(Date.now() - 86400000).toISOString(), a.session.id).run();
  const expiredFlow = await begin(a); await env.AUTH_DB.prepare('UPDATE account_reauth_intents SET created_at=0,expires_at=1 WHERE id=?').bind(expiredFlow.id).run(); await reply(a);
  expect((await callback(expiredFlow, a.provider)).location?.searchParams.get('error')).toBeTruthy(); expect(await (await status(oldReceipt.receipt)).json()).toEqual({ status: 'pending' });
  expect((await call('account/deletion/prepare', {}, { cookie: a.cookie, headers: { 'x-puptime-account': a.user.id } })).status).toBe(401);
  const newFlow = await begin(a), refreshed = await callback(newFlow, a.provider); expect(refreshed.location?.href).toBe(base + '/account'); const recovered = { ...a, cookie: cookies(refreshed.response) };
  expect((await call('account/export', undefined, { cookie: recovered.cookie })).status).toBe(410); expect((await call('cloud/trial', {}, { cookie: recovered.cookie })).status).toBe(410);
  const newReceipt = await prepare(recovered); expect(newReceipt.receipt).not.toBe(oldReceipt.receipt); expect(await (await status(newReceipt.receipt)).json()).toEqual({ status: 'not-started' }); expect((await snapshot(a)).users).toHaveLength(1);
  // Only the new explicit confirmation completes the interrupted deletion.
  expect((await remove(recovered, newReceipt.receipt)).status).toBe(200); expect(await (await status(newReceipt.receipt)).json()).toEqual({ status: 'deleted', appleRevocation: 'not-linked' });
});

test('five discarded preparation responses can be renewed into a usable durable receipt', async () => {
  const a = await owner(), before = await snapshot(a);
  for (let index = 0; index < 5; index++) { const discarded = await call('account/deletion/prepare', {}, { cookie: a.cookie, headers: { 'x-puptime-account': a.user.id } }); expect(discarded.status).toBe(200); await discarded.body?.cancel(); }
  const renewed = await prepare(a); expect(await (await status(renewed.receipt)).json()).toEqual({ status: 'not-started' }); expect(await snapshot(a)).toEqual(before);
  expect((await env.AUTH_DB.prepare('SELECT receipt_hash FROM account_deletion_receipts WHERE account_id=?').bind(a.user.id).all()).results).toHaveLength(5);
  // The native path still persists a returned receipt, then explicitly confirms
  // with that receipt. It never falls back to receipt-free deletion.
  expect((await remove(a, renewed.receipt)).status).toBe(200); expect(await (await status(renewed.receipt)).json()).toEqual({ status: 'deleted', appleRevocation: 'not-linked' });
});

test('renewal preserves started status proofs and active leases, while stale unstarted references fail closed', async () => {
  const a = await owner(), started = await prepare(a);
  await env.AUTH_DB.exec("CREATE TRIGGER renewal_cleanup_failure BEFORE DELETE ON account BEGIN SELECT RAISE(ABORT,'synthetic-renewal-cleanup-failure'); END;");
  try { expect((await remove(a, started.receipt)).status).toBe(503); } finally { await env.AUTH_DB.exec('DROP TRIGGER renewal_cleanup_failure'); }
  const hash = await hashCapability(started.receipt);
  await env.AUTH_DB.prepare("UPDATE account_deletion_receipts SET attempt_id='interrupted',attempt_until=? WHERE receipt_hash=?").bind(Date.now() + 60000, hash).run();
  const startedBefore = await env.AUTH_DB.prepare('SELECT * FROM account_deletion_receipts WHERE receipt_hash=?').bind(hash).first(), original = await snapshot(a), firstUnused = await prepare(a);
  let latest = firstUnused;
  for (let index = 0; index < 8; index++) latest = await prepare(a);
  expect(await env.AUTH_DB.prepare('SELECT * FROM account_deletion_receipts WHERE receipt_hash=?').bind(hash).first()).toEqual(startedBefore); expect(await (await status(started.receipt)).json()).toEqual({ status: 'pending' });
  expect(await (await status(firstUnused.receipt)).json()).toEqual({ status: 'unknown' }); expect((await remove(a, firstUnused.receipt)).status).toBe(409); expect((await remove(a, latest.receipt)).status).toBe(409);
  expect((await env.AUTH_DB.prepare('SELECT receipt_hash FROM account_deletion_receipts WHERE account_id=?').bind(a.user.id).all()).results).toHaveLength(5); expect(await snapshot(a)).toEqual(original);
  await env.AUTH_DB.prepare('UPDATE account_deletion_receipts SET attempt_id=NULL,attempt_until=NULL WHERE receipt_hash=?').bind(hash).run();
  expect((await remove(a, latest.receipt)).status).toBe(200); expect(await (await status(started.receipt)).json()).toEqual({ status: 'deleted', appleRevocation: 'not-linked' });
});
test('concurrent preparation renewal retains at most five references without replacing started work or another owner', async () => {
  const a = await owner(), b = await owner(), otherReceipt = await prepare(b), other = await snapshot(b);
  const responses = await Promise.all(Array.from({ length: 8 }, () => prepare(a)));
  const rows = (await env.AUTH_DB.prepare('SELECT * FROM account_deletion_receipts WHERE account_id=?').bind(a.user.id).all()).results; expect(rows).toHaveLength(5); expect(rows.every(row => row.phase === 'prepared')).toBe(true);
  const states = await Promise.all(responses.map(async receipt => (await (await status(receipt.receipt)).json<{ status: string }>()).status)); expect(states.filter(value => value === 'not-started')).toHaveLength(5); expect(states.filter(value => value === 'unknown')).toHaveLength(3);
  expect(await snapshot(b)).toEqual(other); expect(await (await status(otherReceipt.receipt)).json()).toEqual({ status: 'not-started' });
  const usable = responses[states.indexOf('not-started')]; expect((await remove(a, usable.receipt)).status).toBe(200);
});
test('failed replacement insertion atomically restores all existing unstarted references', async () => {
  const a = await owner(), receipts = []; for (let index = 0; index < 5; index++) receipts.push(await prepare(a));
  const before = (await env.AUTH_DB.prepare('SELECT * FROM account_deletion_receipts WHERE account_id=? ORDER BY receipt_hash').bind(a.user.id).all()).results;
  await env.AUTH_DB.exec("CREATE TRIGGER renewal_insert_failure BEFORE INSERT ON account_deletion_receipts BEGIN SELECT RAISE(ABORT,'synthetic-renewal-insert-failure'); END;");
  try { expect((await call('account/deletion/prepare', {}, { cookie: a.cookie, headers: { 'x-puptime-account': a.user.id } })).status).toBe(503); } finally { await env.AUTH_DB.exec('DROP TRIGGER renewal_insert_failure'); }
  expect((await env.AUTH_DB.prepare('SELECT * FROM account_deletion_receipts WHERE account_id=? ORDER BY receipt_hash').bind(a.user.id).all()).results).toEqual(before);
  for (const receipt of receipts) expect(await (await status(receipt.receipt)).json()).toEqual({ status: 'not-started' });
});
test('renewal never evicts any of five already-started proofs to free capacity', async () => {
  const a = await owner(), receipts = [];
  const interrupted = { ...settings, ACCOUNTS: { idFromName: env.ACCOUNTS.idFromName.bind(env.ACCOUNTS), get: () => ({ retire: async () => { throw new Error('synthetic-renewal-content-failure'); } }) } } as unknown as Cloudflare.Env;
  for (let index = 0; index < 5; index++) { const receipt = await prepare(a); receipts.push(receipt); expect((await remove(a, receipt.receipt, { env: interrupted })).status).toBe(503); }
  const before = (await env.AUTH_DB.prepare('SELECT * FROM account_deletion_receipts WHERE account_id=? ORDER BY receipt_hash').bind(a.user.id).all()).results;
  expect((await call('account/deletion/prepare', {}, { cookie: a.cookie, headers: { 'x-puptime-account': a.user.id } })).status).toBe(429); expect((await env.AUTH_DB.prepare('SELECT * FROM account_deletion_receipts WHERE account_id=? ORDER BY receipt_hash').bind(a.user.id).all()).results).toEqual(before);
  for (const receipt of receipts) expect(await (await status(receipt.receipt)).json()).toEqual({ status: 'pending' });
  expect((await remove(a, receipts[0].receipt)).status).toBe(200);
});

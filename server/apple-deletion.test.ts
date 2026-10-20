import { env } from 'cloudflare:workers';
import { applyD1Migrations, runInDurableObject } from 'cloudflare:test';
import { afterEach, beforeAll, expect, inject, test, vi } from 'vitest';
import { generateKeyPair, SignJWT } from 'jose';
import worker from './index';

const origin = 'https://puptime.test';
const settings = { ...env, ENVIRONMENT: 'local' as const, AUTH_BASE_URL: origin, WEB_ORIGINS: origin, AUTH_SECRET: 'apple-deletion-test-secret-at-least-32-characters', APPLE_CLIENT_ID: 'com.puptime.test.web', APPLE_CLIENT_SECRET: 'synthetic-apple-secret' };
let address = 0;
beforeAll(() => applyD1Migrations(env.AUTH_DB, inject('migrations')));
afterEach(() => vi.restoreAllMocks());

async function owner() {
  const email = `delete-${crypto.randomUUID()}@example.invalid`, ip = `203.0.113.${++address}`;
  const post = (path: string, body: object) => worker.fetch(new Request(origin + '/api/auth/' + path, { method: 'POST', headers: { origin, 'cf-connecting-ip': ip, 'content-type': 'application/json' }, body: JSON.stringify(body) }), settings);
  expect((await post('email-otp/send-verification-otp', { email, type: 'sign-in' })).status).toBe(200);
  const preview = await env.AUTH_DB.prepare('SELECT code FROM local_email_previews WHERE email=?').bind(email).first<{ code: string }>();
  const response = await post('sign-in/email-otp', { email, otp: preview!.code });
  expect(response.status).toBe(200);
  const cookie = response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  const { user } = await response.json<{ user: { id: string } }>();
  return { id: user.id, email, ip, cookie };
}
type Owner = Awaited<ReturnType<typeof owner>>;
async function credential(user: Owner, refreshToken: string | null = 'synthetic-refresh', accessToken: string | null = 'synthetic-access') {
  const id = crypto.randomUUID();
  await env.AUTH_DB.prepare('INSERT INTO account(id,accountId,providerId,userId,refreshToken,accessToken,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?)').bind(id, id, 'apple', user.id, refreshToken, accessToken, Date.now(), Date.now()).run();
  return id;
}
function remove(user: Owner, options: Cloudflare.Env = settings) {
  return worker.fetch(new Request(origin + '/api/account', { method: 'DELETE', headers: { origin, cookie: user.cookie, 'cf-connecting-ip': user.ip, 'content-type': 'application/json', 'x-puptime-account': user.id }, body: '{"confirm":true}' }), options);
}
async function removed(user: Owner) {
  for (const table of ['user', 'session', 'account']) {
    expect(await env.AUTH_DB.prepare(`SELECT id FROM ${table} WHERE ${table === 'user' ? 'id' : 'userId'}=?`).bind(user.id).first()).toBeNull();
  }
}

test('Apple deletion revokes the refresh token before removing identity and keeps SDK clearing cookies', async () => {
  const user = await owner(); await credential(user);
  const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    expect(String(input)).toBe('https://appleid.apple.com/auth/revoke');
    expect(init?.method).toBe('POST'); expect(init?.redirect).toBe('error'); expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(new Headers(init?.headers).get('content-type')).toBe('application/x-www-form-urlencoded');
    expect(Object.fromEntries(new URLSearchParams(String(init?.body)))).toEqual({ client_id: settings.APPLE_CLIENT_ID, client_secret: settings.APPLE_CLIENT_SECRET, token: 'synthetic-refresh', token_type_hint: 'refresh_token' });
    expect(await env.AUTH_DB.prepare('SELECT state FROM cloud_accounts WHERE account_id=?').bind(user.id).first()).toEqual({ state: 'deleting' });
    expect(await env.AUTH_DB.prepare('SELECT id FROM user WHERE id=?').bind(user.id).first()).not.toBeNull();
    return new Response(null, { status: 200 });
  });
  const response = await remove(user);
  expect(response.status).toBe(200); expect(await response.json()).toEqual({ success: true, message: 'User deleted', appleRevocation: 'revoked' });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(response.headers.getSetCookie().some(cookie => cookie.includes('session_token=;') && cookie.includes('Max-Age=0'))).toBe(true);
  await removed(user);
});

test.each(['access-only', 'missing-token', 'missing-config', 'network', 'non-200', 'timeout'] as const)('Apple deletion %s reports the actual revocation outcome without retaining app data', async scenario => {
  const user = await owner(); await credential(user, scenario === 'access-only' || scenario === 'missing-token' ? null : 'synthetic-refresh', scenario === 'missing-token' ? null : 'synthetic-access');
  if (scenario === 'network') {
    const post = (path: string, body: object) => worker.fetch(new Request(origin + '/api/' + path, { method: 'POST', headers: { origin, cookie: user.cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) }), settings);
    expect((await post('cloud/trial', {})).status).toBe(200);
    expect((await post('cloud/enroll', { operationId: crypto.randomUUID(), deviceId: 'synthetic-device', localPetId: 'synthetic-pet', name: 'Synthetic puppy' })).status).toBe(200);
    const exported = await worker.fetch(new Request(origin + '/api/account/export', { headers: { origin, cookie: user.cookie } }), settings);
    expect(new TextDecoder().decode(await exported.arrayBuffer())).toContain('Synthetic puppy');
  }
  const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
    if (scenario === 'access-only') expect(new URLSearchParams(String(init?.body)).get('token_type_hint')).toBe('access_token');
    if (scenario === 'network') throw new TypeError('synthetic connection failure');
    if (scenario === 'timeout') throw new DOMException('Synthetic timeout', 'TimeoutError');
    return new Response(scenario === 'non-200' ? 'synthetic provider error must not be returned' : null, { status: scenario === 'non-200' ? 400 : 200 });
  });
  const response = await remove(user, scenario === 'missing-config' ? { ...settings, APPLE_CLIENT_SECRET: undefined } : settings);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ success: true, message: 'User deleted', appleRevocation: scenario === 'access-only' ? 'revoked' : 'manual' });
  expect(fetcher).toHaveBeenCalledTimes(scenario === 'missing-token' || scenario === 'missing-config' ? 0 : 1);
  await removed(user);
  if (scenario === 'network') {
    const object = env.ACCOUNTS.get(env.ACCOUNTS.idFromName(user.id));
    await runInDurableObject(object, (instance, state) => {
      expect(() => instance.summary()).toThrow('deleted');
      for (const table of ['records', 'revisions', 'operations', 'pets', 'enrollments', 'enrolled_devices']) {
        expect(state.storage.sql.exec<{ count: number }>(`SELECT COUNT(*) AS count FROM ${table}`).one().count).toBe(0);
      }
    });
  }
});

test('an owner without Apple has no upstream revocation request', async () => {
  const user = await owner(), fetcher = vi.spyOn(globalThis, 'fetch');
  const response = await remove(user); expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ success: true, message: 'User deleted', appleRevocation: 'not-linked' });
  expect(fetcher).not.toHaveBeenCalled(); await removed(user);
});

test('deleting-owner credential writes are fenced for both old and new owners while other owners remain usable', async () => {
  const a = await owner(), b = await owner(), aid = await credential(a), bid = await credential(b);
  await env.AUTH_DB.prepare("INSERT INTO cloud_accounts(account_id,state) VALUES (?,'deleting')").bind(a.id).run();
  await expect(credential(a)).rejects.toThrow('account_deleting');
  for (const [id, userId] of [[aid, a.id], [aid, b.id], [bid, a.id]]) {
    await expect(env.AUTH_DB.prepare('UPDATE account SET userId=?,refreshToken=? WHERE id=?').bind(userId, 'synthetic-new-refresh', id).run()).rejects.toThrow('account_deleting');
  }
  await env.AUTH_DB.prepare('UPDATE account SET refreshToken=? WHERE id=?').bind('synthetic-other-owner-refresh', bid).run();
  expect((await env.AUTH_DB.prepare('SELECT refreshToken FROM account WHERE id=?').bind(aid).first<{ refreshToken: string }>())!.refreshToken).toBe('synthetic-refresh');
});

test('a cleanup failure retains credentials and the original session so an already-revoked Apple token can be retried', async () => {
  const user = await owner(); await credential(user);
  const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));
  // Only inject a content-store failure; auth, D1, hooks and deletion are real.
  const interrupted = { ...settings, ACCOUNTS: { idFromName: env.ACCOUNTS.idFromName.bind(env.ACCOUNTS), get: () => ({ retire: async () => { throw new Error('Synthetic content cleanup failure'); } }) } } as unknown as Cloudflare.Env;
  expect((await remove(user, interrupted)).status).toBe(503);
  expect(await env.AUTH_DB.prepare('SELECT id FROM user WHERE id=?').bind(user.id).first()).not.toBeNull();
  expect(await env.AUTH_DB.prepare('SELECT id FROM session WHERE userId=?').bind(user.id).first()).not.toBeNull();
  expect((await env.AUTH_DB.prepare('SELECT refreshToken FROM account WHERE userId=?').bind(user.id).first<{ refreshToken: string }>())!.refreshToken).toBe('synthetic-refresh');
  const response = await remove(user); expect(response.status).toBe(200);
  expect((await response.json<{ appleRevocation: string }>()).appleRevocation).toBe('revoked');
  expect(fetcher).toHaveBeenCalledTimes(2); await removed(user);
});

test('an Apple link callback already exchanging its code cannot replace credentials after deletion snapshots them', async () => {
  const user = await owner(), subject = await credential(user);
  const started = await worker.fetch(new Request(origin + '/api/auth/link-social', { method: 'POST', headers: { origin, cookie: user.cookie, 'cf-connecting-ip': user.ip, 'content-type': 'application/json' }, body: JSON.stringify({ provider: 'apple', callbackURL: origin + '/account', errorCallbackURL: origin + '/account', disableRedirect: true }) }), settings);
  expect(started.status).toBe(200);
  const url = new URL((await started.json<{ url: string }>()).url);
  const cookie = [user.cookie, ...started.headers.getSetCookie().map(value => value.split(';')[0])].join('; ');
  const { privateKey } = await generateKeyPair('RS256');
  const idToken = await new SignJWT({ email: user.email, email_verified: true }).setProtectedHeader({ alg: 'RS256' }).setSubject(subject).setIssuer('https://appleid.apple.com').setAudience(settings.APPLE_CLIENT_ID).setIssuedAt().setExpirationTime('5m').sign(privateKey);
  let tokenEntered!: () => void, releaseToken!: () => void, revokeEntered!: () => void, releaseRevoke!: () => void;
  const tokenStarted = new Promise<void>(resolve => { tokenEntered = resolve; }), tokenGate = new Promise<void>(resolve => { releaseToken = resolve; });
  const revokeStarted = new Promise<void>(resolve => { revokeEntered = resolve; }), revokeGate = new Promise<void>(resolve => { releaseRevoke = resolve; });
  vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    if (String(input) === 'https://appleid.apple.com/auth/token') {
      tokenEntered(); await tokenGate;
      return Response.json({ access_token: 'synthetic-new-access', refresh_token: 'synthetic-new-refresh', id_token: idToken, token_type: 'Bearer', expires_in: 300 });
    }
    expect(String(input)).toBe('https://appleid.apple.com/auth/revoke'); revokeEntered(); await revokeGate;
    return new Response(null, { status: 200 });
  });
  // This is the normalized GET after Apple's form-post redirect. The real SDK
  // issued/validates state and consumes the mocked provider token response.
  const callback = worker.fetch(new Request(origin + '/api/auth/callback/apple?' + new URLSearchParams({ code: 'synthetic-code', state: url.searchParams.get('state')! }), { headers: { origin, cookie, 'cf-connecting-ip': user.ip } }), settings);
  await tokenStarted;
  const deletion = remove(user); await revokeStarted;
  try {
    releaseToken(); const response = await callback;
    expect(response.status === 302 && response.headers.get('location') === origin + '/account').toBe(false);
    expect((await env.AUTH_DB.prepare('SELECT refreshToken FROM account WHERE id=?').bind(subject).first<{ refreshToken: string }>())!.refreshToken).toBe('synthetic-refresh');
  } finally { releaseToken(); releaseRevoke(); }
  expect((await deletion).status).toBe(200); await removed(user);
});

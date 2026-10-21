import { env } from 'cloudflare:workers';
import { applyD1Migrations } from 'cloudflare:test';
import { beforeAll, expect, inject, test } from 'vitest';
import worker from './index';
import { createAuth } from './auth';

beforeAll(() => applyD1Migrations(env.AUTH_DB, inject('migrations')));
const settings = { ...env, ENVIRONMENT: 'local' as const, AUTH_BASE_URL: 'https://puptime.test', WEB_ORIGINS: 'https://puptime.test', AUTH_SECRET: 'local-test-secret-with-at-least-32-characters' };
type Owner = { cookie: string; id: string; sessionId: string; ip: string };
type Key = { apiKey: { id: string; name: string; scopes: string[]; createdAt: string; expiresAt: string }; key: string };
let client = 130;
function call(path: string, { owner, key, method = 'GET', body, headers = {} }: { owner?: Owner; key?: string; method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  return worker.fetch(new Request(`https://puptime.test${path}`, {
    method, headers: { origin: settings.AUTH_BASE_URL, 'cf-connecting-ip': owner?.ip ?? '192.0.2.253', ...(owner ? { cookie: owner.cookie } : {}), ...(key ? { authorization: `Bearer ${key}` } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), settings);
}
async function owner(): Promise<Owner> {
  const ip = `192.0.2.${client++}`, email = `api-key-${crypto.randomUUID()}@example.invalid`;
  expect((await call('/api/auth/email-otp/send-verification-otp', { method: 'POST', body: { email, type: 'sign-in' }, headers: { 'cf-connecting-ip': ip } })).status).toBe(200);
  const preview = await env.AUTH_DB.prepare('SELECT code FROM local_email_previews WHERE email=?').bind(email).first<{ code: string }>();
  const response = await call('/api/auth/sign-in/email-otp', { method: 'POST', body: { email, otp: preview!.code }, headers: { 'cf-connecting-ip': ip } });
  expect(response.status).toBe(200);
  const cookie = response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  const session = await createAuth(settings).api.getSession({ headers: new Headers({ cookie }) });
  return { id: session!.user.id, cookie, sessionId: session!.session.id, ip };
}
async function key(user: Owner, scopes = ['read']): Promise<Key> {
  const response = await call('/api/v1/api-keys', { owner: user, method: 'POST', body: { name: 'My integration', scopes } });
  expect(response.status).toBe(201);
  expect(response.headers.get('cache-control')).toBe('no-store');
  return response.json<Key>();
}

test('session-created keys are hashed, explicitly scoped, expiring and disclosed only once', async () => {
  const user = await owner(), created = await key(user);
  expect(created.key).toMatch(/^puptime_[A-Za-z0-9_-]+$/);
  expect(created.apiKey.id).toMatch(/^key_[a-f0-9]{32}$/);
  expect(created.apiKey.scopes).toEqual(['read']);
  expect(new Date(created.apiKey.expiresAt).getTime() - new Date(created.apiKey.createdAt).getTime()).toBeGreaterThan(89 * 86400000);
  const row = await env.AUTH_DB.prepare('SELECT key, rateLimitEnabled, rateLimitMax, rateLimitTimeWindow FROM apikey WHERE id=?').bind(created.apiKey.id).first<{ key: string; rateLimitEnabled: number; rateLimitMax: number; rateLimitTimeWindow: number }>();
  expect(row!.key).not.toBe(created.key);
  expect(row).toMatchObject({ rateLimitEnabled: 1, rateLimitMax: 60, rateLimitTimeWindow: 60000 });
  const list = await call('/api/v1/api-keys?limit=1&offset=0', { owner: user });
  expect(list.status).toBe(200);
  const listed = await list.text();
  expect(listed).not.toContain(created.key);
  expect(listed).not.toContain(row!.key);
  expect(JSON.parse(listed)).toMatchObject({ items: [{ id: created.apiKey.id, scopes: ['read'] }], total: 1, limit: 1, offset: 0 });
  expect((await call('/api/v1/account', { key: created.key })).status).toBe(200);
  expect((await call('/api/v1/puppies', { key: created.key, method: 'POST', body: { name: 'Not allowed' }, headers: { 'idempotency-key': 'read-only-cannot-write' } })).status).toBe(403);
  expect((await call('/api/v1/export', { key: created.key })).status).toBe(403);
  expect((await call('/api/v1/api-keys', { key: created.key })).status).toBe(403);
  expect((await call('/api/v1/api-keys', { key: created.key, method: 'POST', body: { name: 'Elevated', scopes: ['write', 'export'] } })).status).toBe(403);
  expect((await call('/api/account', { key: created.key })).status).toBe(401);
  expect((await call('/api/sync/pull?after=0', { key: created.key })).status).toBe(401);
  expect((await call('/api/account', { key: created.key, method: 'DELETE', body: { confirm: true } })).status).toBe(401);
});

test('Bearer credentials take precedence over cookies and never fall back to a privileged session', async () => {
  const user = await owner(), readOnly = await key(user);
  const invalid = await call('/api/v1/account', { owner: user, key: 'puptime_invalid' });
  expect(invalid.status).toBe(401);
  expect(await invalid.json()).toMatchObject({ error: { code: 'invalid_api_key', requestId: expect.stringMatching(/^req_/) } });
  const denied = await call('/api/v1/puppies', { owner: user, key: readOnly.key, method: 'POST', body: { name: 'Still not allowed' }, headers: { 'idempotency-key': 'mixed-credential-denied' } });
  expect(denied.status).toBe(403);
  expect((await call('/api/v1/account', { owner: user, headers: { authorization: 'Basic ignored' } })).status).toBe(401);
  expect((await call('/api/v1/account', { headers: { 'x-api-key': readOnly.key } })).status).toBe(401);
});

test('write and export are separate permissions, and account ownership comes from the key', async () => {
  const first = await owner(), other = await owner(), writer = await key(first, ['write']), reader = await key(first), exporter = await key(first, ['export']);
  const created = await call('/api/v1/puppies', { owner: other, key: writer.key, method: 'POST', body: { name: 'Integration puppy' }, headers: { 'idempotency-key': 'api-auth-owned-puppy' } });
  expect(created.status).toBe(201);
  const firstSummary = await (await call('/api/v1/account', { key: reader.key })).json<{ user: { id: string }; pets: { name: string }[] }>();
  expect(firstSummary.user.id).toBe(first.id);
  expect(firstSummary.pets).toEqual([expect.objectContaining({ name: 'Integration puppy' })]);
  expect((await (await call('/api/v1/account', { owner: other })).json<{ pets: unknown[] }>()).pets).toEqual([]);
  expect((await call('/api/v1/account', { key: writer.key })).status).toBe(403);
  expect((await call('/api/v1/export', { key: writer.key })).status).toBe(403);
  const exported = await call('/api/v1/export', { key: exporter.key });
  expect(exported.status).toBe(200);
  expect(exported.headers.get('content-type')).toContain('application/x-ndjson');
  expect(new TextDecoder().decode(await exported.arrayBuffer())).toContain('Integration puppy');
});

test('revocation and expiry reject new requests, with no cross-account key management', async () => {
  const user = await owner(), other = await owner(), created = await key(user);
  const foreignList = await (await call('/api/v1/api-keys', { owner: other })).json<{ items: unknown[] }>();
  expect(foreignList.items).toEqual([]);
  expect((await call(`/api/v1/api-keys/${created.apiKey.id}`, { owner: other, method: 'DELETE' })).status).toBe(404);
  expect((await call('/api/v1/account', { key: created.key })).status).toBe(200);
  expect((await call(`/api/v1/api-keys/${created.apiKey.id}`, { owner: user, method: 'DELETE' })).status).toBe(204);
  expect((await call('/api/v1/account', { key: created.key })).status).toBe(401);
  const expiring = await key(user);
  await env.AUTH_DB.prepare('UPDATE apikey SET expiresAt=? WHERE id=?').bind(Date.now() - 1000, expiring.apiKey.id).run();
  expect((await call('/api/v1/account', { key: expiring.key })).status).toBe(401);
});

test('key creation rejects stale authentication, extra authority, unsafe expiry and cross-site cookies', async () => {
  const user = await owner();
  for (const body of [
    { name: 'Empty', scopes: [] }, { name: 'Admin', scopes: ['admin'] }, { name: 'No expiry', scopes: ['read'], expiresInDays: null },
    { name: 'Too long', scopes: ['read'], expiresInDays: 366 }, { name: 'Duplicate', scopes: ['read', 'read'] },
    { name: 'Wrong owner', scopes: ['read'], userId: 'usr_other' }, { name: 'Bypass limit', scopes: ['read'], rateLimitEnabled: false },
  ]) expect((await call('/api/v1/api-keys', { owner: user, method: 'POST', body })).status).toBe(400);
  expect((await call('/api/v1/api-keys?limit=101', { owner: user })).status).toBe(400);
  expect((await call('/api/v1/api-keys?offset=-1', { owner: user })).status).toBe(400);
  expect((await call('/api/v1/api-keys', { owner: user, method: 'POST', body: { name: 'CSRF', scopes: ['read'] }, headers: { origin: 'https://untrusted.example' } })).status).toBe(403);
  expect((await call('/api/v1/api-keys', { owner: user, method: 'POST', body: { name: 'CSRF', scopes: ['read'] }, headers: { origin: '', 'sec-fetch-site': 'cross-site' } })).status).toBe(403);
  await env.AUTH_DB.prepare('UPDATE session SET createdAt=? WHERE id=?').bind(Date.now() - 660000, user.sessionId).run();
  const stale = await call('/api/v1/api-keys', { owner: user, method: 'POST', body: { name: 'Stale session', scopes: ['read'] } });
  expect(stale.status).toBe(401);
  expect(await stale.json()).toMatchObject({ error: { code: 'reauthentication_required' } });
});

test('direct Better Auth key endpoints cannot bypass the versioned policy', async () => {
  const user = await owner();
  for (const [path, method] of [['create', 'POST'], ['get', 'GET'], ['list', 'GET'], ['update', 'POST'], ['delete', 'POST'], ['verify', 'POST'], ['delete-all-expired-api-keys', 'POST']]) {
    const response = await call(`/api/auth/api-key/${path}`, { owner: user, method, ...(method === 'POST' ? { body: { name: 'Bypass', expiresIn: null } } : {}) });
    expect(response.status).toBe(404);
  }
  expect(await env.AUTH_DB.prepare('SELECT COUNT(*) AS count FROM apikey WHERE referenceId=?').bind(user.id).first()).toEqual({ count: 0 });
});

test('key rate limits reject concurrent overuse and expose a retry delay', async () => {
  const user = await owner(), created = await key(user);
  await env.AUTH_DB.prepare('UPDATE apikey SET rateLimitMax=2 WHERE id=?').bind(created.apiKey.id).run();
  const responses = await Promise.all(Array.from({ length: 4 }, () => call('/api/v1/account', { key: created.key })));
  expect(responses.filter(response => response.status === 200)).toHaveLength(2);
  for (const response of responses.filter(response => response.status !== 200)) {
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('60');
    expect(await response.json()).toMatchObject({ error: { code: 'rate_limited' } });
  }
});

test('deletion fences existing keys, blocks creation, and removes all credentials with the identity', async () => {
  const user = await owner(), created = await key(user);
  await env.AUTH_DB.prepare("INSERT INTO cloud_accounts(account_id,state) VALUES (?,'deleting')").bind(user.id).run();
  expect((await call('/api/v1/account', { key: created.key })).status).toBe(410);
  expect((await call('/api/v1/api-keys', { owner: user, method: 'POST', body: { name: 'During deletion', scopes: ['read'] } })).status).toBe(410);
  await expect(createAuth(settings).api.createApiKey({ body: { userId: user.id, name: 'Concurrent creation', permissions: { puptime: ['read'] } } })).rejects.toBeDefined();
  await env.AUTH_DB.prepare('DELETE FROM user WHERE id=?').bind(user.id).run();
  expect(await env.AUTH_DB.prepare('SELECT COUNT(*) AS count FROM apikey WHERE referenceId=?').bind(user.id).first()).toEqual({ count: 0 });
  expect((await call('/api/v1/account', { key: created.key })).status).toBe(401);
});

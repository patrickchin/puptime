import { env } from 'cloudflare:workers';
import { beforeAll, expect, inject, test } from 'vitest';
import { applyD1Migrations } from 'cloudflare:test';
import worker from './index';
beforeAll(() => applyD1Migrations(env.AUTH_DB, inject('migrations')));

test('public configuration exposes provider availability without credentials or finalized prices', async () => {
  const response = await worker.fetch(new Request('https://puptime.test/api/config'), env);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ protocolVersion: 1, providers: { apple: false, google: false, email: false } });
});

test('account access requires authentication and cannot select another user by URL', async () => {
  expect((await worker.fetch(new Request('https://puptime.test/api/account'), env)).status).toBe(401);
  expect((await worker.fetch(new Request('https://puptime.test/api/accounts/other/pull'), env)).status).toBe(404);
});

test('oversized account requests are rejected before processing', async () => {
  const body = JSON.stringify({ email: 'large@example.com', otp: 'x'.repeat(65536) });
  const response = await worker.fetch(new Request('https://puptime.test/api/auth/sign-in/email-otp', {
    method: 'POST', headers: { 'content-type': 'application/json', 'content-length': String(body.length) }, body,
  }), env);
  expect(response.status).toBe(413);
});


test('HTTP sign-in reaches the authenticated account route without exposing session credentials', async () => {
  const local = { ...env, ENVIRONMENT: 'local' as const, AUTH_BASE_URL: 'https://puptime.test', AUTH_SECRET: 'local-test-secret-with-at-least-32-characters' };
  const email = 'http-signin@example.com';
  const post = (path: string, body: object) => new Request(`https://puptime.test/api/auth/${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://puptime.test', 'cf-connecting-ip': '192.0.2.200' }, body: JSON.stringify(body),
  });
  expect((await worker.fetch(post('email-otp/send-verification-otp', { email, type: 'sign-in' }), local)).status).toBe(200);
  const preview = await env.AUTH_DB.prepare('SELECT code FROM local_email_previews WHERE email = ?').bind(email).first<{ code: string }>();
  const signIn = await worker.fetch(post('sign-in/email-otp', { email, otp: preview!.code }), local);
  expect(signIn.status).toBe(200);
  const cookie = signIn.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
  const account = await worker.fetch(new Request('https://puptime.test/api/account', { headers: { cookie } }), local);
  expect(account.status).toBe(200);
  const result = await account.json<{ user: unknown }>();
  expect(result.user).toEqual({ id: expect.any(String), email, name: expect.any(String) });
  expect(JSON.stringify(result)).not.toContain('session_token');
});

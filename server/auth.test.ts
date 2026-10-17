import { env } from 'cloudflare:workers';
import { beforeAll, expect, inject, test } from 'vitest';
import { applyD1Migrations } from 'cloudflare:test';
import { createAuth, configuredProviders } from './auth';

const settings = { ...env, ENVIRONMENT: 'local' as const, AUTH_BASE_URL: 'https://puptime.test', WEB_ORIGINS: 'https://puptime.test', AUTH_SECRET: 'local-test-secret-with-at-least-32-characters' };
const clients = new Map<string, string>();
function request(path: string, body?: object, cookie?: string) {
  const email = body && 'email' in body ? String(body.email) : 'default';
  if (!clients.has(email)) clients.set(email, `192.0.2.${clients.size + 1}`);
  return new Request(`https://puptime.test/api/auth/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'cf-connecting-ip': clients.get(email)!, origin: 'https://puptime.test', ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
beforeAll(async () => {
  await applyD1Migrations(env.AUTH_DB, inject('migrations'));
});

test('only configured sign-in methods are advertised', () => {
  expect(configuredProviders(settings)).toEqual({ apple: false, google: false, email: true });
  expect(configuredProviders({ ...settings, ENVIRONMENT: 'production' })).toEqual({ apple: false, google: false, email: false });
  expect(configuredProviders({ ...settings, ENVIRONMENT: 'production', RESEND_API_KEY: 'not-a-real-key', EMAIL_FROM: 'signin@harpapro.com' }).email).toBe(false);
});

test('real OTP flow creates an authenticated session and consumes the code once', async () => {
  const auth = createAuth(settings);
  const email = 'otp-success@example.com';
  const send = await auth.handler(request('email-otp/send-verification-otp', { email, type: 'sign-in' }));
  expect(send.status).toBe(200);
  expect(await send.text()).not.toMatch(/\d{6}/);
  const preview = await env.AUTH_DB.prepare('SELECT code FROM local_email_previews WHERE email = ? ORDER BY expires_at DESC').bind(email).first<{ code: string }>();
  expect(preview?.code).toMatch(/^\d{6}$/);
  const signIn = await auth.handler(request('sign-in/email-otp', { email, otp: preview!.code }));
  expect(signIn.status).toBe(200);
  const cookie = signIn.headers.getSetCookie().map((item) => item.split(';')[0]).join('; ');
  expect(cookie).toContain('session_token=');
  const session = await auth.api.getSession({ headers: new Headers({ cookie }) });
  expect(session?.user.email).toBe(email);
  const repeat = await auth.handler(request('sign-in/email-otp', { email, otp: preview!.code }));
  expect(repeat.status).toBe(400);
  const signOut = await auth.handler(request('sign-out', {}, cookie));
  expect(signOut.status).toBe(200);
  expect(await auth.api.getSession({ headers: new Headers({ cookie }) })).toBeNull();
});

test('incorrect codes fail without creating a session or leaking a valid code', async () => {
  const auth = createAuth(settings);
  const email = 'otp-wrong@example.com';
  await auth.handler(request('email-otp/send-verification-otp', { email, type: 'sign-in' }));
  const preview = await env.AUTH_DB.prepare('SELECT code FROM local_email_previews WHERE email = ?').bind(email).first<{ code: string }>();
  const wrong = preview!.code === '000000' ? '000001' : '000000';
  const response = await auth.handler(request('sign-in/email-otp', { email, otp: wrong }));
  expect(response.status).toBe(400);
  expect(await response.text()).not.toContain(preview!.code);
  expect(response.headers.get('set-cookie')).toBeNull();
});

test('production missing a sender fails without local email previews or code disclosure', async () => {
  const auth = createAuth({ ...settings, ENVIRONMENT: 'production' });
  const response = await auth.handler(request('email-otp/send-verification-otp', { email: 'production-missing@example.com', type: 'sign-in' }));
  expect(response.status).toBe(503);
  expect(await response.text()).not.toMatch(/\d{6}/);
  const count = await env.AUTH_DB.prepare('SELECT COUNT(*) AS count FROM local_email_previews WHERE email = ?').bind('production-missing@example.com').first<{ count: number }>();
  expect(count?.count).toBe(0);
});

test('untrusted browser origins cannot initiate sign-in', async () => {
  const auth = createAuth(settings);
  const response = await auth.handler(new Request('https://puptime.test/api/auth/email-otp/send-verification-otp', {
    method: 'POST', headers: { 'cf-connecting-ip': '192.0.2.99', origin: 'https://untrusted.example', 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'origin@example.com', type: 'sign-in' }),
  }));
  expect(response.status).toBe(403);
});

test('an expired code cannot create a session', async () => {
  const auth = createAuth(settings);
  const email = 'otp-expired@example.com';
  await auth.handler(request('email-otp/send-verification-otp', { email, type: 'sign-in' }));
  const preview = await env.AUTH_DB.prepare('SELECT code FROM local_email_previews WHERE email = ?').bind(email).first<{ code: string }>();
  // Expire only this synthetic challenge in the real identity database.
  await env.AUTH_DB.prepare('UPDATE verification SET expiresAt = 0 WHERE identifier LIKE ?').bind(`%${email}%`).run();
  const response = await auth.handler(request('sign-in/email-otp', { email, otp: preview!.code }));
  expect(response.status).toBe(400);
  expect(response.headers.get('set-cookie')).toBeNull();
});

test('public library deletion routes cannot bypass explicit account confirmation', async () => {
  const auth = createAuth(settings);
  const email = 'delete-confirmation@example.com';
  await auth.handler(request('email-otp/send-verification-otp', { email, type: 'sign-in' }));
  const preview = await env.AUTH_DB.prepare('SELECT code FROM local_email_previews WHERE email = ?').bind(email).first<{ code: string }>();
  const login = await auth.handler(request('sign-in/email-otp', { email, otp: preview!.code }));
  const cookie = login.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
  const response = await auth.handler(request('delete-user', {}, cookie));
  expect(response.status).toBe(404);
  expect(await auth.api.getSession({ headers: new Headers({ cookie }) })).not.toBeNull();
});

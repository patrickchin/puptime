import { env } from 'cloudflare:workers';
import { applyD1Migrations } from 'cloudflare:test';
import { createAuthClient } from 'better-auth/client';
import { emailOTPClient } from 'better-auth/client/plugins';
import { expoClient } from '@better-auth/expo/client';
import { generateKeyPair, SignJWT } from 'jose';
import { afterEach, beforeAll, expect, inject, test, vi } from 'vitest';
import worker from './index';

// Only native platform surfaces are modeled. The installed Expo client plugin,
// its managed cookie storage, server SDK, HTTP routes and D1 are all real.
vi.mock('expo-constants', () => ({ default: { expoConfig: { scheme: 'puptime' } } }));
vi.mock('expo-linking', () => ({ createURL: (path = '') => 'puptime://' + path.replace(/^\//, '') }));
vi.mock('react-native', () => ({ Platform: { OS: 'ios' }, AppState: { addEventListener: () => ({ remove() {} }), currentState: 'active' } }));
const browser = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock('expo-web-browser', () => ({ openAuthSessionAsync: browser.open }));
const base = 'https://puptime.test', settings = { ...env, ENVIRONMENT: 'local' as const, AUTH_BASE_URL: base, WEB_ORIGINS: base, AUTH_SECRET: 'expo-reauth-test-secret-at-least-thirty-two-characters', GOOGLE_CLIENT_ID: 'synthetic.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'synthetic' };
let key: Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
beforeAll(async () => { await applyD1Migrations(env.AUTH_DB, inject('migrations')); key = (await generateKeyPair('RS256')).privateKey; });
afterEach(() => { vi.restoreAllMocks(); browser.open.mockReset(); });

test('installed Expo client preserves reauth starter headers, proxy state and final cookies, then clears cookies after atomic deletion', async () => {
  const storage = new Map<string, string>(), requests: { path: string; headers: Headers; credentials?: RequestInit['credentials'] }[] = [];
  const sdk = createAuthClient({ baseURL: base, plugins: [expoClient({ scheme: 'puptime', storagePrefix: 'reauth-test', storage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => { storage.set(key, value); }, getItemAsync: async key => storage.get(key) ?? null, setItemAsync: async (key, value) => { storage.set(key, value); } } }), emailOTPClient()], fetchOptions: { customFetchImpl: async (input, init) => {
    const headers = new Headers(init?.headers); requests.push({ path: new URL(String(input)).pathname, headers: new Headers(headers), credentials: init?.credentials });
    return worker.fetch(new Request(String(input), { ...init, headers, redirect: 'manual' }), settings);
  } } });
  const email = `expo-${crypto.randomUUID()}@example.invalid`; expect((await sdk.emailOtp.sendVerificationOtp({ email, type: 'sign-in' })).error).toBeNull();
  const preview = await env.AUTH_DB.prepare('SELECT code FROM local_email_previews WHERE email=?').bind(email).first<{ code: string }>(); expect((await sdk.signIn.emailOtp({ email, otp: preview!.code })).error).toBeNull();
  const original = (await sdk.getSession({ query: { disableRefresh: true } })).data!; expect(original.user.email).toBe(email); expect(await sdk.getCookie()).toContain('session_token');
  const subject = crypto.randomUUID(), now = Date.now(); await env.AUTH_DB.prepare('INSERT INTO account(id,accountId,providerId,userId,accessToken,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?)').bind(crypto.randomUUID(), subject, 'google', original.user.id, 'old-access', now, now).run();
  await env.AUTH_DB.prepare("INSERT INTO cloud_accounts(account_id,state) VALUES(?,'deleting')").bind(original.user.id).run(); await env.AUTH_DB.prepare('UPDATE session SET createdAt=? WHERE id=?').bind(new Date(now - 86400000).toISOString(), original.session.id).run();
  const token = await new SignJWT({ email, email_verified: true }).setProtectedHeader({ alg: 'RS256' }).setSubject(subject).setIssuer('https://accounts.google.com').setAudience(settings.GOOGLE_CLIENT_ID).setIssuedAt().setExpirationTime('5m').sign(key);
  vi.spyOn(globalThis, 'fetch').mockImplementation(async input => { expect(String(input)).toBe('https://oauth2.googleapis.com/token'); return Response.json({ access_token: 'new-access', token_type: 'Bearer', expires_in: 300, id_token: token }); });
  browser.open.mockImplementation(async (proxyURL: string, destination: string) => {
    expect(destination).toBe('puptime://account'); expect(proxyURL).toContain('/api/auth/expo-authorization-proxy?');
    const proxy = await worker.fetch(new Request(proxyURL, { redirect: 'manual' }), settings); expect(proxy.status).toBe(302); const authorization = new URL(proxy.headers.get('location')!); expect(authorization.origin).toBe('https://accounts.google.com');
    const browserCookie = proxy.headers.getSetCookie().map(value => value.split(';')[0]).join('; '); expect(browserCookie).not.toContain('session_token');
    const callback = await worker.fetch(new Request(base + '/api/auth/callback/google?' + new URLSearchParams({ code: 'synthetic-expo-code', state: authorization.searchParams.get('state')! }), { headers: { cookie: browserCookie }, redirect: 'manual' }), settings);
    expect(callback.status).toBe(302); const destinationURL = callback.headers.get('location')!; expect(destinationURL).toMatch(/^puptime:\/\/account\?cookie=/); return { type: 'success', url: destinationURL };
  });
  const result = await sdk.signIn.social({ provider: 'google', callbackURL: 'puptime://account', errorCallbackURL: 'puptime://account' }, { headers: { 'x-puptime-reauth': 'account-deletion', 'x-puptime-account': original.user.id } }); expect(result.error).toBeNull(); expect(browser.open).toHaveBeenCalledTimes(1);
  const start = requests.find(request => request.path === '/api/auth/sign-in/social')!; expect(start.headers.get('x-puptime-reauth')).toBe('account-deletion'); expect(start.headers.get('x-puptime-account')).toBe(original.user.id); expect(start.headers.get('cookie')).toContain('session_token'); expect(start.headers.get('expo-origin')).toBe('puptime://'); expect(start.credentials).toBe('omit');
  const refreshed = (await sdk.getSession({ query: { disableRefresh: true } })).data!; expect(refreshed.user.id).toBe(original.user.id); expect(refreshed.session.id).not.toBe(original.session.id); expect(new Date(refreshed.session.createdAt).getTime()).toBeGreaterThan(Date.now() - 10000);
  expect(await env.AUTH_DB.prepare('SELECT accessToken FROM account WHERE userId=?').bind(original.user.id).first()).toEqual({ accessToken: 'old-access' });
  const prepared = await sdk.$fetch<{ receipt: string }>('/account/deletion/prepare', { baseURL: base + '/api', method: 'POST', body: {}, headers: { 'x-puptime-account': original.user.id } }); expect(prepared.error).toBeNull();
  const deleted = await sdk.$fetch<{ success: boolean }>('/account', { baseURL: base + '/api', method: 'DELETE', body: { confirm: true, receipt: prepared.data!.receipt }, headers: { 'x-puptime-account': original.user.id } }); expect(deleted.error).toBeNull(); expect(deleted.data?.success).toBe(true);
  expect(await sdk.getCookie()).not.toContain('session_token'); expect((await sdk.getSession({ query: { disableRefresh: true } })).data).toBeNull();
});

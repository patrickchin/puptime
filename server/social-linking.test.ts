import { env } from 'cloudflare:workers';
import { applyD1Migrations } from 'cloudflare:test';
import { createAuthClient } from 'better-auth/client';
import { emailOTPClient } from 'better-auth/client/plugins';
import { generateKeyPair, SignJWT } from 'jose';
import { afterEach, beforeAll, expect, inject, test, vi } from 'vitest';
import { createAuth } from './auth';

const base = 'https://puptime.test';
const settings = { ...env, ENVIRONMENT: 'local' as const, AUTH_BASE_URL: base, WEB_ORIGINS: base, AUTH_SECRET: 'local-test-secret-with-at-least-32-characters' };
const configured = {
  ...settings,
  APPLE_CLIENT_ID: 'com.puptime.test.web', APPLE_CLIENT_SECRET: 'synthetic-apple-secret',
  GOOGLE_CLIENT_ID: 'synthetic-google-client.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'synthetic-google-secret',
};
type Provider = 'apple' | 'google';
let address = 0;
let signingKey: Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
beforeAll(async () => {
  await applyD1Migrations(env.AUTH_DB, inject('migrations'));
  signingKey = (await generateKeyPair('RS256')).privateKey;
});
afterEach(() => vi.restoreAllMocks());

function client(options: typeof settings = configured) {
  const auth = createAuth(options), jar = new Map<string, string>(), ip = `198.51.100.${++address}`;
  // Only test browser cookie transport is modeled. All SDK requests and OAuth
  // callbacks execute Better Auth against this test's actual isolated D1.
  async function dispatch(url: string | URL, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    if (!headers.has('origin')) headers.set('origin', base);
    headers.set('cf-connecting-ip', ip);
    if (jar.size) headers.set('cookie', [...jar].map(([key, value]) => `${key}=${value}`).join('; '));
    const response = await auth.handler(new Request(String(url), { ...init, headers, redirect: 'manual' }));
    for (const cookie of response.headers.getSetCookie()) {
      const [key, ...value] = cookie.split(';')[0].split('=');
      if (value.join('=')) jar.set(key, value.join('=')); else jar.delete(key);
    }
    return response;
  }
  const sdk = createAuthClient({ baseURL: base, plugins: [emailOTPClient()], fetchOptions: { customFetchImpl: (url, init) => dispatch(String(url), init) } });
  return { sdk, dispatch };
}
type Client = ReturnType<typeof client>;
const email = () => `link-${crypto.randomUUID()}@example.invalid`;
async function otpOwner(browser: Client, inbox = email()) {
  expect((await browser.sdk.emailOtp.sendVerificationOtp({ email: inbox, type: 'sign-in' })).error).toBeNull();
  const preview = await env.AUTH_DB.prepare('SELECT code FROM local_email_previews WHERE email=? ORDER BY expires_at DESC LIMIT 1').bind(inbox).first<{ code: string }>();
  expect(preview?.code).toMatch(/^\d{6}$/);
  expect((await browser.sdk.signIn.emailOtp({ email: inbox, otp: preview!.code })).error).toBeNull();
  const session = await browser.sdk.getSession();
  expect(session.error).toBeNull(); expect(session.data?.user.email).toBe(inbox);
  return session.data!.user;
}
async function ownership() {
  return {
    users: (await env.AUTH_DB.prepare('SELECT * FROM user ORDER BY id').all()).results,
    accounts: (await env.AUTH_DB.prepare('SELECT * FROM account ORDER BY id').all()).results,
  };
}
async function begin(browser: Client, provider: Provider, link = true) {
  const options = { provider, callbackURL: `${base}/account`, errorCallbackURL: `${base}/account`, disableRedirect: true };
  const result = link ? await browser.sdk.linkSocial(options) : await browser.sdk.signIn.social(options);
  expect(result.error).toBeNull(); expect(result.data?.url).toBeTruthy();
  const url = new URL(result.data!.url!);
  expect(url.searchParams.get('state')).toBeTruthy();
  expect(url.searchParams.get('redirect_uri')).toBe(`${base}/api/auth/callback/${provider}`);
  return url;
}
async function providerReply(provider: Provider, inbox: string, subject = crypto.randomUUID()) {
  const token = await new SignJWT({ email: inbox, email_verified: true, name: 'Provider name must not replace OTP profile', picture: 'https://example.invalid/provider-avatar.png' })
    .setProtectedHeader({ alg: 'RS256' }).setSubject(subject)
    .setIssuer(provider === 'apple' ? 'https://appleid.apple.com' : 'https://accounts.google.com')
    .setAudience(provider === 'apple' ? configured.APPLE_CLIENT_ID : configured.GOOGLE_CLIENT_ID)
    .setIssuedAt().setExpirationTime('5m').sign(signingKey);
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    expect(String(input)).toBe(provider === 'apple' ? 'https://appleid.apple.com/auth/token' : 'https://oauth2.googleapis.com/token');
    expect(init?.method).toBe('POST');
    const body = new URLSearchParams(String(init?.body));
    expect(body.get('code')).toBe('synthetic-link-code');
    expect(body.get('code_verifier')).toBeTruthy();
    expect(body.get('redirect_uri')).toBe(`${base}/api/auth/callback/${provider}`);
    return Response.json({ access_token: 'synthetic-provider-access-token', token_type: 'Bearer', expires_in: 300, id_token: token });
  });
}
async function callback(browser: Client, provider: Provider, url: URL) {
  const params = new URLSearchParams({ code: 'synthetic-link-code', state: url.searchParams.get('state')! });
  let response = await browser.dispatch(`${base}/api/auth/callback/${provider}${provider === 'google' ? `?${params}` : ''}`, {
    method: provider === 'apple' ? 'POST' : 'GET',
    ...(provider === 'apple' ? { headers: { origin: 'https://appleid.apple.com', 'content-type': 'application/x-www-form-urlencoded' }, body: params.toString() } : {}),
  });
  if (provider === 'apple') {
    expect(response.status).toBe(302);
    const redirect = new URL(response.headers.get('location')!);
    expect(`${redirect.origin}${redirect.pathname}`).toBe(`${base}/api/auth/callback/apple`);
    response = await browser.dispatch(redirect);
  }
  expect(response.status).toBe(302);
  return new URL(response.headers.get('location')!);
}

test.each(['apple', 'google'] as const)('%s explicit SDK link retains the OTP owner/profile and subsequent provider sign-in uses that same account', async (provider) => {
  const browser = client(), owner = await otpOwner(browser), before = await ownership(), subject = crypto.randomUUID();
  const url = await begin(browser, provider), fetcher = await providerReply(provider, owner.email, subject);
  expect((await callback(browser, provider, url)).href).toBe(`${base}/account`);
  expect(fetcher).toHaveBeenCalledTimes(1);
  const linked = await ownership();
  expect(linked.users).toEqual(before.users);
  expect(linked.accounts).toHaveLength(before.accounts.length + 1);
  expect(linked.accounts).toEqual(expect.arrayContaining(before.accounts));
  const account = await env.AUTH_DB.prepare('SELECT id,accountId,providerId,userId FROM account WHERE providerId=? AND accountId=?').bind(provider, subject).first();
  expect(account).toMatchObject({ accountId: subject, providerId: provider, userId: owner.id });
  expect((await browser.sdk.getSession()).data?.user.id).toBe(owner.id);
  const anonymous = client(), login = await begin(anonymous, provider, false);
  expect((await callback(anonymous, provider, login)).href).toBe(`${base}/account`);
  expect((await anonymous.sdk.getSession()).data?.user.id).toBe(owner.id);
  const signedIn = await ownership();
  expect(signedIn.users).toEqual(before.users);
  expect(signedIn.accounts).toHaveLength(linked.accounts.length);
  expect(await env.AUTH_DB.prepare('SELECT id,accountId,providerId,userId FROM account WHERE providerId=? AND accountId=?').bind(provider, subject).first()).toEqual(account);
});

test.each([
  { provider: 'apple' as const, relay: false }, { provider: 'google' as const, relay: false }, { provider: 'apple' as const, relay: true },
])('$provider rejects explicit linking with a different email (Apple relay=$relay) without ownership/profile mutations', async ({ provider, relay }) => {
  const browser = client(), owner = await otpOwner(browser), before = await ownership();
  const url = await begin(browser, provider);
  await providerReply(provider, relay ? `${crypto.randomUUID()}@privaterelay.appleid.com` : email());
  expect((await callback(browser, provider, url)).searchParams.get('error')).toBe('email_does_not_match');
  expect(await ownership()).toEqual(before);
  expect((await browser.sdk.getSession()).data?.user.id).toBe(owner.id);
});

test.each(['apple', 'google'] as const)('%s refuses a provider subject already owned by another user', async (provider) => {
  const first = client(), firstEmail = email(), subject = crypto.randomUUID();
  const firstUrl = await begin(first, provider, false);
  await providerReply(provider, firstEmail, subject);
  expect((await callback(first, provider, firstUrl)).href).toBe(`${base}/account`);
  const firstOwner = (await first.sdk.getSession()).data!.user;
  vi.restoreAllMocks();
  const browser = client(), owner = await otpOwner(browser), before = await ownership();
  const url = await begin(browser, provider);
  // A provider's email claim can change; ownership is still keyed by subject.
  await providerReply(provider, owner.email, subject);
  expect((await callback(browser, provider, url)).searchParams.get('error')).toBe('account_already_linked_to_different_user');
  expect(await ownership()).toEqual(before);
  expect((await browser.sdk.getSession()).data?.user.id).toBe(owner.id);
  expect((await first.sdk.getSession()).data?.user.id).toBe(firstOwner.id);
});

test.each(['apple', 'google'] as const)('%s linking requires an authenticated session', async (provider) => {
  const browser = client(), before = await ownership(), fetcher = vi.spyOn(globalThis, 'fetch');
  const result = await browser.sdk.linkSocial({ provider, callbackURL: `${base}/account`, disableRedirect: true });
  expect(result.error?.status).toBe(401); expect(result.data).toBeNull();
  expect(await ownership()).toEqual(before); expect(fetcher).not.toHaveBeenCalled();
});

test.each(['apple', 'google'] as const)('%s linking cannot start when the provider is unconfigured', async (provider) => {
  const browser = client(settings); await otpOwner(browser);
  const before = await ownership(), fetcher = vi.spyOn(globalThis, 'fetch');
  const result = await browser.sdk.linkSocial({ provider, callbackURL: `${base}/account`, disableRedirect: true });
  expect(result.error?.status).toBe(404); expect(result.data).toBeNull();
  expect(await ownership()).toEqual(before); expect(fetcher).not.toHaveBeenCalled();
});

test.each([
  { provider: 'apple' as const, expired: false }, { provider: 'google' as const, expired: false },
  { provider: 'apple' as const, expired: true }, { provider: 'google' as const, expired: true },
])('$provider rejects invalid linking state before exchanging a code (expired=$expired)', async ({ provider, expired }) => {
  const browser = client(), owner = await otpOwner(browser), before = await ownership(), url = await begin(browser, provider);
  if (expired) {
    // Expire only this real SDK-issued state in the isolated test database.
    const row = await env.AUTH_DB.prepare('SELECT id,value FROM verification WHERE identifier=?').bind(`auth-state:${url.searchParams.get('state')}`).first<{ id: string; value: string }>();
    expect(row).not.toBeNull();
    await env.AUTH_DB.prepare('UPDATE verification SET value=?,expiresAt=0 WHERE id=?').bind(JSON.stringify({ ...JSON.parse(row!.value), expiresAt: Date.now() - 1 }), row!.id).run();
  } else {
    // A second valid flow replaces the signed state cookie. Callback one must
    // not consume callback two's binding even though both belong to this owner.
    await begin(browser, provider);
  }
  const fetcher = await providerReply(provider, owner.email);
  expect((await callback(browser, provider, url)).searchParams.get('error')).toBe('state_mismatch');
  expect(fetcher).not.toHaveBeenCalled(); expect(await ownership()).toEqual(before);
  expect((await browser.sdk.getSession()).data?.user.id).toBe(owner.id);
});

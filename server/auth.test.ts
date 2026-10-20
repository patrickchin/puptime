import { env } from 'cloudflare:workers';
import { afterEach, beforeAll, expect, inject, test, vi } from 'vitest';
import { applyD1Migrations } from 'cloudflare:test';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createAuth, configuredProviders } from './auth';

const settings = { ...env, ENVIRONMENT: 'local' as const, AUTH_BASE_URL: 'https://puptime.test', WEB_ORIGINS: 'https://puptime.test', AUTH_SECRET: 'local-test-secret-with-at-least-32-characters' };
const clients = new Map<string, string>();
let socialClient = 0;
const socialClientIP = () => `198.51.100.${++socialClient}`;
function request(path: string, body?: object, cookie?: string, ip?: string) {
  const email = body && 'email' in body ? String(body.email) : 'default';
  if (!clients.has(email)) clients.set(email, `192.0.2.${clients.size + 1}`);
  return new Request(`https://puptime.test/api/auth/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'cf-connecting-ip': ip ?? clients.get(email)!, origin: 'https://puptime.test', ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
beforeAll(async () => {
  await applyD1Migrations(env.AUTH_DB, inject('migrations'));
});
afterEach(() => vi.restoreAllMocks());

const socialSettings = {
  ...settings,
  APPLE_CLIENT_ID: 'com.puptime.test.web', APPLE_CLIENT_SECRET: 'synthetic-apple-secret',
  GOOGLE_CLIENT_ID: 'synthetic-google-client.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'synthetic-google-secret',
};
const cookieHeader = (response: Response) => response.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');

async function beginSocial(auth: ReturnType<typeof createAuth>, provider: 'apple' | 'google', base = settings.AUTH_BASE_URL) {
  const response = await auth.handler(new Request(`${base}/api/auth/sign-in/social`, {
    method: 'POST', headers: { origin: base, 'content-type': 'application/json', 'cf-connecting-ip': socialClientIP() },
    body: JSON.stringify({ provider, callbackURL: 'puptime://account', errorCallbackURL: `${base}/account`, disableRedirect: true }),
  }));
  expect(response.status).toBe(200);
  const result = await response.json() as { url: string };
  return { response, url: new URL(result.url) };
}

test('only configured sign-in methods are advertised', () => {
  expect(configuredProviders(settings)).toEqual({ apple: false, google: false, email: true });
  expect(configuredProviders({ ...settings, ENVIRONMENT: 'production' })).toEqual({ apple: false, google: false, email: false });
  expect(configuredProviders({ ...settings, ENVIRONMENT: 'production', RESEND_API_KEY: 'not-a-real-key', EMAIL_FROM: 'signin@harpapro.com' }).email).toBe(false);
  for (const provider of ['APPLE', 'GOOGLE'] as const) {
    expect(configuredProviders({ ...settings, [`${provider}_CLIENT_ID`]: 'synthetic-client' })[provider.toLowerCase() as 'apple' | 'google']).toBe(false);
    expect(configuredProviders({ ...settings, [`${provider}_CLIENT_SECRET`]: 'synthetic-secret' })[provider.toLowerCase() as 'apple' | 'google']).toBe(false);
  }
  expect(configuredProviders(socialSettings)).toEqual({ apple: true, google: true, email: true });
});

test('unconfigured social providers cannot issue sessions or authorization redirects', async () => {
  const auth = createAuth(settings);
  for (const provider of ['apple', 'google']) {
    const response = await auth.handler(request('sign-in/social', { provider, callbackURL: 'puptime://account' }, undefined, socialClientIP()));
    expect(response.status).toBe(404);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(response.headers.get('location')).toBeNull();
  }
});

test('browser OAuth uses the canonical origin, configured client and standard minimal scopes', async () => {
  for (const base of ['https://puptime-api-staging.p-ch.workers.dev', 'https://puptime.pages.dev']) {
    const auth = createAuth({ ...socialSettings, AUTH_BASE_URL: base, WEB_ORIGINS: base });
    for (const provider of ['apple', 'google'] as const) {
      const { url } = await beginSocial(auth, provider, base);
      expect(url.origin).toBe(provider === 'apple' ? 'https://appleid.apple.com' : 'https://accounts.google.com');
      expect(url.searchParams.get('client_id')).toBe(provider === 'apple' ? socialSettings.APPLE_CLIENT_ID : socialSettings.GOOGLE_CLIENT_ID);
      expect(url.searchParams.get('redirect_uri')).toBe(`${base}/api/auth/callback/${provider}`);
      expect(url.searchParams.get('scope')?.split(' ').sort()).toEqual(provider === 'apple' ? ['email', 'name'] : ['email', 'openid', 'profile']);
      expect(url.searchParams.get('state')).toBeTruthy();
      expect(url.searchParams.get('code_challenge')).toBeTruthy();
      expect(url.searchParams.get('code_challenge_method')).toBe('S256');
      if (provider === 'apple') expect(url.searchParams.get('response_mode')).toBe('form_post');
    }
  }
});

test('Apple default verification accepts only the configured Service ID/native bundle and rejects invalid nonce, claims and signature', async () => {
  const auth = createAuth(socialSettings);
  const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
  const jwk = { ...await exportJWK(publicKey), alg: 'RS256', kid: 'synthetic-apple-key', use: 'sig' };
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    expect(String(input)).toBe('https://appleid.apple.com/auth/keys');
    return Response.json({ keys: [jwk] });
  });
  const sign = (changes: Record<string, unknown> = {}) => new SignJWT({
    sub: 'synthetic-apple-subject', email: 'apple-token@example.invalid', email_verified: true,
    nonce: 'synthetic-nonce', iss: 'https://appleid.apple.com', aud: socialSettings.APPLE_CLIENT_ID,
    iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 300, ...changes,
  }).setProtectedHeader({ alg: 'RS256', kid: jwk.kid }).sign(privateKey);
  for (const aud of [socialSettings.APPLE_CLIENT_ID, 'com.patrickchin.puptime']) {
    const nonce = aud === socialSettings.APPLE_CLIENT_ID ? 'synthetic-nonce' : Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('synthetic-nonce'))), value=>value.toString(16).padStart(2,'0')).join('');
    const valid = await auth.handler(request('sign-in/social', { provider: 'apple', idToken: { token: await sign({ aud, nonce }), nonce: 'synthetic-nonce' } }, undefined, socialClientIP()));
    expect(valid.status).toBe(200);
    expect((await auth.api.getSession({ headers: new Headers({ cookie: cookieHeader(valid) }) }))?.user.email).toBe('apple-token@example.invalid');
  }
  for (const claims of [
    { aud: 'com.patrickchin.puptime.widget' }, { aud: 'another-service-id' }, { iss: 'https://untrusted.example' },
    { nonce: 'wrong-nonce' }, { nonce: undefined }, { exp: Math.floor(Date.now() / 1000) - 120 },
  ]) {
    const invalid = await auth.handler(request('sign-in/social', { provider: 'apple', idToken: { token: await sign(claims), nonce: 'synthetic-nonce' } }, undefined, socialClientIP()));
    expect(invalid.status).toBe(401);
    expect(invalid.headers.get('set-cookie')).toBeNull();
  }
  for (const nonce of [undefined, '', ' ']) {
    const invalid = await auth.handler(request('sign-in/social', { provider: 'apple', idToken: { token: await sign(), nonce } }, undefined, socialClientIP()));
    expect(invalid.status).toBe(400);expect(invalid.headers.get('set-cookie')).toBeNull();
  }
  const otherKey = (await generateKeyPair('RS256')).privateKey;
  const wrongSignature = await new SignJWT({ sub: 'untrusted-subject', email: 'untrusted@example.invalid', nonce: 'synthetic-nonce' }).setIssuer('https://appleid.apple.com').setAudience('com.patrickchin.puptime').setIssuedAt().setExpirationTime('5m').setProtectedHeader({alg:'RS256',kid:jwk.kid}).sign(otherKey);
  for (const token of ['not-a-jwt', wrongSignature]) {
    const invalid = await auth.handler(request('sign-in/social', { provider: 'apple', idToken: { token, nonce: 'synthetic-nonce' } }, undefined, socialClientIP()));
    expect(invalid.status).toBe(401);expect(invalid.headers.get('set-cookie')).toBeNull();
  }
});

test('native Apple ID-token linking uses the authenticated owner without implicit linking or cloud enrollment',async()=>{
 const auth=createAuth(socialSettings),email='native-apple-link@example.invalid';
 await auth.handler(request('email-otp/send-verification-otp',{email,type:'sign-in'}));
 const preview=await env.AUTH_DB.prepare('SELECT code FROM local_email_previews WHERE email=?').bind(email).first<{code:string}>();
 const login=await auth.handler(request('sign-in/email-otp',{email,otp:preview!.code})),cookie=cookieHeader(login),owner=await auth.api.getSession({headers:new Headers({cookie})});
 const {privateKey,publicKey}=await generateKeyPair('RS256',{extractable:true}),jwk={...await exportJWK(publicKey),alg:'RS256',kid:'native-link-key',use:'sig'};
 vi.spyOn(globalThis,'fetch').mockImplementation(async input=>{expect(String(input)).toBe('https://appleid.apple.com/auth/keys');return Response.json({keys:[jwk]});});
 const token=await new SignJWT({email,email_verified:true,nonce:'link-nonce'}).setSubject('native-link-subject').setIssuer('https://appleid.apple.com').setAudience('com.patrickchin.puptime').setIssuedAt().setExpirationTime('5m').setProtectedHeader({alg:'RS256',kid:jwk.kid}).sign(privateKey);
 const linked=await auth.handler(request('link-social',{provider:'apple',idToken:{token,nonce:'link-nonce'},callbackURL:'puptime://account'},cookie,socialClientIP()));
 expect(linked.status).toBe(200);
 const row=await env.AUTH_DB.prepare("SELECT userId,accountId FROM account WHERE providerId='apple' AND accountId=?").bind('native-link-subject').first();
 expect(row).toEqual({userId:owner!.user.id,accountId:'native-link-subject'});
 expect((await auth.api.getSession({headers:new Headers({cookie})}))?.user.id).toBe(owner!.user.id);
 expect((await env.AUTH_DB.prepare('SELECT * FROM cloud_accounts WHERE account_id=?').bind(owner!.user.id).all()).results).toEqual([]);
 const anonymous=await auth.handler(request('link-social',{provider:'apple',idToken:{token,nonce:'link-nonce'}},undefined,socialClientIP()));
 expect(anonymous.status).toBe(401);
});

test.each(['apple', 'google'] as const)('%s browser callback cannot implicitly link an existing email account', async (provider) => {
  const auth = createAuth(socialSettings);
  const email = `${provider}-existing@example.invalid`;
  await auth.handler(request('email-otp/send-verification-otp', { email, type: 'sign-in' }));
  const preview = await env.AUTH_DB.prepare('SELECT code FROM local_email_previews WHERE email = ?').bind(email).first<{ code: string }>();
  const login = await auth.handler(request('sign-in/email-otp', { email, otp: preview!.code }));
  expect(login.status).toBe(200);
  const ownerCookie = cookieHeader(login);
  const owner = await auth.api.getSession({ headers: new Headers({ cookie: ownerCookie }) });
  const before = await env.AUTH_DB.prepare('SELECT * FROM account WHERE userId = ? ORDER BY id').bind(owner!.user.id).all();
  // This is an anonymous provider sign-in, not the authenticated explicit-link route.
  const { response: start, url } = await beginSocial(auth, provider);
  const { privateKey } = await generateKeyPair('RS256');
  const idToken = await new SignJWT({ email, email_verified: true, name: 'Synthetic provider user' })
    .setProtectedHeader({ alg: 'RS256' }).setSubject(`synthetic-${provider}-existing-email-subject`)
    .setIssuer(provider === 'apple' ? 'https://appleid.apple.com' : 'https://accounts.google.com')
    .setAudience(provider === 'apple' ? socialSettings.APPLE_CLIENT_ID : socialSettings.GOOGLE_CLIENT_ID)
    .setIssuedAt().setExpirationTime('5m').sign(privateKey);
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    expect(String(input)).toBe(provider === 'apple' ? 'https://appleid.apple.com/auth/token' : 'https://oauth2.googleapis.com/token');
    expect(init?.method).toBe('POST');
    return Response.json({ access_token: 'synthetic-access-token', token_type: 'Bearer', expires_in: 300, id_token: idToken });
  });
  const params = new URLSearchParams({ code: 'synthetic-authorization-code', state: url.searchParams.get('state')! });
  let callback = await auth.handler(new Request(`${settings.AUTH_BASE_URL}/api/auth/callback/${provider}${provider === 'google' ? `?${params}` : ''}`, {
    method: provider === 'apple' ? 'POST' : 'GET',
    headers: { cookie: cookieHeader(start), origin: provider === 'apple' ? 'https://appleid.apple.com' : settings.AUTH_BASE_URL, 'cf-connecting-ip': '192.0.2.151', ...(provider === 'apple' ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
    ...(provider === 'apple' ? { body: params.toString() } : {}),
  }));
  if (provider === 'apple') {
    // Better Auth converts Apple's form POST to its own GET callback before exchanging the code.
    expect(callback.status).toBe(302);
    const redirect = new URL(callback.headers.get('location')!);
    expect(`${redirect.origin}${redirect.pathname}`).toBe(`${settings.AUTH_BASE_URL}/api/auth/callback/apple`);
    expect(redirect.searchParams.get('state')).toBe(params.get('state'));
    callback = await auth.handler(new Request(redirect, { headers: { cookie: cookieHeader(start), origin: settings.AUTH_BASE_URL, 'cf-connecting-ip': '192.0.2.151' } }));
  }
  expect(callback.status).toBe(302);
  expect(new URL(callback.headers.get('location')!).searchParams.get('error')).toBe('account_not_linked');
  expect(callback.headers.getSetCookie().some((value) => value.includes('session_token='))).toBe(false);
  expect((await auth.api.getSession({ headers: new Headers({ cookie: ownerCookie }) }))?.user.id).toBe(owner!.user.id);
  expect((await env.AUTH_DB.prepare('SELECT id FROM user WHERE email = ?').bind(email).all()).results).toEqual([{ id: owner!.user.id }]);
  expect((await env.AUTH_DB.prepare('SELECT * FROM account WHERE userId = ? ORDER BY id').bind(owner!.user.id).all()).results).toEqual(before.results);
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

test('the real Better Auth adapter persists prefixed IDs for all five models without changing credentials',async()=>{
 const auth=createAuth(settings),email='prefixed-ids@example.invalid';
 expect((await auth.handler(request('email-otp/send-verification-otp',{email,type:'sign-in'}))).status).toBe(200);
 const preview=await env.AUTH_DB.prepare('SELECT id,code FROM local_email_previews WHERE email=?').bind(email).first<{id:string;code:string}>();
 expect(preview!.id).toMatch(/^prv_[a-f0-9]{32}$/);
 const verification=await env.AUTH_DB.prepare('SELECT id FROM verification WHERE identifier LIKE ?').bind(`%${email}%`).first<{id:string}>();
 expect(verification!.id).toMatch(/^ver_[a-f0-9]{32}$/);
 const response=await auth.handler(request('sign-in/email-otp',{email,otp:preview!.code}));
 expect(response.status).toBe(200);
 const session=(await auth.api.getSession({headers:new Headers({cookie:cookieHeader(response)})}))!;
 expect(session.user.id).toMatch(/^usr_[a-f0-9]{32}$/);
 expect(session.session.id).toMatch(/^ses_[a-f0-9]{32}$/);
 const context=await auth.$context;
 for(const model of ['toString','constructor','unknown'])expect(()=>context.generateId({model})).toThrow('Unknown authentication model');
 const account=await context.adapter.create({model:'account',data:{userId:session.user.id,providerId:'google',accountId:'provider-subject-preserved',createdAt:new Date(),updatedAt:new Date()}});
 expect(account.id).toMatch(/^acc_[a-f0-9]{32}$/);
 expect(account.accountId).toBe('provider-subject-preserved');
 const rate=await context.adapter.create({model:'rateLimit',data:{key:'prefixed-id-test',count:1,lastRequest:Date.now()}});
 expect(rate.id).toMatch(/^rlm_[a-f0-9]{32}$/);
 expect(rate.key).toBe('prefixed-id-test');
 const stored=await env.AUTH_DB.prepare('SELECT token FROM session WHERE id=?').bind(session.session.id).first<{token:string}>();
 expect(stored!.token).toBe(session.session.token);
 expect(stored!.token).not.toMatch(/^ses_/);
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

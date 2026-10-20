import { Hono, type Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import { validator } from 'hono/validator';
import { z } from 'zod';
import { enrollmentSchema, mutationSchema, recordIdSchema } from '../src/cloud/protocol';
import { getAccountStore, type AccountStore } from './account-store';
import { configuredProviders, createAuth } from './auth';
import { deleteCloudAccount, deletionReceiptSchema, deletionReceiptStatus, prepareDeletionReceipt, recentAuthentication } from './account-lifecycle';
import { expectedAccountSchema, lifecycleError, trustedAccountOrigin } from './account-reauth';
import { activateTrial, cloudAccess, getCloudAccount, trialDaysFromEnvironment, type CloudAccess, type CloudAccount } from './entitlements';
import { emailRecoveryIntent, newRecoveryIntent, recoveryCancelInput, recoveryIPLimit, recoveryLimit, recoveryReceiptInput, recoveryStartLimit, recoveryUnavailable, recoveryVerifyInput, saveRecoveryIntent } from './account-recovery';
import { hashCapability } from './account-reauth';

type AccountEnv = { Bindings: Cloudflare.Env; Variables: {
  user: { id: string; email: string; name: string }; sessionCreatedAt: number; sessionId: string;
  store: DurableObjectStub<AccountStore>; cloud: CloudAccess; cloudAccount: CloudAccount | null;
} };
const syncAccess = createMiddleware<AccountEnv>(async (context, next) => {
  if (!context.get('cloud').canSync) return context.json({ error: 'cloud_subscription_required' }, 402);
  await next();
});
const pushSchema = z.strictObject({ mutations: z.array(mutationSchema).min(1).max(50) });
const afterSchema = z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

export const accountRoutes = new Hono<AccountEnv>();
accountRoutes.use('/account/recovery/*', async (context, next) => {
  context.header('Cache-Control', 'no-store');
  if (new URL(context.req.url).searchParams.has('receipt') || !trustedAccountOrigin(context.req.raw.headers, context.env)) recoveryUnavailable();
  await recoveryIPLimit(context.env.AUTH_DB, context.req.raw.headers);
  await next();
});
async function recoveryExpected(context: Context<AccountEnv>) {
  const expected = expectedAccountSchema.safeParse(context.req.header('x-puptime-account'));
  if (!expected.success) recoveryUnavailable();
  const session = await createAuth(context.env).api.getSession({ headers: context.req.raw.headers, query: { disableRefresh: true } });
  if (session && session.user.id !== expected.data) recoveryUnavailable();
  return expected.data;
}
accountRoutes.post('/account/recovery/email/start', async context => {
  const input = recoveryReceiptInput.safeParse(await context.req.json().catch(() => null));
  if (!input.success || !configuredProviders(context.env).email) recoveryUnavailable();
  const expected = await recoveryExpected(context), intent = await newRecoveryIntent(context.env.AUTH_DB, input.data.receipt, expected, 'email');
  await recoveryStartLimit(context.env.AUTH_DB, intent, context.req.raw.headers);
  await saveRecoveryIntent(context.env.AUTH_DB, intent);
  const response = await createAuth(context.env, { recovery: intent }).api.sendVerificationOTP({ headers: context.req.raw.headers, body: { email: intent.identity, type: 'sign-in' }, asResponse: true });
  if (!response.ok) { await context.env.AUTH_DB.prepare('DELETE FROM account_recovery_intents WHERE id=?').bind(intent.id).run(); recoveryUnavailable(); }
  return context.json({ success: true, recoveryIntentId: intent.id });
});
accountRoutes.post('/account/recovery/email/verify', async context => {
  const input = recoveryVerifyInput.safeParse(await context.req.json().catch(() => null));
  if (!input.success || !configuredProviders(context.env).email) recoveryUnavailable();
  const expected = await recoveryExpected(context), intent = await emailRecoveryIntent(context.env.AUTH_DB, input.data.intentId, input.data.receipt, expected);
  await recoveryLimit(context.env.AUTH_DB, [
    { key: 'verify-owner:' + await hashCapability(expected), limit: 10, window: 300000 },
    { key: 'verify-receipt:' + intent.receiptHash, limit: 10, window: 300000 },
  ]);
  const response = await createAuth(context.env, { recovery: intent }).api.signInEmailOTP({ headers: context.req.raw.headers, body: { email: intent.identity, otp: input.data.otp }, asResponse: true });
  if (!response.ok) recoveryUnavailable();
  const headers = new Headers(response.headers); headers.set('cache-control', 'no-store');
  return new Response(response.body, { status: response.status, headers });
});
accountRoutes.post('/account/recovery/cancel', async context => {
  const input = recoveryCancelInput.safeParse(await context.req.json().catch(() => null));
  if (!input.success) recoveryUnavailable();
  const expected = await recoveryExpected(context);
  await context.env.AUTH_DB.prepare('DELETE FROM account_recovery_intents WHERE id=? AND receipt_hash=? AND account_id=?')
    .bind(input.data.intentId, await hashCapability(input.data.receipt), expected).run();
  return context.json({ success: true });
});
const authenticated = createMiddleware<AccountEnv>(async (context, next) => {
  context.header('Cache-Control', 'no-store');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(context.req.method)) {
    if (!trustedAccountOrigin(context.req.raw.headers, context.env)) {
      return context.json({ error: 'untrusted_origin' }, 403);
    }
  }
  if (!context.req.header('cookie')) return context.json({ error: 'unauthorized' }, 401);
  const lifecycleRequest = context.req.path.startsWith('/api/account/reauth') || context.req.path.startsWith('/api/account/deletion/') || context.req.method === 'DELETE';
  const result = await createAuth(context.env).api.getSession({ headers: context.req.raw.headers, returnHeaders: true, query: { disableRefresh: lifecycleRequest } });
  for (const cookie of result.headers.getSetCookie()) context.header('set-cookie', cookie, { append: true });
  if (!result.response) return context.json({ error: 'unauthorized' }, 401);
  const { user, session } = result.response;
  const account = await getCloudAccount(context.env.AUTH_DB, user.id);
  if (account?.state === 'deleting' && !((context.req.method === 'DELETE' && context.req.path === '/api/account') || (context.req.method === 'POST' && (context.req.path.startsWith('/api/account/reauth') || context.req.path === '/api/account/deletion/prepare')))) return context.json({ error: 'account_deleting' }, 410);
  context.set('user', { id: user.id, email: user.email, name: user.name });
  context.set('sessionCreatedAt', new Date(session.createdAt).getTime());
  context.set('sessionId',session.id);
  context.set('cloudAccount', account);
  context.set('cloud', cloudAccess(account, Date.now()));
  context.set('store', getAccountStore(context.env, user.id));
  await next();
});
accountRoutes.get('/account', authenticated, async (context) => {
  const summary = context.get('cloudAccount') ? await context.get('store').summary() : { pets: [] };
  return context.json({ user: context.get('user'), cloud: context.get('cloud'), ...summary });
});
accountRoutes.post('/cloud/trial', authenticated, validator('json', (value) => z.strictObject({}).parse(value)), async (context) => {
  const account = await activateTrial(context.env.AUTH_DB, context.get('user').id, Date.now(), trialDaysFromEnvironment(context.env.CLOUD_TRIAL_DAYS));
  return context.json({ cloud: cloudAccess(account, Date.now()) });
});
accountRoutes.post('/cloud/enroll', authenticated, syncAccess, validator('json', (value) => enrollmentSchema.parse(value)), async (context) => {
  const result = await context.get('store').enrollForClient(context.req.valid('json'));
  return 'error' in result ? context.json(result, 409) : context.json(result);
});
accountRoutes.post('/sync/push', authenticated, syncAccess, validator('json', (value) => pushSchema.parse(value)), async (context) => {
  return context.json(await context.get('store').push(context.req.valid('json').mutations));
});
accountRoutes.get('/sync/changes', authenticated, syncAccess, async (context) => {
  const origin=context.req.header('origin');
  const allowed=[context.env.AUTH_BASE_URL?new URL(context.env.AUTH_BASE_URL).origin:'',...(context.env.WEB_ORIGINS??'').split(',')];
  if(origin&&!allowed.includes(origin))return context.json({error:'untrusted_origin'},403);
  if(context.req.header('upgrade')?.toLowerCase()!=='websocket')return context.json({error:'websocket_required'},426);
  // Replace caller headers; ownership/session references come only from Better Auth.
  return context.get('store').fetch(new Request('https://account.internal/changes',{headers:{upgrade:'websocket','x-puptime-account':context.get('user').id,'x-puptime-session':context.get('sessionId')}}));
});
accountRoutes.get('/sync/pull', authenticated, syncAccess, async (context) => {
  const after = afterSchema.parse(context.req.query('after') ?? 0);
  const limit = z.coerce.number().int().min(1).max(100).parse(context.req.query('limit') ?? 100);
  return context.json(await context.get('store').pullForClient(after, limit));
});
accountRoutes.get('/records/:id/history', authenticated, syncAccess, async (context) => {
  const id = recordIdSchema.parse(context.req.param('id'));
  const before = afterSchema.parse(context.req.query('beforeRevision') ?? Number.MAX_SAFE_INTEGER);
  return context.json({ revisions: await context.get('store').history(id, before) });
});
async function exportAccount(context: Context<AccountEnv>) {
  return context.get('store').exportStream();
}
accountRoutes.get('/account/export', authenticated, exportAccount);
accountRoutes.post('/account/export', authenticated, validator('form', value => z.strictObject({expectedAccount:z.string().min(1).max(256)}).parse(value)), context => {
  if(context.req.valid('form').expectedAccount!==context.get('user').id)return context.html('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="robots" content="noindex"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Account changed | Puptime</title><style>body{margin:0;background:#f6f4ed;color:#17231e;font:17px/1.5 system-ui,sans-serif}main{max-width:540px;margin:72px auto;padding:24px}h1{font-size:36px;letter-spacing:-1px}a{display:inline-block;color:#176b52;padding:12px 0;text-underline-offset:4px}</style><main><h1>Account changed</h1><p>Return to your account before downloading cloud data.</p><a href="/account">Back to account</a></main></html>',409);
  return exportAccount(context);
});
accountRoutes.post('/account/reauth', authenticated, validator('json', value => z.strictObject({otp:z.string().regex(/^\d{6}$/)}).parse(value)), context => {
  const expected=context.req.header('x-puptime-account');
  if(!expected)return context.json({error:'invalid_request'},400);
  if(expected!==context.get('user').id)return context.json({error:'account_mismatch'},409);
  return createAuth(context.env,{disableEmailSignUp:true}).api.signInEmailOTP({headers:context.req.raw.headers,body:{email:context.get('user').email,otp:context.req.valid('json').otp},asResponse:true});
});

accountRoutes.post('/account/reauth/cancel', authenticated, validator('json', value => z.strictObject({ intentId: z.uuid() }).parse(value)), async context => {
  const expected = expectedAccountSchema.parse(context.req.header('x-puptime-account'));
  if (expected !== context.get('user').id) lifecycleError(409, 'account_mismatch');
  await context.env.AUTH_DB.prepare('DELETE FROM account_reauth_intents WHERE id=? AND account_id=?').bind(context.req.valid('json').intentId, expected).run();
  return context.json({ success: true });
});
accountRoutes.post('/account/deletion/prepare', authenticated, validator('json', value => z.strictObject({}).parse(value)), async context => {
  const expected = expectedAccountSchema.parse(context.req.header('x-puptime-account'));
  if (expected !== context.get('user').id) lifecycleError(409, 'account_mismatch');
  if (!recentAuthentication(context.get('sessionCreatedAt'))) lifecycleError(401, 'reauthentication_required');
  return context.json(await prepareDeletionReceipt(context.env.AUTH_DB, expected, context.get('sessionId')));
});
accountRoutes.post('/account/deletion/status', async (context, next) => {
  context.header('Cache-Control', 'no-store');
  if (!trustedAccountOrigin(context.req.raw.headers, context.env)) lifecycleError(403, 'untrusted_origin');
  await next();
}, validator('json', value => z.strictObject({ receipt: deletionReceiptSchema }).parse(value)), async context => {
  return context.json(await deletionReceiptStatus(context.env.AUTH_DB, context.req.valid('json').receipt));
});
accountRoutes.delete('/account', authenticated, validator('json', (value) => z.strictObject({ confirm: z.literal(true), receipt: deletionReceiptSchema.optional() }).parse(value)), async (context) => {
  const expected=context.req.header('x-puptime-account');
  if (context.req.valid('json').receipt) expectedAccountSchema.parse(expected);
  if(expected!==undefined&&expected!==context.get('user').id)return context.json({error:'account_mismatch'},409);
  if (!recentAuthentication(context.get('sessionCreatedAt'))) return context.json({ error: 'reauthentication_required' }, 401);
  const appleRevocation = await deleteCloudAccount(context.env, context.get('user'), context.get('sessionId'), context.req.valid('json').receipt);
  // Use the public SDK for signed-cookie expiry even after the cascade removed
  // its session. Do not duplicate its cookie naming or Expo cookie behavior.
  const signedOut = await createAuth(context.env).api.signOut({ headers: context.req.raw.headers, body: {}, asResponse: true });
  return Response.json({ success: true, message: 'User deleted', appleRevocation }, { headers: signedOut.headers });
});

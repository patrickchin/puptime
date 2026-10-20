import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { accountRoutes } from './account-routes';
import { configuredProviders, createAuth } from './auth';
import { trialDaysFromEnvironment } from './entitlements';
import { callbackReauthIntent, expectedAccountSchema, lifecycleError, newReauthIntent, reauthInputSchema, reauthMode, saveReauthResponse, trustedAccountOrigin } from './account-reauth';
export { AccountStore } from './account-store';

const app = new Hono<{ Bindings: Cloudflare.Env }>();
app.use('/api/*', bodyLimit({ maxSize: 65536 }));
app.use('/api/*', cors({
  origin: (origin, context) => {
    const allowed = [context.env.AUTH_BASE_URL, ...(context.env.WEB_ORIGINS ?? '').split(',')].filter(Boolean);
    return allowed.includes(origin) ? origin : undefined;
  },
  credentials: true,
}));
app.get('/health', (context) => context.json({ service: 'puptime-api', status: 'ok', protocolVersion: 1 }));
app.get('/api/config', (context) => context.json({ protocolVersion: 1, trialDays: trialDaysFromEnvironment(context.env.CLOUD_TRIAL_DAYS), providers: configuredProviders(context.env), pricingFinalized: false }));
app.on(['GET', 'POST'], '/api/auth/*', async (context) => {
  const auth=createAuth(context.env),expected=context.req.header('x-puptime-account');
  const mode = context.req.header('x-puptime-reauth');
  if (mode !== undefined) {
    context.header('Cache-Control', 'no-store');
    if (mode !== reauthMode || context.req.method !== 'POST' || context.req.path !== '/api/auth/sign-in/social') lifecycleError(400, 'invalid_request');
    if (!trustedAccountOrigin(context.req.raw.headers, context.env)) lifecycleError(403, 'untrusted_origin');
    const accountId = expectedAccountSchema.parse(expected);
    const input = reauthInputSchema.parse(await context.req.raw.clone().json().catch(() => lifecycleError(400, 'invalid_request')));
    const session = await auth.api.getSession({ headers: context.req.raw.headers, query: { disableRefresh: true } });
    if (!session) lifecycleError(401, 'unauthorized');
    if (session.user.id !== accountId) lifecycleError(409, 'account_mismatch');
    if (!configuredProviders(context.env)[input.provider]) lifecycleError(400, 'provider_unavailable');
    if (!await context.env.AUTH_DB.prepare('SELECT id FROM account WHERE userId=? AND providerId=? LIMIT 1').bind(accountId, input.provider).first()) lifecycleError(409, 'provider_not_linked');
    const intent = newReauthIntent(accountId, session.session.id, input.provider);
    const response = await createAuth(context.env, { startReauth: intent }).handler(context.req.raw);
    return saveReauthResponse(context.env.AUTH_DB, intent, response);
  }
  if (context.req.path === '/api/auth/callback/apple' || context.req.path === '/api/auth/callback/google') {
    // This is only our own index of the opaque state. The SDK still verifies
    // state, its cookie, the provider code and the trusted server context.
    let state: string | null = context.req.query('state') ?? null;
    if (context.req.method === 'POST') {
      const copy = context.req.raw.clone();
      const value: unknown = copy.headers.get('content-type')?.includes('application/json')
        ? (await copy.json().catch(() => null) as { state?: unknown } | null)?.state
        : new URLSearchParams(new TextDecoder().decode(await copy.arrayBuffer())).get('state');
      state = typeof value === 'string' ? value : null;
    }
    const intent = await callbackReauthIntent(context.env.AUTH_DB, state);
    return createAuth(context.env, { callbackReauth: intent }).handler(context.req.raw);
  }
  if(context.req.method==='POST'&&context.req.path==='/api/auth/link-social'&&expected!==undefined){
    const session=await auth.api.getSession({headers:context.req.raw.headers});
    if(!session)return context.json({error:'unauthorized'},401);
    if(session.user.id!==expected)return context.json({error:'account_mismatch'},409);
  }
  return auth.handler(context.req.raw);
});
app.route('/api', accountRoutes);
app.notFound((context) => context.json({ error: 'not_found' }, 404));
app.onError((error, context) => error instanceof HTTPException ? error.getResponse() : error instanceof z.ZodError ? context.json({ error: 'invalid_request' }, 400) : context.json({ error: 'service_unavailable' }, 503));
export default app;

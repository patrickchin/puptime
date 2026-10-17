import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { validator } from 'hono/validator';
import { z } from 'zod';
import { enrollmentSchema, mutationSchema, recordIdSchema, type Revision } from '../src/cloud/protocol';
import { getAccountStore, type AccountStore } from './account-store';
import { createAuth } from './auth';
import { activateTrial, cloudAccess, getCloudAccount, trialDaysFromEnvironment, type CloudAccess, type CloudAccount } from './entitlements';

type AccountEnv = { Bindings: Cloudflare.Env; Variables: {
  user: { id: string; email: string; name: string }; sessionCreatedAt: number;
  store: DurableObjectStub<AccountStore>; cloud: CloudAccess; cloudAccount: CloudAccount | null;
} };
const syncAccess = createMiddleware<AccountEnv>(async (context, next) => {
  if (!context.get('cloud').canSync) return context.json({ error: 'cloud_subscription_required' }, 402);
  await next();
});
const pushSchema = z.strictObject({ mutations: z.array(mutationSchema).min(1).max(50) });
const afterSchema = z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

export const accountRoutes = new Hono<AccountEnv>();
const authenticated = createMiddleware<AccountEnv>(async (context, next) => {
  context.header('Cache-Control', 'no-store');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(context.req.method)) {
    const origin = context.req.header('origin');
    const allowed = [context.env.AUTH_BASE_URL ? new URL(context.env.AUTH_BASE_URL).origin : '', ...(context.env.WEB_ORIGINS ?? '').split(',')];
    if ((origin && !allowed.includes(origin)) || (!origin && context.req.header('sec-fetch-site') === 'cross-site')) {
      return context.json({ error: 'untrusted_origin' }, 403);
    }
  }
  if (!context.req.header('cookie')) return context.json({ error: 'unauthorized' }, 401);
  const result = await createAuth(context.env).api.getSession({ headers: context.req.raw.headers, returnHeaders: true });
  for (const cookie of result.headers.getSetCookie()) context.header('set-cookie', cookie, { append: true });
  if (!result.response) return context.json({ error: 'unauthorized' }, 401);
  const { user, session } = result.response;
  const account = await getCloudAccount(context.env.AUTH_DB, user.id);
  if (account?.state === 'deleting' && !(context.req.method === 'DELETE' && context.req.path === '/api/account')) return context.json({ error: 'account_deleting' }, 410);
  context.set('user', { id: user.id, email: user.email, name: user.name });
  context.set('sessionCreatedAt', new Date(session.createdAt).getTime());
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
accountRoutes.get('/account/export', authenticated, async (context) => {
  const store = context.get('store');
  const snapshot = await store.exportSnapshot();
  const encoder = new TextEncoder();
  let manifest = true; let cursor = 0; let pending: Revision[] = [];
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (manifest) {
          manifest = false;
          controller.enqueue(encoder.encode(JSON.stringify({ type: 'manifest', format: 'puptime-cloud-export', version: 1, exportedAt: Date.now(), pets: snapshot.pets }) + '\n'));
          return;
        }
        if (!pending.length && cursor < snapshot.cursor) pending = await store.exportPage(cursor, snapshot.cursor);
        const revision = pending.shift();
        if (revision) {
          cursor = revision.sequence;
          controller.enqueue(encoder.encode(JSON.stringify({ type: 'revision', ...revision }) + '\n'));
        } else {
          if (cursor !== snapshot.cursor) throw new Error('Incomplete snapshot.');
          controller.enqueue(encoder.encode(JSON.stringify({ type: 'complete', cursor }) + '\n'));
          controller.close();
        }
      } catch { controller.error(new Error('Export interrupted. Please retry.')); }
    },
  });
  return new Response(stream, { headers: {
    'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store',
    'Content-Disposition': 'attachment; filename="puptime-cloud-export.ndjson"',
  } });
});


accountRoutes.delete('/account', authenticated, validator('json', (value) => z.strictObject({ confirm: z.literal(true) }).parse(value)), async (context) => {
  if (!Number.isFinite(context.get('sessionCreatedAt')) || Date.now() - context.get('sessionCreatedAt') >= 600000) return context.json({ error: 'reauthentication_required' }, 401);
  return createAuth(context.env).api.deleteUser({ headers: context.req.raw.headers, body: {}, asResponse: true });
});

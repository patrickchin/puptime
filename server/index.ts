import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { configuredProviders, createAuth } from './auth';
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
app.get('/api/config', (context) => context.json({ protocolVersion: 1, providers: configuredProviders(context.env), pricingFinalized: false }));
app.on(['GET', 'POST'], '/api/auth/*', (context) => createAuth(context.env).handler(context.req.raw));
app.get('/api/account', async (context) => {
  if (!context.req.header('cookie')) return context.json({ error: 'unauthorized' }, 401);
  const result = await createAuth(context.env).api.getSession({ headers: context.req.raw.headers, returnHeaders: true });
  for (const cookie of result.headers.getSetCookie()) context.header('set-cookie', cookie, { append: true });
  if (!result.response) return context.json({ error: 'unauthorized' }, 401);
  const { id, email, name } = result.response.user;
  return context.json({ user: { id, email, name } });
});
app.notFound((context) => context.json({ error: 'not_found' }, 404));
app.onError((error, context) => error instanceof HTTPException ? error.getResponse() : context.json({ error: 'service_unavailable' }, 503));
export default app;

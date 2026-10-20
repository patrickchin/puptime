import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { accountRoutes } from './account-routes';
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
app.get('/api/config', (context) => context.json({ protocolVersion: 1, providers: configuredProviders(context.env) }));
app.on(['GET', 'POST'], '/api/auth/*', async (context) => {
  const auth=createAuth(context.env),expected=context.req.header('x-puptime-account');
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

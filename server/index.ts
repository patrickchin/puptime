import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { accountRoutes } from './account-routes';
import { configuredProviders, createAuth } from './auth';
import { resourceRoutes } from './resource-routes';
import {sharingRoutes} from './sharing-routes';
import type { ApiEnv } from './api-auth';
export { AccountStore } from './account-store';

const app = new Hono<ApiEnv>();
app.use('/api/v1/*', async (context, next) => {
  context.set('requestId', 'req_' + crypto.randomUUID().replaceAll('-', ''));
  context.header('X-Request-Id', context.get('requestId'));
  context.header('Cache-Control', 'no-store');
  await next();
});
const jsonBodyLimit=bodyLimit({ maxSize: 65536, onError: context => context.req.path.startsWith('/api/v1/')
  ? context.json({ error: { code: 'payload_too_large', message: 'Request exceeds 64 KiB.', requestId: context.get('requestId') } }, 413)
  : context.text('Payload Too Large', 413) });
const photoBodyLimit=bodyLimit({maxSize:256*1024,onError:context=>context.json({error:'photo_too_large'},413)});
app.use('/api/*',(context,next)=>context.req.path.startsWith('/api/photos/')?photoBodyLimit(context,next):jsonBodyLimit(context,next));
app.use('/api/*', cors({
  origin: (origin, context) => {
    const allowed = [context.env.AUTH_BASE_URL, ...(context.env.WEB_ORIGINS ?? '').split(',')].filter(Boolean);
    return allowed.includes(origin) ? origin : undefined;
  },
  credentials: true,
  exposeHeaders: ['ETag', 'Location', 'X-Request-Id', 'Retry-After'],
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
app.route('/api', sharingRoutes);
app.route('/api/v1', resourceRoutes);
app.notFound((context) => context.req.path.startsWith('/api/v1/')
  ? context.json({ error: { code: 'not_found', message: 'No API route matches this request.', requestId: context.get('requestId') } }, 404)
  : context.json({ error: 'not_found' }, 404));
app.onError((error, context) => error instanceof HTTPException ? error.getResponse() : error instanceof z.ZodError ? context.json({ error: 'invalid_request' }, 400) : context.json({ error: 'service_unavailable' }, 503));
export default app;

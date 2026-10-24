import {assertPuppyPhotoBytes,puppyPhotoSchema} from '../src/puppy-photo';
import {accountPhotoKey} from './photo-storage';
import { Hono, type Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import { validator } from 'hono/validator';
import { z } from 'zod';
import { enrollmentSchema, mutationSchema, recordIdSchema, identifierSchema } from '../src/cloud/protocol';
import { getAccountStore, type AccountStore } from './account-store';
import { createAuth } from './auth';
import type { AppleRevocation } from './account-lifecycle';
import { cloudAccess, getCloudAccount, type CloudAccess } from './cloud-access';
import {legacyProfile,legacyProfileRevision} from './profile-compat';

type AccountEnv = { Bindings: Cloudflare.Env; Variables: {
  user: { id: string; email: string; name: string }; sessionCreatedAt: number; sessionId: string;
  store: DurableObjectStub<AccountStore>; cloud: CloudAccess;
} };
const syncAccess = createMiddleware<AccountEnv>(async (context, next) => {
  if (!context.get('cloud').canSync) return context.json({ error: 'cloud_unavailable' }, 403);
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
  const result = await createAuth(context.env).api.getSession({ headers: context.req.raw.headers, returnHeaders: true, query: { disableRefresh: context.req.method === 'POST' && context.req.path === '/api/account/reauth' } });
  for (const cookie of result.headers.getSetCookie()) context.header('set-cookie', cookie, { append: true });
  if (!result.response) return context.json({ error: 'unauthorized' }, 401);
  const { user, session } = result.response;
  const account = await getCloudAccount(context.env.AUTH_DB, user.id);
  if (account?.state === 'deleting' && !((context.req.method === 'DELETE' && context.req.path === '/api/account') || (context.req.method === 'POST' && context.req.path === '/api/account/reauth'))) return context.json({ error: 'account_deleting' }, 410);
  context.set('user', { id: user.id, email: user.email, name: user.name });
  context.set('sessionCreatedAt', new Date(session.createdAt).getTime());
  context.set('sessionId',session.id);
  context.set('cloud', cloudAccess(account));
  context.set('store', getAccountStore(context.env, user.id));
  await next();
});
accountRoutes.get('/account', authenticated, async (context) => {
  const summary = await context.get('store').summary();
  return context.json({ user: context.get('user'), cloud: context.get('cloud'), ...summary });
});
accountRoutes.post('/cloud/enroll', authenticated, syncAccess, validator('json', (value) => enrollmentSchema.parse(value)), async (context) => {
  const result = await context.get('store').enrollForClient(context.req.valid('json'));
  return 'error' in result ? context.json(result, 409) : context.json(result);
});
accountRoutes.post('/sync/push', authenticated, syncAccess, validator('json', (value) => pushSchema.parse(value)), async (context) => {
  const result=await context.get('store').push(context.req.valid('json').mutations);
  return context.json(context.req.header('x-puptime-profile-photos')==='1'?result:{...result,accepted:result.accepted.map(value=>({...value,record:legacyProfile(value.record)}))});
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
  const page=await context.get('store').pullForClient(after, limit);
  return context.json(context.req.header('x-puptime-profile-photos')==='1'?page:{...page,changes:page.changes.map(legacyProfile)});
});
accountRoutes.get('/records/:id/history', authenticated, syncAccess, async (context) => {
  const id = recordIdSchema.parse(context.req.param('id'));
  const before = afterSchema.parse(context.req.query('beforeRevision') ?? Number.MAX_SAFE_INTEGER);
  const revisions=await context.get('store').history(id, before);
  return context.json({revisions:context.req.header('x-puptime-profile-photos')==='1'?revisions:revisions.map(legacyProfileRevision)});
});
async function exportAccount(context: Context<AccountEnv>,photos=context.req.header('x-puptime-profile-photos')==='1') {
  return context.get('store').exportStream(photos);
}
accountRoutes.get('/account/export', authenticated, context=>exportAccount(context));
accountRoutes.post('/account/export', authenticated, validator('form', value => z.strictObject({expectedAccount:z.string().min(1).max(256),profilePhotos:z.literal('1').optional()}).parse(value)), context => {
  if(context.req.valid('form').expectedAccount!==context.get('user').id)return context.html('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="robots" content="noindex"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Account changed | Puptime</title><style>body{margin:0;background:#f6f4ed;color:#17231e;font:17px/1.5 system-ui,sans-serif}main{max-width:540px;margin:72px auto;padding:24px}h1{font-size:36px;letter-spacing:-1px}a{display:inline-block;color:#176b52;padding:12px 0;text-underline-offset:4px}</style><main><h1>Account changed</h1><p>Return to your account before downloading cloud data.</p><a href="/account">Back to account</a></main></html>',409);
  return exportAccount(context,context.req.valid('form').profilePhotos==='1'||context.req.header('x-puptime-profile-photos')==='1');
});
accountRoutes.post('/account/reauth', authenticated, validator('json', value => z.strictObject({otp:z.string().regex(/^\d{6}$/)}).parse(value)), context => {
  const expected=context.req.header('x-puptime-account');
  if(!expected)return context.json({error:'invalid_request'},400);
  if(expected!==context.get('user').id)return context.json({error:'account_mismatch'},409);
  return createAuth(context.env,{disableEmailSignUp:true}).api.signInEmailOTP({headers:context.req.raw.headers,body:{email:context.get('user').email,otp:context.req.valid('json').otp},asResponse:true});
});

accountRoutes.delete('/account', authenticated, validator('json', (value) => z.strictObject({ confirm: z.literal(true) }).parse(value)), async (context) => {
  const expected=context.req.header('x-puptime-account');
  if(expected!==undefined&&expected!==context.get('user').id)return context.json({error:'account_mismatch'},409);
  if (!Number.isFinite(context.get('sessionCreatedAt')) || Date.now() - context.get('sessionCreatedAt') >= 600000) return context.json({ error: 'reauthentication_required' }, 401);
  let appleRevocation: AppleRevocation = 'manual';
  const response = await createAuth(context.env, { onAccountRetired: outcome => { appleRevocation = outcome; } }).api.deleteUser({ headers: context.req.raw.headers, body: {}, asResponse: true });
  if (!response.ok) return response;
  const result = await response.json();
  return Response.json({ ...result, appleRevocation }, { status: response.status, headers: response.headers });
});


accountRoutes.post('/photos/:petId/:photoId',authenticated,syncAccess,async context=>{
  const accountId=context.get('user').id;
  if(context.req.header('x-puptime-account')!==accountId)return context.json({error:'account_mismatch'},409);
  const petId=identifierSchema.parse(context.req.param('petId')),photoId=puppyPhotoSchema.parse(context.req.param('photoId'));
  if(!(await context.get('store').summary()).pets.some(pet=>pet.id===petId))return context.json({error:'not_found'},404);
  const bucket=context.env.PUPPY_PHOTOS;if(!bucket)return context.json({error:'photos_unavailable'},503);
  if(context.req.header('content-type')?.split(';')[0]!=='image/jpeg')return context.json({error:'invalid_photo'},400);
  const bytes=new Uint8Array(await context.req.arrayBuffer());
  try{assertPuppyPhotoBytes(bytes);}catch{return context.json({error:'invalid_photo'},400);}
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(value=>value.toString(16).padStart(2,'0')).join('');
  const key=accountPhotoKey(accountId,photoId),existing=await bucket.head(key);
  if(existing&&(existing.customMetadata?.sha256!==digest||existing.customMetadata.petId!==petId))return context.json({error:'photo_id_conflict'},409);
  let created=false;
  if(!existing){
    const saved=await bucket.put(key,bytes,{onlyIf:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'image/jpeg'},customMetadata:{sha256:digest,petId}});
    if(!saved){const winner=await bucket.head(key);if(winner?.customMetadata?.sha256!==digest||winner.customMetadata.petId!==petId)return context.json({error:'photo_id_conflict'},409);}
    else created=true;
  }
  // A deletion can finish its object listing while this upload is in flight.
  const active=await context.env.AUTH_DB.prepare("SELECT u.id FROM user u LEFT JOIN cloud_accounts c ON c.account_id=u.id WHERE u.id=? AND COALESCE(c.state,'')!='deleting'").bind(accountId).first();
  if(!active){if(created)await bucket.delete(key);return context.json({error:'account_deleting'},410);}
  return context.json({photoId});
});
accountRoutes.get('/photos/:photoId',authenticated,syncAccess,async context=>{
  const accountId=context.get('user').id;
  if(context.req.header('x-puptime-account')!==accountId)return context.json({error:'account_mismatch'},409);
  const photoId=puppyPhotoSchema.parse(context.req.param('photoId')),bucket=context.env.PUPPY_PHOTOS;
  if(!bucket)return context.json({error:'photos_unavailable'},503);
  const photo=await bucket.get(accountPhotoKey(accountId,photoId));
  if(!photo)return context.json({error:'not_found'},404);
  return context.body(photo.body,200,{'Content-Type':'image/jpeg','Content-Length':String(photo.size),'X-Content-Type-Options':'nosniff'});
});

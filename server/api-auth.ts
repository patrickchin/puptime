import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { ApiKey } from '@better-auth/api-key';
import { isAPIError } from 'better-auth/api';
import { createMiddleware } from 'hono/factory';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { getAccountStore, type AccountStore } from './account-store';
import { createAuth } from './auth';
import { cloudAccess, getCloudAccount } from './cloud-access';

export type ApiScope = 'read' | 'write' | 'export';
export type ApiEnv = { Bindings: Cloudflare.Env; Variables: {
  user: { id: string; email: string; name: string };
  credentialId: string;
  store: DurableObjectStub<AccountStore>;
  scopes: ApiScope[];
  requestId: string;
  sessionCreatedAt: number;
} };
export class ApiError extends Error {
  constructor(public readonly status: ContentfulStatusCode,
    public readonly code: string, message: string) { super(message); }
}
export const apiErrorSchema = z.object({ error: z.object({ code: z.string(), message: z.string(), requestId: z.string() }) }).openapi('ApiError');
export const commonApiErrors = {
  400: { description: 'Invalid request.', content: { 'application/json': { schema: apiErrorSchema } } },
  401: { description: 'Authentication or recent sign-in required.', content: { 'application/json': { schema: apiErrorSchema } } },
  403: { description: 'Credential scope or origin does not permit this action.', content: { 'application/json': { schema: apiErrorSchema } } },
  404: { description: 'Resource not found for this account.', content: { 'application/json': { schema: apiErrorSchema } } },
  410: { description: 'Account deletion is in progress.', content: { 'application/json': { schema: apiErrorSchema } } },
  429: { description: 'Credential request limit exceeded.', content: { 'application/json': { schema: apiErrorSchema } } },
} as const;
const scopesSchema = z.array(z.enum(['read', 'write', 'export'])).min(1).max(3).refine(value => new Set(value).size === value.length, 'Scopes must be unique.');

function permissionScopes(permissions: unknown): ApiScope[] {
  if (typeof permissions === 'string') {
    try { permissions = JSON.parse(permissions); } catch { return []; }
  }
  const parsed = z.object({ puptime: scopesSchema }).safeParse(permissions);
  return parsed.success ? parsed.data.puptime : [];
}

async function authOperation<T>(operation: Promise<T>): Promise<T> {
  try { return await operation; } catch (error) {
    if (isAPIError(error)) {
      if (error.statusCode === 429) throw new ApiError(429, 'rate_limited', 'The request limit has been reached. Try again in one minute.');
      if (error.statusCode === 401) throw new ApiError(401, 'unauthorized', 'Sign in again to continue.');
      if (error.statusCode === 403) throw new ApiError(403, 'forbidden', 'This credential does not permit the requested action.');
      if (error.statusCode === 404) throw new ApiError(404, 'not_found', 'The API key was not found.');
      if (error.statusCode === 400) throw new ApiError(400, 'invalid_request', 'Check the request fields and try again.');
    }
    throw error;
  }
}

export const apiAccess = (scope: ApiScope | 'keys') => createMiddleware<ApiEnv>(async (context, next) => {
  context.header('Cache-Control', 'no-store');
  const auth = createAuth(context.env);
  const authorization = context.req.header('authorization');
  if (authorization !== undefined) {
    const match = /^Bearer (puptime_[A-Za-z0-9_-]+)$/i.exec(authorization);
    if (!match || match[1].length > 256) throw new ApiError(401, 'invalid_api_key', 'Provide a valid Puptime API key.');
    if (scope === 'keys') throw new ApiError(403, 'session_required', 'Sign in to manage API keys.');
    const result = await authOperation(auth.api.verifyApiKey({ body: { key: match[1] } }));
    if (!result.valid || !result.key) {
      if (result.error?.code === 'RATE_LIMITED' || result.error?.code === 'USAGE_EXCEEDED') {
        context.header('Retry-After', '60');
        throw new ApiError(429, 'rate_limited', 'The API key request limit has been reached. Try again in one minute.');
      }
      throw new ApiError(401, 'invalid_api_key', 'The API key is invalid, expired, or revoked.');
    }
    const scopes = permissionScopes(result.key.permissions);
    if (!scopes.includes(scope)) throw new ApiError(403, 'insufficient_scope', `This API key requires the ${scope} scope.`);
    const user = await context.env.AUTH_DB.prepare('SELECT id, email, name FROM user WHERE id = ?').bind(result.key.referenceId).first<{ id: string; email: string; name: string }>();
    if (!user) throw new ApiError(401, 'invalid_api_key', 'The API key is invalid, expired, or revoked.');
    context.set('user', user);
    context.set('credentialId', result.key.id);
    context.set('scopes', scopes);
    context.set('sessionCreatedAt', 0);
  } else {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(context.req.method)) {
      const origin = context.req.header('origin');
      const allowed = [context.env.AUTH_BASE_URL ? new URL(context.env.AUTH_BASE_URL).origin : '', ...(context.env.WEB_ORIGINS ?? '').split(',')];
      if ((origin && !allowed.includes(origin)) || (!origin && context.req.header('sec-fetch-site') === 'cross-site')) {
        throw new ApiError(403, 'untrusted_origin', 'The request origin is not trusted.');
      }
    }
    if (!context.req.header('cookie')) throw new ApiError(401, 'unauthorized', 'Sign in or provide a Puptime API key.');
    const session = await auth.api.getSession({ headers: context.req.raw.headers, returnHeaders: true });
    for (const cookie of session.headers.getSetCookie()) context.header('set-cookie', cookie, { append: true });
    if (!session.response) throw new ApiError(401, 'unauthorized', 'Sign in or provide a Puptime API key.');
    const { user, session: details } = session.response;
    context.set('user', { id: user.id, email: user.email, name: user.name });
    context.set('credentialId', details.id);
    context.set('scopes', ['read', 'write', 'export']);
    context.set('sessionCreatedAt', new Date(details.createdAt).getTime());
  }
  const user = context.get('user');
  const account = await getCloudAccount(context.env.AUTH_DB, user.id);
  if (account?.state === 'deleting') throw new ApiError(410, 'account_deleting', 'Account deletion is in progress.');
  const access = cloudAccess(account);
  if (scope === 'export' ? !access.canExport : !access.canSync) throw new ApiError(403, 'cloud_unavailable', 'Cloud access is unavailable.');
  context.set('store', getAccountStore(context.env, user.id));
  await next();
});

const keyInfoSchema = z.object({
  id: z.string(), name: z.string(), start: z.string().nullable(), scopes: z.array(z.enum(['read', 'write', 'export'])),
  createdAt: z.iso.datetime(), expiresAt: z.iso.datetime().nullable(), lastUsedAt: z.iso.datetime().nullable(),
}).openapi('ApiKeyInfo');
function keyInfo(key: Omit<ApiKey, 'key'>) {
  return {
    id: key.id, name: key.name ?? '', start: key.start, scopes: permissionScopes(key.permissions),
    createdAt: new Date(key.createdAt).toISOString(),
    expiresAt: key.expiresAt ? new Date(key.expiresAt).toISOString() : null,
    lastUsedAt: key.lastRequest ? new Date(key.lastRequest).toISOString() : null,
  };
}
const keySecurity = [{ session: [] }];
export const apiKeyRoutes = new OpenAPIHono<ApiEnv>({ defaultHook: (result) => {
  if (!result.success) throw new ApiError(400, 'invalid_request', 'Check the request fields and try again.');
} });
apiKeyRoutes.openapi(createRoute({
  method: 'get', path: '/api-keys', operationId: 'listApiKeys', tags: ['API keys'], security: keySecurity,
  summary: 'List this account’s integration keys', middleware: [apiAccess('keys')] as const,
  request: { query: z.object({ limit: z.coerce.number().int().min(1).max(100).default(20), offset: z.coerce.number().int().min(0).max(1000000).default(0) }) },
  responses: { 200: { description: 'Key metadata. Secret keys and hashes are never included.', content: { 'application/json': { schema: z.object({ items: z.array(keyInfoSchema), total: z.number().int(), limit: z.number().int(), offset: z.number().int() }) } } }, ...commonApiErrors },
}), async (context) => {
  const { limit, offset } = context.req.valid('query');
  const result = await authOperation(createAuth(context.env).api.listApiKeys({ headers: context.req.raw.headers, query: { limit, offset, sortBy: 'createdAt', sortDirection: 'desc' } }));
  return context.json({ items: result.apiKeys.map(keyInfo), total: result.total, limit, offset }, 200);
});
apiKeyRoutes.openapi(createRoute({
  method: 'post', path: '/api-keys', operationId: 'createApiKey', tags: ['API keys'], security: keySecurity,
  summary: 'Create an expiring integration key', description: 'Requires a session created less than ten minutes ago. Save the returned key; it is shown only once.', middleware: [apiAccess('keys')] as const,
  request: { body: { required: true, content: { 'application/json': { schema: z.strictObject({ name: z.string().trim().min(1).max(80), scopes: scopesSchema, expiresInDays: z.number().int().min(1).max(365).default(90) }).openapi('CreateApiKey') } } } },
  responses: { 201: { description: 'Created. The raw key appears only in this response.', content: { 'application/json': { schema: z.object({ apiKey: keyInfoSchema, key: z.string() }) } } }, ...commonApiErrors },
}), async (context) => {
  const createdAt = context.get('sessionCreatedAt');
  if (!Number.isFinite(createdAt) || Date.now() - createdAt >= 600000) throw new ApiError(401, 'reauthentication_required', 'Sign in again before creating an API key.');
  const input = context.req.valid('json');
  // No caller headers: permissions are a server-only plugin property. Ownership
  // comes from the already-verified session, never from request JSON.
  const result = await authOperation(createAuth(context.env).api.createApiKey({ body: { userId: context.get('user').id, name: input.name, permissions: { puptime: input.scopes }, expiresIn: input.expiresInDays * 86400 } }));
  return context.json({ apiKey: keyInfo(result), key: result.key }, 201);
});
apiKeyRoutes.openapi(createRoute({
  method: 'delete', path: '/api-keys/{id}', operationId: 'revokeApiKey', tags: ['API keys'], security: keySecurity,
  summary: 'Revoke an integration key immediately', middleware: [apiAccess('keys')] as const,
  request: { params: z.object({ id: z.string().regex(/^key_[a-f0-9]{32}$/) }) },
  responses: { 204: { description: 'Revoked. Requests using this key will be rejected.' }, ...commonApiErrors },
}), async (context) => {
  const keyId = context.req.valid('param').id;
  const owned = await context.env.AUTH_DB.prepare('SELECT id FROM apikey WHERE id = ? AND referenceId = ?').bind(keyId, context.get('user').id).first();
  if (!owned) throw new ApiError(404, 'not_found', 'The API key was not found.');
  await authOperation(createAuth(context.env).api.deleteApiKey({ headers: context.req.raw.headers, body: { keyId } }));
  return context.body(null, 204);
});

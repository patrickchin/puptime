import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { cloudRecordSchema, identifierSchema, localIdSchema, recordDataSchema, recordPatchSchema, type CloudRecord, type RecordKind } from '../src/cloud/protocol';
import { cloudRecordId, localRecordId } from '../src/cloud/record-identity';
import { eventTypes } from '../src/domain';
import { ApiError, apiAccess, apiErrorSchema, apiKeyRoutes, type ApiEnv } from './api-auth';

const integer = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const cursor = z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const timestamp = z.coerce.number().int().min(-8640000000000000).max(8640000000000000);
const errorSchema = apiErrorSchema;
const json = (schema: z.ZodType) => ({ 'application/json': { schema } });
const errors = Object.fromEntries([400,401,403,404,409,410,412,413,415,428,429,503].map(status => [status, { description: 'Request rejected. See error.code and X-Request-Id.', content: json(errorSchema) }]));
const security: Record<string, string[]>[] = [{ apiKey: [] }, { session: [] }];
const writeHeaders = z.object({
  'idempotency-key': z.string().regex(/^[A-Za-z0-9._:-]{8,128}$/).openapi({ description: 'Unique request key. Reuse the same key and body to safely retry. Keys are scoped to this credential.' }),
});
const editHeaders = writeHeaders.extend({
  'if-match': z.string().regex(/^"(?:0|[1-9]\d*)"$/).openapi({ description: 'Quoted current revision from ETag, e.g. "3". Stale revisions return 412.' }),
});
const listQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50), after: cursor.optional() }).strict();
const logsQuery = listQuery.extend({
  since: timestamp.optional().openapi({ description: 'Inclusive activity time, Unix milliseconds.' }),
  until: timestamp.optional().openapi({ description: 'Exclusive activity time, Unix milliseconds.' }),
  type: z.enum(eventTypes).optional(),
}).refine(value => value.since === undefined || value.until === undefined || value.since < value.until, 'since must be earlier than until.');

function dto(record: CloudRecord) {
  return { ...record.data, id: localRecordId(record), puppyId: record.petId, revision: record.revision, updatedAt: record.updatedAt, deleted: record.deleted };
}
const resourceSchemas = new Map<RecordKind, z.ZodType>();
function resourceSchema(kind: RecordKind): z.ZodType {
  if (!resourceSchemas.has(kind)) resourceSchemas.set(kind, recordDataSchema(kind).safeExtend({ id: localIdSchema, puppyId: identifierSchema.nullable(), revision: integer, updatedAt: z.number().int(), deleted: z.boolean() }).openapi({event:'Log',routine:'Routine',puppy:'Puppy',customActivity:'CustomActivity',customization:'Customization',accountPreferences:'Preferences'}[kind]));
  return resourceSchemas.get(kind)!;
}
function params(path: string) {
  const shape: Record<string, z.ZodString> = {};
  if (path.includes('{puppyId}')) shape.puppyId = identifierSchema;
  if (path.includes('{id}')) shape.id = localIdSchema;
  return z.object(shape);
}
function identity(context: Context<ApiEnv>, kind: RecordKind) {
  const puppyId = context.req.param('puppyId') ?? null;
  return { petId: puppyId, localId: kind === 'puppy' ? puppyId ?? undefined : kind === 'accountPreferences' ? 'preferences' : context.req.param('id') };
}
async function operation(context: Context<ApiEnv>) {
  const key = context.req.header('idempotency-key');
  if (!key) throw new ApiError(428, 'idempotency_key_required', 'Provide an Idempotency-Key to make this write safe to retry.');
  writeHeaders.parse({ 'idempotency-key': key });
  const bytes = new TextEncoder().encode(context.get('credentialId') + '\0' + key);
  return 'op_' + Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
}
function expectedRevision(context: Context<ApiEnv>) {
  const value = context.req.header('if-match');
  if (!value) throw new ApiError(428, 'precondition_required', 'Provide the current ETag in If-Match before changing this record.');
  editHeaders.shape['if-match'].parse(value);
  return integer.parse(Number(value.slice(1, -1)));
}

export const resourceRoutes = new OpenAPIHono<ApiEnv>({ defaultHook: (result, context) => {
  if (!result.success) {
    if (result.target === 'header' && !context.req.header('idempotency-key')) throw new ApiError(428, 'idempotency_key_required', 'Provide an Idempotency-Key to make this write safe to retry.');
    if (result.target === 'header' && result.error.issues.some(issue => issue.path.includes('if-match')) && !context.req.header('if-match')) throw new ApiError(428, 'precondition_required', 'Provide the current ETag in If-Match before changing this record.');
    throw new ApiError(400, 'invalid_request', 'The request does not match the API schema.');
  }
} });
resourceRoutes.use('*', async (context, next) => {
  if (!context.get('requestId')) context.set('requestId', 'req_' + crypto.randomUUID().replaceAll('-', ''));
  context.header('X-Request-Id', context.get('requestId'));
  context.header('Cache-Control', 'no-store');
  await next();
});
resourceRoutes.onError((error, context) => {
  const known = error instanceof ApiError ? error : error instanceof z.ZodError ? new ApiError(400, 'invalid_request', 'The request does not match the API schema.')
    : error instanceof HTTPException ? new ApiError(error.status, error.status === 413 ? 'payload_too_large' : 'invalid_request', error.message)
      : new ApiError(503, 'service_unavailable', 'The service is temporarily unavailable. Retry with the same Idempotency-Key.');
  return context.json({ error: { code: known.code, message: known.message, requestId: context.get('requestId') } }, known.status);
});
resourceRoutes.notFound(context => context.json({ error: { code: 'not_found', message: 'No API route matches this request.', requestId: context.get('requestId') } }, 404));

async function write(context: Context<ApiEnv>, kind: RecordKind, intent: 'create' | 'patch' | 'delete' | 'restore', patch: Record<string, unknown>) {
  const { petId, localId } = identity(context, kind);
  const revision = intent === 'create' ? undefined : expectedRevision(context);
  const result = await context.get('store').resourceWrite({
    requestId: await operation(context), actorId: context.get('credentialId'), kind, petId, ...(localId ? { localId } : {}),
    intent, ...(revision === undefined ? {} : { expectedRevision: revision }), patch,
  });
  if (!result.ok) throw new ApiError(result.error === 'not_found' ? 404 : result.error === 'precondition_failed' ? 412 : result.error === 'invalid_request' ? 400 : 409, result.error, result.message);
  context.header('ETag', '"' + result.record.revision + '"');
  if (intent === 'create') {
    const base = context.req.path.replace(/\/$/, '');
    context.header('Location', kind === 'accountPreferences' ? base : base + '/' + encodeURIComponent(localRecordId(result.record)));
  }
  return dto(result.record);
}

// The declarations below drive both runtime validation and the OpenAPI contract.
function collection(path: string, kind: RecordKind, tag: string) {
  const item = resourceSchema(kind);
  resourceRoutes.openapi(createRoute({
    method: 'get', path, operationId: 'list' + tag, summary: 'List ' + tag, tags: [tag], security, middleware: [apiAccess('read')],
    request: { params: params(path), query: kind === 'event' ? logsQuery : listQuery },
    responses: { 200: { description: 'Current records. nextCursor is null on the last page; cursors are not snapshots.', content: json(z.object({ data: z.array(item), nextCursor: integer.nullable() })) }, ...errors },
  }), async context => {
    const query = (kind === 'event' ? logsQuery : listQuery).parse(context.req.query());
    const petId = identity(context, kind).petId;
    if (petId && !await context.get('store').resourceGet('puppy', petId, petId)) throw new ApiError(404, 'not_found', 'The puppy does not exist.');
    const result = await context.get('store').resourceList({ kind, petId, ...query });
    return context.json({ data: result.records.map(dto), nextCursor: result.nextCursor });
  });
  resourceRoutes.openapi(createRoute({
    method: 'post', path, operationId: 'create' + tag, summary: 'Create ' + tag, tags: [tag], security, middleware: [apiAccess('write')],
    request: { params: params(path), headers: writeHeaders, body: { required: true, content: json(recordDataSchema(kind)) } },
    responses: { 201: { description: 'Created. Replays return the original result.', content: json(item) }, ...errors },
  }), async context => context.json(await write(context, kind, 'create', recordDataSchema(kind).parse(await context.req.json())), 201));
  detail(path + (kind === 'puppy' ? '/{puppyId}' : '/{id}'), kind, tag, kind !== 'puppy');
}
function detail(path: string, kind: RecordKind, tag: string, deletable: boolean) {
  const item = resourceSchema(kind);
  resourceRoutes.openapi(createRoute({
    method: 'get', path, operationId: 'get' + tag, summary: 'Get ' + tag, tags: [tag], security, middleware: [apiAccess('read')], request: { params: params(path) },
    responses: { 200: { description: 'Current record, including ETag. Deleted records return 404.', content: json(item) }, ...errors },
  }), async context => {
    const { petId, localId } = identity(context, kind);
    const record = await context.get('store').resourceGet(kind, petId, localId!);
    if (!record || record.deleted) throw new ApiError(404, 'not_found', 'The record does not exist.');
    context.header('ETag', '"' + record.revision + '"');
    return context.json(dto(record));
  });
  resourceRoutes.openapi(createRoute({
    method: 'patch', path, operationId: 'update' + tag, summary: 'Update ' + tag, tags: [tag], security, middleware: [apiAccess('write')],
    request: { params: params(path), headers: editHeaders, body: { required: true, content: json(recordPatchSchema(kind)) } },
    responses: { 200: { description: 'Updated with a new revision. Null clears an optional field.', content: json(item) }, ...errors },
  }), async context => context.json(await write(context, kind, 'patch', recordPatchSchema(kind).parse(await context.req.json())), 200));
  const revision = z.object({ revision: integer, acceptedAt: z.number().int(), intent: z.enum(['create','patch','delete','restore']), reason: z.string(), before: item.nullable(), after: item });
  resourceRoutes.openapi(createRoute({
    method: 'get', path: path + '/history', operationId: 'history' + tag, summary: 'Read ' + tag + ' history', tags: [tag], security, middleware: [apiAccess('read')],
    request: { params: params(path), query: z.object({ beforeRevision: cursor.optional() }).strict() },
    responses: { 200: { description: 'Up to 50 revisions, newest first. Includes deleted records.', content: json(z.object({ data: z.array(revision), nextCursor: integer.nullable() })) }, ...errors },
  }), async context => {
    const { petId, localId } = identity(context, kind);
    if (!await context.get('store').resourceGet(kind, petId, localId!)) throw new ApiError(404, 'not_found', 'The record does not exist.');
    const before = cursor.parse(context.req.query('beforeRevision') ?? Number.MAX_SAFE_INTEGER);
    const recordId = cloudRecordId(kind, petId, localId!);
    const rows = await context.get('store').history(recordId, before);
    return context.json({ data: rows.map(row => ({ revision: row.revision, acceptedAt: row.acceptedAt, intent: row.intent, reason: row.reason, before: row.before ? dto(row.before) : null, after: dto(row.after) })), nextCursor: rows.length === 50 ? rows.at(-1)!.revision : null });
  });
  if (!deletable) return;
  resourceRoutes.openapi(createRoute({
    method: 'delete', path, operationId: 'delete' + tag, summary: 'Soft-delete ' + tag, tags: [tag], security, middleware: [apiAccess('write')], request: { params: params(path), headers: editHeaders },
    responses: { 200: { description: 'Soft-deleted. History and restore remain available.', content: json(item) }, ...errors },
  }), async context => context.json(await write(context, kind, 'delete', {}), 200));
  resourceRoutes.openapi(createRoute({
    method: 'post', path: path + '/restore', operationId: 'restore' + tag, summary: 'Restore ' + tag, tags: [tag], security, middleware: [apiAccess('write')], request: { params: params(path), headers: editHeaders },
    responses: { 200: { description: 'Restored saved data using the deleted revision from history.', content: json(item) }, ...errors },
  }), async context => context.json(await write(context, kind, 'restore', {}), 200));
}

collection('/puppies', 'puppy', 'Puppies');
collection('/puppies/{puppyId}/logs', 'event', 'Logs');
collection('/puppies/{puppyId}/routines', 'routine', 'Routines');
collection('/puppies/{puppyId}/custom-activities', 'customActivity', 'CustomActivities');
collection('/puppies/{puppyId}/customizations', 'customization', 'Customizations');
detail('/preferences', 'accountPreferences', 'Preferences', false);
resourceRoutes.openapi(createRoute({
  method: 'post', path: '/preferences', operationId: 'createPreferences', summary: 'Create account preferences', tags: ['Preferences'], security, middleware: [apiAccess('write')],
  request: { headers: writeHeaders, body: { required: true, content: json(recordDataSchema('accountPreferences')) } },
  responses: { 201: { description: 'Creates account preferences. Use PATCH after creation.', content: json(resourceSchema('accountPreferences')) }, ...errors },
}), async context => context.json(await write(context, 'accountPreferences', 'create', recordDataSchema('accountPreferences').parse(await context.req.json())), 201));
resourceRoutes.openapi(createRoute({
  method: 'get', path: '/account', operationId: 'getAccount', summary: 'Get account summary', tags: ['Account'], security, middleware: [apiAccess('read')],
  responses: { 200: { description: 'Authenticated account and cloud summary.', content: json(z.object({ user: z.object({ id: z.string(), email: z.email(), name: z.string() }), pets: z.array(z.object({ id: z.string(), name: z.string(), eventCount: integer })) })) }, ...errors },
}), async context => context.json({ user: context.get('user'), ...await context.get('store').summary() }));
resourceRoutes.openapi(createRoute({
  method: 'get', path: '/changes', operationId: 'listChanges', summary: 'Read the account revision feed', tags: ['Sync'], security, middleware: [apiAccess('read')], request: { query: listQuery },
  responses: { 200: { description: 'Ordered revision feed, including tombstones. A record may appear multiple times. This is not the current log list.', content: json(z.object({ changes: z.array(cloudRecordSchema), cursor: integer, hasMore: z.boolean() })) }, ...errors },
}), async context => {
  const query = listQuery.parse(context.req.query());
  const page = await context.get('store').pullForClient(query.after ?? 0, query.limit);
  if (page.resyncRequired) throw new ApiError(409, 'resync_required', 'The cursor is ahead of this account. Start again with after=0.');
  return context.json(page);
});
const exportRoute = createRoute({
  method: 'get', path: '/export', operationId: 'exportAccount', summary: 'Export all account history', tags: ['Account'], security,
  responses: { 200: { description: 'Streaming NDJSON manifest, revision history, and final complete marker. Do not treat a truncated stream as a successful export.', content: { 'application/x-ndjson': { schema: z.string() } } }, ...errors },
});
resourceRoutes.openAPIRegistry.registerPath(exportRoute);
resourceRoutes.get(exportRoute.path, apiAccess('export'), context => context.get('store').exportStream());
resourceRoutes.route('/', apiKeyRoutes);
resourceRoutes.openAPIRegistry.registerComponent('securitySchemes', 'apiKey', { type: 'http', scheme: 'bearer', description: 'A scoped Puptime integration key. API keys cannot manage other keys or delete the account.' });
resourceRoutes.openAPIRegistry.registerComponent('securitySchemes', 'session', { type: 'apiKey', in: 'cookie', name: 'better-auth.session_token', description: 'A Better Auth session. HTTPS deployments use the __Secure- cookie prefix.' });
resourceRoutes.doc31('/openapi.json', context => ({
  openapi: '3.1.0', info: { title: 'Puptime API', version: '1.0.0', description: 'Versioned resource API. Time fields are Unix milliseconds. All resource writes require Idempotency-Key; updates, deletes and restores also require If-Match. Read-only integrations use the read scope. Export requires a separate export scope.' },
  servers: [{ url: new URL(context.req.url).origin + '/api/v1' }],
}));

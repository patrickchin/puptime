import { env } from 'cloudflare:workers';
import { applyD1Migrations } from 'cloudflare:test';
import { beforeAll, expect, inject, test } from 'vitest';
import { cloudRecordId } from '../src/cloud/record-identity';
import { createCloudApi } from '../src/cloud/api';
import worker from './index';

beforeAll(() => applyD1Migrations(env.AUTH_DB, inject('migrations')));
const settings = { ...env, ENVIRONMENT: 'local' as const, AUTH_BASE_URL: 'https://puptime.test', AUTH_SECRET: 'local-test-secret-with-at-least-32-characters' };
let address = 1;
async function client() {
  const ip = `198.51.100.${address++}`;
  const email = `resources-${crypto.randomUUID()}@example.invalid`;
  let cookie = '';
  const request = async (path: string, method = 'GET', body?: object | string, headers: Record<string,string> = {}) => {
    const response = await worker.fetch(new Request('https://puptime.test' + path, {
      method, headers: { origin: 'https://puptime.test', 'cf-connecting-ip': ip, ...(cookie ? { cookie } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
      ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
    }), settings);
    const updates = response.headers.getSetCookie();
    if (updates.length) cookie = updates.map(value => value.split(';')[0]).join('; ');
    return response;
  };
  expect((await request('/api/auth/email-otp/send-verification-otp', 'POST', { email, type: 'sign-in' })).status).toBe(200);
  const preview = await env.AUTH_DB.prepare('SELECT code FROM local_email_previews WHERE email=?').bind(email).first<{code:string}>();
  expect((await request('/api/auth/sign-in/email-otp', 'POST', { email, otp: preview!.code })).status).toBe(200);
  return { request, write: (path: string, method: string, body?: object, revision?: number, key = 'test_' + crypto.randomUUID()) => request('/api/v1' + path, method, body, { 'idempotency-key': key, ...(revision === undefined ? {} : { 'if-match': `"${revision}"` }) }) };
}
type Resource = { id: string; puppyId: string; revision: number; name?: string; note?: string; type?: string; deleted: boolean };
async function puppy(user: Awaited<ReturnType<typeof client>>) {
  const response = await user.write('/puppies', 'POST', { name: 'Basil' });
  expect(response.status).toBe(201);
  return response.json<Resource>();
}

test('published OpenAPI describes all resource and integration endpoints without exposing secrets', async () => {
  const response = await worker.fetch(new Request('https://puptime.test/api/v1/openapi.json'), settings);
  expect(response.status).toBe(200);
  const spec = await response.json<{openapi:string;servers:{url:string}[];paths:Record<string,Record<string,{operationId:string}>>}>();
  expect(spec.openapi).toBe('3.1.0');
  expect(spec.servers).toEqual([{ url: 'https://puptime.test/api/v1' }]);
  for (const path of ['/puppies','/puppies/{puppyId}','/puppies/{puppyId}/logs','/puppies/{puppyId}/logs/{id}', '/puppies/{puppyId}/logs/{id}/restore','/puppies/{puppyId}/logs/{id}/history','/puppies/{puppyId}/routines', '/preferences','/changes','/export','/api-keys']) expect(spec.paths).toHaveProperty(path);
  const ids = Object.values(spec.paths).flatMap(path => Object.values(path).map(operation => operation.operationId));
  expect(ids.every(Boolean)).toBe(true);
  expect(new Set(ids).size).toBe(ids.length);
  expect(JSON.stringify(spec)).not.toContain(settings.AUTH_SECRET);
});

test('HTTP resources create edit retry reject stale edits soft-delete restore and retain shared history', async () => {
  const user = await client(), pet = await puppy(user), path = `/puppies/${pet.id}/logs`;
  const body = { type: 'pee', at: 100, source: 'app', note: 'First note' };
  const created = await user.write(path, 'POST', body, undefined, 'creation-request');
  expect(created.status).toBe(201);
  const event = await created.json<Resource>();
  expect(event.id).toMatch(/^evt_[a-f0-9]{32}$/);
  expect(created.headers.get('etag')).toBe('"1"');
  expect(created.headers.get('access-control-expose-headers')).toContain('ETag');
  expect(created.headers.get('location')).toBe('/api/v1' + path + '/' + event.id);
  expect(await (await user.write(path, 'POST', { ...body }, undefined, 'creation-request')).json()).toEqual(event);
  expect((await user.write(path, 'POST', { ...body, at: 101 }, undefined, 'creation-request')).status).toBe(409);
  const detail = path + '/' + event.id;
  expect((await user.write(detail, 'PATCH', { note: 'Updated' }, 1, 'update-request')).status).toBe(200);
  expect((await user.write(detail, 'PATCH', { note: 'Overwrite' }, 1)).status).toBe(412);
  const replay = await user.write(detail, 'PATCH', { note: 'Updated' }, 1, 'update-request');
  expect(replay.status).toBe(200);
  expect((await replay.json<Resource>()).revision).toBe(2);
  const removed = await user.write(detail, 'DELETE', undefined, 2);
  expect(removed.status).toBe(200);
  expect((await removed.json<Resource>()).deleted).toBe(true);
  expect((await user.request('/api/v1' + detail)).status).toBe(404);
  expect((await (await user.request('/api/v1' + path)).json<{data:unknown[]}>()).data).toEqual([]);
  expect((await user.write(detail + '/restore', 'POST', undefined, 3)).status).toBe(200);
  const restored = await (await user.request('/api/v1' + detail)).json<Resource>();
  expect(restored.note).toBe('Updated'); expect(restored.revision).toBe(4);
  const history = await (await user.request('/api/v1' + detail + '/history')).json<{data:{revision:number;intent:string}[]}>();
  expect(history.data.map(row => row.revision)).toEqual([4,3,2,1]);
  expect(history.data.map(row => row.intent)).toEqual(['restore','delete','patch','create']);
  const changes = await (await user.request('/api/v1/changes')).json<{changes:{id:string}[]}>();
  expect(changes.changes.filter(row => row.id === cloudRecordId('event', pet.id, event.id))).toHaveLength(4);
  expect((await user.request('/api/v1/changes?after=9999')).status).toBe(409);
});

test('resource API and the installed mobile SDK read and write one canonical record and change feed', async () => {
  const user = await client(), pet = await puppy(user);
  // Transport uses the real HTTP endpoints; the SDK validates every response.
  const mobile = createCloudApi(async (path, options) => {
    const response = await user.request(path, options.method, options.body);
    return { data: await response.json(), error: response.ok ? null : { status: response.status } };
  });
  await mobile.enroll({ operationId: 'sdk-enroll', deviceId: 'sdk-device', localPetId: 'local-copy', name: 'Basil', confirmedPetId: pet.id });
  const response = await user.write(`/puppies/${pet.id}/logs`, 'POST', { type: 'meal', at: 100, source: 'app' });
  const event = await response.json<Resource>();
  const page = await mobile.pull(0);
  const record = page.changes.find(row => row.id === cloudRecordId('event', pet.id, event.id))!;
  expect(record.revision).toBe(1);
  const push = await mobile.push([{ protocolVersion: 1, operationId: 'sdk-edit', deviceId: 'sdk-device', recordId: record.id, petId: pet.id, kind: 'event', baseRevision: 1, intent: 'patch', patch: { note: 'Phone edit' } }]);
  expect(push.rejected).toEqual([]);
  const updated = await (await user.request(`/api/v1/puppies/${pet.id}/logs/${event.id}`)).json<Resource>();
  expect(updated.note).toBe('Phone edit'); expect(updated.revision).toBe(2);
});

test('SQL-backed resource lists filter time and type and paginate current logs', async () => {
  const user = await client(), pet = await puppy(user), path = `/puppies/${pet.id}/logs`;
  for (const [type,at] of [['pee',100],['meal',200],['pee',300],['pee',400]] as const) expect((await user.write(path,'POST',{type,at,source:'app'})).status).toBe(201);
  const first = await (await user.request('/api/v1' + path + '?since=100&until=400&type=pee&limit=1')).json<{data:{at:number}[];nextCursor:number}>();
  expect(first.data.map(row=>row.at)).toEqual([100]); expect(first.nextCursor).toBeGreaterThan(0);
  const next = await (await user.request('/api/v1' + path + '?since=100&until=400&type=pee&limit=1&after=' + first.nextCursor)).json<{data:{at:number}[];nextCursor:number|null}>();
  expect(next.data.map(row=>row.at)).toEqual([300]); expect(next.nextCursor).toBeNull();
  expect((await user.request('/api/v1' + path + '?since=400&until=100')).status).toBe(400);
});

test('routines preferences and activity configuration share validation and semantic identity with mobile', async () => {
  const user = await client();
  const preferences = await user.write('/preferences', 'POST', { language: 'es' });
  expect(preferences.status).toBe(201); expect(preferences.headers.get('location')).toBe('/api/v1/preferences');
  expect((await user.write('/preferences','PATCH',{language:'en'},1)).status).toBe(200);
  const pet = await puppy(user), base = `/puppies/${pet.id}`;
  const routine = await user.write(base + '/routines','POST',{type:'meal',minutes:420,reminder:true});
  expect(routine.status).toBe(201); expect((await routine.json<Resource>()).id).toMatch(/^rtn_/);
  const custom = await user.write(base + '/custom-activities','POST',{label:'Training'});
  expect(custom.status).toBe(201); expect((await custom.json<Resource>()).id).toBe('custom:training');
  const customization = await user.write(base + '/customizations','POST',{activityKey:'pee',color:2});
  expect(customization.status).toBe(201); expect((await customization.json<Resource>()).id).toBe('pee');
  expect((await user.write(base + '/customizations/pee','PATCH',{activityKey:'poop'},1)).status).toBe(400);
});

test('all resource boundaries reject malformed missing oversized and cross-account requests without mutation', async () => {
  const user = await client(), other = await client(), pet = await puppy(user), path = `/puppies/${pet.id}/logs`;
  const invalid = await user.write(path,'POST',{type:'custom',at:1,source:'app'});
  expect(invalid.status).toBe(400); expect(invalid.headers.get('x-request-id')).toMatch(/^req_/);
  expect((await invalid.json<{error:{requestId:string}}>()).error.requestId).toBe(invalid.headers.get('x-request-id'));
  expect((await user.request('/api/v1' + path,'POST',{type:'pee',at:1,source:'app'})).status).toBe(428);
  expect((await user.request('/api/v1' + path,'POST','{bad',{'idempotency-key':'valid-key'})).status).toBe(400);
  const event = await (await user.write(path,'POST',{type:'pee',at:1,source:'app'})).json<Resource>();
  expect((await user.request('/api/v1' + path + '/' + event.id,'PATCH',{note:'missing etag'},{'idempotency-key':'missing-etag'})).status).toBe(428);
  expect((await user.write(path + '/' + event.id,'PATCH',{ownerId:'steal'},1)).status).toBe(400);
  expect((await user.write('/puppies/' + pet.id,'DELETE',undefined,1)).status).toBe(404);
  expect((await other.request('/api/v1' + path + '/' + event.id)).status).toBe(404);
  expect((await other.request('/api/v1' + path)).status).toBe(404);
  expect((await other.write(path + '/' + event.id,'PATCH',{note:'Other owner'},1)).status).toBe(404);
  expect((await other.write(path,'POST',{type:'pee',at:1,source:'app'})).status).toBe(404);
  const large = await user.request('/api/v1' + path,'POST',{note:'x'.repeat(65536)},{'idempotency-key':'large-request'});
  expect(large.status).toBe(413); expect(await large.json()).toMatchObject({error:{code:'payload_too_large',requestId:expect.stringMatching(/^req_/)}});
  expect((await (await user.request('/api/v1' + path)).json<{data:unknown[]}>()).data).toHaveLength(1);
  const missing = await user.request('/api/v1/not-a-route');
  expect(missing.status).toBe(404);
  expect(await missing.json()).toMatchObject({ error: { code: 'not_found', requestId: expect.stringMatching(/^req_/) } });
});

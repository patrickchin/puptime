import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

// Uses only public HTTP endpoints. Supply a fresh, disposable fixture session;
// never point write qualification at a personal account.
export async function qualifyResourceApi({ origin, cookie }) {
  const base = new URL(origin);
  assert(['http:', 'https:'].includes(base.protocol) && base.pathname === '/', 'Use an API origin without a path.');
  const checks = [];
  const call = async (path, { method = 'GET', body, key, headers = {}, expected = 200 } = {}) => {
    const response = await fetch(base.origin + path, {
      method, redirect: 'error', signal: AbortSignal.timeout(30000),
      headers: { ...(key ? { authorization: `Bearer ${key}` } : { cookie, origin: base.origin }), ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    // Do not include secret-bearing response bodies in an assertion failure.
    assert.equal(response.status, expected, `${method} ${path}: expected ${expected}, got ${response.status}, request ${response.headers.get('x-request-id')}`);
    return response;
  };
  const v1 = (path, options) => call('/api/v1' + path, options);
  const mutate = (path, method, body, revision, key, idempotency = crypto.randomUUID()) => v1(path, { method, body, key, expected: method === 'POST' && !path.endsWith('/restore') ? 201 : 200,
    headers: { 'idempotency-key': idempotency, ...(revision === undefined ? {} : { 'if-match': `"${revision}"` }) } });
  const account = await (await v1('/account')).json();
  assert(account.user.email.endsWith('@example.invalid') && account.user.email.startsWith('api-qualification-'), 'Write qualification requires an api-qualification-…@example.invalid fixture account.');
  assert.equal(account.pets.length, 0, 'Fixture account must be empty.');
  const spec = await (await v1('/openapi.json')).json();
  assert.equal(spec.openapi, '3.1.0');
  checks.push('OpenAPI discovery and fixture isolation');
  let deleted = false;
  try {
    const makeKey = async scopes => (await v1('/api-keys', { method: 'POST', body: { name: 'Disposable API qualification', scopes, expiresInDays: 1 }, expected: 201 })).json();
    const reader = await makeKey(['read']), writer = await makeKey(['read', 'write']), exporter = await makeKey(['export']);
    const pet = await (await mutate('/puppies', 'POST', { name: 'API qualification fixture' }, undefined, writer.key)).json();
    assert.match(pet.id, /^pet_[a-f0-9]{32}$/);
    const path = `/puppies/${pet.id}/logs`, creation = crypto.randomUUID(), body = { type: 'pee', at: Date.now(), source: 'app', note: 'Disposable HTTP qualification fixture' };
    const created = await mutate(path, 'POST', body, undefined, writer.key, creation);
    const event = await created.json();
    assert.equal(created.headers.get('etag'), '"1"');
    assert.deepEqual(await (await mutate(path, 'POST', body, undefined, writer.key, creation)).json(), event);
    const detail = path + '/' + encodeURIComponent(event.id);
    const edited = await (await mutate(detail, 'PATCH', { note: 'Edited over HTTP' }, 1, writer.key)).json();
    assert.equal(edited.revision, 2);
    await v1(detail, { method: 'PATCH', body: { note: 'Stale' }, key: writer.key, headers: { 'if-match': '"1"', 'idempotency-key': crypto.randomUUID() }, expected: 412 });
    await v1(path, { method: 'POST', body, key: reader.key, headers: { 'idempotency-key': crypto.randomUUID() }, expected: 403 });
    checks.push('Scoped writes, create replay, strict ETags, stale-edit and read-only rejection');
    assert.equal((await (await v1(path + '?type=pee&since=' + body.at + '&until=' + (body.at + 1), { key: reader.key })).json()).data.length, 1);
    const changes = await (await v1('/changes', { key: reader.key })).json();
    assert.equal(changes.changes.filter(record => record.kind === 'event').length, 2);
    await call('/api/cloud/enroll', { method: 'POST', body: { operationId: crypto.randomUUID(), deviceId: 'dev_api_qualification', localPetId: 'pet_local_qualification', name: 'API qualification fixture', confirmedPetId: pet.id } });
    const mobilePage = await (await call('/api/sync/pull?after=0')).json();
    const synced = mobilePage.changes.filter(record => record.kind === 'event').at(-1);
    assert.equal(synced.data.note, 'Edited over HTTP');
    const pushed = await (await call('/api/sync/push', { method: 'POST', body: { mutations: [{ protocolVersion: 1, operationId: crypto.randomUUID(), deviceId: 'dev_api_qualification', recordId: synced.id, petId: pet.id, kind: 'event', intent: 'patch', baseRevision: 2, patch: { note: 'Mobile protocol edit' } }] } })).json();
    assert.equal(pushed.accepted.length, 1);
    assert.equal((await (await v1(detail, { key: reader.key })).json()).note, 'Mobile protocol edit');
    checks.push('SQL time/type filtering and bidirectional mobile/API interoperability');
    await mutate(detail, 'DELETE', undefined, 3, writer.key);
    await v1(detail, { key: reader.key, expected: 404 });
    await mutate(detail + '/restore', 'POST', undefined, 4, writer.key);
    assert.equal((await (await v1(detail + '/history', { key: reader.key })).json()).data.length, 5);
    const exported = await v1('/export', { key: exporter.key });
    const lines = (await exported.text()).trim().split('\n').map(line => JSON.parse(line));
    assert.equal(lines.at(-1).type, 'complete');
    await v1('/export', { key: reader.key, expected: 403 });
    await v1('/api-keys/' + reader.apiKey.id, { method: 'DELETE', expected: 204 });
    await v1('/account', { key: reader.key, expected: 401 });
    checks.push('Soft-delete, restore, revision history, complete export, and immediate key revocation');
  } finally {
    // Use the real account lifecycle, with the same recent-auth requirement.
    await call('/api/account', { method: 'DELETE', body: { confirm: true }, expected: 200 });
    deleted = true;
  }
  checks.push('Disposable account and API-key cleanup');
  return { status: 'passed', origin: base.origin, checks, fixtureDeleted: deleted };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const cookie = process.env.PUPTIME_API_TEST_COOKIE;
  assert(cookie, 'Provide PUPTIME_API_TEST_COOKIE for a fresh disposable fixture account.');
  console.log(JSON.stringify(await qualifyResourceApi({ origin: process.env.PUPTIME_API_URL ?? 'http://localhost:8787', cookie }), null, 2));
}

// Administrative staging fixtures exercise deployed identity/session and storage.
// They do not verify email delivery or social-provider sign-in.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serializeSignedCookie } from 'better-call';

const base = 'https://puptime-api-staging.p-ch.workers.dev';
const secret = process.env.PUPTIME_STAGING_AUTH_SECRET;
assert(secret?.length >= 32, 'Supply the staging AUTH_SECRET through PUPTIME_STAGING_AUTH_SECRET.');
const directory = mkdtempSync(join(tmpdir(), 'puptime-staging-'));
const fixtures = [];
function sql(query) {
  const path = join(directory, 'fixture.sql');
  writeFileSync(path, query, { mode: 0o600 });
  try {
    execFileSync('npx', ['wrangler', 'd1', 'execute', 'AUTH_DB', '--env', 'staging', '--remote', '--file', path, '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch { throw new Error('Administrative staging SQL failed; private fixture output withheld.'); }
}
async function fixture() {
  const id = crypto.randomUUID(), token = crypto.randomUUID(), now = Date.now();
  const cookie = (await serializeSignedCookie('__Secure-better-auth.session_token', token, secret, { secure: true, httpOnly: true, path: '/' })).split(';')[0];
  const user = { id, cookie }; fixtures.push(user);
  sql(`INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES ('${id}','Staging fixture','${id}@example.invalid',1,${now},${now});
    INSERT INTO session(id,token,userId,expiresAt,createdAt,updatedAt) VALUES ('${crypto.randomUUID()}','${token}','${id}',${now + 3600000},${now},${now});`);
  return user;
}
async function request(user, path, { method = 'GET', body, status = 200, origin = 'https://puptime.pages.dev' } = {}) {
  const response = await fetch(`${base}${path}`, { method, headers: {
    origin, ...(user ? { cookie: user.cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}),
  }, ...(body ? { body: JSON.stringify(body) } : {}) });
  assert.equal(response.status, status, `${method} ${path}: expected ${status}, received ${response.status}`);
  return response;
}
const json = async (...args) => (await request(...args)).json();
function mutation(recordId = 'fixture-event') {
  return { protocolVersion: 1, operationId: crypto.randomUUID(), deviceId: 'fixture-device', recordId, petId: 'fixture-pet', kind: 'event', baseRevision: 0, intent: 'create', patch: { type: 'pee', at: Date.now(), source: 'app', note: 'Synthetic private note' } };
}
async function push(user, mutations) { return json(user, '/api/sync/push', { method: 'POST', body: { mutations } }); }
try {
  assert.equal((await json(null, '/health')).status, 'ok');
  const config = await json(null, '/api/config');
  assert.equal(config.pricingFinalized, false);
  assert.equal(config.providers.email, false);
  await request(null, '/api/account', { status: 401 });
  await request(null, '/api/accounts/arbitrary/pull', { status: 404 });
  await request(null, '/api/auth/email-otp/send-verification-otp', { method: 'POST', body: { email: 'fixture@example.invalid', type: 'sign-in' }, status: 503 });
  console.log('PASS public health, anonymous isolation, and unconfigured email fails closed');

  const user = await fixture(), other = await fixture();
  const account = await json(user, '/api/account');
  assert.equal(account.user.id, user.id); assert.equal(account.cloud.canSync, false); assert.deepEqual(account.pets, []);
  await request(user, '/api/sync/pull', { status: 402 });
  await request(user, '/api/cloud/trial', { method: 'POST', body: {}, origin: 'https://untrusted.example', status: 403 });
  await request(user, '/api/cloud/trial', { method: 'POST', body: { accountId: other.id }, status: 400 });
  await request(user, '/api/cloud/trial', { method: 'POST', body: {} });
  const enrollment = { operationId: crypto.randomUUID(), deviceId: 'fixture-device', localPetId: 'fixture-pet', name: 'Test puppy' };
  assert.deepEqual(await json(user, '/api/cloud/enroll', { method: 'POST', body: enrollment }), { petId: 'fixture-pet' });
  const first = mutation();
  assert.equal((await push(user, [first])).accepted.length, 1);
  await push(user, [first]);
  assert.equal((await json(user, '/api/records/fixture-event/history')).revisions.length, 1);
  const concurrent = { ...first, operationId: crypto.randomUUID(), intent: 'patch', baseRevision: 1, patch: { note: 'Synthetic edit' } };
  await push(user, [concurrent]);
  const merged = await push(user, [{ ...concurrent, operationId: crypto.randomUUID(), patch: { at: first.patch.at + 1000 } }]);
  assert.equal(merged.accepted[0].reason, 'merged');
  assert.equal(merged.accepted[0].record.data.note, 'Synthetic edit');
  assert.equal((await push(user, [{ ...mutation('missing'), intent: 'patch', patch: { note: 'missing record' } }, mutation('second-event')])).rejected.length, 1);
  assert.equal((await json(user, '/api/sync/pull?after=999999')).resyncRequired, true);
  assert.equal((await json(other, '/api/account')).pets.length, 0);
  const attach = { ...enrollment, operationId: crypto.randomUUID(), deviceId: 'fixture-second-device', localPetId: 'second-local-pet' };
  await request(user, '/api/cloud/enroll', { method: 'POST', body: attach, status: 409 });
  await request(user, '/api/cloud/enroll', { method: 'POST', body: { ...attach, confirmedPetId: 'fixture-pet' } });
  console.log('PASS authenticated ownership, explicit activation/association, retries, partial batches, and automatic merge');

  sql(`UPDATE cloud_accounts SET trial_started_at=0,trial_ends_at=1 WHERE account_id='${user.id}';`);
  await request(user, '/api/sync/pull', { status: 402 });
  const exported = (await (await request(user, '/api/account/export')).text()).trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(exported[0].type, 'manifest'); assert.equal(exported.at(-1).type, 'complete');
  assert(exported.some((line) => line.type === 'revision' && line.after.data.note === 'Synthetic private note'));
  assert.equal(JSON.stringify(exported).includes(user.cookie), false);
  await request(user, '/api/account', { method: 'DELETE', body: { confirm: false }, status: 400 });
  sql(`UPDATE session SET createdAt=0 WHERE userId='${user.id}';`);
  await request(user, '/api/account', { method: 'DELETE', body: { confirm: true }, status: 401 });
  sql(`UPDATE session SET createdAt=${Date.now()} WHERE userId='${user.id}';`);
  await request(user, '/api/account', { method: 'DELETE', body: { confirm: true } });
  await request(user, '/api/account', { status: 401 });
  await request(user, '/api/account/export', { status: 401 });
  await request(user, '/api/sync/push', { method: 'POST', body: { mutations: [mutation()] }, status: 401 });
  console.log('PASS expiry retains full export, deletion confirmation/reauthentication, session revocation, and old-device rejection');
} finally {
  for (const user of fixtures) {
    // Run normal retirement even after a failed assertion; remove fixture identity only after it succeeds.
    sql(`UPDATE session SET createdAt=${Date.now()} WHERE userId='${user.id}';`);
    const response = await fetch(`${base}/api/account`, { method: 'DELETE', headers: { origin: 'https://puptime.pages.dev', cookie: user.cookie, 'content-type': 'application/json' }, body: JSON.stringify({ confirm: true }) });
    if (![200, 401].includes(response.status)) console.error(`Fixture cleanup requires attention (${response.status}).`);
  }
  rmSync(directory, { recursive: true, force: true });
}

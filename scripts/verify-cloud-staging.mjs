// Administrative staging fixtures exercise deployed identity/session and storage.
// They do not verify email delivery or social-provider sign-in.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serializeSignedCookie } from 'better-call';
import {cloudRecordId} from '../src/cloud/record-identity.ts';

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
async function issueSession(user) {
  const token=crypto.randomUUID(),now=Date.now(),created=new Date(now).toISOString(),expires=new Date(now+3600000).toISOString();
  const cookie=(await serializeSignedCookie('__Secure-better-auth.session_token',token,secret,{secure:true,httpOnly:true,path:'/'})).split(';')[0];
  sql(`INSERT INTO session(id,token,userId,expiresAt,createdAt,updatedAt) VALUES ('${crypto.randomUUID()}','${token}','${user.id}','${expires}','${created}','${created}');`);
  user.cookie=cookie;
}
async function fixture() {
  const id=crypto.randomUUID(),now=new Date().toISOString(),user={id,cookie:'',deleted:false};fixtures.push(user);
  sql(`INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES ('${id}','Staging fixture','${id}@example.invalid',1,'${now}','${now}');`);
  await issueSession(user);return user;
}
async function request(user, path, { method = 'GET', body, status = 200, origin = 'https://puptime.pages.dev' } = {}) {
  const response = await fetch(`${base}${path}`, { method, headers: {
    origin, ...(user ? { cookie: user.cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}),
  }, ...(body ? { body: JSON.stringify(body) } : {}), redirect:'error',signal:AbortSignal.timeout(15000) });
  assert.equal(response.status, status, `${method} ${path}: expected ${status}, received ${response.status}`);
  return response;
}
const json = async (...args) => (await request(...args)).json();
function mutation(recordId = 'fixture-event') {
  return { protocolVersion: 1, operationId: crypto.randomUUID(), deviceId: 'fixture-device', recordId:cloudRecordId('event','fixture-pet',recordId), petId: 'fixture-pet', kind: 'event', baseRevision: 0, intent: 'create', patch: { type: 'pee', at: Date.now(), source: 'app', note: 'Synthetic private note' } };
}
async function push(user, mutations) { return json(user, '/api/sync/push', { method: 'POST', body: { mutations } }); }
try {
  assert.equal((await json(null, '/health')).status, 'ok');
  const config = await json(null, '/api/config');
  assert.deepEqual(Object.keys(config).sort(),['protocolVersion','providers']);assert.equal(config.protocolVersion,1);
  assert.deepEqual(Object.keys(config.providers).sort(),['apple','email','google']);assert.ok(Object.values(config.providers).every(value=>typeof value==='boolean'));
  await request(null, '/api/account', { status: 401 });
  await request(null, '/api/accounts/arbitrary/pull', { status: 404 });
  if(!config.providers.email)await request(null, '/api/auth/email-otp/send-verification-otp', { method: 'POST', body: { email: 'fixture@example.invalid', type: 'sign-in' }, status: 503 });
  console.log('PASS public health/configuration and anonymous isolation; unconfigured email fails closed when disabled, without sending test mail through a configured provider.');

  const user = await fixture(), other = await fixture();
  const account = await json(user, '/api/account');
  assert.equal(account.user.id, user.id); assert.deepEqual(account.cloud,{canSync:true,canExport:true}); assert.deepEqual(account.pets, []);
  assert.deepEqual((await json(user,'/api/sync/pull')).changes,[]);
  await request(user,'/api/cloud/trial',{method:'POST',body:{},status:404});
  const enrollment = { operationId: crypto.randomUUID(), deviceId: 'fixture-device', localPetId: 'fixture-pet', name: 'Test puppy' };
  await request(user,'/api/cloud/enroll',{method:'POST',body:enrollment,origin:'https://untrusted.example',status:403});
  await request(user,'/api/cloud/enroll',{method:'POST',body:{...enrollment,accountId:other.id},status:400});
  assert.deepEqual(await json(user, '/api/cloud/enroll', { method: 'POST', body: enrollment }), { petId: 'fixture-pet' });
  const first = mutation();
  assert.equal((await push(user, [first])).accepted.length, 1);
  await push(user, [first]);
  assert.equal((await json(user, '/api/records/'+encodeURIComponent(first.recordId)+'/history')).revisions.length, 1);
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
  console.log('PASS authenticated ownership, immediate development access/explicit puppy association, retries, partial batches, and automatic merge');

  const beforeSessionLoss=await json(user,'/api/sync/pull');
  sql(`UPDATE session SET expiresAt='${new Date(0).toISOString()}' WHERE userId='${user.id}';`);
  await request(user,'/api/sync/pull',{status:401});await request(user,'/api/account/export',{status:401});
  const expiredCookie=user.cookie;await issueSession(user);assert.notEqual(user.cookie,expiredCookie);
  assert.equal((await json(user,'/api/account')).user.id,user.id);assert.deepEqual(await json(user,'/api/sync/pull'),beforeSessionLoss);
  const exported = (await (await request(user, '/api/account/export')).text()).trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(exported[0].type, 'manifest'); assert.equal(exported.at(-1).type, 'complete');
  assert(exported.some((line) => line.type === 'revision' && line.after.data.note === 'Synthetic private note'));
  assert.equal(JSON.stringify(exported).includes(user.cookie), false);
  await request(user, '/api/account', { method: 'DELETE', body: { confirm: false }, status: 400 });
  sql(`UPDATE session SET createdAt='${new Date(0).toISOString()}' WHERE userId='${user.id}';`);
  await request(user, '/api/account', { method: 'DELETE', body: { confirm: true }, status: 401 });
  sql(`UPDATE session SET createdAt='${new Date().toISOString()}' WHERE userId='${user.id}';`);
  await request(user, '/api/account', { method: 'DELETE', body: { confirm: true } });user.deleted=true;
  await request(user, '/api/account', { status: 401 });
  await request(user, '/api/account/export', { status: 401 });
  await request(user, '/api/sync/push', { method: 'POST', body: { mutations: [mutation()] }, status: 401 });
  console.log('PASS actual session-row expiry denies private access and administrative renewal preserves the full cloud copy/export; deletion confirmation/freshness and old-device rejection remain enforced (no provider/SDK-login claim)');
} finally {
  let cleaned=true;
  for(const user of fixtures){
    if(user.deleted)continue;
    try{
      await issueSession(user);
      await request(user,'/api/account',{method:'DELETE',body:{confirm:true}});user.deleted=true;
    }catch{cleaned=false;console.error('Synthetic fixture cleanup requires attention.');}
  }
  if(cleaned)rmSync(directory,{recursive:true,force:true});else{
    writeFileSync(join(directory,'fixture.sql'),'-- private fixture SQL removed\n',{mode:0o600});
    writeFileSync(join(directory,'fixture-metadata.json'),JSON.stringify({base,owners:fixtures.filter(user=>!user.deleted).map(user=>user.id)}),{mode:0o600});
    console.error('Synthetic recovery identifiers retained at',directory);process.exitCode=1;
  }
}

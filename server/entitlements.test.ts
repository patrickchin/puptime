import { env } from 'cloudflare:workers';
import { applyD1Migrations } from 'cloudflare:test';
import { beforeAll, expect, inject, test } from 'vitest';
import { activateTrial, cloudAccess, getCloudAccount, type CloudAccount } from './entitlements';

beforeAll(() => applyD1Migrations(env.AUTH_DB, inject('migrations')));
const account: CloudAccount = { accountId: 'user-1', trialStartedAt: 1000, trialEndsAt: 2000, paidUntil: null, state: 'active' };

test('trial expiry stops sync at the boundary while manual export remains available', () => {
  expect(cloudAccess(account, 1999)).toEqual({ canSync: true, canExport: true, source: 'trial', expiresAt: 2000 });
  expect(cloudAccess(account, 2000)).toEqual({ canSync: false, canExport: true, source: 'none', expiresAt: null });
  expect(cloudAccess(null, 2000)).toEqual({ canSync: false, canExport: true, source: 'none', expiresAt: null });
});

test('paid and trial windows grant access only while actually valid', () => {
  expect(cloudAccess({ ...account, paidUntil: 3000 }, 2500)).toEqual({ canSync: true, canExport: true, source: 'paid', expiresAt: 3000 });
  expect(cloudAccess({ ...account, paidUntil: 1500 }, 1250).expiresAt).toBe(2000);
  expect(cloudAccess({ ...account, trialStartedAt: 5000, trialEndsAt: 6000 }, 4000).canSync).toBe(false);
  expect(cloudAccess({ ...account, state: 'deleting' }, 1500)).toEqual({ canSync: false, canExport: false, source: 'none', expiresAt: null });
});

test('explicit trial activation is atomic and repeated activation never restarts an expired trial', async () => {
  const accountId = crypto.randomUUID();
  await env.AUTH_DB.prepare('INSERT INTO user(id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, 0, 0)')
    .bind(accountId, 'Test owner', `${accountId}@example.com`).run();
  expect(await getCloudAccount(env.AUTH_DB, accountId)).toBeNull();
  const [first, simultaneous] = await Promise.all([activateTrial(env.AUTH_DB, accountId, 1000), activateTrial(env.AUTH_DB, accountId, 1000)]);
  expect(first).toEqual(simultaneous);
  expect(first.trialStartedAt).toBe(1000);
  expect(first.trialEndsAt).toBe(1209601000);
  expect((await activateTrial(env.AUTH_DB, accountId, 1300000000)).trialEndsAt).toBe(1209601000);
  expect(cloudAccess(await getCloudAccount(env.AUTH_DB, accountId), 1300000000).canExport).toBe(true);
});

test('invalid duration and nonexistent identities cannot create cloud access', async () => {
  await expect(activateTrial(env.AUTH_DB, 'unknown-user', 1000)).rejects.toThrow();
  for (const duration of [0, -1, 31, 0.5]) await expect(activateTrial(env.AUTH_DB, 'unknown-user', 1000, duration)).rejects.toThrow();
  expect(await getCloudAccount(env.AUTH_DB, 'unknown-user')).toBeNull();
});

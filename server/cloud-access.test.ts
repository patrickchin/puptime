import { env } from 'cloudflare:workers';
import { applyD1Migrations } from 'cloudflare:test';
import { beforeAll, expect, inject, test } from 'vitest';
import { cloudAccess, getCloudAccount } from './cloud-access';

beforeAll(() => applyD1Migrations(env.AUTH_DB, inject('migrations')));

test('development cloud access needs no billing record and deletion remains fenced', () => {
  expect(cloudAccess(null)).toEqual({ canSync: true, canExport: true });
  expect(cloudAccess({ accountId: 'owner', state: 'active' })).toEqual({ canSync: true, canExport: true });
  expect(cloudAccess({ accountId: 'owner', state: 'deleting' })).toEqual({ canSync: false, canExport: false });
});

test('fresh account metadata has only ownership and cleanup state, with a real identity foreign key', async () => {
  const {results:columns} = await env.AUTH_DB.prepare('PRAGMA table_info(cloud_accounts)').all<{name:string}>();
  expect(columns.map(column=>column.name)).toEqual(['account_id','state']);
  const id = crypto.randomUUID();
  expect(await getCloudAccount(env.AUTH_DB,id)).toBeNull();
  await expect(env.AUTH_DB.prepare('INSERT INTO cloud_accounts(account_id) VALUES (?)').bind(id).run()).rejects.toThrow();
  await env.AUTH_DB.prepare('INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,?,1,0,0)')
    .bind(id,'Test owner',`${id}@example.invalid`).run();
  await env.AUTH_DB.prepare('INSERT INTO cloud_accounts(account_id) VALUES (?)').bind(id).run();
  expect(await getCloudAccount(env.AUTH_DB,id)).toEqual({accountId:id,state:'active'});
  await env.AUTH_DB.prepare('DELETE FROM user WHERE id=?').bind(id).run();
  expect(await getCloudAccount(env.AUTH_DB,id)).toBeNull();
});

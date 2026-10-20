import { env } from 'cloudflare:workers';
import { applyD1Migrations } from 'cloudflare:test';
import { beforeAll, expect, inject, test } from 'vitest';
import { hashCapability } from './account-reauth';

const migrations = inject('migrations');
beforeAll(() => applyD1Migrations(env.AUTH_DB, migrations.filter(migration => !migration.name.startsWith('0006'))));

test('completion migration preserves known expired outcomes without owners and leaves active recovery bindings intact', async () => {
  const owner = crypto.randomUUID(), liveCompleted = crypto.randomUUID();
  for (const id of [owner, liveCompleted]) await env.AUTH_DB.prepare('INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,?,?,1,0,0)').bind(id, 'Synthetic', id + '@example.invalid').run();
  const pending = await hashCapability(crypto.randomUUID()), invalid = await hashCapability(crypto.randomUUID());
  await env.AUTH_DB.prepare("INSERT INTO account_deletion_receipts(receipt_hash,account_id,phase,created_at,expires_at) VALUES(?,?,'deleting',0,1)").bind(pending, owner).run();
  await env.AUTH_DB.prepare("INSERT INTO account_deletion_receipts(receipt_hash,account_id,phase,apple_revocation,created_at,expires_at) VALUES(?,?,'completed','manual',0,1)").bind(invalid, liveCompleted).run();
  await env.AUTH_DB.prepare("INSERT INTO account_recovery_intents(id,receipt_hash,account_id,method,identity_value,created_at,expires_at) VALUES(?,?,?,'email',?,0,9999999999999)").bind(crypto.randomUUID(), pending, owner, owner + '@example.invalid').run();
  const active = (await env.AUTH_DB.prepare('SELECT * FROM account_deletion_receipts ORDER BY receipt_hash').all()).results;
  const intents = (await env.AUTH_DB.prepare('SELECT * FROM account_recovery_intents').all()).results;
  const known = [];
  for (const outcome of ['not-linked', 'revoked', 'manual']) for (const expiry of [1, 9999999999999]) {
    const hash = await hashCapability(crypto.randomUUID()); known.push({ receipt_hash: hash, apple_revocation: outcome });
    await env.AUTH_DB.prepare("INSERT INTO account_deletion_receipts(receipt_hash,account_id,phase,apple_revocation,created_at,expires_at) VALUES(?,?,'completed',?,0,?)").bind(hash, crypto.randomUUID(), outcome, expiry).run();
  }
  await applyD1Migrations(env.AUTH_DB, migrations);
  expect((await env.AUTH_DB.prepare('SELECT * FROM account_deletion_completions ORDER BY receipt_hash').all()).results).toEqual(known.sort((a, b) => a.receipt_hash.localeCompare(b.receipt_hash)));
  expect((await env.AUTH_DB.prepare('SELECT * FROM account_deletion_receipts ORDER BY receipt_hash').all()).results).toEqual(active);
  expect((await env.AUTH_DB.prepare('SELECT * FROM account_recovery_intents').all()).results).toEqual(intents);
  expect((await env.AUTH_DB.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
  expect((await env.AUTH_DB.prepare('PRAGMA table_info(account_deletion_completions)').all<{ name: string }>()).results.map(row => row.name)).toEqual(['receipt_hash', 'apple_revocation']);
  expect((await env.AUTH_DB.prepare('PRAGMA foreign_key_list(account_deletion_completions)').all()).results).toEqual([]);
  await expect(env.AUTH_DB.prepare('INSERT INTO account_deletion_completions VALUES(?,?)').bind('short', 'manual').run()).rejects.toThrow();
  await expect(env.AUTH_DB.prepare('INSERT INTO account_deletion_completions VALUES(?,?)').bind('0'.repeat(64), 'invented').run()).rejects.toThrow();
});

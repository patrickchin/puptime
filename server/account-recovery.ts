import { APIError, getOAuthState } from 'better-auth/api';
import type { ValidateUserInfoSource } from '@better-auth/core';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { expectedAccountSchema, hashCapability, lifecycleError } from './account-reauth';
import { deletionReceiptSchema, usableReceiptSql } from './account-lifecycle';

export const recoveryMode = 'account-deletion-recovery';
export const recoveryReceiptInput = z.strictObject({ receipt: deletionReceiptSchema });
export const recoveryVerifyInput = recoveryReceiptInput.extend({ intentId: z.uuid(), otp: z.string().regex(/^\d{6}$/) });
export const recoveryCancelInput = recoveryReceiptInput.extend({ intentId: z.uuid() });
export const recoverySocialInput = recoveryReceiptInput.extend({
  provider: z.enum(['apple', 'google']), callbackURL: z.string().max(2048),
  errorCallbackURL: z.string().max(2048).optional(), disableRedirect: z.boolean().optional(), requestSignUp: z.literal(false).optional(),
});
const bindingSchema = z.strictObject({ id: z.uuid(), receiptHash: z.string().length(64), accountId: expectedAccountSchema,
  method: z.enum(['email', 'apple', 'google']), accountRowId: z.string().min(1).max(256).nullable() });
export type RecoveryIntent = z.infer<typeof bindingSchema> & { identity: string; createdAt: number; expiresAt: number };
type IntentRow = { id: string; receipt_hash: string; account_id: string; method: RecoveryIntent['method']; provider_account_id: string | null; identity_value: string; created_at: number; expires_at: number };

export function recoveryUnavailable(): never { lifecycleError(403, 'recovery_unavailable'); }
export function recoveryDenied(): never { throw new APIError('FORBIDDEN', { code: 'RECOVERY_UNAVAILABLE', message: 'Recovery unavailable.' }); }
export function recoveryBinding(intent: RecoveryIntent) {
  return { id: intent.id, receiptHash: intent.receiptHash, accountId: intent.accountId, method: intent.method, accountRowId: intent.accountRowId };
}
function fromRow(row: IntentRow): RecoveryIntent {
  return { id: row.id, receiptHash: row.receipt_hash, accountId: row.account_id, method: row.method, accountRowId: row.provider_account_id,
    identity: row.identity_value, createdAt: row.created_at, expiresAt: row.expires_at };
}
export async function recoveryOwner(db: D1Database, receipt: string, expected: string) {
  const hash = await hashCapability(receipt), now = Date.now();
  const owner = await db.prepare(`SELECT u.id,u.email FROM user u JOIN account_deletion_receipts r ON r.account_id=u.id
    WHERE r.receipt_hash=? AND r.account_id=? AND r.phase!='completed' AND u.emailVerified=1 AND ${usableReceiptSql('r')}`)
    .bind(hash, expected, now).first<{ id: string; email: string }>();
  if (!owner) recoveryUnavailable();
  return { ...owner, receiptHash: hash };
}
export async function newRecoveryIntent(db: D1Database, receipt: string, expected: string, method: RecoveryIntent['method']): Promise<RecoveryIntent> {
  const owner = await recoveryOwner(db, receipt, expected), now = Date.now();
  let identity = owner.email, accountRowId: string | null = null;
  if (method !== 'email') {
    const { results } = await db.prepare('SELECT id,accountId FROM account WHERE userId=? AND providerId=?').bind(owner.id, method).all<{ id: string; accountId: string }>();
    if (results.length !== 1) recoveryUnavailable();
    identity = results[0].accountId; accountRowId = results[0].id;
  }
  return { id: crypto.randomUUID(), receiptHash: owner.receiptHash, accountId: owner.id, method, accountRowId, identity,
    createdAt: now, expiresAt: now + (method === 'email' ? 300000 : 600000) };
}
// Direct SDK APIs bypass its HTTP limiter, whose global cleanup also discards
// counters older than its own window. Keep these longer bounds in native SQL.
export async function recoveryLimit(db: D1Database, buckets: { key: string; limit: number; window: number }[]) {
  const now = Date.now();
  await db.prepare('DELETE FROM account_recovery_limits WHERE window_started_at<?').bind(now - 3600000).run();
  const results = await db.batch(buckets.map(bucket => db.prepare(`INSERT INTO account_recovery_limits(key,count,window_started_at) VALUES(?,1,?)
    ON CONFLICT(key) DO UPDATE SET count=CASE WHEN window_started_at<=? THEN 1 ELSE count+1 END,
    window_started_at=CASE WHEN window_started_at<=? THEN excluded.window_started_at ELSE window_started_at END
    WHERE window_started_at<=? OR count<? RETURNING key`)
    .bind('puptime-recovery:' + bucket.key, now, now - bucket.window, now - bucket.window, now - bucket.window, bucket.limit)));
  const blocked = buckets.filter((_, index) => results[index].results.length !== 1);
  if (blocked.length) {
    const remaining = await Promise.all(blocked.map(async bucket => {
      const row = await db.prepare('SELECT window_started_at FROM account_recovery_limits WHERE key=?').bind('puptime-recovery:' + bucket.key).first<{ window_started_at: number }>();
      return Math.ceil(((row?.window_started_at ?? now) + bucket.window - now) / 1000);
    }));
    throw new HTTPException(429, { res: Response.json({ error: 'recovery_rate_limited' },
      { status: 429, headers: { 'cache-control': 'no-store', 'retry-after': String(Math.max(1, ...remaining)) } }) });
  }
}
export async function recoveryIPLimit(db: D1Database, headers: Headers) {
  const ip = (headers.get('cf-connecting-ip') ?? 'unknown').slice(0, 128);
  await recoveryLimit(db, [{ key: 'ip:' + await hashCapability(ip), limit: 30, window: 60000 }]);
}
export async function recoveryStartLimit(db: D1Database, intent: RecoveryIntent, headers: Headers) {
  const ownerKey = await hashCapability(intent.accountId);
  await recoveryLimit(db, [
    { key: 'owner:' + ownerKey, limit: 5, window: 600000 },
    { key: 'receipt:' + intent.receiptHash, limit: 5, window: 600000 },
    ...(intent.method === 'email' ? [
      { key: 'send-owner:' + ownerKey, limit: 1, window: 60000 },
      { key: 'send-receipt:' + intent.receiptHash, limit: 1, window: 60000 },
      { key: 'send-ip:' + await hashCapability((headers.get('cf-connecting-ip') ?? 'unknown').slice(0, 128)), limit: 3, window: 60000 },
    ] : []),
  ]);
}
export async function saveRecoveryIntent(db: D1Database, intent: RecoveryIntent, state: string | null = null) {
  const now = Date.now();
  await db.prepare('DELETE FROM account_recovery_intents WHERE expires_at<=?').bind(now).run();
  const inserted = await db.prepare(`INSERT INTO account_recovery_intents(id,receipt_hash,account_id,method,provider_account_id,identity_value,state_hash,created_at,expires_at)
    SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM account_deletion_receipts r JOIN user u ON u.id=r.account_id
      WHERE r.receipt_hash=? AND r.account_id=? AND r.phase!='completed' AND u.emailVerified=1 AND ${usableReceiptSql('r')})
    AND (SELECT COUNT(*) FROM account_recovery_intents WHERE account_id=?)<5
    AND (SELECT COUNT(*) FROM account_recovery_intents WHERE receipt_hash=?)<5 RETURNING id`)
    .bind(intent.id, intent.receiptHash, intent.accountId, intent.method, intent.accountRowId, intent.identity, state ? await hashCapability(state) : null,
      intent.createdAt, intent.expiresAt, intent.receiptHash, intent.accountId, now, intent.accountId, intent.receiptHash).first();
  if (!inserted) recoveryUnavailable();
}
export async function saveRecoveryResponse(db: D1Database, intent: RecoveryIntent, response: Response) {
  if (!response.ok) recoveryUnavailable();
  const data = z.object({ url: z.url().max(16384), redirect: z.boolean() }).parse(await response.clone().json());
  const url = new URL(data.url), state = url.searchParams.get('state');
  if (url.origin !== (intent.method === 'apple' ? 'https://appleid.apple.com' : 'https://accounts.google.com') || !state || state.length > 512) recoveryUnavailable();
  await saveRecoveryIntent(db, intent, state);
  const headers = new Headers(response.headers); headers.set('cache-control', 'no-store'); headers.delete('content-length');
  return Response.json({ ...data, recoveryIntentId: intent.id }, { status: response.status, headers });
}
export async function callbackRecoveryIntent(db: D1Database, state: string | null) {
  if (!state || state.length > 512) return;
  const row = await db.prepare('SELECT * FROM account_recovery_intents WHERE state_hash=? AND expires_at>?').bind(await hashCapability(state), Date.now()).first<IntentRow>();
  return row ? fromRow(row) : undefined;
}
export async function emailRecoveryIntent(db: D1Database, id: string, receipt: string, expected: string) {
  const owner = await recoveryOwner(db, receipt, expected);
  const row = await db.prepare("SELECT * FROM account_recovery_intents WHERE id=? AND receipt_hash=? AND account_id=? AND method='email' AND identity_value=? AND expires_at>? AND created_at<=?")
    .bind(id, owner.receiptHash, expected, owner.email, Date.now(), Date.now()).first<IntentRow>();
  if (!row) recoveryUnavailable();
  return fromRow(row);
}
async function trustedBinding(intent: RecoveryIntent) {
  const marker = (await getOAuthState())?.serverContext?.puptimeRecovery;
  if (intent.method === 'email') return marker === undefined;
  const parsed = bindingSchema.safeParse(marker);
  return parsed.success && Object.entries(recoveryBinding(intent)).every(([key, value]) => parsed.data[key as keyof typeof parsed.data] === value);
}
const identitySql = `(i.method='email' AND u.email=i.identity_value OR i.method!='email' AND EXISTS(
  SELECT 1 FROM account a WHERE a.id=i.provider_account_id AND a.userId=i.account_id AND a.providerId=i.method AND a.accountId=i.identity_value))`;
export async function validateRecoveryIdentity(db: D1Database, intent: RecoveryIntent | undefined, data: { user: { id?: unknown }; source: ValidateUserInfoSource }) {
  const marker = (await getOAuthState())?.serverContext?.puptimeRecovery;
  if (!intent && marker === undefined) return;
  if (!intent || intent.method === 'email' || !await trustedBinding(intent) || data.source.action !== 'sign-in' || data.source.method !== 'oauth'
    || data.source.oauth?.providerId !== intent.method || data.user.id !== intent.accountId || data.source.oauth.profile?.sub !== intent.identity
    || !await validRecovery(db, intent)) return { error: 'recovery_unavailable' };
}
async function validRecovery(db: D1Database, intent: RecoveryIntent) {
  const now = Date.now();
  return !!await db.prepare(`SELECT i.id FROM account_recovery_intents i JOIN user u ON u.id=i.account_id JOIN account_deletion_receipts r ON r.receipt_hash=i.receipt_hash
    WHERE i.id=? AND i.account_id=? AND i.receipt_hash=? AND i.method=? AND i.identity_value=? AND i.provider_account_id IS ? AND i.expires_at>? AND i.created_at<=?
    AND u.emailVerified=1 AND r.account_id=i.account_id AND r.phase!='completed' AND ${usableReceiptSql('r')} AND ${identitySql}`)
    .bind(intent.id, intent.accountId, intent.receiptHash, intent.method, intent.identity, intent.accountRowId, now, now, now).first();
}
export async function recoveryAppleEmail(db: D1Database, intent: RecoveryIntent | undefined, profile: { sub: string; email?: string }) {
  if (profile.email || !intent || intent.method !== 'apple' || profile.sub !== intent.identity || !await trustedBinding(intent) || !await validRecovery(db, intent)) return {};
  const row = await db.prepare('SELECT email FROM user WHERE id=? AND emailVerified=1').bind(intent.accountId).first<{ email: string }>();
  return row ? { email: row.email, emailVerified: true } : {};
}
export async function consumeRecoveryIntent(db: D1Database, intent: RecoveryIntent | undefined, userId: string) {
  const marker = (await getOAuthState())?.serverContext?.puptimeRecovery;
  if (!intent && marker === undefined) return;
  if (!intent || userId !== intent.accountId || !await trustedBinding(intent)) recoveryDenied();
  const now = Date.now();
  const consumed = await db.prepare(`DELETE FROM account_recovery_intents WHERE id=? AND account_id=? AND receipt_hash=? AND method=? AND identity_value=? AND provider_account_id IS ? AND expires_at>? AND created_at<=?
    AND EXISTS(SELECT 1 FROM account_recovery_intents i JOIN user u ON u.id=i.account_id JOIN account_deletion_receipts r ON r.receipt_hash=i.receipt_hash
      WHERE i.id=? AND u.emailVerified=1 AND r.account_id=i.account_id AND r.phase!='completed' AND ${usableReceiptSql('r')} AND ${identitySql}) RETURNING id`)
    .bind(intent.id, intent.accountId, intent.receiptHash, intent.method, intent.identity, intent.accountRowId, now, now, intent.id, now).first();
  if (!consumed) recoveryDenied();
}

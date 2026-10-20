import { getAccountStore } from './account-store';
import { z } from 'zod';
import { hashCapability, lifecycleError } from './account-reauth';
import { authTimestampSql } from './auth-timestamps';

export type AppleRevocation = 'not-linked' | 'revoked' | 'manual';
export const deletionReceiptSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const receiptLifetime = 30 * 86400000;
const sessionCreated = authTimestampSql('createdAt'), sessionExpiry = authTimestampSql('expiresAt');
type ReceiptRow = { account_id: string | null; phase: 'prepared' | 'deleting' | 'cloud-retired' | 'completed'; apple_revocation: AppleRevocation | null };

// A started operation must keep its owner binding while that identity exists,
// even if the client stays offline beyond the unused-reference lifetime.
export const usableReceiptSql = (alias = 'account_deletion_receipts') => `(${alias}.expires_at>? OR (${alias}.phase IN ('deleting','cloud-retired') AND EXISTS(SELECT 1 FROM user WHERE id=${alias}.account_id)))`;

export function recentAuthentication(createdAt: number, now = Date.now()): boolean {
  const age = now - createdAt;
  return Number.isFinite(age) && age >= 0 && age < 600000;
}
export async function prepareDeletionReceipt(db: D1Database, accountId: string, sessionId: string) {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const receipt = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const hash = await hashCapability(receipt), now = Date.now(), expiresAt = now + receiptLifetime;
  const prepared = await db.batch<{ receipt_hash: string }>([
    db.prepare(`DELETE FROM account_deletion_receipts WHERE NOT ${usableReceiptSql()}`).bind(now),
    // A lost preparation response has no recoverable plaintext receipt. Renew
    // only an unstarted, lease-free reference; never displace a started proof.
    // Rotation and insertion share a transaction, including concurrent retries.
    db.prepare(`DELETE FROM account_deletion_receipts WHERE receipt_hash=(
      SELECT receipt_hash FROM account_deletion_receipts WHERE account_id=? AND phase='prepared' AND attempt_id IS NULL
      ORDER BY created_at,receipt_hash LIMIT 1)
      AND (SELECT COUNT(*) FROM account_deletion_receipts WHERE account_id=?)>=5
      AND EXISTS(SELECT 1 FROM session WHERE id=? AND userId=? AND ${sessionExpiry}>? AND ${sessionCreated}>? AND ${sessionCreated}<=?)`)
      .bind(accountId, accountId, sessionId, accountId, now, now - 600000, now),
    db.prepare(`INSERT INTO account_deletion_receipts(receipt_hash,account_id,phase,created_at,expires_at)
      SELECT ?,?,'prepared',?,? WHERE EXISTS(SELECT 1 FROM session WHERE id=? AND userId=? AND ${sessionExpiry}>? AND ${sessionCreated}>? AND ${sessionCreated}<=?)
      AND (SELECT COUNT(*) FROM account_deletion_receipts WHERE account_id=?)<5 RETURNING receipt_hash`)
      .bind(hash, accountId, now, expiresAt, sessionId, accountId, now, now - 600000, now, accountId),
  ]);
  if (!prepared[2].results.length) lifecycleError(429, 'deletion_preparation_unavailable');
  return { receipt, expiresAt };
}
export async function deletionReceiptStatus(db: D1Database, receipt: string) {
  const hash = await hashCapability(receipt);
  // One SQL snapshot cannot miss both rows while completion moves the proof.
  const row = await db.prepare(`SELECT NULL AS account_id,'completed' AS phase,apple_revocation FROM account_deletion_completions WHERE receipt_hash=?
    UNION ALL SELECT account_id,phase,apple_revocation FROM account_deletion_receipts WHERE receipt_hash=? AND ${usableReceiptSql()} LIMIT 1`)
    .bind(hash, hash, Date.now()).first<ReceiptRow>();
  if (!row) return { status: 'unknown' as const };
  const absent = row.phase === 'cloud-retired' && !await db.prepare('SELECT id FROM user WHERE id=?').bind(row.account_id).first();
  if (row.phase === 'completed' || absent) return { status: 'deleted' as const, appleRevocation: row.apple_revocation! };
  return { status: row.phase === 'prepared' ? 'not-started' as const : 'pending' as const };
}

export async function deleteCloudAccount(env: Cloudflare.Env, user: { id: string; email: string }, sessionId: string, receipt?: string): Promise<AppleRevocation> {
  const db = env.AUTH_DB;
  let hash: string;
  if (receipt) hash = await hashCapability(receipt);
  else {
    // Legacy web callers share the same serialization and atomic SQL boundary.
    // The native client prepares and durably saves its own receipt first.
    const existing = await db.prepare(`SELECT receipt_hash FROM account_deletion_receipts WHERE account_id=? AND ${usableReceiptSql()} AND phase!='completed' ORDER BY created_at DESC LIMIT 1`)
      .bind(user.id, Date.now()).first<{ receipt_hash: string }>();
    hash = existing?.receipt_hash ?? await hashCapability((await prepareDeletionReceipt(db, user.id, sessionId)).receipt);
  }
  const now = Date.now(), attempt = crypto.randomUUID();
  const claimed = await db.prepare(`UPDATE account_deletion_receipts SET phase=CASE WHEN phase='prepared' THEN 'deleting' ELSE phase END,attempt_id=?,attempt_until=?
    WHERE receipt_hash=? AND account_id=? AND phase!='completed' AND ${usableReceiptSql()}
    AND NOT EXISTS(SELECT 1 FROM account_deletion_receipts active WHERE active.account_id=? AND active.attempt_until>?)
    AND EXISTS(SELECT 1 FROM session WHERE id=? AND userId=? AND ${sessionExpiry}>? AND ${sessionCreated}>? AND ${sessionCreated}<=?) RETURNING receipt_hash`)
    .bind(attempt, now + 60000, hash, user.id, now, user.id, now, sessionId, user.id, now, now - 600000, now).first();
  if (!claimed) lifecycleError(409, 'deletion_unavailable');
  try {
    const appleRevocation = await retireCloudAccount(env, user);
    const retired = await db.prepare("UPDATE account_deletion_receipts SET phase='cloud-retired',apple_revocation=? WHERE receipt_hash=? AND account_id=? AND attempt_id=? AND attempt_until>? RETURNING receipt_hash")
      .bind(appleRevocation, hash, user.id, attempt, Date.now()).first();
    if (!retired) lifecycleError(409, 'deletion_unavailable');
    const finishedAt = Date.now();
    // D1's native FK cascade is atomic. Better Auth's D1 deleteUser otherwise
    // deletes sessions, accounts and the user in separate operations. Keep the
    // original session/link intact on any failure so explicit retries can reauth.
    await db.batch([
      db.prepare(`DELETE FROM user WHERE id=? AND EXISTS(SELECT 1 FROM account_deletion_receipts
        WHERE receipt_hash=? AND account_id=? AND phase='cloud-retired' AND attempt_id=? AND attempt_until>? AND ${usableReceiptSql()})`)
        .bind(user.id, hash, user.id, attempt, finishedAt, finishedAt),
      // Keep every saved completion proof indefinitely, without its owner ID.
      db.prepare(`INSERT INTO account_deletion_completions(receipt_hash,apple_revocation)
        SELECT receipt_hash,? FROM account_deletion_receipts WHERE account_id=? AND NOT EXISTS(SELECT 1 FROM user WHERE id=?)`)
        .bind(appleRevocation, user.id, user.id),
      db.prepare('DELETE FROM account_deletion_receipts WHERE account_id=? AND NOT EXISTS(SELECT 1 FROM user WHERE id=?)')
        .bind(user.id, user.id),
    ]);
    const completed = await db.prepare('SELECT receipt_hash FROM account_deletion_completions WHERE receipt_hash=?').bind(hash).first();
    if (!completed) lifecycleError(409, 'deletion_unavailable');
    return appleRevocation;
  } finally {
    await db.prepare('UPDATE account_deletion_receipts SET attempt_id=NULL,attempt_until=NULL WHERE receipt_hash=? AND attempt_id=?').bind(hash, attempt).run();
  }
}

async function revokeApple(env: Cloudflare.Env, userId: string): Promise<AppleRevocation> {
  // Better Auth's current encryptOAuthTokens setting is false. These credentials
  // stay server-side and must never enter logs, API responses, or browser state.
  const { results } = await env.AUTH_DB.prepare('SELECT refreshToken,accessToken FROM account WHERE userId=? AND providerId=?').bind(userId, 'apple').all<{ refreshToken: string | null; accessToken: string | null }>();
  if (!results.length) return 'not-linked';
  let outcome: AppleRevocation = 'revoked';
  const signal = AbortSignal.timeout(5000);
  for (const account of results) {
    const refresh = account.refreshToken?.trim(), access = account.accessToken?.trim();
    const token = refresh || access;
    if (!token || !env.APPLE_CLIENT_ID || !env.APPLE_CLIENT_SECRET) { outcome = 'manual'; continue; }
    try {
      const response = await fetch('https://appleid.apple.com/auth/revoke', {
        method: 'POST', redirect: 'error', signal,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: env.APPLE_CLIENT_ID, client_secret: env.APPLE_CLIENT_SECRET, token, token_type_hint: refresh ? 'refresh_token' : 'access_token' }),
      });
      if (response.status !== 200) outcome = 'manual';
      await response.body?.cancel();
    } catch { outcome = 'manual'; }
  }
  // TN3194: unavailable tokens or provider failure must not prevent app-data
  // deletion. The confirmed response tells the person to revoke Apple manually.
  return outcome;
}

export async function retireCloudAccount(env: Cloudflare.Env, user: { id: string; email: string }): Promise<AppleRevocation> {
  // Mark first so another active request cannot begin a new cloud operation.
  // A failed cleanup remains retryable through the confirmed deletion route.
  await env.AUTH_DB.prepare("INSERT INTO cloud_accounts(account_id, state) VALUES (?, 'deleting') ON CONFLICT(account_id) DO UPDATE SET state = 'deleting'").bind(user.id).run();
  // D1 credential triggers fence both new links and already-running callbacks
  // before this snapshot, including writes that try to change the owner.
  const appleRevocation = await revokeApple(env, user.id);
  await getAccountStore(env, user.id).retire();
  const email = user.email.toLowerCase();
  const identifiers = ['sign-in', 'email-verification', 'forget-password', 'change-email'].map((type) => `${type}-otp-${email}`);
  await env.AUTH_DB.batch([
    env.AUTH_DB.prepare('DELETE FROM local_email_previews WHERE email = ?').bind(email),
    env.AUTH_DB.prepare('DELETE FROM verification WHERE identifier IN (?, ?, ?, ?)').bind(...identifiers),
  ]);
  return appleRevocation;
}

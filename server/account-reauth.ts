import { getOAuthState } from 'better-auth/api';
import type { ValidateUserInfoSource } from '@better-auth/core';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { authTimestampSql } from './auth-timestamps';

const expiry = authTimestampSql('expiresAt'), created = authTimestampSql('createdAt');

export const reauthMode = 'account-deletion';
export const expectedAccountSchema = z.string().trim().min(1).max(256);
export const reauthInputSchema = z.strictObject({
  provider: z.enum(['apple', 'google']),
  callbackURL: z.string().min(1).max(2048),
  errorCallbackURL: z.string().min(1).max(2048).optional(),
  disableRedirect: z.boolean().optional(),
  requestSignUp: z.literal(false).optional(),
  additionalData: z.record(z.string(), z.unknown()).optional(),
});
const bindingSchema = z.strictObject({ id: z.uuid(), accountId: expectedAccountSchema, sessionId: z.string().min(1).max(256), provider: z.enum(['apple', 'google']) });
export type ReauthIntent = z.infer<typeof bindingSchema> & { createdAt: number; expiresAt: number };
type IntentRow = { id: string; account_id: string; source_session_id: string; provider_id: 'apple' | 'google'; created_at: number; expires_at: number };
export function lifecycleError(status: 400 | 401 | 403 | 409 | 429, error: string): never {
  throw new HTTPException(status, { res: Response.json({ error }, { status, headers: { 'cache-control': 'no-store' } }) });
}
export function trustedAccountOrigin(headers: Headers, env: Cloudflare.Env): boolean {
  const origin = headers.get('origin');
  const allowed = [env.AUTH_BASE_URL ? new URL(env.AUTH_BASE_URL).origin : '', ...(env.WEB_ORIGINS ?? '').split(',')];
  if (origin && !allowed.includes(origin)) return false;
  if (!origin && headers.get('sec-fetch-site') === 'cross-site') return false;
  return !!origin || !headers.has('expo-origin') || headers.get('expo-origin') === 'puptime://';
}
export async function hashCapability(value: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2, '0')).join('');
}
export function newReauthIntent(accountId: string, sessionId: string, provider: ReauthIntent['provider']): ReauthIntent {
  const now = Date.now();
  return { id: crypto.randomUUID(), accountId, sessionId, provider, createdAt: now, expiresAt: now + 600000 };
}
export function intentBinding(intent: ReauthIntent) {
  return { id: intent.id, accountId: intent.accountId, sessionId: intent.sessionId, provider: intent.provider };
}
function fromRow(row: IntentRow): ReauthIntent {
  return { id: row.id, accountId: row.account_id, sessionId: row.source_session_id, provider: row.provider_id, createdAt: row.created_at, expiresAt: row.expires_at };
}
export async function callbackReauthIntent(db: D1Database, state: string | null): Promise<ReauthIntent | undefined> {
  if (!state || state.length > 512) return;
  const row = await db.prepare('SELECT * FROM account_reauth_intents WHERE state_hash=? AND expires_at>?').bind(await hashCapability(state), Date.now()).first<IntentRow>();
  return row ? fromRow(row) : undefined;
}
export async function saveReauthResponse(db: D1Database, intent: ReauthIntent, response: Response): Promise<Response> {
  if (!response.ok) return response;
  const data = z.object({ url: z.url().max(16384), redirect: z.boolean() }).parse(await response.clone().json());
  const url = new URL(data.url), state = url.searchParams.get('state');
  if (url.origin !== (intent.provider === 'apple' ? 'https://appleid.apple.com' : 'https://accounts.google.com') || !state || state.length > 512) throw new Error('Invalid authentication response.');
  const now = Date.now();
  await db.prepare('DELETE FROM account_reauth_intents WHERE expires_at<=?').bind(now).run();
  const inserted = await db.prepare(`INSERT INTO account_reauth_intents(id,state_hash,account_id,source_session_id,provider_id,created_at,expires_at)
    SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM session WHERE id=? AND userId=? AND ${expiry}>? AND ${created}<=?)
    AND (SELECT COUNT(*) FROM account_reauth_intents WHERE account_id=?)<5 RETURNING id`)
    .bind(intent.id, await hashCapability(state), intent.accountId, intent.sessionId, intent.provider, intent.createdAt, intent.expiresAt, intent.sessionId, intent.accountId, now, now, intent.accountId).first();
  if (!inserted) lifecycleError(409, 'reauthentication_unavailable');
  const headers = new Headers(response.headers); headers.set('cache-control', 'no-store'); headers.delete('content-length');
  return Response.json({ ...data, reauthIntentId: intent.id }, { status: response.status, headers });
}
async function trustedBinding(intent: ReauthIntent | undefined): Promise<boolean> {
  const marker = (await getOAuthState())?.serverContext?.puptimeReauth;
  if (!intent) return marker === undefined;
  const parsed = bindingSchema.safeParse(marker);
  return parsed.success && parsed.data.id === intent.id && parsed.data.accountId === intent.accountId
    && parsed.data.sessionId === intent.sessionId && parsed.data.provider === intent.provider;
}
async function originalSession(db: D1Database, intent: ReauthIntent): Promise<boolean> {
  if (intent.expiresAt <= Date.now()) return false;
  const now = Date.now();
  return !!await db.prepare(`SELECT id FROM session WHERE id=? AND userId=? AND ${expiry}>? AND ${created}<=?`).bind(intent.sessionId, intent.accountId, now, now).first();
}
export async function validateReauthIdentity(db: D1Database, intent: ReauthIntent | undefined, data: { user: { id?: unknown }; source: ValidateUserInfoSource }) {
  const marker = (await getOAuthState())?.serverContext?.puptimeReauth;
  if (marker === undefined && !intent) return;
  if (!intent || !await trustedBinding(intent) || !await originalSession(db, intent) || data.source.action !== 'sign-in' || data.source.method !== 'oauth'
    || data.source.oauth?.providerId !== intent.provider || data.user.id !== intent.accountId) return { error: 'reauth_owner_mismatch' };
  const subject = data.source.oauth.profile?.sub;
  if (typeof subject !== 'string' || !subject || subject.length > 2048) return { error: 'reauth_owner_mismatch' };
  const { results } = await db.prepare('SELECT userId FROM account WHERE providerId=? AND accountId=?').bind(intent.provider, subject).all<{ userId: string }>();
  if (results.length !== 1 || results[0].userId !== intent.accountId) return { error: 'reauth_owner_mismatch' };
}
export async function reauthAppleEmail(db: D1Database, intent: ReauthIntent | undefined, profile: { sub: string; email?: string }) {
  if (profile.email || !intent || intent.provider !== 'apple' || !await trustedBinding(intent) || !await originalSession(db, intent)) return {};
  const { results } = await db.prepare('SELECT u.email,u.emailVerified FROM account a JOIN user u ON u.id=a.userId WHERE a.providerId=? AND a.accountId=? AND a.userId=?')
    .bind('apple', profile.sub, intent.accountId).all<{ email: string; emailVerified: number }>();
  return results.length === 1 ? { email: results[0].email, emailVerified: !!results[0].emailVerified } : {};
}
export async function consumeReauthIntent(db: D1Database, intent: ReauthIntent | undefined, accountId: string) {
  const marker = (await getOAuthState())?.serverContext?.puptimeReauth;
  if (marker === undefined && !intent) return;
  if (!intent || accountId !== intent.accountId || !await trustedBinding(intent)) return false;
  const now = Date.now();
  const consumed = await db.prepare(`DELETE FROM account_reauth_intents WHERE id=? AND account_id=? AND source_session_id=? AND provider_id=? AND expires_at>?
    AND EXISTS(SELECT 1 FROM session WHERE id=? AND userId=? AND ${expiry}>? AND ${created}<=?) RETURNING id`)
    .bind(intent.id, intent.accountId, intent.sessionId, intent.provider, now, intent.sessionId, intent.accountId, now, now).first();
  if (!consumed) return false;
}

import { z } from 'zod';

export type CloudAccount = {
  accountId: string; trialStartedAt: number | null; trialEndsAt: number | null;
  paidUntil: number | null; state: 'active' | 'deleting';
};
export type CloudAccess = {
  canSync: boolean; canExport: boolean; source: 'paid' | 'trial' | 'none'; expiresAt: number | null;
};

export function trialDaysFromEnvironment(value:string|undefined):number {
  return z.number().int().min(1).max(30).parse(value?Number(value):14);
}

export function cloudAccess(account: CloudAccount | null, now: number): CloudAccess {
  if (account?.state === 'deleting') return { canSync: false, canExport: false, source: 'none', expiresAt: null };
  const trial = account?.trialStartedAt !== null && account?.trialStartedAt !== undefined
    && account.trialStartedAt <= now && (account.trialEndsAt ?? 0) > now;
  const paid = (account?.paidUntil ?? 0) > now;
  return { canSync: paid || trial, canExport: true, source: paid ? 'paid' : trial ? 'trial' : 'none',
    expiresAt: paid || trial ? Math.max(paid ? account!.paidUntil! : 0, trial ? account!.trialEndsAt! : 0) : null };
}

export function getCloudAccount(db: D1Database, accountId: string): Promise<CloudAccount | null> {
  return db.prepare(`SELECT account_id AS accountId, trial_started_at AS trialStartedAt,
    trial_ends_at AS trialEndsAt, paid_until AS paidUntil, state FROM cloud_accounts WHERE account_id = ?`).bind(accountId).first<CloudAccount>();
}

export async function activateTrial(db: D1Database, accountId: string, now: number, trialDays = 14): Promise<CloudAccount> {
  z.string().min(1).max(128).parse(accountId);
  z.number().int().min(0).parse(now);
  z.number().int().min(1).max(30).parse(trialDays);
  const endsAt = z.number().int().max(8640000000000000).parse(now + trialDays * 86400000);
  await db.prepare(`INSERT INTO cloud_accounts(account_id, trial_started_at, trial_ends_at) VALUES (?, ?, ?)
    ON CONFLICT(account_id) DO UPDATE SET trial_started_at = excluded.trial_started_at, trial_ends_at = excluded.trial_ends_at
    WHERE cloud_accounts.trial_started_at IS NULL AND cloud_accounts.state = 'active'
      AND (cloud_accounts.paid_until IS NULL OR cloud_accounts.paid_until <= ?)`).bind(accountId, now, endsAt, now).run();
  const account = await getCloudAccount(db, accountId);
  if (!account || account.state !== 'active') throw new Error('Cloud account is unavailable.');
  return account;
}

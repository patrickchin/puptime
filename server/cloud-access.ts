export type CloudAccount = { accountId: string; state: 'active' | 'deleting' };
export type CloudAccess = { canSync: boolean; canExport: boolean };

// Identity is checked by the authenticated route. Development cloud access has
// no subscription or expiry; the only additional fence is account deletion.
export function cloudAccess(account: CloudAccount | null): CloudAccess {
  const available = account?.state !== 'deleting';
  return { canSync: available, canExport: available };
}

export function getCloudAccount(db: D1Database, accountId: string): Promise<CloudAccount | null> {
  return db.prepare('SELECT account_id AS accountId, state FROM cloud_accounts WHERE account_id = ?').bind(accountId).first<CloudAccount>();
}

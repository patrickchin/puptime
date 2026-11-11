// Evaluate deadlines in the statement that reads or changes the grant. A request
// can wait on authentication or D1 after its initial application-side checks.
export const sharingNowSql = "CAST(unixepoch('subsec') * 1000 AS INTEGER)";

export function availableAccountSql(accountId: string): string {
  return `EXISTS(SELECT 1 FROM user account_user LEFT JOIN cloud_accounts account_cloud ON account_cloud.account_id=account_user.id WHERE account_user.id=${accountId} AND COALESCE(account_cloud.state,'')!='deleting')`;
}

export function shareAccessSql(alias: string): string {
  return `${alias}.revoked_at IS NULL AND (${alias}.expires_at IS NULL OR ${alias}.expires_at>${sharingNowSql})`;
}

export function shareCapacitySql(alias: string): string {
  return `${shareAccessSql(alias)} AND ((${alias}.member_id IS NOT NULL AND ${availableAccountSql(`${alias}.member_id`)}) OR (${alias}.member_id IS NULL AND ${alias}.invite_expires_at>${sharingNowSql}))`;
}

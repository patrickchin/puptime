// Better Auth's D1 adapter stores ISO dates. Older numeric fixtures/storage are
// also accepted; SQLite's TEXT > INTEGER ordering is not an expiry comparison.
export function authTimestampSql(field: 'createdAt' | 'expiresAt'): string {
  return `(CASE WHEN typeof(${field}) IN ('integer','real') THEN ${field} ELSE unixepoch(${field},'subsec')*1000 END)`;
}

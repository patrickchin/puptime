// Test-only adapter. Queries, constraints, locks and rollback use actual SQLite.
import { DatabaseSync } from 'node:sqlite';
import type { SqlConnection, SqlValue } from './database.ts';
export function sqliteTestConnection(path: string): SqlConnection {
  const database = new DatabaseSync(path);
  return {
    async execAsync(sql) { database.exec(sql); },
    async runAsync(sql, ...values: SqlValue[]) { return { changes: Number(database.prepare(sql).run(...values).changes) }; },
    async getFirstAsync<T>(sql: string, ...values: SqlValue[]) { return (database.prepare(sql).get(...values) as T | undefined) ?? null; },
    async getAllAsync<T>(sql: string, ...values: SqlValue[]) { return database.prepare(sql).all(...values) as T[]; },
    async withTransactionAsync(action) {
      database.exec('BEGIN');
      try { await action(); database.exec('COMMIT'); }
      catch (error) { database.exec('ROLLBACK'); throw error; }
    },
    async closeAsync() { database.close(); },
  };
}

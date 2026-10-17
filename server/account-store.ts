import { DurableObject } from 'cloudflare:workers';
import { z } from 'zod';
import { mutationSchema, type CloudRecord, type Mutation, type MutationResult, type PullPage, type Revision } from '../src/cloud/protocol';
import { reconcileMutation, ReconciliationError } from '../src/cloud/reconcile';

const cursorSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const pageSizeSchema = z.number().int().min(1).max(100);
type JsonRow = { body: string };

export class AccountStore extends DurableObject<Cloudflare.Env> {
  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    ctx.storage.transactionSync(() => {
      ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS schema_metadata (version INTEGER NOT NULL)');
      const version = ctx.storage.sql.exec<{ version: number }>('SELECT version FROM schema_metadata').toArray()[0]?.version ?? 0;
      if (version > 1) throw new Error('Account schema requires a newer Worker.');
      if (version === 0) {
        ctx.storage.sql.exec(`
          CREATE TABLE records (id TEXT PRIMARY KEY, body TEXT NOT NULL);
          CREATE TABLE revisions (sequence INTEGER PRIMARY KEY, record_id TEXT NOT NULL, revision INTEGER NOT NULL, body TEXT NOT NULL, UNIQUE(record_id, revision));
          CREATE INDEX revisions_by_record ON revisions(record_id, revision DESC);
          CREATE TABLE operations (id TEXT PRIMARY KEY, payload TEXT NOT NULL, result TEXT NOT NULL);
          INSERT INTO schema_metadata(version) VALUES (1);
        `);
      }
    });
  }

  apply(input: Mutation): MutationResult {
    const mutation = mutationSchema.parse(input);
    const payload = JSON.stringify(mutation);
    return this.ctx.storage.transactionSync(() => {
      const prior = this.ctx.storage.sql.exec<{ payload: string; result: string }>('SELECT payload, result FROM operations WHERE id = ?', mutation.operationId).toArray()[0];
      if (prior) {
        if (prior.payload !== payload) throw new ReconciliationError('Operation ID was already used for different content.');
        return JSON.parse(prior.result) as MutationResult;
      }
      const stored = this.ctx.storage.sql.exec<JsonRow>('SELECT body FROM records WHERE id = ?', mutation.recordId).toArray()[0];
      const before = stored ? JSON.parse(stored.body) as CloudRecord : null;
      const acceptedAt = Date.now();
      const reconciled = reconcileMutation(before, mutation, acceptedAt);
      const sequence = this.ctx.storage.sql.exec<{ value: number }>('SELECT COALESCE(MAX(sequence), 0) + 1 AS value FROM revisions').one().value;
      const record: CloudRecord = { ...reconciled.record, revision: (before?.revision ?? 0) + 1, sequence };
      const revision: Revision = {
        recordId: record.id, revision: record.revision, sequence, operationId: mutation.operationId,
        deviceId: mutation.deviceId, acceptedAt, baseRevision: mutation.baseRevision, intent: mutation.intent,
        proposal: mutation.patch, before, after: record, reason: reconciled.reason,
      };
      const result: MutationResult = { operationId: mutation.operationId, record, sequence, reason: reconciled.reason };
      this.ctx.storage.sql.exec('INSERT INTO records(id, body) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET body = excluded.body', record.id, JSON.stringify(record));
      this.ctx.storage.sql.exec('INSERT INTO revisions(sequence, record_id, revision, body) VALUES (?, ?, ?, ?)', sequence, record.id, record.revision, JSON.stringify(revision));
      this.ctx.storage.sql.exec('INSERT INTO operations(id, payload, result) VALUES (?, ?, ?)', mutation.operationId, payload, JSON.stringify(result));
      return result;
    });
  }

  pull(after: number, limit = 100): PullPage {
    cursorSchema.parse(after);
    pageSizeSchema.parse(limit);
    const latest = this.ctx.storage.sql.exec<{ value: number }>('SELECT COALESCE(MAX(sequence), 0) AS value FROM revisions').one().value;
    if (after > latest) throw new ReconciliationError('Cursor is ahead of this account; a full resync is required.');
    const rows = this.ctx.storage.sql.exec<JsonRow>('SELECT body FROM revisions WHERE sequence > ? ORDER BY sequence LIMIT ?', after, limit + 1).toArray();
    const changes = rows.slice(0, limit).map((row) => (JSON.parse(row.body) as Revision).after);
    return { changes, cursor: changes.at(-1)?.sequence ?? after, hasMore: rows.length > limit };
  }

  history(recordId: string, beforeRevision = Number.MAX_SAFE_INTEGER): Revision[] {
    z.string().min(1).max(256).parse(recordId);
    cursorSchema.parse(beforeRevision);
    return this.ctx.storage.sql.exec<JsonRow>('SELECT body FROM revisions WHERE record_id = ? AND revision < ? ORDER BY revision DESC LIMIT 50', recordId, beforeRevision)
      .toArray().map((row) => JSON.parse(row.body) as Revision);
  }
}

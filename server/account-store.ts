import { DurableObject } from 'cloudflare:workers';
import { z } from 'zod';
import { enrollmentSchema, mutationSchema, recordIdSchema, type Enrollment, type CloudRecord, type Mutation, type MutationResult, type PullPage, type Revision } from '../src/cloud/protocol';
import {cloudAccess,getCloudAccount} from './entitlements';
import { reconcileMutation, ReconciliationError } from '../src/cloud/reconcile';

const cursorSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const pageSizeSchema = z.number().int().min(1).max(100);
type JsonRow = { body: string };

export class AccountStore extends DurableObject<Cloudflare.Env> {
  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    ctx.storage.transactionSync(() => {
      ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS schema_metadata (version INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS account_state (key TEXT PRIMARY KEY, value INTEGER NOT NULL)');
      const version = ctx.storage.sql.exec<{ version: number }>('SELECT version FROM schema_metadata').toArray()[0]?.version ?? 0;
      if (version > 2) throw new Error('Account schema requires a newer Worker.');
      if (version === 0) {
        ctx.storage.sql.exec(`
          CREATE TABLE records (id TEXT PRIMARY KEY, body TEXT NOT NULL);
          CREATE TABLE revisions (sequence INTEGER PRIMARY KEY, record_id TEXT NOT NULL, revision INTEGER NOT NULL, body TEXT NOT NULL, UNIQUE(record_id, revision));
          CREATE INDEX revisions_by_record ON revisions(record_id, revision DESC);
          CREATE TABLE operations (id TEXT PRIMARY KEY, payload TEXT NOT NULL, result TEXT NOT NULL);
          INSERT INTO schema_metadata(version) VALUES (1);
        `);
      }
      if (version < 2) {
        ctx.storage.sql.exec(`
          CREATE TABLE pets (id TEXT PRIMARY KEY, initial_name TEXT NOT NULL, created_at INTEGER NOT NULL);
          CREATE TABLE enrollments (id TEXT PRIMARY KEY, payload TEXT NOT NULL, result TEXT NOT NULL);
          CREATE TABLE enrolled_devices (id TEXT NOT NULL, pet_id TEXT NOT NULL REFERENCES pets(id), PRIMARY KEY(id, pet_id));
          CREATE INDEX records_by_pet_kind ON records(json_extract(body, '$.petId'), json_extract(body, '$.kind'), json_extract(body, '$.deleted'));
          UPDATE schema_metadata SET version = 2;
        `);
      }
    });
  }

  async fetch(request:Request):Promise<Response> {
    const accountId=request.headers.get('x-puptime-account'),sessionId=request.headers.get('x-puptime-session');
    if(new URL(request.url).pathname!=='/changes'||request.headers.get('upgrade')?.toLowerCase()!=='websocket')return new Response(null,{status:404});
    if(!accountId||!sessionId||getAccountStore(this.env,accountId).id.toString()!==this.ctx.id.toString())return new Response(null,{status:401});
    if(!await this.#channelAccess({accountId,sessionId}))return new Response(null,{status:401});
    const [client,server]=Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({accountId,sessionId});
    server.send(JSON.stringify({protocolVersion:1,cursor:this.#cursor()}));
    return new Response(null,{status:101,webSocket:client});
  }

  #cursor():number {return this.ctx.storage.sql.exec<{value:number}>('SELECT COALESCE(MAX(sequence),0) AS value FROM revisions').one().value;}
  async #channelAccess({accountId,sessionId}:{accountId:string;sessionId:string}):Promise<boolean> {
    this.#assertActive();
    // Recheck the SDK-managed session row, without persisting a cookie/token in
    // hibernation attachments or introducing a second credential mechanism.
    const session=await this.env.AUTH_DB.prepare('SELECT id FROM session WHERE id=? AND userId=? AND expiresAt>?').bind(sessionId,accountId,Date.now()).first();
    const account=await getCloudAccount(this.env.AUTH_DB,accountId);
    this.#assertActive();
    return !!session&&cloudAccess(account,Date.now()).canSync;
  }
  async #notify(cursor:number):Promise<void> {
    await Promise.all(this.ctx.getWebSockets().map(async socket=>{
      try {
        const attachment=socket.deserializeAttachment() as {accountId:string;sessionId:string}|null;
        if(!attachment||!await this.#channelAccess(attachment)){socket.close(1008,'Access expired');return;}
        socket.send(JSON.stringify({protocolVersion:1,cursor}));
      }catch{try{socket.close(1011,'Channel unavailable');}catch{}}
    }));
  }
  webSocketMessage(socket:WebSocket) {socket.close(1008,'Receive-only channel');}
  webSocketClose(socket:WebSocket,code:number) {socket.close(code===1005?1000:code);}
  webSocketError(socket:WebSocket) {try{socket.close(1011,'Channel unavailable');}catch{}}

  #assertActive(): void {
    if (this.ctx.storage.sql.exec<{ value: number }>("SELECT value FROM account_state WHERE key = 'retired'").toArray()[0]?.value) {
      throw new ReconciliationError('This cloud account was deleted.');
    }
  }

  retire(): void {
    for(const socket of this.ctx.getWebSockets())socket.close(1008,'Account deleted');
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(`
        DELETE FROM records; DELETE FROM revisions; DELETE FROM operations;
        DELETE FROM enrolled_devices; DELETE FROM enrollments; DELETE FROM pets;
        INSERT INTO account_state(key, value) VALUES ('retired', 1) ON CONFLICT(key) DO UPDATE SET value = 1;
      `);
    });
  }

  apply(input: Mutation): MutationResult {
    this.#assertActive();
    const mutation = mutationSchema.parse(input);
    const payload = JSON.stringify(mutation);
    const beforeCursor=this.#cursor();
    const result=this.ctx.storage.transactionSync(() => {
      const device = this.ctx.storage.sql.exec<{ pet_id: string }>('SELECT pet_id FROM enrolled_devices WHERE id = ? AND (? IS NULL OR pet_id = ?) LIMIT 1', mutation.deviceId, mutation.petId, mutation.petId).toArray()[0];
      if (!device || (mutation.petId !== null && mutation.petId !== device.pet_id)) {
        throw new ReconciliationError('Pet is not enrolled for this account.');
      }
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
    if(result.sequence>beforeCursor)this.ctx.waitUntil(this.#notify(result.sequence));
    return result;
  }

  enroll(input: Enrollment): { petId: string } {
    this.#assertActive();
    const enrollment = enrollmentSchema.parse(input);
    const payload = JSON.stringify(enrollment);
    return this.ctx.storage.transactionSync(() => {
      const previous = this.ctx.storage.sql.exec<{ payload: string; result: string }>('SELECT payload, result FROM enrollments WHERE id = ?', enrollment.operationId).toArray()[0];
      if (previous) {
        if (previous.payload !== payload) throw new ReconciliationError('Operation ID was already used for different enrollment.');
        return JSON.parse(previous.result) as { petId: string };
      }
      const existing = this.ctx.storage.sql.exec<{ id: string }>('SELECT id FROM pets ORDER BY created_at, id LIMIT 1').toArray()[0];
      if (existing && enrollment.confirmedPetId !== existing.id) throw new ReconciliationError('Existing puppy confirmation is required.');
      if (!existing && enrollment.confirmedPetId) throw new ReconciliationError('Confirmed puppy does not exist.');
      const petId = existing?.id ?? enrollment.localPetId;
      if (!existing) this.ctx.storage.sql.exec('INSERT INTO pets(id, initial_name, created_at) VALUES (?, ?, ?)', petId, enrollment.name, Date.now());
      this.ctx.storage.sql.exec('INSERT INTO enrolled_devices(id, pet_id) VALUES (?, ?) ON CONFLICT(id, pet_id) DO NOTHING', enrollment.deviceId, petId);
      const result = { petId };
      this.ctx.storage.sql.exec('INSERT INTO enrollments(id, payload, result) VALUES (?, ?, ?)', enrollment.operationId, payload, JSON.stringify(result));
      return result;
    });
  }

  summary(): { pets: { id: string; name: string; eventCount: number }[] } {
    this.#assertActive();
    const pets = this.ctx.storage.sql.exec<{ id: string; initial_name: string }>('SELECT id, initial_name FROM pets ORDER BY created_at, id').toArray();
    return { pets: pets.map((pet) => {
      const profile = this.ctx.storage.sql.exec<JsonRow>('SELECT body FROM records WHERE id = ?', pet.id).toArray()[0];
      const record = profile ? JSON.parse(profile.body) as CloudRecord : null;
      const eventCount = this.ctx.storage.sql.exec<{ value: number }>("SELECT COUNT(*) AS value FROM records WHERE json_extract(body, '$.petId') = ? AND json_extract(body, '$.kind') = 'event' AND json_extract(body, '$.deleted') = 0", pet.id).one().value;
      return { id: pet.id, name: record?.kind === 'puppy' && !record.deleted && 'name' in record.data && typeof record.data.name === 'string' ? record.data.name : pet.initial_name, eventCount };
    }) };
  }

  enrollForClient(input: Enrollment): { petId: string } | { error: 'enrollment_conflict' } {
    try { return this.enroll(input); }
    catch (error) {
      if (error instanceof ReconciliationError) return { error: 'enrollment_conflict' };
      throw error;
    }
  }

  push(mutations: Mutation[]): { accepted: MutationResult[]; rejected: { operationId: string; error: string }[] } {
    const accepted: MutationResult[] = [];
    const rejected: { operationId: string; error: string }[] = [];
    for (const mutation of mutations) {
      try { accepted.push(this.apply(mutation)); }
      catch (error) { rejected.push({ operationId: mutation.operationId, error: error instanceof ReconciliationError ? 'conflict' : error instanceof z.ZodError ? 'invalid_mutation' : 'retry_later' }); }
    }
    return { accepted, rejected };
  }

  pullForClient(after: number, limit = 100): PullPage & { resyncRequired?: boolean } {
    try { return this.pull(after, limit); }
    catch (error) {
      if (error instanceof ReconciliationError) return { changes: [], cursor: 0, hasMore: false, resyncRequired: true };
      throw error;
    }
  }

  exportSnapshot(): { cursor: number; pets: { id: string; name: string; eventCount: number }[] } {
    const cursor = this.ctx.storage.sql.exec<{ value: number }>('SELECT COALESCE(MAX(sequence), 0) AS value FROM revisions').one().value;
    return { cursor, ...this.summary() };
  }

  exportPage(after: number, through: number): Revision[] {
    this.#assertActive();
    cursorSchema.parse(after); cursorSchema.parse(through);
    return this.ctx.storage.sql.exec<JsonRow>('SELECT body FROM revisions WHERE sequence > ? AND sequence <= ? ORDER BY sequence LIMIT 100', after, through)
      .toArray().map((row) => JSON.parse(row.body) as Revision);
  }

  pull(after: number, limit = 100): PullPage {
    this.#assertActive();
    cursorSchema.parse(after);
    pageSizeSchema.parse(limit);
    const latest = this.ctx.storage.sql.exec<{ value: number }>('SELECT COALESCE(MAX(sequence), 0) AS value FROM revisions').one().value;
    if (after > latest) throw new ReconciliationError('Cursor is ahead of this account; a full resync is required.');
    const rows = this.ctx.storage.sql.exec<JsonRow>('SELECT body FROM revisions WHERE sequence > ? ORDER BY sequence LIMIT ?', after, limit + 1).toArray();
    const changes = rows.slice(0, limit).map((row) => (JSON.parse(row.body) as Revision).after);
    return { changes, cursor: changes.at(-1)?.sequence ?? after, hasMore: rows.length > limit };
  }

  history(recordId: string, beforeRevision = Number.MAX_SAFE_INTEGER): Revision[] {
    this.#assertActive();
    recordIdSchema.parse(recordId);
    cursorSchema.parse(beforeRevision);
    return this.ctx.storage.sql.exec<JsonRow>('SELECT body FROM revisions WHERE record_id = ? AND revision < ? ORDER BY revision DESC LIMIT 50', recordId, beforeRevision)
      .toArray().map((row) => JSON.parse(row.body) as Revision);
  }
}


export function getAccountStore(env: Cloudflare.Env, accountId: string): DurableObjectStub<AccountStore> {
  const namespace = env.ACCOUNT_JURISDICTION === 'eu' ? env.ACCOUNTS.jurisdiction('eu') : env.ACCOUNTS;
  return namespace.get(namespace.idFromName(accountId));
}

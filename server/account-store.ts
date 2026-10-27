import {legacyProfileRevision} from './profile-compat';
import { DurableObject } from 'cloudflare:workers';
import { z } from 'zod';
import { cloudRecordSchema,eventDataSchema,routineDataSchema,enrollmentSchema, identifierSchema, mutationSchema, recordIdSchema, type Enrollment, type CloudRecord, type Mutation, type MutationResult, type PullPage, type Revision } from '../src/cloud/protocol';
import {cloudAccess,getCloudAccount} from './cloud-access';
import {eventSqlColumns,routineSqlColumns,eventSqlValues,routineSqlValues,eventDataFromSql,routineDataFromSql,type EventSqlRow,type RoutineSqlRow} from '../src/record-sql';
import { reconcileMutation, ReconciliationError } from '../src/cloud/reconcile';
import { cloudRecordId } from '../src/cloud/record-identity';
import { entityId } from '../src/entity-id';
import { customActivityKey } from '../src/domain';
import { resourceKindSchema, resourceListSchema, resourceWriteSchema, type ResourceKind, type ResourceListQuery, type ResourceList, type ResourceWrite, type ResourceWriteResult } from './resource-types';
import accountSchema from './migrations/account/0003-account-store.sql';
import resourceSchema from './migrations/account/0004-resource-api.sql';

const cursorSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const pageSizeSchema = z.number().int().min(1).max(100);
type JsonRow = { body: string };
type RecordRow={id:string;pet_id:string|null;kind:CloudRecord['kind'];revision:number;sequence:number;deleted:number;updated_at:number;data_json:string|null};

export class AccountStore extends DurableObject<Cloudflare.Env> {
  // Account-scoped budget survives isolate eviction; only counters are stored.
  async allowAssistantRequest():Promise<boolean>{
    return this.ctx.storage.transaction(async transaction=>{
      const now=Date.now(),previous=await transaction.get<{minute:number;minuteCount:number;day:number;dayCount:number}>('assistant_budget');
      const minute=Math.floor(now/60000),day=Math.floor(now/86400000);
      const minuteCount=previous?.minute===minute?previous.minuteCount:0,dayCount=previous?.day===day?previous.dayCount:0;
      if(minuteCount>=10||dayCount>=200)return false;
      await transaction.put('assistant_budget',{minute,minuteCount:minuteCount+1,day,dayCount:dayCount+1});return true;
    });
  }
  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    ctx.storage.transactionSync(() => {
      const tables=ctx.storage.sql.exec<{name:string}>("SELECT name FROM sqlite_master WHERE type='table'").toArray().map(row=>row.name);
      if(tables.includes('schema_metadata')){
        const versions=ctx.storage.sql.exec<{version:number}>('SELECT version FROM schema_metadata').toArray();
        if(versions.length!==1||![3,4].includes(versions[0].version))throw new Error('Unsupported development or newer account schema.');
        if(['account_state','records','record_events','record_routines','revisions','operations','pets','enrollments','enrolled_devices'].some(name=>!tables.includes(name)))throw new Error('The account database schema is incomplete.');
        if(versions[0].version===3)ctx.storage.sql.exec(resourceSchema);
        else if(!tables.includes('api_requests'))throw new Error('The account database schema is incomplete.');
        return;
      }
      if(tables.some(name=>!name.startsWith('sqlite_')&&!name.startsWith('__cf_')))throw new Error('The existing account database schema is incomplete.');
      ctx.storage.sql.exec(accountSchema);
      ctx.storage.sql.exec(resourceSchema);
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
    const session=await this.env.AUTH_DB.prepare('SELECT expiresAt FROM session WHERE id=? AND userId=?').bind(sessionId,accountId).first<{expiresAt:string|number}>();
    const expiresAt=typeof session?.expiresAt==='number'?session.expiresAt:new Date(session?.expiresAt??'').getTime();
    const account=await getCloudAccount(this.env.AUTH_DB,accountId);
    this.#assertActive();
    return Number.isFinite(expiresAt)&&expiresAt>Date.now()&&cloudAccess(account).canSync;
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
  webSocketClose(socket:WebSocket,_code:number) {socket.close(1000); }
  webSocketError(socket:WebSocket) {try{socket.close(1011,'Channel unavailable');}catch{}}

  #record(id:string):CloudRecord|null {
    const row=this.ctx.storage.sql.exec<RecordRow>('SELECT * FROM records WHERE id=?',id).toArray()[0];
    if(!row)return null;
    if(row.deleted!==0&&row.deleted!==1)throw new Error('Invalid saved deletion state.');
    const data=row.kind==='event'?eventDataFromSql(this.ctx.storage.sql.exec<EventSqlRow>('SELECT * FROM record_events WHERE record_id=?',id).one())
      :row.kind==='routine'?routineDataFromSql(this.ctx.storage.sql.exec<RoutineSqlRow>('SELECT * FROM record_routines WHERE record_id=?',id).one())
      :JSON.parse(row.data_json!);
    return cloudRecordSchema.parse({id:row.id,petId:row.pet_id,kind:row.kind,revision:row.revision,sequence:row.sequence,deleted:row.deleted===1,updatedAt:row.updated_at,data});
  }
  #saveRecord(record:CloudRecord):void {
    const core=record.kind==='event'||record.kind==='routine';
    this.ctx.storage.sql.exec('INSERT INTO records(id,pet_id,kind,revision,sequence,deleted,updated_at,data_json) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET pet_id=excluded.pet_id,kind=excluded.kind,revision=excluded.revision,sequence=excluded.sequence,deleted=excluded.deleted,updated_at=excluded.updated_at,data_json=excluded.data_json',
      record.id,record.petId,record.kind,record.revision,record.sequence,record.deleted?1:0,record.updatedAt,core?null:JSON.stringify(record.data));
    if(record.kind==='event')this.ctx.storage.sql.exec(`INSERT INTO record_events(record_id,${eventSqlColumns.join(',')}) VALUES(${Array(1+eventSqlColumns.length).fill('?').join(',')}) ON CONFLICT(record_id) DO UPDATE SET ${eventSqlColumns.map(column=>`${column}=excluded.${column}`).join(',')}`,record.id,...eventSqlValues(eventDataSchema.parse(record.data)));
    if(record.kind==='routine')this.ctx.storage.sql.exec(`INSERT INTO record_routines(record_id,${routineSqlColumns.join(',')}) VALUES(${Array(1+routineSqlColumns.length).fill('?').join(',')}) ON CONFLICT(record_id) DO UPDATE SET ${routineSqlColumns.map(column=>`${column}=excluded.${column}`).join(',')}`,record.id,...routineSqlValues(routineDataSchema.parse(record.data)));
  }

  #assertActive(): void {
    if (this.ctx.storage.sql.exec<{ value: number }>("SELECT value FROM account_state WHERE key = 'retired'").toArray()[0]?.value) {
      throw new ReconciliationError('This cloud account was deleted.');
    }
  }

  retire(): void {
    for(const socket of this.ctx.getWebSockets())socket.close(1008,'Account deleted');
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(`
        DELETE FROM records; DELETE FROM revisions; DELETE FROM operations; DELETE FROM api_requests;
        DELETE FROM enrolled_devices; DELETE FROM enrollments; DELETE FROM pets;
        INSERT INTO account_state(key, value) VALUES ('retired', 1) ON CONFLICT(key) DO UPDATE SET value = 1;
      `);
    });
  }

  apply(input: Mutation): MutationResult {
    this.#assertActive();
    const mutation = mutationSchema.parse(input);
    const beforeCursor=this.#cursor();
    const result=this.ctx.storage.transactionSync(() => this.#applyMutation(mutation));
    if(result.sequence>beforeCursor)this.ctx.waitUntil(this.#notify(result.sequence));
    return result;
  }

  // Both the mobile change protocol and REST writes commit through this engine.
  // Its caller owns the transaction and sends notifications only after commit.
  #applyMutation(mutation: Mutation, accountPreferenceActor = false): MutationResult {
      const payload = JSON.stringify(mutation);
      if (!accountPreferenceActor) {
      const device = this.ctx.storage.sql.exec<{ pet_id: string }>('SELECT pet_id FROM enrolled_devices WHERE id = ? AND (? IS NULL OR pet_id = ?) LIMIT 1', mutation.deviceId, mutation.petId, mutation.petId).toArray()[0];
      if (!device || (mutation.petId !== null && mutation.petId !== device.pet_id)) {
        throw new ReconciliationError('Pet is not enrolled for this account.');
      }
      }
      const prior = this.ctx.storage.sql.exec<{ payload: string; result: string }>('SELECT payload, result FROM operations WHERE id = ?', mutation.operationId).toArray()[0];
      if (prior) {
        if (prior.payload !== payload) throw new ReconciliationError('Operation ID was already used for different content.');
        return JSON.parse(prior.result) as MutationResult;
      }
      const before=this.#record(mutation.recordId);
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
      this.#saveRecord(record);
      this.ctx.storage.sql.exec('INSERT INTO revisions(sequence, record_id, revision, body) VALUES (?, ?, ?, ?)', sequence, record.id, record.revision, JSON.stringify(revision));
      this.ctx.storage.sql.exec('INSERT INTO operations(id, payload, result) VALUES (?, ?, ?)', mutation.operationId, payload, JSON.stringify(result));
      return result;
  }

  resourceGet(kind: ResourceKind, petId: string | null, localId: string): CloudRecord | null {
    this.#assertActive();
    resourceKindSchema.parse(kind);
    const id = cloudRecordId(kind, petId, localId);
    const record = this.#record(id);
    if (record) return record.kind === kind && record.petId === petId ? record : null;
    if (kind !== 'puppy') return null;
    // Older enrolled clients can have a puppy name without a profile revision.
    // Expose that real saved profile at revision zero; the first edit creates its
    // normal revision without rewriting history or changing GET's state.
    const pet = this.ctx.storage.sql.exec<{ initial_name: string; created_at: number }>('SELECT initial_name,created_at FROM pets WHERE id=?', id).toArray()[0];
    return pet ? { id, petId: id, kind: 'puppy', data: { name: pet.initial_name }, revision: 0, sequence: 0, deleted: false, updatedAt: pet.created_at } : null;
  }

  resourceList(input: ResourceListQuery): ResourceList {
    this.#assertActive();
    const query = resourceListSchema.parse(input), after = query.after ?? 0;
    if (query.kind === 'puppy') {
      // Puppy pagination includes enrolled profiles without a record yet. The
      // stable insertion rowid is its cursor, rather than a revision sequence.
      const rows = this.ctx.storage.sql.exec<{ id: string; cursor: number }>(
        `SELECT p.id,p.rowid AS cursor FROM pets p LEFT JOIN records r ON r.id=p.id
         WHERE p.rowid>? AND (r.id IS NULL OR r.deleted=0) ${query.petId ? 'AND p.id=?' : ''} ORDER BY p.rowid LIMIT ?`,
        after, ...(query.petId ? [query.petId] : []), query.limit + 1,
      ).toArray();
      return { records: rows.slice(0, query.limit).map(row => this.resourceGet('puppy', row.id, row.id)!),
        nextCursor: rows.length > query.limit ? rows[query.limit - 1].cursor : null };
    }
    const clauses = ['r.kind=?', 'r.pet_id IS ?', 'r.deleted=0', 'r.sequence>?'];
    const bindings: (string | number | null)[] = [query.kind, query.petId, after];
    if (query.since !== undefined) { clauses.push('e.at>=?'); bindings.push(query.since); }
    if (query.until !== undefined) { clauses.push('e.at<?'); bindings.push(query.until); }
    if (query.type !== undefined) { clauses.push('e.type=?'); bindings.push(query.type); }
    const filteredEvents = query.kind === 'event' && (query.since !== undefined || query.until !== undefined || query.type !== undefined);
    // Drive narrow filters from their typed index. CROSS JOIN prevents SQLite
    // from scanning every puppy log in sequence order before checking its time.
    const source = filteredEvents
      ? `record_events e INDEXED BY ${query.type === undefined ? 'record_events_by_at' : 'record_events_by_type_at'} CROSS JOIN records r ON r.id=e.record_id`
      : `records r ${query.kind === 'event' ? 'JOIN record_events e ON e.record_id=r.id' : ''}`;
    const rows = this.ctx.storage.sql.exec<{ id: string; sequence: number }>(
      `SELECT r.id,r.sequence FROM ${source}
       WHERE ${clauses.join(' AND ')} ORDER BY r.sequence LIMIT ?`, ...bindings, query.limit + 1,
    ).toArray();
    return { records: rows.slice(0, query.limit).map(row => this.#record(row.id)!),
      nextCursor: rows.length > query.limit ? rows[query.limit - 1].sequence : null };
  }

  resourceHistory(kind: ResourceKind, petId: string | null, localId: string, beforeRevision = Number.MAX_SAFE_INTEGER): Revision[] {
    resourceKindSchema.parse(kind);
    return this.history(cloudRecordId(kind, petId, localId), beforeRevision);
  }

  resourceWrite(input: ResourceWrite): ResourceWriteResult {
    try {
      this.#assertActive();
      const request = resourceWriteSchema.parse(input);
      const payload = JSON.stringify({ ...request, patch: Object.fromEntries(Object.entries(request.patch).sort(([a], [b]) => a.localeCompare(b))) });
      if (new TextEncoder().encode(payload).byteLength > 65536) return { ok: false, error: 'invalid_request', message: 'Request exceeds 64 KiB.' };
      const beforeCursor = this.#cursor();
      const result = this.ctx.storage.transactionSync<ResourceWriteResult>(() => {
        const prior = this.ctx.storage.sql.exec<{ payload: string; result: string }>('SELECT payload,result FROM api_requests WHERE id=?', request.requestId).toArray()[0];
        if (prior) return prior.payload === payload ? JSON.parse(prior.result) as ResourceWriteResult
          : { ok: false, error: 'conflict', message: 'Idempotency key was already used for a different request.' };
        const prefix = { event: 'evt', routine: 'rtn', puppy: 'pet' } as const;
        const localId = request.kind === 'accountPreferences' ? 'preferences'
          : request.localId ?? (request.kind === 'customActivity' ? customActivityKey(typeof request.patch.label === 'string' ? request.patch.label : '')
            : request.kind === 'customization' ? (typeof request.patch.activityKey === 'string' ? request.patch.activityKey : 'invalid')
              : request.kind === 'puppy' && request.petId ? request.petId : entityId(prefix[request.kind]));
        const petId = request.kind === 'puppy' ? request.petId ?? identifierSchema.parse(localId) : request.petId;
        const recordId = cloudRecordId(request.kind, petId, localId);
        const before = this.resourceGet(request.kind, petId, localId);
        if (request.intent === 'create' && before) return { ok: false, error: 'conflict', message: 'Resource already exists.' };
        if (request.intent !== 'create' && (!before || (before.deleted && request.intent !== 'restore'))) {
          return { ok: false, error: 'not_found', message: 'Resource does not exist.' };
        }
        if (request.intent !== 'create' && request.expectedRevision !== before!.revision) {
          return { ok: false, error: 'precondition_failed', message: 'Resource has changed. Fetch its current revision and retry.' };
        }
        if (request.intent === 'restore' && !before!.deleted) return { ok: false, error: 'conflict', message: 'Resource is not deleted.' };
        const pet = petId === null ? null : this.ctx.storage.sql.exec<{ id: string }>('SELECT id FROM pets WHERE id=?', petId).toArray()[0];
        if (petId !== null && !pet && !(request.kind === 'puppy' && request.intent === 'create')) {
          return { ok: false, error: 'not_found', message: 'Puppy does not exist.' };
        }
        const legacyProfile = request.kind === 'puppy' && before?.revision === 0;
        const mutation = mutationSchema.parse({ protocolVersion: 1, operationId: request.requestId, deviceId: request.actorId,
          kind: request.kind, petId, recordId, baseRevision: before?.revision ?? 0,
          intent: legacyProfile ? 'create' : request.intent,
          patch: request.intent === 'restore' || legacyProfile ? { ...before!.data, ...request.patch } : request.patch });
        const identityData = { ...before?.data, ...mutation.patch };
        if ((request.kind === 'customActivity' && (!('label' in identityData) || typeof identityData.label !== 'string' || customActivityKey(identityData.label) !== localId))
          || (request.kind === 'customization' && (!('activityKey' in identityData) || identityData.activityKey !== localId))) {
          return { ok: false, error: 'invalid_request', message: 'Activity identity cannot change. Create a separate activity instead.' };
        }
        if (request.kind === 'puppy' && !pet) {
          this.ctx.storage.sql.exec('INSERT INTO pets(id,initial_name,created_at) VALUES(?,?,?)', petId, 'name' in mutation.patch ? mutation.patch.name! : '', Date.now());
        }
        if (petId !== null) this.ctx.storage.sql.exec('INSERT INTO enrolled_devices(id,pet_id) VALUES(?,?) ON CONFLICT(id,pet_id) DO NOTHING', request.actorId, petId);
        const applied = this.#applyMutation(mutation, request.kind === 'accountPreferences');
        const result: ResourceWriteResult = { ok: true, record: applied.record };
        this.ctx.storage.sql.exec('INSERT INTO api_requests(id,payload,result) VALUES(?,?,?)', request.requestId, payload, JSON.stringify(result));
        return result;
      });
      if (result.ok && result.record.sequence > beforeCursor) this.ctx.waitUntil(this.#notify(result.record.sequence));
      return result;
    } catch (error) {
      if (error instanceof z.ZodError) return { ok: false, error: 'invalid_request', message: 'Resource data or identity is invalid.' };
      if (error instanceof ReconciliationError) return { ok: false, error: 'conflict', message: error.message };
      throw error;
    }
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
      const record=this.#record(pet.id);
      const eventCount = this.ctx.storage.sql.exec<{ value: number }>("SELECT COUNT(*) AS value FROM records WHERE pet_id=? AND kind='event' AND deleted=0", pet.id).one().value;
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

  exportStream(includeProfilePhotos=true): Response {
    // Capture both synchronously before returning. Later writes cannot enter this
    // history, and the HTTP Worker does not spend one RPC/JSON parse per page.
    const snapshot = { cursor: this.#cursor(), ...this.summary() }, encoder = new TextEncoder();
    let manifest = true, cursor = 0;
    const stream = new ReadableStream({
      type: 'bytes',
      pull: controller => {
        try {
          this.#assertActive();
          if (manifest) {
            manifest = false;
            controller.enqueue(encoder.encode(JSON.stringify({ type: 'manifest', format: 'puptime-cloud-export', version: 1, exportedAt: Date.now(), pets: snapshot.pets }) + '\n'));
          } else if (cursor < snapshot.cursor) {
            // One saved row bounds memory without retaining a SQL cursor across
            // pulls; retirement and concurrent writes remain able to proceed.
            const row = this.ctx.storage.sql.exec<{ sequence: number; body: string }>('SELECT sequence,body FROM revisions WHERE sequence>? AND sequence<=? ORDER BY sequence LIMIT 1', cursor, snapshot.cursor).toArray()[0];
            if (!row || row.sequence !== cursor + 1 || !row.body.startsWith('{') || !row.body.endsWith('}')) throw new Error('Incomplete snapshot.');
            cursor = row.sequence;
            // Stored bodies are validated Revision objects serialized at commit.
            // Preserve their JSON bytes for current clients. Older clients need
            // profile-only projection without modifying the stored history.
            const body=includeProfilePhotos?row.body:JSON.stringify(legacyProfileRevision(JSON.parse(row.body)));
            controller.enqueue(encoder.encode('{"type":"revision",' + body.slice(1) + '\n'));
          } else {
            controller.enqueue(encoder.encode(JSON.stringify({ type: 'complete', cursor }) + '\n'));
            controller.close();
          }
        } catch { controller.error(new Error('Export interrupted. Please retry.')); }
      },
    });
    return new Response(stream, { headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store',
      'Content-Disposition': 'attachment; filename="puptime-cloud-export.ndjson"',
    } });
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

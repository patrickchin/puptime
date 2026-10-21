import { env } from 'cloudflare:workers';
import worker from './index';
import { expect, test } from 'vitest';
import { runInDurableObject } from 'cloudflare:test';
import { mutationSchema, type Mutation } from '../src/cloud/protocol';
import { AccountStore } from './account-store';

async function store(petId = 'pet-1') {
  const account = env.ACCOUNTS.get(env.ACCOUNTS.newUniqueId());
  await account.enroll({ operationId: crypto.randomUUID(), deviceId: 'test-device', localPetId: petId, name: 'My puppy' });
  return account;
}
function create(recordId = 'event-1', petId = 'pet-1'): Mutation {
  return mutationSchema.parse({ protocolVersion: 1, operationId: crypto.randomUUID(), deviceId: 'test-device', petId, recordId, kind: 'event', baseRevision: 0, intent: 'create', patch: { type: 'pee', at: 100, source: 'app' } });
}
function edit(original: Mutation, revision: number, patch: object, intent = 'patch'): Mutation {
  return mutationSchema.parse({ ...original, operationId: crypto.randomUUID(), baseRevision: revision, intent, patch });
}

test('fresh account uses one complete first-release schema baseline',async()=>{
  const account=await store();
  await runInDurableObject(account,(_instance,state)=>{
    expect(state.storage.sql.exec<{version:number}>('SELECT version FROM schema_metadata').one().version).toBe(4);
    const names=state.storage.sql.exec<{name:string}>("SELECT name FROM sqlite_master WHERE type='table'").toArray().map(row=>row.name);
    for(const name of ['records','record_events','record_routines','revisions','operations','pets','enrollments','enrolled_devices','account_state'])expect(names).toContain(name);
    expect(state.storage.sql.exec<{name:string}>('PRAGMA index_info(records_by_pet_kind)').toArray().map(row=>row.name)).toEqual(['pet_id','kind','deleted']);
    expect(state.storage.sql.exec<{name:string}>('PRAGMA index_info(revisions_by_record)').toArray().map(row=>row.name)).toEqual(['record_id','revision']);
  });
});

test('reopening the account SQL baseline preserves data, history and duplicate acknowledgments',async()=>{
  const account=await store(),input=create();
  const saved=await account.apply(input);
  await runInDurableObject(account,(_instance,state)=>{
    const tables=['schema_metadata','account_state','pets','records','record_events','record_routines','revisions','operations','enrollments','enrolled_devices'];
    const snapshot=()=>tables.map(table=>state.storage.sql.exec(`SELECT * FROM ${table} ORDER BY rowid`).toArray());
    const before=snapshot();
    const reopened=new AccountStore(state,env);
    expect(reopened.apply(input)).toEqual(saved);
    expect(reopened.pull(0).changes).toEqual([saved.record]);
    expect(snapshot()).toEqual(before);
  });
});

test('the loaded account SQL rejects invalid typed values without changing saved logs',async()=>{
  const account=await store(),input=create();
  await account.apply(input);
  await account.apply(mutationSchema.parse({...create('routine-1'),kind:'routine',patch:{type:'meal',minutes:60}}));
  await runInDurableObject(account,(_instance,state)=>{
    const event=state.storage.sql.exec('SELECT * FROM record_events WHERE record_id=?',input.recordId).one();
    const routine=state.storage.sql.exec('SELECT * FROM record_routines WHERE record_id=?','routine-1').one();
    for(const [column,value] of [['type','unknown'],['type','custom'],['at',1.5],['at',8640000000000001],['source','remote'],['estimated',2],['note','x'.repeat(16385)],['custom_label',' '.repeat(2)]] as const){
      expect(()=>state.storage.sql.exec(`UPDATE record_events SET ${column}=? WHERE record_id=?`,value,input.recordId)).toThrow(/constraint/i);
      expect(state.storage.sql.exec('SELECT * FROM record_events WHERE record_id=?',input.recordId).one()).toEqual(event);
    }
    for(const [column,value] of [['minutes',-1],['minutes',1440],['minutes',1.5],['reminder',2],['tolerance_minutes',1441],['type','custom']] as const){
      expect(()=>state.storage.sql.exec(`UPDATE record_routines SET ${column}=? WHERE record_id=?`,value,'routine-1')).toThrow(/constraint/i);
      expect(state.storage.sql.exec('SELECT * FROM record_routines WHERE record_id=?','routine-1').one()).toEqual(routine);
    }
  });
  expect((await account.pull(0)).changes).toHaveLength(2);
});

test('unsupported account schema rejection preserves stored rows and table definitions',async()=>{
  const account=await store();
  await account.apply(create());
  await runInDurableObject(account,(_instance,state)=>{
    for(const version of [1,2,999]){
      state.storage.sql.exec('UPDATE schema_metadata SET version=?',version);
      const before=state.storage.sql.exec('SELECT name,sql FROM sqlite_master ORDER BY name').toArray();
      const records=state.storage.sql.exec('SELECT * FROM records').toArray();
      expect(()=>new AccountStore(state,env)).toThrow(/unsupported/i);
      expect(state.storage.sql.exec('SELECT name,sql FROM sqlite_master ORDER BY name').toArray()).toEqual(before);
      expect(state.storage.sql.exec('SELECT * FROM records').toArray()).toEqual(records);
    }
  });
});

test('current cloud event and routine payloads use constrained columns and preserve optional fields',async()=>{
  const account=await store();
  const event=mutationSchema.parse({...create(),patch:{type:'nap',at:100,endedAt:null,source:'app',note:'',estimated:false}});
  const saved=await account.apply(event);
  const routine=mutationSchema.parse({...create('routine-1'),kind:'routine',patch:{type:'custom',customLabel:'Training',minutes:60,reminder:false,toleranceMinutes:0}});
  const savedRoutine=await account.apply(routine);
  await runInDurableObject(account,(_instance,state)=>{
    const columns=state.storage.sql.exec<{name:string}>('PRAGMA table_info(records)').toArray().map(row=>row.name);
    expect(columns).not.toContain('body');expect(columns).toContain('pet_id');expect(columns).toContain('kind');
    const row=state.storage.sql.exec<{end_state:number;ended_at:number|null;note:string;estimated:number}>('SELECT end_state,ended_at,note,estimated FROM record_events WHERE record_id=?',event.recordId).one();
    expect(row).toEqual({end_state:1,ended_at:null,note:'',estimated:0});
    const entry=state.storage.sql.exec<{custom_label:string;reminder:number;tolerance_minutes:number}>('SELECT custom_label,reminder,tolerance_minutes FROM record_routines WHERE record_id=?',routine.recordId).one();
    expect(entry).toEqual({custom_label:'Training',reminder:0,tolerance_minutes:0});
    expect(()=>state.storage.sql.exec('UPDATE record_routines SET minutes=1440 WHERE record_id=?',routine.recordId)).toThrow(/constraint/i);
  });
  expect((await account.pull(0)).changes).toEqual([saved.record,savedRoutine.record]);
  expect((await account.apply(edit(event,1,{note:'updated'}))).record.data).toEqual({type:'nap',at:100,endedAt:null,source:'app',note:'updated',estimated:false});
});

test('account retirement removes typed payloads and foreign keys reject orphans',async()=>{
  const account=await store();await account.apply(create());
  await account.apply(mutationSchema.parse({...create('routine-1'),kind:'routine',patch:{type:'meal',minutes:60}}));
  await runInDurableObject(account,(_instance,state)=>{
    expect(()=>state.storage.sql.exec("INSERT INTO record_events(record_id,type,at,source) VALUES('missing','pee',100,'app')")).toThrow(/foreign key/i);
  });
  await account.retire();
  await runInDurableObject(account,(_instance,state)=>{
    for(const table of ['records','record_events','record_routines','revisions','operations'])expect(state.storage.sql.exec<{n:number}>(`SELECT COUNT(*) n FROM ${table}`).one().n).toBe(0);
  });
});

test('accepted writes commit state, history, and an incrementing change cursor', async () => {
  const account = await store();
  const initial = create();
  const first = await account.apply(initial);
  expect(first.record.revision).toBe(1);
  expect(first.sequence).toBe(1);
  const second = await account.apply(edit(initial, 1, { note: 'saved' }));
  expect(second.sequence).toBe(2);
  expect(second.record.revision).toBe(2);
  expect((await account.pull(0)).changes.map((entry) => entry.sequence)).toEqual([1, 2]);
  const history = await account.history('event-1');
  expect(history.map((entry) => entry.revision)).toEqual([2, 1]);
  expect(history[0].before?.data).toEqual({ type: 'pee', at: 100, source: 'app' });
  expect(history[0].after.data).toEqual({ type: 'pee', at: 100, source: 'app', note: 'saved' });
});

test('identical retries return the original acknowledgment without another revision', async () => {
  const account = await store();
  const input = create();
  const first = await account.apply(input);
  expect(await account.apply(input)).toEqual(first);
  expect((await account.history(input.recordId)).length).toBe(1);
  expect((await account.pull(0)).cursor).toBe(1);
});

test('operation ID reuse with a different edit fails without changing stored history', async () => {
  const account = await store();
  const input = create();
  await account.apply(input);
  await runInDurableObject(account, (instance) => {
    expect(() => instance.apply({ ...input, patch: { ...input.patch, at: 200 } } as Mutation)).toThrow('Operation ID');
  });
  expect((await account.history(input.recordId)).length).toBe(1);
  expect((await account.pull(0)).cursor).toBe(1);
});

test('late concurrent fields combine and the exact proposal remains in history', async () => {
  const account = await store();
  const initial = create();
  await account.apply(initial);
  await account.apply(edit(initial, 1, { at: 200 }));
  const combined = await account.apply(edit(initial, 1, { note: 'offline note' }));
  expect(combined.reason).toBe('merged');
  expect(combined.record.data).toEqual({ type: 'pee', at: 200, source: 'app', note: 'offline note' });
  expect((await account.history(initial.recordId))[0].proposal).toEqual({ note: 'offline note' });
});

test('deletion remains visible in pulls and stale edits cannot resurrect it', async () => {
  const account = await store();
  const initial = create();
  await account.apply(initial);
  await account.apply(edit(initial, 1, {}, 'delete'));
  const stale = await account.apply(edit(initial, 1, { note: 'late' }));
  expect(stale.record.deleted).toBe(true);
  expect(stale.reason).toBe('preserved-deletion');
  const restored = await account.apply(edit(initial, 3, { type: 'meal', at: 250, source: 'app' }, 'restore'));
  expect(restored.record.deleted).toBe(false);
  expect(restored.record.revision).toBe(4);
  expect((await account.pull(1)).changes.map((entry) => entry.deleted)).toEqual([true, true, false]);
});

test('pagination cannot skip revisions when writes arrive between pages', async () => {
  const account = await store();
  await account.apply(create('first'));
  await account.apply(create('second'));
  const page = await account.pull(0, 1);
  expect(page.cursor).toBe(1);
  expect(page.hasMore).toBe(true);
  await account.apply(create('third'));
  const rest = await account.pull(page.cursor, 2);
  expect(rest.changes.map((entry) => entry.id)).toEqual(['second', 'third']);
  expect(rest.cursor).toBe(3);
  expect(rest.hasMore).toBe(false);
  expect(await account.pull(rest.cursor)).toEqual({ changes: [], cursor: 3, hasMore: false });
});

test('failed ownership changes do not advance the cursor or create revision rows', async () => {
  const account = await store();
  const initial = create();
  await account.apply(initial);
  await runInDurableObject(account, (instance) => {
    expect(() => instance.apply({ ...edit(initial, 1, { at: 300 }), petId: 'pet-2' })).toThrow();
  });
  expect((await account.pull(0)).cursor).toBe(1);
  expect((await account.history(initial.recordId)).length).toBe(1);
});

test('separate accounts cannot read or patch each other and pet ownership is retained', async () => {
  const first = await store('pet-2'); const second = await store();
  const initial = create('shared-id', 'pet-2');
  await first.apply(initial);
  expect((await second.pull(0)).changes).toEqual([]);
  await runInDurableObject(second, (instance) => {
    expect(() => instance.apply(edit(initial, 0, { note: 'cross account' }))).toThrow();
  });
  expect((await first.pull(0)).changes[0].petId).toBe('pet-2');
});

test('invalid mutation data and unbounded cursors/pages are rejected', async () => {
  const account = await store();
  // The vendor RPC test wrapper leaks handled rejections (workers-sdk #14736).
  // Assert errors inside the same real Durable Object, without suppressing global errors.
  await runInDurableObject(account, (instance) => {
    expect(() => instance.apply({ ...create(), accountId: 'other' } as unknown as Mutation)).toThrow();
    for (const cursor of [-1, 0.5, 1, Number.MAX_SAFE_INTEGER + 1]) expect(() => instance.pull(cursor)).toThrow();
    for (const size of [0, 101, 0.5]) expect(() => instance.pull(0, size)).toThrow();
  });
  expect((await account.pull(0)).changes).toEqual([]);
});

test('public worker health works while customer data routes stay inaccessible', async () => {
  const health = await worker.fetch(new Request('https://puptime.test/health'), env);
  expect(health.status).toBe(200);
  expect(await health.json()).toEqual({ service: 'puptime-api', status: 'ok', protocolVersion: 1 });
  expect((await worker.fetch(new Request('https://puptime.test/api/accounts/other/pull'), env)).status).toBe(404);
});

test('a storage failure after the record write rolls back records, history and operation acknowledgment', async () => {
  const account = await store();
  const input = create();
  await runInDurableObject(account, (instance, state) => {
    state.storage.sql.exec("CREATE TRIGGER fail_ack BEFORE INSERT ON operations BEGIN SELECT RAISE(ABORT, 'injected storage failure'); END;");
    expect(() => instance.apply(input)).toThrow('injected storage failure');
    expect(state.storage.sql.exec<{ count: number }>('SELECT COUNT(*) AS count FROM records').one().count).toBe(0);
    expect(state.storage.sql.exec<{ count: number }>('SELECT COUNT(*) AS count FROM revisions').one().count).toBe(0);
    expect(state.storage.sql.exec<{ count: number }>('SELECT COUNT(*) AS count FROM operations').one().count).toBe(0);
    state.storage.sql.exec('DROP TRIGGER fail_ack');
  });
  expect((await account.apply(input)).sequence).toBe(1);
});

test('simultaneous device patches serialize without losing independent fields', async () => {
  const account = await store();
  const initial = create();
  await account.apply(initial);
  await Promise.all([account.apply(edit(initial, 1, { at: 200 })), account.apply(edit(initial, 1, { note: 'second device' }))]);
  const result = (await account.history(initial.recordId))[0];
  expect(result.after.data).toEqual({ type: 'pee', at: 200, source: 'app', note: 'second device' });
  expect(result.revision).toBe(3);
});

test('history paging returns all versions in order with no overlaps', async () => {
  const account = await store();
  const initial = create();
  await account.apply(initial);
  for (let revision = 1; revision <= 51; revision++) await account.apply(edit(initial, revision, { at: 100 + revision }));
  const first = await account.history(initial.recordId);
  expect(first.length).toBe(50);
  expect(first[0].revision).toBe(52);
  expect(first[49].revision).toBe(3);
  const rest = await account.history(initial.recordId, first[49].revision);
  expect(rest.map((entry) => entry.revision)).toEqual([2, 1]);
});

test('explicit enrollment is retryable and another local puppy requires confirmation', async () => {
  const account = env.ACCOUNTS.get(env.ACCOUNTS.newUniqueId());
  const input = { operationId: 'enroll-first', deviceId: 'test-device', localPetId: 'pet-1', name: 'Pip' };
  expect(await account.summary()).toEqual({ pets: [] });
  const first = await account.enroll(input);
  expect(first).toEqual({ petId: 'pet-1' });
  expect(await account.enroll(input)).toEqual(first);
  await runInDurableObject(account, (instance) => {
    expect(() => instance.enroll({ ...input, operationId: 'enroll-other', localPetId: 'pet-2', name: 'Other' })).toThrow('confirmation');
  });
  expect(await account.enroll({ ...input, operationId: 'enroll-confirmed', localPetId: 'pet-2', confirmedPetId: 'pet-1' })).toEqual({ petId: 'pet-1' });
  expect(await account.summary()).toEqual({ pets: [{ id: 'pet-1', name: 'Pip', eventCount: 0 }] });
});

test('account data cannot be uploaded before explicit pet enrollment', async () => {
  const account = env.ACCOUNTS.get(env.ACCOUNTS.newUniqueId());
  await runInDurableObject(account, (instance) => {
    expect(() => instance.apply(create())).toThrow('enrolled');
  });
  expect((await account.pull(0)).changes).toEqual([]);
});

test('one device can represent two pet boundaries without a one-pet schema constraint', async () => {
  const account = await store();
  await runInDurableObject(account, (_instance, state) => {
    state.storage.sql.exec('INSERT INTO pets(id, initial_name, created_at) VALUES (?, ?, ?)', 'pet-2', 'Second puppy', 1);
    state.storage.sql.exec('INSERT INTO enrolled_devices(id, pet_id) VALUES (?, ?)', 'test-device', 'pet-2');
  });
  await account.apply(create('first-pet-event', 'pet-1'));
  await account.apply(create('second-pet-event', 'pet-2'));
  const summary = await account.summary();
  expect(summary.pets.find((pet) => pet.id === 'pet-1')?.eventCount).toBe(1);
  expect(summary.pets.find((pet) => pet.id === 'pet-2')?.eventCount).toBe(1);
});

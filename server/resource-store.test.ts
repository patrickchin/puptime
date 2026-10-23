import { env } from 'cloudflare:workers';
import { runInDurableObject } from 'cloudflare:test';
import { expect, test, vi } from 'vitest';
import { AccountStore } from './account-store';
import { cloudRecordId, localRecordId } from '../src/cloud/record-identity';
import type { CloudRecord, Mutation } from '../src/cloud/protocol';
import type { ResourceWrite, ResourceWriteResult } from './resource-types';

const account = () => env.ACCOUNTS.get(env.ACCOUNTS.newUniqueId());
const write = (values: Partial<ResourceWrite> = {}): ResourceWrite => ({
  requestId: `op_${crypto.randomUUID()}`, actorId: 'dev_api_test', kind: 'event', petId: 'pet_test',
  intent: 'create', patch: { type: 'pee', at: 100, source: 'app' }, ...values,
});
function saved(result: ResourceWriteResult): CloudRecord {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.message);
  return result.record;
}
async function puppy(store: ReturnType<typeof account>, id = 'pet_test') {
  return saved(await store.resourceWrite(write({ kind: 'puppy', petId: id, localId: id, patch: { name: 'Pip' } })));
}

test('v3 upgrade retains typed data, history, operation retries and enrollments exactly', async () => {
  const store = account();
  await store.enroll({ operationId: 'op_enroll', deviceId: 'dev_phone', localPetId: 'pet_test', name: 'Pip' });
  const mutation: Mutation = { protocolVersion: 1, operationId: 'op_mobile', deviceId: 'dev_phone',
    recordId: cloudRecordId('event', 'pet_test', 'a CSV ID with / spaces'), petId: 'pet_test',
    kind: 'event', baseRevision: 0, intent: 'create', patch: { type: 'meal', at: 100, source: 'app', note: 'Original' } };
  const original = await store.apply(mutation);
  await runInDurableObject(store, (_instance, state) => {
    state.storage.sql.exec('DROP TABLE api_requests; DROP INDEX records_by_scope_sequence; DROP INDEX record_events_by_at; DROP INDEX record_events_by_type_at; UPDATE schema_metadata SET version=3;');
    const tables = ['records', 'record_events', 'record_routines', 'revisions', 'operations', 'pets', 'enrollments', 'enrolled_devices'];
    const snapshot = () => tables.map(table => state.storage.sql.exec(`SELECT * FROM ${table} ORDER BY rowid`).toArray());
    const before = snapshot(), reopened = new AccountStore(state, env);
    expect(snapshot()).toEqual(before);
    expect(state.storage.sql.exec<{ version: number }>('SELECT version FROM schema_metadata').one().version).toBe(4);
    expect(reopened.apply(mutation)).toEqual(original);
    expect(reopened.resourceGet('event', 'pet_test', 'a CSV ID with / spaces')).toEqual(original.record);
    expect(snapshot()).toEqual(before);
    const current = snapshot();
    new AccountStore(state, env);
    expect(snapshot()).toEqual(current);
  });
});

test('legacy enrollment profiles are readable without writes and first patch uses revision zero', async () => {
  const store = account();
  await store.enroll({ operationId: 'op_enroll', deviceId: 'dev_phone', localPetId: 'pet_test', name: 'Pip' });
  const before = await store.resourceGet('puppy', 'pet_test', 'pet_test');
  expect(before).toMatchObject({ revision: 0, sequence: 0, data: { name: 'Pip' } });
  expect((await store.resourceList({ kind: 'puppy', petId: null, limit: 10 })).records).toEqual([before]);
  expect((await store.pull(0)).changes).toEqual([]);
  const first = saved(await store.resourceWrite(write({ kind: 'puppy', localId: 'pet_test', intent: 'patch', expectedRevision: 0, patch: { name: 'Pippa' } })));
  expect(first).toMatchObject({ revision: 1, data: { name: 'Pippa' } });
  expect((await store.history('pet_test'))[0]).toMatchObject({ intent: 'create', before: null });
  expect((await store.summary()).pets[0].name).toBe('Pippa');
});

test('REST creates opaque identities once and retries return the original result even after edits and restart', async () => {
  const store = account();
  const petRequest = write({ kind: 'puppy', petId: null, patch: { name: 'Pip' } });
  const pet = saved(await store.resourceWrite(petRequest));
  expect(pet.id).toMatch(/^pet_[a-f0-9]{32}$/);
  expect(saved(await store.resourceWrite(petRequest))).toEqual(pet);
  const input = write({ petId: pet.id });
  const initial = saved(await store.resourceWrite(input)), localId = localRecordId(initial);
  expect(localId).toMatch(/^evt_[a-f0-9]{32}$/);
  expect(saved(await store.resourceWrite({ ...input, patch: { source: 'app', at: 100, type: 'pee' } }))).toEqual(initial);
  const edit = write({ petId: pet.id, localId, intent: 'patch', expectedRevision: 1, patch: { note: 'New note' } });
  const latest = saved(await store.resourceWrite(edit));
  expect(latest.revision).toBe(2);
  expect(saved(await store.resourceWrite(input))).toEqual(initial);
  expect(saved(await store.resourceWrite(edit))).toEqual(latest);
  await runInDurableObject(store, (_instance, state) => {
    const reopened = new AccountStore(state, env);
    expect(reopened.resourceWrite(input)).toEqual({ ok: true, record: initial });
    expect(reopened.resourceWrite(edit)).toEqual({ ok: true, record: latest });
  });
  expect((await store.resourceWrite({ ...input, patch: { ...input.patch, at: 101 } }))).toMatchObject({ ok: false, error: 'conflict' });
  expect((await store.resourceWrite({ ...edit, requestId: 'op_stale' }))).toMatchObject({ ok: false, error: 'precondition_failed' });
  expect((await store.resourceHistory('event', pet.id, localId)).map(row => row.revision)).toEqual([2, 1]);
  expect((await store.pull(0)).changes).toHaveLength(3);
});

test('REST and mobile commit into the same current records, revisions, merge rules and change feed', async () => {
  const store = account();
  await puppy(store);
  await store.enroll({ operationId: 'op_enroll', deviceId: 'dev_phone', localPetId: 'pet_local', confirmedPetId: 'pet_test', name: 'Pip' });
  const event = saved(await store.resourceWrite(write({ localId: 'CSV / with "quotes" 汉字', patch: { type: 'nap', at: 100, endedAt: 200, source: 'app', estimated: true } })));
  const phone: Mutation = { protocolVersion: 1, operationId: 'op_phone', deviceId: 'dev_phone',
    recordId: event.id, kind: 'event', petId: 'pet_test', baseRevision: event.revision, intent: 'patch', patch: { note: 'From phone' } };
  const edited = await store.apply(phone);
  expect(await store.resourceGet('event', 'pet_test', localRecordId(event))).toEqual(edited.record);
  const rest = saved(await store.resourceWrite(write({ localId: localRecordId(event), intent: 'patch', expectedRevision: 2, patch: { at: 300, estimated: false } })));
  expect(rest.data).toEqual({ type: 'nap', at: 100, endedAt: 200, source: 'app', estimated: true, note: 'From phone' });
  expect((await store.pull(edited.sequence)).changes).toEqual([rest]);
  expect((await store.resourceHistory('event', 'pet_test', localRecordId(event))).map(row => row.reason)).toEqual(['preserved-timing', 'updated', 'created']);
});

test('current-resource SQL pages filter timestamp ranges and activity types without replaying history', async () => {
  const store = account();
  await puppy(store);
  await puppy(store, 'pet_other');
  const one = saved(await store.resourceWrite(write({ localId: 'one', patch: { type: 'pee', at: 100, source: 'app' } })));
  await store.resourceWrite(write({ localId: 'meal', patch: { type: 'meal', at: 150, source: 'app' } }));
  await store.resourceWrite(write({ localId: 'two', patch: { type: 'pee', at: 200, source: 'app' } }));
  await store.resourceWrite(write({ localId: 'upper-exclusive', patch: { type: 'pee', at: 300, source: 'app' } }));
  await store.resourceWrite(write({ localId: 'deleted', patch: { type: 'pee', at: 250, source: 'app' } }));
  await store.resourceWrite(write({ localId: 'deleted', intent: 'delete', expectedRevision: 1, patch: {} }));
  await store.resourceWrite(write({ localId: 'other-pet', petId: 'pet_other', patch: { type: 'pee', at: 150, source: 'app' } }));
  const updated = saved(await store.resourceWrite(write({ localId: 'one', intent: 'patch', expectedRevision: one.revision, patch: { note: 'Only current version' } })));
  const filter = { kind: 'event' as const, petId: 'pet_test', since: 100, until: 300, type: 'pee' as const, limit: 1 };
  const first = await store.resourceList(filter);
  expect(first.records.map(localRecordId)).toEqual(['two']);
  expect(first.nextCursor).not.toBeNull();
  const last = await store.resourceList({ ...filter, after: first.nextCursor! });
  expect(last.records).toEqual([updated]);
  expect(last.nextCursor).toBeNull();
  expect((await store.resourceList({ ...filter, after: updated.sequence })).records).toEqual([]);
  await runInDurableObject(store, (instance, state) => {
    const spy = vi.spyOn(state.storage.sql, 'exec');
    instance.resourceList(filter);
    instance.resourceList({ ...filter, type: undefined });
    instance.resourceList({ kind: 'event', petId: 'pet_test', limit: 10 });
    const statements = spy.mock.calls.filter(([sql]) => sql.startsWith('SELECT r.id,r.sequence')).map(args => [...args] as [string, ...(string | number | null)[]]);
    spy.mockRestore();
    expect(statements).toHaveLength(3);
    const plan = ([sql, ...values]: typeof statements[number]) => state.storage.sql.exec<{ detail: string }>(`EXPLAIN QUERY PLAN ${sql}`, ...values).toArray().map(row => row.detail);
    const typedPlan = plan(statements[0]), timedPlan = plan(statements[1]), unfilteredPlan = plan(statements[2]);
    expect(typedPlan[0]).toMatch(/SEARCH e USING COVERING INDEX record_events_by_type_at \(type=\? AND at>\? AND at<\?\)/);
    expect(timedPlan[0]).toMatch(/SEARCH e USING COVERING INDEX record_events_by_at \(at>\? AND at<\?\)/);
    for (const filtered of [typedPlan, timedPlan]) {
      expect(filtered[1]).toMatch(/SEARCH r USING INDEX sqlite_autoindex_records_1 \(id=\?\)/);
      expect(filtered.some(detail => /SCAN [re]\b/.test(detail))).toBe(false);
    }
    expect(unfilteredPlan[0]).toContain('records_by_scope_sequence');
  });
});

test('preferences can be created before enrollment and puppy listing includes multiple profiles', async () => {
  const store = account();
  const preference = saved(await store.resourceWrite(write({ kind: 'accountPreferences', petId: null, localId: 'preferences', patch: { theme: 'dark', language: 'en' } })));
  expect(preference.id).toBe(cloudRecordId('accountPreferences', null, 'preferences'));
  expect((await store.summary()).pets).toEqual([]);
  expect(await store.resourceList({ kind: 'accountPreferences', petId: null, limit: 10 })).toEqual({ records: [preference], nextCursor: null });
  const first = await puppy(store), second = await puppy(store, 'pet_other');
  const page = await store.resourceList({ kind: 'puppy', petId: null, limit: 1 });
  expect(page.records).toEqual([first]);
  expect(await store.resourceList({ kind: 'puppy', petId: null, limit: 1, after: page.nextCursor! })).toEqual({ records: [second], nextCursor: null });
});

test('delete and restore retain history, strict preconditions and existing data', async () => {
  const store = account(); await puppy(store);
  const original = saved(await store.resourceWrite(write({ localId: 'one' })));
  const deleted = saved(await store.resourceWrite(write({ localId: 'one', intent: 'delete', expectedRevision: 1, patch: {} })));
  expect(deleted.deleted).toBe(true);
  expect(await store.resourceGet('event', 'pet_test', 'one')).toEqual(deleted);
  expect((await store.resourceList({ kind: 'event', petId: 'pet_test', limit: 100 })).records).toEqual([]);
  expect(await store.resourceWrite(write({ localId: 'one', intent: 'restore', expectedRevision: 1, patch: {} }))).toMatchObject({ ok: false, error: 'precondition_failed' });
  const restoreRequest = write({ localId: 'one', intent: 'restore', expectedRevision: 2, patch: {} });
  const restored = saved(await store.resourceWrite(restoreRequest));
  expect(restored.data).toEqual(original.data);
  expect(restored).toMatchObject({ revision: 3, deleted: false });
  expect(saved(await store.resourceWrite(restoreRequest))).toEqual(restored);
  expect(await store.resourceWrite(write({ localId: 'one', intent: 'restore', expectedRevision: 3, patch: {} }))).toMatchObject({ ok: false, error: 'conflict' });
});

test('custom activity and appearance identities remain compatible with mobile projection', async () => {
  const store = account(); await puppy(store);
  const activity = saved(await store.resourceWrite(write({ kind: 'customActivity', patch: { label: 'Training' } })));
  expect(localRecordId(activity)).toBe('custom:training');
  const customization = saved(await store.resourceWrite(write({ kind: 'customization', patch: { activityKey: 'custom:training', name: 'Practice', color: 2 } })));
  expect(localRecordId(customization)).toBe('custom:training');
  expect(await store.resourceWrite(write({ kind: 'customActivity', localId: 'unrelated', patch: { label: 'Training' } }))).toMatchObject({ ok: false, error: 'invalid_request' });
  expect(await store.resourceWrite(write({ kind: 'customActivity', localId: localRecordId(activity), intent: 'patch', expectedRevision: 1, patch: { label: 'Fetch' } }))).toMatchObject({ ok: false, error: 'invalid_request' });
  expect(await store.resourceWrite(write({ kind: 'customization', localId: localRecordId(customization), intent: 'patch', expectedRevision: 1, patch: { activityKey: 'pee' } }))).toMatchObject({ ok: false, error: 'invalid_request' });
  const appearance = saved(await store.resourceWrite(write({ kind: 'customization', localId: localRecordId(customization), intent: 'patch', expectedRevision: 1, patch: { color: 3, name: null } })));
  expect(appearance.data).toEqual({ activityKey: 'custom:training', color: 3 });
  expect((await store.resourceHistory('customActivity', 'pet_test', 'custom:training'))).toHaveLength(1);
});

test('invalid RPC inputs, missing pets and failed commits cannot leave partial rows', async () => {
  const store = account();
  expect(await store.resourceWrite(write())).toMatchObject({ ok: false, error: 'not_found' });
  for (const input of [
    write({ kind: 'puppy', petId: 'pet_test', localId: 'pet_other', patch: { name: 'Pip' } }),
    write({ kind: 'puppy', intent: 'delete', localId: 'pet_test', expectedRevision: 0, patch: {} }),
    write({ kind: 'accountPreferences', petId: null, localId: 'wrong', patch: { theme: 'dark' } }),
    write({ patch: { unknown: 'x'.repeat(65536) } }),
    { ...write(), unexpected: true },
  ]) expect(await store.resourceWrite(input as ResourceWrite)).toMatchObject({ ok: false, error: 'invalid_request' });
  expect((await store.summary()).pets).toEqual([]);
  await runInDurableObject(store, (instance, state) => {
    state.storage.sql.exec("CREATE TRIGGER fail_rest_ack BEFORE INSERT ON api_requests BEGIN SELECT RAISE(ABORT,'injected REST failure'); END;");
    expect(() => instance.resourceWrite(write({ kind: 'puppy', petId: 'pet_test', patch: { name: 'Pip' } }))).toThrow('injected REST failure');
    for (const table of ['pets', 'enrolled_devices', 'records', 'revisions', 'operations', 'api_requests']) expect(state.storage.sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`).one().n).toBe(0);
    state.storage.sql.exec('DROP TRIGGER fail_rest_ack');
  });
  await puppy(store);
  expect(await store.resourceWrite(write({ localId: 'one', patch: { type: 'pee', at: 100 } }))).toMatchObject({ ok: false, error: 'invalid_request' });
  expect((await store.pull(0)).changes).toHaveLength(1);
  await store.retire();
  await runInDurableObject(store, (_instance, state) => {
    for (const table of ['pets', 'enrolled_devices', 'records', 'revisions', 'operations', 'api_requests']) expect(state.storage.sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`).one().n).toBe(0);
  });
});


test('profile photo patches survive restart, preserve concurrent names and support removal',async()=>{
 const store=account(),original=await puppy(store);
 await store.enroll({operationId:'op_photo_enroll',deviceId:'dev_phone',localPetId:'pet_test',confirmedPetId:'pet_test',name:'Pip'});
 const photo='img_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
 const withPhoto=saved(await store.resourceWrite(write({kind:'puppy',localId:'pet_test',intent:'patch',expectedRevision:original.revision,patch:{photoId:photo}})));
 expect(withPhoto.data).toEqual({name:'Pip',photoId:photo});
 await runInDurableObject(store,(_instance,state)=>{
  const reopened=new AccountStore(state,env);
  expect(reopened.resourceGet('puppy','pet_test','pet_test')?.data).toEqual({name:'Pip',photoId:photo});
 });
 const renamed=await store.apply({protocolVersion:1,operationId:'op_rename',deviceId:'dev_phone',recordId:'pet_test',petId:'pet_test',kind:'puppy',baseRevision:original.revision,intent:'patch',patch:{name:'Pippa'}});
 expect(renamed.record.data).toEqual({name:'Pippa',photoId:photo});
 const removed=saved(await store.resourceWrite(write({kind:'puppy',localId:'pet_test',intent:'patch',expectedRevision:renamed.record.revision,patch:{photoId:null}})));
 expect(removed.data).toEqual({name:'Pippa'});
 expect((await store.pull(0)).changes.at(-1)?.data).toEqual({name:'Pippa'});
});

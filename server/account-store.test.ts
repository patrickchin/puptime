import { env } from 'cloudflare:workers';
import worker from './index';
import { expect, test } from 'vitest';
import { runInDurableObject } from 'cloudflare:test';
import { mutationSchema, type Mutation } from '../src/cloud/protocol';

function store() { return env.ACCOUNTS.get(env.ACCOUNTS.newUniqueId()); }
function create(recordId = 'event-1', petId = 'pet-1'): Mutation {
  return mutationSchema.parse({ protocolVersion: 1, operationId: crypto.randomUUID(), deviceId: 'test-device', petId, recordId, kind: 'event', baseRevision: 0, intent: 'create', patch: { type: 'pee', at: 100, source: 'app' } });
}
function edit(original: Mutation, revision: number, patch: object, intent = 'patch'): Mutation {
  return mutationSchema.parse({ ...original, operationId: crypto.randomUUID(), baseRevision: revision, intent, patch });
}

test('accepted writes commit state, history, and an incrementing change cursor', async () => {
  const account = store();
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
  const account = store();
  const input = create();
  const first = await account.apply(input);
  expect(await account.apply(input)).toEqual(first);
  expect((await account.history(input.recordId)).length).toBe(1);
  expect((await account.pull(0)).cursor).toBe(1);
});

test('operation ID reuse with a different edit fails without changing stored history', async () => {
  const account = store();
  const input = create();
  await account.apply(input);
  await runInDurableObject(account, (instance) => {
    expect(() => instance.apply({ ...input, patch: { ...input.patch, at: 200 } } as Mutation)).toThrow('Operation ID');
  });
  expect((await account.history(input.recordId)).length).toBe(1);
  expect((await account.pull(0)).cursor).toBe(1);
});

test('late concurrent fields combine and the exact proposal remains in history', async () => {
  const account = store();
  const initial = create();
  await account.apply(initial);
  await account.apply(edit(initial, 1, { at: 200 }));
  const combined = await account.apply(edit(initial, 1, { note: 'offline note' }));
  expect(combined.reason).toBe('merged');
  expect(combined.record.data).toEqual({ type: 'pee', at: 200, source: 'app', note: 'offline note' });
  expect((await account.history(initial.recordId))[0].proposal).toEqual({ note: 'offline note' });
});

test('deletion remains visible in pulls and stale edits cannot resurrect it', async () => {
  const account = store();
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
  const account = store();
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
  const account = store();
  const initial = create();
  await account.apply(initial);
  await runInDurableObject(account, (instance) => {
    expect(() => instance.apply({ ...edit(initial, 1, { at: 300 }), petId: 'pet-2' })).toThrow('ownership');
  });
  expect((await account.pull(0)).cursor).toBe(1);
  expect((await account.history(initial.recordId)).length).toBe(1);
});

test('separate accounts cannot read or patch each other and pet ownership is retained', async () => {
  const first = store(); const second = store();
  const initial = create('shared-id', 'pet-2');
  await first.apply(initial);
  expect((await second.pull(0)).changes).toEqual([]);
  await runInDurableObject(second, (instance) => {
    expect(() => instance.apply(edit(initial, 0, { note: 'cross account' }))).toThrow('does not exist');
  });
  expect((await first.pull(0)).changes[0].petId).toBe('pet-2');
});

test('invalid mutation data and unbounded cursors/pages are rejected', async () => {
  const account = store();
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
  const health = await worker.fetch(new Request('https://puptime.test/health'));
  expect(health.status).toBe(200);
  expect(await health.json()).toEqual({ service: 'puptime-api', status: 'ok', protocolVersion: 1 });
  expect((await worker.fetch(new Request('https://puptime.test/api/accounts/other/pull'))).status).toBe(404);
});

test('a storage failure after the record write rolls back records, history and operation acknowledgment', async () => {
  const account = store();
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
  const account = store();
  const initial = create();
  await account.apply(initial);
  await Promise.all([account.apply(edit(initial, 1, { at: 200 })), account.apply(edit(initial, 1, { note: 'second device' }))]);
  const result = (await account.history(initial.recordId))[0];
  expect(result.after.data).toEqual({ type: 'pee', at: 200, source: 'app', note: 'second device' });
  expect(result.revision).toBe(3);
});

test('history paging returns all versions in order with no overlaps', async () => {
  const account = store();
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

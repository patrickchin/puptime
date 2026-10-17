import assert from 'node:assert/strict';
import test from 'node:test';
import { mutationSchema, type CloudRecord, type Mutation } from './protocol.ts';
const { reconcileMutation, ReconciliationError } = await import('./reconcile.ts');
const current: CloudRecord = { id: 'event-1', petId: 'pet-1', kind: 'event', data: { type: 'nap', at: 100, endedAt: 300, source: 'app', note: 'original' }, revision: 2, sequence: 8, updatedAt: 1000, deleted: false };
function operation(patch: object, changes: object = {}): Mutation {
  return mutationSchema.parse({ protocolVersion: 1, operationId: 'op-1', deviceId: 'device-1', recordId: 'event-1', petId: 'pet-1', kind: 'event', baseRevision: 2, intent: 'patch', patch, ...changes });
}

test('independent offline fields combine while same-field value follows server acceptance', () => {
  const result = reconcileMutation(current, operation({ note: 'later note' }, { baseRevision: 1 }), 2000);
  assert.equal(result.reason, 'merged');
  assert.deepEqual(result.record.data, { type: 'nap', at: 100, endedAt: 300, source: 'app', note: 'later note' });
  assert.equal(result.record.updatedAt, 2000);
  assert.deepEqual(current.data, { type: 'nap', at: 100, endedAt: 300, source: 'app', note: 'original' });
});

test('deletion cannot be undone by stale patches or an attempted create with the same ID', () => {
  const deleted = { ...current, deleted: true };
  assert.equal(reconcileMutation(deleted, operation({ note: 'stale' }, { baseRevision: 1 }), 2000).record.deleted, true);
  assert.equal(reconcileMutation(deleted, operation({ note: 'stale' }, { baseRevision: 1 }), 2000).reason, 'preserved-deletion');
  assert.throws(() => reconcileMutation(deleted, operation({ type: 'pee', at: 500, source: 'app' }, { intent: 'create', baseRevision: 0 }), 2000), ReconciliationError);
});

test('restore requires the latest deletion revision and creates validated visible data', () => {
  const deleted = { ...current, deleted: true };
  const restore = operation({ type: 'pee', at: 50, source: 'widget' }, { intent: 'restore' });
  assert.throws(() => reconcileMutation(deleted, { ...restore, baseRevision: 1 }, 2000), ReconciliationError);
  const restored = reconcileMutation(deleted, restore, 2000);
  assert.equal(restored.reason, 'restored');
  assert.equal(restored.record.deleted, false);
  assert.deepEqual(restored.record.data, { type: 'pee', at: 50, source: 'widget' });
});

test('restoring an earlier visible version also requires its current base revision', () => {
  const restore = operation({ type: 'meal', at: 50, source: 'app' }, { intent: 'restore' });
  assert.throws(() => reconcileMutation(current, { ...restore, baseRevision: 1 }, 2000), ReconciliationError);
  assert.deepEqual(reconcileMutation(current, restore, 2000).record.data, { type: 'meal', at: 50, source: 'app' });
});

test('record identity, ownership and future revisions cannot be changed by a mutation', () => {
  for (const changes of [{ petId: 'pet-2' }, { recordId: 'other' }, { baseRevision: 3 }, { kind: 'routine', patch: { minutes: 10 } }]) {
    assert.throws(() => reconcileMutation(current, operation({ note: 'x' }, changes), 2000), ReconciliationError);
  }
});

test('create validates the complete record and patch/delete cannot create missing records', () => {
  for (const mutation of [operation({ note: 'x' }), operation({}, { intent: 'delete' }), operation({ note: 'x' }, { intent: 'create', baseRevision: 0 })]) {
    assert.throws(() => reconcileMutation(null, mutation, 2000));
  }
  const added = reconcileMutation(null, operation({ type: 'pee', at: 50, source: 'app' }, { intent: 'create', baseRevision: 0 }), 2000);
  assert.equal(added.reason, 'created');
  assert.deepEqual(added.record.data, { type: 'pee', at: 50, source: 'app' });
});

test('invalid concurrent nap timing preserves valid timing and independent fields', () => {
  const result = reconcileMutation(current, operation({ at: 400, note: 'independent edit' }, { baseRevision: 1 }), 2000);
  assert.equal(result.reason, 'preserved-timing');
  assert.deepEqual(result.record.data, { type: 'nap', at: 100, endedAt: 300, source: 'app', note: 'independent edit' });
  assert.deepEqual(reconcileMutation(current, operation({ endedAt: 50 }), 2000).record.data, current.data);
});

test('optional fields clear deliberately and estimated provenance cannot be removed', () => {
  const result = reconcileMutation({ ...current, data: { ...current.data, estimated: true } }, operation({ note: null, estimated: false }), 2000);
  assert.deepEqual(result.record.data, { type: 'nap', at: 100, endedAt: 300, source: 'app', estimated: true });
});

test('personal settings merge independent fields without introducing a pet owner', () => {
  const preference: CloudRecord = { ...current, id: 'preferences', petId: null, kind: 'accountPreferences', data: { theme: 'system', language: 'es' } };
  const mutation = mutationSchema.parse({ ...operation({ note: 'x' }), kind: 'accountPreferences', recordId: 'preferences', petId: null, patch: { theme: 'day-trails' }, baseRevision: 1 });
  assert.deepEqual(reconcileMutation(preference, mutation, 2000).record.data, { theme: 'day-trails', language: 'es' });
});

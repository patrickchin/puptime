import assert from 'node:assert/strict';
import test from 'node:test';

const { mutationSchema, eventDataSchema, recordDataSchema } = await import('./protocol.ts');

const mutation = {
  protocolVersion: 1, operationId: 'op-1', deviceId: 'device-1', petId: 'pet-1',
  recordId: '172001-legacy', kind: 'event', baseRevision: 0, intent: 'create',
  patch: { type: 'pee', at: 100, source: 'app' },
};

test('event schema preserves supported existing event data and estimate provenance', () => {
  assert.deepEqual(eventDataSchema.parse({ type: 'nap', at: -100, endedAt: 300, source: 'widget', estimated: true, note: '训练\nfood' }),
    { type: 'nap', at: -100, endedAt: 300, source: 'widget', estimated: true, note: '训练\nfood' });
  assert.equal(mutationSchema.parse({ ...mutation, recordId: 'legacy / 训练' }).recordId, 'legacy / 训练');
});

test('mutation input rejects metadata injection, unknown fields and malformed identifiers', () => {
  for (const invalid of [
    { ...mutation, accountId: 'another-account' },
    { ...mutation, patch: { ...mutation.patch, id: 'other-record' } },
    { ...mutation, patch: JSON.parse('{"__proto__":{"admin":true}}') },
    { ...mutation, protocolVersion: 2 },
    { ...mutation, operationId: '' }, { ...mutation, operationId: '../op' },
    { ...mutation, deviceId: ' device' }, { ...mutation, petId: null },
    { ...mutation, baseRevision: -1 }, { ...mutation, baseRevision: 0.5 },
    { ...mutation, recordId: 'bad\u0000id' },
  ]) assert.equal(mutationSchema.safeParse(invalid).success, false, JSON.stringify(invalid));
});

test('full event validation rejects invalid dates, invalid naps and oversized private fields', () => {
  for (const invalid of [
    { type: 'pee', at: NaN, source: 'app' },
    { type: 'pee', at: 8640000000000001, source: 'app' },
    { type: 'pee', at: 10.5, source: 'app' },
    { type: 'meal', at: 10, endedAt: 20, source: 'app' },
    { type: 'nap', at: 20, endedAt: 10, source: 'app' },
    { type: 'custom', at: 10, source: 'app' },
    { type: 'pee', at: 10, source: 'app', note: 'x'.repeat(16385) },
  ]) assert.equal(eventDataSchema.safeParse(invalid).success, false);
});

test('event patches may clear optional values and carry invalid timing for reconciliation', () => {
  assert.deepEqual(mutationSchema.parse({ ...mutation, intent: 'patch', baseRevision: 1, patch: { note: null, endedAt: 1 } }).patch,
    { note: null, endedAt: 1 });
  assert.equal(mutationSchema.safeParse({ ...mutation, patch: { type: 'unknown' } }).success, false);
});

test('pet profile and routine validation preserves pet boundaries and valid activity shape', () => {
  assert.equal(recordDataSchema('puppy').safeParse({ name: 'My puppy' }).success, true);
  assert.equal(recordDataSchema('routine').safeParse({ type: 'meal', minutes: 480, reminder: true }).success, true);
  assert.equal(recordDataSchema('routine').safeParse({ type: 'meal', minutes: 1440 }).success, false);
  assert.equal(recordDataSchema('routine').safeParse({ type: 'custom', minutes: 480 }).success, false);
  assert.equal(mutationSchema.safeParse({ ...mutation, kind: 'puppy', recordId: 'pet-1', patch: { name: 'My puppy' } }).success, true);
  assert.equal(mutationSchema.safeParse({ ...mutation, kind: 'puppy', recordId: 'wrong', patch: { name: 'My puppy' } }).success, false);
});

test('personal preference records require account scope and reject OS/device state', () => {
  const preference = { ...mutation, petId: null, kind: 'accountPreferences', patch: { theme: 'system', language: 'system', widgetActions: ['pee', 'meal'] } };
  assert.equal(mutationSchema.safeParse(preference).success, true);
  assert.equal(mutationSchema.safeParse({ ...preference, petId: 'pet-1' }).success, false);
  for (const key of ['notificationPermission', 'widgetPlacement', 'notifyOnThisDevice']) {
    assert.equal(mutationSchema.safeParse({ ...preference, patch: { [key]: true } }).success, false);
  }
});

test('cloud custom activity labels cannot exceed native normalization limits', () => {
  const tooLong = 'a'.repeat(40) + 'b';
  assert.equal(recordDataSchema('customActivity').safeParse({ label: tooLong }).success, false);
  assert.equal(recordDataSchema('routine').safeParse({ type: 'custom', customLabel: tooLong, minutes: 480 }).success, false);
  assert.equal(eventDataSchema.safeParse({ type: 'custom', customLabel: tooLong, at: 100, source: 'app' }).success, false);
  assert.equal(mutationSchema.safeParse({ ...mutation, intent: 'patch', patch: { customLabel: tooLong } }).success, false);
  assert.equal(recordDataSchema('puppy').safeParse({ name: tooLong }).success, true);
});

test('cloud activity keys match canonical native quick actions and custom activity keys', () => {
  for (const key of ['bad', 'unknown', 'custom:', 'custom:  ', 'custom:Walk', `custom:${'a'.repeat(41)}`]) {
    assert.equal(recordDataSchema('customization').safeParse({ activityKey: key, name: 'Rename' }).success, false, key);
    assert.equal(recordDataSchema('accountPreferences').safeParse({ widgetActions: ['pee', key] }).success, false, key);
  }
  assert.equal(recordDataSchema('accountPreferences').safeParse({ widgetActions: ['pee', 'custom:训练'] }).success, true);
  assert.equal(recordDataSchema('customization').safeParse({ activityKey: 'meal', emoji: 'unsupported' }).success, false);
});

test('sync responses reject invalid records, scopes, cursors and duplicate acknowledgments', async () => {
  const protocol = await import('./protocol.ts');
  assert.equal(typeof protocol.cloudRecordSchema?.safeParse, 'function');
  const record = { id: 'id', petId: 'pet-1', kind: 'event', data: { type: 'pee', at: 1, source: 'app' }, revision: 1, sequence: 1, deleted: false, updatedAt: 10 };
  assert.deepEqual(protocol.cloudRecordSchema.parse(record), record);
  for (const invalid of [
    { ...record, kind: 'unknown' }, { ...record, data: { ...record.data, at: NaN } },
    { ...record, petId: null }, { ...record, revision: -1 }, { ...record, sequence: Number.MAX_SAFE_INTEGER + 1 },
    { ...record, kind: 'puppy', data: { name: 'Pip' } },
    { ...record, kind: 'accountPreferences', data: { language: 'en' } },
  ]) assert.equal(protocol.cloudRecordSchema.safeParse(invalid).success, false);
  const page = { changes: [record], cursor: 1, hasMore: false };
  assert.deepEqual(protocol.pullPageSchema.parse(page), page);
  for (const invalid of [{ ...page, cursor: -1 }, { ...page, cursor: Number.MAX_SAFE_INTEGER + 1 }, { ...page, cursor: 2 }, { ...page, resyncRequired: true }, { ...page, changes: [record,record] }]) {
    assert.equal(protocol.pullPageSchema.safeParse(invalid).success, false);
  }
  assert.equal(protocol.pullPageSchema.safeParse({ changes: [], cursor: 0, hasMore: false, resyncRequired: true }).success, true);
  const accepted = { operationId: 'op-1', record, sequence: 1, reason: 'created' };
  assert.equal(protocol.mutationResultSchema.safeParse({ ...accepted, sequence: 2 }).success, false);
  assert.equal(protocol.pushResponseSchema.safeParse({ accepted: [accepted], rejected: [] }).success, true);
  assert.equal(protocol.pushResponseSchema.safeParse({ accepted: [accepted,accepted], rejected: [] }).success, false);
  assert.equal(protocol.pushResponseSchema.safeParse({ accepted: [accepted], rejected: [{ operationId: 'op-1', error: 'conflict' }] }).success, false);
});

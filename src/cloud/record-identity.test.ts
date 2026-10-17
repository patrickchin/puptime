import assert from 'node:assert/strict';
import test from 'node:test';
import * as identity from './record-identity.ts';

const api = identity;
test('record identities preserve exact local IDs across kind and puppy namespaces', () => {
  assert.equal(typeof api.cloudRecordId, 'function');
  for (const localId of ['same-id', '训练 / "quoted" \\ value', 'x'.repeat(256)]) {
    const ids = new Set<string>();
    for (const kind of ['event', 'routine', 'customActivity', 'customization'] as const) {
      for (const petId of ['pet-1', 'pet-2']) {
        const id = api.cloudRecordId(kind, petId, localId);
        ids.add(id);
        assert.equal(api.localRecordId({ id, kind, petId }), localId);
      }
    }
    assert.equal(ids.size, 8);
  }
  assert.equal(api.cloudRecordId('puppy', 'pet-1', 'pet-1'), 'pet-1');
  assert.equal(api.localRecordId({ id: 'pet-1', kind: 'puppy', petId: 'pet-1' }), 'pet-1');
  assert.equal(api.cloudRecordId('accountPreferences', null, 'preferences'), '["accountPreferences"]');
  assert.equal(api.localRecordId({ id: '["accountPreferences"]', kind: 'accountPreferences', petId: null }), 'preferences');
});

test('invalid or noncanonical identities cannot cross puppy or kind boundaries', () => {
  assert.equal(typeof api.localRecordId, 'function');
  assert.equal(typeof api.cloudRecordId, 'function');
  for (const id of ['bad', '["event","pet-2","id"]', '["routine","pet-1","id"]', '[ "event", "pet-1", "id" ]', '["event","pet-1",""]', JSON.stringify(['event','pet-1','x'.repeat(257)])]) {
    assert.throws(() => api.localRecordId({ id, kind: 'event', petId: 'pet-1' }));
  }
  assert.throws(() => api.cloudRecordId('event', null, 'id'));
  assert.throws(() => api.cloudRecordId('puppy', 'pet-1', 'pet-2'));
  assert.throws(() => api.cloudRecordId('event', 'pet-1', 'x'.repeat(257)));
  assert.throws(() => api.localRecordId({ id: 'pet-2', kind: 'puppy', petId: 'pet-1' }));
  assert.throws(() => api.localRecordId({ id: '["accountPreferences"]', kind: 'accountPreferences', petId: 'pet-1' }));
});

test('field patches contain only changed fields and preserve explicit optional clears', () => {
  assert.equal(typeof api.fieldPatch, 'function');
  assert.deepEqual(api.fieldPatch({ note: 'old', at: 1, endedAt: null }, { at: 2, endedAt: null }), { note: null, at: 2 });
  assert.deepEqual(api.fieldPatch({ widgetActions: ['pee','meal'] }, { widgetActions: ['pee','meal'] }), {});
  assert.deepEqual(api.fieldPatch({ widgetActions: ['pee','meal'] }, { widgetActions: ['meal','pee'] }), { widgetActions: ['meal','pee'] });
  assert.deepEqual(api.fieldPatch(null, { note: 'new', at: 1, customLabel: undefined }), { note: 'new', at: 1 });
});

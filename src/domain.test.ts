import assert from 'node:assert/strict';
import test from 'node:test';

import { createEvent, normalizeBackdateMinutes } from './domain.ts';

test('creates a backdated widget event at the supplied time', () => {
  const event = createEvent('pee', 'widget', 123_456);

  assert.equal(event.at, 123_456);
  assert.equal(event.source, 'widget');
});

test('normalizes widget backdating to five-minute steps within an hour', () => {
  assert.equal(normalizeBackdateMinutes('13'), 15);
  assert.equal(normalizeBackdateMinutes(-5), 0);
  assert.equal(normalizeBackdateMinutes(90), 60);
  assert.equal(normalizeBackdateMinutes('not-a-time'), 0);
});

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createEvent,
  createNapEvent,
  eventPastLabel,
  formatDuration,
  isOpenNap,
  normalizeBackdateMinutes,
  replaceClockTime,
} from './domain.ts';

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

test('changes an event clock time without allowing a future log', () => {
  const original = new Date(2026, 0, 2, 8, 30).getTime();
  const now = new Date(2026, 0, 2, 12, 0).getTime();
  const changed = new Date(replaceClockTime(original, 9, 45, now));

  assert.equal(changed.getHours(), 9);
  assert.equal(changed.getMinutes(), 45);
  assert.equal(replaceClockTime(original, 13, 0, now), now);
});

test('only new timed naps count as running', () => {
  const running = createNapEvent('app', 100);
  const oldPointLog = createEvent('nap', 'app', 50);

  assert.equal(isOpenNap(running), true);
  assert.equal(isOpenNap(oldPointLog), false);
  assert.equal(eventPastLabel(running), 'Nap in progress');
});

test('formats a duration for compact log and chart labels', () => {
  assert.equal(formatDuration(42 * 60_000), '42m');
  assert.equal(formatDuration(90 * 60_000), '1h 30m');
});

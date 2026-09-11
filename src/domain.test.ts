import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createEvent,
  createNapEvent,
  eventPastLabel,
  formatDuration,
  isOpenNap,
  normalizeBackdateMinutes,
  normalizeCustomLabel,
  normalizeEventTypeChange,
  normalizeNote,
  replaceCalendarDate,
  replaceClockTime,
} from './domain.ts';
import { reminderCopy, reminderIdentifier } from './reminder-config.ts';

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

test('normalizes optional log notes', () => {
  assert.equal(normalizeNote('  Just after play  '), 'Just after play');
  assert.equal(normalizeNote('   '), undefined);
  assert.equal(normalizeNote('x'.repeat(301))?.length, 300);
});

test('normalizes custom activity names at their storage boundary', () => {
  assert.equal(normalizeCustomLabel('  Training  '), 'Training');
  assert.equal(normalizeCustomLabel('   '), undefined);
  assert.equal(normalizeCustomLabel('x'.repeat(41))?.length, 40);
  assert.equal(createEvent('custom', 'app', 123, '  Grooming  ').customLabel, 'Grooming');
  assert.equal(createEvent('pee', 'app', 123, 'Not applicable').customLabel, undefined);
});

test('changes point activities without converting to or from a timed nap', () => {
  const pee = createEvent('pee', 'app', 100);
  const nap = createNapEvent('app', 100);

  assert.equal(normalizeEventTypeChange(pee, 'poop'), 'poop');
  assert.equal(normalizeEventTypeChange(pee, 'nap'), 'pee');
  assert.equal(normalizeEventTypeChange(nap, 'walk'), 'nap');
});

test('changes an event clock time without allowing a future log', () => {
  const original = new Date(2026, 0, 2, 8, 30).getTime();
  const now = new Date(2026, 0, 2, 12, 0).getTime();
  const changed = new Date(replaceClockTime(original, 9, 45, now));

  assert.equal(changed.getHours(), 9);
  assert.equal(changed.getMinutes(), 45);
  assert.equal(replaceClockTime(original, 13, 0, now), now);
});

test('changes an event date while preserving its time and preventing future logs', () => {
  const original = new Date(2026, 8, 10, 8, 30).getTime();
  const now = new Date(2026, 8, 12, 12, 0).getTime();
  const changed = new Date(replaceCalendarDate(original, new Date(2026, 8, 9), now));

  assert.equal(changed.getFullYear(), 2026);
  assert.equal(changed.getMonth(), 8);
  assert.equal(changed.getDate(), 9);
  assert.equal(changed.getHours(), 8);
  assert.equal(changed.getMinutes(), 30);
  assert.equal(replaceCalendarDate(original, new Date(2026, 8, 13), now), now);
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

test('creates stable daily reminder content for a schedule entry', () => {
  const entry = { id: 'morning-pee', type: 'pee' as const, minutes: 7 * 60 + 5, reminder: true };

  assert.equal(reminderIdentifier(entry), 'puptime-routine-morning-pee');
  assert.match(reminderCopy(entry).title, /Pee time/);
  assert.match(reminderCopy(entry).body, /7:05/);
});

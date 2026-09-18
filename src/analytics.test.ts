/// <reference types="node" />

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildTimelineDays,
  scheduleStatusesForDay,
  TIMELINE_BUCKETS,
  timelineBucket,
} from './analytics.ts';
import type { PuppyEvent, ScheduleEntry } from './domain.ts';

const day = new Date(2026, 8, 10);
const at = (hour: number, minute: number) => new Date(2026, 8, 10, hour, minute).getTime();

test('matches each event to only one nearby schedule entry of the same type', () => {
  const schedule: ScheduleEntry[] = [
    { id: 'a', type: 'pee', minutes: 7 * 60 },
    { id: 'b', type: 'pee', minutes: 7 * 60 + 20 },
    { id: 'c', type: 'meal', minutes: 8 * 60 },
  ];
  const events: PuppyEvent[] = [
    { id: '1', type: 'pee', at: at(7, 10), source: 'app' },
    { id: '2', type: 'meal', at: at(8, 20), source: 'app' },
  ];

  assert.deepEqual(
    scheduleStatusesForDay(events, schedule, day).map((item) => item.status),
    ['done', 'missed', 'done'],
  );
});

test('reassigns a nearby event when that matches more of the planned routine', () => {
  const schedule: ScheduleEntry[] = [
    { id: 'a', type: 'pee', minutes: 7 * 60 },
    { id: 'b', type: 'pee', minutes: 7 * 60 + 20 },
  ];
  const events: PuppyEvent[] = [
    { id: '1', type: 'pee', at: at(7, 10), source: 'app' },
    { id: '2', type: 'pee', at: at(6, 45), source: 'app' },
  ];

  assert.deepEqual(
    scheduleStatusesForDay(events, schedule, day).map((item) => item.status),
    ['done', 'done'],
  );
});

test('describes completed, due, upcoming, and missed routine items', () => {
  const schedule: ScheduleEntry[] = [
    { id: 'done', type: 'pee', minutes: 7 * 60 },
    { id: 'missed', type: 'meal', minutes: 8 * 60 },
    { id: 'due', type: 'walk', minutes: 9 * 60 },
    { id: 'later', type: 'nap', minutes: 12 * 60 },
  ];
  const events: PuppyEvent[] = [{ id: '1', type: 'pee', at: at(7, 10), source: 'app' }];

  assert.deepEqual(
    scheduleStatusesForDay(events, schedule, day, 30, at(9, 10)).map((item) => item.status),
    ['done', 'missed', 'due', 'upcoming'],
  );
});

test('groups point events into chronological days and 15-minute buckets', () => {
  const events: PuppyEvent[] = [
    { id: 'yesterday', type: 'pee', at: new Date(2026, 8, 9, 22, 59).getTime(), source: 'app' },
    { id: 'early', type: 'pee', at: at(7, 14), source: 'app' },
    { id: 'boundary', type: 'meal', at: at(7, 15), source: 'app' },
  ];
  const result = buildTimelineDays(events, 2, new Date(2026, 8, 10, 18));

  assert.deepEqual(result.map((item) => item.key), ['2026-09-09', '2026-09-10']);
  assert.deepEqual(result[0].marks.map((mark) => mark.startBucket), [91]);
  assert.deepEqual(result[1].marks.map((mark) => mark.startBucket), [28, 29]);
  assert.equal(timelineBucket(new Date(2026, 8, 10, 23, 59).getTime()), TIMELINE_BUCKETS - 1);
});

test('splits a timed nap into 15-minute spans on each calendar day', () => {
  const events: PuppyEvent[] = [{
    id: 'nap',
    type: 'nap',
    at: new Date(2026, 8, 9, 23, 52).getTime(),
    endedAt: at(1, 7),
    source: 'app',
  }];
  const result = buildTimelineDays(events, 2, new Date(2026, 8, 10, 18));

  assert.deepEqual(
    result.map((item) => item.marks.map(({ startBucket, endBucket }) => ({ startBucket, endBucket }))),
    [[{ startBucket: 95, endBucket: 96 }], [{ startBucket: 0, endBucket: 5 }]],
  );
});

test('shows an open nap only up to now and keeps legacy nap taps as points', () => {
  const events: PuppyEvent[] = [
    { id: 'open', type: 'nap', at: at(10, 2), endedAt: null, source: 'app' },
    { id: 'legacy', type: 'nap', at: at(12, 8), source: 'app' },
  ];
  const [result] = buildTimelineDays(events, 1, new Date(2026, 8, 10, 10, 31));

  assert.deepEqual(result.marks, [
    { id: 'open', type: 'nap', label: 'Nap', startBucket: 40, endBucket: 43 },
    { id: 'legacy', type: 'nap', label: 'Nap', startBucket: 48 },
  ]);
});

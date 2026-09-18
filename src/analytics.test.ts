/// <reference types="node" />

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  activityFrequencyStats,
  buildTimelineDays,
  scheduleStatusesForDay,
  suggestScheduleFromEvents,
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

test('summarizes daily frequency across recorded days and consecutive gaps', () => {
  const events: PuppyEvent[] = [
    { id: 'p1', type: 'pee', at: new Date(2026, 8, 8, 7).getTime(), source: 'app' },
    { id: 'p2', type: 'pee', at: new Date(2026, 8, 8, 9).getTime(), source: 'app' },
    { id: 'o1', type: 'poop', at: new Date(2026, 8, 8, 8).getTime(), source: 'app' },
    { id: 'p3', type: 'pee', at: new Date(2026, 8, 9, 7).getTime(), source: 'app' },
    { id: 'p4', type: 'pee', at: new Date(2026, 8, 9, 9).getTime(), source: 'app' },
    { id: 'p5', type: 'pee', at: new Date(2026, 8, 9, 11).getTime(), source: 'app' },
    { id: 'm1', type: 'meal', at: new Date(2026, 8, 9, 12).getTime(), source: 'app' },
    { id: 'p6', type: 'pee', at: new Date(2026, 8, 10, 8).getTime(), source: 'app' },
    { id: 'o2', type: 'poop', at: new Date(2026, 8, 10, 8, 30).getTime(), source: 'app' },
  ];
  const result = activityFrequencyStats(events, ['pee', 'poop'], 14, new Date(2026, 8, 10, 18));

  assert.equal(result.recordedDays, 3);
  assert.deepEqual(
    result.stats.map((stat) => ({
      type: stat.type,
      total: stat.total,
      average: stat.averagePerRecordedDay,
      minimum: stat.minimumPerRecordedDay,
      maximum: stat.maximumPerRecordedDay,
      typicalGap: stat.medianIntervalMinutes,
    })),
    [
      { type: 'pee', total: 6, average: 2, minimum: 1, maximum: 3, typicalGap: 120 },
      { type: 'poop', total: 2, average: 2 / 3, minimum: 0, maximum: 1, typicalGap: 2910 },
    ],
  );
});

test('learns a 15-minute routine from repeated daily log positions', () => {
  const jitters = [0, 10, -5, 5];
  const events: PuppyEvent[] = [];
  jitters.forEach((jitter, dayIndex) => {
    const dayOfMonth = 7 + dayIndex;
    const add = (id: string, type: PuppyEvent['type'], minutes: number) => {
      events.push({
        id: `${id}-${dayIndex}`,
        type,
        at: new Date(2026, 8, dayOfMonth, Math.floor(minutes / 60), minutes % 60).getTime(),
        source: 'app',
      });
    };
    add('pee-morning', 'pee', 7 * 60 + jitter);
    add('meal', 'meal', 8 * 60 + jitter);
    add('pee-midday', 'pee', 11 * 60 + jitter);
    if (dayIndex === 0) add('walk', 'walk', 17 * 60);
  });

  const result = suggestScheduleFromEvents(events, 14, new Date(2026, 8, 10, 20));

  assert.equal(result.daysAnalyzed, 4);
  assert.equal(result.sourceEvents, 13);
  assert.deepEqual(
    result.entries.map(({ type, minutes, reminder }) => ({ type, minutes, reminder })),
    [
      { type: 'pee', minutes: 7 * 60, reminder: false },
      { type: 'meal', minutes: 8 * 60, reminder: false },
      { type: 'pee', minutes: 11 * 60, reminder: false },
    ],
  );
});

test('waits for three recorded days before suggesting a routine', () => {
  const events: PuppyEvent[] = [
    { id: '1', type: 'pee', at: new Date(2026, 8, 9, 7).getTime(), source: 'app' },
    { id: '2', type: 'pee', at: new Date(2026, 8, 10, 7).getTime(), source: 'app' },
  ];

  const result = suggestScheduleFromEvents(events, 14, new Date(2026, 8, 10, 20));
  assert.equal(result.daysAnalyzed, 2);
  assert.deepEqual(result.entries, []);
});

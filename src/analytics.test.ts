/// <reference types="node" />

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  activityFrequencyStats,
  buildTimelineDays,
  estimateMissingLogs,
  monthlyActivityStats,
  scheduleStatusesForDay,
  suggestScheduleFromEvents,
  TIMELINE_BUCKETS,
  timelineBucket,
  timelineDurationRuns,
  timelinePointClusters,
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

test('matches named activities to their own routine entries and frequency rows', () => {
  const schedule: ScheduleEntry[] = [
    { id: 'training', type: 'custom', customLabel: 'Training', minutes: 7 * 60 },
    { id: 'grooming', type: 'custom', customLabel: 'Grooming', minutes: 7 * 60 },
  ];
  const events: PuppyEvent[] = [
    { id: '1', type: 'custom', customLabel: 'training', at: at(7, 5), source: 'app' },
    { id: '2', type: 'custom', customLabel: 'Grooming', at: at(7, 10), source: 'app' },
  ];

  assert.deepEqual(scheduleStatusesForDay(events, schedule, day).map((item) => item.event?.id), ['1', '2']);
  assert.deepEqual(
    activityFrequencyStats(events, schedule, 1, new Date(2026, 8, 10, 20)).stats.map((stat) => [stat.customLabel, stat.total]),
    [['Training', 1], ['Grooming', 1]],
  );
});

test('learns each named activity as a separate routine choice', () => {
  const events: PuppyEvent[] = [7, 8, 9, 10].flatMap((date) => [
    { id: `training-${date}`, type: 'custom', customLabel: 'Training', at: new Date(2026, 8, date, 9).getTime(), source: 'app' },
    { id: `grooming-${date}`, type: 'custom', customLabel: 'Grooming', at: new Date(2026, 8, date, 17).getTime(), source: 'app' },
  ] as PuppyEvent[]);
  const suggestion = suggestScheduleFromEvents(events, 14, new Date(2026, 8, 10, 20));
  assert.deepEqual(suggestion.entries.map(({ customLabel, minutes }) => [customLabel, minutes]), [
    ['Training', 9 * 60],
    ['Grooming', 17 * 60],
  ]);
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

test('combines simultaneous point activities and an underlying span into one timeline cluster', () => {
  const marks = [
    { id: 'nap', type: 'nap' as const, label: 'Nap', startBucket: 20, endBucket: 28 },
    { id: 'pee', type: 'pee' as const, label: 'Pee', startBucket: 24 },
    { id: 'pee-again', type: 'pee' as const, label: 'Pee', startBucket: 24 },
    { id: 'meal', type: 'meal' as const, label: 'Ate', startBucket: 24 },
    { id: 'walk', type: 'walk' as const, label: 'Walk', startBucket: 30 },
  ];

  assert.deepEqual(timelinePointClusters(marks), [
    {
      startBucket: 24,
      ids: ['pee', 'pee-again', 'meal'],
      types: ['nap', 'pee', 'pee', 'meal'],
      hasDuration: true,
    },
    { startBucket: 30, ids: ['walk'], types: ['walk'], hasDuration: false },
  ]);
});

test('joins touching and overlapping spans of the same activity', () => {
  const marks = [
    { id: 'a', type: 'nap' as const, label: 'Nap', startBucket: 20, endBucket: 24 },
    { id: 'd', type: 'nap' as const, label: 'Nap', startBucket: 27, endBucket: 30 },
    { id: 'c', type: 'walk' as const, label: 'Walk', startBucket: 25, endBucket: 27 },
    { id: 'b', type: 'nap' as const, label: 'Nap', startBucket: 24, endBucket: 28 },
    { id: 'e', type: 'nap' as const, label: 'Nap', startBucket: 32, endBucket: 34 },
  ];

  assert.deepEqual(timelineDurationRuns(marks), [
    { type: 'nap', startBucket: 20, endBucket: 30 },
    { type: 'walk', startBucket: 25, endBucket: 27 },
    { type: 'nap', startBucket: 32, endBucket: 34 },
  ]);
});

test('can anchor a timeline in history while open naps still use the real current time', () => {
  const events: PuppyEvent[] = [
    {
      id: 'open',
      type: 'nap',
      at: new Date(2026, 8, 4, 23, 45).getTime(),
      endedAt: null,
      source: 'app',
    },
    {
      id: 'evening',
      type: 'walk',
      at: new Date(2026, 8, 5, 20).getTime(),
      source: 'app',
    },
  ];
  const result = buildTimelineDays(
    events,
    2,
    new Date(2026, 8, 5, 9),
    new Date(2026, 8, 10, 18),
  );

  assert.deepEqual(result.map((item) => item.key), ['2026-09-04', '2026-09-05']);
  assert.deepEqual(
    result.map((item) => item.marks.map(({ id, startBucket, endBucket }) => ({ id, startBucket, endBucket }))),
    [
      [{ id: 'open', startBucket: 95, endBucket: 96 }],
      [
        { id: 'open', startBucket: 0, endBucket: 96 },
        { id: 'evening', startBucket: 80, endBucket: undefined },
      ],
    ],
  );
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

test('summarizes every recorded month while applying an activity filter', () => {
  const events: PuppyEvent[] = [
    { id: 'sep-poop', type: 'poop', at: new Date(2026, 8, 2, 8).getTime(), source: 'app' },
    { id: 'aug-pee', type: 'pee', at: new Date(2026, 7, 1, 7).getTime(), source: 'app' },
    { id: 'aug-meal', type: 'meal', at: new Date(2026, 7, 1, 8).getTime(), source: 'app' },
    { id: 'aug-meal-2', type: 'meal', at: new Date(2026, 7, 3, 8).getTime(), source: 'app' },
  ];

  assert.deepEqual(
    monthlyActivityStats(events, ['pee']).map(({ key, total, recordedDays, averagePerRecordedDay }) => ({
      key,
      total,
      recordedDays,
      averagePerRecordedDay,
    })),
    [
      { key: '2026-09', total: 0, recordedDays: 1, averagePerRecordedDay: 0 },
      { key: '2026-08', total: 1, recordedDays: 2, averagePerRecordedDay: 0.5 },
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

test('flags a repeated meal slot when logging continued after the gap', () => {
  const events: PuppyEvent[] = [];
  for (let dayOfMonth = 4; dayOfMonth <= 10; dayOfMonth += 1) {
    const add = (id: string, type: PuppyEvent['type'], hour: number) => events.push({
      id: `${id}-${dayOfMonth}`,
      type,
      at: new Date(2026, 8, dayOfMonth, hour).getTime(),
      source: 'app',
    });
    add('breakfast', 'meal', 8);
    if (dayOfMonth !== 9) add('lunch', 'meal', 12);
    add('dinner', 'meal', 18);
    add('evening-pee', 'pee', 20);
  }

  const result = estimateMissingLogs(events, 14, new Date(2026, 8, 10, 22));

  assert.deepEqual(
    result.estimates.map(({ type, at, observedDays, comparedDays }) => ({
      type,
      day: new Date(at).getDate(),
      hour: new Date(at).getHours(),
      observedDays,
      comparedDays,
    })),
    [{ type: 'meal', day: 9, hour: 12, observedDays: 6, comparedDays: 6 }],
  );
});

test('estimates a missing nap span from completed naps at the same daily slot', () => {
  const events: PuppyEvent[] = [];
  for (let dayOfMonth = 6; dayOfMonth <= 10; dayOfMonth += 1) {
    events.push({
      id: `morning-${dayOfMonth}`,
      type: 'pee',
      at: new Date(2026, 8, dayOfMonth, 9).getTime(),
      source: 'app',
    });
    if (dayOfMonth !== 9) {
      const start = new Date(2026, 8, dayOfMonth, 13).getTime();
      events.push({ id: `nap-${dayOfMonth}`, type: 'nap', at: start, endedAt: start + 90 * 60_000, source: 'app' });
    }
    events.push({
      id: `afternoon-${dayOfMonth}`,
      type: 'pee',
      at: new Date(2026, 8, dayOfMonth, 16).getTime(),
      source: 'app',
    });
  }

  const result = estimateMissingLogs(events, 14, new Date(2026, 8, 10, 22));
  const nap = result.estimates.find((estimate) => estimate.type === 'nap');

  assert.ok(nap);
  assert.equal(new Date(nap.at).getDate(), 9);
  assert.equal(new Date(nap.at).getHours(), 13);
  assert.equal(nap.endedAt, nap.at + 90 * 60_000);
});

test('does not guess on a blank day or before a possible slot has passed', () => {
  const events: PuppyEvent[] = [];
  for (let dayOfMonth = 6; dayOfMonth <= 9; dayOfMonth += 1) {
    events.push({ id: `meal-${dayOfMonth}`, type: 'meal', at: new Date(2026, 8, dayOfMonth, 18).getTime(), source: 'app' });
    events.push({ id: `pee-${dayOfMonth}`, type: 'pee', at: new Date(2026, 8, dayOfMonth, 20).getTime(), source: 'app' });
  }
  events.push({ id: 'today-pee', type: 'pee', at: new Date(2026, 8, 10, 10).getTime(), source: 'app' });

  const result = estimateMissingLogs(events, 14, new Date(2026, 8, 10, 12));

  assert.deepEqual(result.estimates, []);
});

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
  timelineMarksForPointHit,
  timelineMarkerGroups,
  type TimelineMark,
  timelinePointClusters,
} from './analytics.ts';
import { latestQuickEventTimes, type PuppyEvent, type ScheduleEntry } from './domain.ts';

const day = new Date(2026, 8, 10);
const at = (hour: number, minute: number) => new Date(2026, 8, 10, hour, minute).getTime();

test('dense completed days can be analyzed without blocking activity screens', () => {
  const now = new Date(2026, 8, 15, 12);
  const events: PuppyEvent[] = Array.from({length: 14 * 1440}, (_, index) => ({
    id: `dense-${index}`, type: 'pee', source: 'app',
    at: new Date(2026, 8, 1, 0, index).getTime(),
  }));
  const started = performance.now();
  const result = suggestScheduleFromEvents(events, 14, now);
  const elapsed = performance.now() - started;
  assert.equal(result.sourceEvents, events.length);
  assert.equal(result.daysAnalyzed, 14);
  assert.ok(result.entries.length > 0);
  assert.ok(elapsed < 1000, `dense analysis took ${Math.round(elapsed)}ms`);
});

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
  const estimated: PuppyEvent[] = [
    { id: 'estimated-training', type: 'custom', customLabel: 'Training', at: at(8, 0), source: 'app', estimated: true },
    { id: 'estimated-grooming', type: 'custom', customLabel: 'Grooming', at: at(9, 0), source: 'app', estimated: true },
  ];
  assert.deepEqual(
    activityFrequencyStats([...events, ...estimated], schedule, 1, new Date(2026, 8, 10, 20)).stats
      .map((stat) => [stat.customLabel, stat.total, stat.estimatedTotal]),
    [['Training', 1, 1], ['Grooming', 1, 1]],
  );
  assert.deepEqual(latestQuickEventTimes([...events, ...estimated]), {
    'custom:training': at(7, 5), 'custom:grooming': at(7, 10),
  });
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

test('timeline taps include saved estimates but exclude automatic gap hints', () => {
  const marks = [
    { id: 'recorded', type: 'pee' as const, label: 'Pee', startBucket: 24 },
    { id: 'saved-point', type: 'poop' as const, label: 'Poop', startBucket: 24, estimated: true },
    { id: 'saved-span', type: 'nap' as const, label: 'Nap', startBucket: 20, endBucket: 26, estimated: true },
    { id: 'automatic-gap', type: 'meal' as const, label: 'Meal', startBucket: 24, estimated: true },
    { id: 'other-bucket', type: 'pee' as const, label: 'Pee', startBucket: 25, estimated: true },
  ];
  const savedEstimateIds = new Set(['saved-point', 'saved-span', 'other-bucket']);
  assert.deepEqual(timelineMarksForPointHit(marks, 24).map((mark) => mark.id), ['recorded']);
  assert.deepEqual(timelineMarksForPointHit(marks, 24, savedEstimateIds).map((mark) => mark.id), ['recorded', 'saved-point', 'saved-span']);
});

test('a timeline tap includes only its bucket and overlapping recorded spans', () => {
  const marks = [
    { id: 'nap', type: 'nap' as const, label: 'Nap', startBucket: 20, endBucket: 26 },
    { id: 'pee', type: 'pee' as const, label: 'Pee', startBucket: 24 },
    { id: 'poop', type: 'poop' as const, label: 'Poop', startBucket: 24 },
    { id: 'adjacent', type: 'pee' as const, label: 'Pee', startBucket: 25 },
    { id: 'meal', type: 'meal' as const, label: 'Ate', startBucket: 30 },
    { id: 'later-nap', type: 'nap' as const, label: 'Nap', startBucket: 29, endBucket: 33 },
    { id: 'walk', type: 'walk' as const, label: 'Walk', startBucket: 40 },
    { id: 'ended', type: 'nap' as const, label: 'Nap', startBucket: 20, endBucket: 24 },
    { id: 'estimated', type: 'pee' as const, label: 'Pee', startBucket: 24, estimated: true },
  ];

  assert.deepEqual(timelineMarksForPointHit(marks, 24).map((mark) => mark.id), ['nap', 'pee', 'poop']);
  assert.deepEqual(timelineMarksForPointHit(marks, 30).map((mark) => mark.id), ['meal', 'later-nap']);
  assert.deepEqual(timelineMarksForPointHit(marks, 40).map((mark) => mark.id), ['walk']);
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

test('learns a 15-minute routine from recurring clock-time windows', () => {
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

  const result = suggestScheduleFromEvents(events, 14, new Date(2026, 8, 11, 20));

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

  const result = suggestScheduleFromEvents(events, 14, new Date(2026, 8, 11, 20));
  assert.equal(result.daysAnalyzed, 2);
  assert.deepEqual(result.entries, []);
});

test('keeps breakfast and dinner separate when early meals are skipped and extra taps occur', () => {
  const events: PuppyEvent[] = [];
  for (let index = 0; index < 7; index += 1) {
    const add = (id: string, minutes: number) => events.push({
      id: `${id}-${index}`, type: 'meal', source: 'app',
      at: new Date(2026, 8, 4 + index, 0, minutes).getTime(),
    });
    if (index < 4) add('breakfast', 490 + index * 20);
    add('dinner', 19 * 60);
    if (index < 2) {
      for (let tap = 0; tap < 10; tap += 1) add(`extra-${tap}`, 19 * 60 + 1);
      add('unusual', 2 * 60);
    }
  }
  const result = suggestScheduleFromEvents(events, 14, new Date(2026, 8, 11));
  assert.deepEqual(result.entries.map(({ minutes }) => minutes), [8 * 60 + 45, 19 * 60]);
  assert.deepEqual(result.entries.map((entry) => result.observedDaysByEntry[entry.id]), [4, 7]);
  assert.deepEqual(result, suggestScheduleFromEvents([...events].reverse(), 14, new Date(2026, 8, 11)));
});

test('learns variation without letting one unusual time widen the window', () => {
  const events: PuppyEvent[] = [480, 490, 500, 520, 530, 550, 1250].map((minutes, index) => ({
    id: `${index}`, type: 'meal', source: 'app',
    at: new Date(2026, 8, 4 + index, 0, minutes).getTime(),
  }));
  const result = suggestScheduleFromEvents(events, 14, new Date(2026, 8, 11));
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].minutes, 8 * 60 + 30);
  assert.equal(result.observedDaysByEntry[result.entries[0].id], 6);
  assert.ok(result.entries[0].toleranceMinutes! <= 60);
});

test('learns midnight as one window and matches logs across the calendar boundary', () => {
  const events: PuppyEvent[] = [1425, 0, 15, 1430, 10, 1435, 5].map((minutes, index) => ({
    id: `${index}`, type: 'pee', source: 'app',
    at: new Date(2026, 8, 4 + index, 0, minutes).getTime(),
  }));
  const result = suggestScheduleFromEvents(events, 14, new Date(2026, 8, 11));
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].minutes, 0);
  assert.equal(result.entries[0].toleranceMinutes, 30);
  assert.equal(scheduleStatusesForDay(events, result.entries, day, 30, at(23, 59))[0].status, 'done');
  const beforeMidnight: PuppyEvent[] = [{ id: 'prior-night', type: 'pee', source: 'app', at: new Date(2026, 8, 9, 23, 55).getTime() }];
  assert.equal(scheduleStatusesForDay(beforeMidnight, result.entries, day, 30, at(1, 0))[0].status, 'done');
  assert.equal(scheduleStatusesForDay(beforeMidnight, [{ id: 'manual', type: 'pee', minutes: 0 }], day, 30, at(1, 0))[0].status, 'missed');
});

test('uses completed days only and leaves sparse or exactly half-day patterns unlearned', () => {
  const events: PuppyEvent[] = [];
  for (let index = 0; index < 6; index += 1) {
    events.push({ id: `meal-${index}`, type: 'meal', source: 'app', at: new Date(2026, 8, 4 + index, 8).getTime() });
    if (index < 3) events.push({ id: `walk-${index}`, type: 'walk', source: 'app', at: new Date(2026, 8, 4 + index, 17).getTime() });
  }
  const now = new Date(2026, 8, 10, 12);
  const baseline = suggestScheduleFromEvents(events, 14, now);
  assert.deepEqual(baseline.entries.map(({ type }) => type), ['meal']);
  events.push({ id: 'partial', type: 'pee', source: 'app', at: at(7, 0) });
  events.push({ id: 'future', type: 'pee', source: 'app', at: new Date(2026, 8, 11, 7).getTime() });
  events.push({ id: 'old', type: 'pee', source: 'app', at: new Date(2026, 7, 1, 7).getTime() });
  assert.deepEqual(suggestScheduleFromEvents(events, 14, now), baseline);
});

test('uses learned variation for routine status while keeping one log per slot', () => {
  const schedule: ScheduleEntry[] = [
    { id: 'one', type: 'meal', minutes: 9 * 60, toleranceMinutes: 75 },
    { id: 'two', type: 'meal', minutes: 10 * 60, toleranceMinutes: 75 },
  ];
  const events: PuppyEvent[] = [{ id: 'late', type: 'meal', at: at(10, 5), source: 'app' }];
  const result = scheduleStatusesForDay(events, schedule, day, 30, at(10, 10));
  assert.equal(result.filter((item) => item.status === 'done').length, 1);
  assert.equal(result.filter((item) => item.status === 'due').length, 1);
  assert.equal(scheduleStatusesForDay([], [schedule[0]], day, 30, at(10, 10))[0].status, 'due');
  assert.equal(scheduleStatusesForDay(events, [schedule[0]], day, 30, at(10, 10))[0].status, 'done');
  assert.equal(scheduleStatusesForDay(events, [schedule[0]], day, 30, at(8, 0))[0].status, 'due');
});

test('does not infer a missing meal when an unmatched meal could be a shifted occurrence', () => {
  const events: PuppyEvent[] = [];
  for (let dayOfMonth = 4; dayOfMonth <= 10; dayOfMonth += 1) {
    for (const hour of [8, dayOfMonth === 9 ? 15 : 12, 19]) {
      events.push({ id: `${dayOfMonth}-${hour}`, type: 'meal', source: 'app', at: new Date(2026, 8, dayOfMonth, hour).getTime() });
    }
    events.push({ id: `pee-${dayOfMonth}`, type: 'pee', source: 'app', at: new Date(2026, 8, dayOfMonth, 21).getTime() });
  }
  assert.deepEqual(estimateMissingLogs(events, 14, new Date(2026, 8, 11)).estimates, []);
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

  const days = buildTimelineDays(events, 7, new Date(2026, 8, 10, 22), new Date(2026, 8, 10, 22), result.estimates);
  assert.deepEqual(days.find((day) => day.key === '2026-09-09')?.marks.filter((mark) => mark.estimated), [
    { id: result.estimates[0].id, type: 'meal', label: 'Ate', startBucket: 48, estimated: true },
  ]);
  assert.equal(events.some((event) => event.id === result.estimates[0].id), false);
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
  assert.deepEqual(
    buildTimelineDays(events, 2, new Date(2026, 8, 10, 22), new Date(2026, 8, 10, 22), result.estimates)
      .find((day) => day.key === '2026-09-09')?.marks.filter((mark) => mark.estimated && mark.type === 'nap')
      .map(({ startBucket, endBucket, estimated }) => ({ startBucket, endBucket, estimated })),
    [{ startBucket: 52, endBucket: 58, estimated: true }],
  );

  // An even number of observations can produce a half-millisecond median.
  const variedDurations = events.map((event) => event.type === 'nap' && typeof event.endedAt === 'number'
    ? { ...event, endedAt: event.endedAt + Number(new Date(event.at).getDate() >= 8) }
    : event);
  const roundedNap = estimateMissingLogs(variedDurations, 14, new Date(2026, 8, 10, 22))
    .estimates.find((estimate) => estimate.type === 'nap');
  assert.ok(roundedNap);
  assert.equal(roundedNap.endedAt, roundedNap.at + 90 * 60_000 + 1);
  assert.equal(Number.isInteger(roundedNap.at), true);
  assert.equal(Number.isInteger(roundedNap.endedAt), true);

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

test('keeps estimates visible in point and spanning nap history while counting them separately', () => {
  const events: PuppyEvent[] = [
    { id: 'recorded-pee', type: 'pee', at: at(7, 0), source: 'app' },
    { id: 'estimated-pee', type: 'pee', at: at(8, 0), source: 'app', estimated: true },
    { id: 'recorded-pee-later', type: 'pee', at: at(9, 0), source: 'widget' },
    {
      id: 'estimated-nap', type: 'nap', source: 'app', estimated: true,
      at: new Date(2026, 8, 9, 23, 30).getTime(), endedAt: at(1, 0),
    },
    { id: 'estimated-only-month', type: 'pee', source: 'app', estimated: true, at: new Date(2026, 7, 2, 8).getTime() },
  ];
  const frequency = activityFrequencyStats(events, ['pee'], 14, new Date(2026, 8, 10, 18));
  assert.equal(frequency.recordedDays, 1);
  assert.equal(frequency.stats[0].total, 2);
  assert.equal(frequency.stats[0].estimatedTotal, 1);
  assert.equal(frequency.stats[0].averagePerRecordedDay, 2);
  assert.equal(frequency.stats[0].medianIntervalMinutes, 120);
  assert.deepEqual(latestQuickEventTimes(events), { pee: at(9, 0) });
  assert.deepEqual(
    monthlyActivityStats(events).map(({ total, estimatedTotal, recordedDays, averagePerRecordedDay }) => ({
      total, estimatedTotal, recordedDays, averagePerRecordedDay,
    })),
    [
      { total: 2, estimatedTotal: 2, recordedDays: 1, averagePerRecordedDay: 2 },
      { total: 0, estimatedTotal: 1, recordedDays: 0, averagePerRecordedDay: 0 },
    ],
  );
  const days = buildTimelineDays(events, 2, new Date(2026, 8, 10, 18));
  assert.equal(days[0].marks.find((mark) => mark.id === 'estimated-nap')?.estimated, true);
  assert.equal(days[1].marks.find((mark) => mark.id === 'estimated-nap')?.estimated, true);
  assert.equal(days[1].marks.find((mark) => mark.id === 'estimated-pee')?.estimated, true);
  assert.equal(days[1].marks.find((mark) => mark.id === 'recorded-pee')?.estimated, undefined);
});

test('does not learn routine windows or mark completion from estimated logs', () => {
  const recorded: PuppyEvent[] = [8, 9].map((date) => ({
    id: `recorded-${date}`, type: 'meal', source: 'app', at: new Date(2026, 8, date, 8).getTime(),
  }));
  const estimated: PuppyEvent[] = [4, 5, 6, 7, 10].map((date) => ({
    id: `estimated-${date}`, type: 'meal', source: 'app', estimated: true,
    at: new Date(2026, 8, date, 8).getTime(),
  }));
  const now = new Date(2026, 8, 11);
  assert.deepEqual(suggestScheduleFromEvents([...recorded, ...estimated], 14, now), suggestScheduleFromEvents(recorded, 14, now));
  assert.equal(scheduleStatusesForDay(estimated, [{ id: 'breakfast', type: 'meal', minutes: 8 * 60 }], day, 30, at(10, 0))[0].status, 'missed');
});

test('does not infer a gap from estimated activity after an otherwise unfinished day', () => {
  const events: PuppyEvent[] = [];
  for (let date = 4; date <= 10; date += 1) {
    events.push({ id: `breakfast-${date}`, type: 'meal', source: 'app', at: new Date(2026, 8, date, 8).getTime() });
    if (date !== 9) events.push({ id: `lunch-${date}`, type: 'meal', source: 'app', at: new Date(2026, 8, date, 12).getTime() });
  }
  events.push({ id: 'estimated-evening', type: 'pee', source: 'app', estimated: true, at: new Date(2026, 8, 9, 20).getTime() });
  assert.deepEqual(estimateMissingLogs(events, 14, new Date(2026, 8, 11)).estimates, []);
});

test('does not offer an accepted estimate again or use it to strengthen the learned routine', () => {
  const events: PuppyEvent[] = [];
  for (let date = 4; date <= 10; date += 1) {
    if (date !== 9) events.push({ id: `meal-${date}`, type: 'meal', source: 'app', at: new Date(2026, 8, date, 12).getTime() });
    events.push({ id: `pee-${date}`, type: 'pee', source: 'app', at: new Date(2026, 8, date, 20).getTime() });
  }
  const now = new Date(2026, 8, 11);
  const baseline = suggestScheduleFromEvents(events, 14, now);
  const [estimate] = estimateMissingLogs(events, 14, now).estimates;
  assert.ok(estimate);
  const accepted: PuppyEvent = { id: 'accepted', type: estimate.type, at: estimate.at, source: 'app', estimated: true };
  assert.deepEqual(estimateMissingLogs([...events, accepted], 14, now).estimates, []);
  assert.deepEqual(suggestScheduleFromEvents([...events, accepted], 14, now), baseline);
});

test('infers and suppresses accepted gaps for each named activity independently', () => {
  const events: PuppyEvent[] = [];
  for (let date = 4; date <= 10; date += 1) {
    if (date !== 9) events.push({ id: `training-${date}`, type: 'custom', customLabel: 'Training', source: 'app', at: new Date(2026, 8, date, 12).getTime() });
    events.push({ id: `grooming-${date}`, type: 'custom', customLabel: 'Grooming', source: 'app', at: new Date(2026, 8, date, 15).getTime() });
    events.push({ id: `pee-${date}`, type: 'pee', source: 'app', at: new Date(2026, 8, date, 20).getTime() });
  }
  const now = new Date(2026, 8, 11);
  const baseline = suggestScheduleFromEvents(events, 14, now);
  const [estimate] = estimateMissingLogs(events, 14, now).estimates;
  assert.ok(estimate);
  assert.equal(estimate.customLabel, 'Training');
  const accepted: PuppyEvent = { id: 'accepted-training', type: 'custom', customLabel: 'Training', at: estimate.at, source: 'app', estimated: true };
  const recovered = [...events, accepted];
  assert.deepEqual(estimateMissingLogs(recovered, 14, now).estimates, []);
  assert.deepEqual(suggestScheduleFromEvents(recovered, 14, now), baseline);
  assert.deepEqual(buildTimelineDays(recovered, 3, now, now).flatMap((day) => day.marks).filter((mark) => mark.estimated).map((mark) => mark.id), [accepted.id]);
});


test('illustrated timeline merges connected screen-space collisions, preserving every point', () => {
  const marks: TimelineMark[] = [
    { id: 'meal', type: 'meal', label: 'Eat', startBucket: 30 },
    { id: 'pee', type: 'pee', label: 'Pee', startBucket: 10 },
    { id: 'poop', type: 'poop', label: 'Poop', startBucket: 20, estimated: true },
    { id: 'nap', type: 'nap', label: 'Nap', startBucket: 10, endBucket: 40 },
    { id: 'late', type: 'pee', label: 'Pee', startBucket: 95 },
  ];
  const original = structuredClone(marks);
  const groups = timelineMarkerGroups(marks, 300);
  assert.deepEqual(groups.map(group => group.marks.map(mark => mark.id)), [['pee', 'poop', 'meal'], ['late']]);
  assert.equal(groups[0].center, 20.5 * 300 / 96);
  assert.equal(groups[0].marks[1].estimated, true);
  assert.deepEqual(marks, original);
  // The same times separate when their artwork no longer collides at higher zoom.
  assert.deepEqual(timelineMarkerGroups(marks, 1200).map(group => group.marks.map(mark => mark.id)), [['pee'], ['poop'], ['meal'], ['late']]);
});

test('illustrated timeline keeps same-bucket logs together at every zoom and handles day edges', () => {
  const marks: TimelineMark[] = [
    { id: 'first', type: 'pee', label: 'Pee', startBucket: 0 },
    { id: 'second', type: 'meal', label: 'Eat', startBucket: 0 },
    { id: 'last', type: 'poop', label: 'Poop', startBucket: 95 },
  ];
  assert.deepEqual(timelineMarkerGroups([], 300), []);
  for (const width of [300, 1200]) {
    const groups = timelineMarkerGroups(marks, width);
    assert.deepEqual(groups.map(group => group.marks.map(mark => mark.id)), [['first', 'second'], ['last']]);
    assert.ok(groups.every(group => group.center >= 0 && group.center <= width));
  }
});

/// <reference types="node" />

import assert from 'node:assert/strict';
import test from 'node:test';

import { adherenceForDay, summarizeDays } from './analytics.ts';
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

  assert.equal(adherenceForDay(events, schedule, day), 67);
});

test('summarizes days in chronological order', () => {
  const events: PuppyEvent[] = [{ id: '1', type: 'nap', at: at(10, 0), source: 'app' }];
  const result = summarizeDays(events, [], 2, new Date(2026, 8, 10, 18));

  assert.deepEqual(result.map((item) => item.key), ['2026-09-09', '2026-09-10']);
  assert.equal(result[1].counts.nap, 1);
  assert.equal(result[1].adherence, null);
});

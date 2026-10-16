/// <reference types="node" />

import assert from 'node:assert/strict';
import test from 'node:test';

import { timelineDayEvents, timelineDetailTime, timelineFormatters } from './timeline-format.ts';

test('reuses timeline formatters across activities and tab mounts in every app language', () => {
  for (const language of ['en', 'zh-Hans', 'es'] as const) {
    const cached = timelineFormatters(language);
    const reference = new Intl.DateTimeFormat(language, { hour: 'numeric', minute: '2-digit' });
    for (let bucket = 0; bucket <= 96; bucket += 1) {
      const date = new Date(2000, 0, 1, 0, bucket * 15);
      assert.equal(timelineFormatters(language), cached);
      assert.equal(cached.time.format(date), reference.format(date));
    }
    const date = new Date(2026, 9, 12);
    assert.equal(cached.fullDate.format(date), new Intl.DateTimeFormat(language, {
      weekday: 'long', month: 'long', day: 'numeric',
    }).format(date));
  }
  assert.notEqual(timelineFormatters('en'), timelineFormatters('zh-Hans'));
  assert.notEqual(timelineFormatters('en'), timelineFormatters('es'));
});

test('details omit a repeated date but retain dates for mixed days and overnight durations', () => {
  const start = new Date(2026, 9, 12, 23, 45).getTime();
  const end = new Date(2026, 9, 13, 0, 30).getTime();
  for (const language of ['en', 'zh-Hans', 'es'] as const) {
    const { time, rangeDate } = timelineFormatters(language);
    assert.equal(timelineDetailTime(start, language, start), time.format(start));
    assert.equal(timelineDetailTime(end, language, start), `${rangeDate.format(end)} · ${time.format(end)}`);
    assert.equal(timelineDetailTime(start, language), `${rangeDate.format(start)} · ${time.format(start)}`);
  }
});


test('day moments sort chronologically and include only overlapping overnight or running naps', () => {
  const day = new Date(2026, 9, 16).getTime();
  const hour = 3_600_000;
  const events = [
    { id: 'meal', type: 'meal' as const, at: day + 12 * hour, source: 'app' as const },
    { id: 'pee', type: 'pee' as const, at: day + 8 * hour, source: 'app' as const },
    { id: 'overnight', type: 'nap' as const, at: day - hour, endedAt: day + hour, source: 'app' as const },
    { id: 'boundary', type: 'nap' as const, at: day - 2 * hour, endedAt: day, source: 'app' as const },
    { id: 'old-point', type: 'nap' as const, at: day - hour, source: 'app' as const },
    { id: 'running', type: 'nap' as const, at: day + 13 * hour, endedAt: null, source: 'app' as const },
    { id: 'tomorrow', type: 'pee' as const, at: day + 24 * hour, source: 'app' as const },
  ];
  assert.deepEqual(timelineDayEvents(events, day, day + 14 * hour).map((event) => event.id), ['overnight', 'pee', 'meal', 'running']);
  assert.deepEqual(timelineDayEvents([events[5]], day + 24 * hour, day + 25 * hour).map((event) => event.id), ['running']);
  assert.deepEqual(events.map((event) => event.id), ['meal', 'pee', 'overnight', 'boundary', 'old-point', 'running', 'tomorrow']);
});

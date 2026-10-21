/// <reference types="node" />

import assert from 'node:assert/strict';
import test from 'node:test';

import { collapseEmptyTimelineDays, timelineDayEvents, timelineDetailTime, timelineExpectedWindows, timelineFormatters } from './timeline-format.ts';
import { buildTimelineDays } from './analytics.ts';

test('expected routine bands keep exact minutes, repeat across midnight, and follow activity filters', () => {
  const schedule = [
    { id: 'rtn_breakfast', type: 'meal' as const, minutes: 487, toleranceMinutes: 15 },
    { id: 'rtn_early', type: 'poop' as const, minutes: 10, toleranceMinutes: 30 },
    { id: 'rtn_late', type: 'meal' as const, minutes: 1430, toleranceMinutes: 30 },
    { id: 'rtn_point', type: 'meal' as const, minutes: 720 },
    { id: 'rtn_off', type: 'poop' as const, minutes: 720, toleranceMinutes: 0 },
    { id: 'rtn_pee', type: 'pee' as const, minutes: 720, toleranceMinutes: 30 },
  ];
  const before = structuredClone(schedule);
  assert.deepEqual(timelineExpectedWindows(schedule, ['meal', 'poop', 'pee']), [
    { id: 'rtn_breakfast', type: 'meal', start: 472, end: 502 },
    { id: 'rtn_early', type: 'poop', start: 0, end: 40 },
    { id: 'rtn_early', type: 'poop', start: 1420, end: 1440 },
    { id: 'rtn_late', type: 'meal', start: 1400, end: 1440 },
    { id: 'rtn_late', type: 'meal', start: 0, end: 20 },
  ]);
  assert.equal(timelineExpectedWindows(schedule, ['meal']).length, 3);
  assert.deepEqual(timelineExpectedWindows(schedule, ['pee']), []);
  assert.deepEqual(timelineExpectedWindows([], ['meal', 'poop']), []);
  for (const toleranceMinutes of [720, 1440]) {
    assert.deepEqual(timelineExpectedWindows([{ id: 'rtn_all', type: 'poop', minutes: 20, toleranceMinutes }], ['poop']), [
      { id: 'rtn_all', type: 'poop', start: 0, end: 1440 },
    ]);
  }
  assert.deepEqual(schedule, before);
});

test('collapses consecutive empty days while retaining today, isolated days, and all activity marks', () => {
  const now = new Date(2026, 9, 21, 12);
  const days = buildTimelineDays([
    { id: 'evt_old', type: 'meal', at: new Date(2026, 9, 8, 12).getTime(), source: 'app' },
    { id: 'evt_nap', type: 'nap', at: new Date(2026, 9, 17, 23).getTime(), endedAt: new Date(2026, 9, 18, 1).getTime(), source: 'app' },
    { id: 'evt_estimate', type: 'pee', at: new Date(2026, 9, 20, 12).getTime(), estimated: true, source: 'app' },
  ], 14, now);
  const rows = collapseEmptyTimelineDays(days, '2026-10-21');
  assert.equal(rows.length, 7);
  assert.equal(rows[0], days[0]);
  assert.deepEqual(rows[1], { key: 'gap-2026-10-09', start: days[1].date, end: days[8].date, emptyDays: 8 });
  assert.deepEqual(rows.slice(2), days.slice(9));
  // Grouping does not mutate days or discard an overnight/saved estimated mark.
  assert.equal(days.length, 14);
  assert.equal(days[1].marks.length, 0);
  assert.deepEqual(collapseEmptyTimelineDays([], '2026-10-21'), []);
  const empty = buildTimelineDays([], 90, now);
  const compact = collapseEmptyTimelineDays(empty, '2026-10-21');
  assert.equal(compact.length, 2);
  assert.equal('emptyDays' in compact[0] && compact[0].emptyDays, 89);
  assert.equal(compact[1], empty[89]);
  // Loading another page extends the same gap, rather than adding repeated separators.
  const longer = collapseEmptyTimelineDays(buildTimelineDays([], 104, now), '2026-10-21');
  assert.equal(longer.length, 2);
  assert.equal('emptyDays' in longer[0] && longer[0].emptyDays, 103);
});

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

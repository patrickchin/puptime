import assert from 'node:assert/strict';
import test from 'node:test';

import { eventsToCsv } from './export.ts';

test('exports activity in chronological order with exact and local timestamps', () => {
  const later = new Date(2026, 8, 11, 9, 5).getTime();
  const earlier = new Date(2026, 8, 10, 7, 3).getTime();
  const csv = eventsToCsv([
    { id: '2', type: 'pee', at: later, source: 'widget' },
    { id: '1', type: 'meal', at: earlier, source: 'app' },
  ]);

  assert.ok(csv.startsWith('\uFEFFDate,Time,Activity,Type,Started At (ISO)'));
  assert.ok(csv.indexOf('2026-09-10,07:03,Ate,meal') < csv.indexOf('2026-09-11,09:05,Pee,pee'));
  assert.match(csv, new RegExp(`${new Date(earlier).toISOString()},,,,app`));
});

test('escapes notes and custom labels without losing spreadsheet rows', () => {
  const csv = eventsToCsv([
    {
      id: '1',
      type: 'custom',
      customLabel: 'Training, recall',
      at: new Date(2026, 8, 11, 10, 0).getTime(),
      note: 'After play, she said "hello"\nthen settled',
      source: 'app',
    },
  ]);

  assert.match(csv, /"Training, recall",custom/);
  assert.match(csv, /"After play, she said ""hello""\nthen settled",app/);
});

test('exports completed nap duration and leaves an open nap unfinished', () => {
  const start = new Date(2026, 8, 11, 13, 0).getTime();
  const csv = eventsToCsv([
    { id: 'open', type: 'nap', at: start + 2 * 60 * 60_000, endedAt: null, source: 'app' },
    { id: 'done', type: 'nap', at: start, endedAt: start + 95 * 60_000, source: 'app' },
  ]);

  assert.match(csv, new RegExp(`${new Date(start + 95 * 60_000).toISOString()},95,,app`));
  assert.match(csv, new RegExp(`${new Date(start + 2 * 60 * 60_000).toISOString()},,,,app`));
});

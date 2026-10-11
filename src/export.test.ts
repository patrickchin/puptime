import assert from 'node:assert/strict';
import test from 'node:test';

import { type PuppyEvent } from './domain.ts';
import { CsvImportError, csvToEvents, eventsToCsv } from './export.ts';

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

test('round-trips stable IDs, notes, sources, custom labels and estimate provenance', () => {
  const at = Date.UTC(2026, 9, 11, 4, 5, 6, 789);
  const events: PuppyEvent[] = [
    {
      id: 'evt_a1b2', type: 'custom', customLabel: '训练, "sit"', at,
      note: 'First line, "hello"\r\n第二行\nThird line', source: 'widget', estimated: true,
    },
    { id: 'evt_c3d4', type: 'pee', at: at + 1, source: 'app' },
    { id: 'evt_e5f6', type: 'custom', at: at + 2, source: 'app' },
    { id: 'evt_g7h8', type: 'custom', customLabel: 'Other', at: at + 3, source: 'app' },
  ];

  assert.deepEqual(csvToEvents(eventsToCsv(events)), events);
  assert.match(eventsToCsv(events), /evt_a1b2,,true,/);
  assert.match(eventsToCsv(events), /evt_c3d4,,false,/);
});

test('round-trips distinct open, completed and point nap states', () => {
  const at = Date.UTC(2026, 9, 11, 8, 0);
  const events: PuppyEvent[] = [
    { id: 'nap_point', type: 'nap', at, source: 'app' },
    { id: 'nap_complete', type: 'nap', at: at + 1, endedAt: at + 95 * 60_000, source: 'widget', estimated: true },
    { id: 'nap_open', type: 'nap', at: at + 96 * 60_000, endedAt: null, source: 'app' },
  ];

  assert.deepEqual(csvToEvents(eventsToCsv(events)), events);
});

test('accepts header-only CSV, no BOM and LF row endings', () => {
  assert.deepEqual(csvToEvents(eventsToCsv([])), []);
  const events: PuppyEvent[] = [{ id: '1', type: 'meal', at: Date.UTC(2026, 9, 11), source: 'app' }];
  const csv = eventsToCsv(events).slice(1).replaceAll('\r\n', '\n').trimEnd();
  assert.deepEqual(csvToEvents(csv), events);
});

test('rejects missing or incompatible headers and malformed quoted fields', () => {
  const event: PuppyEvent = { id: '1', type: 'pee', at: Date.UTC(2026, 9, 11), note: 'A, B', source: 'app' };
  const csv = eventsToCsv([event]);
  for (const invalid of [
    '',
    'Date,Time,Activity\n2026-10-11,08:00,Pee',
    csv.replace('Started At (ISO)', 'Started At'),
    csv.replace('"A, B"', '"A, B'),
    csv.replace('"A, B"', '"A, B"extra'),
    csv.replace('"A, B"', 'A"B'),
    csv.replace('"A, B"', 'A,B'),
    `${csv}\r\n`,
  ]) {
    assert.throws(() => csvToEvents(invalid), CsvImportError);
  }
});

test('rejects bad record fields and duplicate IDs before returning any data', () => {
  const at = Date.UTC(2026, 9, 11);
  const csv = eventsToCsv([
    { id: '1', type: 'pee', at, source: 'app' },
    { id: '2', type: 'poop', at: at + 1, source: 'widget' },
  ]);
  for (const invalid of [
    csv.replace(',poop,', ',unknown,'),
    csv.replace(',widget,2,', ',web,2,'),
    csv.replace(',widget,2,', ',widget,,'),
    csv.replace(',widget,2,', ',widget,1,'),
    csv.replace(',widget,2,,false,', ',widget,2,,maybe,'),
    csv.replace(new Date(at + 1).toISOString(), '2026-02-30T00:00:00.001Z'),
    csv.replace(new Date(at + 1).toISOString(), 'not-a-date'),
    eventsToCsv([{ id: '1', type: 'pee', at, source: 'app', note: 'n'.repeat(301) }]),
    eventsToCsv([{ id: '1', type: 'custom', at, source: 'app', customLabel: 'n'.repeat(41) }]),
  ]) {
    assert.throws(() => csvToEvents(invalid), CsvImportError);
  }
});

test('rejects inconsistent nap states and nap end times before the start', () => {
  const at = Date.UTC(2026, 9, 11);
  const open = eventsToCsv([{ id: 'nap', type: 'nap', at, endedAt: null, source: 'app' }]);
  const completed = eventsToCsv([{ id: 'nap', type: 'nap', at, endedAt: at + 60_000, source: 'app' }]);
  const pee = eventsToCsv([{ id: 'pee', type: 'pee', at, source: 'app' }]);
  for (const invalid of [
    open.replace(',open,false,', ',completed,false,'),
    open.replace(',open,false,', ',unknown,false,'),
    completed.replace(',completed,false,', ',point,false,'),
    completed.replace(',completed,false,', ',open,false,'),
    completed.replace(new Date(at + 60_000).toISOString(), new Date(at - 60_000).toISOString()),
    pee.replace(',pee,,false,', ',pee,open,false,'),
  ]) {
    assert.throws(() => csvToEvents(invalid), CsvImportError);
  }
});

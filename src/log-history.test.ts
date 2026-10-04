import assert from 'node:assert/strict';
import test from 'node:test';

import { createEvent, dateKey } from './domain.ts';
import { groupLogHistory } from './log-history.ts';

test('keeps today and yesterday visible after midnight and loads older dates by page', () => {
  const now = new Date(2026, 9, 5, 1).getTime();
  const yesterday = new Date(2026, 9, 4, 23, 50).getTime();
  const older = [3, 2, 1].map((day) => new Date(2026, 9, day, 12).getTime());
  const events = [createEvent('pee', 'app', yesterday), ...older.map((at) => createEvent('meal', 'app', at))];

  const first = groupLogHistory(events, now, 2);
  assert.deepEqual(first.days.map((day) => day.key), [dateKey(now), dateKey(yesterday), dateKey(older[0]), dateKey(older[1])]);
  assert.equal(first.days[0].data.length, 0);
  assert.equal(first.days[1].data[0].type, 'pee');
  assert.equal(first.hasMoreDays, true);

  const more = groupLogHistory(events, now, 3);
  assert.equal(more.days.length, 5);
  assert.equal(more.hasMoreDays, false);
});

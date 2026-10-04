import assert from 'node:assert/strict';
import test from 'node:test';

import { nextVisibleAgoChange, nextWidgetAgoChange, widgetAgo } from './widgets/ago.ts';

const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;

test('widget ago labels change at the matching 5-minute, hour, and day boundaries', () => {
  const at = 1_000_000;
  for (const [age, label, next] of [
    [0, 'Just now', 2.5 * minute],
    [7.5 * minute, '10m ago', 12.5 * minute],
    [57.5 * minute, '1h ago', 1.5 * hour],
    [2 * hour + 5 * minute, '2h ago', 2.5 * hour],
    [23.5 * hour, '1d ago', 1.5 * day],
  ] as const) {
    assert.equal(widgetAgo(at, at + age), label);
    assert.equal(nextWidgetAgoChange(at, at + age), at + next);
    assert.notEqual(widgetAgo(at, at + next - 1), widgetAgo(at, at + next));
  }
  assert.equal(nextVisibleAgoChange({ pee: at, meal: at + minute }, ['pee', 'meal'], at), at + 2.5 * minute);
  assert.equal(nextVisibleAgoChange({ pee: at }, ['meal'], at), undefined);
});

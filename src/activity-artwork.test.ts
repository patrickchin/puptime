/// <reference types="node" />

import assert from 'node:assert/strict';
import test from 'node:test';

import { activityCombinationIndex } from './activity-artwork.ts';

test('combination artwork selects every pair and triple regardless of order or repeated logs', () => {
  assert.equal(activityCombinationIndex(['pee', 'poop']), 0);
  assert.equal(activityCombinationIndex(['meal', 'pee', 'pee']), 1);
  assert.equal(activityCombinationIndex(['poop', 'meal']), 2);
  assert.equal(activityCombinationIndex(['meal', 'pee', 'poop', 'meal']), 3);
  assert.equal(activityCombinationIndex(['pee', 'pee']), undefined);
  assert.equal(activityCombinationIndex([]), undefined);
  assert.equal(activityCombinationIndex(['pee', 'nap']), undefined);
});

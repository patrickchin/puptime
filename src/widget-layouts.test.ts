import assert from 'node:assert/strict';
import test from 'node:test';
import { layoutActions, widgetLayout } from './widgets/widget-layouts.ts';

test('widget variants keep their action positions stable while a nap starts and ends', () => {
  const selected = ['pee', 'poop', 'meal'] as const;
  assert.deepEqual(layoutActions('row', selected, false, []), selected);
  assert.deepEqual(layoutActions('grid', selected, false, []), ['pee', 'poop', 'meal', 'pottyTrip', 'walk', 'nap']);
  assert.deepEqual(layoutActions('single', selected, false, []), ['pee']);
  assert.deepEqual(layoutActions('pair', selected, true, []), ['pee', 'poop']);
  assert.deepEqual(layoutActions('grid', selected, true, []), layoutActions('grid', selected, false, []));
  assert.deepEqual(layoutActions('overview', selected, true, []), selected);
  assert.deepEqual(layoutActions('pair', ['nap', 'pee'], true, []), ['nap', 'pee']);
  assert.deepEqual(layoutActions('grid', ['pee', 'poop', 'custom:training', 'custom:water'], true, ['Training', 'Water']), ['pee', 'poop', 'custom:training', 'custom:water', 'meal', 'nap']);
  assert.equal(widgetLayout('PuptimeOverview'), 'overview');
  assert.equal(widgetLayout('PuptimeActions'), 'grid');
  assert.equal(widgetLayout('unknown'), 'row');
});

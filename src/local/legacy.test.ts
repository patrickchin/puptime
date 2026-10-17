import assert from 'node:assert/strict';
import test from 'node:test';
import { legacyKeys, parseLegacySnapshot } from './legacy.ts';

const event = { id: '历史 / event', type: 'custom', at: 100, source: 'widget', customLabel: '训练', note: 'Line one\n"two"', estimated: true };
const routine = { id: 'routine-1', type: 'meal', minutes: 600, reminder: true, toleranceMinutes: 15 };
const populated: Record<string, string> = {
  'puptime.events.v1': JSON.stringify([event, { id: 'nap', type: 'nap', at: 200, endedAt: null, source: 'app' }]),
  'puptime.schedule.v1': JSON.stringify([routine]),
  'puptime.customActivities.v1': '["训练","Medicine"]',
  'puptime.deletedCustomActivities.v1': '["custom:medicine"]',
  'puptime.activityCustomizations.v1': '{"meal":{"emoji":"🍎","color":2,"name":"Breakfast"}}',
  'puptime.notificationPreferences.v1': '{"reminderLeadMinutes":5,"pottyAfterMeal":{"enabled":false,"delayMinutes":30}}',
  'puptime.widgetActions.v1': '["meal","custom:训练"]',
  'puptime.theme.v1': 'puppy-journal', 'puptime.language.v1': 'zh-Hans', 'puptime.onboarding.v1': 'done',
};
const entries = (values: Record<string, string> = {}) => legacyKeys.map((key) => [key, values[key] ?? null] as const);

test('legacy snapshot preserves exact populated values and historical records without mutating the source', () => {
  const input = entries(populated), before = JSON.stringify(input);
  const result = parseLegacySnapshot(input);
  assert.deepEqual(result.events[0], event);
  assert.deepEqual(result.schedule, [routine]);
  assert.equal(result.events[1].endedAt, null);
  assert.deepEqual(result.raw, Object.fromEntries(input));
  assert.equal(result.showOnboarding, false);
  assert.equal(JSON.stringify(input), before);
});

test('new install and explicitly empty history/settings remain distinguishable', () => {
  const fresh = parseLegacySnapshot(entries());
  assert.deepEqual(fresh.events, []); assert.equal(fresh.schedule, null); assert.equal(fresh.showOnboarding, true);
  const empty = parseLegacySnapshot(entries({ 'puptime.events.v1': '[]', 'puptime.schedule.v1': '[]' }));
  assert.deepEqual(empty.schedule, []); assert.equal(empty.showOnboarding, false);
});

test('invalid legacy records or settings abort migration without substituting empty collections', () => {
  for (const [key, values] of Object.entries({
    'puptime.events.v1': ['{broken', '', '{}', 'null', JSON.stringify([event, event]), JSON.stringify([{ ...event, at: 1.5 }])],
    'puptime.schedule.v1': ['{broken', 'null', '{}', JSON.stringify([routine, routine]), JSON.stringify([{ ...routine, minutes: 1440 }]), JSON.stringify([{ ...routine, reminder: 'yes' }])],
    'puptime.customActivities.v1': ['{}', '[12]'],
    'puptime.activityCustomizations.v1': ['[]', '{broken'],
    'puptime.notificationPreferences.v1': ['null', '{broken'],
  })) {
    for (const value of values) assert.throws(() => parseLegacySnapshot(entries({ ...populated, [key]: value })), /legacy|activity|routine/i);
  }
});

test('snapshot reader refuses an incomplete or duplicated key inventory', () => {
  assert.throws(() => parseLegacySnapshot(entries().slice(1)), /snapshot/i);
  assert.throws(() => parseLegacySnapshot([...entries(), entries()[0]]), /snapshot/i);
});

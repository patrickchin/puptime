import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createEvent,
  createNapEvent,
  activityKey,
  normalizeCustomActivities,
  eventPastLabel,
  formatDuration,
  isOpenNap,
  latestQuickEventTimes,
  normalizeCustomLabel,
  normalizeEventTypeChange,
  normalizeNote,
  normalizeWidgetActions,
  replaceCalendarDate,
  replaceClockTime,
  widgetActionsForState,
} from './domain.ts';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  normalizeNotificationPreferences,
  reminderTriggerMinutes,
} from './notification-config.ts';
import {
  pottyReminderCopy,
  pottyReminderIdentifier,
  pottyReminderPlans,
  reminderCopy,
  reminderIdentifier,
  reminderTrigger,
} from './reminder-config.ts';

test('creates a widget event at the supplied time', () => {
  const event = createEvent('pee', 'widget', 123_456);

  assert.equal(event.at, 123_456);
  assert.equal(event.source, 'widget');
});

test('normalizes widget actions to a useful two-to-four action set', () => {
  assert.deepEqual(normalizeWidgetActions(['walk', 'walk', 'nap', 'meal', 'poop']), ['walk', 'nap', 'meal', 'poop']);
  assert.deepEqual(normalizeWidgetActions(['pee']), ['pee', 'poop', 'meal']);
  assert.deepEqual(normalizeWidgetActions(['not-an-action']), ['pee', 'poop', 'meal']);
  assert.deepEqual(normalizeWidgetActions(['pee', 'custom:training'], ['Training']), ['pee', 'custom:training']);
  assert.deepEqual(normalizeWidgetActions(['pee', 'custom:training'], []), ['pee', 'poop', 'meal']);
});

test('keeps named activities distinct while ignoring case differences', () => {
  assert.deepEqual(normalizeCustomActivities([' Training ', 'training', 'Grooming', '']), ['Training', 'Grooming']);
  assert.equal(activityKey(createEvent('custom', 'app', 100, 'TRAINING')), 'custom:training');
  assert.equal(activityKey(createEvent('custom', 'app', 100, 'Grooming')), 'custom:grooming');
});

test('keeps an active nap reachable without overflowing the widget', () => {
  assert.deepEqual(widgetActionsForState(['pee', 'poop', 'meal'], true), ['pee', 'poop', 'meal', 'nap']);
  assert.deepEqual(widgetActionsForState(['pee', 'poop', 'meal', 'walk'], true), ['pee', 'poop', 'meal', 'nap']);
  assert.deepEqual(widgetActionsForState(['pee', 'nap'], true), ['pee', 'nap']);
});

test('finds the latest time for each widget action', () => {
  const completedNap = { ...createNapEvent('app', 200), endedAt: 500 };

  assert.deepEqual(latestQuickEventTimes([
    createEvent('pee', 'app', 100),
    createEvent('pee', 'widget', 300),
    completedNap,
    createEvent('custom', 'app', 900, 'Training'),
  ]), { pee: 300, nap: 500, 'custom:training': 900 });
});

test('normalizes optional log notes', () => {
  assert.equal(normalizeNote('  Just after play  '), 'Just after play');
  assert.equal(normalizeNote('   '), undefined);
  assert.equal(normalizeNote('x'.repeat(301))?.length, 300);
});

test('normalizes custom activity names at their storage boundary', () => {
  assert.equal(normalizeCustomLabel('  Training  '), 'Training');
  assert.equal(normalizeCustomLabel('   '), undefined);
  assert.equal(normalizeCustomLabel('x'.repeat(41))?.length, 40);
  assert.equal(createEvent('custom', 'app', 123, '  Grooming  ').customLabel, 'Grooming');
  assert.equal(createEvent('pee', 'app', 123, 'Not applicable').customLabel, undefined);
});

test('changes point activities without converting to or from a timed nap', () => {
  const pee = createEvent('pee', 'app', 100);
  const nap = createNapEvent('app', 100);

  assert.equal(normalizeEventTypeChange(pee, 'poop'), 'poop');
  assert.equal(normalizeEventTypeChange(pee, 'nap'), 'pee');
  assert.equal(normalizeEventTypeChange(nap, 'walk'), 'nap');
});

test('changes an event clock time without allowing a future log', () => {
  const original = new Date(2026, 0, 2, 8, 30).getTime();
  const now = new Date(2026, 0, 2, 12, 0).getTime();
  const changed = new Date(replaceClockTime(original, 9, 45, now));

  assert.equal(changed.getHours(), 9);
  assert.equal(changed.getMinutes(), 45);
  assert.equal(replaceClockTime(original, 13, 0, now), now);
});

test('changes an event date while preserving its time and preventing future logs', () => {
  const original = new Date(2026, 8, 10, 8, 30).getTime();
  const now = new Date(2026, 8, 12, 12, 0).getTime();
  const changed = new Date(replaceCalendarDate(original, new Date(2026, 8, 9), now));

  assert.equal(changed.getFullYear(), 2026);
  assert.equal(changed.getMonth(), 8);
  assert.equal(changed.getDate(), 9);
  assert.equal(changed.getHours(), 8);
  assert.equal(changed.getMinutes(), 30);
  assert.equal(replaceCalendarDate(original, new Date(2026, 8, 13), now), now);
});

test('only new timed naps count as running', () => {
  const running = createNapEvent('app', 100);
  const oldPointLog = createEvent('nap', 'app', 50);

  assert.equal(isOpenNap(running), true);
  assert.equal(isOpenNap(oldPointLog), false);
  assert.equal(eventPastLabel(running), 'Nap in progress');
});

test('formats a duration for compact log and chart labels', () => {
  assert.equal(formatDuration(42 * 60_000), '42m');
  assert.equal(formatDuration(90 * 60_000), '1h 30m');
});

test('creates stable daily reminder content for a schedule entry', () => {
  const entry = { id: 'morning-pee', type: 'pee' as const, minutes: 7 * 60 + 5, reminder: true };

  assert.equal(reminderIdentifier(entry), 'puptime-routine-morning-pee');
  assert.match(reminderCopy(entry).title, /Time for Pee/);
  assert.match(reminderCopy(entry).body, /7:05/);
  assert.match(reminderCopy(entry, 'en', 10).title, /Pee in 10 min/);
  assert.deepEqual(reminderTrigger(entry, 10), { hour: 6, minute: 55 });
  assert.equal(reminderTriggerMinutes(5, 10), 23 * 60 + 55);
});

test('normalizes notification preferences without enabling confirmations by accident', () => {
  assert.deepEqual(normalizeNotificationPreferences(null), DEFAULT_NOTIFICATION_PREFERENCES);
  assert.deepEqual(normalizeNotificationPreferences({ reminderLeadMinutes: 15, widgetConfirmations: true }), {
    reminderLeadMinutes: 15,
    widgetConfirmations: true,
    pottyAfterPee: { enabled: true, delayMinutes: 120 },
    pottyAfterMeal: { enabled: true, delayMinutes: 30 },
  });
  assert.deepEqual(normalizeNotificationPreferences({
    reminderLeadMinutes: 99,
    widgetConfirmations: 'yes',
    pottyAfterPee: { enabled: false, delayMinutes: 60 },
    pottyAfterMeal: { enabled: 'yes', delayMinutes: 31 },
  }), {
    reminderLeadMinutes: 10,
    widgetConfirmations: false,
    pottyAfterPee: { enabled: false, delayMinutes: 60 },
    pottyAfterMeal: { enabled: true, delayMinutes: 30 },
  });
});

test('plans potty reminders from the latest relevant logs', () => {
  const now = 10_000_000;
  const pee = createEvent('pee', 'app', now - 30 * 60_000);
  const meal = createEvent('meal', 'app', now - 10 * 60_000);

  assert.deepEqual(pottyReminderPlans([pee, meal], DEFAULT_NOTIFICATION_PREFERENCES, now), [
    {
      kind: 'afterPee',
      sourceEventId: pee.id,
      sourceType: 'pee',
      delayMinutes: 120,
      at: now + 90 * 60_000,
    },
    {
      kind: 'afterMeal',
      sourceEventId: meal.id,
      sourceType: 'meal',
      delayMinutes: 30,
      at: now + 20 * 60_000,
    },
  ]);

  const newerPee = createEvent('pee', 'app', now - 5 * 60_000);
  assert.deepEqual(
    pottyReminderPlans([meal, newerPee], DEFAULT_NOTIFICATION_PREFERENCES, now).map((plan) => plan.kind),
    ['afterPee'],
  );
});

test('creates stable localized potty reminder content', () => {
  assert.equal(pottyReminderIdentifier('afterPee'), 'puptime-activity-afterPee');
  assert.match(pottyReminderCopy('afterPee', 120).body, /2 hours since the last pee/);
  assert.match(pottyReminderCopy('afterMeal', 30, 'es').body, /30 minutos/);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { DEFAULT_NOTIFICATION_PREFERENCES } from './notification-config.ts';
import { quietStatusCopy, quietStatusSnapshot } from './quiet-status-config.ts';
import type { PuppyEvent } from './domain.ts';

const now = new Date(2026, 9, 29, 12, 0).getTime();
const preferences = { ...DEFAULT_NOTIFICATION_PREFERENCES, pottyAfterPee: { enabled: false, delayMinutes: 120 as const }, pottyAfterMeal: { enabled: false, delayMinutes: 30 as const } };
const events: PuppyEvent[] = [
  { id: 'evt_real', type: 'pee', at: now - 60_000, source: 'app' },
  { id: 'evt_estimate', type: 'pee', at: now, source: 'app', estimated: true },
  { id: 'evt_future', type: 'poop', at: now + 60_000, source: 'app' },
];
test('quiet status uses real past logs, signed reminder offsets and the earliest future one-off', () => {
  const schedule = [{ id: 'rtn_meal', type: 'meal' as const, minutes: 5, reminder: true }];
  const snapshot = quietStatusSnapshot(events, schedule, { ...preferences, mealReminderOffsetMinutes: -15 }, [
    { label: 'Expired medicine', at: now - 1 }, { label: 'Medicine', at: now + 3600_000 },
  ], 'Biscuit', 'en', now);
  assert.deepEqual(snapshot.times, { pee: now - 60_000, poop: undefined, meal: undefined });
  assert.deepEqual(snapshot.reminder, { label: 'Medicine', at: now + 3600_000 });
  const copy = quietStatusCopy(snapshot);
  assert.match(copy.title, /Biscuit/); assert.match(copy.body, /Pee/); assert.match(copy.body, /Medicine/);
  assert.doesNotMatch(copy.body, /Poop|Expired/);
  const daily = quietStatusSnapshot([], schedule, { ...preferences, mealReminderOffsetMinutes: -15 }, [], 'Biscuit', 'en', now).reminder!;
  assert.equal(daily.at, new Date(2026, 9, 29, 23, 50).getTime());
  for (const language of ['en', 'es', 'zh-Hans'] as const) {
    assert.ok(quietStatusCopy(quietStatusSnapshot([], [], preferences, [], 'Biscuit', language, now)).body.length > 0);
  }
});

const state = { enabled: false, delivery: true, permission: 'granted', os: 'ios', events,
  delivered: [] as { request: { identifier: string; content: Record<string, unknown> } }[],
  posted: [] as any[], dismissed: [] as string[], channels: [] as any[], hold: null as null | (() => Promise<void>) };
(globalThis as any).__quietStatusTest = state;
const target = new URL('./quiet-status.native.ts', import.meta.url).href;
registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL === target) {
      if (['expo-notifications', 'react-native', './local/runtime.native', './reminders'].includes(specifier)) return { url: 'status-test:' + specifier, shortCircuit: true };
      if (specifier.startsWith('.')) return next(new URL(specifier + '.ts', context.parentURL).href, context);
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    const mocks: Record<string, string> = {
      'status-test:react-native': `export const Platform={get OS(){return s.os;}};`,
      'status-test:./local/runtime.native': `export async function getLocalRuntime(){return {petId:'pet_test',activity:{async latestEvents(){return s.events;}},storage:{
        async loadQuietStatusEnabled(){return s.enabled;},async saveQuietStatusEnabled(value){s.enabled=value;},
        async loadNotificationDelivery(){return s.delivery;},async loadSchedule(){return [];},async loadNotificationPreferences(){return ${JSON.stringify(preferences)};},
        async loadLanguagePreference(){return 'en';},async loadPuppyName(){return 'Biscuit';}
      }}};`,
      'status-test:./reminders': `export async function getNotificationPermissionState(){return s.permission;} export async function listCustomTimedReminders(){return [];}`,
      'status-test:expo-notifications': `
        export const AndroidImportance={LOW:2};
        export async function getPresentedNotificationsAsync(){return s.delivered;}
        export async function cancelScheduledNotificationAsync(){}
        export async function dismissNotificationAsync(id){s.dismissed.push(id);s.delivered=s.delivered.filter(n=>n.request.identifier!==id);}
        export async function setNotificationChannelAsync(id,options){s.channels.push({id,...options});}
        export async function scheduleNotificationAsync(value){if(s.hold)await s.hold();s.posted.push(value);s.delivered=s.delivered.filter(n=>n.request.identifier!==value.identifier);s.delivered.push({request:value});}
      `,
    };
    if (mocks[url]) return { format: 'module', source: 'const s=globalThis.__quietStatusTest;' + mocks[url], shortCircuit: true };
    return next(url, context);
  },
});
const status = await import('./quiet-status.native.ts');

test('native status is opt-in, silent, replaces a single card, skips unchanged updates and removes on opt-out or denied access', async () => {
  await status.syncQuietStatus(); assert.equal(state.posted.length, 0);
  await status.setQuietStatusEnabled(true);
  assert.equal(state.posted.length, 1);
  assert.equal(state.posted[0].content.sound, false); assert.equal(state.posted[0].content.interruptionLevel, 'passive');
  assert.equal(state.posted[0].content.sticky, true); assert.equal(state.posted[0].content.autoDismiss, false);
  assert.equal(state.posted[0].trigger, null);
  await status.syncQuietStatus(); assert.equal(state.posted.length, 1);
  state.events = [...events, { id: 'evt_meal', type: 'meal', at: Date.now(), source: 'app' }];
  await status.syncQuietStatus(); assert.equal(state.delivered.length, 1); assert.equal(state.posted.length, 2);
  state.os = 'android'; state.delivered = [];
  await status.syncQuietStatus(); assert.deepEqual(state.posted.at(-1).trigger, { channelId: 'puptime-status' });
  assert.deepEqual(state.channels[0], { id: 'puptime-status', name: 'Quiet puppy status', importance: 2, sound: null, enableVibrate: false, showBadge: false });
  state.permission = 'blocked'; await status.syncQuietStatus(); assert.equal(state.delivered.length, 0);
  state.permission = 'granted'; state.delivery = false; await status.syncQuietStatus(); assert.equal(state.delivered.length, 0);
  state.delivery = true; await status.setQuietStatusEnabled(false); assert.equal(state.delivered.length, 0);
});

test('a device disable queued behind a native delivery in flight removes that card', async () => {
  let release!: () => void, entered!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  state.hold = () => { entered(); return gate; };
  const enabling = status.setQuietStatusEnabled(true); await ready;
  state.delivery = false;
  const disabling = status.syncQuietStatus();
  release(); await Promise.all([enabling, disabling]); state.hold = null;
  assert.equal(state.delivered.length, 0);
});

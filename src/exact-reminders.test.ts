import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';

const state = { allowed: false, restores: 0, opens: 0, fail: false, openFail: false, listeners: new Set<(state: string) => void>() };
(globalThis as typeof globalThis & { __exactReminderTest: typeof state }).__exactReminderTest = state;
const target = new URL('./exact-reminders.android.ts', import.meta.url).href;
registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL === target && specifier === 'expo-modules-core') return { url: 'exact-reminders:native', shortCircuit: true };
    if (context.parentURL === target && specifier === 'react-native') return { url: 'exact-reminders:app-state', shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === 'exact-reminders:native') return { format: 'module', shortCircuit: true, source: `
      const s=globalThis.__exactReminderTest;
      export function requireNativeModule(name){
        if(name!=='ExpoNotificationScheduler')throw Error('Wrong native scheduler');
        return {
          async canScheduleExactRemindersAsync(){return s.allowed;},
          async restoreScheduledRemindersAsync(){s.restores++;if(s.fail)throw Error('restore failed');},
          async openExactReminderSettingsAsync(){s.opens++;if(s.openFail)throw Error('settings unavailable');},
        };
      }` };
    if (url === 'exact-reminders:app-state') return { format: 'module', shortCircuit: true, source: `
      const s=globalThis.__exactReminderTest;
      export const AppState={addEventListener(event,listener){s.listeners.add(listener);return {remove(){s.listeners.delete(listener);}};}};
    ` };
    return next(url, context);
  },
});
const timing = await import('./exact-reminders.android.ts');

test('exact access restoration coalesces foreground checks, handles grant/revoke, and retries failed restoration', async () => {
  assert.deepEqual(await Promise.all([timing.refreshExactReminderScheduling(), timing.refreshExactReminderScheduling()]), [false, false]);
  assert.equal(state.restores, 1);
  assert.equal(await timing.refreshExactReminderScheduling(), false);
  assert.equal(state.restores, 1);
  state.allowed = true;
  assert.equal(await timing.refreshExactReminderScheduling(), true);
  assert.equal(state.restores, 2);
  state.allowed = false; state.fail = true;
  await assert.rejects(timing.refreshExactReminderScheduling(), /restore failed/);
  assert.equal(state.restores, 3);
  state.fail = false;
  assert.equal(await timing.refreshExactReminderScheduling(), false);
  assert.equal(state.restores, 4);
  await timing.openExactReminderSettings();
  assert.equal(state.opens, 1);
});

test('reminder setup waits for the settings roundtrip and checks approval rather than assuming it', async () => {
  for (const allowed of [false, true]) {
    state.allowed = false;
    let completed = false;
    const request = timing.requestExactReminderAccess().then(value => { completed = true; return value; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(state.listeners.size, 1);
    for (const listener of state.listeners) listener('active');
    await Promise.resolve();
    assert.equal(completed, false, 'opening settings does not mean permission was granted');
    for (const listener of state.listeners) listener('background');
    state.allowed = allowed;
    for (const listener of state.listeners) listener('active');
    assert.equal(await request, allowed);
    assert.equal(state.listeners.size, 0);
  }
  const opens = state.opens;
  assert.equal(await timing.requestExactReminderAccess(), true);
  assert.equal(state.opens, opens, 'already granted access needs no settings trip');
  state.allowed = false; state.openFail = true;
  await assert.rejects(timing.requestExactReminderAccess(), /settings unavailable/);
  assert.equal(state.listeners.size, 0);
});

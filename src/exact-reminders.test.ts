import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';

const state = { allowed: false, restores: 0, opens: 0, fail: false };
(globalThis as typeof globalThis & { __exactReminderTest: typeof state }).__exactReminderTest = state;
const target = new URL('./exact-reminders.android.ts', import.meta.url).href;
registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL === target && specifier === 'expo-modules-core') return { url: 'exact-reminders:native', shortCircuit: true };
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
          async openExactReminderSettingsAsync(){s.opens++;},
        };
      }` };
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

import { requireNativeModule } from 'expo-modules-core';
import { AppState } from 'react-native';

type ExactReminderScheduler = {
  canScheduleExactRemindersAsync(): Promise<boolean>;
  openExactReminderSettingsAsync(): Promise<void>;
  restoreScheduledRemindersAsync(): Promise<void>;
};
const scheduler = () => requireNativeModule<ExactReminderScheduler>('ExpoNotificationScheduler');
let restoredAccess: boolean | undefined;
let checking: Promise<boolean> | undefined;

export function refreshExactReminderScheduling(): Promise<boolean> {
  // The app and Notifications screen can resume together. Restore persisted
  // one-off requests as well as routines, once per permission change/process.
  checking ??= (async () => {
    const native = scheduler();
    const allowed = await native.canScheduleExactRemindersAsync();
    if (allowed !== restoredAccess) {
      await native.restoreScheduledRemindersAsync();
      restoredAccess = allowed;
    }
    return allowed;
  })().finally(() => { checking = undefined; });
  return checking;
}

export async function openExactReminderSettings(): Promise<void> {
  await scheduler().openExactReminderSettingsAsync();
}

export async function requestExactReminderAccess(): Promise<boolean> {
  if (await refreshExactReminderScheduling()) return true;
  // Opening settings is not permission approval. Keep setup pending until the
  // user returns, then ask Android for the actual result.
  return new Promise((resolve, reject) => {
    let leftApp = false;
    const subscription = AppState.addEventListener('change', state => {
      if (state !== 'active') { leftApp = true; return; }
      if (!leftApp) return;
      subscription.remove();
      void refreshExactReminderScheduling().then(resolve, reject);
    });
    void openExactReminderSettings().catch(error => { subscription.remove(); reject(error); });
  });
}

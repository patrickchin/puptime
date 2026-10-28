import { requireNativeModule } from 'expo-modules-core';

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

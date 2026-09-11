import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import type { ScheduleEntry } from './domain';
import { REMINDER_IDENTIFIER_PREFIX, reminderCopy, reminderIdentifier } from './reminder-config';

const CHANNEL_ID = 'puptime-routine';

async function ensureReminderChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: 'Routine reminders',
    description: 'Daily reminders for your puppy’s planned activities.',
    importance: Notifications.AndroidImportance.DEFAULT,
    sound: 'default',
    vibrationPattern: [0, 250],
  });
}

export function configureReminderHandling(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

function permissionAllowsReminders(settings: Notifications.NotificationPermissionsStatus): boolean {
  return Boolean(
    settings.granted
      || settings.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL
      || settings.ios?.status === Notifications.IosAuthorizationStatus.EPHEMERAL,
  );
}

export async function requestReminderPermission(): Promise<boolean> {
  await ensureReminderChannel();
  let settings = await Notifications.getPermissionsAsync();
  if (permissionAllowsReminders(settings)) return true;
  if (!settings.canAskAgain) return false;
  settings = await Notifications.requestPermissionsAsync({
    android: {},
    ios: { allowAlert: true, allowSound: true },
  });
  return permissionAllowsReminders(settings);
}

export async function syncScheduleReminders(schedule: ScheduleEntry[]): Promise<boolean> {
  await ensureReminderChannel();

  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled
      .filter((notification) => notification.identifier.startsWith(REMINDER_IDENTIFIER_PREFIX))
      .map((notification) => Notifications.cancelScheduledNotificationAsync(notification.identifier)),
  );

  const reminders = schedule.filter((entry) => entry.reminder);
  if (reminders.length === 0) return true;
  const settings = await Notifications.getPermissionsAsync();
  if (!permissionAllowsReminders(settings)) return false;

  await Promise.all(reminders.map(async (entry) => {
    const content = reminderCopy(entry);
    await Notifications.scheduleNotificationAsync({
      identifier: reminderIdentifier(entry),
      content: {
        ...content,
        sound: 'default',
        data: { scheduleEntryId: entry.id, type: entry.type },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour: Math.floor(entry.minutes / 60),
        minute: entry.minutes % 60,
        channelId: CHANNEL_ID,
      },
    });
  }));

  return true;
}

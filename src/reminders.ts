import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import type { QuickEventType, ScheduleEntry } from './domain';
import { translate, type AppLanguage } from './localization';
import type { ReminderLeadMinutes } from './notification-config';
import {
  REMINDER_IDENTIFIER_PREFIX,
  reminderCopy,
  reminderIdentifier,
  reminderTrigger,
  widgetConfirmationCopy,
} from './reminder-config';

const ROUTINE_CHANNEL_ID = 'puptime-routine';
const WIDGET_CHANNEL_ID = 'puptime-widget-log';

export const WIDGET_LOG_CATEGORY = 'puptimeWidgetLog';
export const ADD_NOTE_ACTION = 'puptimeAddNote';
export const EDIT_DETAILS_ACTION = 'puptimeEditDetails';
export const WIDGET_LOG_NOTIFICATION_KIND = 'widgetLog';

export type NotificationPermissionState = 'granted' | 'requestable' | 'blocked';

export type WidgetLogReference = {
  eventId?: string;
  type: QuickEventType;
  at: number;
};

async function ensureReminderChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(ROUTINE_CHANNEL_ID, {
    name: 'Routine reminders',
    description: 'Daily reminders for your puppy’s planned activities.',
    importance: Notifications.AndroidImportance.DEFAULT,
    sound: 'default',
    vibrationPattern: [0, 250],
  });
}

async function ensureWidgetChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(WIDGET_CHANNEL_ID, {
    name: 'Widget confirmations',
    description: 'Confirms activities logged from the Puptime home-screen widget.',
    importance: Notifications.AndroidImportance.DEFAULT,
    sound: 'default',
    vibrationPattern: [0, 180],
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

function permissionAllowsNotifications(settings: Notifications.NotificationPermissionsStatus): boolean {
  return Boolean(
    settings.granted
      || settings.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL
      || settings.ios?.status === Notifications.IosAuthorizationStatus.EPHEMERAL,
  );
}

export async function configureNotificationActions(language: AppLanguage): Promise<void> {
  await ensureWidgetChannel();
  await Notifications.setNotificationCategoryAsync(WIDGET_LOG_CATEGORY, [
    {
      identifier: ADD_NOTE_ACTION,
      buttonTitle: translate(language, 'notifications.addNote'),
      textInput: {
        submitButtonTitle: translate(language, 'notifications.saveNote'),
        placeholder: translate(language, 'notifications.notePlaceholder'),
      },
      options: { opensAppToForeground: true },
    },
    {
      identifier: EDIT_DETAILS_ACTION,
      buttonTitle: translate(language, 'notifications.editDetails'),
      options: { opensAppToForeground: true },
    },
  ]);
}

export async function getNotificationPermissionState(): Promise<NotificationPermissionState> {
  const settings = await Notifications.getPermissionsAsync();
  if (permissionAllowsNotifications(settings)) return 'granted';
  return settings.canAskAgain ? 'requestable' : 'blocked';
}

export async function requestReminderPermission(language: AppLanguage = 'en'): Promise<boolean> {
  await Promise.all([ensureReminderChannel(), configureNotificationActions(language)]);
  let settings = await Notifications.getPermissionsAsync();
  if (permissionAllowsNotifications(settings)) return true;
  if (!settings.canAskAgain) return false;
  settings = await Notifications.requestPermissionsAsync({
    android: {},
    ios: { allowAlert: true, allowSound: true },
  });
  return permissionAllowsNotifications(settings);
}

export async function syncScheduleReminders(
  schedule: ScheduleEntry[],
  leadMinutes: ReminderLeadMinutes = 0,
  language: AppLanguage = 'en',
): Promise<boolean> {
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
  if (!permissionAllowsNotifications(settings)) return false;

  await Promise.all(reminders.map(async (entry) => {
    const content = reminderCopy(entry, language, leadMinutes);
    const trigger = reminderTrigger(entry, leadMinutes);
    await Notifications.scheduleNotificationAsync({
      identifier: reminderIdentifier(entry),
      content: {
        ...content,
        sound: 'default',
        data: { scheduleEntryId: entry.id, type: entry.type },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        ...trigger,
        channelId: ROUTINE_CHANNEL_ID,
      },
    });
  }));

  return true;
}

export async function showWidgetLogConfirmation(
  reference: WidgetLogReference,
  language: AppLanguage = 'en',
): Promise<boolean> {
  await configureNotificationActions(language);
  const settings = await Notifications.getPermissionsAsync();
  if (!permissionAllowsNotifications(settings)) return false;
  const content = widgetConfirmationCopy(reference.type, language);
  await Notifications.scheduleNotificationAsync({
    identifier: `puptime-widget-${reference.eventId ?? `${reference.at}-${reference.type}`}`,
    content: {
      ...content,
      sound: 'default',
      categoryIdentifier: WIDGET_LOG_CATEGORY,
      data: {
        kind: WIDGET_LOG_NOTIFICATION_KIND,
        type: reference.type,
        at: reference.at,
        ...(reference.eventId ? { eventId: reference.eventId } : {}),
      },
    },
    trigger: Platform.OS === 'android'
      ? {
          type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
          seconds: 1,
          channelId: WIDGET_CHANNEL_ID,
        }
      : null,
  });
  return true;
}

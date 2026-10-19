import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { z } from 'zod';
import { localIdSchema } from './cloud/protocol';
import {getNotificationDelivery,setNotificationDelivery} from './cloud/notification-delivery';

import type { ActivityKey, PuppyEvent, ScheduleEntry } from './domain';
import { translate, type AppLanguage } from './localization';
import type { NotificationPreferences, ReminderLeadMinutes } from './notification-config';
import {
  POTTY_REMINDER_IDENTIFIER_PREFIX,
  REMINDER_IDENTIFIER_PREFIX,
  pottyReminderCopy,
  pottyReminderIdentifier,
  pottyReminderPlans,
  reminderCopy,
  reminderIdentifier,
  reminderTrigger,
  widgetConfirmationCopy,
} from './reminder-config';

const ROUTINE_CHANNEL_ID = 'puptime-routine';
const POTTY_CHANNEL_ID = 'puptime-potty';
const WIDGET_CHANNEL_ID = 'puptime-widget-log';

// Serialize replacement writes so disabling delivery also cancels requests
// whose native scheduling call was already in flight.
let reminderWrites:Promise<unknown>=Promise.resolve();
function updateReminders<T>(action:()=>Promise<T>):Promise<T> {
  const result=reminderWrites.then(action);reminderWrites=result.catch(()=>undefined);return result;
}

export const WIDGET_LOG_CATEGORY = 'puptimeWidgetLog';
export const ADD_NOTE_ACTION = 'puptimeAddNote';
export const EDIT_DETAILS_ACTION = 'puptimeEditDetails';
export const WIDGET_LOG_NOTIFICATION_KIND = 'widgetLog';
export const POTTY_REMINDER_NOTIFICATION_KIND = 'pottyReminder';
export const CUSTOM_TIMED_REMINDER_NOTIFICATION_KIND = 'customTimedReminder';

export type NotificationPermissionState = 'granted' | 'requestable' | 'blocked';

export type WidgetLogReference = {
  eventId?: string;
  type: ActivityKey;
  customLabel?: string;
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

async function ensurePottyChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(POTTY_CHANNEL_ID, {
    name: 'Potty nudges',
    description: 'Reminders based on your puppy’s recent pee and meal logs.',
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
  await setNotificationDelivery(true);
  await Promise.all([ensureReminderChannel(), ensurePottyChannel(), configureNotificationActions(language)]);
  let settings = await Notifications.getPermissionsAsync();
  if (permissionAllowsNotifications(settings)) return true;
  if (!settings.canAskAgain) return false;
  settings = await Notifications.requestPermissionsAsync({
    android: {},
    ios: { allowAlert: true, allowSound: true },
  });
  return permissionAllowsNotifications(settings);
}


const customTimedDataSchema = z.strictObject({
  app: z.literal('com.patrickchin.puptime'),
  version: z.literal(1),
  kind: z.literal(CUSTOM_TIMED_REMINDER_NOTIFICATION_KIND),
  petId: localIdSchema,
  label: z.string().trim().min(1).max(80).refine((value) => !/[\u0000-\u001f\u007f]/.test(value)),
  at: z.number().int().positive().max(8640000000000000),
});
export type CustomTimedReminder = { id: string; petId: string; label: string; at: number };
export class CustomTimedReminderLimitError extends Error {
  constructor() { super('Remove a pending reminder before adding another.'); this.name = 'CustomTimedReminderLimitError'; }
}

function customTimedReminder(request: Notifications.NotificationRequest): CustomTimedReminder | null {
  const trigger = request.trigger;
  if (!trigger || !('type' in trigger) || !['date', 'timeInterval', 'calendar'].includes(trigger.type) || ('repeats' in trigger && trigger.repeats === true)) return null;
  const parsed = customTimedDataSchema.safeParse(request.content?.data);
  if (!parsed.success || !localIdSchema.safeParse(request.identifier).success) return null;
  const { petId, label, at } = parsed.data;
  return { id: request.identifier, petId, label, at };
}

export async function listCustomTimedReminders(petId: string, now = Date.now()): Promise<CustomTimedReminder[]> {
  localIdSchema.parse(petId);
  return updateReminders(async () => (await Notifications.getAllScheduledNotificationsAsync())
    .map(customTimedReminder)
    .filter((item): item is CustomTimedReminder => !!item && item.petId === petId && item.at > now)
    .sort((left, right) => left.at - right.at || left.id.localeCompare(right.id)));
}

export async function createCustomTimedReminder(input: { petId: string; label: string; at: number }): Promise<CustomTimedReminder | null> {
  const data = customTimedDataSchema.parse({ ...input, app: 'com.patrickchin.puptime', version: 1, kind: CUSTOM_TIMED_REMINDER_NOTIFICATION_KIND });
  if (data.at <= Date.now()) throw new RangeError('Choose a future reminder time.');
  return updateReminders(async () => {
    if (!await getNotificationDelivery() || !permissionAllowsNotifications(await Notifications.getPermissionsAsync())) return null;
    // Keep headroom for potty reminders and routine replacement writes.
    if ((await Notifications.getAllScheduledNotificationsAsync()).length >= 60) throw new CustomTimedReminderLimitError();
    if (data.at <= Date.now()) throw new RangeError('Choose a future reminder time.');
    await ensureReminderChannel();
    const id = await Notifications.scheduleNotificationAsync({
      content: { title: data.label, sound: 'default', data },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: data.at, channelId: ROUTINE_CHANNEL_ID },
    });
    return { id, petId: data.petId, label: data.label, at: data.at };
  });
}

export async function cancelCustomTimedReminder(petId: string, id: string): Promise<boolean> {
  localIdSchema.parse(petId); localIdSchema.parse(id);
  return updateReminders(async () => {
    const request = (await Notifications.getAllScheduledNotificationsAsync()).find((item) => item.identifier === id);
    if (!request) return false;
    if (customTimedReminder(request)?.petId !== petId) throw new Error('This timed reminder is unavailable.');
    await Notifications.cancelScheduledNotificationAsync(id);
    return true;
  });
}

export async function countCustomTimedReminders(): Promise<number> {
  return updateReminders(async () => (await Notifications.getAllScheduledNotificationsAsync())
    .filter((request) => customTimedReminder(request) !== null).length);
}

export async function cancelCustomTimedRemindersIfDeliveryOff(): Promise<void> {
  return updateReminders(async () => {
    if (await getNotificationDelivery()) return;
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(scheduled.filter((request) => customTimedReminder(request) !== null)
      .map((request) => Notifications.cancelScheduledNotificationAsync(request.identifier)));
  });
}

export async function syncPottyReminders(
  events: readonly PuppyEvent[],
  preferences: NotificationPreferences,
  language: AppLanguage = 'en',
  now = Date.now(),
): Promise<boolean> {
  return updateReminders(async()=>{
  await ensurePottyChannel();

  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled
      .filter((notification) => notification.identifier.startsWith(POTTY_REMINDER_IDENTIFIER_PREFIX))
      .map((notification) => Notifications.cancelScheduledNotificationAsync(notification.identifier)),
  );

  const plans = pottyReminderPlans(events, preferences, now);
  if (plans.length === 0) return true;
  if(!await getNotificationDelivery())return false;
  const settings = await Notifications.getPermissionsAsync();
  if (!permissionAllowsNotifications(settings)) return false;

  await Promise.all(plans.map(async (plan) => {
    const content = pottyReminderCopy(plan.kind, plan.delayMinutes, language);
    await Notifications.scheduleNotificationAsync({
      identifier: pottyReminderIdentifier(plan.kind),
      content: {
        ...content,
        sound: 'default',
        data: {
          kind: POTTY_REMINDER_NOTIFICATION_KIND,
          sourceEventId: plan.sourceEventId,
          sourceType: plan.sourceType,
        },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: plan.at,
        channelId: POTTY_CHANNEL_ID,
      },
    });
  }));

  return true;
  });
}

export async function syncScheduleReminders(
  schedule: ScheduleEntry[],
  leadMinutes: ReminderLeadMinutes = 0,
  language: AppLanguage = 'en',
): Promise<boolean> {
  return updateReminders(async()=>{
  await ensureReminderChannel();

  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled
      .filter((notification) => notification.identifier.startsWith(REMINDER_IDENTIFIER_PREFIX))
      .map((notification) => Notifications.cancelScheduledNotificationAsync(notification.identifier)),
  );

  const reminders = schedule.filter((entry) => entry.reminder);
  if (reminders.length === 0) return true;
  if(!await getNotificationDelivery())return false;
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
  });
}

export async function showWidgetLogConfirmation(
  reference: WidgetLogReference,
  language: AppLanguage = 'en',
): Promise<boolean> {
  await configureNotificationActions(language);
  const settings = await Notifications.getPermissionsAsync();
  if (!permissionAllowsNotifications(settings)) return false;
  const content = widgetConfirmationCopy(reference.type, language, reference.customLabel);
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

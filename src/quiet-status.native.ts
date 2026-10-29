import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { getLocalRuntime } from './local/runtime.native';
import { resolveLanguage } from './localization';
import { getNotificationPermissionState, listCustomTimedReminders } from './reminders';
import { pottyReminderIdentifier, reminderIdentifier } from './reminder-config';
import { QUIET_STATUS_CHANNEL, QUIET_STATUS_IDENTIFIER, QUIET_STATUS_KIND, quietStatusCopy, quietStatusSnapshot } from './quiet-status-config';

export const getQuietStatusEnabled = async () => (await getLocalRuntime()).storage.loadQuietStatusEnabled();

let writes: Promise<unknown> = Promise.resolve();
export function syncQuietStatus(): Promise<void> {
  // Read committed state inside the queue: a later disable/pet switch wins over
  // an update already being delivered, without adding any activity-list state.
  const next = writes.then(async () => {
    const runtime = await getLocalRuntime();
    const { storage, activity, petId } = runtime;
    const [enabled, delivery, permission] = await Promise.all([
      storage.loadQuietStatusEnabled(), storage.loadNotificationDelivery(), getNotificationPermissionState(),
    ]);
    if (!enabled || !delivery || permission !== 'granted') {
      await Notifications.cancelScheduledNotificationAsync(QUIET_STATUS_IDENTIFIER);
      await Notifications.dismissNotificationAsync(QUIET_STATUS_IDENTIFIER);
      return;
    }
    const [events, schedule, preferences, languagePreference, name, timed, pending] = await Promise.all([
      activity.latestEvents(), storage.loadSchedule(), storage.loadNotificationPreferences(),
      storage.loadLanguagePreference(), storage.loadPuppyName(), listCustomTimedReminders(petId),
      Notifications.getAllScheduledNotificationsAsync(),
    ]);
    const scheduled = new Set(pending.map(item => item.identifier));
    const copy = quietStatusCopy(quietStatusSnapshot(events, schedule.filter(entry => scheduled.has(reminderIdentifier(entry))), {
      ...preferences,
      pottyAfterPee: { ...preferences.pottyAfterPee, enabled: preferences.pottyAfterPee.enabled && scheduled.has(pottyReminderIdentifier('afterPee')) },
      pottyAfterMeal: { ...preferences.pottyAfterMeal, enabled: preferences.pottyAfterMeal.enabled && scheduled.has(pottyReminderIdentifier('afterMeal')) },
    }, timed, name, resolveLanguage(languagePreference)));
    const delivered = await Notifications.getPresentedNotificationsAsync();
    const existing = delivered.find(item => item.request.identifier === QUIET_STATUS_IDENTIFIER)?.request.content;
    if (existing?.title === copy.title && existing.body === copy.body && existing.data?.petId === petId) return;
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(QUIET_STATUS_CHANNEL, {
        name: 'Quiet puppy status', importance: Notifications.AndroidImportance.LOW,
        sound: null, enableVibrate: false, showBadge: false,
      });
    }
    await Notifications.scheduleNotificationAsync({
      identifier: QUIET_STATUS_IDENTIFIER,
      content: {
        ...copy, sound: false, interruptionLevel: 'passive', sticky: true, autoDismiss: false,
        data: { kind: QUIET_STATUS_KIND, petId },
      },
      trigger: Platform.OS === 'android' ? { channelId: QUIET_STATUS_CHANNEL } : null,
    });
  });
  writes = next.catch(() => undefined);
  return next;
}

export async function setQuietStatusEnabled(enabled: boolean): Promise<void> {
  await (await getLocalRuntime()).storage.saveQuietStatusEnabled(enabled);
  await syncQuietStatus();
}

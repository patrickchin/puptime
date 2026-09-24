import { formatMinutes, type ActivityKey, type PuppyEvent, type QuickEventType, type ScheduleEntry } from './domain.ts';
import { localizedEventLabel, translate, type AppLanguage } from './localization.ts';
import {
  reminderTriggerMinutes,
  type NotificationPreferences,
  type PottyReminderDelayMinutes,
  type ReminderLeadMinutes,
} from './notification-config.ts';

export const REMINDER_IDENTIFIER_PREFIX = 'puptime-routine-';
export const POTTY_REMINDER_IDENTIFIER_PREFIX = 'puptime-activity-';

export type PottyReminderKind = 'afterPee' | 'afterMeal';

export type PottyReminderPlan = {
  kind: PottyReminderKind;
  sourceEventId: string;
  sourceType: 'pee' | 'meal';
  delayMinutes: PottyReminderDelayMinutes;
  at: number;
};

export function reminderIdentifier(entry: ScheduleEntry): string {
  return `${REMINDER_IDENTIFIER_PREFIX}${entry.id}`;
}

export function reminderCopy(
  entry: ScheduleEntry,
  language: AppLanguage = 'en',
  leadMinutes: ReminderLeadMinutes = 0,
): { title: string; body: string } {
  const activity = entry.customLabel ?? localizedEventLabel(language, entry.type);
  return {
    title: leadMinutes
      ? translate(language, 'notifications.reminderSoon', { activity, minutes: leadMinutes })
      : translate(language, 'notifications.reminderNow', { activity }),
    body: translate(language, 'notifications.reminderBody', { time: formatMinutes(entry.minutes) }),
  };
}

export function reminderTrigger(entry: ScheduleEntry, leadMinutes: ReminderLeadMinutes): { hour: number; minute: number } {
  const minutes = reminderTriggerMinutes(entry.minutes, leadMinutes);
  return { hour: Math.floor(minutes / 60), minute: minutes % 60 };
}

export function widgetConfirmationCopy(
  type: ActivityKey,
  language: AppLanguage = 'en',
  customLabel?: string,
): { title: string; body: string } {
  return {
    title: translate(language, 'notifications.widgetLoggedTitle'),
    body: translate(language, 'notifications.widgetLoggedBody', {
      activity: type.startsWith('custom:') ? customLabel ?? type.slice(7) : localizedEventLabel(language, type as QuickEventType),
    }),
  };
}

export function pottyReminderIdentifier(kind: PottyReminderKind): string {
  return `${POTTY_REMINDER_IDENTIFIER_PREFIX}${kind}`;
}

function notificationDelay(language: AppLanguage, minutes: PottyReminderDelayMinutes): string {
  if (minutes < 60) return translate(language, 'notifications.delayMinutes', { count: minutes });
  const hours = minutes / 60;
  return hours === 1
    ? translate(language, 'notifications.delayOneHour')
    : translate(language, 'notifications.delayHours', { count: hours });
}

export function pottyReminderCopy(
  kind: PottyReminderKind,
  delayMinutes: PottyReminderDelayMinutes,
  language: AppLanguage = 'en',
): { title: string; body: string } {
  const delay = notificationDelay(language, delayMinutes);
  return kind === 'afterPee'
    ? {
        title: translate(language, 'notifications.afterPeeTitle'),
        body: translate(language, 'notifications.afterPeeBody', { delay }),
      }
    : {
        title: translate(language, 'notifications.afterMealTitle'),
        body: translate(language, 'notifications.afterMealBody', { delay }),
      };
}

export function pottyReminderPlans(
  events: readonly PuppyEvent[],
  preferences: NotificationPreferences,
  now = Date.now(),
): PottyReminderPlan[] {
  let latestPee: PuppyEvent | undefined;
  let latestMeal: PuppyEvent | undefined;
  for (const event of events) {
    if (event.type === 'pee' && (!latestPee || event.at > latestPee.at)) latestPee = event;
    if (event.type === 'meal' && (!latestMeal || event.at > latestMeal.at)) latestMeal = event;
  }

  const plans: PottyReminderPlan[] = [];
  if (preferences.pottyAfterPee.enabled && latestPee) {
    const at = latestPee.at + preferences.pottyAfterPee.delayMinutes * 60_000;
    if (at > now) {
      plans.push({
        kind: 'afterPee',
        sourceEventId: latestPee.id,
        sourceType: 'pee',
        delayMinutes: preferences.pottyAfterPee.delayMinutes,
        at,
      });
    }
  }
  if (
    preferences.pottyAfterMeal.enabled
    && latestMeal
    && (!latestPee || latestMeal.at > latestPee.at)
  ) {
    const at = latestMeal.at + preferences.pottyAfterMeal.delayMinutes * 60_000;
    if (at > now) {
      plans.push({
        kind: 'afterMeal',
        sourceEventId: latestMeal.id,
        sourceType: 'meal',
        delayMinutes: preferences.pottyAfterMeal.delayMinutes,
        at,
      });
    }
  }
  return plans;
}

import { formatMinutes, type QuickEventType, type ScheduleEntry } from './domain.ts';
import { localizedEventLabel, translate, type AppLanguage } from './localization.ts';
import { reminderTriggerMinutes, type ReminderLeadMinutes } from './notification-config.ts';

export const REMINDER_IDENTIFIER_PREFIX = 'puptime-routine-';

export function reminderIdentifier(entry: ScheduleEntry): string {
  return `${REMINDER_IDENTIFIER_PREFIX}${entry.id}`;
}

export function reminderCopy(
  entry: ScheduleEntry,
  language: AppLanguage = 'en',
  leadMinutes: ReminderLeadMinutes = 0,
): { title: string; body: string } {
  const activity = localizedEventLabel(language, entry.type);
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
  type: QuickEventType,
  language: AppLanguage = 'en',
): { title: string; body: string } {
  return {
    title: translate(language, 'notifications.widgetLoggedTitle'),
    body: translate(language, 'notifications.widgetLoggedBody', {
      activity: localizedEventLabel(language, type),
    }),
  };
}

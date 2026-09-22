export const reminderLeadOptions = [0, 5, 10, 15, 30] as const;

export type ReminderLeadMinutes = (typeof reminderLeadOptions)[number];

export type NotificationPreferences = {
  reminderLeadMinutes: ReminderLeadMinutes;
  widgetConfirmations: boolean;
};

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  reminderLeadMinutes: 10,
  widgetConfirmations: false,
};

export function normalizeNotificationPreferences(value: unknown): NotificationPreferences {
  if (!value || typeof value !== 'object') return { ...DEFAULT_NOTIFICATION_PREFERENCES };
  const candidate = value as Partial<NotificationPreferences>;
  return {
    reminderLeadMinutes: reminderLeadOptions.includes(candidate.reminderLeadMinutes as ReminderLeadMinutes)
      ? candidate.reminderLeadMinutes as ReminderLeadMinutes
      : DEFAULT_NOTIFICATION_PREFERENCES.reminderLeadMinutes,
    widgetConfirmations: candidate.widgetConfirmations === true,
  };
}

export function reminderTriggerMinutes(minutes: number, leadMinutes: ReminderLeadMinutes): number {
  return (minutes - leadMinutes + 24 * 60) % (24 * 60);
}

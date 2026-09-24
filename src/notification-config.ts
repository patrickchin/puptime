export const reminderLeadOptions = [0, 5, 10, 15, 30] as const;
export const pottyReminderDelayOptions = [15, 30, 45, 60, 120, 180, 240] as const;

export type ReminderLeadMinutes = (typeof reminderLeadOptions)[number];
export type PottyReminderDelayMinutes = (typeof pottyReminderDelayOptions)[number];

export type PottyReminderPreference = {
  enabled: boolean;
  delayMinutes: PottyReminderDelayMinutes;
};

export type NotificationPreferences = {
  reminderLeadMinutes: ReminderLeadMinutes;
  widgetConfirmations: boolean;
  pottyAfterPee: PottyReminderPreference;
  pottyAfterMeal: PottyReminderPreference;
};

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  reminderLeadMinutes: 10,
  widgetConfirmations: false,
  pottyAfterPee: { enabled: true, delayMinutes: 120 },
  pottyAfterMeal: { enabled: true, delayMinutes: 30 },
};

function normalizePottyReminder(
  value: unknown,
  fallback: PottyReminderPreference,
): PottyReminderPreference {
  if (!value || typeof value !== 'object') return { ...fallback };
  const candidate = value as Partial<PottyReminderPreference>;
  return {
    enabled: typeof candidate.enabled === 'boolean' ? candidate.enabled : fallback.enabled,
    delayMinutes: pottyReminderDelayOptions.includes(candidate.delayMinutes as PottyReminderDelayMinutes)
      ? candidate.delayMinutes as PottyReminderDelayMinutes
      : fallback.delayMinutes,
  };
}

export function normalizeNotificationPreferences(value: unknown): NotificationPreferences {
  if (!value || typeof value !== 'object') {
    return {
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      pottyAfterPee: { ...DEFAULT_NOTIFICATION_PREFERENCES.pottyAfterPee },
      pottyAfterMeal: { ...DEFAULT_NOTIFICATION_PREFERENCES.pottyAfterMeal },
    };
  }
  const candidate = value as Partial<NotificationPreferences>;
  return {
    reminderLeadMinutes: reminderLeadOptions.includes(candidate.reminderLeadMinutes as ReminderLeadMinutes)
      ? candidate.reminderLeadMinutes as ReminderLeadMinutes
      : DEFAULT_NOTIFICATION_PREFERENCES.reminderLeadMinutes,
    widgetConfirmations: candidate.widgetConfirmations === true,
    pottyAfterPee: normalizePottyReminder(candidate.pottyAfterPee, DEFAULT_NOTIFICATION_PREFERENCES.pottyAfterPee),
    pottyAfterMeal: normalizePottyReminder(candidate.pottyAfterMeal, DEFAULT_NOTIFICATION_PREFERENCES.pottyAfterMeal),
  };
}

export function reminderTriggerMinutes(minutes: number, leadMinutes: ReminderLeadMinutes): number {
  return (minutes - leadMinutes + 24 * 60) % (24 * 60);
}

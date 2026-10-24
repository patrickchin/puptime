export const storageKeys = {
  events: 'puptime.events.v1', schedule: 'puptime.schedule.v1', theme: 'puptime.theme.v1',
  language: 'puptime.language.v1', widgetActions: 'puptime.widgetActions.v1',
  customActivities: 'puptime.customActivities.v1', deletedCustomActivities: 'puptime.deletedCustomActivities.v1',
  activityCustomizations: 'puptime.activityCustomizations.v1',
  puppyPhoto: 'puptime.puppyPhoto.v1',
  notificationPreferences: 'puptime.notificationPreferences.v1', onboarding: 'puptime.onboarding.v1',
} as const;
export type StorageKey = typeof storageKeys[keyof typeof storageKeys];
export const petSettingKeys = new Set<StorageKey>([storageKeys.customActivities, storageKeys.deletedCustomActivities, storageKeys.activityCustomizations, storageKeys.puppyPhoto]);

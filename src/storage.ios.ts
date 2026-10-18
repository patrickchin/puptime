import type { ActivityCustomization } from './activity-customization';
import type { ActivityKey, PuppyEvent, PuppyEventChanges, ScheduleEntry } from './domain';
import type { LanguagePreference } from './localization';
import type { NotificationPreferences } from './notification-config';
import type { ThemePreference } from './theme';
import { createNativeStorage } from './local/native-storage';
import { openLocalDatabase } from './local/open.native';
export { assertValidEvents, EventsImportError, EventsStorageError } from './storage-validation';

type Storage = ReturnType<typeof createNativeStorage>;
let initialized: Promise<Storage> | undefined;
function storage(): Promise<Storage> {
  initialized ??= openLocalDatabase().then(({ database, petId }) => createNativeStorage(database, petId)).catch((error) => {
    initialized = undefined;
    throw error;
  });
  return initialized;
}

export const shouldShowOnboarding = async () => (await storage()).shouldShowOnboarding();
export const completeOnboarding = async () => (await storage()).completeOnboarding();
export const loadEvents = async () => (await storage()).loadEvents();
export const appendEvents = async (events: PuppyEvent[]) => (await storage()).appendEvents(events);
export const importEvents = async (events: PuppyEvent[]) => (await storage()).importEvents(events);
export const removeEvent = async (id: string) => (await storage()).removeEvent(id);
export const updateEventTime = async (id: string, at: number) => (await storage()).updateEventTime(id, at);
export const updateEvent = async (id: string, changes: PuppyEventChanges) => (await storage()).updateEvent(id, changes);
export const loadSchedule = async () => (await storage()).loadSchedule();
export const saveSchedule = async (schedule: ScheduleEntry[]) => (await storage()).saveSchedule(schedule);
export const loadThemePreference = async () => (await storage()).loadThemePreference();
export const saveThemePreference = async (value: ThemePreference) => (await storage()).saveThemePreference(value);
export const loadLanguagePreference = async () => (await storage()).loadLanguagePreference();
export const saveLanguagePreference = async (value: LanguagePreference) => (await storage()).saveLanguagePreference(value);
export const loadCustomActivities = async (events?: PuppyEvent[]) => (await storage()).loadCustomActivities(events);
export const saveCustomActivity = async (label: string) => (await storage()).saveCustomActivity(label);
export const deleteCustomActivity = async (label: string) => (await storage()).deleteCustomActivity(label);
export const loadActivityCustomizations = async () => (await storage()).loadActivityCustomizations();
export const saveActivityCustomization = async (key: ActivityKey, value: ActivityCustomization) => (await storage()).saveActivityCustomization(key, value);
export const loadWidgetActions = async (activities?: string[]) => (await storage()).loadWidgetActions(activities);
export const saveWidgetActions = async (actions: ActivityKey[]) => (await storage()).saveWidgetActions(actions);
export const loadNotificationPreferences = async () => (await storage()).loadNotificationPreferences();
export const saveNotificationPreferences = async (value: NotificationPreferences) => (await storage()).saveNotificationPreferences(value);

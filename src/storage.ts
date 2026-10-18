import AsyncStorage from '@react-native-async-storage/async-storage';
import { parseEvents, parseSchedule, EventsImportError, EventsStorageError } from './storage-validation.ts';
import { storageKeys } from './local/settings.ts';
import { applyScheduleEntryEdit } from './schedule-editor.ts';
import type { FinishOnboardingOptions } from './onboarding.ts';
export { assertValidEvents, EventsImportError, EventsStorageError } from './storage-validation.ts';

import { normalizeActivityCustomizations, type ActivityCustomization, type ActivityCustomizations } from './activity-customization.ts';
import {
  customActivityKey,
  DEFAULT_WIDGET_ACTIONS,
  normalizeCustomActivities,
  isOpenNap,
  normalizeWidgetActions,
  STARTER_SCHEDULE,
  type PuppyEvent,
  type PuppyEventChanges,
  type ActivityKey,
  type ScheduleEntry,
} from './domain.ts';
import { isLanguagePreference, type LanguagePreference } from './localization.ts';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  normalizeNotificationPreferences,
  type NotificationPreferences,
} from './notification-config.ts';
import { isThemePreference, type ThemePreference } from './theme.ts';

const EVENTS_KEY = storageKeys.events;
const SCHEDULE_KEY = storageKeys.schedule;
const THEME_KEY = storageKeys.theme;
const LANGUAGE_KEY = storageKeys.language;
const WIDGET_ACTIONS_KEY = storageKeys.widgetActions;
const CUSTOM_ACTIVITIES_KEY = storageKeys.customActivities;
const DELETED_CUSTOM_ACTIVITIES_KEY = storageKeys.deletedCustomActivities;
const ACTIVITY_CUSTOMIZATIONS_KEY = storageKeys.activityCustomizations;
const NOTIFICATION_PREFERENCES_KEY = storageKeys.notificationPreferences;
const ONBOARDING_KEY = storageKeys.onboarding;

// ponytail: This queue covers one JS runtime; use transactional storage if widget writers need a shared lock.
let writeQueue = Promise.resolve();

export async function shouldShowOnboarding(): Promise<boolean> {
  const entries = await AsyncStorage.multiGet([
    ONBOARDING_KEY,
    EVENTS_KEY,
    SCHEDULE_KEY,
    THEME_KEY,
    LANGUAGE_KEY,
    WIDGET_ACTIONS_KEY,
    NOTIFICATION_PREFERENCES_KEY,
  ]);
  return entries.every(([, value]) => value === null);
}

export function completeOnboarding(_options?:FinishOnboardingOptions): Promise<void> {
  return AsyncStorage.setItem(ONBOARDING_KEY, 'done');
}

function queueEventWrite<T>(operation: () => Promise<T>): Promise<T> {
  const result = writeQueue.then(operation);
  // Keep the caller's rejection while allowing the next operation to retry storage.
  writeQueue = result.then(() => undefined, () => undefined);
  return result;
}

async function writeEvents(events: PuppyEvent[]): Promise<PuppyEvent[]> {
  events=parseEvents(events);
  const sorted = [...events].sort((a, b) => b.at - a.at);
  await AsyncStorage.setItem(EVENTS_KEY, JSON.stringify(sorted));
  return sorted;
}

function parseArray<T>(value: string | null): T[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function loadEvents(): Promise<PuppyEvent[]> {
  const stored = await AsyncStorage.getItem(EVENTS_KEY);
  if (stored === null) return [];
  try {
    const events = parseEvents(JSON.parse(stored));
    return events.sort((a, b) => b.at - a.at);
  } catch {
    throw new EventsStorageError();
  }
}

export function appendEvents(incoming: PuppyEvent[]): Promise<PuppyEvent[]> {
  return queueEventWrite(async () => {
    incoming=parseEvents(incoming);
    const current = await loadEvents();
    const byId = new Map(current.map((event) => [event.id, event]));
    incoming.forEach((event) => byId.set(event.id, {
      ...byId.get(event.id),
      ...event,
      ...(byId.get(event.id)?.estimated ? { estimated: true } : {}),
    }));
    return writeEvents([...byId.values()]);
  });
}

export function importEvents(incoming: PuppyEvent[]): Promise<{
  events: PuppyEvent[];
  imported: number;
  skipped: number;
}> {
  return queueEventWrite(async () => {
    incoming=parseEvents(incoming);
    const current = await loadEvents();
    const ids = new Set(current.map((event) => event.id));
    const additions = incoming.filter((event) => !ids.has(event.id));
    const merged = [...current, ...additions];
    if (merged.filter(isOpenNap).length > 1) throw new EventsImportError();
    const events = additions.length ? await writeEvents(merged) : current;
    return { events, imported: additions.length, skipped: incoming.length - additions.length };
  });
}

export function removeEvent(id: string): Promise<PuppyEvent[]> {
  return queueEventWrite(async () => writeEvents((await loadEvents()).filter((event) => event.id !== id)));
}

export function updateEventTime(id: string, at: number): Promise<PuppyEvent[]> {
  return updateEvent(id, { at });
}

export function updateEvent(
  id: string,
  changes: PuppyEventChanges,
): Promise<PuppyEvent[]> {
  return queueEventWrite(async () => writeEvents((await loadEvents())
    .map((event) => (event.id === id ? { ...event, ...changes } : event))));
}

export async function loadSchedule(): Promise<ScheduleEntry[]> {
  const stored = await AsyncStorage.getItem(SCHEDULE_KEY);
  if (stored === null) {
    await AsyncStorage.setItem(SCHEDULE_KEY, JSON.stringify(STARTER_SCHEDULE));
    return STARTER_SCHEDULE;
  }
  return parseArray<ScheduleEntry>(stored).sort((a, b) => a.minutes - b.minutes);
}

export async function saveSchedule(schedule: ScheduleEntry[]): Promise<void> {
  await AsyncStorage.setItem(
    SCHEDULE_KEY,
    JSON.stringify(parseSchedule(schedule).sort((a, b) => a.minutes - b.minutes)),
  );
}

let scheduleWrites=Promise.resolve();
function mutateSchedule(action:(current:ScheduleEntry[])=>ScheduleEntry[]):Promise<ScheduleEntry[]> {
  const result=scheduleWrites.then(async()=>{const entries=action(await loadSchedule());await saveSchedule(entries);return entries;});
  scheduleWrites=result.then(()=>undefined,()=>undefined);return result;
}
export const saveScheduleEntry=(entry:ScheduleEntry,original?:ScheduleEntry)=>mutateSchedule(current=>applyScheduleEntryEdit(current,entry,original));
export const removeScheduleEntry=(id:string)=>mutateSchedule(current=>current.filter(entry=>entry.id!==id));

export async function loadThemePreference(): Promise<ThemePreference> {
  const stored = await AsyncStorage.getItem(THEME_KEY);
  return isThemePreference(stored) ? stored : 'system';
}

export function saveThemePreference(preference: ThemePreference): Promise<void> {
  return AsyncStorage.setItem(THEME_KEY, preference);
}

export async function loadLanguagePreference(): Promise<LanguagePreference> {
  const stored = await AsyncStorage.getItem(LANGUAGE_KEY);
  return isLanguagePreference(stored) ? stored : 'system';
}

export function saveLanguagePreference(preference: LanguagePreference): Promise<void> {
  return AsyncStorage.setItem(LANGUAGE_KEY, preference);
}

export async function loadCustomActivities(events?: PuppyEvent[]): Promise<string[]> {
  const stored = parseArray<string>(await AsyncStorage.getItem(CUSTOM_ACTIVITIES_KEY));
  const deleted = parseArray<string>(await AsyncStorage.getItem(DELETED_CUSTOM_ACTIVITIES_KEY));
  const historical = (events ?? await loadEvents())
    .filter((event) => event.type === 'custom')
    .map((event) => event.customLabel);
  const activities = normalizeCustomActivities([...stored, ...historical], deleted);
  if (JSON.stringify(activities) !== JSON.stringify(stored)) {
    await AsyncStorage.setItem(CUSTOM_ACTIVITIES_KEY, JSON.stringify(activities));
  }
  return activities;
}

export async function saveCustomActivity(label: string): Promise<string[]> {
  const key = customActivityKey(label);
  const deleted = parseArray<string>(await AsyncStorage.getItem(DELETED_CUSTOM_ACTIVITIES_KEY));
  if (deleted.includes(key)) await AsyncStorage.setItem(DELETED_CUSTOM_ACTIVITIES_KEY, JSON.stringify(deleted.filter((item) => item !== key)));
  const next = normalizeCustomActivities([...await loadCustomActivities(), label]);
  await AsyncStorage.setItem(CUSTOM_ACTIVITIES_KEY, JSON.stringify(next));
  return next;
}

export async function deleteCustomActivity(label: string): Promise<string[]> {
  const key = customActivityKey(label);
  const deleted = parseArray<string>(await AsyncStorage.getItem(DELETED_CUSTOM_ACTIVITIES_KEY));
  await AsyncStorage.setItem(DELETED_CUSTOM_ACTIVITIES_KEY, JSON.stringify([...new Set([...deleted, key])]));
  const next = normalizeCustomActivities((await loadCustomActivities()).filter((item) => customActivityKey(item) !== key));
  await AsyncStorage.setItem(CUSTOM_ACTIVITIES_KEY, JSON.stringify(next));
  const customizations = await loadActivityCustomizations();
  delete customizations[key];
  await AsyncStorage.setItem(ACTIVITY_CUSTOMIZATIONS_KEY, JSON.stringify(customizations));
  return next;
}

export async function loadActivityCustomizations(): Promise<ActivityCustomizations> {
  const stored = await AsyncStorage.getItem(ACTIVITY_CUSTOMIZATIONS_KEY);
  if (!stored) return {};
  try { return normalizeActivityCustomizations(JSON.parse(stored)); }
  catch { return {}; }
}

export async function saveActivityCustomization(key: ActivityKey, customization: ActivityCustomization): Promise<ActivityCustomizations> {
  const next = { ...await loadActivityCustomizations(), [key]: customization };
  await AsyncStorage.setItem(ACTIVITY_CUSTOMIZATIONS_KEY, JSON.stringify(next));
  return next;
}

export async function loadWidgetActions(customActivities?: string[]): Promise<ActivityKey[]> {
  const stored = await AsyncStorage.getItem(WIDGET_ACTIONS_KEY);
  if (stored === null) return [...DEFAULT_WIDGET_ACTIONS];
  try {
    return normalizeWidgetActions(JSON.parse(stored), customActivities ?? await loadCustomActivities());
  } catch {
    return [...DEFAULT_WIDGET_ACTIONS];
  }
}

export async function saveWidgetActions(actions: ActivityKey[]): Promise<void> {
  await AsyncStorage.setItem(WIDGET_ACTIONS_KEY, JSON.stringify(normalizeWidgetActions(actions, await loadCustomActivities())));
}

export async function loadNotificationPreferences(): Promise<NotificationPreferences> {
  const stored = await AsyncStorage.getItem(NOTIFICATION_PREFERENCES_KEY);
  if (stored === null) return { ...DEFAULT_NOTIFICATION_PREFERENCES };
  try {
    return normalizeNotificationPreferences(JSON.parse(stored));
  } catch {
    return { ...DEFAULT_NOTIFICATION_PREFERENCES };
  }
}

export async function saveNotificationPreferences(preferences: NotificationPreferences): Promise<void> {
  await AsyncStorage.setItem(
    NOTIFICATION_PREFERENCES_KEY,
    JSON.stringify(normalizeNotificationPreferences(preferences)),
  );
}

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  DEFAULT_WIDGET_ACTIONS,
  normalizeWidgetActions,
  STARTER_SCHEDULE,
  type PuppyEvent,
  type PuppyEventChanges,
  type QuickEventType,
  type ScheduleEntry,
} from './domain';
import { isLanguagePreference, type LanguagePreference } from './localization';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  normalizeNotificationPreferences,
  type NotificationPreferences,
} from './notification-config';
import { isThemePreference, type ThemePreference } from './theme';

const EVENTS_KEY = 'puptime.events.v1';
const SCHEDULE_KEY = 'puptime.schedule.v1';
const THEME_KEY = 'puptime.theme.v1';
const LANGUAGE_KEY = 'puptime.language.v1';
const WIDGET_ACTIONS_KEY = 'puptime.widgetActions.v1';
const NOTIFICATION_PREFERENCES_KEY = 'puptime.notificationPreferences.v1';
const ONBOARDING_KEY = 'puptime.onboarding.v1';

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

export function completeOnboarding(): Promise<void> {
  return AsyncStorage.setItem(ONBOARDING_KEY, 'done');
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
  const events = parseArray<PuppyEvent>(await AsyncStorage.getItem(EVENTS_KEY));
  return events.sort((a, b) => b.at - a.at);
}

export function appendEvents(incoming: PuppyEvent[]): Promise<PuppyEvent[]> {
  let result: PuppyEvent[] = [];
  writeQueue = writeQueue.then(async () => {
    const current = await loadEvents();
    const byId = new Map(current.map((event) => [event.id, event]));
    incoming.forEach((event) => byId.set(event.id, event));
    result = [...byId.values()].sort((a, b) => b.at - a.at);
    await AsyncStorage.setItem(EVENTS_KEY, JSON.stringify(result));
  });
  return writeQueue.then(() => result);
}

export function removeEvent(id: string): Promise<PuppyEvent[]> {
  let result: PuppyEvent[] = [];
  writeQueue = writeQueue.then(async () => {
    result = (await loadEvents()).filter((event) => event.id !== id);
    await AsyncStorage.setItem(EVENTS_KEY, JSON.stringify(result));
  });
  return writeQueue.then(() => result);
}

export function updateEventTime(id: string, at: number): Promise<PuppyEvent[]> {
  return updateEvent(id, { at });
}

export function updateEvent(
  id: string,
  changes: PuppyEventChanges,
): Promise<PuppyEvent[]> {
  let result: PuppyEvent[] = [];
  writeQueue = writeQueue.then(async () => {
    result = (await loadEvents())
      .map((event) => (event.id === id ? { ...event, ...changes } : event))
      .sort((a, b) => b.at - a.at);
    await AsyncStorage.setItem(EVENTS_KEY, JSON.stringify(result));
  });
  return writeQueue.then(() => result);
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
    JSON.stringify([...schedule].sort((a, b) => a.minutes - b.minutes)),
  );
}

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

export async function loadWidgetActions(): Promise<QuickEventType[]> {
  const stored = await AsyncStorage.getItem(WIDGET_ACTIONS_KEY);
  if (stored === null) return [...DEFAULT_WIDGET_ACTIONS];
  try {
    return normalizeWidgetActions(JSON.parse(stored));
  } catch {
    return [...DEFAULT_WIDGET_ACTIONS];
  }
}

export async function saveWidgetActions(actions: QuickEventType[]): Promise<void> {
  await AsyncStorage.setItem(WIDGET_ACTIONS_KEY, JSON.stringify(normalizeWidgetActions(actions)));
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

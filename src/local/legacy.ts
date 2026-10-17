import { isEventType, type PuppyEvent, type ScheduleEntry } from '../domain.ts';
import { assertValidEvents } from '../storage-validation.ts';

export const storageKeys = {
  events: 'puptime.events.v1', schedule: 'puptime.schedule.v1', theme: 'puptime.theme.v1',
  language: 'puptime.language.v1', widgetActions: 'puptime.widgetActions.v1',
  customActivities: 'puptime.customActivities.v1', deletedCustomActivities: 'puptime.deletedCustomActivities.v1',
  activityCustomizations: 'puptime.activityCustomizations.v1',
  notificationPreferences: 'puptime.notificationPreferences.v1', onboarding: 'puptime.onboarding.v1',
} as const;
export const legacyKeys = Object.values(storageKeys);
export type LegacyKey = typeof legacyKeys[number];
export type LegacySnapshot = {
  raw: Record<LegacyKey, string | null>;
  events: PuppyEvent[];
  schedule: ScheduleEntry[] | null;
  showOnboarding: boolean;
};

export function assertValidSchedule(value: unknown): asserts value is ScheduleEntry[] {
  if (!Array.isArray(value)) throw new TypeError('Legacy routines must be an array.');
  const ids = new Set<string>();
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string' || !entry.id.trim() || ids.has(entry.id)
      || !isEventType(entry.type) || !Number.isInteger(entry.minutes) || entry.minutes < 0 || entry.minutes > 1439
      || (entry.customLabel !== undefined && typeof entry.customLabel !== 'string')
      || (entry.reminder !== undefined && typeof entry.reminder !== 'boolean')
      || (entry.toleranceMinutes !== undefined && (!Number.isInteger(entry.toleranceMinutes) || entry.toleranceMinutes < 0 || entry.toleranceMinutes > 1440))) {
      throw new TypeError('Legacy routines contain an invalid or duplicate entry.');
    }
    ids.add(entry.id);
  }
}

export function parseLegacySnapshot(entries: ReadonlyArray<readonly [string, string | null]>): LegacySnapshot {
  if (entries.length !== legacyKeys.length || new Set(entries.map(([key]) => key)).size !== legacyKeys.length
    || legacyKeys.some((key) => !entries.some(([entryKey]) => entryKey === key))) {
    throw new Error('The legacy snapshot key inventory is incomplete or duplicated.');
  }
  const raw = Object.fromEntries(entries) as LegacySnapshot['raw'];
  function json(key: LegacyKey): unknown {
    try { return JSON.parse(raw[key]!); }
    catch { throw new Error(`The legacy value for ${key} is not valid JSON.`); }
  }
  const events = raw[storageKeys.events] === null ? [] : json(storageKeys.events);
  assertValidEvents(events);
  let schedule: ScheduleEntry[] | null = null;
  if (raw[storageKeys.schedule] !== null) {
    const parsed = json(storageKeys.schedule);
    assertValidSchedule(parsed);
    schedule = parsed;
  }
  // Preserve raw settings for existing normalizers; malformed shapes never become silent defaults.
  for (const key of [storageKeys.customActivities, storageKeys.deletedCustomActivities, storageKeys.widgetActions]) {
    if (raw[key] === null) continue;
    const value = json(key);
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw new TypeError(`The legacy collection for ${key} is invalid.`);
  }
  for (const key of [storageKeys.activityCustomizations, storageKeys.notificationPreferences]) {
    if (raw[key] === null) continue;
    const value = json(key);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`The legacy settings for ${key} are invalid.`);
  }
  const onboardingKeys = [storageKeys.onboarding, storageKeys.events, storageKeys.schedule, storageKeys.theme,
    storageKeys.language, storageKeys.widgetActions, storageKeys.notificationPreferences];
  return { raw, events, schedule, showOnboarding: onboardingKeys.every((key) => raw[key] === null) };
}

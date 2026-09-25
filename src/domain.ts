export const eventTypes = ['pee', 'poop', 'meal', 'pottyTrip', 'walk', 'nap', 'custom'] as const;

export const quickEventTypes = ['pee', 'poop', 'meal', 'pottyTrip', 'walk', 'nap'] as const;

export type EventType = (typeof eventTypes)[number];
export type QuickEventType = (typeof quickEventTypes)[number];
export type ActivityKey = QuickEventType | `custom:${string}`;
export type Activity = { type: EventType; customLabel?: string };

export const DEFAULT_WIDGET_ACTIONS = ['pee', 'poop', 'meal'] as const satisfies readonly QuickEventType[];

export function normalizeWidgetActions(value: unknown, customActivities: readonly string[] = []): ActivityKey[] {
  const allowed = new Set(customActivities.map(customActivityKey));
  const requested = Array.isArray(value)
    ? value.filter((item): item is ActivityKey => isQuickEventType(item) || (typeof item === 'string' && allowed.has(item as `custom:${string}`)))
    : [];
  const unique = [...new Set(requested)];
  return unique.length >= 2 ? unique.slice(0, 4) : [...DEFAULT_WIDGET_ACTIONS];
}

export function widgetActionsForState(value: unknown, activeNap: boolean, customActivities: readonly string[] = []): ActivityKey[] {
  const actions = normalizeWidgetActions(value, customActivities);
  return activeNap && !actions.includes('nap') ? [...actions.slice(0, 3), 'nap'] : actions;
}

export type PuppyEvent = {
  id: string;
  type: EventType;
  at: number;
  endedAt?: number | null;
  customLabel?: string;
  note?: string;
  source: 'app' | 'widget';
};

export type QuickEventTimes = Partial<Record<ActivityKey, number>>;

export type PuppyEventChanges = Partial<
  Pick<PuppyEvent, 'type' | 'at' | 'endedAt' | 'customLabel' | 'note'>
>;

export type ScheduleEntry = {
  id: string;
  type: EventType;
  customLabel?: string;
  minutes: number;
  reminder?: boolean;
};

export const EVENT_META: Record<
  EventType,
  {
    label: string;
    pastLabel: string;
    icon: string;
    color: string;
    softColor: string;
    darkColor: string;
    darkSoftColor: string;
  }
> = {
  pee: {
    label: 'Pee',
    pastLabel: 'Peed',
    icon: 'water-outline',
    color: '#086B9B',
    softColor: '#DDF2FA',
    darkColor: '#75CFF2',
    darkSoftColor: '#173A4A',
  },
  poop: {
    label: 'Poop',
    pastLabel: 'Pooped',
    icon: 'emoticon-poop-outline',
    color: '#B54E00',
    softColor: '#FFF0DC',
    darkColor: '#FFC16B',
    darkSoftColor: '#48321D',
  },
  meal: {
    label: 'Ate',
    pastLabel: 'Ate a meal',
    icon: 'food-apple-outline',
    color: '#3B7827',
    softColor: '#E8F4DF',
    darkColor: '#A3DD86',
    darkSoftColor: '#2A3E24',
  },
  pottyTrip: {
    label: 'Potty trip',
    pastLabel: 'Went out for potty',
    icon: 'door-open',
    color: '#536A75',
    softColor: '#E7EFF2',
    darkColor: '#AEC6D0',
    darkSoftColor: '#293B43',
  },
  walk: {
    label: 'Walk',
    pastLabel: 'Went for a walk',
    icon: 'walk',
    color: '#A33D7A',
    softColor: '#F9E5F1',
    darkColor: '#ECA4D2',
    darkSoftColor: '#452C3E',
  },
  nap: {
    label: 'Nap',
    pastLabel: 'Nap',
    icon: 'sleep',
    color: '#5058A5',
    softColor: '#E8EAF9',
    darkColor: '#ABB3F5',
    darkSoftColor: '#30334B',
  },
  custom: {
    label: 'Other',
    pastLabel: 'Other activity',
    icon: 'tag-outline',
    color: '#626A70',
    softColor: '#EAEEF0',
    darkColor: '#C4CBD0',
    darkSoftColor: '#30383C',
  },
};

// An editable example, not veterinary guidance.
export const STARTER_SCHEDULE: ScheduleEntry[] = [
  { id: 'starter-1', type: 'pee', minutes: 7 * 60 },
  { id: 'starter-2', type: 'meal', minutes: 7 * 60 + 15 },
  { id: 'starter-3', type: 'pee', minutes: 7 * 60 + 30 },
  { id: 'starter-4', type: 'nap', minutes: 9 * 60 },
  { id: 'starter-5', type: 'pee', minutes: 11 * 60 },
  { id: 'starter-6', type: 'meal', minutes: 12 * 60 },
  { id: 'starter-7', type: 'pee', minutes: 12 * 60 + 15 },
  { id: 'starter-8', type: 'nap', minutes: 13 * 60 },
  { id: 'starter-9', type: 'pee', minutes: 15 * 60 },
  { id: 'starter-10', type: 'meal', minutes: 17 * 60 + 30 },
  { id: 'starter-11', type: 'pee', minutes: 17 * 60 + 45 },
  { id: 'starter-12', type: 'pee', minutes: 21 * 60 + 30 },
];

export function isEventType(value: unknown): value is EventType {
  return typeof value === 'string' && eventTypes.includes(value as EventType);
}

export function isQuickEventType(value: unknown): value is QuickEventType {
  return typeof value === 'string' && quickEventTypes.includes(value as QuickEventType);
}

export function customActivityKey(label: string): `custom:${string}` {
  return `custom:${normalizeCustomLabel(label)?.toLowerCase() ?? ''}`;
}

export function activityKey(activity: Activity): ActivityKey {
  return activity.type === 'custom'
    ? customActivityKey(activity.customLabel ?? '')
    : activity.type;
}

export function sameActivity(left: Activity, right: Activity): boolean {
  return activityKey(left) === activityKey(right);
}

export function normalizeCustomActivities(value: unknown, excluded: readonly string[] = []): string[] {
  if (!Array.isArray(value)) return [];
  const byKey = new Map<string, string>();
  value.forEach((item) => {
    const label = normalizeCustomLabel(item);
    if (label && !excluded.includes(customActivityKey(label)) && !byKey.has(customActivityKey(label))) byKey.set(customActivityKey(label), label);
  });
  return [...byKey.values()];
}

export function activityFromKey(key: ActivityKey, customActivities: readonly string[]): Activity {
  if (isQuickEventType(key)) return { type: key };
  return { type: 'custom', customLabel: customActivities.find((label) => customActivityKey(label) === key) ?? key.slice(7) };
}

export function createEvent(
  type: EventType,
  source: PuppyEvent['source'] = 'app',
  at = Date.now(),
  customLabel?: string,
): PuppyEvent {
  const label = type === 'custom' ? normalizeCustomLabel(customLabel) : undefined;
  return {
    id: `${at}-${Math.random().toString(36).slice(2, 9)}`,
    type,
    at,
    ...(label ? { customLabel: label } : {}),
    source,
  };
}

export function createNapEvent(source: PuppyEvent['source'] = 'app', at = Date.now()): PuppyEvent {
  return { ...createEvent('nap', source, at), endedAt: null };
}

export function isOpenNap(event: PuppyEvent): boolean {
  // Old Puptime versions stored nap taps without endedAt. They stay historical point events.
  return event.type === 'nap' && event.endedAt === null;
}

export function latestQuickEventTimes(events: readonly PuppyEvent[]): QuickEventTimes {
  const latest: QuickEventTimes = {};
  for (const event of events) {
    if (event.type === 'custom' && !normalizeCustomLabel(event.customLabel)) continue;
    const time = Math.max(event.at, typeof event.endedAt === 'number' ? event.endedAt : event.at);
    const key = activityKey(event);
    latest[key] = Math.max(latest[key] ?? 0, time);
  }
  return latest;
}

export function eventLabel(event: PuppyEvent): string {
  return event.type === 'custom' && event.customLabel?.trim()
    ? event.customLabel.trim()
    : EVENT_META[event.type].label;
}

export function eventPastLabel(event: PuppyEvent): string {
  if (event.type === 'custom') return eventLabel(event);
  if (isOpenNap(event)) return 'Nap in progress';
  if (event.type === 'nap' && typeof event.endedAt === 'number') return 'Napped';
  if (event.type === 'nap') return 'Started a nap';
  return EVENT_META[event.type].pastLabel;
}

export function formatDuration(milliseconds: number): string {
  const minutes = Math.max(0, Math.round(milliseconds / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

export function normalizeNote(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return value.trim().slice(0, 300) || undefined;
}

export function normalizeCustomLabel(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return value.trim().slice(0, 40) || undefined;
}

export function normalizeEventTypeChange(event: PuppyEvent, requestedType: EventType): EventType {
  return event.type === 'nap' || requestedType === 'nap' ? event.type : requestedType;
}

export function replaceClockTime(value: number, hours: number, minutes: number, now = Date.now()): number {
  const next = new Date(value);
  next.setHours(hours, minutes, 0, 0);
  return Math.min(next.getTime(), now);
}

export function replaceCalendarDate(value: number, date: Date, now = Date.now()): number {
  const next = new Date(value);
  next.setFullYear(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.min(next.getTime(), now);
}

export function dateKey(value: number | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatTime(value: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(value);
}

export function formatMinutes(minutes: number): string {
  const date = new Date(2000, 0, 1, Math.floor(minutes / 60), minutes % 60);
  return formatTime(date.getTime());
}

export function relativeTime(value: number, now = Date.now()): string {
  const minutes = Math.max(0, Math.floor((now - value) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

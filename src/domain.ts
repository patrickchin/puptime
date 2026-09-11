export const eventTypes = ['pee', 'poop', 'meal', 'pottyTrip', 'walk', 'nap', 'custom'] as const;

export const quickEventTypes = ['pee', 'poop', 'meal', 'pottyTrip', 'walk', 'nap'] as const;

export type EventType = (typeof eventTypes)[number];
export type QuickEventType = (typeof quickEventTypes)[number];

export type PuppyEvent = {
  id: string;
  type: EventType;
  at: number;
  endedAt?: number | null;
  customLabel?: string;
  source: 'app' | 'widget';
};

export type ScheduleEntry = {
  id: string;
  type: EventType;
  minutes: number;
};

export const EVENT_META: Record<
  EventType,
  { label: string; pastLabel: string; icon: string; color: string; softColor: string }
> = {
  pee: {
    label: 'Pee',
    pastLabel: 'Peed',
    icon: 'water-outline',
    color: '#167A5A',
    softColor: '#DDF4E9',
  },
  poop: {
    label: 'Poop',
    pastLabel: 'Pooped',
    icon: 'emoticon-poop-outline',
    color: '#9A5A24',
    softColor: '#F6E8D8',
  },
  meal: {
    label: 'Ate',
    pastLabel: 'Ate a meal',
    icon: 'food-apple-outline',
    color: '#A43F34',
    softColor: '#FBE5E2',
  },
  pottyTrip: {
    label: 'Potty trip',
    pastLabel: 'Went out for potty',
    icon: 'door-open',
    color: '#31709B',
    softColor: '#DFEFF8',
  },
  walk: {
    label: 'Walk',
    pastLabel: 'Went for a walk',
    icon: 'walk',
    color: '#6A6422',
    softColor: '#F3F0D2',
  },
  nap: {
    label: 'Nap',
    pastLabel: 'Nap',
    icon: 'sleep',
    color: '#5C61A8',
    softColor: '#E8E7FA',
  },
  custom: {
    label: 'Other',
    pastLabel: 'Other activity',
    icon: 'tag-outline',
    color: '#626A66',
    softColor: '#E9ECEA',
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

export function createEvent(
  type: EventType,
  source: PuppyEvent['source'] = 'app',
  at = Date.now(),
  customLabel?: string,
): PuppyEvent {
  return {
    id: `${at}-${Math.random().toString(36).slice(2, 9)}`,
    type,
    at,
    ...(customLabel ? { customLabel } : {}),
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

export function normalizeBackdateMinutes(value: unknown): number {
  const minutes = Number(value);
  if (!Number.isFinite(minutes)) return 0;
  return Math.min(60, Math.max(0, Math.round(minutes / 5) * 5));
}

export function replaceClockTime(value: number, hours: number, minutes: number, now = Date.now()): number {
  const next = new Date(value);
  next.setHours(hours, minutes, 0, 0);
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

export const eventTypes = ['pee', 'poop', 'meal', 'nap'] as const;

export type EventType = (typeof eventTypes)[number];

export type PuppyEvent = {
  id: string;
  type: EventType;
  at: number;
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
    color: '#C05243',
    softColor: '#FBE5E2',
  },
  nap: {
    label: 'Nap',
    pastLabel: 'Started a nap',
    icon: 'sleep',
    color: '#5C61A8',
    softColor: '#E8E7FA',
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

export function createEvent(type: EventType, source: PuppyEvent['source'] = 'app'): PuppyEvent {
  const at = Date.now();
  return {
    id: `${at}-${Math.random().toString(36).slice(2, 9)}`,
    type,
    at,
    source,
  };
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

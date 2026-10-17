import { isEventType, type PuppyEvent } from './domain.ts';

export class EventsStorageError extends Error {
  constructor() {
    super('Saved activity data could not be read. The original data has been preserved.');
    this.name = 'EventsStorageError';
  }
}

export class EventsImportError extends Error {
  constructor() {
    super('Import would leave more than one nap in progress.');
    this.name = 'EventsImportError';
  }
}

function isTimestamp(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isInteger(value)
    && Number.isFinite(new Date(value).getTime());
}

export function assertValidEvents(value: unknown): asserts value is PuppyEvent[] {
  if (!Array.isArray(value)) throw new TypeError('Activity data must be an array.');
  const ids = new Set<string>();
  for (const event of value) {
    if (!event || typeof event !== 'object'
      || typeof event.id !== 'string' || !event.id.trim() || ids.has(event.id)
      || !isEventType(event.type) || !isTimestamp(event.at)
      || (event.source !== 'app' && event.source !== 'widget')
      || (event.note !== undefined && typeof event.note !== 'string')
      || (event.customLabel !== undefined && typeof event.customLabel !== 'string')
      || (event.estimated !== undefined && typeof event.estimated !== 'boolean')
      || (event.endedAt !== undefined && (
        event.type !== 'nap'
        || (event.endedAt !== null && (!isTimestamp(event.endedAt) || event.endedAt < event.at))
      ))) {
      throw new TypeError('Activity data contains an invalid or duplicate event.');
    }
    ids.add(event.id);
  }
}


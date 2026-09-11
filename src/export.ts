import { dateKey, eventLabel, type PuppyEvent } from './domain.ts';

const HEADERS = [
  'Date',
  'Time',
  'Activity',
  'Type',
  'Started At (ISO)',
  'Ended At (ISO)',
  'Duration Minutes',
  'Note',
  'Source',
] as const;

function localTime(value: number): string {
  const date = new Date(value);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function eventsToCsv(events: PuppyEvent[]): string {
  const rows = [...events]
    .sort((left, right) => left.at - right.at)
    .map((event) => {
      const endedAt = typeof event.endedAt === 'number' ? event.endedAt : null;
      const duration = endedAt === null ? '' : Math.max(0, Math.round((endedAt - event.at) / 60_000));

      return [
        dateKey(event.at),
        localTime(event.at),
        eventLabel(event),
        event.type,
        new Date(event.at).toISOString(),
        endedAt === null ? '' : new Date(endedAt).toISOString(),
        duration,
        event.note ?? '',
        event.source,
      ].map(csvCell).join(',');
    });

  // A UTF-8 byte-order mark helps spreadsheet apps recognize notes with non-ASCII text.
  return `\uFEFF${[HEADERS.join(','), ...rows].join('\r\n')}\r\n`;
}

import { dateKey, eventLabel, isEventType, type PuppyEvent } from './domain.ts';

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
  'ID',
  'Nap State',
  'Estimated',
  'Custom Label',
] as const;

export class CsvImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CsvImportError';
  }
}

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
        event.id,
        event.type === 'nap' ? (event.endedAt === null ? 'open' : endedAt === null ? 'point' : 'completed') : '',
        event.estimated === true ? 'true' : 'false',
        event.customLabel ?? '',
      ].map(csvCell).join(',');
    });

  // A UTF-8 byte-order mark helps spreadsheet apps recognize notes with non-ASCII text.
  return `\uFEFF${[HEADERS.join(','), ...rows].join('\r\n')}\r\n`;
}

function csvRows(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let closedQuote = false;
  const text = csv.startsWith('\uFEFF') ? csv.slice(1) : csv;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
        closedQuote = true;
      } else {
        cell += character;
      }
      continue;
    }

    if (closedQuote && character !== ',' && character !== '\r' && character !== '\n') {
      throw new CsvImportError('Unexpected text after a quoted field.');
    }
    if (character === '"') {
      if (cell !== '') throw new CsvImportError('Unexpected quote in an unquoted field.');
      quoted = true;
    } else if (character === ',') {
      row.push(cell);
      cell = '';
      closedQuote = false;
    } else if (character === '\r' || character === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      closedQuote = false;
      if (character === '\r' && text[index + 1] === '\n') index += 1;
    } else {
      cell += character;
    }
  }
  if (quoted) throw new CsvImportError('Unclosed quoted field.');
  if (row.length || cell !== '' || closedQuote) rows.push([...row, cell]);
  return rows;
}

function isoTimestamp(value: string, row: number): number {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) {
    throw new CsvImportError(`Invalid ISO timestamp on row ${row}.`);
  }
  return timestamp;
}

export function csvToEvents(csv: string): PuppyEvent[] {
  const [headers, ...rows] = csvRows(csv);
  if (!headers || headers.length !== HEADERS.length || HEADERS.some((header, index) => headers[index] !== header)) {
    throw new CsvImportError('This file does not have the Puptime activity CSV headers.');
  }

  const ids = new Set<string>();
  return rows.map((row, index) => {
    const rowNumber = index + 2;
    if (row.length !== HEADERS.length) throw new CsvImportError(`Wrong number of fields on row ${rowNumber}.`);
    const [, , , type, startedAt, endedAt, , note, source, id, napState, estimated, customLabel] = row;
    if (!id.trim() || id !== id.trim() || ids.has(id)) {
      throw new CsvImportError(`Missing or duplicate event ID on row ${rowNumber}.`);
    }
    if (!isEventType(type) || (source !== 'app' && source !== 'widget')) {
      throw new CsvImportError(`Invalid activity type or source on row ${rowNumber}.`);
    }
    if (estimated !== 'true' && estimated !== 'false') {
      throw new CsvImportError(`Invalid estimated flag on row ${rowNumber}.`);
    }
    if (note.length > 300 || customLabel.length > 40) {
      throw new CsvImportError(`Note or custom label is too long on row ${rowNumber}.`);
    }

    const at = isoTimestamp(startedAt, rowNumber);
    const event: PuppyEvent = {
      id,
      type,
      at,
      source,
      ...(note ? { note } : {}),
      ...(customLabel ? { customLabel } : {}),
      ...(estimated === 'true' ? { estimated: true } : {}),
    };
    if (type === 'nap') {
      if (napState === 'open' && endedAt === '') event.endedAt = null;
      else if (napState === 'completed' && endedAt !== '') {
        event.endedAt = isoTimestamp(endedAt, rowNumber);
        if (event.endedAt < at) throw new CsvImportError(`Nap ends before it starts on row ${rowNumber}.`);
      } else if (napState !== 'point' || endedAt !== '') {
        throw new CsvImportError(`Invalid nap state on row ${rowNumber}.`);
      }
    } else if (napState !== '' || endedAt !== '') {
      throw new CsvImportError(`Non-nap activity has a nap state or end time on row ${rowNumber}.`);
    }
    ids.add(id);
    return event;
  });
}

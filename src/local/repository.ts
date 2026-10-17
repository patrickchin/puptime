import { isOpenNap, type PuppyEvent, type PuppyEventChanges, type ScheduleEntry } from '../domain.ts';
import { assertValidEvents, EventsImportError, EventsStorageError } from '../storage-validation.ts';
import { assertValidSchedule } from './legacy.ts';
import type { LocalDatabase, SqlExecutor } from './database.ts';

type EventRow = { id: string; at: number; body: string; event: PuppyEvent };
export function createLocalRepository(database: LocalDatabase, petId: string) {
  const cache = new Map<string, { body: string; event: PuppyEvent }>();
  async function requirePet(sql: SqlExecutor) {
    if (!await sql.getFirstAsync('SELECT id FROM puppies WHERE id=?', petId)) throw new Error('The local puppy could not be found.');
  }
  async function readEvents(sql: SqlExecutor): Promise<EventRow[]> {
    await requirePet(sql);
    const rows = await sql.getAllAsync<{ id: string; at: number; body: string }>('SELECT id,at,body FROM events WHERE pet_id=? ORDER BY at DESC,rowid ASC', petId);
    try {
      const events: unknown = rows.map((row) => JSON.parse(row.body));
      assertValidEvents(events);
      if (events.some((event, index) => event.id !== rows[index].id || event.at !== rows[index].at)) throw new Error('Inconsistent activity index.');
      return rows.map((row, index) => ({ ...row, event: events[index] }));
    } catch { throw new EventsStorageError(); }
  }
  function materialize(rows: EventRow[]): PuppyEvent[] {
    const present = new Set(rows.map((row) => row.id));
    for (const id of cache.keys()) if (!present.has(id)) cache.delete(id);
    return rows.map((row) => {
      const previous = cache.get(row.id);
      if (previous?.body === row.body) return previous.event;
      cache.set(row.id, { body: row.body, event: row.event });
      return row.event;
    });
  }
  async function mutateEvents<T>(action: (events: PuppyEvent[]) => { events: PuppyEvent[]; value: T }) {
    const committed = await database.write(async (sql) => {
      const rows = await readEvents(sql);
      const result = action(rows.map((row) => row.event));
      assertValidEvents(result.events);
      const previous = new Map(rows.map((row) => [row.id, row.body]));
      const next = new Map(result.events.map((event) => [event.id, event]));
      for (const row of rows) if (!next.has(row.id)) await sql.runAsync('DELETE FROM events WHERE pet_id=? AND id=?', petId, row.id);
      const sorted = [...result.events].sort((a, b) => b.at - a.at);
      const saved: EventRow[] = [];
      for (const event of sorted) {
        const body = JSON.stringify(event);
        if (previous.get(event.id) !== body) await sql.runAsync('INSERT INTO events(pet_id,id,at,body) VALUES (?,?,?,?) ON CONFLICT(pet_id,id) DO UPDATE SET at=excluded.at,body=excluded.body', petId, event.id, event.at, body);
        saved.push({ id: event.id, at: event.at, body, event });
      }
      return { rows: saved, value: result.value };
    });
    return { events: materialize(committed.rows), value: committed.value };
  }
  async function readSchedule(sql: SqlExecutor): Promise<ScheduleEntry[]> {
    await requirePet(sql);
    const rows = await sql.getAllAsync<{ id: string; minutes: number; body: string }>('SELECT id,minutes,body FROM routines WHERE pet_id=? ORDER BY minutes,rowid', petId);
    const entries: unknown = rows.map((row) => JSON.parse(row.body));
    assertValidSchedule(entries);
    if (entries.some((entry, index) => entry.id !== rows[index].id || entry.minutes !== rows[index].minutes)) throw new Error('The saved routine index is inconsistent.');
    return entries;
  }
  const updateEvent = async (id: string, changes: PuppyEventChanges): Promise<PuppyEvent[]> => (await mutateEvents((events) => ({
    events: events.map((event) => event.id === id ? { ...event, ...changes, ...(event.estimated ? { estimated: true } : {}) } : event), value: undefined,
  }))).events;
  return {
    async loadEvents() { return materialize(await database.read(readEvents)); },
    async appendEvents(incoming: PuppyEvent[]) {
      assertValidEvents(incoming);
      return (await mutateEvents((events) => {
        const byId = new Map(events.map((event) => [event.id, event]));
        for (const event of incoming) byId.set(event.id, { ...byId.get(event.id), ...event, ...(byId.get(event.id)?.estimated ? { estimated: true } : {}) });
        return { events: [...byId.values()], value: undefined };
      })).events;
    },
    async importEvents(incoming: PuppyEvent[]) {
      assertValidEvents(incoming);
      const result = await mutateEvents((events) => {
        const ids = new Set(events.map((event) => event.id));
        const additions = incoming.filter((event) => !ids.has(event.id));
        const merged = [...events, ...additions];
        if (merged.filter(isOpenNap).length > 1) throw new EventsImportError();
        return { events: merged, value: { imported: additions.length, skipped: incoming.length - additions.length } };
      });
      return { events: result.events, ...result.value };
    },
    updateEvent,
    updateEventTime: (id: string, at: number) => updateEvent(id, { at }),
    async removeEvent(id: string) { return (await mutateEvents((events) => ({ events: events.filter((event) => event.id !== id), value: undefined }))).events; },
    loadSchedule: () => database.read(readSchedule),
    async saveSchedule(entries: ScheduleEntry[]) {
      assertValidSchedule(entries);
      await database.write(async (sql) => {
        const previous = new Map((await readSchedule(sql)).map((entry) => [entry.id, JSON.stringify(entry)]));
        const ids = new Set(entries.map((entry) => entry.id));
        for (const id of previous.keys()) if (!ids.has(id)) await sql.runAsync('DELETE FROM routines WHERE pet_id=? AND id=?', petId, id);
        for (const entry of entries) {
          const body = JSON.stringify(entry);
          if (previous.get(entry.id) !== body) await sql.runAsync('INSERT INTO routines(pet_id,id,minutes,body) VALUES (?,?,?,?) ON CONFLICT(pet_id,id) DO UPDATE SET minutes=excluded.minutes,body=excluded.body', petId, entry.id, entry.minutes, body);
        }
      });
    },
  };
}

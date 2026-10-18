import { isOpenNap, type PuppyEvent, type PuppyEventChanges, type ScheduleEntry } from '../domain.ts';
import {parseEvents,parseSchedule,EventDeletedError,EventsImportError,EventsStorageError} from '../storage-validation.ts';
import type { LocalDatabase, SqlExecutor } from './database.ts';
import { applyScheduleEntryEdit } from '../schedule-editor.ts';
import { localChanges, notifyLocalCommit, readLocalSettingsRecords, type LocalChangeSink } from './sync-projection.ts';

type EventRow = { id: string; at: number; body: string; event: PuppyEvent };
export function createLocalRepository(database: LocalDatabase, petId: string, onChange?: LocalChangeSink, afterCommit?:()=>void) {
  const cache = new Map<string, { body: string; event: PuppyEvent }>();
  async function requirePet(sql: SqlExecutor) {
    if (!await sql.getFirstAsync('SELECT id FROM puppies WHERE id=?', petId)) throw new Error('The local puppy could not be found.');
  }
  async function readEvents(sql: SqlExecutor): Promise<EventRow[]> {
    await requirePet(sql);
    const rows = await sql.getAllAsync<{ id: string; at: number; body: string }>('SELECT id,at,body FROM events WHERE pet_id=? ORDER BY at DESC,rowid ASC', petId);
    try {
      const events = parseEvents(rows.map((row) => JSON.parse(row.body)));
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
    let changed=false;
    const committed = await database.write(async (sql) => {
      const rows = await readEvents(sql);
      const beforeSettings=(onChange||afterCommit)?await readLocalSettingsRecords(sql,petId):[];
      const result = action(rows.map((row) => row.event));
      result.events=parseEvents(result.events);
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
      if (onChange||afterCommit) {
        const records = (events: PuppyEvent[]) => events.map(({id,...data})=>({kind:'event' as const,localId:id,data}));
        const changes=localChanges([...records(rows.map(row=>row.event)),...beforeSettings],[...records(result.events),...await readLocalSettingsRecords(sql,petId)]);
        if (changes.length) {await onChange?.(sql,changes);changed=true;}
      }
      return { rows: saved, value: result.value };
    });
    if (changed) notifyLocalCommit(afterCommit);
    return { events: materialize(committed.rows), value: committed.value };
  }
  async function readSchedule(sql: SqlExecutor): Promise<ScheduleEntry[]> {
    await requirePet(sql);
    const rows = await sql.getAllAsync<{ id: string; minutes: number; body: string }>('SELECT id,minutes,body FROM routines WHERE pet_id=? ORDER BY minutes,rowid', petId);
    const entries=parseSchedule(rows.map((row) => JSON.parse(row.body)));
    if (entries.some((entry, index) => entry.id !== rows[index].id || entry.minutes !== rows[index].minutes)) throw new Error('The saved routine index is inconsistent.');
    return entries;
  }
  const updateEvent = async (id: string, changes: PuppyEventChanges): Promise<PuppyEvent[]> => (await mutateEvents((events) => {
    if (!events.some(event => event.id === id)) throw new EventDeletedError();
    return { events: events.map((event) => event.id === id ? { ...event, ...changes, ...(event.estimated ? { estimated: true } : {}) } : event), value: undefined };
  })).events;
  async function mutateSchedule(action:(current:ScheduleEntry[])=>ScheduleEntry[]):Promise<ScheduleEntry[]> {
    let changed=false;
    const saved=await database.write(async sql=>{
      const before=await readSchedule(sql),entries=parseSchedule(action(before));
      const previous=new Map(before.map(entry=>[entry.id,JSON.stringify(entry)]));
      const ids=new Set(entries.map(entry=>entry.id));
      for(const id of previous.keys())if(!ids.has(id))await sql.runAsync('DELETE FROM routines WHERE pet_id=? AND id=?',petId,id);
      for(const entry of entries){
        const body=JSON.stringify(entry);
        if(previous.get(entry.id)!==body)await sql.runAsync('INSERT INTO routines(pet_id,id,minutes,body) VALUES (?,?,?,?) ON CONFLICT(pet_id,id) DO UPDATE SET minutes=excluded.minutes,body=excluded.body',petId,entry.id,entry.minutes,body);
      }
      if(onChange||afterCommit){
        const records=(values:ScheduleEntry[])=>values.map(({id,...data})=>({kind:'routine' as const,localId:id,data}));
        const changes=localChanges(records(before),records(entries));
        if(changes.length){await onChange?.(sql,changes);changed=true;}
      }
      return entries;
    });
    if(changed)notifyLocalCommit(afterCommit);return saved;
  }
  return {
    async readEventsInTransaction(sql: SqlExecutor) { return (await readEvents(sql)).map((row) => row.event); },
    async loadEvents() { return materialize(await database.read(readEvents)); },
    async appendEvents(incoming: PuppyEvent[]) {
      incoming=parseEvents(incoming);
      return (await mutateEvents((events) => {
        const byId = new Map(events.map((event) => [event.id, event]));
        for (const event of incoming) byId.set(event.id, { ...byId.get(event.id), ...event, ...(byId.get(event.id)?.estimated ? { estimated: true } : {}) });
        return { events: [...byId.values()], value: undefined };
      })).events;
    },
    async importEvents(incoming: PuppyEvent[]) {
      incoming=parseEvents(incoming);
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
      await mutateSchedule(()=>entries);
    },
    saveScheduleEntry:(entry:ScheduleEntry,original?:ScheduleEntry)=>mutateSchedule(current=>applyScheduleEntryEdit(current,entry,original)),
    removeScheduleEntry:(id:string)=>mutateSchedule(current=>current.filter(entry=>entry.id!==id)),
  };
}

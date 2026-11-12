import {createNapEvent,isOpenNap,resolveNapState,inferNapEnds,NapConflictError,type EventWriteOptions, type PuppyEvent, type PuppyEventChanges, type ScheduleEntry } from '../domain.ts';
import { parseEvents, parseSchedule, EventDeletedError, EventsImportError, EventsStorageError } from '../storage-validation.ts';
import type { LocalDatabase, SqlExecutor } from './database.ts';
import { applyScheduleEntryEdit } from '../schedule-editor.ts';
import { localChanges, notifyLocalCommit, retainCustomActivities, type LocalChange, type LocalChangeSink } from './sync-projection.ts';
import { localIdSchema } from '../cloud/protocol.ts';
import { eventDataFromSql, routineDataFromSql, eventSqlValues, routineSqlValues, upsertEventSql, upsertRoutineSql, type EventSqlRow, type RoutineSqlRow } from '../record-sql.ts';
import type { BackupGuard } from './activity-backups.ts';

type EventRow = { id: string; at: number; body: string; event: PuppyEvent };
const records=(kind:'event'|'routine',value:PuppyEvent|ScheduleEntry|null)=>{
  if (!value) return [];
  const {id,...data}=value;return [{kind,localId:id,data}];
};
export async function writeEventRecord(sql:SqlExecutor,petId:string,before:PuppyEvent|null,after:PuppyEvent|null):Promise<LocalChange[]> {
  const changes=localChanges(records('event',before),records('event',after));
  if (!changes.length) return [];
  if (after) await sql.runAsync(upsertEventSql,petId,after.id,...eventSqlValues(after));
  else await sql.runAsync('DELETE FROM events WHERE pet_id=? AND id=?',petId,before!.id);
  return changes;
}
// Shared by CSV imports and recovery, inside the caller's transaction.
export async function importEventRecords(sql:SqlExecutor,petId:string,incoming:PuppyEvent[]) {
  const changes:LocalChange[]=[];let imported=0;
  for (const event of incoming) {
    if (await sql.getFirstAsync('SELECT id FROM events WHERE pet_id=? AND id=?',petId,event.id)) continue;
    changes.push(...await writeEventRecord(sql,petId,null,event));imported++;
  }
  const open=await sql.getAllAsync("SELECT id FROM events WHERE pet_id=? AND type='nap' AND end_state=1 LIMIT 2",petId);
  if (open.length>1) throw new EventsImportError();
  const labels=changes.flatMap(change=>change.after?.type==='custom'?[String(change.after.customLabel)]:[]);
  changes.push(...await retainCustomActivities(sql,petId,labels));
  return {changes,value:{imported,skipped:incoming.length-imported}};
}
export function createLocalRepository(database: LocalDatabase, petId: string, onChange?: LocalChangeSink, afterCommit?:()=>void, beforeChange?:BackupGuard) {
  const cache = new Map<string, { body: string; event: PuppyEvent }>();
  async function requirePet(sql: SqlExecutor) {
    if (!await sql.getFirstAsync('SELECT id FROM puppies WHERE id=?', petId)) throw new Error('The local puppy could not be found.');
  }
  function eventFromRow(row: EventSqlRow & {id:string}):PuppyEvent {
    try { return {id:localIdSchema.parse(row.id),...eventDataFromSql(row)}; }
    catch { throw new EventsStorageError(); }
  }
  async function readEvent(sql:SqlExecutor,id:string) {
    const row=await sql.getFirstAsync<EventSqlRow&{id:string}>('SELECT * FROM events WHERE pet_id=? AND id=?',petId,localIdSchema.parse(id));
    return row?eventFromRow(row):null;
  }
  async function readEvents(sql: SqlExecutor): Promise<EventRow[]> {
    await requirePet(sql);
    const rows=await sql.getAllAsync<EventSqlRow&{id:string}>('SELECT * FROM events WHERE pet_id=? ORDER BY at DESC,id DESC',petId);
    return rows.map(row=>{const event=eventFromRow(row);return {id:event.id,at:event.at,body:JSON.stringify(event),event};});
  }
  function materialize(rows: EventRow[]): PuppyEvent[] {
    const present = new Set(rows.map(row=>row.id));
    for (const id of cache.keys()) if (!present.has(id)) cache.delete(id);
    return rows.map(row=>{
      const previous=cache.get(row.id);
      if (previous?.body===row.body) return previous.event;
      cache.set(row.id,{body:row.body,event:row.event});return row.event;
    });
  }
  async function commit<T>(action:(sql:SqlExecutor)=>Promise<{changes:LocalChange[];value:T}>):Promise<T> {
    let changed=false;
    const result=await database.write(async sql=>{
      await requirePet(sql);
      const result=await action(sql);
      if (result.changes.length) {await onChange?.(sql,result.changes);changed=true;}
      return result.value;
    });
    if (changed) notifyLocalCommit(afterCommit);
    return result;
  }
  async function writeEvent(sql:SqlExecutor,before:PuppyEvent|null,after:PuppyEvent|null,preserveConflict=false):Promise<LocalChange[]> {
    if(!preserveConflict&&after&&isOpenNap(after)&&(!before||!isOpenNap(before))) {
      const other=await sql.getFirstAsync("SELECT id FROM events WHERE pet_id=? AND type='nap' AND end_state=1 AND id!=? LIMIT 1",petId,after.id);
      if(other)throw new NapConflictError();
    }
    return writeEventRecord(sql,petId,before,after);
  }
  async function eventLabels(sql:SqlExecutor,changes:LocalChange[],options:EventWriteOptions={}) {
    const labels=changes.flatMap(change=>change.after?.type==='custom'?[String(change.after.customLabel)]:[]);
    return [...changes,...await retainCustomActivities(sql,petId,labels,options.restoreCustomActivities)];
  }
  async function appendEvents(incoming:PuppyEvent[],options:EventWriteOptions={},preserveConflict=false):Promise<void> {
    incoming=parseEvents(incoming);
    await commit(async sql=>{
      const changes:LocalChange[]=[];
      for(const event of incoming) {
        const before=await readEvent(sql,event.id);
        const [after]=parseEvents([{...before,...event,...(before?.estimated?{estimated:true}:{})}]);
        changes.push(...await writeEvent(sql,before,after,preserveConflict));
      }
      return {changes:await eventLabels(sql,changes,options),value:undefined};
    });
  }
  async function updateEvent(id:string,changes:PuppyEventChanges,options:EventWriteOptions={}):Promise<void> {
    await commit(async sql=>{
      const before=await readEvent(sql,id);
      if (!before) throw new EventDeletedError();
      const [after]=parseEvents([{...before,...changes,...(before.estimated?{estimated:true}:{})}]);
      return {changes:await eventLabels(sql,await writeEvent(sql,before,after),options),value:undefined};
    });
  }
  function routineFromRow(row:RoutineSqlRow&{id:string}):ScheduleEntry {return {id:localIdSchema.parse(row.id),...routineDataFromSql(row)};}
  async function readRoutine(sql:SqlExecutor,id:string) {
    const row=await sql.getFirstAsync<RoutineSqlRow&{id:string}>('SELECT * FROM routines WHERE pet_id=? AND id=?',petId,localIdSchema.parse(id));
    return row?routineFromRow(row):null;
  }
  async function readSchedule(sql: SqlExecutor): Promise<ScheduleEntry[]> {
    await requirePet(sql);
    return (await sql.getAllAsync<RoutineSqlRow&{id:string}>('SELECT * FROM routines WHERE pet_id=? ORDER BY minutes,id',petId)).map(routineFromRow);
  }
  async function writeRoutine(sql:SqlExecutor,before:ScheduleEntry|null,after:ScheduleEntry|null):Promise<LocalChange[]> {
    const changes=localChanges(records('routine',before),records('routine',after));
    if (!changes.length) return [];
    if (after) await sql.runAsync(upsertRoutineSql,petId,after.id,...routineSqlValues(after));
    else await sql.runAsync('DELETE FROM routines WHERE pet_id=? AND id=?',petId,before!.id);
    return changes;
  }
  return {
    async reconcileNaps():Promise<PuppyEvent[]> {
      return commit(async sql=>{
        const rows=await sql.getAllAsync<EventSqlRow&{id:string}>("SELECT * FROM events WHERE pet_id=? AND type='nap' AND end_state=1 ORDER BY at,id",petId);
        if(rows.length<2)return {changes:[],value:[]};
        if(await sql.getFirstAsync("SELECT value FROM metadata WHERE key='care_blocked' AND value='1'"))return {changes:[],value:[]};
        const open=rows.map(eventFromRow),candidates=[...open];
        for(let index=0;index<open.length-1;index++) {
          const awake=await sql.getFirstAsync<EventSqlRow&{id:string}>("SELECT * FROM events WHERE pet_id=? AND at>? AND at<=? AND (type IN ('pee','poop','meal','pottyTrip','walk') OR (type='nap' AND end_state!=1)) AND estimated IS NOT 1 ORDER BY at,id LIMIT 1",petId,open[index].at,open[index+1].at);
          if(awake)candidates.push(eventFromRow(awake));
        }
        const changes:LocalChange[]=[],corrected:PuppyEvent[]=[];
        for(const event of inferNapEnds(candidates)) {
          const locked=await sql.getFirstAsync("SELECT record_id FROM local_sync_records WHERE json_extract(body,'$.kind')='event' AND json_extract(record_id,'$[2]')=? AND json_extract(body,'$.editable')=0",event.id);
          if(locked)continue;
          changes.push(...await writeEvent(sql,open.find(nap=>nap.id===event.id)!,event));
          corrected.push(event);
        }
        return {changes,value:corrected};
      });
    },
    async toggleNap(source:PuppyEvent['source'],at=Date.now()):Promise<{event:PuppyEvent;previous?:PuppyEvent}> {
      return commit(async sql=>{
        const rows=await sql.getAllAsync<EventSqlRow&{id:string}>("SELECT * FROM events WHERE pet_id=? AND type='nap' AND end_state=1 LIMIT 2",petId);
        const state=resolveNapState(rows.map(eventFromRow));
        if(state.kind==='conflict')throw new NapConflictError();
        const previous=state.kind==='running'?state.event:undefined;
        const event=previous?{...previous,endedAt:Math.max(previous.at,at)}:createNapEvent(source,at);
        return {changes:await writeEvent(sql,previous??null,event),value:{event,...(previous?{previous}:{})}};
      });
    },
    async loadEvents() { return materialize(await database.read(readEvents)); },
    appendEvents:(incoming:PuppyEvent[],options?:EventWriteOptions)=>appendEvents(incoming,options),
    appendWidgetEvents(incoming:PuppyEvent[]):Promise<void> {
      // The extension committed these logs independently. Retain all of them
      // so foreground reconciliation can infer earlier end times without losing logs.
      if(incoming.some(event=>event.source!=='widget'))throw new Error('Expected committed widget events.');
      return appendEvents(incoming,{},true);
    },
    async importEvents(incoming:PuppyEvent[]):Promise<{imported:number;skipped:number}> {
      incoming=parseEvents(incoming);
      return commit(async sql=>{
        if (incoming.length) await beforeChange?.(sql,'import');
        return importEventRecords(sql,petId,incoming);
      });
    },
    updateEvent,
    updateEventTime:(id:string,at:number)=>updateEvent(id,{at}),
    async removeEvent(id:string):Promise<void> {
      await commit(async sql=>{
        const before=await readEvent(sql,id);
        if(before)await beforeChange?.(sql,'delete');
        return {changes:await writeEvent(sql,before,null),value:undefined};
      });
    },
    loadSchedule:()=>database.read(readSchedule),
    async saveSchedule(entries:ScheduleEntry[]):Promise<void> {
      entries=parseSchedule(entries);
      await commit(async sql=>{
        const previous=new Map((await readSchedule(sql)).map(entry=>[entry.id,entry]));
        const next=new Map(entries.map(entry=>[entry.id,entry])),changes:LocalChange[]=[];
        for (const [id,entry] of previous) if (!next.has(id)) changes.push(...await writeRoutine(sql,entry,null));
        for (const entry of entries) changes.push(...await writeRoutine(sql,previous.get(entry.id)??null,entry));
        return {changes,value:undefined};
      });
    },
    async saveScheduleEntry(entry:ScheduleEntry,original?:ScheduleEntry):Promise<void> {
      await commit(async sql=>{
        const before=await readRoutine(sql,entry.id);
        const [after]=parseSchedule(applyScheduleEntryEdit(before?[before]:[],entry,original));
        return {changes:await writeRoutine(sql,before,after),value:undefined};
      });
    },
    async removeScheduleEntry(id:string):Promise<void> {
      await commit(async sql=>({changes:await writeRoutine(sql,await readRoutine(sql,id),null),value:undefined}));
    },
  };
}

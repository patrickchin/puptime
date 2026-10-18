import {z} from 'zod';
import {activityMonthDate,type MonthlyActivityStat} from '../analytics.ts';
import {eventDataSchema,localIdSchema} from '../cloud/protocol.ts';
import {activityKey,type PuppyEvent} from '../domain.ts';
import {eventDataFromSql,type EventSqlRow} from '../record-sql.ts';
import {EventsStorageError} from '../storage-validation.ts';
import type {LocalDatabase} from './database.ts';

export type ActivityCursor={at:number;id:string};
export type ActivityPage={events:PuppyEvent[];next:ActivityCursor|null};
type Row=EventSqlRow&{id:string};
const timestamp=eventDataSchema.shape.at;
const pageOptions=z.strictObject({before:z.strictObject({at:timestamp,id:localIdSchema}).optional(),limit:z.number().int().min(1).max(1000).default(200)});
const lastInstant=8640000000000000;
const windowEnd=z.number().int().min(-lastInstant).max(lastInstant+1);

export function createActivityQueries(database:LocalDatabase,petId:string){
 const cache=new Map<string,{body:string;event:PuppyEvent}>();
 function materialize(row:Row):PuppyEvent {
  let event:PuppyEvent;
  try{event={id:localIdSchema.parse(row.id),...eventDataFromSql(row)};}catch{throw new EventsStorageError();}
  const body=JSON.stringify(event),previous=cache.get(event.id);
  cache.delete(event.id);cache.set(event.id,{body,event:previous?.body===body?previous.event:event});
  if(cache.size>2048)cache.delete(cache.keys().next().value!);
  return cache.get(event.id)!.event;
 }
 return {
  async getEvent(id:string):Promise<PuppyEvent|null>{
   id=localIdSchema.parse(id);
   return database.read(async sql=>{const row=await sql.getFirstAsync<Row>('SELECT * FROM events WHERE pet_id=? AND id=?',petId,id);if(!row){cache.delete(id);return null;}return materialize(row);});
  },
  async eventsPage(options:{before?:ActivityCursor;limit?:number}={}):Promise<ActivityPage>{
   const {before,limit}=pageOptions.parse(options);
   return database.read(async sql=>{
    const rows=before
     ?await sql.getAllAsync<Row>('SELECT * FROM events WHERE pet_id=? AND (at,id)<(?,?) ORDER BY at DESC,id DESC LIMIT ?',petId,before.at,before.id,limit+1)
     :await sql.getAllAsync<Row>('SELECT * FROM events WHERE pet_id=? ORDER BY at DESC,id DESC LIMIT ?',petId,limit+1);
    const events=rows.slice(0,limit).map(materialize),last=events.at(-1);
    return {events,next:rows.length>limit&&last?{at:last.at,id:last.id}:null};
   });
  },
  async eventsBetween(from:number,until:number):Promise<PuppyEvent[]>{
   timestamp.parse(from);windowEnd.parse(until);if(until<from)throw new TypeError('Invalid activity date window.');if(until===from)return [];
   return database.read(async sql=>(await sql.getAllAsync<Row>(`SELECT * FROM events WHERE pet_id=? AND at>=? AND at<?
    UNION ALL SELECT * FROM events WHERE pet_id=? AND type='nap' AND end_state=1 AND at<?
    UNION ALL SELECT * FROM events INDEXED BY events_closed_nap WHERE pet_id=? AND type='nap' AND end_state=2 AND ended_at>? AND at<?
    ORDER BY at DESC,id DESC`,petId,from,until,petId,from,petId,from,from)).map(materialize));
  },
  async latestEvents():Promise<PuppyEvent[]>{
   return database.read(async sql=>{
    const groups=await sql.getAllAsync<{type:string;custom_label:string|null}>('SELECT DISTINCT type,custom_label FROM events WHERE pet_id=? AND estimated IS NOT 1',petId);
    const latest=new Map<string,PuppyEvent>();
    for(const group of groups){
     const row=await sql.getFirstAsync<Row>('SELECT * FROM events WHERE pet_id=? AND type=? AND custom_label IS ? AND estimated IS NOT 1 ORDER BY MAX(at,COALESCE(ended_at,at)) DESC,id DESC LIMIT 1',petId,group.type,group.custom_label);
     if(!row)continue;const event=materialize(row),key=activityKey(event),previous=latest.get(key);
     if(!previous||(event.endedAt??event.at)>(previous.endedAt??previous.at))latest.set(key,event);
    }
    const open=await sql.getFirstAsync<Row>("SELECT * FROM events WHERE pet_id=? AND type='nap' AND end_state=1 ORDER BY at DESC,id DESC LIMIT 1",petId);
    const events=[...latest.values()];if(open&&!events.some(event=>event.id===open.id))events.push(materialize(open));return events;
   });
  },
  async summary():Promise<{eventCount:number;earliestAt:number|null}>{
   return database.read(async sql=>{const row=(await sql.getFirstAsync<{eventCount:number;earliestAt:number|null}>('SELECT COUNT(*) eventCount,MIN(at) earliestAt FROM events WHERE pet_id=?',petId))!;return {eventCount:row.eventCount,earliestAt:row.earliestAt};});
  },
  async monthlyStats():Promise<MonthlyActivityStat[]>{
   // Use native calendar boundaries, including DST and the full Date range.
   // The read transaction keeps all month/day aggregates on one SQLite snapshot.
   return database.write(async sql=>{
    const months:MonthlyActivityStat[]=[];
    let first=await sql.getFirstAsync<{at:number}>('SELECT at FROM events WHERE pet_id=? ORDER BY at LIMIT 1',petId);
    while(first){
     const date=new Date(first.at),year=date.getFullYear(),month=date.getMonth();
     function boundary(month:number){const value=new Date(0);value.setFullYear(year,month,1);value.setHours(0,0,0,0);return value.getTime();}
     const start=boundary(month),end=boundary(month+1);
     const from=Number.isFinite(start)?start:-lastInstant,until=Number.isFinite(end)?end:lastInstant+1;
     const ranges:number[][]=[];
     for(let cursor=from;cursor<until;){
      const next=new Date(cursor);next.setDate(next.getDate()+1);next.setHours(0,0,0,0);
      const finish=Number.isFinite(next.getTime())?Math.min(until,next.getTime()):until;
      if(finish<=cursor)throw new EventsStorageError();ranges.push([cursor,finish]);cursor=finish;
     }
     const aggregate=(await sql.getFirstAsync<{total:number;estimatedTotal:number;recordedDays:number}>(`WITH days(start,finish) AS (VALUES ${ranges.map(()=>'(?,?)').join(',')}), counts AS (
      SELECT days.start,SUM(estimated IS NOT 1) total,SUM(estimated IS 1) estimatedTotal
      FROM days JOIN events ON events.pet_id=? AND at>=days.start AND at<days.finish GROUP BY days.start
     ) SELECT COALESCE(SUM(total),0) total,COALESCE(SUM(estimatedTotal),0) estimatedTotal,COALESCE(SUM(total>0),0) recordedDays FROM counts`,...ranges.flat(),petId))!;
     const {total,estimatedTotal,recordedDays}=aggregate;
     months.push({key:year+'-'+String(month+1).padStart(2,'0'),date:activityMonthDate(first.at),total,estimatedTotal,recordedDays,averagePerRecordedDay:recordedDays?total/recordedDays:0});
     first=await sql.getFirstAsync<{at:number}>('SELECT at FROM events WHERE pet_id=? AND at>=? ORDER BY at LIMIT 1',petId,until);
    }
    return months.sort((a,b)=>b.date.getTime()-a.date.getTime());
   });
  },
 };
}
export type ActivityQueries=ReturnType<typeof createActivityQueries>;

import {z} from 'zod';
import {cloudRecordSchema,eventDataSchema,identifierSchema,localIdSchema} from '../cloud/protocol.ts';
import {cloudRecordId} from '../cloud/record-identity.ts';
import {EventHistoryError,type EventHistoryEntry,type EventHistoryHead,type EventHistoryPage} from '../event-history.ts';
import {eventDataFromSql,type EventSqlRow} from '../record-sql.ts';
import type {LocalDatabase,SqlExecutor} from './database.ts';

const sequence=z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const optionsSchema=z.strictObject({before:sequence.optional(),limit:z.number().int().min(1).max(50).default(50)});
type PageOptions={before?:number;limit?:number};
const rowSchema=z.strictObject({
 sequence,local_id:localIdSchema,created_at:eventDataSchema.shape.at,
 source:z.enum(['local','enrollment','cloud','restore']),before_data:z.string().nullable(),after_data:z.string().nullable(),
});
type Row=z.infer<typeof rowSchema>;
const columns='sequence,local_id,created_at,source,before_data,after_data';
function entry(row:Row):EventHistoryEntry {
 try{
  const value=rowSchema.parse(row);
  const snapshot=(raw:string|null)=>raw===null?null:{id:value.local_id,...eventDataSchema.parse(JSON.parse(raw))};
  const before=snapshot(value.before_data),after=snapshot(value.after_data);
  if(before===null&&after===null)throw new EventHistoryError();
  return {eventId:value.local_id,sequence:value.sequence,createdAt:value.created_at,source:value.source,before,after};
 }catch{throw new EventHistoryError();}
}

export async function readEventHistoryEntry(sql:SqlExecutor,petId:string,eventId:string,revision:number):Promise<EventHistoryEntry|null>{
 identifierSchema.parse(petId);localIdSchema.parse(eventId);sequence.parse(revision);
 const row=await sql.getFirstAsync<Row>(`SELECT ${columns} FROM local_revisions WHERE pet_id=? AND kind='event' AND local_id=? AND sequence=?`,petId,eventId,revision);
 return row?entry(row):null;
}

export async function readEventHistoryHead(sql:SqlExecutor,petId:string,eventId:string):Promise<EventHistoryHead>{
 identifierSchema.parse(petId);localIdSchema.parse(eventId);
 const latest=await sql.getFirstAsync<Row>(`SELECT ${columns} FROM local_revisions WHERE pet_id=? AND kind='event' AND local_id=? ORDER BY sequence DESC LIMIT 1`,petId,eventId);
 const eventRow=await sql.getFirstAsync<EventSqlRow>('SELECT * FROM events WHERE pet_id=? AND id=?',petId,eventId);
 const ownerRow=await sql.getFirstAsync<{generation:string;account_id:string}>('SELECT generation,account_id FROM local_sync_owner WHERE singleton=1');
 try{
  const head:EventHistoryHead={sequence:latest?entry(latest).sequence:null,event:eventRow?{id:eventId,...eventDataFromSql(eventRow)}:null,owner:ownerRow?{generation:identifierSchema.parse(ownerRow.generation),accountId:identifierSchema.parse(ownerRow.account_id)}:null,cloudRecord:null};
  if(head.owner){
   const binding=await sql.getFirstAsync<{generation:string;cloud_pet_id:string|null;status:string}>('SELECT generation,cloud_pet_id,status FROM local_sync_pets WHERE pet_id=?',petId);
   if(binding){
    if(binding.generation!==head.owner.generation||!['active','preparing'].includes(binding.status))throw new EventHistoryError();
    if(binding.status==='active'){
     const cloudPetId=identifierSchema.parse(binding.cloud_pet_id),id=cloudRecordId('event',cloudPetId,eventId);
     const saved=await sql.getFirstAsync<{body:string}>('SELECT body FROM local_sync_records WHERE generation=? AND record_id=?',head.owner.generation,id);
     if(saved){
      const record=cloudRecordSchema.parse(JSON.parse(saved.body));
      if(record.id!==id||record.petId!==cloudPetId||record.kind!=='event')throw new EventHistoryError();
      head.cloudRecord=record;
     }
    }
   }
  }
  return head;
 }catch{throw new EventHistoryError();}
}

export function createEventHistoryQueries(database:LocalDatabase,petId:string){
 identifierSchema.parse(petId);
 return {
  async eventPage(eventId:string,options:PageOptions={}):Promise<EventHistoryPage>{
   localIdSchema.parse(eventId);const {before,limit}=optionsSchema.parse(options);
   return database.write(async sql=>{
    const rows=await sql.getAllAsync<Row>(`SELECT ${columns} FROM local_revisions WHERE pet_id=? AND kind='event' AND local_id=?${before===undefined?'':' AND sequence<?'} ORDER BY sequence DESC LIMIT ?`,petId,eventId,...(before===undefined?[]:[before]),limit+1);
    const entries=rows.slice(0,limit).map(entry);
    return {entries,next:rows.length>limit?entries.at(-1)!.sequence:null,head:await readEventHistoryHead(sql,petId,eventId)};
   });
  },
  async recentPage(options:PageOptions={}):Promise<{entries:EventHistoryEntry[];next:number|null}>{
   const {before,limit}=optionsSchema.parse(options);
   return database.write(async sql=>{
    const rows=await sql.getAllAsync<Row>(`SELECT ${columns} FROM local_revisions WHERE pet_id=? AND kind='event'${before===undefined?'':' AND sequence<?'} ORDER BY sequence DESC LIMIT ?`,petId,...(before===undefined?[]:[before]),limit+1);
    const entries=rows.slice(0,limit).map(entry);
    return {entries,next:rows.length>limit?entries.at(-1)!.sequence:null};
   });
  },
 };
}

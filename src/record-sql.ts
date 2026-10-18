import {eventTypes} from './domain.ts';
import {eventDataSchema,routineDataSchema} from './cloud/protocol.ts';

type EventData=ReturnType<typeof eventDataSchema.parse>;
type RoutineData=ReturnType<typeof routineDataSchema.parse>;
export type EventSqlRow={type:string;at:number;end_state:number;ended_at:number|null;custom_label:string|null;note:string|null;source:string;estimated:number|null};
export type RoutineSqlRow={type:string;custom_label:string|null;minutes:number;reminder:number|null;tolerance_minutes:number|null};
const types=eventTypes.map(type=>`'${type}'`).join(',');
const timestampRange='BETWEEN -8640000000000000 AND 8640000000000000';
const customLabel="custom_label TEXT CHECK(custom_label IS NULL OR (typeof(custom_label)='text' AND length(trim(custom_label)) BETWEEN 1 AND 40))";
export const eventSqlColumns=['type','at','end_state','ended_at','custom_label','note','source','estimated'] as const;
export const routineSqlColumns=['type','custom_label','minutes','reminder','tolerance_minutes'] as const;
export const eventSqlDefinition=`
  type TEXT NOT NULL CHECK(type IN (${types})),
  at INTEGER NOT NULL CHECK(typeof(at)='integer' AND at ${timestampRange}),
  end_state INTEGER NOT NULL DEFAULT 0 CHECK(end_state IN (0,1,2)),
  ended_at INTEGER CHECK(ended_at IS NULL OR (typeof(ended_at)='integer' AND ended_at ${timestampRange})),
  ${customLabel},
  note TEXT CHECK(note IS NULL OR (typeof(note)='text' AND length(note)<=16384)),
  source TEXT NOT NULL CHECK(source IN ('app','widget')),
  estimated INTEGER CHECK(estimated IN (0,1)),
  CHECK(type!='custom' OR custom_label IS NOT NULL),
  CHECK((end_state=0 AND ended_at IS NULL) OR (type='nap' AND ((end_state=1 AND ended_at IS NULL) OR (end_state=2 AND ended_at IS NOT NULL AND ended_at>=at))))`;
export const routineSqlDefinition=`
  type TEXT NOT NULL CHECK(type IN (${types})),
  ${customLabel},
  minutes INTEGER NOT NULL CHECK(typeof(minutes)='integer' AND minutes BETWEEN 0 AND 1439),
  reminder INTEGER CHECK(reminder IN (0,1)),
  tolerance_minutes INTEGER CHECK(tolerance_minutes IS NULL OR (typeof(tolerance_minutes)='integer' AND tolerance_minutes BETWEEN 0 AND 1440)),
  CHECK(type!='custom' OR custom_label IS NOT NULL)`;

function booleanFromSql(value:number|null):boolean|undefined {
  if(value===null)return undefined;
  if(value!==0&&value!==1)throw new TypeError('Invalid stored boolean.');
  return value===1;
}
export function eventSqlValues(data:EventData):(string|number|null)[] {
  return [data.type,data.at,data.endedAt===undefined?0:data.endedAt===null?1:2,data.endedAt??null,data.customLabel??null,data.note??null,data.source,data.estimated===undefined?null:Number(data.estimated)];
}
export function eventDataFromSql(row:EventSqlRow):EventData {
  if(![0,1,2].includes(row.end_state)||(row.end_state===2?row.ended_at===null:row.ended_at!==null))throw new TypeError('Invalid stored activity timing.');
  const estimated=booleanFromSql(row.estimated);
  return eventDataSchema.parse({type:row.type,at:row.at,source:row.source,
    ...(row.end_state===1?{endedAt:null}:row.end_state===2?{endedAt:row.ended_at}:{}),
    ...(row.custom_label===null?{}:{customLabel:row.custom_label}),...(row.note===null?{}:{note:row.note}),...(estimated===undefined?{}:{estimated})});
}
export function routineSqlValues(data:RoutineData):(string|number|null)[] {
  return [data.type,data.customLabel??null,data.minutes,data.reminder===undefined?null:Number(data.reminder),data.toleranceMinutes??null];
}
export function routineDataFromSql(row:RoutineSqlRow):RoutineData {
  const reminder=booleanFromSql(row.reminder);
  return routineDataSchema.parse({type:row.type,minutes:row.minutes,...(row.custom_label===null?{}:{customLabel:row.custom_label}),
    ...(reminder===undefined?{}:{reminder}),...(row.tolerance_minutes===null?{}:{toleranceMinutes:row.tolerance_minutes})});
}
export const upsertEventSql=`INSERT INTO events(pet_id,id,${eventSqlColumns.join(',')}) VALUES (${Array(2+eventSqlColumns.length).fill('?').join(',')}) ON CONFLICT(pet_id,id) DO UPDATE SET ${eventSqlColumns.map(column=>`${column}=excluded.${column}`).join(',')}`;
export const upsertRoutineSql=`INSERT INTO routines(pet_id,id,${routineSqlColumns.join(',')}) VALUES (${Array(2+routineSqlColumns.length).fill('?').join(',')}) ON CONFLICT(pet_id,id) DO UPDATE SET ${routineSqlColumns.map(column=>`${column}=excluded.${column}`).join(',')}`;

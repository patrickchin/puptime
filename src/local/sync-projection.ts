import { z } from 'zod';
import { normalizeActivityCustomizations } from '../activity-customization.ts';
import { recordDataSchema, type RecordKind } from '../cloud/protocol.ts';
import { fieldPatch } from '../cloud/record-identity.ts';
import { customActivityKey, DEFAULT_WIDGET_ACTIONS, normalizeCustomActivities, normalizeWidgetActions } from '../domain.ts';
import { isLanguagePreference } from '../localization.ts';
import { normalizeNotificationPreferences } from '../notification-config.ts';
import { assertValidEvents } from '../storage-validation.ts';
import { isThemePreference } from '../theme.ts';
import type { SqlExecutor } from './database.ts';
import { assertValidSchedule, petSettingKeys, storageKeys, type LegacyKey } from './legacy.ts';

export type LocalRecord = { kind: RecordKind; localId: string; data: Record<string, unknown> };
const changeData=z.record(z.string(),z.unknown()).nullable();
export const localChangeSchema=z.strictObject({kind:z.enum(['event','routine','puppy','customActivity','customization','accountPreferences']),localId:z.string().min(1),before:changeData,after:changeData}).refine(change=>change.before!==null||change.after!==null,'Invalid empty change.');
export type LocalChange=z.infer<typeof localChangeSchema>;
export type LocalChangeSink = (sql: SqlExecutor, changes: LocalChange[]) => Promise<void>;
export function notifyLocalCommit(callback?:()=>void):void {
  // Scheduling is advisory; listener failure cannot undo an acknowledged save.
  try {callback?.();} catch {}
}
export function localChanges(before: LocalRecord[], after: LocalRecord[]): LocalChange[] {
  const key = (record: LocalRecord) => JSON.stringify([record.kind,record.localId]);
  const old = new Map(before.map(record=>[key(record),record]));
  const next = new Map(after.map(record=>[key(record),record]));
  return [...new Set([...old.keys(),...next.keys()])].flatMap(id=> {
    const previous=old.get(id), current=next.get(id), record=current??previous!;
    return previous && current && !Object.keys(fieldPatch(previous.data,current.data)).length ? []
      : [{kind:record.kind,localId:record.localId,before:previous?.data??null,after:current?.data??null}];
  });
}
async function settings(sql: SqlExecutor, petId: string) {
  const pet=await sql.getFirstAsync<{name:string}>('SELECT name FROM puppies WHERE id=?',petId);
  if (!pet) throw new Error('The local puppy could not be found.');
  const rows=await sql.getAllAsync<{key:string;value:string}>('SELECT key,value FROM settings UNION ALL SELECT key,value FROM pet_settings WHERE pet_id=?',petId);
  const values=new Map(rows.map(row=>[row.key,row.value]));
  function json(key:LegacyKey):unknown {
    const raw=values.get(key); if (raw===undefined) return undefined;
    try {const parsed:unknown=JSON.parse(raw); if (parsed===null) throw new Error(); return parsed;}
    catch {throw new Error('Saved settings could not be read. The original value has been preserved.');}
  }
  function strings(key:LegacyKey) {
    const value=json(key); if (value===undefined) return [];
    if (!Array.isArray(value)||value.some(item=>typeof item!=='string')) throw new Error('Saved settings contain an invalid collection.');
    return value as string[];
  }
  function object(key:LegacyKey) {
    const value=json(key); if (value===undefined) return {};
    if (typeof value!=='object'||Array.isArray(value)) throw new Error('Saved settings contain an invalid object.');
    return value;
  }
  const historical=await sql.getAllAsync<{label:string}>("SELECT DISTINCT json_extract(body,'$.customLabel') label FROM events WHERE pet_id=? AND json_extract(body,'$.type')='custom'",petId);
  const deleted=strings(storageKeys.deletedCustomActivities);
  const labels=normalizeCustomActivities([...strings(storageKeys.customActivities),...historical.map(row=>row.label)],deleted);
  return {pet,values,labels,deleted,customizations:normalizeActivityCustomizations(object(storageKeys.activityCustomizations)),notification:normalizeNotificationPreferences(object(storageKeys.notificationPreferences)),widgetActions:values.has(storageKeys.widgetActions)?normalizeWidgetActions(strings(storageKeys.widgetActions),labels):[...DEFAULT_WIDGET_ACTIONS]};
}

export async function readLocalDeletedActivities(sql:SqlExecutor,petId:string):Promise<string[]> {return (await settings(sql,petId)).deleted;}

export async function readLocalSettingsRecords(sql:SqlExecutor,petId:string):Promise<LocalRecord[]> {
  const state=await settings(sql,petId), n=state.notification;
  return [
    {kind:'puppy',localId:petId,data:{name:state.pet.name}},
    ...state.labels.map(label=>({kind:'customActivity' as const,localId:customActivityKey(label),data:{label}})),
    ...Object.entries(state.customizations).map(([activityKey,value])=>({kind:'customization' as const,localId:activityKey,data:{activityKey,...value}})),
    {kind:'accountPreferences',localId:'preferences',data:{
      theme:isThemePreference(state.values.get(storageKeys.theme)??null)?state.values.get(storageKeys.theme):'system',
      language:isLanguagePreference(state.values.get(storageKeys.language)??null)?state.values.get(storageKeys.language):'system',
      widgetActions:state.widgetActions,reminderLeadMinutes:n.reminderLeadMinutes,widgetConfirmations:n.widgetConfirmations,
      pottyAfterPeeEnabled:n.pottyAfterPee.enabled,pottyAfterPeeDelayMinutes:n.pottyAfterPee.delayMinutes,
      pottyAfterMealEnabled:n.pottyAfterMeal.enabled,pottyAfterMealDelayMinutes:n.pottyAfterMeal.delayMinutes,
    }},
  ];
}
async function indexedRecords(sql:SqlExecutor,petId:string):Promise<LocalRecord[]> {
  const eventRows=await sql.getAllAsync<{id:string;at:number;body:string}>('SELECT id,at,body FROM events WHERE pet_id=? ORDER BY at DESC,rowid',petId);
  const routineRows=await sql.getAllAsync<{id:string;minutes:number;body:string}>('SELECT id,minutes,body FROM routines WHERE pet_id=? ORDER BY minutes,rowid',petId);
  const events:unknown=eventRows.map(row=>JSON.parse(row.body));
  const routines:unknown=routineRows.map(row=>JSON.parse(row.body));
  assertValidEvents(events); assertValidSchedule(routines);
  if (events.some((event,index)=>event.id!==eventRows[index].id||event.at!==eventRows[index].at)
    || routines.some((entry,index)=>entry.id!==routineRows[index].id||entry.minutes!==routineRows[index].minutes)) throw new Error('The saved record index is inconsistent.');
  return [...events.map(({id,...data})=>({kind:'event' as const,localId:id,data})),...routines.map(({id,...data})=>({kind:'routine' as const,localId:id,data}))];
}
export async function readLocalRecords(sql:SqlExecutor,petId:string):Promise<LocalRecord[]> {
  return [...await readLocalSettingsRecords(sql,petId),...await indexedRecords(sql,petId)];
}
async function set(sql:SqlExecutor,petId:string,key:LegacyKey,value:string) {
  if (petSettingKeys.has(key)) await sql.runAsync('INSERT INTO pet_settings(pet_id,key,value) VALUES (?,?,?) ON CONFLICT(pet_id,key) DO UPDATE SET value=excluded.value',petId,key,value);
  else await sql.runAsync('INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',key,value);
}
export async function applyLocalRecords(sql:SqlExecutor,petId:string,records:LocalRecord[],deleted:Array<{kind:RecordKind;localId:string}>):Promise<void> {
  const state=await settings(sql,petId);
  const existing=new Map((await indexedRecords(sql,petId)).map(record=>[JSON.stringify([record.kind,record.localId]),record.data]));
  let labels=state.labels,removed=state.deleted,customizations=state.customizations;
  let changedLabels=false,changedCustomizations=false;
  for (const record of deleted) {
    if (record.kind==='event'||record.kind==='routine') {
      await sql.runAsync(`DELETE FROM ${record.kind==='event'?'events':'routines'} WHERE pet_id=? AND id=?`,petId,record.localId);
    } else if (record.kind==='customActivity') {
      labels=labels.filter(label=>customActivityKey(label)!==record.localId);removed=[...new Set([...removed,record.localId])];changedLabels=true;
    } else if (record.kind==='customization') {delete customizations[record.localId as keyof typeof customizations];changedCustomizations=true;}
    else throw new Error('Puppy and preference records cannot be removed from the local profile.');
  }
  for (const record of records) {
    const previous=existing.get(JSON.stringify([record.kind,record.localId]));
    if ((record.kind==='event'||record.kind==='routine')&&previous&&!Object.keys(fieldPatch(previous,record.data)).length) continue;
    if (record.kind==='event') {
      const values:unknown=[{...record.data,id:record.localId}];assertValidEvents(values);const value=values[0];
      await sql.runAsync('INSERT INTO events(pet_id,id,at,body) VALUES (?,?,?,?) ON CONFLICT(pet_id,id) DO UPDATE SET at=excluded.at,body=excluded.body',petId,value.id,value.at,JSON.stringify(value));
    } else if (record.kind==='routine') {
      const values:unknown=[{...record.data,id:record.localId}];assertValidSchedule(values);const value=values[0];
      await sql.runAsync('INSERT INTO routines(pet_id,id,minutes,body) VALUES (?,?,?,?) ON CONFLICT(pet_id,id) DO UPDATE SET minutes=excluded.minutes,body=excluded.body',petId,value.id,value.minutes,JSON.stringify(value));
    } else if (record.kind==='puppy') {
      const data=recordDataSchema('puppy').parse(record.data);
      if (!('name' in data)) throw new Error('Invalid puppy profile.');
      await sql.runAsync('UPDATE puppies SET name=? WHERE id=?',data.name,petId);
    } else if (record.kind==='customActivity') {
      const data=recordDataSchema('customActivity').parse(record.data);
      if (!('label' in data)||customActivityKey(data.label)!==record.localId) throw new Error('Invalid custom activity identity.');
      removed=removed.filter(key=>key!==record.localId);labels=normalizeCustomActivities([...labels,data.label],removed);changedLabels=true;
    } else if (record.kind==='customization') {
      const data=recordDataSchema('customization').parse(record.data);
      if (!('activityKey' in data)||data.activityKey!==record.localId) throw new Error('Invalid activity customization identity.');
      const {activityKey,...value}=data;customizations={...customizations,[activityKey]:value};changedCustomizations=true;
    } else {
      const data=recordDataSchema('accountPreferences').parse(record.data) as Record<string,unknown>;
      if (data.theme!==undefined) await set(sql,petId,storageKeys.theme,String(data.theme));
      if (data.language!==undefined) await set(sql,petId,storageKeys.language,String(data.language));
      if (data.widgetActions!==undefined) await set(sql,petId,storageKeys.widgetActions,JSON.stringify(data.widgetActions));
      const current=state.notification;
      const preferences=normalizeNotificationPreferences({
        reminderLeadMinutes:data.reminderLeadMinutes??current.reminderLeadMinutes,widgetConfirmations:data.widgetConfirmations??current.widgetConfirmations,
        pottyAfterPee:{enabled:data.pottyAfterPeeEnabled??current.pottyAfterPee.enabled,delayMinutes:data.pottyAfterPeeDelayMinutes??current.pottyAfterPee.delayMinutes},
        pottyAfterMeal:{enabled:data.pottyAfterMealEnabled??current.pottyAfterMeal.enabled,delayMinutes:data.pottyAfterMealDelayMinutes??current.pottyAfterMeal.delayMinutes},
      });
      await set(sql,petId,storageKeys.notificationPreferences,JSON.stringify(preferences));
    }
  }
  if (changedLabels) {await set(sql,petId,storageKeys.customActivities,JSON.stringify(labels));await set(sql,petId,storageKeys.deletedCustomActivities,JSON.stringify(removed));}
  if (changedCustomizations) await set(sql,petId,storageKeys.activityCustomizations,JSON.stringify(customizations));
}

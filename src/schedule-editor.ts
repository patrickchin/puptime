import type { ScheduleEntry } from './domain.ts';
import { assertValidSchedule } from './storage-validation.ts';
export class ScheduleEntryDeletedError extends Error {
  constructor(){super('This routine was removed. Your draft has been kept.');this.name='ScheduleEntryDeletedError';}
}

// The open editor owns only fields changed from its original draft. Merge those
// into the latest stored routine; an old draft cannot recreate a deleted row.
export function applyScheduleEntryEdit(current:ScheduleEntry[],draft:ScheduleEntry,original?:ScheduleEntry):ScheduleEntry[] {
  const saved=current.find(entry=>entry.id===draft.id);
  if(original&&original.id!==draft.id)throw new Error('Routine identity changed.');
  if(original&&!saved)throw new ScheduleEntryDeletedError();
  if(!original&&saved)throw new Error('This routine already exists.');
  const next={...(saved??draft)};
  if(original)for(const field of ['type','customLabel','minutes','reminder','toleranceMinutes'] as const){
    if(Object.is(draft[field],original[field]))continue;
    if(draft[field]===undefined)delete next[field];
    else Object.assign(next,{[field]:draft[field]});
  }
  const result=[...current.filter(entry=>entry.id!==draft.id),next].sort((a,b)=>a.minutes-b.minutes);
  assertValidSchedule(result);return result;
}

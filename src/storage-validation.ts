import type { PuppyEvent, ScheduleEntry } from './domain.ts';
import {eventDataSchema,localIdSchema,routineDataSchema} from './cloud/protocol.ts';

export class EventsStorageError extends Error {
  constructor() {
    super('Saved activity data could not be read. The original data has been preserved.');
    this.name = 'EventsStorageError';
  }
}

export class EventDeletedError extends Error {
  constructor() {
    super('This activity was deleted. Your draft has not been saved.');
    this.name = 'EventDeletedError';
  }
}

export class EventsImportError extends Error {
  constructor() {
    super('Import would leave more than one nap in progress.');
    this.name = 'EventsImportError';
  }
}

export function parseEvents(value:unknown):PuppyEvent[] {
  if(!Array.isArray(value))throw new TypeError('Activity data must be an array.');
  const ids=new Set<string>();
  return value.map(input=>{
    if(!input||typeof input!=='object'||Array.isArray(input))throw new TypeError('Activity data contains an invalid event.');
    const {id,...fields}=input;
    const key=localIdSchema.safeParse(id),data=eventDataSchema.safeParse(fields);
    if(!key.success||!data.success||ids.has(key.data))throw new TypeError('Activity data contains an invalid or duplicate event.');
    ids.add(key.data);return {id:key.data,...data.data};
  });
}
export function assertValidEvents(value:unknown):asserts value is PuppyEvent[] {parseEvents(value);}

export function parseSchedule(value:unknown):ScheduleEntry[] {
  if(!Array.isArray(value))throw new TypeError('Routines must be an array.');
  const ids=new Set<string>();
  return value.map(input=>{
    if(!input||typeof input!=='object'||Array.isArray(input))throw new TypeError('Routines contain an invalid entry.');
    const {id,...fields}=input;
    const key=localIdSchema.safeParse(id),data=routineDataSchema.safeParse(fields);
    if(!key.success||!data.success||ids.has(key.data))throw new TypeError('Routines contain an invalid or duplicate entry.');
    ids.add(key.data);return {id:key.data,...data.data};
  });
}
export function assertValidSchedule(value:unknown):asserts value is ScheduleEntry[] {parseSchedule(value);}

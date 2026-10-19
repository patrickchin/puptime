import type {CloudRecord,Revision} from './cloud/protocol.ts';
import type {PuppyEvent} from './domain.ts';

export type EventHistoryEntry={
 eventId:string;sequence:number;createdAt:number;source:'local'|'enrollment'|'cloud'|'restore';
 before:PuppyEvent|null;after:PuppyEvent|null;
};
export type EventHistoryHead={
 sequence:number|null;owner:{generation:string;accountId:string}|null;
 event:PuppyEvent|null;cloudRecord:CloudRecord|null;
};
export type EventHistoryPage={entries:EventHistoryEntry[];next:number|null;head:EventHistoryHead};
export type EventHistorySelection={source:'local';sequence:number}|{source:'cloud';revision:Revision};
export type EventHistoryRestore={eventId:string;selection:EventHistorySelection;expected:EventHistoryHead};
export type EventHistoryProblem='read'|'stale'|'pending'|'unavailable'|'unsupported';
export class EventHistoryError extends Error {
 readonly category:EventHistoryProblem;
 constructor(category:EventHistoryProblem='read'){
  super({read:'Log history could not be read. Saved data has been preserved.',stale:'This log or its owner changed. Reload history before restoring.',pending:'Wait for this log or its baseline to finish syncing before restoring.',unavailable:'This version is no longer available to restore.',unsupported:'Restoring nap versions is not available yet.'}[category]);
  this.name='EventHistoryError';this.category=category;
 }
}

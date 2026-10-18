import type {CloudRecord} from './cloud/protocol.ts';
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
export class EventHistoryError extends Error {
 readonly category='read';
 constructor(){super('Log history could not be read. Saved data has been preserved.');this.name='EventHistoryError';}
}

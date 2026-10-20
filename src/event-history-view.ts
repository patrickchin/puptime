import type {PuppyEvent} from './domain.ts';
import type {EventHistoryHead} from './event-history.ts';
import {eventDataSchema} from './cloud/protocol.ts';

const fields=['type','customLabel','at','endedAt','note','source','estimated'] as const;
export type HistoryField=typeof fields[number]|'created'|'deleted';
export function historyChangedFields(before:PuppyEvent|null,after:PuppyEvent|null):HistoryField[] {
 if(!after)return ['deleted'];
 if(!before)return ['created'];
 return fields.filter(field=>before[field]!==after[field]);
}
export function historyRestorePreview(after:PuppyEvent|null,head:EventHistoryHead,latest:PuppyEvent|null):{event:PuppyEvent|null;problem:'deleted'|'unsupported'|'identical'|null} {
 if(!after)return {event:null,problem:'deleted'};
 const cloud=head.cloudRecord?.kind==='event'?eventDataSchema.parse(head.cloudRecord.data):null;
 const previous=head.event??latest;
 const event={...after,...(previous?.estimated||cloud?.estimated?{estimated:true}:{})};
 if(after.type==='nap'||previous?.type==='nap'||cloud?.type==='nap')return {event,problem:'unsupported'};
 return {event,problem:head.event&&!historyChangedFields(head.event,event).length?'identical':null};
}

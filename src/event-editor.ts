import { normalizeCustomLabel,normalizeEventTypeChange,normalizeNote,type PuppyEvent,type PuppyEventChanges } from './domain.ts';
export type EventEditValues={type:PuppyEvent['type'];customLabel:string;at:number;endedAt?:number|null;note:string};
export function eventEditValues(event:PuppyEvent):EventEditValues {return {type:event.type,customLabel:event.customLabel??'',at:event.at,endedAt:event.endedAt,note:event.note??''};}
export function createEventEditor(event:PuppyEvent,onSave:(changes:PuppyEventChanges)=>Promise<void>) {
  let baseline=eventEditValues(event),queued:Promise<void>=Promise.resolve();
  return {
    save(value:EventEditValues):Promise<void> {
      const next={...value};
      const result=queued.then(async()=>{
        const changes:PuppyEventChanges={},type=normalizeEventTypeChange(event,next.type);
        if(type!==baseline.type){changes.type=type;changes.customLabel=type==='custom'?normalizeCustomLabel(next.customLabel):undefined;if(type!=='nap')changes.endedAt=undefined;}
        if(type==='custom'&&next.customLabel!==baseline.customLabel)changes.customLabel=normalizeCustomLabel(next.customLabel);
        if(next.at!==baseline.at)changes.at=Math.min(next.at,Date.now());
        if(type==='nap'&&next.endedAt!==baseline.endedAt)changes.endedAt=next.endedAt;
        if(next.note!==baseline.note)changes.note=normalizeNote(next.note);
        if(Object.keys(changes).length)await onSave(changes);
        // Only acknowledged local saves advance this editing session's baseline.
        // Later saves compare user drafts, not stale whole-record snapshots.
        baseline=next;
      });
      queued=result.catch(()=>undefined);return result;
    },
  };
}

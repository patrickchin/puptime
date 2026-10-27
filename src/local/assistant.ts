import {createEvent,normalizeNote,type PuppyEvent} from '../domain.ts';
import {assistantRequestSchema,validateAssistantPlan,type AssistantPlan,type AssistantRequest,type AssistantResult} from '../assistant.ts';
import {eventDataFromSql,type EventSqlRow} from '../record-sql.ts';
import {parseEvents} from '../storage-validation.ts';
import {writeEventRecord} from './repository.ts';
import {notifyLocalCommit,retainCustomActivities,type LocalChange,type LocalChangeSink} from './sync-projection.ts';
import type {LocalDatabase,SqlExecutor} from './database.ts';
import type {BackupGuard} from './activity-backups.ts';

const modeKey='assistant.confirm_before_saving';
const same=(a:Partial<PuppyEvent>|null,b:Partial<PuppyEvent>|null)=>a===null||b===null?a===b:JSON.stringify([a.id,a.type,a.at,a.endedAt,a.customLabel,a.note,a.estimated])===JSON.stringify([b.id,b.type,b.at,b.endedAt,b.customLabel,b.note,b.estimated]);
export function createAssistantStore(database:LocalDatabase,petId:string,onChange:LocalChangeSink,afterCommit?:()=>void,beforeChange?:BackupGuard){
  const receiptKey='assistant.last_result.'+petId;
  const read=async(sql:SqlExecutor,id:string):Promise<PuppyEvent|null>=>{
    const row=await sql.getFirstAsync<EventSqlRow&{id:string}>('SELECT * FROM events WHERE pet_id=? AND id=?',petId,id);
    return row?{id:row.id,...eventDataFromSql(row)}:null;
  };
  const confirmation=async(sql:SqlExecutor)=>{
    const row=await sql.getFirstAsync<{value:string}>('SELECT value FROM metadata WHERE key=?',modeKey);
    if(row&&!['true','false'].includes(row.value))throw new Error('The confirmation preference could not be read.');
    return row?.value!=='false';
  };
  const save=async(sql:SqlExecutor,key:string,value:string)=>{await sql.runAsync('INSERT INTO metadata(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',key,value);};
  const receipt=async(sql:SqlExecutor):Promise<AssistantResult|null>=>{
    const row=await sql.getFirstAsync<{value:string}>('SELECT value FROM metadata WHERE key=?',receiptKey);
    return row?JSON.parse(row.value):null;
  };
  return {
    confirmation:()=>database.read(confirmation),
    lastResult:()=>database.read(receipt),
    setConfirmation:(enabled:boolean)=>database.write(sql=>{
      if(typeof enabled!=='boolean')throw new TypeError('Invalid confirmation preference.');
      return save(sql,modeKey,String(enabled));
    }),
    async execute(commandId:string,proposal:AssistantPlan,rawContext:AssistantRequest):Promise<AssistantResult>{
      if(!/^cmd_[a-f0-9]{32}$/.test(commandId))throw new Error('Invalid command identity.');
      const context=assistantRequestSchema.parse(rawContext),plan=validateAssistantPlan(proposal,context);
      if(context.puppy.id!==petId)throw new Error('The open puppy has changed.');
      let changed=false;
      const result=await database.write(async sql=>{
        const previous=await receipt(sql);
        if(previous?.commandId===commandId){if(previous.undone)throw new Error('This request was already undone.');return previous;}
        const puppy=await sql.getFirstAsync<{name:string}>('SELECT name FROM puppies WHERE id=?',petId);
        if(puppy?.name!==context.puppy.name)throw new Error('The puppy profile changed. Please try again.');
        const confirmationBefore=await confirmation(sql),changes:AssistantResult['changes']=[],local:LocalChange[]=[];
        if(confirmationBefore!==context.confirmBeforeSaving)throw new Error('The confirmation preference changed. Please try again.');
        let confirmationAfter=confirmationBefore;
        for(const action of plan.actions){
          if(action.kind==='set_confirmation'){confirmationAfter=action.enabled;continue;}
          if(action.kind!=='log'&&action.kind!=='edit_log')continue;
          const before=action.kind==='edit_log'?await read(sql,action.eventId):null;
          if(action.kind==='edit_log'){
            const expected=context.recentEvents.find(event=>event.id===action.eventId)!;
            if(!before||!same(before,expected))throw new Error('That log changed. Please try again.');
          }
          const base=action.kind==='log'?createEvent(action.type,'app',action.at,action.customLabel??undefined):before!;
          const [after]=parseEvents([action.kind==='log'?{...base,...(action.type==='nap'?{endedAt:action.endedAt}:{}),...(action.note?{note:action.note}:{})}:{...base,...(action.at===null?{}:{at:action.at}),...(action.endedAt===null?{}:{endedAt:action.endedAt}),...(action.note===null?{}:{note:normalizeNote(action.note)})}]);
          local.push(...await writeEventRecord(sql,petId,before,after));changes.push({before,after});
        }
        const open=await sql.getAllAsync("SELECT id FROM events WHERE pet_id=? AND type='nap' AND end_state=1 LIMIT 2",petId);
        if(open.length>1)throw new Error('A nap is already running. End it before starting another.');
        local.push(...await retainCustomActivities(sql,petId,changes.flatMap(({after})=>after.type==='custom'?[after.customLabel!]:[]),true));
        if(local.length){await onChange(sql,local);changed=true;}
        if(confirmationBefore!==confirmationAfter)await save(sql,modeKey,String(confirmationAfter));
        const result:AssistantResult={commandId,changes,confirmationBefore,confirmationAfter};
        if(changes.length||confirmationBefore!==confirmationAfter)await save(sql,receiptKey,JSON.stringify(result));
        return result;
      });
      if(changed)notifyLocalCommit(afterCommit);
      return result;
    },
    async undo(commandId:string):Promise<void>{
      let changed=false;
      await database.write(async sql=>{
        const result=await receipt(sql);
        if(!result||result.commandId!==commandId||result.undone)throw new Error('This request can no longer be undone.');
        for(const change of result.changes)if(!same(await read(sql,change.after.id),change.after))throw new Error('A log changed after this request. Edit it from Log instead.');
        if(result.confirmationBefore!==result.confirmationAfter&&await confirmation(sql)!==result.confirmationAfter)throw new Error('The confirmation preference changed after this request.');
        if(result.changes.some(change=>!change.before))await beforeChange?.(sql,'delete');
        const changes:LocalChange[]=[];
        for(const change of result.changes)changes.push(...await writeEventRecord(sql,petId,change.after,change.before));
        const open=await sql.getAllAsync("SELECT id FROM events WHERE pet_id=? AND type='nap' AND end_state=1 LIMIT 2",petId);
        if(open.length>1)throw new Error('End the current nap before undoing this request.');
        if(changes.length){await onChange(sql,changes);changed=true;}
        if(result.confirmationBefore!==result.confirmationAfter)await save(sql,modeKey,String(result.confirmationBefore));
        await save(sql,receiptKey,JSON.stringify({...result,undone:true}));
      });
      if(changed)notifyLocalCommit(afterCommit);
    },
  };
}

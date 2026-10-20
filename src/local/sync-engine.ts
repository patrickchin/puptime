import {z} from 'zod';
import { enrollmentSchema, identifierSchema, localIdSchema, eventDataSchema, mutationSchema, pullPageSchema, recordDataSchema, cloudRecordSchema, mutationResultSchema, pushResponseSchema, revisionSchema, type MutationResult, type CloudRecord, type Enrollment, type Mutation, type PullPage } from '../cloud/protocol.ts';
import { cloudRecordId, fieldPatch, localRecordId } from '../cloud/record-identity.ts';
import { ReconciliationError, reconcileMutation, retainValidEventTiming } from '../cloud/reconcile.ts';
import type { LocalDatabase, SqlExecutor } from './database.ts';
import { applyLocalRecords, localChangeSchema, localChanges, notifyLocalCommit, retainCustomActivities, readLocalDeletedActivities, readLocalRecords, type LocalChange, type LocalChangeSink, type LocalRecord } from './sync-projection.ts';
import { STARTER_SCHEDULE,type PuppyEvent } from '../domain.ts';
import { firstLaunchStepSchema } from '../first-launch.ts';
import {EventHistoryError,type EventHistoryRestore} from '../event-history.ts';
import {readEventHistoryEntry,readEventHistoryHead} from './event-history.ts';
import {writeEventRecord} from './repository.ts';

export class RestoreNeedsConfirmationError extends Error {
  constructor(){super('Restore requires confirmation because this setup is no longer pristine.');this.name='RestoreNeedsConfirmationError';}
}

type Owner={generation:string;account_id:string;device_id:string;cursor:number;pending_pet_id:string|null;staging_cursor:number;staging_complete:number;resyncing:number};
type Binding={pet_id:string;cloud_pet_id:string|null;enrollment:string;status:'preparing'|'active'};
type Fence={generation:string;accountId:string};
type Outbox={sequence:number;operation_id:string;local_pet_id:string;local_kind:LocalChange['kind'];local_id:string;change_json:string;mutation_json:string|null;blocked_reason:string|null};
const key=(record:{kind:string;localId:string})=>JSON.stringify([record.kind,record.localId]);
const requestFits=(mutations:Mutation[])=>new TextEncoder().encode(JSON.stringify({mutations})).byteLength<65536;
const historySelection=z.discriminatedUnion('source',[
  z.strictObject({source:z.literal('local'),sequence:z.number().int().min(1).max(Number.MAX_SAFE_INTEGER)}),
  z.strictObject({source:z.literal('cloud'),revision:revisionSchema}),
]);
export function createLocalSync(database:LocalDatabase,options:{newId?:()=>string;now?:()=>number;afterCommit?:()=>void}={}) {
  const now=options.now??Date.now;
  async function id(sql:SqlExecutor,prefix:'op'|'gen'='op') {return identifierSchema.parse(options.newId?.()??(await sql.getFirstAsync<{id:string}>('SELECT ? || lower(hex(randomblob(16))) id',prefix+'_'))!.id);}
  async function owner(sql:SqlExecutor,fence?:Fence):Promise<Owner|null> {
    const value=await sql.getFirstAsync<Owner>('SELECT * FROM local_sync_owner WHERE singleton=1');
    return value&&(!fence||(value.generation===fence.generation&&value.account_id===fence.accountId))?value:null;
  }
  async function required(sql:SqlExecutor,fence:Fence) {const value=await owner(sql,fence);if (!value) throw new Error('Cloud owner changed.');return value;}
  async function binding(sql:SqlExecutor,petId:string) {return sql.getFirstAsync<Binding>('SELECT * FROM local_sync_pets WHERE pet_id=?',petId);}
  async function pristineSetup(sql:SqlExecutor,petId:string):Promise<boolean> {
    const shown=await sql.getFirstAsync<{value:string}>("SELECT value FROM metadata WHERE key='show_onboarding'");
    const step=await sql.getFirstAsync<{value:string}>("SELECT value FROM metadata WHERE key='first_launch_step'");
    const active=await sql.getFirstAsync<{value:string}>("SELECT value FROM metadata WHERE key='active_pet_id'");
    if(shown?.value!=='true'||active?.value!==petId||!firstLaunchStepSchema.safeParse(step?.value??'welcome').success)return false;
    if(await sql.getFirstAsync('SELECT id FROM events WHERE pet_id=? LIMIT 1',petId)
      ||await sql.getFirstAsync("SELECT sequence FROM local_revisions WHERE pet_id=? AND kind!='puppy' LIMIT 1",petId)
      ||await sql.getFirstAsync("SELECT pet_id FROM local_sync_pets WHERE status='active' LIMIT 1")
      ||await sql.getFirstAsync('SELECT operation_id FROM local_sync_outbox WHERE local_pet_id=? LIMIT 1',petId))return false;
    const records=await readLocalRecords(sql,petId);
    if(records.some(record=>record.kind==='customActivity'||record.kind==='customization')||(await readLocalDeletedActivities(sql,petId)).length)return false;
    const starters:LocalRecord[]=STARTER_SCHEDULE.map(({id,...data})=>({kind:'routine',localId:id,data}));
    return !localChanges(starters,records.filter(record=>record.kind==='routine')).length;
  }
  async function associationMode(sql:SqlExecutor,operationId:string):Promise<'combine'|'restore'> {
    const intent=await sql.getFirstAsync<{value:string}>("SELECT value FROM metadata WHERE key='pending_restore_operation'");
    if(intent&&intent.value!==operationId)throw new Error('Saved restoration intent is inconsistent.');
    return intent?'restore':'combine';
  }
  async function clearRestoreIntent(sql:SqlExecutor) {await sql.runAsync("DELETE FROM metadata WHERE key='pending_restore_operation'");}
  async function mirrored(sql:SqlExecutor,generation:string,recordId:string) {
    const row=await sql.getFirstAsync<{body:string}>('SELECT body FROM local_sync_records WHERE generation=? AND record_id=?',generation,recordId);
    return row?cloudRecordSchema.parse(JSON.parse(row.body)):null;
  }
  async function remainingPatch(sql:SqlExecutor,current:Owner,row:Outbox,mutation:Mutation,proposal:Record<string,unknown>):Promise<Record<string,unknown>|null> {
    // A later local operation can be acknowledged before this one's rejection.
    // Keep its fields authoritative without rewriting the older sent request.
    const patch={...proposal};
    const subsequent=await sql.getAllAsync<{mutation_json:string}>("SELECT mutation_json FROM local_sync_acks WHERE generation=? AND outcome='accepted' AND local_sequence>? AND json_extract(mutation_json,'$.recordId')=?",current.generation,row.sequence,mutation.recordId);
    for (const saved of subsequent) {
      const later=mutationSchema.parse(JSON.parse(saved.mutation_json));
      if (later.intent==='delete'||later.intent==='restore') return null;
      for (const field of Object.keys(later.patch)) delete patch[field];
    }
    return mutation.intent!=='delete'&&!Object.keys(patch).length?null:patch;
  }
  async function retainRevisions(sql:SqlExecutor,petId:string,changes:LocalChange[],source:'local'|'enrollment'|'cloud'|'restore') {
    for (const change of changes) await sql.runAsync('INSERT INTO local_revisions(pet_id,kind,local_id,before_data,after_data,created_at,source) VALUES (?,?,?,?,?,?,?)',petId,change.kind,change.localId,change.before===null?null:JSON.stringify(change.before),change.after===null?null:JSON.stringify(change.after),now(),source);
  }
  async function enqueue(sql:SqlExecutor,current:Owner,pet:Binding,original:LocalChange):Promise<Mutation|null> {
    let change=localChangeSchema.parse(original);
    const blocked=await sql.getAllAsync<Outbox>('SELECT * FROM local_sync_outbox WHERE generation=? AND local_pet_id=? AND local_kind=? AND local_id=? AND blocked_reason IS NOT NULL ORDER BY sequence',current.generation,pet.pet_id,change.kind,change.localId);
    if (blocked.length) {
      const proposals=blocked.map(row=>localChangeSchema.parse(JSON.parse(row.change_json))),before=proposals[0].before;
      let after:Record<string,unknown>={...before};
      for (const proposal of [...proposals,original]) {
        if (proposal.after===null) {after={};continue;}
        for (const [field,value] of Object.entries(fieldPatch(proposal.before,proposal.after))) {if (value===null&&field!=='endedAt') delete after[field];else after[field]=value;}
      }
      // Combine explicit proposals, not snapshots that may include unrelated
      // fields pulled from another device while this record was blocked.
      change={...original,before,after:original.after===null?null:after};
    }
    let recordId:string|undefined;
    // Only this pure input conversion can become blocked local work. Database
    // reads and writes stay outside validation catches, so corruption rolls back.
    try {recordId=cloudRecordId(change.kind,change.kind==='accountPreferences'?null:pet.cloud_pet_id,change.kind==='puppy'?pet.cloud_pet_id!:change.localId);} catch {}
    const base=recordId?await mirrored(sql,current.generation,recordId):null;
    const prior=await sql.getAllAsync<Outbox>('SELECT * FROM local_sync_outbox WHERE generation=? AND local_pet_id=? AND local_kind=? AND local_id=? AND mutation_json IS NOT NULL',current.generation,pet.pet_id,change.kind,change.localId);
    const hasCreate=prior.some(row=>mutationSchema.parse(JSON.parse(row.mutation_json!)).intent==='create');
    const intent=change.after===null?'delete':!base&&!hasCreate?'create':'patch';
    if (intent==='delete'&&!base&&!hasCreate) {
      for (const row of blocked) await sql.runAsync('DELETE FROM local_sync_outbox WHERE operation_id=?',row.operation_id);
      return null;
    }
    const patch=intent==='delete'?{}:intent==='create'?change.after!:fieldPatch(change.before,change.after!);
    if (intent!=='delete'&&!Object.keys(patch).length) return null;
    const operationId=await id(sql);
    const parsed=mutationSchema.safeParse({protocolVersion:1,operationId,deviceId:current.device_id,recordId,petId:change.kind==='accountPreferences'?null:pet.cloud_pet_id,kind:change.kind,baseRevision:base?.revision??0,intent,patch});
    let mutation=parsed.success&&(intent!=='create'||recordDataSchema(change.kind).safeParse(patch).success)?parsed.data:null;
    if (mutation&&!requestFits([mutation])) mutation=null;
    for (const row of blocked) await sql.runAsync('DELETE FROM local_sync_outbox WHERE operation_id=?',row.operation_id);
    await sql.runAsync('INSERT INTO local_sync_outbox(operation_id,generation,local_pet_id,local_kind,local_id,change_json,mutation_json,blocked_reason) VALUES (?,?,?,?,?,?,?,?)',operationId,current.generation,pet.pet_id,change.kind,change.localId,JSON.stringify(change),mutation?JSON.stringify(mutation):null,mutation?null:'cloud_validation');
    return mutation;
  }
  async function storeMirror(sql:SqlExecutor,current:Owner,input:CloudRecord):Promise<void> {
    const record=cloudRecordSchema.parse(input);localRecordId(record);
    const previous=await mirrored(sql,current.generation,record.id);
    if (previous) {
      if (previous.kind!==record.kind||previous.petId!==record.petId) throw new Error('Cloud record identity changed.');
      if (record.sequence===previous.sequence&&JSON.stringify(record)!==JSON.stringify(previous)) throw new Error('Cloud record sequence changed contents.');
      if (record.sequence>previous.sequence&&record.revision<=previous.revision) throw new Error('Cloud revision regressed.');
      if (record.sequence<previous.sequence&&record.revision>=previous.revision) throw new Error('Cloud revision order is inconsistent.');
      if (record.sequence<=previous.sequence) return;
    }
    await sql.runAsync('INSERT INTO local_sync_records(generation,record_id,body) VALUES (?,?,?) ON CONFLICT(generation,record_id) DO UPDATE SET body=excluded.body',current.generation,record.id,JSON.stringify(record));
  }
  async function projectOwner(sql:SqlExecutor,current:Owner,removed:CloudRecord[]=[],source:'cloud'|'restore'='cloud'):Promise<void> {
    const pets=await sql.getAllAsync<Binding>("SELECT * FROM local_sync_pets WHERE generation=? AND status='active' ORDER BY rowid",current.generation);
    const primary=pets[0];if (!primary) throw new Error('No enrolled puppy.');
    const petByCloud=new Map(pets.map(pet=>[pet.cloud_pet_id,pet]));
    function location(record:Pick<CloudRecord,'kind'|'petId'|'id'>) {
      const localId=localRecordId(record),pet=record.kind==='accountPreferences'?primary:petByCloud.get(record.petId);
      return pet?{pet,kind:record.kind,localId:record.kind==='puppy'?pet.pet_id:localId}:null;
    }
    const before=new Map<string,LocalRecord[]>(),projected=new Map<string,Map<string,LocalRecord>>(),deletions=new Map<string,Map<string,{kind:LocalRecord['kind'];localId:string}>>();
    for (const pet of pets) {const values=await readLocalRecords(sql,pet.pet_id);before.set(pet.pet_id,values);projected.set(pet.pet_id,new Map(values.map(record=>[key(record),record])));deletions.set(pet.pet_id,new Map());}
    function remove(record:Pick<CloudRecord,'kind'|'petId'|'id'>) {
      const local=location(record);if (!local||local.kind==='puppy'||local.kind==='accountPreferences') return;
      projected.get(local.pet.pet_id)!.delete(key(local));deletions.get(local.pet.pet_id)!.set(key(local),local);
    }
    for (const record of removed) remove(record);
    const rows=await sql.getAllAsync<{body:string}>('SELECT body FROM local_sync_records WHERE generation=?',current.generation);
    const working=new Map<string,CloudRecord>(rows.map(row=>{const record=cloudRecordSchema.parse(JSON.parse(row.body));localRecordId(record);return [record.id,record] as const;}));
    const pending=await sql.getAllAsync<Outbox>('SELECT * FROM local_sync_outbox WHERE generation=? ORDER BY sequence',current.generation);
    const raw:Array<{pet:Binding;change:LocalChange;recordId:string|undefined}>=[];
    for (const row of pending) {
      const pet=pets.find(pet=>pet.pet_id===row.local_pet_id);if (!pet) throw new Error('Pending operation puppy ownership changed.');
      const change=localChangeSchema.parse(JSON.parse(row.change_json));
      if (change.kind!==row.local_kind||change.localId!==row.local_id) throw new Error('Pending operation identity changed.');
      let recordId:string|undefined;
      try {recordId=cloudRecordId(change.kind,change.kind==='accountPreferences'?null:pet.cloud_pet_id,change.kind==='puppy'?pet.cloud_pet_id!:change.localId);} catch {}
      if (!row.mutation_json||row.blocked_reason) {raw.push({pet,change,recordId});continue;}
      const mutation=mutationSchema.parse(JSON.parse(row.mutation_json));
      if (mutation.operationId!==row.operation_id||mutation.recordId!==recordId||mutation.kind!==change.kind||mutation.deviceId!==current.device_id||mutation.petId!==(change.kind==='accountPreferences'?null:pet.cloud_pet_id)) throw new Error('Pending operation identity changed.');
      const base=working.get(mutation.recordId)??null;
      const patch=await remainingPatch(sql,current,row,mutation,mutation.patch);if (!patch) continue;
      // A lost acknowledgment can leave an already accepted create pending.
      // Only the local preview changes intent; the stored request stays exact.
      const preview={...mutation,patch,intent:mutation.intent==='create'&&base?'patch' as const:mutation.intent,baseRevision:mutation.intent==='restore'?mutation.baseRevision:Math.min(mutation.baseRevision,base?.revision??0)} as Mutation;
      try {working.set(mutation.recordId,reconcileMutation(base,preview,now()).record);}
      catch (error) {if (!(error instanceof ReconciliationError)) throw error;if (!base) raw.push({pet,change,recordId});}
    }
    for (const record of working.values()) {
      const local=location(record);if (!local) continue;
      if (record.deleted) {remove(record);continue;}
      projected.get(local.pet.pet_id)!.set(key(local),{kind:local.kind,localId:local.localId,data:record.data});
      deletions.get(local.pet.pet_id)!.delete(key(local));
    }
    for (const item of raw) {
      const base=item.recordId?working.get(item.recordId):undefined;if (base?.deleted) continue;
      const values=projected.get(item.pet.pet_id)!,change=item.change;
      if (change.after===null) {values.delete(key(change));deletions.get(item.pet.pet_id)!.set(key(change),change);continue;}
      const data={...values.get(key(change))?.data};
      for (const [field,value] of Object.entries(fieldPatch(change.before,change.after))) {if (value===null&&field!=='endedAt') delete data[field];else data[field]=value;}
      if (change.kind==='event'&&base) {if ('estimated' in base.data&&base.data.estimated) data.estimated=true;retainValidEventTiming(base.data,data);}
      values.set(key(change),{kind:change.kind,localId:change.localId,data});deletions.get(item.pet.pet_id)!.delete(key(change));
    }
    for (const pet of pets) await applyLocalRecords(sql,pet.pet_id,[...projected.get(pet.pet_id)!.values()].filter(record=>pet===primary||record.kind!=='accountPreferences'),[...deletions.get(pet.pet_id)!.values()]);
    for (const pet of pets) await retainRevisions(sql,pet.pet_id,localChanges(before.get(pet.pet_id)!,await readLocalRecords(sql,pet.pet_id)).filter(change=>pet.pet_id===primary.pet_id||change.kind!=='accountPreferences'),source);
  }
  async function restoreRecord(sql:SqlExecutor,input:Fence&{record:CloudRecord;data:Record<string,unknown>}):Promise<void> {
    const current=await required(sql,input);if (current.pending_pet_id||current.resyncing) throw new Error('Finish the pending baseline first.');
    const proposed=cloudRecordSchema.parse(input.record);localRecordId(proposed);const saved=await mirrored(sql,current.generation,proposed.id);
    if (!saved||saved.revision!==proposed.revision||saved.sequence!==proposed.sequence||saved.kind!==proposed.kind||saved.petId!==proposed.petId) throw new Error('Restore requires the current record identity and revision.');
    const pet=saved.kind==='accountPreferences'?await sql.getFirstAsync<Binding>("SELECT * FROM local_sync_pets WHERE generation=? AND status='active' ORDER BY rowid LIMIT 1",current.generation):await sql.getFirstAsync<Binding>("SELECT * FROM local_sync_pets WHERE generation=? AND cloud_pet_id=? AND status='active'",current.generation,saved.petId);
    if (!pet) throw new Error('Restore puppy ownership changed.');
    const localId=saved.kind==='puppy'?pet.pet_id:localRecordId(saved);
    if (await sql.getFirstAsync('SELECT operation_id FROM local_sync_outbox WHERE generation=? AND local_pet_id=? AND local_kind=? AND local_id=? LIMIT 1',current.generation,pet.pet_id,saved.kind,localId)) throw new Error("Wait for this record's pending changes to be acknowledged before restoring.");
    const data=recordDataSchema(saved.kind).parse(input.data),operationId=await id(sql);
    const mutation=mutationSchema.parse({protocolVersion:1,operationId,deviceId:current.device_id,recordId:saved.id,petId:saved.petId,kind:saved.kind,baseRevision:saved.revision,intent:'restore',patch:data});
    if (!requestFits([mutation])) throw new Error('Restore exceeds the cloud request size limit.');
    reconcileMutation(saved,mutation,now());
    const change:LocalChange={kind:saved.kind,localId:saved.kind==='puppy'?pet.pet_id:localRecordId(saved),before:saved.deleted?null:saved.data,after:data};
    await sql.runAsync('INSERT INTO local_sync_outbox(operation_id,generation,local_pet_id,local_kind,local_id,change_json,mutation_json) VALUES (?,?,?,?,?,?,?)',operationId,current.generation,pet.pet_id,change.kind,change.localId,JSON.stringify(change),JSON.stringify(mutation));
    await projectOwner(sql,current,[],'restore');
  }
  return {
    changeSink(petId:string):LocalChangeSink {
      return async(sql,changes)=>{
        await retainRevisions(sql,petId,changes,'local');
        const current=await owner(sql),pet=await binding(sql,petId);
        if (!current||pet?.status!=='active') return;
        for (const change of changes) {
          let target=pet;
          if (change.kind==='accountPreferences') target=(await sql.getFirstAsync<Binding>("SELECT * FROM local_sync_pets WHERE generation=? AND status='active' ORDER BY rowid LIMIT 1",current.generation))!;
          await enqueue(sql,current,target,change);
        }
      };
    },
    canRestoreSetup:(petId:string)=>database.read(sql=>pristineSetup(sql,identifierSchema.parse(petId))),
    async prepareAssociation(input:{accountId:string;localPetId:string;deviceId:string;enrollment:Enrollment;mode?:'combine'|'restore'}):Promise<{generation:string}> {
      identifierSchema.parse(input.accountId);identifierSchema.parse(input.deviceId);identifierSchema.parse(input.localPetId);
      const request=enrollmentSchema.parse(input.enrollment);
      const mode=input.mode??'combine';
      if(!['combine','restore'].includes(mode))throw new TypeError('Invalid association mode.');
      if(mode==='restore'&&!request.confirmedPetId)throw new RestoreNeedsConfirmationError();
      if (request.localPetId!==input.localPetId||request.deviceId!==input.deviceId) throw new Error('Enrollment identity mismatch.');
      return database.write(async sql=>{
        if (!await sql.getFirstAsync('SELECT id FROM puppies WHERE id=?',input.localPetId)) throw new Error('Local puppy does not exist.');
        let current=await owner(sql);
        if (current&&(current.account_id!==input.accountId||current.device_id!==input.deviceId)) throw new Error('Detach the existing cloud owner before switching.');
        const previous=await binding(sql,input.localPetId);
        if (previous) {
          if (previous.enrollment!==JSON.stringify(request)) throw new Error('Enrollment attempt cannot change.');
          if(previous.status==='preparing'&&await associationMode(sql,request.operationId)!==mode)throw new Error('Enrollment mode cannot change.');
          return {generation:current!.generation};
        }
        if (current?.pending_pet_id||current?.resyncing) throw new Error('Finish the pending enrollment or baseline first.');
        if(mode==='restore'&&!await pristineSetup(sql,input.localPetId))throw new RestoreNeedsConfirmationError();
        if (!current) {
          const generation=await id(sql,'gen');
          await sql.runAsync('INSERT INTO local_sync_owner(singleton,generation,account_id,device_id,pending_pet_id) VALUES (1,?,?,?,?)',generation,input.accountId,input.deviceId,input.localPetId);
          current=(await owner(sql))!;
        } else await sql.runAsync('UPDATE local_sync_owner SET pending_pet_id=?,staging_cursor=0,staging_complete=0 WHERE singleton=1',input.localPetId);
        await sql.runAsync('DELETE FROM local_sync_baseline WHERE generation=?',current.generation);
        await sql.runAsync("INSERT INTO local_sync_pets(pet_id,generation,enrollment,status) VALUES (?,?,?,'preparing')",input.localPetId,current.generation,JSON.stringify(request));
        if(mode==='restore')await sql.runAsync("INSERT INTO metadata(key,value) VALUES ('pending_restore_operation',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",request.operationId);
        else await clearRestoreIntent(sql);
        return {generation:current.generation};
      });
    },
    async enrollmentState():Promise<(Fence&{request:Enrollment;stagingCursor:number;baselineComplete:boolean;mode?:'restore'})|null> {
      return database.read(async sql=>{
        const current=await owner(sql);if (!current?.pending_pet_id) return null;
        const pet=await binding(sql,current.pending_pet_id);if (!pet||pet.status!=='preparing') throw new Error('Saved enrollment state is inconsistent.');
        const request=enrollmentSchema.parse(JSON.parse(pet.enrollment)),mode=await associationMode(sql,request.operationId);
        return {generation:current.generation,accountId:current.account_id,request,stagingCursor:current.staging_cursor,baselineComplete:current.staging_complete===1,...(mode==='restore'?{mode}:{})};
      });
    },
    async cancelEnrollment(input:Fence&{operationId:string}):Promise<void> {
      await database.write(async sql=>{
        const current=await required(sql,input),pet=current.pending_pet_id?await binding(sql,current.pending_pet_id):null;
        if(!pet||pet.status!=='preparing'||enrollmentSchema.parse(JSON.parse(pet.enrollment)).operationId!==input.operationId)throw new Error('Enrollment attempt changed.');
        if(current.resyncing||current.staging_cursor||current.staging_complete||await sql.getFirstAsync('SELECT record_id FROM local_sync_baseline WHERE generation=? LIMIT 1',current.generation))throw new Error('A baseline already began; retain the saved enrollment.');
        if(await sql.getFirstAsync('SELECT operation_id FROM local_sync_outbox WHERE generation=? AND local_pet_id=? LIMIT 1',current.generation,pet.pet_id))throw new Error('Retain enrollment with pending uploads.');
        await sql.runAsync('DELETE FROM local_sync_pets WHERE generation=? AND pet_id=?',current.generation,pet.pet_id);
        if(await sql.getFirstAsync('SELECT pet_id FROM local_sync_pets WHERE generation=? LIMIT 1',current.generation))await sql.runAsync('UPDATE local_sync_owner SET pending_pet_id=NULL,staging_cursor=0,staging_complete=0 WHERE generation=?',current.generation);
        else await sql.runAsync('DELETE FROM local_sync_owner WHERE generation=?',current.generation);
        await clearRestoreIntent(sql);
      });
    },
    async stageBaseline(input:Fence&{page:PullPage}):Promise<void> {
      const page=pullPageSchema.parse(input.page);
      if (page.resyncRequired) throw new Error('A full baseline cannot request another resync.');
      await database.write(async sql=>{
        const current=await required(sql,input);
        if (!current.pending_pet_id&&!current.resyncing) throw new Error('No incomplete baseline is pending.');
        if (page.cursor===current.staging_cursor&&current.staging_complete===(page.hasMore?0:1)) {
          const duplicate=await Promise.all(page.changes.map(async record=>(await sql.getFirstAsync<{body:string}>('SELECT body FROM local_sync_baseline WHERE generation=? AND record_id=?',current.generation,record.id))?.body===JSON.stringify(record)));
          if (duplicate.every(Boolean)) return;
        }
        if (current.staging_complete) throw new Error('Baseline is already complete.');
        if (!page.changes.length&&page.cursor!==current.staging_cursor) throw new Error('Empty baseline cannot advance its cursor.');
        if (page.changes.some(record=>record.sequence<=current.staging_cursor)||page.cursor<current.staging_cursor) throw new Error('Baseline cursor did not progress.');
        for (const record of page.changes) {
          localRecordId(record);
          await sql.runAsync('INSERT INTO local_sync_baseline(generation,record_id,body) VALUES (?,?,?) ON CONFLICT(generation,record_id) DO UPDATE SET body=excluded.body',current.generation,record.id,JSON.stringify(record));
        }
        await sql.runAsync('UPDATE local_sync_owner SET staging_cursor=?,staging_complete=? WHERE singleton=1',page.cursor,page.hasMore?0:1);
      });
    },
    async completeAssociation(input:Fence&{cloudPetId:string}):Promise<void> {
      identifierSchema.parse(input.cloudPetId);
      await database.write(async sql=>{
        const current=await required(sql,input);
        if (!current.pending_pet_id) {
          if (await sql.getFirstAsync("SELECT pet_id FROM local_sync_pets WHERE generation=? AND cloud_pet_id=? AND status='active'",current.generation,input.cloudPetId)) return;
          throw new Error('No pending enrollment.');
        }
        if (!current.staging_complete) throw new Error('The full baseline is incomplete.');
        const pet=(await binding(sql,current.pending_pet_id))!,request=enrollmentSchema.parse(JSON.parse(pet.enrollment));
        if (input.cloudPetId!==(request.confirmedPetId??request.localPetId)) throw new Error('Puppy confirmation does not match enrollment.');
        const restoring=await associationMode(sql,request.operationId)==='restore';
        if(restoring&&!await pristineSetup(sql,pet.pet_id))throw new RestoreNeedsConfirmationError();
        const hadActive=!!await sql.getFirstAsync("SELECT pet_id FROM local_sync_pets WHERE generation=? AND status='active'",current.generation);
        const local=await readLocalRecords(sql,pet.pet_id);
        const locallyDeleted=new Set(await readLocalDeletedActivities(sql,pet.pet_id));
        const rows=await sql.getAllAsync<{body:string}>('SELECT body FROM local_sync_baseline WHERE generation=? ORDER BY json_extract(body,\'$.sequence\')',current.generation);
        const cloud=rows.map(row=>cloudRecordSchema.parse(JSON.parse(row.body)));
        if(restoring&&cloud.some(record=>record.kind==='puppy'&&record.petId===input.cloudPetId&&record.deleted))throw new RestoreNeedsConfirmationError();
        for (const record of cloud) await sql.runAsync('INSERT INTO local_sync_records(generation,record_id,body) VALUES (?,?,?) ON CONFLICT(generation,record_id) DO UPDATE SET body=excluded.body',current.generation,record.id,JSON.stringify(record));
        const old=new Map<string,LocalRecord>(),desired=new Map<string,LocalRecord>(),deleted:Array<{kind:LocalRecord['kind'];localId:string}>=[];
        for (const record of cloud) {
          if (record.petId!==null&&record.petId!==input.cloudPetId) continue;
          if (record.kind==='accountPreferences'&&hadActive) continue;
          const value:LocalRecord={kind:record.kind,localId:record.kind==='puppy'?pet.pet_id:localRecordId(record),data:record.data};
          if (record.deleted) deleted.push(value);else {old.set(key(value),value);if (!(['customActivity','customization'].includes(record.kind)&&locallyDeleted.has(value.localId))) desired.set(key(value),value);}
        }
        for (const record of local) {
          if(restoring){
            if(record.kind==='accountPreferences'&&!old.has(key(record)))desired.set(key(record),record);
            if(record.kind==='puppy'&&!old.has(key(record)))desired.set(key(record),{...record,data:{name:request.name}});
            continue;
          }
          if (record.kind==='accountPreferences'&&(hadActive||old.has(key(record)))) continue;
          const remote=old.get(key(record));
          if (record.kind==='puppy'&&remote&&record.data.name==='My puppy') continue;
          const data={...remote?.data,...record.data};
          if (record.kind==='event'&&remote?.data.estimated) data.estimated=true;
          desired.set(key(record),{...record,data});
        }
        const active={...pet,status:'active' as const,cloud_pet_id:input.cloudPetId};
        await sql.runAsync("UPDATE local_sync_pets SET cloud_pet_id=?,status='active' WHERE pet_id=?",input.cloudPetId,pet.pet_id);
        if(!restoring)for (const change of localChanges([...old.values()],[...desired.values()])) {
          const mutation=await enqueue(sql,current,active,change);
          const remote=mutation?await mirrored(sql,current.generation,mutation.recordId):null;
          if (mutation&&remote) {
            const result=reconcileMutation(remote,mutation,now()).record;
            if (result.deleted) {desired.delete(key(change));deleted.push(change);}
            else desired.set(key(change),{kind:change.kind,localId:change.localId,data:result.data});
          } else if (!mutation&&change.kind==='event'&&change.after&&old.has(key(change))) {
            const data={...change.after};retainValidEventTiming(old.get(key(change))!.data,data);
            desired.set(key(change),{kind:change.kind,localId:change.localId,data});
          }
        }
        // Even an identical local copy must respect a server deletion marker.
        for (const record of cloud.filter(record=>record.deleted&&record.petId===input.cloudPetId)) {
          const value={kind:record.kind,localId:record.kind==='puppy'?pet.pet_id:localRecordId(record)};
          desired.delete(key(value));
        }
        if(restoring)for(const record of local)if(!desired.has(key(record)))deleted.push(record);
        await applyLocalRecords(sql,pet.pet_id,[...desired.values()],deleted.filter(record=>!desired.has(key(record))));
        await retainRevisions(sql,pet.pet_id,localChanges(local,await readLocalRecords(sql,pet.pet_id)),'enrollment');
        await sql.runAsync('UPDATE local_sync_owner SET cursor=?,pending_pet_id=NULL,staging_cursor=0,staging_complete=0 WHERE singleton=1',current.staging_cursor);
        await sql.runAsync('DELETE FROM local_sync_baseline WHERE generation=?',current.generation);
        await clearRestoreIntent(sql);
      });
    },
    async applySync(input:Fence&{accepted:MutationResult[];rejected?:Array<{operationId:string;error:'conflict'|'invalid_mutation'|'retry_later'}>;page:PullPage}):Promise<void> {
      await database.write(async sql=>{
        const current=await owner(sql,input);if (!current) return;
        if (current.pending_pet_id||current.resyncing) throw new Error('Finish the pending baseline first.');
        const {accepted,rejected}=pushResponseSchema.parse({accepted:input.accepted,rejected:input.rejected??[]}),page=pullPageSchema.parse(input.page);
        if (page.resyncRequired) throw new Error('Reset the full baseline before applying a resync.');
        if (!page.changes.length&&page.cursor!==current.cursor) throw new Error('Empty cloud page cannot advance its cursor.');
        if (page.cursor<current.cursor||(page.cursor>current.cursor&&page.changes.some(record=>record.sequence<=current.cursor))) throw new Error('Cloud cursor regressed or overlapped.');
        for (const result of accepted) {
          const row=await sql.getFirstAsync<Outbox>('SELECT * FROM local_sync_outbox WHERE generation=? AND operation_id=?',current.generation,result.operationId);
          if (!row) {
            const previous=await sql.getFirstAsync<{result_json:string}>("SELECT result_json FROM local_sync_acks WHERE generation=? AND operation_id=? AND outcome='accepted'",current.generation,result.operationId);
            if (!previous||JSON.stringify(mutationResultSchema.parse(JSON.parse(previous.result_json)))!==JSON.stringify(result)) throw new Error('Unknown or changed acknowledgment operation.');
            continue;
          }
          if (!row.mutation_json) throw new Error('Acknowledgment was not a sent operation.');
          const mutation=mutationSchema.parse(JSON.parse(row.mutation_json));
          if (mutation.recordId!==result.record.id||mutation.kind!==result.record.kind||mutation.petId!==result.record.petId||mutation.operationId!==result.operationId||mutation.deviceId!==current.device_id) throw new Error('Acknowledgment record identity changed.');
          await storeMirror(sql,current,result.record);
          await sql.runAsync('INSERT INTO local_sync_acks(generation,operation_id,local_sequence,mutation_json,result_json) VALUES (?,?,?,?,?)',current.generation,result.operationId,row.sequence,row.mutation_json,JSON.stringify(result));
          await sql.runAsync('DELETE FROM local_sync_outbox WHERE generation=? AND operation_id=?',current.generation,result.operationId);
        }
        for (const record of page.changes) await storeMirror(sql,current,record);
        for (const result of rejected) {
          const previous=await sql.getFirstAsync<{result_json:string;outcome:string}>('SELECT result_json,outcome FROM local_sync_acks WHERE generation=? AND operation_id=?',current.generation,result.operationId);
          if (previous) {
            if (previous.outcome!=='rejected'||previous.result_json!==JSON.stringify(result)) throw new Error('Operation result changed.');
            continue;
          }
          const row=await sql.getFirstAsync<Outbox>('SELECT * FROM local_sync_outbox WHERE generation=? AND operation_id=?',current.generation,result.operationId);
          if (!row?.mutation_json) throw new Error('Unknown rejected operation.');
          if (result.error==='retry_later') continue;
          const mutation=mutationSchema.parse(JSON.parse(row.mutation_json));
          if (mutation.operationId!==result.operationId||mutation.deviceId!==current.device_id) throw new Error('Rejected operation identity changed.');
          await sql.runAsync("INSERT INTO local_sync_acks(generation,operation_id,local_sequence,mutation_json,result_json,outcome) VALUES (?,?,?,?,?,'rejected')",current.generation,result.operationId,row.sequence,row.mutation_json,JSON.stringify(result));
          const base=await mirrored(sql,current.generation,mutation.recordId),change=localChangeSchema.parse(JSON.parse(row.change_json));
          if (result.error==='invalid_mutation'||mutation.intent==='restore') {
            await sql.runAsync('UPDATE local_sync_outbox SET blocked_reason=? WHERE generation=? AND operation_id=?',mutation.intent==='restore'?'restore_conflict':'cloud_rejected',current.generation,result.operationId);
            continue;
          }
          if (!base&&change.after===null) {await sql.runAsync('DELETE FROM local_sync_outbox WHERE generation=? AND operation_id=?',current.generation,result.operationId);continue;}
          const patch=await remainingPatch(sql,current,row,mutation,(base?mutation.patch:change.after)??{});
          if (!patch) {await sql.runAsync('DELETE FROM local_sync_outbox WHERE generation=? AND operation_id=?',current.generation,result.operationId);continue;}
          const candidate=mutationSchema.safeParse({...mutation,operationId:await id(sql),baseRevision:base?.revision??0,intent:base?(mutation.intent==='create'?'patch':mutation.intent):'create',patch});
          let valid=candidate.success&&requestFits([candidate.data]);
          if (candidate.success) {
            try {reconcileMutation(base,candidate.data,now());} catch (error) {if (!(error instanceof Error)) throw error;if (error.name!=='ZodError'&&!(error instanceof ReconciliationError)) throw error;valid=false;}
          }
          if (!candidate.success||!valid) {await sql.runAsync("UPDATE local_sync_outbox SET blocked_reason='cloud_rejected' WHERE generation=? AND operation_id=?",current.generation,result.operationId);continue;}
          // The server confirmed rejection, so this is a new operation with a
          // new ID in the original queue position. Its old payload is retained
          // in the receipt; an in-flight or accepted request is never rewritten.
          await sql.runAsync('UPDATE local_sync_outbox SET operation_id=?,mutation_json=? WHERE generation=? AND operation_id=?',candidate.data.operationId,JSON.stringify(candidate.data),current.generation,result.operationId);
        }
        await projectOwner(sql,current);
        // Push sequence is deliberately not a pull cursor.
        await sql.runAsync('UPDATE local_sync_owner SET cursor=? WHERE generation=?',page.cursor,current.generation);
      });
    },
    async resetBaseline(input:Fence):Promise<void> {
      await database.write(async sql=>{const current=await required(sql,input);if (current.resyncing) return;if (current.pending_pet_id) throw new Error('Enrollment baseline is pending.');await sql.runAsync('DELETE FROM local_sync_baseline WHERE generation=?',current.generation);await sql.runAsync('UPDATE local_sync_owner SET resyncing=1,staging_cursor=0,staging_complete=0 WHERE generation=?',current.generation);});
    },
    async resyncState():Promise<(Fence&{stagingCursor:number;baselineComplete:boolean})|null> {
      return database.read(async sql=>{const current=await owner(sql);return current?.resyncing?{generation:current.generation,accountId:current.account_id,stagingCursor:current.staging_cursor,baselineComplete:current.staging_complete===1}:null;});
    },
    async finishResync(input:Fence):Promise<void> {
      await database.write(async sql=>{
        const current=await required(sql,input);if (!current.resyncing) return;if (!current.staging_complete) throw new Error('The full baseline is incomplete.');
        const former=(await sql.getAllAsync<{body:string}>('SELECT body FROM local_sync_records WHERE generation=?',current.generation)).map(row=>cloudRecordSchema.parse(JSON.parse(row.body)));
        const rows=await sql.getAllAsync<{body:string}>('SELECT body FROM local_sync_baseline WHERE generation=?',current.generation);
        await sql.runAsync('DELETE FROM local_sync_records WHERE generation=?',current.generation);
        const present=new Set<string>();for (const row of rows) {const record=cloudRecordSchema.parse(JSON.parse(row.body));await storeMirror(sql,current,record);present.add(record.id);}
        await projectOwner(sql,current,former.filter(record=>!present.has(record.id)));
        await sql.runAsync('UPDATE local_sync_owner SET cursor=?,resyncing=0,staging_cursor=0,staging_complete=0 WHERE generation=?',current.staging_cursor,current.generation);
        await sql.runAsync('DELETE FROM local_sync_baseline WHERE generation=?',current.generation);
      });
    },
    async restore(input:Fence&{record:CloudRecord;data:Record<string,unknown>}):Promise<void> {
      await database.write(sql=>restoreRecord(sql,input));
    },
    async restoreEventHistory(input:EventHistoryRestore&{petId:string}):Promise<PuppyEvent> {
      const petId=identifierSchema.parse(input.petId),eventId=localIdSchema.parse(input.eventId),selection=historySelection.parse(input.selection);
      const result=await database.write(async sql=>{
        const head=await readEventHistoryHead(sql,petId,eventId);
        if(JSON.stringify(head)!==JSON.stringify(input.expected))throw new EventHistoryError('stale');
        const current=await owner(sql),pet=await binding(sql,petId);
        if(pet&&(pet.status!=='active'||current?.pending_pet_id||current?.resyncing))throw new EventHistoryError('pending');
        if(pet&&await sql.getFirstAsync('SELECT operation_id FROM local_sync_outbox WHERE generation=? AND local_pet_id=? AND local_kind=? AND local_id=? LIMIT 1',current!.generation,petId,'event',eventId))throw new EventHistoryError('pending');
        let selected:PuppyEvent;
        if(selection.source==='local'){
          const entry=await readEventHistoryEntry(sql,petId,eventId,selection.sequence);
          if(!entry?.after)throw new EventHistoryError('unavailable');
          selected=entry.after;
        }else{
          const revision=selection.revision,record=revision.after,mirror=head.cloudRecord;
          if(!pet||!head.owner||!mirror||record.kind!=='event'||record.deleted
            ||revision.recordId!==mirror.id||record.petId!==mirror.petId||record.revision>mirror.revision||record.sequence>mirror.sequence)throw new EventHistoryError('unavailable');
          if(record.revision===mirror.revision||record.sequence===mirror.sequence){
            if(JSON.stringify(record)!==JSON.stringify(mirror))throw new EventHistoryError('unavailable');
          }
          selected={id:eventId,...eventDataSchema.parse(record.data)};
        }
        const latest=head.sequence===null?null:await readEventHistoryEntry(sql,petId,eventId,head.sequence);
        const previous=head.event??latest?.after??latest?.before,cloudData=head.cloudRecord?.kind==='event'?eventDataSchema.parse(head.cloudRecord.data):null;
        if(selected.type==='nap'||previous?.type==='nap'||cloudData?.type==='nap')throw new EventHistoryError('unsupported');
        const {id:_,...snapshot}=selected;
        const desired={id:eventId,...eventDataSchema.parse({...snapshot,...(previous?.estimated||cloudData?.estimated?{estimated:true}:{})})};
        if(head.event&&!Object.keys(fieldPatch(head.event,desired)).length)return {event:head.event,changed:false};
        if(pet){
          if(!head.owner||!head.cloudRecord)throw new EventHistoryError('unavailable');
          const {id:__,...data}=desired;
          await restoreRecord(sql,{...head.owner,record:head.cloudRecord,data});
        }else{
          const changes=await writeEventRecord(sql,petId,head.event,desired);
          changes.push(...await retainCustomActivities(sql,petId,desired.type==='custom'?[desired.customLabel!]:[]));
          await retainRevisions(sql,petId,changes,'restore');
        }
        const committed=(await readEventHistoryHead(sql,petId,eventId)).event;
        if(!committed)throw new EventHistoryError('unavailable');
        return {event:committed,changed:true};
      });
      if(result.changed)notifyLocalCommit(options.afterCommit);
      return result.event;
    },
    async detach(input:Fence):Promise<void> {await database.write(async sql=>{await required(sql,input);await sql.runAsync('DELETE FROM local_sync_owner WHERE generation=?',input.generation);await clearRestoreIntent(sql);});},
    async status(petId:string):Promise<{state:'local'|'preparing'|'active'|'resyncing';generation:string|null;accountId:string|null;pending:number;blocked:number;cursor:number}> {
      return database.read(async sql=>{
        const current=await owner(sql),pet=await binding(sql,petId);
        if (!current||!pet) return {state:'local',generation:null,accountId:null,pending:0,blocked:0,cursor:0};
        const counts=(await sql.getFirstAsync<{pending:number;blocked:number}>('SELECT COUNT(*) pending,COALESCE(SUM(blocked_reason IS NOT NULL),0) blocked FROM local_sync_outbox WHERE generation=?',current.generation))!;
        return {state:current.resyncing?'resyncing':pet.status,generation:current.generation,accountId:current.account_id,...counts,cursor:current.cursor};
      });
    },
    async nextBatch(input:Fence):Promise<Mutation[]> {
      return database.read(async sql=>{
        const current=await owner(sql,input);if (!current||current.pending_pet_id||current.resyncing) return [];
        const rows=await sql.getAllAsync<Outbox>('SELECT * FROM local_sync_outbox WHERE generation=? AND mutation_json IS NOT NULL AND blocked_reason IS NULL ORDER BY sequence LIMIT 50',current.generation);
        const batch:Mutation[]=[];
        for (const row of rows) {
          const candidate=mutationSchema.parse(JSON.parse(row.mutation_json!));
          if (!requestFits([...batch,candidate])) break;
          batch.push(candidate);
        }
        return batch;
      });
    },
  };
}

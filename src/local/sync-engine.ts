import { enrollmentSchema, identifierSchema, mutationSchema, pullPageSchema, recordDataSchema, cloudRecordSchema, type CloudRecord, type Enrollment, type Mutation, type PullPage } from '../cloud/protocol.ts';
import { cloudRecordId, fieldPatch, localRecordId } from '../cloud/record-identity.ts';
import { reconcileMutation, retainValidEventTiming } from '../cloud/reconcile.ts';
import type { LocalDatabase, SqlExecutor } from './database.ts';
import { applyLocalRecords, localChangeSchema, localChanges, readLocalDeletedActivities, readLocalRecords, type LocalChange, type LocalChangeSink, type LocalRecord } from './sync-projection.ts';

type Owner={generation:string;account_id:string;device_id:string;cursor:number;pending_pet_id:string|null;staging_cursor:number;staging_complete:number};
type Binding={pet_id:string;cloud_pet_id:string|null;enrollment:string;status:'preparing'|'active'};
type Fence={generation:string;accountId:string};
type Outbox={operation_id:string;local_pet_id:string;local_kind:LocalChange['kind'];local_id:string;change_json:string;mutation_json:string|null;blocked_reason:string|null};
const key=(record:{kind:string;localId:string})=>JSON.stringify([record.kind,record.localId]);
export function createLocalSync(database:LocalDatabase,options:{newId?:()=>string;now?:()=>number}={}) {
  const now=options.now??Date.now;
  async function id(sql:SqlExecutor) {return identifierSchema.parse(options.newId?.()??(await sql.getFirstAsync<{id:string}>('SELECT lower(hex(randomblob(16))) id'))!.id);}
  async function owner(sql:SqlExecutor,fence?:Fence):Promise<Owner|null> {
    const value=await sql.getFirstAsync<Owner>('SELECT * FROM local_sync_owner WHERE singleton=1');
    return value&&(!fence||(value.generation===fence.generation&&value.account_id===fence.accountId))?value:null;
  }
  async function required(sql:SqlExecutor,fence:Fence) {const value=await owner(sql,fence);if (!value) throw new Error('Cloud owner changed.');return value;}
  async function binding(sql:SqlExecutor,petId:string) {return sql.getFirstAsync<Binding>('SELECT * FROM local_sync_pets WHERE pet_id=?',petId);}
  async function mirrored(sql:SqlExecutor,generation:string,recordId:string) {
    const row=await sql.getFirstAsync<{body:string}>('SELECT body FROM local_sync_records WHERE generation=? AND record_id=?',generation,recordId);
    return row?cloudRecordSchema.parse(JSON.parse(row.body)):null;
  }
  async function retainRevisions(sql:SqlExecutor,petId:string,changes:LocalChange[],source:'local'|'enrollment'|'cloud'|'restore') {
    for (const change of changes) await sql.runAsync('INSERT INTO local_revisions(pet_id,kind,local_id,before_data,after_data,created_at,source) VALUES (?,?,?,?,?,?,?)',petId,change.kind,change.localId,change.before===null?null:JSON.stringify(change.before),change.after===null?null:JSON.stringify(change.after),now(),source);
  }
  async function enqueue(sql:SqlExecutor,current:Owner,pet:Binding,original:LocalChange):Promise<Mutation|null> {
    let change=localChangeSchema.parse(original);
    const blocked=await sql.getAllAsync<Outbox>('SELECT * FROM local_sync_outbox WHERE generation=? AND local_pet_id=? AND local_kind=? AND local_id=? AND blocked_reason IS NOT NULL ORDER BY sequence',current.generation,pet.pet_id,change.kind,change.localId);
    if (blocked.length) change={...change,before:localChangeSchema.parse(JSON.parse(blocked[0].change_json)).before};
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
    if (mutation&&new TextEncoder().encode(JSON.stringify({mutations:[mutation]})).byteLength>=65536) mutation=null;
    for (const row of blocked) await sql.runAsync('DELETE FROM local_sync_outbox WHERE operation_id=?',row.operation_id);
    await sql.runAsync('INSERT INTO local_sync_outbox(operation_id,generation,local_pet_id,local_kind,local_id,change_json,mutation_json,blocked_reason) VALUES (?,?,?,?,?,?,?,?)',operationId,current.generation,pet.pet_id,change.kind,change.localId,JSON.stringify(change),mutation?JSON.stringify(mutation):null,mutation?null:'cloud_validation');
    return mutation;
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
    async prepareAssociation(input:{accountId:string;localPetId:string;deviceId:string;enrollment:Enrollment}):Promise<{generation:string}> {
      identifierSchema.parse(input.accountId);identifierSchema.parse(input.deviceId);identifierSchema.parse(input.localPetId);
      const request=enrollmentSchema.parse(input.enrollment);
      if (request.localPetId!==input.localPetId||request.deviceId!==input.deviceId) throw new Error('Enrollment identity mismatch.');
      return database.write(async sql=>{
        if (!await sql.getFirstAsync('SELECT id FROM puppies WHERE id=?',input.localPetId)) throw new Error('Local puppy does not exist.');
        let current=await owner(sql);
        if (current&&(current.account_id!==input.accountId||current.device_id!==input.deviceId)) throw new Error('Detach the existing cloud owner before switching.');
        const previous=await binding(sql,input.localPetId);
        if (previous) {
          if (previous.enrollment!==JSON.stringify(request)) throw new Error('Enrollment attempt cannot change.');
          return {generation:current!.generation};
        }
        if (current?.pending_pet_id) throw new Error('Finish the pending enrollment first.');
        if (!current) {
          const generation=await id(sql);
          await sql.runAsync('INSERT INTO local_sync_owner(singleton,generation,account_id,device_id,pending_pet_id) VALUES (1,?,?,?,?)',generation,input.accountId,input.deviceId,input.localPetId);
          current=(await owner(sql))!;
        } else await sql.runAsync('UPDATE local_sync_owner SET pending_pet_id=?,staging_cursor=0,staging_complete=0 WHERE singleton=1',input.localPetId);
        await sql.runAsync('DELETE FROM local_sync_baseline WHERE generation=?',current.generation);
        await sql.runAsync("INSERT INTO local_sync_pets(pet_id,generation,enrollment,status) VALUES (?,?,?,'preparing')",input.localPetId,current.generation,JSON.stringify(request));
        return {generation:current.generation};
      });
    },
    async enrollmentState():Promise<(Fence&{request:Enrollment;stagingCursor:number;baselineComplete:boolean})|null> {
      return database.read(async sql=>{
        const current=await owner(sql);if (!current?.pending_pet_id) return null;
        const pet=await binding(sql,current.pending_pet_id);if (!pet||pet.status!=='preparing') throw new Error('Saved enrollment state is inconsistent.');
        return {generation:current.generation,accountId:current.account_id,request:enrollmentSchema.parse(JSON.parse(pet.enrollment)),stagingCursor:current.staging_cursor,baselineComplete:current.staging_complete===1};
      });
    },
    async stageBaseline(input:Fence&{page:PullPage}):Promise<void> {
      const page=pullPageSchema.parse(input.page);
      if (page.resyncRequired) throw new Error('A full baseline cannot request another resync.');
      await database.write(async sql=>{
        const current=await required(sql,input);
        if (!current.pending_pet_id) throw new Error('No incomplete baseline is pending.');
        if (page.cursor===current.staging_cursor&&current.staging_complete===(page.hasMore?0:1)) {
          const duplicate=await Promise.all(page.changes.map(async record=>(await sql.getFirstAsync<{body:string}>('SELECT body FROM local_sync_baseline WHERE generation=? AND record_id=?',current.generation,record.id))?.body===JSON.stringify(record)));
          if (duplicate.every(Boolean)) return;
        }
        if (current.staging_complete) throw new Error('Baseline is already complete.');
        if (!page.changes.length&&page.cursor!==current.staging_cursor) throw new Error('Empty baseline cannot advance its cursor.');
        if (page.changes.some(record=>record.sequence<=current.staging_cursor)||page.cursor<current.staging_cursor) throw new Error('Baseline cursor did not progress.');
        const pet=(await binding(sql,current.pending_pet_id))!,request=enrollmentSchema.parse(JSON.parse(pet.enrollment));
        const cloudPetId=request.confirmedPetId??request.localPetId;
        for (const record of page.changes) {
          localRecordId(record);
          if (record.petId!==null&&record.petId!==cloudPetId&&!await sql.getFirstAsync('SELECT pet_id FROM local_sync_pets WHERE generation=? AND cloud_pet_id=?',current.generation,record.petId)) throw new Error('Baseline puppy ownership mismatch.');
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
        const hadActive=!!await sql.getFirstAsync("SELECT pet_id FROM local_sync_pets WHERE generation=? AND status='active'",current.generation);
        const local=await readLocalRecords(sql,pet.pet_id);
        const locallyDeleted=new Set(await readLocalDeletedActivities(sql,pet.pet_id));
        const rows=await sql.getAllAsync<{body:string}>('SELECT body FROM local_sync_baseline WHERE generation=? ORDER BY json_extract(body,\'$.sequence\')',current.generation);
        const cloud=rows.map(row=>cloudRecordSchema.parse(JSON.parse(row.body)));
        for (const record of cloud) await sql.runAsync('INSERT INTO local_sync_records(generation,record_id,body) VALUES (?,?,?) ON CONFLICT(generation,record_id) DO UPDATE SET body=excluded.body',current.generation,record.id,JSON.stringify(record));
        const old=new Map<string,LocalRecord>(),desired=new Map<string,LocalRecord>(),deleted:Array<{kind:LocalRecord['kind'];localId:string}>=[];
        for (const record of cloud) {
          if (record.petId!==null&&record.petId!==input.cloudPetId) continue;
          if (record.kind==='accountPreferences'&&hadActive) continue;
          const value:LocalRecord={kind:record.kind,localId:record.kind==='puppy'?pet.pet_id:localRecordId(record),data:record.data};
          if (record.deleted) deleted.push(value);else {old.set(key(value),value);if (!(['customActivity','customization'].includes(record.kind)&&locallyDeleted.has(value.localId))) desired.set(key(value),value);}
        }
        for (const record of local) {
          if (record.kind==='accountPreferences'&&(hadActive||old.has(key(record)))) continue;
          const remote=old.get(key(record));
          if (record.kind==='puppy'&&remote&&record.data.name==='My puppy') continue;
          const data={...remote?.data,...record.data};
          if (record.kind==='event'&&remote?.data.estimated) data.estimated=true;
          desired.set(key(record),{...record,data});
        }
        const active={...pet,status:'active' as const,cloud_pet_id:input.cloudPetId};
        await sql.runAsync("UPDATE local_sync_pets SET cloud_pet_id=?,status='active' WHERE pet_id=?",input.cloudPetId,pet.pet_id);
        for (const change of localChanges([...old.values()],[...desired.values()])) {
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
        await applyLocalRecords(sql,pet.pet_id,[...desired.values()],deleted.filter(record=>!desired.has(key(record))));
        await retainRevisions(sql,pet.pet_id,localChanges(local,await readLocalRecords(sql,pet.pet_id)),'enrollment');
        await sql.runAsync('UPDATE local_sync_owner SET cursor=?,pending_pet_id=NULL,staging_cursor=0,staging_complete=0 WHERE singleton=1',current.staging_cursor);
        await sql.runAsync('DELETE FROM local_sync_baseline WHERE generation=?',current.generation);
      });
    },
    async detach(input:Fence):Promise<void> {await database.write(async sql=>{await required(sql,input);await sql.runAsync('DELETE FROM local_sync_owner WHERE generation=?',input.generation);});},
    async status(petId:string):Promise<{state:'local'|'preparing'|'active';generation:string|null;accountId:string|null;pending:number;blocked:number;cursor:number}> {
      return database.read(async sql=>{
        const current=await owner(sql),pet=await binding(sql,petId);
        if (!current||!pet) return {state:'local',generation:null,accountId:null,pending:0,blocked:0,cursor:0};
        const counts=(await sql.getFirstAsync<{pending:number;blocked:number}>('SELECT COUNT(*) pending,COALESCE(SUM(blocked_reason IS NOT NULL),0) blocked FROM local_sync_outbox WHERE generation=?',current.generation))!;
        return {state:pet.status,generation:current.generation,accountId:current.account_id,...counts,cursor:current.cursor};
      });
    },
    async nextBatch(input:Fence):Promise<Mutation[]> {
      return database.read(async sql=>{
        const current=await owner(sql,input);if (!current) return [];
        const rows=await sql.getAllAsync<Outbox>('SELECT * FROM local_sync_outbox WHERE generation=? AND mutation_json IS NOT NULL ORDER BY sequence LIMIT 50',current.generation);
        const batch:Mutation[]=[];
        for (const row of rows) {
          const candidate=mutationSchema.parse(JSON.parse(row.mutation_json!));
          if (new TextEncoder().encode(JSON.stringify({mutations:[...batch,candidate]})).byteLength>=65536) break;
          batch.push(candidate);
        }
        return batch;
      });
    },
  };
}

import { identifierSchema, recordDataSchema,cloudRecordSchema } from '../cloud/protocol.ts';
import type { LocalDatabase } from './database.ts';
import { createNativeStorage } from './native-storage.ts';
import { createLocalSync } from './sync-engine.ts';
import { createActivityQueries } from './activity-queries.ts';
import { createEventHistoryQueries } from './event-history.ts';
import { createLocalRepository, importEventRecords } from './repository.ts';
import type {EventHistoryRestore} from '../event-history.ts';
import type { ActivityBackup, BackupGuard, BackupReason } from './activity-backups.ts';
import type { PuppyEvent } from '../domain.ts';
import { parseEvents } from '../storage-validation.ts';
import { notifyLocalCommit } from './sync-projection.ts';

export async function createLocalRuntime(database:LocalDatabase,petId:string,afterCommit?:()=>void,beforeChange?:BackupGuard,care?:{kind:'household'|'temporary';permission:'view'|'contribute';expiresAt:number|null}) {
  await database.write(async sql=>{
    if(await sql.getFirstAsync("SELECT value FROM metadata WHERE key='profile_photos_v1'"))return;
    // Older clients may already have consumed photo revisions as name-only
    // records. Reuse the resumable baseline path to fill in the new field.
    const owner=await sql.getFirstAsync<{generation:string}>('SELECT generation FROM local_sync_owner WHERE singleton=1');
    if(owner){
      await sql.runAsync('DELETE FROM local_sync_baseline WHERE generation=?',owner.generation);
      await sql.runAsync('UPDATE local_sync_owner SET resyncing=CASE WHEN pending_pet_id IS NULL THEN 1 ELSE resyncing END,staging_cursor=0,staging_complete=0 WHERE singleton=1');
    }
    await sql.runAsync("INSERT INTO metadata(key,value) VALUES ('profile_photos_v1','1')");
  });
  const deviceId=await database.write(async sql=>{
    await sql.runAsync("INSERT OR IGNORE INTO metadata(key,value) VALUES ('cloud_device_id','dev_' || lower(hex(randomblob(16))))");
    return identifierSchema.parse((await sql.getFirstAsync<{value:string}>("SELECT value FROM metadata WHERE key='cloud_device_id'"))!.value);
  });
  const sync=createLocalSync(database,{afterCommit,beforeChange,localRoutineReminders:care?.kind==='temporary'});
  const sink=sync.changeSink(petId);
  const changed:import('./sync-projection').LocalChangeSink=async(sql,changes)=>{
    if(!care){await sink(sql,changes);return;}
    const shared=changes.filter(change=>change.kind==='event'||change.kind==='routine'||change.kind==='puppy');
    const localReminders=shared.filter(change=>change.kind==='routine'&&care.kind==='temporary'&&change.before&&change.after&&JSON.stringify({...change.before,reminder:false})===JSON.stringify({...change.after,reminder:false}));
    if(shared.length){
      if(care.expiresAt!==null&&care.expiresAt<=Date.now()||await sql.getFirstAsync("SELECT value FROM metadata WHERE key='care_blocked' AND value='1'"))throw new Error('Access to this puppy has ended.');
      for(const change of shared){
        if(change.kind==='puppy'||care.permission==='view'||change.kind==='routine'&&care.kind!=='household'&&!localReminders.includes(change))throw new Error('Your access does not allow this change.');
        if(change.kind==='event'&&change.before!==null){
          const mirror=await sql.getFirstAsync<{body:string}>("SELECT body FROM local_sync_records WHERE json_extract(body,'$.kind')=? AND json_extract(record_id,'$[2]')=?",change.kind,change.localId);
          if(mirror&&cloudRecordSchema.parse(JSON.parse(mirror.body)).editable===false)throw new Error('You can only correct your own logs.');
        }
      }
    }
    // Personal appearance, widget choices and reminder preferences stay on this device.
    await sink(sql,shared.filter(change=>!localReminders.includes(change)));
  };
  const storage=createNativeStorage(database,petId,changed,afterCommit,beforeChange);
  const history={...createEventHistoryQueries(database,petId),restore:(input:EventHistoryRestore)=>sync.restoreEventHistory({...input,petId})};
  const recoverEvents=createLocalRepository(database,petId,care?changed:sync.changeSink(petId,{restoreMissing:true}),afterCommit,beforeChange?(sql)=>beforeChange(sql,'recovery'):undefined).importEvents;
  async function recoverBackup(events:PuppyEvent[],puppy:Pick<ActivityBackup,'petId'|'puppyName'>) {
    if(care)throw new Error('Restore backups from your own puppy profile.');
    const target=identifierSchema.parse(puppy.petId),profile=recordDataSchema('puppy').parse({name:puppy.puppyName}),incoming=parseEvents(events);
    let changed=false;
    const result=await database.write(async sql=>{
      await beforeChange?.(sql,'recovery');
      // Recreate a lost profile with its original identity, without renaming or switching any existing dog.
      const inserted=await sql.runAsync('INSERT INTO puppies(id,name) VALUES (?,?) ON CONFLICT(id) DO NOTHING',target,String(profile.name));
      const {changes,value}=await importEventRecords(sql,target,incoming);
      await sync.changeSink(target,{restoreMissing:true})(sql,changes);
      changed=!!inserted.changes||!!changes.length;
      return value;
    });
    if(changed)notifyLocalCommit(afterCommit);
    return result;
  }
  const checkpoint=(reason:BackupReason)=>database.read(async sql=>{await beforeChange?.(sql,reason);});
  return {database,petId,deviceId,sync,storage,recoverEvents,recoverBackup,checkpoint,activity:createActivityQueries(database,petId),history};
}

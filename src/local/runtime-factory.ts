import { identifierSchema, recordDataSchema } from '../cloud/protocol.ts';
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

export async function createLocalRuntime(database:LocalDatabase,petId:string,afterCommit?:()=>void,beforeChange?:BackupGuard) {
  const deviceId=await database.write(async sql=>{
    await sql.runAsync("INSERT OR IGNORE INTO metadata(key,value) VALUES ('cloud_device_id','dev_' || lower(hex(randomblob(16))))");
    return identifierSchema.parse((await sql.getFirstAsync<{value:string}>("SELECT value FROM metadata WHERE key='cloud_device_id'"))!.value);
  });
  const sync=createLocalSync(database,{afterCommit,beforeChange}),storage=createNativeStorage(database,petId,sync.changeSink(petId),afterCommit,beforeChange);
  const history={...createEventHistoryQueries(database,petId),restore:(input:EventHistoryRestore)=>sync.restoreEventHistory({...input,petId})};
  const recoverEvents=createLocalRepository(database,petId,sync.changeSink(petId,{restoreMissing:true}),afterCommit,beforeChange?(sql)=>beforeChange(sql,'recovery'):undefined).importEvents;
  async function recoverBackup(events:PuppyEvent[],puppy:Pick<ActivityBackup,'petId'|'puppyName'>) {
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

import { identifierSchema } from '../cloud/protocol.ts';
import type { LocalDatabase } from './database.ts';
import { createNativeStorage } from './native-storage.ts';
import { createLocalSync } from './sync-engine.ts';
import { createActivityQueries } from './activity-queries.ts';
import { createEventHistoryQueries } from './event-history.ts';
import { createLocalRepository } from './repository.ts';
import type {EventHistoryRestore} from '../event-history.ts';
import type { BackupGuard, BackupReason } from './activity-backups.ts';

export async function createLocalRuntime(database:LocalDatabase,petId:string,afterCommit?:()=>void,beforeChange?:BackupGuard) {
  const deviceId=await database.write(async sql=>{
    await sql.runAsync("INSERT OR IGNORE INTO metadata(key,value) VALUES ('cloud_device_id','dev_' || lower(hex(randomblob(16))))");
    return identifierSchema.parse((await sql.getFirstAsync<{value:string}>("SELECT value FROM metadata WHERE key='cloud_device_id'"))!.value);
  });
  const sync=createLocalSync(database,{afterCommit,beforeChange}),storage=createNativeStorage(database,petId,sync.changeSink(petId),afterCommit,beforeChange);
  const history={...createEventHistoryQueries(database,petId),restore:(input:EventHistoryRestore)=>sync.restoreEventHistory({...input,petId})};
  const recoverEvents=createLocalRepository(database,petId,sync.changeSink(petId,{restoreMissing:true}),afterCommit,beforeChange?(sql)=>beforeChange(sql,'recovery'):undefined).importEvents;
  const checkpoint=(reason:BackupReason)=>database.read(async sql=>{await beforeChange?.(sql,reason);});
  return {database,petId,deviceId,sync,storage,recoverEvents,checkpoint,activity:createActivityQueries(database,petId),history};
}

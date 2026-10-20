import { identifierSchema } from '../cloud/protocol.ts';
import type { LocalDatabase } from './database.ts';
import { createNativeStorage } from './native-storage.ts';
import { createLocalSync } from './sync-engine.ts';
import { createActivityQueries } from './activity-queries.ts';
import { createEventHistoryQueries } from './event-history.ts';
import type {EventHistoryRestore} from '../event-history.ts';

export async function createLocalRuntime(database:LocalDatabase,petId:string,afterCommit?:()=>void) {
  const deviceId=await database.write(async sql=>{
    await sql.runAsync("INSERT OR IGNORE INTO metadata(key,value) VALUES ('cloud_device_id','dev_' || lower(hex(randomblob(16))))");
    return identifierSchema.parse((await sql.getFirstAsync<{value:string}>("SELECT value FROM metadata WHERE key='cloud_device_id'"))!.value);
  });
  const sync=createLocalSync(database,{afterCommit}),storage=createNativeStorage(database,petId,sync.changeSink(petId),afterCommit);
  const history={...createEventHistoryQueries(database,petId),restore:(input:EventHistoryRestore)=>sync.restoreEventHistory({...input,petId})};
  return {database,petId,deviceId,sync,storage,activity:createActivityQueries(database,petId),history};
}

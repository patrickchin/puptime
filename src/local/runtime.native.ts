import { openLocalDatabase } from './open.native';
import { createLocalRuntime } from './runtime-factory';
import { notifyLocalCommit } from './sync-projection';
import { AppState } from 'react-native';
import { entityId } from '../entity-id';
import { createActivityBackups } from './activity-backups';
import { localBackupFiles } from './backup-files.native';

const listeners=new Set<()=>void>();
let initialized:Promise<Awaited<ReturnType<typeof openRuntime>>>|undefined;
async function openRuntime() {
  const {database,petId}=await openLocalDatabase();
  try {
    let backups: ReturnType<typeof createActivityBackups> | undefined;
    const capture=()=>{void backups?.capture().catch(()=>{/* Recovery settings exposes failures and retry. */});};
    const runtime=await createLocalRuntime(database,petId,()=>{
      for(const listener of listeners)notifyLocalCommit(listener);
      capture();
    });
    backups=createActivityBackups({files:localBackupFiles(),petId,newId:()=>entityId('bkp'),
      read:async()=>({events:await runtime.storage.loadEvents(),puppyName:await runtime.storage.loadPuppyName()}),
      restore:events=>runtime.storage.importEvents(events)});
    capture();
    AppState.addEventListener('change',state=>{if(state==='active')capture();});
    // Covers midnight while the app stays open. Background execution isn't guaranteed by either OS.
    setInterval(()=>{if(AppState.currentState==='active')capture();},60_000);
    return {...runtime,backups};
  } catch(error) {await database.close();throw error;}
}
export function getLocalRuntime() {
  initialized??=openRuntime().catch(error=>{initialized=undefined;throw error;});
  return initialized;
}
export function subscribeLocalWrites(listener:()=>void) {listeners.add(listener);return ()=>{listeners.delete(listener);};}

import { openLocalDatabase } from './open.native';
import { createLocalRuntime } from './runtime-factory';
import { notifyLocalCommit } from './sync-projection';
import { AppState } from 'react-native';

const listeners=new Set<()=>void>();
let initialized:Promise<Awaited<ReturnType<typeof openRuntime>>>|undefined;
async function openRuntime() {
  let runtime: Awaited<ReturnType<typeof createLocalRuntime>>;
  const {database,petId,service,checkpoint}=await openLocalDatabase(events=>runtime.recoverEvents(events));
  try {
    const capture=()=>{void runtime?.checkpoint('daily').catch(()=>{/* Recovery settings exposes failures and retry. */});};
    runtime=await createLocalRuntime(database,petId,()=>{
      for(const listener of listeners)notifyLocalCommit(listener);
      capture();
    },checkpoint);
    const backups={...service,capture:()=>runtime.checkpoint('daily')};
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

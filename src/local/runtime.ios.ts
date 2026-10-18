import { openLocalDatabase } from './open.native';
import { createLocalRuntime } from './runtime-factory';
import { notifyLocalCommit } from './sync-projection';

const listeners=new Set<()=>void>();
let initialized:Promise<Awaited<ReturnType<typeof createLocalRuntime>>>|undefined;
export function getLocalRuntime() {
  initialized??=openLocalDatabase().then(async({database,petId})=>{
    try {return await createLocalRuntime(database,petId,()=>{for(const listener of listeners)notifyLocalCommit(listener);});}
    catch(error) {await database.close();throw error;}
  }).catch(error=>{initialized=undefined;throw error;});
  return initialized;
}
export function subscribeLocalWrites(listener:()=>void) {listeners.add(listener);return ()=>{listeners.delete(listener);};}

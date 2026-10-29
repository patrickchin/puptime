import { openLocalDatabase } from './open.native';
import { createLocalRuntime } from './runtime-factory';
import { notifyLocalCommit } from './sync-projection';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {shareIdSchema,sharedPuppiesSchema,type SharedPuppy} from '../sharing';
import { AppState } from 'react-native';

const listeners=new Set<()=>void>();
const runtimes=new Map<string,Promise<Awaited<ReturnType<typeof openRuntime>>>>();
export type CareSelection=SharedPuppy&{accountId:string};
let selection:CareSelection|null=null;
let loaded:Promise<void>|undefined;
export function getCareSelection(){return selection;}
export async function loadCareSelection(){
  loaded??=AsyncStorage.getItem('puptime.active-care').then(value=>{if(value){try{const parsed=JSON.parse(value);const puppy=sharedPuppiesSchema.shape.puppies.element.parse(parsed);if(typeof parsed.accountId==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(parsed.accountId))selection={...puppy,accountId:parsed.accountId};}catch{}}});
  await loaded;return selection;
}
export async function selectCare(value:CareSelection|null){await loadCareSelection();await AsyncStorage.setItem('puptime.active-care',JSON.stringify(value));selection=value;}
async function openRuntime(care:CareSelection|null) {
  let runtime: Awaited<ReturnType<typeof createLocalRuntime>>;
  const {database,petId,service,checkpoint}=await openLocalDatabase((events,puppy)=>runtime.recoverBackup(events,puppy),care?`puptime-${shareIdSchema.parse(care.id)}-${care.accountId.replace(/[^A-Za-z0-9_-]/g,'')}.db`:'puptime-v2.db');
  try {
    const capture=()=>{void runtime?.checkpoint('daily').catch(()=>{/* Recovery settings exposes failures and retry. */});};
    runtime=await createLocalRuntime(database,petId,()=>{
      for(const listener of listeners)notifyLocalCommit(listener);
      capture();
    },checkpoint,care??undefined);
    const backups={...service,capture:()=>runtime.checkpoint('daily')};
    capture();
    AppState.addEventListener('change',state=>{if(state==='active')capture();});
    // Covers midnight while the app stays open. Background execution isn't guaranteed by either OS.
    setInterval(()=>{if(AppState.currentState==='active')capture();},60_000);
    return {...runtime,backups};
  } catch(error) {await database.close();throw error;}
}
export async function getLocalRuntime() {
  await loadCareSelection();return getRuntimeForCare(selection);
}
export function getRuntimeForCare(care:CareSelection|null){
  const key=care?`${care.accountId}:${care.id}`:'owner';
  let initialized=runtimes.get(key);
  if(!initialized){initialized=openRuntime(care).catch(error=>{runtimes.delete(key);throw error;});runtimes.set(key,initialized);}
  return initialized;
}
export function subscribeLocalWrites(listener:()=>void) {listeners.add(listener);return ()=>{listeners.delete(listener);};}

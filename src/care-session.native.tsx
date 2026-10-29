import {createContext,useContext,useEffect,useState,type ReactNode} from 'react';
import {ActivityIndicator,View,Text,Pressable} from 'react-native';
import {getCareSelection,getRuntimeForCare,loadCareSelection,selectCare,type CareSelection} from './local/runtime.native';
import {createNativeCloudClient} from './cloud/auth.native';
import {createSyncRunner} from './cloud/runner';
import {entityId} from './entity-id';
import type {SharedPuppy} from './sharing';
import type {createLocalRuntime} from './local/runtime-factory';
export type {CareSelection};
export type CareSession={selection:CareSelection|null;runtime?:Awaited<ReturnType<typeof createLocalRuntime>>;key:string;activate:(puppy:SharedPuppy,accountId:string)=>Promise<void>;leave:()=>Promise<void>;isCurrent:()=>boolean};
export const CareContext=createContext<CareSession>({selection:null,key:'owner',activate:async()=>{},leave:async()=>{},isCurrent:()=>true});
export const useCareSession=()=>useContext(CareContext);
export function CareSessionHost({children}:{children:ReactNode}){
 const [session,setSession]=useState<CareSession|null>(null),[error,setError]=useState(false);
 async function show(selection:CareSelection|null){
  const runtime=await getRuntimeForCare(selection),key=selection?`${selection.accountId}:${selection.id}`:'owner';
  await selectCare(selection);
  setSession({selection,runtime,key,activate,leave:()=>show(null),isCurrent:()=>getCareSelection()?.id===selection?.id});
 }
 async function activate(puppy:SharedPuppy,accountId:string){
  const selection={...puppy,accountId},runtime=await getRuntimeForCare(selection),client=createNativeCloudClient(selection);
  if(!client)throw new Error('Cloud is unavailable.');
  // Recheck membership before opening a cached puppy; initial restoration uses
  // the same resumable baseline and offline outbox as the owner's journal.
  const summary=await client.api.account();if(summary.user.id!==accountId)throw new Error('Account changed.');
  if((await runtime.sync.status(runtime.petId)).state==='local'){
   await runtime.database.write(sql=>sql.runAsync('UPDATE puppies SET name=? WHERE id=?',puppy.name,runtime.petId));
   await runtime.sync.prepareAssociation({accountId,localPetId:runtime.petId,deviceId:runtime.deviceId,mode:'restore',enrollment:{operationId:entityId('csr'),deviceId:runtime.deviceId,localPetId:runtime.petId,confirmedPetId:puppy.petId,name:puppy.name}});
  }
  const runner=createSyncRunner({sync:runtime.sync,api:client.api,petId:runtime.petId,deviceId:runtime.deviceId,sessionAccountId:()=>accountId,changed:()=>{}});
  for(let attempt=0;attempt<100;attempt++){
   const result=await runner.run(new AbortController().signal);
   if(result.state==='synced'||result.state==='blocked')break;
   if(result.state!=='pending')throw new Error('Could not sync this puppy. Try again.');
   if(attempt===99)throw new Error('This history is still downloading. Try again to continue.');
  }
  await runtime.database.write(async sql=>{
   await sql.runAsync("UPDATE metadata SET value='false' WHERE key='show_onboarding'");
   await sql.runAsync("DELETE FROM metadata WHERE key IN ('first_launch_step','care_blocked')");
  });
  await show(selection);
 }
 useEffect(()=>{void loadCareSelection().then(show).catch(()=>setError(true));},[]);
 if(!session)return <View style={{flex:1,alignItems:'center',justifyContent:'center',padding:24}}>{error?<><Text accessibilityRole="alert">Couldn’t open puppy records.</Text><Pressable accessibilityRole="button" style={{padding:16}} onPress={()=>{setError(false);void loadCareSelection().then(show).catch(()=>setError(true));}}><Text>Try again</Text></Pressable></>:<ActivityIndicator accessibilityLabel="Opening puppy records"/>}</View>;
 return <CareContext.Provider value={session}>{children}</CareContext.Provider>;
}

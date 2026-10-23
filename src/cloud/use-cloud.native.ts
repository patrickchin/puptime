import { useCallback,useEffect,useRef,useState } from 'react';
import { AppState } from 'react-native';
import * as Network from 'expo-network';
import { watchAccountChanges } from './change-subscription';
import { createNativePhotoSync } from './photos.native';
import { createNativeCloudClient } from './auth.native';
import { createAccountController,type AccountController } from './account-controller';
import { getLocalRuntime,subscribeLocalWrites } from '../local/runtime.native';
import type { CloudHandle } from './handle';
export type { CloudHandle } from './handle';

const getLocalName=async()=>(await getLocalRuntime()).storage.loadPuppyName();
export function useCloud(onRemoteChange:()=>unknown):CloudHandle {
  const callback=useRef(onRemoteChange);callback.current=onRemoteChange;
  const [attempt,setAttempt]=useState(0),retry=useCallback(()=>setAttempt(value=>value+1),[]);
  const [handle,setHandle]=useState<CloudHandle>({available:true,controller:null,problem:null,getLocalName,retry});
  useEffect(()=>{
    setHandle({available:true,controller:null,problem:null,getLocalName,retry});
    let disposed=false,controller:AccountController|null=null,stopChanges:(()=>void)|null=null;
    let active=AppState.currentState==='active',online=true,networkEvent=false;
    const connectivity=(state:Network.NetworkState)=>state.isConnected!==false&&state.isInternetReachable!==false;
    const appSubscription=AppState.addEventListener('change',state=>{active=state==='active';controller?.setActive(active);});
    const networkSubscription=Network.addNetworkStateListener(state=>{networkEvent=true;online=connectivity(state);controller?.setOnline(online);});
    void (async()=>{
      let client:ReturnType<typeof createNativeCloudClient>;
      try{client=createNativeCloudClient();}catch{if(!disposed)setHandle({available:true,controller:null,problem:'configuration',getLocalName,retry});return;}
      if(!client){if(!disposed)setHandle({available:true,controller:null,problem:'configuration',getLocalName,retry});return;}
      try {
        const [runtime,network]=await Promise.all([getLocalRuntime(),Network.getNetworkStateAsync().catch(()=>null)]);
        if(disposed)return;if(network&&!networkEvent)online=connectivity(network);
        controller=createAccountController({runtime,api:client.api,photos:createNativePhotoSync(client.photoTransfer),identity:client.identity,exportCloud:client.exportCloud,subscribeLocalWrites,changed:()=>{void Promise.resolve(callback.current()).catch(()=>{});}});
        stopChanges=watchAccountChanges({controller,open:client.openChanges});
        controller.setOnline(online);controller.setActive(active);
        setHandle({available:true,controller,problem:null,getLocalName,retry});
        await controller.refresh();
      }catch{if(!disposed)setHandle({available:true,controller:null,problem:'local-storage',getLocalName,retry});}
    })();
    return()=>{disposed=true;stopChanges?.();controller?.stop();appSubscription.remove();networkSubscription.remove();};
  },[attempt,retry]);
  // Store subscriptions live in the Settings/account views. Backlog updates do
  // not rerender the activity screen; only committed remote data refreshes it.
  return handle;
}

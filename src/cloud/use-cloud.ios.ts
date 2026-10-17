import { useEffect,useRef,useState } from 'react';
import { AppState } from 'react-native';
import * as Network from 'expo-network';
import { watchAccountChanges } from './change-subscription';
import { createNativeCloudClient } from './auth.ios';
import { createAccountController,type AccountController } from './account-controller';
import { getLocalRuntime,subscribeLocalWrites } from '../local/runtime.ios';
import type { CloudHandle } from './use-cloud';

const getLocalName=async()=>(await getLocalRuntime()).storage.loadPuppyName();
export function useCloud(onRemoteChange:()=>unknown):CloudHandle {
  const callback=useRef(onRemoteChange);callback.current=onRemoteChange;
  const [handle,setHandle]=useState<CloudHandle>({available:true,controller:null,problem:null,getLocalName});
  useEffect(()=>{
    let disposed=false,controller:AccountController|null=null,stopChanges:(()=>void)|null=null;
    let active=AppState.currentState==='active',online=true,networkEvent=false;
    const connectivity=(state:Network.NetworkState)=>state.isConnected!==false&&state.isInternetReachable!==false;
    const appSubscription=AppState.addEventListener('change',state=>{active=state==='active';controller?.setActive(active);});
    const networkSubscription=Network.addNetworkStateListener(state=>{networkEvent=true;online=connectivity(state);controller?.setOnline(online);});
    void (async()=>{
      let client:ReturnType<typeof createNativeCloudClient>;
      try{client=createNativeCloudClient();}catch{if(!disposed)setHandle({available:true,controller:null,problem:'configuration',getLocalName});return;}
      if(!client){if(!disposed)setHandle({available:true,controller:null,problem:'configuration',getLocalName});return;}
      try {
        const [runtime,network]=await Promise.all([getLocalRuntime(),Network.getNetworkStateAsync().catch(()=>null)]);
        if(disposed)return;if(network&&!networkEvent)online=connectivity(network);
        controller=createAccountController({runtime,api:client.api,identity:client.identity,subscribeLocalWrites,changed:()=>{void Promise.resolve(callback.current()).catch(()=>{});}});
        stopChanges=watchAccountChanges({controller,open:client.openChanges});
        controller.setOnline(online);controller.setActive(active);
        setHandle({available:true,controller,problem:null,getLocalName});
        await controller.refresh();
      }catch{if(!disposed)setHandle({available:true,controller:null,problem:'local-storage',getLocalName});}
    })();
    return()=>{disposed=true;stopChanges?.();controller?.stop();appSubscription.remove();networkSubscription.remove();};
  },[]);
  // Store subscriptions live in the Settings/account views. Backlog updates do
  // not rerender the activity screen; only committed remote data refreshes it.
  return handle;
}

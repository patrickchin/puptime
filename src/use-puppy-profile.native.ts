import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { getLocalRuntime, subscribeLocalWrites } from './local/runtime.native';
import type { PuppyProfile } from './puppy-photo';

export function usePuppyProfile() {
  const [profile,setProfile]=useState<PuppyProfile>(),[failed,setFailed]=useState(false);
  const mounted=useRef(false),sequence=useRef(0);
  const reload=useCallback(async()=>{
    const read=++sequence.current;
    try {
      const next=await (await getLocalRuntime()).storage.loadPuppyProfile();
      if(mounted.current&&read===sequence.current){setProfile(previous=>previous?.name===next.name&&previous?.photo===next.photo?previous:next);setFailed(false);}
    } catch {if(mounted.current&&read===sequence.current)setFailed(true);}
  },[]);
  useEffect(()=>{
    mounted.current=true;void reload();
    const unsubscribe=subscribeLocalWrites(()=>void reload());
    const foreground=AppState.addEventListener('change',state=>{if(state==='active')void reload();});
    return()=>{mounted.current=false;sequence.current++;unsubscribe();foreground.remove();};
  },[reload]);
  return {profile,failed,reload};
}

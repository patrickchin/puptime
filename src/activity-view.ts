import {useCallback,useEffect,useRef,useState} from 'react';
import type {PuppyEvent} from './domain.ts';
import type {ActivityCursor,ActivityQueries} from './local/activity-queries.ts';

export type ActivityViewProps={activity?:ActivityQueries;refreshToken?:number};
export function activityWindowBounds(now:number,previousDays:number){
 const from=new Date(now);from.setHours(0,0,0,0);const until=new Date(from);until.setDate(until.getDate()+1);from.setDate(from.getDate()-previousDays);
 return {from:from.getTime(),until:until.getTime()};
}
export function retainActivityRows(previous:PuppyEvent[],incoming:PuppyEvent[]):PuppyEvent[]{
 const byId=new Map(previous.map(event=>[event.id,event]));
 const next=incoming.map(event=>{
  const old=byId.get(event.id);
  return old&&[...new Set([...Object.keys(old),...Object.keys(event)])].every(key=>Object.is(old[key as keyof PuppyEvent],event[key as keyof PuppyEvent]))?old:event;
 });
 return next.length===previous.length&&next.every((event,index)=>event===previous[index])?previous:next;
}

export function useActivityWindow(activity:ActivityQueries|undefined,fallback:PuppyEvent[],from:number,until:number,refreshToken=0){
 const [state,setState]=useState({events:[] as PuppyEvent[],loading:!!activity,error:false});
 const [attempt,setAttempt]=useState(0);
 useEffect(()=>{
  if(!activity)return;
  let current=true;setState(previous=>({...previous,loading:true,error:false}));
  void activity.eventsBetween(from,until).then(events=>{if(current)setState(previous=>({events:retainActivityRows(previous.events,events),loading:false,error:false}));})
   .catch(()=>{if(current)setState(previous=>({...previous,loading:false,error:true}));});
  return()=>{current=false;};
 },[activity,from,until,refreshToken,attempt]);
 return {...state,events:activity?state.events:fallback,loading:!!activity&&state.loading,error:!!activity&&state.error,retry:useCallback(()=>setAttempt(value=>value+1),[])};
}

export function useActivityPages(activity:ActivityQueries|undefined,fallback:PuppyEvent[],refreshToken=0){
 const [state,setState]=useState({events:[] as PuppyEvent[],next:null as ActivityCursor|null,loading:!!activity,error:false});
 const [attempt,setAttempt]=useState(0),pages=useRef(1),generation=useRef(0),busy=useRef(false),failedMore=useRef(false);
 useEffect(()=>{
  if(!activity)return;
  const current=++generation.current;busy.current=true;failedMore.current=false;setState(previous=>({...previous,loading:true,error:false}));
  void (async()=>{
   let next:ActivityCursor|undefined,events:PuppyEvent[]=[];
   for(let page=0;page<pages.current;page++){
    const result=await activity.eventsPage({before:next});
    if(current!==generation.current)return;
    events.push(...result.events);next=result.next??undefined;if(!next)break;
   }
   if(current===generation.current){busy.current=false;setState(previous=>({events:retainActivityRows(previous.events,events),next:next??null,loading:false,error:false}));}
  })().catch(()=>{if(current===generation.current){busy.current=false;setState(previous=>({...previous,loading:false,error:true}));}});
  return()=>{generation.current++;};
 },[activity,refreshToken,attempt]);
 const loadMore=async()=>{
  if(!activity||!state.next||busy.current)return;
  const current=generation.current;busy.current=true;setState(previous=>({...previous,loading:true,error:false}));
  try{
   const result=await activity.eventsPage({before:state.next});
   if(current!==generation.current)return;
   pages.current++;const ids=new Set(result.events.map(event=>event.id));
   setState(previous=>({events:retainActivityRows(previous.events,[...previous.events.filter(event=>!ids.has(event.id)),...result.events]),next:result.next,loading:false,error:false}));
  }catch{if(current===generation.current){failedMore.current=true;setState(previous=>({...previous,loading:false,error:true}));}}
  finally{if(current===generation.current)busy.current=false;}
 };
 return {...state,events:activity?state.events:fallback,loading:!!activity&&state.loading,error:!!activity&&state.error,loadMore,retry:()=>{if(failedMore.current)void loadMore();else setAttempt(value=>value+1);}};
}

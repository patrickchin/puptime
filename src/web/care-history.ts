import {CareError,type CareClient,type CarePage,type CareRow} from './care-client.ts';
import {reuseCareRows} from '../sharing.ts';

export type CareHistoryState =
  | {kind:'empty'}
  | {kind:'ready'|'refreshing'|'loading-more';page:CarePage;routines:CareRow[];problem:unknown|null}
  | {kind:'unavailable';problem:unknown};

export async function loadCareRoutines(client:Pick<CareClient,'page'>,id:string) {
  const rows:CareRow[]=[];let after=0;
  do {
    const page=await client.page(id,'routine',after);rows.push(...page.records);
    if(page.nextCursor===null)return rows;
    if(after!==0&&page.nextCursor>=after)throw new Error('Routine pagination did not advance.');
    after=page.nextCursor;
  } while(rows.length<1000);
  throw new Error('Too many routines to display.');
}

// One queue owns pagination and refresh. A refresh re-reads the loaded extent,
// including deletions, instead of merging a first page into potentially stale rows.
export function createCareHistory(client:Pick<CareClient,'page'>,id:string) {
  let state:CareHistoryState={kind:'empty'},generation=0,pages=1,queue:Promise<void>=Promise.resolve();
  let refreshing:Promise<void>|null=null,loadingMore:Promise<void>|null=null;
  const listeners=new Set<()=>void>();
  const emit=(next:CareHistoryState)=>{state=next;for(const listener of listeners)listener();};
  function enqueue(kind:'refreshing'|'loading-more') {
    const ticket=generation;
    const task=queue.then(async()=>{
      if(ticket!==generation||!('page' in state))return;
      const previous=state;
      if(kind==='loading-more'&&previous.page.nextCursor===null)return;
      emit({...previous,kind,problem:null});
      try {
        if(kind==='loading-more') {
          const next=await client.page(id,'event',previous.page.nextCursor!);
          if(ticket!==generation)return;
          if(next.nextCursor!==null&&next.nextCursor>=previous.page.nextCursor!)throw new Error('Log pagination did not advance.');
          const ids=new Set(previous.page.records.map(row=>row.record.id));
          pages++;
          emit({kind:'ready',page:{...previous.page,records:[...previous.page.records,...next.records.filter(row=>!ids.has(row.record.id))],nextCursor:next.nextCursor},routines:previous.routines,problem:null});
        } else {
          const routines=loadCareRoutines(client,id);
          // Observe both branches even when one fails.
          const logs=(async()=>{
            let after=0,head:CarePage|undefined;const rows:CareRow[]=[];
            for(let index=0;index<pages;index++) {
              const result=await client.page(id,'event',after);head=result;rows.push(...result.records);
              if(ticket!==generation)return null;
              if(result.nextCursor===null)break;
              if(after!==0&&result.nextCursor>=after)throw new Error('Log pagination did not advance.');
              after=result.nextCursor;
            }
            return {...head!,records:rows};
          })();
          const [page,nextRoutines]=await Promise.all([logs,routines]);
          if(ticket!==generation||!page)return;
          emit({kind:'ready',page:{...page,records:reuseCareRows(previous.page.records,page.records)},routines:reuseCareRows(previous.routines,nextRoutines),problem:null});
        }
      } catch(problem) {
        if(ticket!==generation)return;
        if(problem instanceof CareError&&[401,403,410].includes(problem.status))emit({kind:'unavailable',problem});
        else emit({...previous,kind:'ready',problem});
      }
    });
    queue=task.catch(()=>{});return task;
  }
  return {
    read:()=>state,
    subscribe:(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};},
    reset(){generation++;pages=1;refreshing=null;loadingMore=null;queue=Promise.resolve();emit({kind:'empty'});},
    initialize(page:CarePage,routines:CareRow[]){emit({kind:'ready',page,routines,problem:null});},
    refresh(){
      if(refreshing)return refreshing;
      const task=enqueue('refreshing');refreshing=task;
      void task.finally(()=>{if(refreshing===task)refreshing=null;});return task;
    },
    refreshAfterWrite(){
      // A poll may have read before the write committed. Its response cannot
      // acknowledge that write; queue a new read even when a refresh exists.
      const task=enqueue('refreshing');refreshing=task;
      void task.finally(()=>{if(refreshing===task)refreshing=null;});return task;
    },
    more(){
      if(loadingMore)return loadingMore;
      const task=enqueue('loading-more');loadingMore=task;
      void task.finally(()=>{if(loadingMore===task)loadingMore=null;});return task;
    },
  };
}

import type {ScheduleEntry} from './domain.ts';

// Keep dense chart targets at least 48 points wide; nearby entries share a picker.
export function routineTimelineTargets(entries:ScheduleEntry[],trackWidth:number){
 if(trackWidth<=0)return [];
 const columns=Math.max(1,Math.floor(trackWidth/48)),width=trackWidth/columns;
 const groups=new Map<number,ScheduleEntry[]>();
 for(const entry of [...entries].sort((a,b)=>a.minutes-b.minutes)){
  const column=Math.min(columns-1,Math.floor(entry.minutes/1440*columns));
  const group=groups.get(column)??[];group.push(entry);groups.set(column,group);
 }
 return [...groups].map(([column,entries])=>({entries,left:column*width,width}));
}

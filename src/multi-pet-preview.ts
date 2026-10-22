import type {PuppyEvent,ScheduleEntry} from './domain.ts';

export type PreviewPet={id:string;name:string;detail:string;events:PuppyEvent[];schedule:ScheduleEntry[]};
export type PetLog={petId:string;petName:string;event:PuppyEvent};

// Synthetic history only. Deliberately different routines and frequencies make
// accidental cross-pet projections visible in both the UI and the checks.
export function multiPetFixtures(now=Date.now()):PreviewPet[] {
  return ['Mochi','Maple'].map((name,p)=>{
    const id=`pet_preview_${p}`,events:PuppyEvent[]=[];
    for(let day=0;day<30;day++){
      const start=new Date(now);start.setDate(start.getDate()-day);start.setHours(0,0,0,0);
      const times=p?[450,480,770,1090,1140]:[420,440,465,565,715,735,780,900,1070,1110,1240];
      times.forEach((minutes,i)=>{
        const at=start.getTime()+(minutes+((day%3)-1)*5)*60_000;
        if(at>now)return;
        const meal=p?i===1||i===4:i===1||i===6||i===9;
        events.push({id:`evt_preview_${p}_${day}_${i}`,type:meal?'meal':i===2||i===8?'poop':'pee',at,source:'app',...(day===0&&i===2?{note:p?'After our morning walk':'Outside, straight after breakfast'}:{})});
      });
    }
    // Recent entries remain visible even when reviewing around midnight.
    events.push({id:`evt_preview_${p}_recent`,type:p?'meal':'pee',at:now-(p?42:12)*60_000,source:'app',note:p?'Finished the whole bowl':'At the garden door'});
    events.sort((a,b)=>b.at-a.at);
    return {id,name,detail:p?'3 years':'12 weeks',events,schedule:[
      {id:`rtn_preview_${p}_1`,type:'pee',minutes:p?450:420,reminder:true},
      {id:`rtn_preview_${p}_2`,type:'meal',minutes:p?480:450,reminder:true,toleranceMinutes:15},
      {id:`rtn_preview_${p}_3`,type:'poop',minutes:p?510:480,reminder:false,toleranceMinutes:20},
      ...(!p?[{id:'rtn_preview_0_4',type:'meal' as const,minutes:750,reminder:true,toleranceMinutes:15}]:[]),
      {id:`rtn_preview_${p}_5`,type:'meal',minutes:p?1110:1080,reminder:true,toleranceMinutes:20},
    ]};
  });
}

export function householdLogs(pets:PreviewPet[],petId?:string):PetLog[]{
  return pets.filter(pet=>!petId||pet.id===petId)
    .flatMap(pet=>pet.events.map(event=>({petId:pet.id,petName:pet.name,event})))
    .sort((a,b)=>b.event.at-a.event.at||a.petId.localeCompare(b.petId)||a.event.id.localeCompare(b.event.id));
}

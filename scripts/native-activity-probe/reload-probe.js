// Qualification only: never imported by the ordinary Metro configuration.
import {File,Paths} from 'expo-file-system';
const file=new File(Paths.document,'history-reload-probe.json'),state={events:[],dropped:0};
const events=new Set(['state','touch-start','touch-end','handler','press-in','press-out','press']);
try{file.create({overwrite:true});file.write(JSON.stringify(state));}catch{}
export function recordReload(event,detail={}){
 try{
  if(!events.has(event))return;
  const row={event,at:Date.now()};
  for(const key of ['savingRef','selected','confirm','changed','saving','disabled'])if(typeof detail[key]==='boolean')row[key]=detail[key];
  for(const key of ['x','y'])if(Number.isFinite(detail[key]))row[key]=Math.round(detail[key]);
  if(state.events.length<256)state.events.push(row);else state.dropped++;
  file.write(JSON.stringify(state));
 }catch{/* Observation must not prevent the original control from running. */}
}

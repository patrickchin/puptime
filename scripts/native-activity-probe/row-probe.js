import {File,Paths} from 'expo-file-system';
const file=new File(Paths.document,'row-render-probe.json'),state={renders:{}};let scheduled=false;
file.create({overwrite:true});file.write(JSON.stringify(state));
export function recordEventRow(id){state.renders[id]=(state.renders[id]||0)+1;if(!scheduled){scheduled=true;setTimeout(()=>{scheduled=false;file.write(JSON.stringify(state));},0);}}

const timelineFile=new File(Paths.document,'timeline-render-probe.json'),timeline={date:{},track:{}};let timelineScheduled=false;
timelineFile.create({overwrite:true});timelineFile.write(JSON.stringify(timeline));
export function recordTimelineRender(kind,key){timeline[kind][key]=(timeline[kind][key]||0)+1;if(!timelineScheduled){timelineScheduled=true;setTimeout(()=>{timelineScheduled=false;timelineFile.write(JSON.stringify(timeline));},0);}}

const phasesFile=new File(Paths.document,'sql-phase-probe.json'),phases=[];
phasesFile.create({overwrite:true});phasesFile.write('[]');
export function recordSqlPhase(name){phases.push({name,at:Date.now()});phasesFile.write(JSON.stringify(phases));}

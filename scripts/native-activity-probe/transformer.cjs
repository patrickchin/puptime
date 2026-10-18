const root=require('node:path').resolve(__dirname,'../..');
const upstream=require(root+'/node_modules/@expo/metro-config/build/babel-transformer.js');
const observer=require('node:path').join(__dirname,'row-probe');
function inject(src,name,marker,line){
 const start=src.indexOf('function '+name+'('),at=src.indexOf(marker,start),next=src.indexOf('\nfunction ',start+10);
 if(start<0||at<0||(next>=0&&at>next))throw new Error('Native render observer target changed: '+name);
 return src.slice(0,at)+line+'\n'+src.slice(at);
}
module.exports={...upstream,transform(args){
 const file=require('node:path').resolve(root,args.filename);
 if(file===root+'/src/components/EventRow.tsx'){
  const marker='  const { activityColors, eventPastLabel, t } = useLocalization();';
  if(args.src.split(marker).length!==2)throw new Error('EventRow render observer target changed.');
  args={...args,src:'import {recordEventRow} from '+JSON.stringify(observer)+';\n'+args.src.replace(marker,'  recordEventRow(event.id);\n'+marker)};
 }else if(file===root+'/src/local/activity-queries.ts'){
  const prefix='return database.read(async sql=>(await sql.getAllAsync<Row>(`SELECT * FROM events WHERE pet_id=? AND at>=? AND at<?';
  const suffix='petId,from,until,petId,from,petId,from,from)).map(materialize));';
  if(!args.src.includes(prefix)||!args.src.includes(suffix))throw new Error('Date-query phase observer target changed.');
  args={...args,src:'import {recordSqlPhase} from '+JSON.stringify(observer)+';\n'+args.src
   .replace(prefix,"return database.read(async sql=>{recordSqlPhase('date-query-start');const rows=await sql.getAllAsync<Row>(`SELECT * FROM events WHERE pet_id=? AND at>=? AND at<?")
   .replace(suffix,"petId,from,until,petId,from,petId,from,from);recordSqlPhase('date-query-done');const events=rows.map(materialize);recordSqlPhase('date-decode-done');return events;});")};
 }else if(file===root+'/src/screens/TimelineScreen.tsx'){
  let src=inject(args.src,'TimelineDateLabel','  const { activityLabel, language, t } = useLocalization();',"  recordTimelineRender('date',day.key);");
  src=inject(src,'TimelineTrack','  const { activityColors, activityLabel, language, t } = useLocalization();',"  recordTimelineRender('track',day.key);");
  args={...args,src:'import {recordTimelineRender} from '+JSON.stringify(observer)+';\n'+src};
 }
 return upstream.transform(args);
}};

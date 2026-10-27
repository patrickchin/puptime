// Local native UI qualification ONLY. This deterministic fixture is not an AI
// model and is never imported by the Worker or application entry points.
import {createServer} from 'node:http';
import {assistantRequestSchema,validateAssistantPlan} from '../src/assistant.ts';
const port=Number(process.argv[2]??8893);
createServer(async(req,res)=>{
  res.setHeader('content-type','application/json');
  const send=(status,value)=>{res.writeHead(status);res.end(JSON.stringify(value));};
  if(req.url==='/api/config')return send(200,{protocolVersion:1,providers:{email:true,apple:false,google:false}});
  if(req.url==='/api/account')return send(401,{error:'unauthorized'});
  if(req.url==='/api/assistant/status')return send(200,{available:true});
  if(req.url!=='/api/assistant/plan'||req.method!=='POST')return send(404,{error:'fixture_not_found'});
  try{
    let body='';for await(const chunk of req){body+=chunk;if(body.length>65536)throw new Error();}
    const input=assistantRequestSchema.parse(JSON.parse(body));
    const text=input.text.toLowerCase().trim(),base={kind:'log',puppyId:input.puppy.id,at:input.now-3600000,endedAt:null,customLabel:null,note:null};
    let plan={reply:'Which activity would you like to log?',needsClarification:true,actions:[]};
    if(text==='ellie peed and pooped an hour ago. her poop was runny.')plan={reply:'Log a pee and a poop for Ellie an hour ago, with a note on the poop.',needsClarification:false,actions:[{...base,type:'pee'},{...base,type:'poop',note:'Her poop was runny.'}]};
    else if(text==='ellie ate an hour ago')plan={reply:'Log Ellie’s meal an hour ago.',needsClarification:false,actions:[{...base,type:'meal'}]};
    else if(text==='turn off confirmations')plan={reply:'Turn off review before saving.',needsClarification:false,actions:[{kind:'set_confirmation',enabled:false}]};
    else if(text==='turn on confirmations')plan={reply:'Turn on review before saving.',needsClarification:false,actions:[{kind:'set_confirmation',enabled:true}]};
    else if(text==='open my insights')plan={reply:'Open Insights.',needsClarification:false,actions:[{kind:'navigate',screen:'insights'}]};
    else if(text==='open my settings')plan={reply:'Open Settings.',needsClarification:false,actions:[{kind:'navigate',screen:'settings'}]};
    else if(text==='add a note to the last poop: after breakfast'){
      const event=input.recentEvents.find(event=>event.type==='poop');
      if(event)plan={reply:'Add a note to Ellie’s last poop.',needsClarification:false,actions:[{kind:'edit_log',puppyId:input.puppy.id,eventId:event.id,at:null,endedAt:null,note:'After breakfast'}]};
    }else if(text==='simulate failure')return send(503,{error:'synthetic_failure'});
    send(200,validateAssistantPlan(plan,input));
  }catch{send(400,{error:'invalid_fixture_request'});}
}).listen(port,'127.0.0.1',()=>console.log(`Synthetic assistant fixture: http://127.0.0.1:${port}`));

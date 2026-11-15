// Outcome-only projection of already captured, private pre-auth Maestro data.
import {closeSync,constants,fstatSync,lstatSync,openSync,readSync,readdirSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {basename,join} from 'node:path';
import notices from '../src/font-icon-notices.json' with {type:'json'};

const unknown=()=>({status:'UNKNOWN'}),limit=2*1024*1024;
const sections=['red-hat','material-community-icons','apache-2','expo-vector-icons','react-native-vector-icons'];
const ids=['screen.fontLicenses','fontLicenses.body',...sections.map(id=>'fontLicenses.'+id)];
const bodies=new Map(notices.filter(section=>sections.includes(section.id)).map(section=>[section.body,section.id]));
// JSON.parse cannot reject duplicate object keys. Use stdlib validation only;
// the child receives bytes on stdin and emits one constant, never a tree/error.
const uniqueJson=`import json,sys
def unique(pairs):
 d={}
 for k,v in pairs:
  if k in d: raise ValueError()
  d[k]=v
 return d
try:
 json.loads(sys.stdin.buffer.read(2097153),object_pairs_hook=unique)
 sys.stdout.write('valid')
except Exception: sys.exit(2)
`;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype;
function rect(value){
 if(typeof value!=='string'||value.length>80)return;
 const match=/^\[(-?\d{1,5}),(-?\d{1,5})\]\[(-?\d{1,5}),(-?\d{1,5})\]$/.exec(value);
 if(!match||match[0]!==value)return;
 const [x,y,right,bottom]=match.slice(1).map(Number);
 if([x,y,right,bottom].some(value=>Math.abs(value)>32768)||right<x||bottom<y)return;
 return {x,y,width:right-x,height:bottom-y};
}
function intersection(a,b){
 const x=Math.max(a.x,b.x),y=Math.max(a.y,b.y);
 return {x,y,width:Math.max(0,Math.min(a.x+a.width,b.x+b.width)-x),height:Math.max(0,Math.min(a.y+a.height,b.y+b.height)-y)};
}
const nonempty=value=>value&&value.x>=0&&value.y>=0&&value.width>0&&value.height>0;

export function nativeFontNoticeOutcome(root){
 try{
  const found=new Map(ids.map(id=>[id,[]])),pending=[[root,0,false,false]],bodyMatches=[];let nodes=0;
  while(pending.length){
   const [node,depth,inModal,inBody]=pending.pop();
   if(++nodes>4096||depth>64||!object(node))return unknown();
   const attrs=node.attributes??{},children=node.children??[];
   if(!object(attrs)||!Array.isArray(children)||children.length>4096||Object.values(attrs).some(value=>typeof value!=='string'))return unknown();
   const id=attrs['resource-id'],modal=inModal||id==='screen.fontLicenses',body=inBody||id==='fontLicenses.body';
   if(found.has(id)){
    if((id==='fontLicenses.body'&&!inModal)||(id.startsWith('fontLicenses.')&&id!=='fontLicenses.body'&&!inBody))return unknown();
    const values=found.get(id);values.push(rect(attrs.bounds));if(values.length>1)return unknown();
   }
   if(inBody){
    const matched=new Set(['text','accessibilityText','value'].map(key=>bodies.get(attrs[key])).filter(Boolean));
    if(matched.size>1)return unknown();
    if(matched.size===1)bodyMatches.push({section:[...matched][0],rect:rect(attrs.bounds)});
   }
   pending.push(...children.map(child=>[child,depth+1,modal,body]));
  }
  const modal=found.get('screen.fontLicenses')[0],body=found.get('fontLicenses.body')[0];
  if(!nonempty(modal)||!nonempty(body))return unknown();
  const viewport=intersection(modal,body);if(!nonempty(viewport))return unknown();
  const controls=Object.fromEntries(ids.map(id=>{
   const value=found.get(id)[0],clipped=value&&intersection(value,id==='screen.fontLicenses'?modal:viewport);
   return [id,nonempty(clipped)?{count:1,intersection:clipped}:'UNKNOWN'];
  }));
  if(bodyMatches.some(value=>!value.rect))return unknown();
  const matching=bodyMatches.filter(value=>nonempty(intersection(value.rect,viewport)));
  if(matching.length>1)return unknown();
  return {status:'KNOWN',controls,staticBodySection:matching[0]?.section??'UNKNOWN'};
 }catch{return unknown();}
}

export function readNativeFontNoticeOutcome(directory,command){
 let descriptor;
 try{
  if(command?.status!=='FAILED'||command.kind!=='scroll'||command.targetId!=='fontLicenses.react-native-vector-icons'||!Number.isSafeInteger(command.sequence)||command.sequence<0||command.sequence>999999)return unknown();
  const root=lstatSync(directory);if(!root.isDirectory()||root.isSymbolicLink())return unknown();
  // Pinned2.11 StepArtifactNaming.stem uses actual metadata.sequenceNumber+1.
  const stem='step-'+String(command.sequence+1).padStart(3,'0'),pending=[[directory,0]],files=[];let entries=0;
  while(pending.length){
   const [path,depth]=pending.pop();
   for(const entry of readdirSync(path,{withFileTypes:true})){
    if(++entries>1024||entry.isSymbolicLink())return unknown();
    const child=join(path,entry.name);
    if(entry.isDirectory()){if(depth>=4)return unknown();pending.push([child,depth+1]);}
    else if(basename(path)==='screen-hierarchy'&&(entry.name===stem+'.json'||entry.name.startsWith(stem+'-')&&entry.name.endsWith('.json'))){
     if(!entry.isFile())return unknown();files.push(child);if(files.length>1)return unknown();
    }
   }
  }
  if(files.length!==1)return unknown();
  descriptor=openSync(files[0],constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  const before=fstatSync(descriptor);if(!before.isFile()||before.size<=0||before.size>limit)return unknown();
  const bytes=Buffer.alloc(before.size+1),length=readSync(descriptor,bytes,0,bytes.length,0),after=fstatSync(descriptor);
  if(length!==before.size||after.size!==before.size||after.mtimeMs!==before.mtimeMs)return unknown();
  if(execFileSync('python3',['-I','-c',uniqueJson],{input:bytes.subarray(0,length),encoding:'utf8',timeout:2000,maxBuffer:16,stdio:['pipe','pipe','ignore']})!=='valid')return unknown();
  return nativeFontNoticeOutcome(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,length))));
 }catch{return unknown();}
 finally{if(descriptor!==undefined)try{closeSync(descriptor);}catch{}}
}

export function recordNativeFontNoticeOutcome({fontNotices,name,env,flowSequence,command,artifacts,output}){
 if(!fontNotices||name!=='rich-notices'||env?.NOTICE_ACTION!=='view'||!['light','dark'].includes(env.NOTICE_THEME)||!Number.isSafeInteger(flowSequence)||flowSequence<1||flowSequence>10000)return;
 try{writeFileSync(join(output,'font-notice-outcome.json'),JSON.stringify({stage:'failure-outcome',theme:env.NOTICE_THEME,flowSequence,projection:readNativeFontNoticeOutcome(artifacts,command)},null,2)+'\n',{mode:0o600});}catch{/* Never mask the actual driver failure or interrupt its cleanup. */}
}

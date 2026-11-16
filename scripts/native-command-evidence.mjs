// Importing performs no I/O. Producer-only reads never expose raw Maestro data.
import {closeSync,constants,fstatSync,lstatSync,openSync,readSync,readdirSync,realpathSync} from 'node:fs';
import {join} from 'node:path';

const unknown=()=>({status:'UNKNOWN',kind:'unknown',targetId:null,sequence:0});
// Fixed command kinds/targets only. The structured file stays private; do not
// inspect text, input, evaluated commands, errors, paths or stack traces here.
const commandKinds={assertConditionCommand:'assert',tapOnElement:'tap',scrollUntilVisible:'scroll',inputTextCommand:'input',launchAppCommand:'launch',stopAppCommand:'stop',waitForAnimationToEndCommand:'animation',takeScreenshotCommand:'screenshot',eraseTextCommand:'erase',backPressCommand:'back',applyConfigurationCommand:'configuration',defineVariablesCommand:'variables'};
const commandContainers=new Set(['runFlowCommand','repeatCommand','retryCommand']);
const commandTargets=new Set(['screen.today','nav.open','nav.close','nav.settings','screen.settings','settings.theme.open','appearance.theme.light','appearance.theme.dark','appearance.theme.system','appearance.modal','appearance.close','settings.search','settings.fontLicenses.open','screen.fontLicenses','fontLicenses.body','fontLicenses.red-hat','fontLicenses.material-community-icons','fontLicenses.apache-2','fontLicenses.expo-vector-icons','fontLicenses.react-native-vector-icons','fontLicenses.close','settings.search.clear','settings.back','screen.account','nav.account','account.enable','account.status','account.local.count','account.combine.dialog','account.combine.confirm','account.email.input','account.code.input','account.sendCode','account.verify','account.refresh','account.error','account.identity','account.signOut','account.connection.phone.name','account.connection.phone.count','account.connection.cloud.name','account.connection.cloud.count','account.combine.phone.name','account.combine.phone.count','account.combine.cloud.name','account.combine.cloud.count','account.combine.cancel','account.keepLocal','nav.drawer','nav.notifications','nav.schedule','onboarding.skip','onboarding.spotlight','onboarding.step.0','preview.back','preview.continue','preview.guest','preview.planTimeline','preview.poopMealTime.0','preview.poopTimes','preview.profile','preview.prompt','preview.ready','preview.reminders.later','preview.sharing','preview.skip','preview.welcome','schedule.entry.meal','screen.notifications','screen.schedule','settings.guide.open','settings.notifications.permission']);
export function nativeCommandState(records){
 if(!Array.isArray(records)||records.length>10000)return unknown();
 const candidates=records.map(record=>{
  const command=record?.command,keys=command&&typeof command==='object'&&!Array.isArray(command)?Object.keys(command):[];
  return {status:record?.metadata?.status,command,key:keys.length===1?keys[0]:null,sequence:record?.metadata?.sequenceNumber};
 }).filter(record=>['FAILED','RUNNING'].includes(record.status)&&!commandContainers.has(record.key));
 // Competing leaf states have no unambiguous causal boundary, in either order.
 if(candidates.length!==1)return unknown();
 const {status,command,key,sequence}=candidates[0];
 if(!Object.hasOwn(commandKinds,key)||!Number.isSafeInteger(sequence)||sequence<0)return unknown();
 const value=command[key];let id;
 if(key==='tapOnElement'||key==='scrollUntilVisible')id=value?.selector?.idRegex;
 if(key==='assertConditionCommand'){
  const condition=value?.condition,selectors=[condition?.visible,condition?.notVisible].filter(value=>value!==undefined);
  if(selectors.length===1)id=selectors[0]?.idRegex;
 }
 return {status,kind:commandKinds[key],targetId:commandTargets.has(id)?id:null,sequence};
}

// Maestro cli-2.11.0 writes per-flow commands.json and records COMMAND_METADATA
// relativePath=commands.json in manifest.json (ArtifactsGenerator/BundleLayout).
// Only this exact filename is recognized; missing/ambiguous output stays UNKNOWN.
export function readNativeCommandState(privateOutputDirectory){
 let descriptor;
 try{
  if(!lstatSync(privateOutputDirectory).isDirectory())return unknown();
  const root=realpathSync(privateOutputDirectory),pending=[[root,0]],files=[];let entries=0;
  while(pending.length){
   const [directory,depth]=pending.pop();
   for(const entry of readdirSync(directory,{withFileTypes:true})){
    if(++entries>1024||entry.isSymbolicLink())return unknown();
    const path=join(directory,entry.name);
    if(entry.isDirectory()){if(depth>=4)return unknown();pending.push([path,depth+1]);}
    else if(entry.name==='commands.json'){
     if(!entry.isFile())return unknown();files.push(path);if(files.length>1)return unknown();
    }
   }
  }
  if(files.length!==1)return unknown();
  descriptor=openSync(files[0],constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  const file=fstatSync(descriptor),limit=2*1024*1024;
  if(!file.isFile()||file.size>limit)return unknown();
  const bytes=Buffer.alloc(limit+1),length=readSync(descriptor,bytes,0,bytes.length,0);
  if(length!==file.size||length>limit||fstatSync(descriptor).size!==length)return unknown();
  return nativeCommandState(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,length))));
 }catch{return unknown();}
 finally{if(descriptor!==undefined)closeSync(descriptor);}
}

// cli-2.11.0 c8c361be: fixed YAML path -> literal sanitized flow-name directory.
export const nativeFlowSources=Object.freeze({
 standard13:Object.freeze([
  Object.freeze([".maestro/ios/00-onboarding.yaml","iOS first-open completes and replays the guide"]),
  Object.freeze([".maestro/ios/00-onboarding-notifications.yaml","iOS first-open notification opt in"]),
  Object.freeze([".maestro/ios/01-navigation.yaml","iOS navigation and empty states"]),
  Object.freeze([".maestro/ios/02-log-crud.yaml","iOS log CRUD, undo, and persistence"]),
  Object.freeze([".maestro/ios/03-simple-log.yaml","iOS simple log and date sections"]),
  Object.freeze([".maestro/ios/04-schedule.yaml","iOS routine create, edit, reminder permission, and remove"]),
  Object.freeze([".maestro/ios/05-settings.yaml","iOS settings and preference persistence"]),
  Object.freeze([".maestro/ios/05b-notifications.yaml","iOS side navigation and notification preferences"]),
  Object.freeze([".maestro/ios/05c-timed-reminders.yaml","iOS custom timed reminder create remove and restart"]),
  Object.freeze([".maestro/ios/06-insights-and-timeline.yaml","iOS populated insights and timeline controls"]),
  Object.freeze([".maestro/ios/07-csv-recovery.yaml","iOS CSV picker cancellation preserves activity"]),
  Object.freeze([".maestro/ios/08-appearance-modes.yaml","Default appearance supports light, dark and the device setting"]),
  Object.freeze([".maestro/guide-audio.yaml","Puppy written guides without restricted narration"]),
 ]),
 conversational17:Object.freeze([
  Object.freeze([".maestro/conversational/01-dismiss-and-navigate.yaml","Conversational onboarding dismisses into normal navigation and persists"]),
  Object.freeze([".maestro/conversational/02-log-from-spotlight.yaml","Spotlight logs through the real button and leaves normal app usable"]),
  Object.freeze([".maestro/conversational/03-skip-optional-setup.yaml","Skipping optional setup and the tour still reaches the normal app"]),
  Object.freeze([".maestro/conversational/04-entry-profile-back.yaml","Email entry and profile edits reach the real app"]),
  Object.freeze([".maestro/conversational/05-ages-meals-and-cancel.yaml","All ages meal counts cancellation and back routes"]),
  Object.freeze([".maestro/conversational/06-meals-only.yaml","Keep meals and skip poop windows"]),
  Object.freeze([".maestro/conversational/07-skip-meals-keep-poop.yaml","Skip meal count and keep adjustable poop windows"]),
  Object.freeze([".maestro/conversational/08-skip-grouped-meals.yaml","Skip grouped meal times and recover using Back"]),
  Object.freeze([".maestro/conversational/09-all-reminder-options.yaml","All reminder timing choices toggles dismissal and persistence"]),
  Object.freeze([".maestro/conversational/10-notifications-allow.yaml","Notification allow reaches the normal app and survives Back"]),
  Object.freeze([".maestro/conversational/11-notifications-deny.yaml","Notification deny reaches the normal app and survives Back"]),
  Object.freeze([".maestro/conversational/12-notifications-blocked.yaml","Notification blocked reaches the normal app and survives Back"]),
  Object.freeze([".maestro/conversational/13-spotlight-pee.yaml","Spotlight pee action uses real logging and persists"]),
  Object.freeze([".maestro/conversational/14-spotlight-poop.yaml","Spotlight poop action uses real logging and persists"]),
  Object.freeze([".maestro/conversational/15-interrupted-setup.yaml","Interrupted setup returns safely to welcome before completion"]),
  Object.freeze([".maestro/conversational/16-native-time-boundaries.yaml","Native hour minute AM PM and midnight windows"]),
  Object.freeze([".maestro/conversational/17-sharing.yaml","Optional temporary sharing finishes setup and offers cloud sign-in"]),
 ]),
});
// Retry failures remain observations, never a terminal/fatal ordering rule.
const untrustedLeaves=()=>({nonCausal:true,complete:false,rows:[]});
function observedLeaves(records){
 if(!Array.isArray(records)||records.length>10000)return untrustedLeaves();
 const leaves=records.filter(record=>{
  const command=record?.command,keys=command&&typeof command==='object'&&!Array.isArray(command)?Object.keys(command):[];
  return ['FAILED','RUNNING'].includes(record?.metadata?.status)&&!commandContainers.has(keys.length===1?keys[0]:null);
 });
 if(leaves.length>8)return untrustedLeaves();
 const rows=leaves.map(record=>nativeCommandState([record]));return {nonCausal:true,complete:rows.every(row=>row.status!=='UNKNOWN'),rows};
}
// A caller must first admit this exact fresh directory identity from its custody
// receipt. One session/known unsuffixed folders only; never select a latest file.
export function readNativeFlowCommandState(root,suite,index,identity){
 const missing=()=>({flowIndex:null,...unknown(),observedLeaves:untrustedLeaves()});let descriptor;
 try{
  const sources=Object.hasOwn(nativeFlowSources,suite)?nativeFlowSources[suite]:undefined;
  if(!sources||!Number.isSafeInteger(index)||index<0||index>=sources.length)return missing();
  const sameRoot=()=>{const value=lstatSync(root);return value.isDirectory()&&!value.isSymbolicLink()&&realpathSync(root)===root&&String(value.dev)===identity?.dev&&String(value.ino)===identity?.ino;};
  if(!sameRoot())return missing();
  const sessions=readdirSync(root,{withFileTypes:true});
  if(sessions.length!==1||!sessions[0].isDirectory()||sessions[0].isSymbolicLink()||!/^\d{4}-\d\d-\d\d_\d{6}$/.test(sessions[0].name))return missing();
  const session=join(root,sessions[0].name),folders=readdirSync(session,{withFileTypes:true}).filter(value=>value.isDirectory());
  if(folders.length!==sources.length||folders.some(value=>!sources.some(([,name])=>name===value.name)))return missing();
  const selected=join(session,sources[index][1],'commands.json'),pending=[[root,0]];let entries=0,matched=0;
  while(pending.length){
   const [directory,depth]=pending.pop();
   for(const entry of readdirSync(directory,{withFileTypes:true})){
    if(++entries>1024||entry.isSymbolicLink())return missing();
    const path=join(directory,entry.name);
    if(entry.isDirectory()){if(depth>=4)return missing();pending.push([path,depth+1]);}
    else if(entry.name==='commands.json'){
     if(!entry.isFile()||!sources.some(([,name])=>path===join(session,name,'commands.json')))return missing();
     if(path===selected)matched++;
    }
   }
  }
  if(matched!==1||!sameRoot())return missing();
  descriptor=openSync(selected,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  const before=fstatSync(descriptor),limit=2*1024*1024;if(!before.isFile()||before.size>limit)return missing();
  const bytes=Buffer.alloc(limit+1);let length=0;
  while(length<bytes.length){const count=readSync(descriptor,bytes,length,bytes.length-length,null);if(!count)break;length+=count;}
  const after=fstatSync(descriptor),current=lstatSync(selected);
  if(!current.isFile()||current.isSymbolicLink()||length!==before.size||length>limit||!sameRoot())return missing();
  for(const field of ['dev','ino','size','mtimeMs','ctimeMs'])if(after[field]!==before[field]||current[field]!==before[field])return missing();
  const records=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,length)));
  return {flowIndex:index,...nativeCommandState(records),observedLeaves:observedLeaves(records)};
 }catch{return missing();}
 finally{if(descriptor!==undefined)closeSync(descriptor);}
}

// Importing performs no I/O. Producer-only reads never expose raw Maestro data.
import {closeSync,constants,fstatSync,lstatSync,openSync,readSync,readdirSync,realpathSync} from 'node:fs';
import {join} from 'node:path';

const unknown=()=>({status:'UNKNOWN',kind:'unknown',targetId:null,sequence:0});
// Fixed command kinds/targets only. The structured file stays private; do not
// inspect text, input, evaluated commands, errors, paths or stack traces here.
const commandKinds={assertConditionCommand:'assert',tapOnElement:'tap',scrollUntilVisible:'scroll',inputTextCommand:'input',launchAppCommand:'launch',stopAppCommand:'stop',waitForAnimationToEndCommand:'animation',takeScreenshotCommand:'screenshot',eraseTextCommand:'erase',backPressCommand:'back',applyConfigurationCommand:'configuration',defineVariablesCommand:'variables'};
const commandContainers=new Set(['runFlowCommand','repeatCommand','retryCommand']);
const commandTargets=new Set(['screen.today','nav.open','nav.close','nav.settings','screen.settings','settings.theme.open','appearance.theme.light','appearance.theme.dark','appearance.theme.system','appearance.modal','settings.search','settings.fontLicenses.open','screen.fontLicenses','fontLicenses.body','fontLicenses.red-hat','fontLicenses.material-community-icons','fontLicenses.apache-2','fontLicenses.expo-vector-icons','fontLicenses.react-native-vector-icons','fontLicenses.close','settings.search.clear','settings.back','screen.account','nav.account','account.enable','account.status','account.local.count','account.combine.dialog','account.combine.confirm','account.email.input','account.code.input','account.sendCode','account.verify','account.refresh','account.error','account.identity','account.signOut']);
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

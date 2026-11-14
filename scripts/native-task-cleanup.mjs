// Own only resources created by this task. Importing this module performs no I/O.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {chmodSync,cpSync,existsSync,lstatSync,mkdirSync,readFileSync,readdirSync,statSync,writeFileSync} from 'node:fs';
import {dirname,isAbsolute,join,relative} from 'node:path';

export function installTaskCleanup(cleanup){
 let pending,signal=null;
 const run=()=>pending??=Promise.resolve().then(cleanup);
 const handlers=new Map(['SIGINT','SIGTERM'].map(name=>[name,()=>{if(signal)return;signal=name;void run().finally(()=>process.exit(name==='SIGINT'?130:143));}]));
 for(const [name,handler] of handlers)process.on(name,handler);
 return {run,get signal(){return signal;},dispose(){for(const [name,handler] of handlers)process.off(name,handler);}};
}

// Call immediately after spawning with detached:true; never signal a shared group.
export function ownProcess(child,{graceMs=5000,killMs=1000}={}){
 const group=child.pid;let stopping;
 assert.ok(group===undefined||Number.isInteger(group)&&group>0,'Capture one successfully spawned detached process group.');
 const exists=()=>{try{process.kill(-group,0);return true;}catch(error){return error.code!=='ESRCH';}};
 const wait=async ms=>{const deadline=Date.now()+ms;while(exists()&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,25));};
 return ()=>stopping??=(async()=>{
  if(!group||!exists())return true;
  // A launcher can exit before an ignored-stdio descendant. Its captured
  // detached group still belongs to this task until the last member exits.
  try{process.kill(-group,'SIGTERM');}catch{}
  await wait(graceMs);
  if(exists()){try{process.kill(-group,'SIGKILL');}catch{}await wait(killMs);}
  return !exists();
 })();
}

export function deleteOwnedSimulator({device,privateDirectory,preserve=false,command=(...args)=>execFileSync('xcrun',['simctl',...args],{encoding:'utf8',timeout:30000,stdio:['ignore','pipe','pipe']}).trim()}){
 assert.match(device,/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i,'Use one captured task UUID, never a global simulator selector.');
 const app='com.patrickchin.puptime',group='group.com.patrickchin.puptime',sources=[];
 if(preserve){
  try{sources.push(['Documents',join(command('get_app_container',device,app,'data'),'Documents')]);}catch{}
  try{const root=command('get_app_container',device,app,group);sources.push(['AppGroup/Preferences',join(root,'Library/Preferences')],['AppGroup/Widgets',join(root,'ExpoWidgets')]);}catch{}
 }
 try{command('terminate',device,app);}catch{}
 try{command('shutdown',device);}catch{}
 let files=0,bytes=0,truncated=false,archiveFailed=false;
 if(preserve&&sources.length){
  try{
   assert.ok(isAbsolute(privateDirectory)&&(statSync(privateDirectory).mode&0o077)===0,'Failure state must remain in an owned private directory.');
   const destination=join(privateDirectory,'failed-simulator-'+device);mkdirSync(destination,{recursive:true,mode:0o700});
   for(const [label,root] of sources){
    if(!existsSync(root))continue;
    for(const entry of readdirSync(root,{recursive:true,withFileTypes:true}).filter(entry=>entry.isFile())){
     const path=join(entry.parentPath??entry.path,entry.name),name=relative(root,path);
     if(lstatSync(path).isSymbolicLink()||/(^|\/)keychains?(\/|$)/i.test(name))continue;
     const size=statSync(path).size;if(files>=500||bytes+size>64*1024*1024){truncated=true;continue;}
     const target=join(destination,label,name);mkdirSync(dirname(target),{recursive:true,mode:0o700});cpSync(path,target);chmodSync(target,0o600);
     assert.ok(readFileSync(path).equals(readFileSync(target)),'Verify the bounded private failure copy before deleting its simulator.');files++;bytes+=size;
    }
   }
   writeFileSync(join(destination,'evidence.json'),JSON.stringify({files,bytes,truncated,archiveFailed:false,keychainCopied:false},null,2)+'\n',{mode:0o600});
  }catch{archiveFailed=true;}
 }
 let deleted=true;try{command('delete',device);}catch{deleted=false;}
 return {device,deleted,privateFailureFiles:files,privateFailureBytes:bytes,truncated,archiveFailed,keychainCopied:false};
}

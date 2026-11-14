import assert from 'node:assert/strict';
import test from 'node:test';
import {spawn} from 'node:child_process';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,statSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {deleteOwnedSimulator,ownProcess} from './native-task-cleanup.mjs';

const device='00000000-0000-0000-0000-000000000001';
test('failure evidence precedes scoped deletion and excludes keychain/symlink data',()=>{
 const root=mkdtempSync(join(tmpdir(),'puptime-cleanup-proof-')),data=join(root,'app'),group=join(root,'group'),privateDirectory=join(root,'private');
 try{
  for(const path of [join(data,'Documents/Keychain'),join(group,'Library/Preferences'),privateDirectory])mkdirSync(path,{recursive:true,mode:0o700});
  writeFileSync(join(data,'Documents/history.db'),'synthetic history');writeFileSync(join(data,'Documents/Keychain/secret'),'excluded');
  writeFileSync(join(group,'Library/Preferences/widgets.plist'),'synthetic widget state');symlinkSync(join(data,'Documents/Keychain/secret'),join(data,'Documents/link'));
  const calls=[],command=(...args)=>{calls.push(args);if(args[0]==='get_app_container')return args[3]==='data'?data:group;
   if(args[0]==='delete'){const archive=join(privateDirectory,'failed-simulator-'+device);assert.equal(readFileSync(join(archive,'Documents/history.db'),'utf8'),'synthetic history');assert.ok(!existsSync(join(archive,'Documents/Keychain')));assert.ok(!existsSync(join(archive,'Documents/link')));assert.equal(statSync(join(archive,'Documents/history.db')).mode&0o777,0o600);}return '';};
  const receipt=deleteOwnedSimulator({device,privateDirectory,preserve:true,command});
  assert.equal(receipt.deleted,true);assert.equal(receipt.privateFailureFiles,2);assert.equal(receipt.keychainCopied,false);
  assert.ok(calls.every(args=>args[1]===device));assert.deepEqual(calls.slice(-3).map(args=>args[0]),['terminate','shutdown','delete']);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('archive failure still deletes only the owned device; global selectors reject',()=>{
 const root=mkdtempSync(join(tmpdir(),'puptime-cleanup-failure-'));let deleted=false;
 try{
  mkdirSync(join(root,'data/Documents'),{recursive:true});writeFileSync(join(root,'data/Documents/history.db'),'fixture');
  const receipt=deleteOwnedSimulator({device,privateDirectory:join(root,'missing'),preserve:true,command:(...args)=>{if(args[0]==='get_app_container')return join(root,'data');if(args[0]==='delete')deleted=true;return '';}});
  assert.equal(deleted,true);assert.equal(receipt.archiveFailed,true);
  for(const name of ['all','booted','invalid'])assert.throws(()=>deleteOwnedSimulator({device:name,command:()=>assert.fail('No global/native command is allowed.')}));
 }finally{rmSync(root,{recursive:true,force:true});}
});

const moduleURL=pathToFileURL(resolve('scripts/native-task-cleanup.mjs')).href;
for(const mode of ['success','failure','SIGINT','SIGTERM'])test('owned child tree and fake simulator cleanup on '+mode,async()=>{
 const root=mkdtempSync(join(tmpdir(),'puptime-cleanup-signal-')),script=join(root,'fixture.mjs'),receipt=join(root,'receipt.json');
 const tree="const{spawn}=require('node:child_process');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});let closed=false;child.once('close',()=>{closed=true;});process.on('SIGTERM',()=>{if(closed)process.exit(0);else child.once('close',()=>process.exit(0));});console.log(child.pid);setInterval(()=>{},1000);";
 writeFileSync(script,`import{spawn}from'node:child_process';import{writeFileSync}from'node:fs';import{installTaskCleanup,ownProcess,deleteOwnedSimulator}from${JSON.stringify(moduleURL)};
 const child=spawn(process.execPath,['-e',${JSON.stringify(tree)}],{detached:true,stdio:['ignore','pipe','ignore']});const stop=ownProcess(child,{graceMs:1000});let calls=0;
 const task=installTaskCleanup(async()=>{const stopped=await stop();const commands=[];const simulator=deleteOwnedSimulator({device:${JSON.stringify(device)},command:(...args)=>{commands.push(args);return '';}});writeFileSync(process.argv[3],JSON.stringify({stopped,commands,simulator,calls:++calls}));});
 await new Promise(resolve=>child.stdout.once('data',data=>{console.log(JSON.stringify({ready:true,child:child.pid,grandchild:Number(String(data).trim())}));resolve();}));
 if(process.argv[2].startsWith('SIG'))await new Promise(()=>{});else{try{if(process.argv[2]==='failure')throw new Error('expected fixture failure');}finally{await Promise.all([task.run(),task.run()]);task.dispose();}}
 `);
 let fixture;
 try{
  fixture=spawn(process.execPath,[script,mode,receipt],{stdio:['ignore','pipe','pipe']});let errors='';fixture.stderr.on('data',data=>{errors+=data;});
  const closed=new Promise(resolve=>fixture.once('close',(code,signal)=>resolve({code,signal})));
  const ready=await new Promise((resolveReady,reject)=>{const timer=setTimeout(()=>reject(new Error('Fixture did not become ready: '+errors)),5000);fixture.stdout.once('data',data=>{clearTimeout(timer);resolveReady(JSON.parse(String(data)));});});
  if(mode.startsWith('SIG'))fixture.kill(mode);
  const timeout=setTimeout(()=>fixture.kill('SIGKILL'),5000);const result=await closed;clearTimeout(timeout);
  assert.equal(result.code,{success:0,failure:1,SIGINT:130,SIGTERM:143}[mode],errors);
  const value=JSON.parse(readFileSync(receipt,'utf8'));assert.equal(value.calls,1);assert.equal(value.stopped,true);assert.equal(value.simulator.deleted,true);assert.deepEqual(value.commands.map(args=>args[0]),['terminate','shutdown','delete']);
  for(const pid of [ready.child,ready.grandchild])assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});
 }finally{if(fixture?.exitCode===null)fixture.kill('SIGKILL');rmSync(root,{recursive:true,force:true});}
});
test('an uncooperative owned process is force-stopped after the bounded grace period',async()=>{
 const child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});console.log('ready');setInterval(()=>{},1000)"],{detached:true,stdio:['ignore','pipe','ignore']});
 const stop=ownProcess(child,{graceMs:30,killMs:1000});await new Promise(resolve=>child.stdout.once('data',resolve));assert.equal(await stop(),true);assert.equal(child.signalCode,'SIGKILL');
});
test('an exited launcher cannot leave its ignored-stdio descendant behind',async()=>{
 const tree="const{spawn}=require('node:child_process');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});child.unref();console.log(child.pid);";
 const child=spawn(process.execPath,['-e',tree],{detached:true,stdio:['ignore','pipe','ignore']}),stop=ownProcess(child,{graceMs:1000});
 try{
  const descendant=await new Promise(resolve=>child.stdout.once('data',data=>resolve(Number(String(data).trim()))));
  await new Promise(resolve=>child.once('close',resolve));assert.equal(child.exitCode,0);assert.doesNotThrow(()=>process.kill(descendant,0));
  assert.equal(await stop(),true);assert.throws(()=>process.kill(descendant,0),{code:'ESRCH'});
 }finally{await stop();}
});

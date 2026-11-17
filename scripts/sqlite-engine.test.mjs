import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import {chmodSync,cpSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,renameSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {sqliteEngineReceipt} from './native-activity-probe/sqlite-engine.js';
import {nativeHostInputs} from './native-runtime-inputs.mjs';
import {readSqliteEngineReceipt} from './verify-ios-sqlite-engine.mjs';
import {standardFixtureEnvironment} from './native-standard-suite.mjs';
import {androidSelectionInit,validateAndroidSelection,androidReceiptStat,androidOffline,androidProcessIdentity,readAndroidBuildStep,readAndroidProbeStage} from './verify-android-sqlite-engine.mjs';
import {EventEmitter} from 'node:events';

const project=fileURLToPath(new URL('../',import.meta.url));
// Local source review can use a verified public package capsule without installing.
const source=resolve(process.env.PUPTIME_SQLITE_TEST_SOURCE??join(project,'node_modules/expo-sqlite'));
const patchName='patches/expo-sqlite-57.0.5-sqlite-3.51.3.patch';
const hashes={
 'sqlite3.c':['df16f4f2845488289d416e1d3b928c82ade5256564605b762daf0113fad394c5','abc152fd93810c76628dcf415e66e6cdd3182ce1ede4f45a5ea8c64b83dc1dfe'],
 'sqlite3.h':['0d247fd5e5e2fd602f427227bae7bf6349dd3322d6090d9751b21b5b3f51db62','1be81cbb8a2cc6d943cd9f15f48001aa14073bcba750d8b475e0f7892bfca606'],
};
const digest=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const engine=(root,name)=>join(root,'node_modules/expo-sqlite/vendor/sqlite3',name);
const git=(root,...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
function fixture(t){
 const root=realpathSync(mkdtempSync(join(tmpdir(),'puptime-sqlite-source-')));t.after(()=>rmSync(root,{recursive:true,force:true}));
 for(const name of ['scripts/prepare-sqlite-engine.mjs',patchName]){mkdirSync(dirname(join(root,name)),{recursive:true});cpSync(join(project,name),join(root,name));}
 const pkg=JSON.parse(readFileSync(join(source,'package.json'),'utf8'));assert.equal(pkg.name,'expo-sqlite');assert.equal(pkg.version,'57.0.5');
 mkdirSync(dirname(engine(root,'sqlite3.c')),{recursive:true});writeFileSync(join(root,'node_modules/expo-sqlite/package.json'),JSON.stringify(pkg));
 for(const [name,expected] of Object.entries(hashes)){assert.ok(expected.includes(digest(join(source,'vendor/sqlite3',name))));cpSync(join(source,'vendor/sqlite3',name),engine(root,name));}
 const state=Object.entries(hashes).map(([name,expected])=>expected.indexOf(digest(engine(root,name))));assert.equal(state[0],state[1]);
 if(state[0]===1)git(root,'apply','--reverse','--whitespace=nowarn','--',join(root,patchName));
 for(const [name,expected] of Object.entries(hashes))assert.equal(digest(engine(root,name)),expected[0]);
 mkdirSync(join(root,'node_modules/expo-sqlite/ios'));writeFileSync(join(root,'node_modules/expo-sqlite/ios/SQLiteModule.swift'),'unchanged binding sentinel\n');
 git(root,'init','--quiet');writeFileSync(join(root,'.gitignore'),'node_modules/\n');
 return root;
}
const files=['scripts/prepare-sqlite-engine.mjs',patchName,'node_modules/expo-sqlite/package.json','node_modules/expo-sqlite/ios/SQLiteModule.swift',...Object.keys(hashes).map(name=>'node_modules/expo-sqlite/vendor/sqlite3/'+name)];
const snapshot=root=>Object.fromEntries(files.map(name=>[name,digest(join(root,name))]));
const run=(root,args=[],extra={})=>spawnSync(process.execPath,[join(root,'scripts/prepare-sqlite-engine.mjs'),...args],{cwd:root,env:{PATH:process.env.PATH,LANG:'C',...extra},encoding:'utf8',timeout:35000});
const rejectsUnchanged=(root,args=[],env={})=>{const before=snapshot(root),result=run(root,args,env);assert.notEqual(result.status,0);assert.deepEqual(snapshot(root),before);return result;};

test('actual preparer patches exact official .5 preimages and repeats without invoking Git',t=>{
 const root=fixture(t),before=snapshot(root);assert.equal(run(root).status,0);
 for(const [name,expected] of Object.entries(hashes))assert.equal(digest(engine(root,name)),expected[1]);
 const after=snapshot(root);for(const name of files.filter(name=>!name.includes('/vendor/sqlite3/')))assert.equal(after[name],before[name]);
 assert.equal(run(root,[],{PATH:join(root,'no-executables')}).status,0);assert.deepEqual(snapshot(root),after);
});

test('already-applied sources still require the exact reviewed patch and package version',t=>{
 for(const change of [
  root=>writeFileSync(join(root,patchName),readFileSync(join(root,patchName),'utf8')+'\n'),
  root=>{const path=join(root,'node_modules/expo-sqlite/package.json'),pkg=JSON.parse(readFileSync(path,'utf8'));pkg.version='57.0.6';writeFileSync(path,JSON.stringify(pkg));},
 ]){const root=fixture(t);assert.equal(run(root).status,0);change(root);rejectsUnchanged(root);}
});

test('wrong package, patch bytes, unknown source, partial state and arbitrary arguments fail without writes',t=>{
 for(const change of [
  root=>{const p=join(root,'node_modules/expo-sqlite/package.json'),pkg=JSON.parse(readFileSync(p,'utf8'));pkg.version='57.0.6';writeFileSync(p,JSON.stringify(pkg));},
  root=>writeFileSync(join(root,patchName),readFileSync(join(root,patchName),'utf8')+'\n'),
  root=>writeFileSync(engine(root,'sqlite3.h'),'unknown source'),
  root=>{assert.equal(run(root).status,0);cpSync(join(source,'vendor/sqlite3/sqlite3.h'),engine(root,'sqlite3.h'));if(digest(engine(root,'sqlite3.h'))===hashes['sqlite3.h'][1]){git(root,'apply','--reverse','--include=node_modules/expo-sqlite/vendor/sqlite3/sqlite3.h','--',join(root,patchName));}},
 ]){const root=fixture(t);change(root);rejectsUnchanged(root);}
 rejectsUnchanged(fixture(t),['--other-package']);
});

test('symlinked package/source paths and Git failure cannot mutate the fixture',t=>{
 for(const name of ['package.json','vendor/sqlite3/sqlite3.c','vendor/sqlite3']){
  const root=fixture(t),path=join(root,'node_modules/expo-sqlite',name),saved=path+'.saved';renameSync(path,saved);symlinkSync(saved,path);rejectsUnchanged(root);
 }
 for(const status of [19,0]){
  const root=fixture(t),bin=join(root,'fake-bin');mkdirSync(bin);writeFileSync(join(bin,'git'),'#!/bin/sh\nexit '+status+'\n');chmodSync(join(bin,'git'),0o700);rejectsUnchanged(root,[],{PATH:bin});
 }
});

test('both native host guards bind lifecycle preparation and patch bytes while allowing JS-only changes',t=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'puptime-native-inputs-')));t.after(()=>rmSync(root,{recursive:true,force:true}));git(root,'init','--quiet');
 for(const name of ['scripts/prepare-sqlite-engine.mjs',patchName,'App.tsx']){mkdirSync(dirname(join(root,name)),{recursive:true});writeFileSync(join(root,name),'baseline\n');}
 git(root,'add','.');git(root,'-c','user.name=Source QA','-c','user.email=qa@example.invalid','commit','--quiet','-m','source fixture');
 const changed=()=>git(root,'diff','--name-only','HEAD','--',...nativeHostInputs);
 writeFileSync(join(root,'App.tsx'),'new JavaScript\n');assert.equal(changed(),'');
 for(const name of ['scripts/prepare-sqlite-engine.mjs',patchName]){writeFileSync(join(root,name),'changed native input\n');assert.equal(changed(),name);writeFileSync(join(root,name),'baseline\n');}
 for(const name of ['run-hosted-ios-account-case.mjs','verify-ios-runtime-upgrade.mjs'])assert.match(readFileSync(join(project,'scripts',name),'utf8'),/\.\.\.nativeHostInputs/);
});

test('native engine receipt uses exactly one literal SELECT through the supplied Expo connection',async()=>{
 const value={version:'3.51.3',sourceId:'2026-03-13 10:38:09 '+'7'.repeat(64)};let reads=0,queries=0;
 const database={read:async action=>{reads++;return action({getFirstAsync:async(...args)=>{queries++;assert.deepEqual(args,['SELECT sqlite_version() AS version, sqlite_source_id() AS sourceId']);return value;}});}};
 assert.deepEqual(await sqliteEngineReceipt(database),value);assert.equal(reads,1);assert.equal(queries,1);
});

test('native engine receipt rejects missing/extra/unbounded values and propagates query failure',async()=>{
 const good={version:'3.51.3',sourceId:'2026-03-13 10:38:09 '+'7'.repeat(64)};
 for(const value of [null,{},[],{...good,history:[]},{...good,version:35103},{...good,version:'3.'.repeat(100)},{...good,sourceId:'x'.repeat(1024)}])await assert.rejects(()=>sqliteEngineReceipt({read:action=>action({getFirstAsync:async()=>value})}));
 const failure=new Error('native query failed');await assert.rejects(()=>sqliteEngineReceipt({read:async()=>{throw failure;}}),error=>error===failure);
});

const expectedEngine={version:'3.51.3',sourceId:'2026-03-13 10:38:09 737ae4a34738ffa0c3ff7f9bb18df914dd1cad163f28fd6b6e114a344fe6d618'};
test('CI engine probe actual entry clears first and writes only after actual query and successful close',async()=>{
 const source=readFileSync(join(project,'index.sqlite-engine-probe.js'),'utf8'),start=source.indexOf('async function recordSqliteEngine()'),end=source.indexOf('\nregisterRootComponent(',start);assert.ok(start>0&&end>start);
 const body=source.slice(start,end),secret='private@example.invalid cookie=private /private/history';
 for(const kind of ['success','create','open','query','close','query-and-close','write']){
  const calls=[],failure=new Error(secret),closeError=new Error('synthetic close failure');
  for(const key of ['message','stack'])Object.defineProperty(failure,key,{get(){throw new Error('Never inspect the original Error');}});failure.toJSON=()=>{throw new Error('Never serialize the original Error');};
  class File{constructor(root,name){assert.equal(root,'synthetic-documents');assert.ok(['sqlite-engine-probe.json','sqlite-engine-stage.txt'].includes(name));this.marker=name.endsWith('.txt');}create(options){assert.deepEqual(options,{overwrite:true});if(this.marker)return;calls.push('clear');if(kind==='create')throw failure;}write(text){if(this.marker)return;calls.push('write');assert.deepEqual(JSON.parse(text),expectedEngine);assert.deepEqual(Object.keys(JSON.parse(text)),['version','sourceId']);if(kind==='write')throw failure;}}
  const database={read:async action=>{calls.push('query');if(kind.startsWith('query'))throw failure;return action({getFirstAsync:async query=>{assert.equal(query,'SELECT sqlite_version() AS version, sqlite_source_id() AS sourceId');return expectedEngine;}});},close:async()=>{calls.push('close');if(kind==='close'||kind==='query-and-close')throw closeError;}};
  const open=async(...args)=>{calls.push('open');assert.deepEqual(args,[undefined,'puptime-engine-probe.db']);if(kind==='open')throw failure;return{database};};
  const record=Function('File','Paths','openLocalDatabase','sqliteEngineReceipt','return ('+body+');')(File,{document:'synthetic-documents'},open,sqliteEngineReceipt);
  if(kind==='success')await record();else await assert.rejects(record(),error=>error===(kind==='close'?closeError:failure));
  assert.deepEqual(calls,kind==='create'?['clear']:kind==='open'?['clear','open']:kind==='success'||kind==='write'?['clear','open','query','close','write']:['clear','open','query','close']);
 }
 assert.deepEqual([...source.matchAll(/^import .* from '([^']+)'/gm)].map(match=>match[1]),['expo','react','expo-file-system','./src/local/open.native','./scripts/native-activity-probe/sqlite-engine']);
});

test('actual dedicated entry stages are fixed, best effort and preserve query-over-close errors',async()=>{
 const source=readFileSync(join(project,'index.sqlite-engine-probe.js'),'utf8'),start=source.indexOf('async function recordSqliteEngine()'),end=source.indexOf('\nregisterRootComponent(',start),body=source.slice(start,end);
 const stages=['file-create','database-open','query','close-after-query','close-after-query-error','receipt-write','complete'];
 for(const kind of ['success','create','open','query','close','query-and-close','write'])for(const markerFailure of [null,'create','write'])for(const failAt of markerFailure?[1,2,3,4,5,6]:[0]){
  const marks=[],calls=[],original=new Error(),closing=new Error(),markerError=new Error();let markerCount=0;
  for(const error of [original,closing,markerError])for(const key of ['message','stack'])Object.defineProperty(error,key,{get(){throw Error('PRIVATE getter must not run');}});
  class File{
   constructor(root,name){assert.equal(root,'documents');assert.ok(['sqlite-engine-probe.json','sqlite-engine-stage.txt'].includes(name));this.marker=name.endsWith('.txt');}
   create(options){assert.deepEqual(options,{overwrite:true});if(this.marker){this.index=++markerCount;if(markerFailure==='create'&&this.index===failAt)throw markerError;}else{calls.push('create');if(kind==='create')throw original;}}
   write(value){if(this.marker){assert.ok(stages.includes(value));assert.ok(Buffer.byteLength(value)<=64);marks.push(value);if(markerFailure==='write'&&this.index===failAt)throw markerError;}else{calls.push('write');assert.deepEqual(JSON.parse(value),expectedEngine);if(kind==='write')throw original;}}
  }
  const database={read:async action=>{calls.push('query');if(kind.startsWith('query'))throw original;return action({getFirstAsync:async()=>expectedEngine});},close:async()=>{calls.push('close');if(kind==='close'||kind==='query-and-close')throw closing;}};
  const record=Function('File','Paths','openLocalDatabase','sqliteEngineReceipt','return ('+body+');')(File,{document:'documents'},async()=>{calls.push('open');if(kind==='open')throw original;return{database};},sqliteEngineReceipt);
  if(kind==='success')await record();else await assert.rejects(record(),error=>error===(kind==='close'?closing:original));
  const expected=kind==='create'?['file-create']:kind==='open'?['file-create','database-open']:['file-create','database-open','query',kind.startsWith('query')?'close-after-query-error':'close-after-query',...(['success','write'].includes(kind)?['receipt-write']:[]),...(kind==='success'?['complete']:[])];
  assert.deepEqual(marks,markerFailure==='create'?expected.filter((_,i)=>i+1!==failAt):expected);
  assert.deepEqual(calls,kind==='create'?['create']:kind==='open'?['create','open']:['create','open','query','close',...(['success','write'].includes(kind)?['write']:[])]);
 }
});

test('CI engine probe actual collector admits only stable canonical two-field native bytes',t=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'puptime-engine-receipt-')));t.after(()=>rmSync(root,{recursive:true,force:true}));const path=join(root,'sqlite-engine-probe.json'),valid=JSON.stringify(expectedEngine);
 writeFileSync(path,valid);assert.deepEqual(readSqliteEngineReceipt(path),Buffer.from(valid));
 for(const value of [{...expectedEngine,version:'3.50.2'},{...expectedEngine,sourceId:'2026-03-13 10:38:09 '+'7'.repeat(64)}]){const raw=JSON.stringify(value);writeFileSync(path,raw);assert.deepEqual(readSqliteEngineReceipt(path),Buffer.from(raw));}
 for(const raw of ['',Buffer.alloc(257),Buffer.from([255]),valid+'\n',JSON.stringify({...expectedEngine,version:35103}),JSON.stringify({...expectedEngine,version:'private@example.invalid'}),JSON.stringify({...expectedEngine,sourceId:'cookie=private /private/history'}),JSON.stringify({...expectedEngine,sourceId:expectedEngine.sourceId.toUpperCase()}),JSON.stringify({...expectedEngine,history:[]}),JSON.stringify({sourceId:expectedEngine.sourceId,version:expectedEngine.version}),valid.replace('{','{"version":"3.51.3",'),'null']){writeFileSync(path,raw);assert.throws(()=>readSqliteEngineReceipt(path));}
 rmSync(path);const external=join(root,'other.json');writeFileSync(external,valid);symlinkSync(external,path);assert.throws(()=>readSqliteEngineReceipt(path));rmSync(path);mkdirSync(path);assert.throws(()=>readSqliteEngineReceipt(path));rmSync(path,{recursive:true});
 writeFileSync(path,valid);const original=fs.fstatSync;let calls=0;
 try{fs.fstatSync=(...args)=>{const value=original(...args);return ++calls===2?{...value,mtimeMs:value.mtimeMs+1}:value;};syncBuiltinESMExports();assert.throws(()=>readSqliteEngineReceipt(path));assert.equal(calls,2);}finally{fs.fstatSync=original;syncBuiltinESMExports();}
});

function ciEngineRun(options={}){
 const source=readFileSync(join(project,'scripts/verify-ios-sqlite-engine.mjs'),'utf8'),start=source.indexOf('export async function verifyIosSqliteEngine()'),end=source.indexOf('\nif (process.argv[1]',start);assert.ok(start>0&&end>start);
 const body=source.slice(start,end).replace('export ',''),device='00000000-0000-4000-8000-000000000001',calls=[],writes=[];let privateExists=true,cleared=false,launched=false,disposed=false;
 const original=options.failure??new Error('synthetic private failure'),cleanupError=new Error('synthetic cleanup failure');
 const environment={GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'patrickchin/puptime',GITHUB_RUN_ID:'123',GITHUB_RUN_ATTEMPT:'2',EXPO_PUBLIC_CLOUD_API_URL:'https://production.invalid',EXPO_PUBLIC_APP_POSTHOG_KEY:'private-key',EXPO_PUBLIC_UNKNOWN:'private',EXPO_OVERRIDE_METRO_CONFIG:'/synthetic/observer.config.cjs'};
 const assertEnvironment=env=>{assert.equal(env.EXPO_NO_DOTENV,'1');assert.equal(env.EXPO_PUBLIC_CLOUD_API_URL,'https://127.0.0.1:1');for(const key of ['EXPO_PUBLIC_APP_POSTHOG_KEY','EXPO_PUBLIC_APP_POSTHOG_HOST','EXPO_PUBLIC_POSTHOG_KEY','EXPO_PUBLIC_POSTHOG_HOST'])assert.equal(env[key],'');assert.equal(Object.hasOwn(env,'EXPO_PUBLIC_UNKNOWN'),false);assert.equal(Object.hasOwn(env,'EXPO_OVERRIDE_METRO_CONFIG'),false);};
 const execute=(binary,args,settings)=>{assertEnvironment(settings.env);assert.deepEqual(settings.stdio,['ignore','pipe','ignore']);calls.push([binary,...args]);if(binary==='git')return(args.at(-1)==='HEAD'?'1':'2').repeat(40)+'\n';if(binary==='codesign'){assert.equal(args.at(-1),'/owned-private/Puptime.app');return'';}assert.equal(binary,'xcrun');assert.equal(args[0],'simctl');
  if(args[1]==='list')return JSON.stringify({runtimes:[{isAvailable:true,identifier:'iOS-26'}]});if(args[1]==='create')return device;assert.equal(args[2],device);if(['terminate','shutdown','delete'].includes(args[1]))assert.equal(settings.timeout,30000);if(args[1]==='install'){assert.equal(args[3],'/owned-private/Puptime.app');assert.equal(settings.timeout,180000);}if(args[1]==='get_app_container')return'/synthetic-container';if(args[1]==='launch'){assert.equal(cleared,true);launched=true;if(options.launchFails)throw original;}return'';};
 const getHash=path=>path.endsWith('/sqlite3.c')?hashes['sqlite3.c'][1]:path.endsWith('/sqlite3.h')?hashes['sqlite3.h'][1]:path.includes('/owned-private/')?'c'.repeat(64):options.hostChanges&&calls.some(row=>row[0]==='bundle-finished')?'d'.repeat(64):path.endsWith('/Puptime')?'a'.repeat(64):'b'.repeat(64);
 const exists=path=>path==='/owned-private'?privateExists:path.endsWith('/sqlite-engine-probe.json')?launched:false;
 const cleanup=action=>({signal:null,run:action,dispose(){disposed=true;}});
 const remove=path=>{if(path==='/owned-private'){privateExists=false;calls.push(['remove-copy']);}else{assert.equal(path,'/synthetic-container/Documents/sqlite-engine-probe.json');cleared=true;calls.push(['remove-stale']);}};
 const deletion=value=>{assert.equal(value.device,device);assert.equal(value.privateDirectory,'/owned-private');assert.equal(value.preserve,false);assert.equal(typeof value.command,'function');value.command('terminate',device,'com.patrickchin.puptime');value.command('shutdown',device);value.command('delete',device);calls.push(['delete-owned',device]);return{deleted:!options.deleteFails};};
 const writer=(path,text,settings)=>{assert.equal(settings.mode,0o600);assert.equal(settings.flag,'wx');if(path.endsWith('/sqlite-engine-probe.json')){assert.equal(privateExists,false);assert.equal(calls.some(row=>row[0]==='delete-owned'),true);}if(options.writerFails)throw cleanupError;writes.push({path,value:JSON.parse(text)});};
 const load=Function('assert','process','standardFixtureEnvironment','execFileSync','realpathSync','join','lstatSync','existsSync','mkdirSync','mkdtempSync','tmpdir','installTaskCleanup','hash','postimages','expected','cpSync','bundleProbe','deleteOwnedSimulator','rmSync','dirname','readSqliteEngineReceipt','writeFileSync','return ('+body+');');
 const run=load(assert,{env:environment,platform:'darwin',cwd:()=>'/synthetic-root'},standardFixtureEnvironment,execute,path=>path,join,()=>({isDirectory:()=>true,isSymbolicLink:()=>false,size:128}),exists,()=>{},()=>'/owned-private',()=>'/tmp',cleanup,getHash,Object.values(hashes).map(value=>value[1]),expectedEngine,(host,copy,settings)=>{assert.equal(host,'/synthetic-root/build/ios-simulator/Build/Products/Release-iphonesimulator/Puptime.app');assert.equal(copy,'/owned-private/Puptime.app');assert.deepEqual(settings,{recursive:true,dereference:true,force:false,errorOnExist:true});},async(copy,env,own)=>{assertEnvironment(env);own(async()=>{calls.push(['stop-export']);if(options.stopFails)throw cleanupError;return true;});if(options.bundleFails)throw original;calls.push(['bundle-finished']);},deletion,remove,dirname,path=>{assert.equal(path,'/synthetic-container/Documents/sqlite-engine-probe.json');if(options.receiptFails)throw original;return options.engineBytes??Buffer.from(JSON.stringify(expectedEngine));},writer);
 return{run,calls,writes,original,cleanupError,disposed:()=>disposed,removed:()=>!privateExists};
}

test('CI engine probe actual orchestration keeps host source fixed, scrubs every child, and cleans its only captured UUID',async()=>{
 const check=ciEngineRun();await check.run();assert.equal(check.disposed(),true);assert.equal(check.removed(),true);assert.deepEqual(check.calls.filter(row=>row[0]==='delete-owned'),[['delete-owned','00000000-0000-4000-8000-000000000001']]);
 const producer=check.writes.find(row=>row.path.endsWith('/sqlite-engine-probe.json')),proof=check.writes.find(row=>row.path.endsWith('/sqlite-engine-provenance.json')).value;assert.deepEqual(producer.value,expectedEngine);assert.equal(proof.status,'passed');assert.equal(proof.engineMatchesExpected,true);assert.deepEqual(proof.cleanup,{processesStopped:true,simulatorDeleted:true,copyRemoved:true});assert.equal(proof.checkoutCommit,'1'.repeat(40));assert.equal(proof.checkoutTree,'2'.repeat(40));assert.equal(proof.runId,'123');assert.equal(proof.runAttempt,2);assert.ok(!JSON.stringify(check.writes).includes('private-key'));assert.ok(!JSON.stringify(check.writes).includes('production.invalid'));
});

test('CI engine probe retains only a valid actual pair on mismatch and still fails after cleanup',async t=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'puptime-engine-mismatch-')));t.after(()=>rmSync(root,{recursive:true,force:true}));const path=join(root,'sqlite-engine-probe.json');
 for(const value of [{...expectedEngine,version:'3.50.2'},{...expectedEngine,sourceId:'2026-03-13 10:38:09 '+'7'.repeat(64)}]){
  writeFileSync(path,JSON.stringify(value));const check=ciEngineRun({engineBytes:readSqliteEngineReceipt(path)});await assert.rejects(check.run(),{code:'ERR_ASSERTION',actual:false,expected:true});
  assert.equal(check.disposed(),true);assert.equal(check.removed(),true);assert.equal(check.writes.length,2);
  assert.deepEqual(check.writes.find(row=>row.path.endsWith('/sqlite-engine-probe.json')).value,value);
  const proof=check.writes.find(row=>row.path.endsWith('/sqlite-engine-provenance.json')).value;assert.equal(proof.status,'failed');assert.equal(proof.engineMatchesExpected,false);assert.deepEqual(proof.cleanup,{processesStopped:true,simulatorDeleted:true,copyRemoved:true});
  const unclean=ciEngineRun({engineBytes:readSqliteEngineReceipt(path),deleteFails:true});await assert.rejects(unclean.run(),error=>error.code==='ERR_ASSERTION'&&error.message.startsWith('Require the expected native SQLite engine.'));assert.equal(unclean.writes.some(row=>row.path.endsWith('/sqlite-engine-probe.json')),false);const uncleanProof=unclean.writes.find(row=>row.path.endsWith('/sqlite-engine-provenance.json')).value;assert.equal(uncleanProof.engineMatchesExpected,false);assert.equal(uncleanProof.status,'failed');assert.equal(uncleanProof.cleanup.simulatorDeleted,false);
 }
});

test('CI engine probe actual failures survive cleanup and evidence errors without leaving its UUID or copy',async()=>{
 for(const options of [{bundleFails:true},{launchFails:true},{receiptFails:true},{launchFails:true,stopFails:true,writerFails:true}]){
  const failure=new Error('synthetic original failure');for(const key of ['message','stack'])Object.defineProperty(failure,key,{get(){throw new Error('Never inspect Error fields');}});failure.toJSON=()=>{throw new Error('Never serialize Error');};const check=ciEngineRun({...options,failure});await assert.rejects(check.run(),error=>error===failure);assert.equal(check.disposed(),true);assert.equal(check.removed(),true);assert.equal(check.calls.filter(row=>row[0]==='delete-owned').length,options.bundleFails?0:1);assert.equal(check.writes.some(row=>row.path.endsWith('/sqlite-engine-probe.json')),false);const proof=check.writes.find(row=>row.path.endsWith('/sqlite-engine-provenance.json'));if(proof){assert.equal(proof.value.status,'failed');assert.equal(proof.value.engineMatchesExpected,null);}
 }
 for(const options of [{deleteFails:true},{stopFails:true}]){const check=ciEngineRun(options);await assert.rejects(check.run());assert.equal(check.removed(),true);assert.equal(check.calls.filter(row=>row[0]==='delete-owned').length,1);assert.equal(check.writes.some(row=>row.path.endsWith('/sqlite-engine-probe.json')),false);}
 const changed=ciEngineRun({hostChanges:true});await assert.rejects(changed.run());assert.equal(changed.removed(),true);assert.equal(changed.calls.some(row=>row[0]==='xcrun'),false);assert.equal(changed.writes.some(row=>row.path.endsWith('/sqlite-engine-probe.json')),false);
});

test('CI engine probe workflow uses its own compiled host before other suites and uploads only two finite files',async()=>{
 const {createRequire}=await import('node:module'),{parse}=createRequire(import.meta.url)('yaml'),steps=parse(readFileSync(join(project,'.github/workflows/ios-simulator.yml'),'utf8')).jobs.build.steps,index=steps.findIndex(step=>step.name==='Verify the actual iOS SQLite engine'),probe=steps[index],upload=steps[index+1];
 assert.equal(steps[index-1].name,'Upload compiled iOS host for testing');assert.equal(probe.run,'node scripts/verify-ios-sqlite-engine.mjs');assert.equal(probe['timeout-minutes'],25);assert.equal(upload.if,'always()');assert.equal(upload['continue-on-error'],true);assert.equal(upload.with.name,'puptime-ios-sqlite-engine-verdict');assert.deepEqual(upload.with.path.trim().split('\n'),['build/sqlite-engine-check/sqlite-engine-probe.json','build/sqlite-engine-check/sqlite-engine-provenance.json']);assert.equal(steps[index+2].name,'Install Maestro');
 const helper=readFileSync(join(project,'scripts/verify-ios-sqlite-engine.mjs'),'utf8');assert.match(helper,/assert\.equal\(process\.argv\.length, 2\)/);assert.ok(!helper.includes('run-hosted-ios-account-case'));assert.ok(!helper.includes('readFileSync(receipt'));
});

test('Android source selection is canonical, local, fixed-entry and rejects prebuilt/private/foreign input',t=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'puptime-android-selection-')));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const module=join(root,'node_modules/expo-sqlite/android');mkdirSync(module,{recursive:true});writeFileSync(join(module,'CMakeLists.txt'),'synthetic');writeFileSync(join(root,'index.sqlite-engine-probe.js'),'synthetic');writeFileSync(join(root,'index.js'),'unselected');
 const value={project:module,cmake:join(module,'CMakeLists.txt'),entry:join(root,'index.sqlite-engine-probe.js'),selected:true,libsql:false,sqlcipher:false};
 assert.equal(validateAndroidSelection(value,root).probeEntry,true);
 for(const change of [{project:root},{cmake:join(root,'index.js')},{entry:join(root,'index.js')},{selected:false},{libsql:true},{sqlcipher:true},{private:'PRIVATE_VALUE'}])assert.throws(()=>validateAndroidSelection({...value,...change},root));
 const init=androidSelectionInit(root,join(root,'selected.json'),join(root,'build-step.txt'));
 assert.ok(init.indexOf("current.rootProject.projectDir.canonicalFile !=")<init.indexOf("findProject(':app')"));
 assert.match(init,/assert app != null && sqlite != null/);assert.match(init,/selected\.size\(\) == 1/);assert.match(init,/selected\.first\(\)\.id == validatedSqlite\.id/);assert.match(init,/rootComponent\.get\(\)\.id/);assert.match(init,/createBundleReleaseJsAndAssets/);assert.match(init,/assert evidence\.createNewFile\(\)/);
 assert.ok(!init.includes('lenient')&&!init.includes('reselect')&&!init.includes('PRIVATE_VALUE'));
});

test('Android fixed receipt, offline and emulator ownership guards fail closed',()=>{
 assert.equal(androidReceiptStat('1 2 118 3 4 81a4\n').size,118);
 for(const raw of ['1 2 0 3 4 81a4','1 2 257 3 4 81a4','1 2 118 3 4 a1ff','1 2 118 3 4 41ed','PRIVATE_VALUE','1 2 118 3 4 81a4\nPRIVATE_VALUE'])assert.throws(()=>androidReceiptStat(raw));
 const offline={airplane:'1',wifiPreference:'0',wifiStatus:'Wifi is disabled\n',connectivity:'Active default network: none\nCurrent Networks:\nStatus for known UIDs:\n'};
 assert.equal(androidOffline(offline),true);for(const patch of [{airplane:'0'},{wifiPreference:'1'},{wifiStatus:'Wifi is enabled'},{connectivity:offline.connectivity.replace('none','100')},{connectivity:offline.connectivity.replace('Current Networks:\n','Current Networks:\n  PRIVATE_NETWORK\n')}])assert.throws(()=>androidOffline({...offline,...patch}));
 const stat=(state='S',start='7')=>'123 (emulator) '+[state,...Array(18).fill('0'),start].join(' '),expected={executables:['/sdk/emulator'],arguments:['-avd','owned'],home:'/owned/avd',uid:'1000'};
 const files={stat:stat(),afterStat:stat(),exe:'/sdk/emulator',cmdline:'/sdk/emulator\0-avd\0owned\0',environ:'ANDROID_AVD_HOME=/owned/avd\0',status:'Uid:\t1000 1000 1000 1000\n'};
 assert.equal(androidProcessIdentity(files,expected).owned,true);
 for(const patch of [{exe:'/foreign'},{cmdline:files.cmdline+'PRIVATE_ARG\0'},{environ:'ANDROID_AVD_HOME=/foreign\0'},{status:'Uid: 0 0 0 0\n'}])assert.equal(androidProcessIdentity({...files,...patch},expected).owned,false);
 assert.equal(androidProcessIdentity({...files,stat:stat('Z'),afterStat:stat('Z')},expected).alive,false);assert.throws(()=>androidProcessIdentity({...files,afterStat:stat('S','8')},expected));
});

test('Android actual APK parser validates x86_64 SQLite ELF/bundle, bounds and real CRC',t=>{
 const root=mkdtempSync(join(tmpdir(),'puptime-engine-apk-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const text=readFileSync(join(project,'scripts/verify-android-sqlite-engine.mjs'),'utf8'),parser=text.match(/const apkInspection=String\.raw`([\s\S]*?)`;/)?.[1];assert.ok(parser);
 const make=String.raw`import json,struct,sys,zipfile
p=sys.argv[1]; mode=sys.argv[2]; elf=bytearray(64); elf[:6]=b'\x7fELF\x02\x01'; elf[18:20]=struct.pack('<H',62)
if mode=='machine': elf[18:20]=struct.pack('<H',183)
if mode=='class': elf[4]=1
with zipfile.ZipFile(p,'w',compression=zipfile.ZIP_STORED) as z:
 z.writestr('lib/x86_64/libexpo-sqlite.so',elf)
 if mode!='missing': z.writestr('assets/index.android.bundle',b'synthetic-probe')
 if mode=='otherabi': z.writestr('lib/arm64-v8a/other.so',elf)
 if mode=='duplicate': z.writestr('lib/x86_64/libexpo-sqlite.so',elf)
if mode in ('crc','oversize'):
 b=bytearray(open(p,'rb').read())
 if mode=='crc': b[30+len('lib/x86_64/libexpo-sqlite.so')+32]^=1
 else:
  i=b.index(b'PK\x01\x02');b[i+24:i+28]=struct.pack('<I',33*1024*1024)
 open(p,'wb').write(b)
`;
 for(const mode of ['good','machine','class','missing','otherabi','duplicate','crc','oversize']){
  const path=join(root,mode+'.apk');execFileSync('python3',['-I','-c',make,path,mode],{stdio:['ignore','ignore','ignore']});
  const run=()=>execFileSync('python3',['-I','-c',parser,path],{encoding:'utf8',stdio:['ignore','pipe','ignore'],timeout:5000,maxBuffer:2048});
  if(mode==='good'){const value=JSON.parse(run());assert.deepEqual(Object.keys(value).sort(),['abi','bundleSHA256','elfClass','elfMachine','sqliteLibrarySHA256']);assert.equal(value.abi,'x86_64');assert.equal(value.elfClass,64);assert.equal(value.elfMachine,62);assert.match(value.sqliteLibrarySHA256,/^[a-f0-9]{64}$/);}else assert.throws(run);
 }
});

function androidCiRun(options={}){
 const text=readFileSync(join(project,'scripts/verify-android-sqlite-engine.mjs'),'utf8'),start=text.indexOf('export async function verifyAndroidSqliteEngine()'),end=text.indexOf('\nif(process.argv[1]',start);let body=text.slice(start,end).replace('export ','');assert.ok(start>0&&end>start);
 if(options.ddWithoutStatus){assert.equal(body.split("'count=1','status=none'").length,2);body=body.replace("'count=1','status=none'","'count=1'");}
 const calls=[],writes=[],name='Puptime_SQLite_Engine_123_2',args=['-avd',name,'-port','5588','-no-window','-no-audio','-no-snapshot','-gpu','swiftshader_indirect'];
 const raw=options.engineBytes??Buffer.from(JSON.stringify(expectedEngine)),failure=options.failure??new Error('PRIVATE_ORIGINAL'),cleanupError=new Error('PRIVATE_CLEANUP');let live=false,privateExists=true,installed=false,cleared=false,launched=false,disposed=false,rootCount=0,portChecks=0,emulatorStops=0,cleanupStatReads=0,receiptFailureInjected=false,markerCleared=false,now=0,launchStatReads=0;
 const sourceHashes=Object.values(hashes).map(row=>row[1]),key='221e0a3106aa4c3ccc154e0a418b55020b3f9ea6e84f92e8749cd9e2f39f5e58',certificate='fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c';
 const env={GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'patrickchin/puptime',GITHUB_RUN_ID:'123',GITHUB_RUN_ATTEMPT:'2',ANDROID_HOME:'/sdk',RUNNER_TEMP:'/runner',PUPTIME_ANDROID_CMDLINE_BIN:'/sdk/cmdline/bin',EXPO_PUBLIC_CLOUD_API_URL:'https://PRIVATE_ORIGIN',EXPO_PUBLIC_UNKNOWN:'PRIVATE_VALUE',EXPO_PUBLIC_APP_POSTHOG_KEY:'PRIVATE_KEY',EXPO_OVERRIDE_METRO_CONFIG:'PRIVATE_CONFIG',NODE_PATH:'PRIVATE_PATH',NODE_OPTIONS:'PRIVATE_OPTIONS'};
 const assertEnv=value=>{assert.equal(value.EXPO_NO_DOTENV,'1');assert.equal(value.EXPO_PUBLIC_CLOUD_API_URL,'https://127.0.0.1:1');assert.equal(value.EXPO_PUBLIC_APP_POSTHOG_KEY,'');for(const key of ['EXPO_PUBLIC_UNKNOWN','EXPO_OVERRIDE_METRO_CONFIG','NODE_PATH','NODE_OPTIONS'])assert.equal(Object.hasOwn(value,key),false);assert.equal(value.ENTRY_FILE,'index.sqlite-engine-probe.js');};
 const stat=(state='S',start='7')=>'111 (emulator) '+[state,...Array(18).fill('0'),start].join(' ');
 const selected={project:'/root/node_modules/expo-sqlite/android',cmake:'/root/node_modules/expo-sqlite/android/CMakeLists.txt',entry:'/root/index.sqlite-engine-probe.js',selected:true,libsql:false,sqlcipher:false};
 const read=path=>{
  if(path==='/root/package.json')return JSON.stringify({expo:{autolinking:{android:{buildFromSource:['expo-sqlite']}}}});
  if(path.endsWith('/expo-sqlite/package.json'))return '{"version":"57.0.5"}';
  if(path.endsWith('selected-module.json')){if(options.selectionReadFails)throw failure;return options.selectionBytes??Buffer.from(JSON.stringify(selected));}
  if(path.startsWith('/proc/')){
   if(!live)throw Object.assign(new Error('gone'),{code:'ENOENT'});
   if(launched&&path.endsWith('/stat'))launchStatReads++;
   if(launched&&(options.receiptFailure==='wait'&&!receiptFailureInjected||options.receiptInnerOwnershipFails&&launchStatReads===3&&!receiptFailureInjected||options.diagnosticOwnershipFails&&now>=60000&&!receiptFailureInjected)){receiptFailureInjected=true;throw failure;}
   const scenario=launched&&options.launchFails?options.ownershipScenario:undefined;
   if(scenario==='throw')throw new Error('PRIVATE_INSPECTION_FAILURE');
   if(path.endsWith('/stat')){if(scenario)cleanupStatReads++;if(scenario==='second-inspection-throws'&&cleanupStatReads>2)throw new Error('PRIVATE_INSPECTION_FAILURE');return scenario==='malformed'?'malformed':stat(scenario==='dead'?'Z':'S',scenario==='reused-start'?'8':'7');}
   if(path.endsWith('/cmdline'))return '/sdk/emulator/emulator\0'+args.join('\0')+'\0';if(path.endsWith('/environ'))return 'ANDROID_AVD_HOME=/private/avd\0';if(path.endsWith('/status'))return scenario==='foreign'?'Uid: 0 0 0 0\n':'Uid: 1000 1000 1000 1000\n';
  }
  throw new Error('Unexpected synthetic read');
 };
 const command=(binary,argv,settings)=>{
  assertEnv(settings.env);calls.push([binary,...argv]);
  const result=(stdout='',status=0)=>({stdout,stderr:'',status});
  if(binary==='git')return result(argv[0]==='rev-parse'?(argv.at(-1)==='HEAD'?'1':'2').repeat(40)+'\n':'');
  if(binary.endsWith('/apksigner'))return result('Signer #1 certificate SHA-256 digest: '+certificate+'\n');
  if(binary.endsWith('/aapt2'))return result("package: name='com.patrickchin.puptime' versionCode='1'\nminSdkVersion:'24'\ntargetSdkVersion:'36'\n");
  if(binary==='python3')return result(JSON.stringify({abi:'x86_64',elfClass:64,elfMachine:62,sqliteLibrarySHA256:'c'.repeat(64),bundleSHA256:'d'.repeat(64),...(options.apkPrivate?{secret:'PRIVATE_VALUE'}:{})}));
  assert.equal(binary,'/sdk/platform-tools/adb');assert.deepEqual(argv.slice(0,2),['-s','emulator-5588']);const a=argv.slice(2),key=a.join(' ');
  if(key==='emu avd name')return result(name+'\nOK\n');if(key==='emu kill'){live=false;return result();}
  if(key==='root'){rootCount++;return options.rootClosed?{status:1,stdout:'',stderr:'adb: unable to connect for root: closed\n'}:result('restarting adbd as root\n');}
  if(key==='shell getprop sys.boot_completed')return result('1');if(key==='shell id -u')return result('0');if(key==='shell getprop ro.build.version.sdk')return result(options.apiWrong?'35':'36');if(key==='shell getprop ro.product.cpu.abi')return result('x86_64');
  if(key.includes('airplane_mode_on'))return result('1');if(key.includes('global wifi_on'))return result('0');if(key==='shell cmd wifi status')return result('Wifi is disabled');if(key==='shell dumpsys connectivity')return result('Active default network: none\nCurrent Networks:\nStatus for known UIDs:\n');
  if(key==='shell pm path com.patrickchin.puptime')return installed?result('package:/data/app/synthetic/base.apk\n'):result('',1);
  if(a[0]==='install'){if(options.installFails)return {status:null,stdout:'',error:failure};installed=true;return result('Performing Streamed Install\nSuccess\n');}
  if(key.startsWith('shell rm -f ')){if(a.at(-1).endsWith('sqlite-engine-stage.txt'))markerCleared=true;else cleared=true;return result();}if(key.startsWith('shell am start ')){assert.equal(cleared,true);assert.equal(markerCleared,true);launched=true;if(options.launchFails)return {status:null,stdout:'',error:failure};return result();}
  if(a.at(-1)?.includes('sqlite-engine-stage.txt')){assert.equal(privateExists,true);assert.equal(markerCleared,true);assert.ok(settings.timeout>0&&settings.timeout<=5000);if(options.markerReadFails)return {status:null,stdout:'',error:failure};const marker=Buffer.from(options.probeStage??'database-open');if(a[1]==='stat')return result('1 2 '+marker.length+' 3 4 81a4\n');if(a[1]==='readlink')return result(a.at(-1));}
  if(a[0]==='shell'&&a[1]==='stat'){assert.equal(launched,true);if(options.receiptWaitExpires)return result('',1);return result('1 2 '+raw.length+' 3 4 81a4\n');}
  if(key.startsWith('shell readlink -f ')){if(options.receiptFailure==='path')return {status:null,stdout:'',error:failure};return result(a.at(-1));}if(a[0]==='exec-out'){if(a.some(v=>v.includes('sqlite-engine-stage.txt'))){assert.ok(settings.timeout>0&&settings.timeout<=5000);assert.equal(settings.maxBuffer,65);if(options.markerReadFails)return {status:null,stdout:Buffer.alloc(0),error:failure};return result(Buffer.from(options.probeStage??'database-open'));}if(options.receiptFailure==='read')return {status:null,stdout:Buffer.alloc(0),error:failure};assert.equal(settings.maxBuffer,257);return result(options.ddSummary&&!a.includes('status=none')?Buffer.concat([raw,Buffer.from('0+1 records in\n0+1 records out\n')]):raw);}
  if(key.startsWith('shell am force-stop ')){if(options.stopAppFails&&launched)return {status:1,stdout:''};return result();}
  if(['pull','shell'].includes(a[0]))return result();throw new Error('Unexpected synthetic command');
 };
 const writer=(path,bytes,settings)=>{assert.equal(settings.flag,'wx');assert.equal(settings.mode,0o600);if(path.includes('/build/android-sqlite-engine-check/')){if(options.writerFails)throw cleanupError;writes.push({path,value:JSON.parse(bytes)});}};
 const stable=path=>path.endsWith('/sqlite3.c')?sourceHashes[0]:path.endsWith('/sqlite3.h')?sourceHashes[1]:path.endsWith('debug.keystore')?key:path.endsWith('installed.apk')&&options.installedWrong?'b'.repeat(64):'a'.repeat(64);
 const spawnChild=(binary,argv,settings)=>{assert.equal(binary,'/sdk/emulator/emulator');assert.deepEqual(argv,args);assertEnv(settings.env);assert.equal(settings.detached,true);live=true;const child=new EventEmitter();child.pid=111;return child;};
 const run=async(binary,argv,settings)=>{assertEnv(settings.env);assert.equal(settings.inheritOutput,binary.endsWith('/gradlew')?true:undefined);calls.push([binary,...argv]);settings.own(async()=>!options.commandCleanupFails);if(options.buildFails&&binary.endsWith('/gradlew')||options.prebuildFails&&argv.includes('prebuild'))throw failure;};
 const cleanup=action=>{let once;return {signal:null,run:()=>once??=action(),dispose(){disposed=true;}};};
 const factory=Function('assert','process','realpathSync','lstatSync','existsSync','join','standardFixtureEnvironment','spawnSync','mkdirSync','mkdtempSync','readFileSync','readlinkSync','androidProcessIdentity','installTaskCleanup','runOwned','stableFile','engineHashes','templateKeySHA256','testCertificateSHA256','androidSelectionInit','readAndroidBuildStep','writeFileSync','validateAndroidSelection','apkInspection','portsFree','spawn','ownProcess','androidOffline','androidReceiptStat','readSqliteEngineReceipt','expected','app','serial','rmSync','readAndroidProbeStage','Date','setTimeout','Error','return ('+body+');');
 const execute=factory(assert,{platform:options.wrongPlatform?'darwin':'linux',env,cwd:()=>'/root',execPath:'/node',getuid:()=>1000},path=>path,()=>({isDirectory:()=>true,isSymbolicLink:()=>false,isFile:()=>true,size:512}),path=>path==='/private'||path==='/private/avd'?privateExists:path.startsWith('/sdk/emulator/'),join,standardFixtureEnvironment,command,()=>{},()=>'/private',read,()=>'/sdk/emulator/emulator',androidProcessIdentity,cleanup,run,stable,sourceHashes,key,certificate,androidSelectionInit,path=>{assert.equal(path,'/private/build-step.txt');assert.equal(privateExists,true);return options.buildStep??null;},writer,value=>{assert.deepEqual(value,selected);if(options.selectionFails)throw failure;return {name:'expo-sqlite',version:'57.0.5',localProject:true};},'synthetic-python',async()=>{portChecks++;if(options.portFails&&portChecks===1)throw failure;},spawnChild,()=>async()=>{emulatorStops++;live=false;return !options.processCleanupFails;},androidOffline,androidReceiptStat,()=>raw,expectedEngine,'com.patrickchin.puptime','emulator-5588',path=>{assert.equal(path,'/private');privateExists=false;},adb=>readAndroidProbeStage(adb,()=>now),{now:()=>now},(fn,ms)=>{assert.equal(ms,250);now+=ms;queueMicrotask(fn);},options.deadlineError?function(message){assert.equal(message,'Bounded readback timed out.');return options.deadlineError;}:Error);
 return {execute,calls,writes,failure,disposed:()=>disposed,live:()=>live,removed:()=>!privateExists,rootCount:()=>rootCount,emulatorStops:()=>emulatorStops};
}

test('current Android cleanup requires verified ownership before signaling or removing private material',async()=>{
 for(const scenario of ['owned','dead','foreign','throw','malformed','reused-start','second-inspection-throws']){
  const check=androidCiRun({launchFails:true,ownershipScenario:scenario});await assert.rejects(check.execute(),error=>error===check.failure);
  const trusted=['owned','dead'].includes(scenario);assert.equal(check.emulatorStops(),trusted?1:0,scenario);assert.equal(check.removed(),trusted,scenario);assert.equal(check.disposed(),true);
  assert.equal(check.writes.find(row=>row.path.endsWith('provenance.json')).value.status,'failed');assert.ok(!JSON.stringify(check.writes).includes('PRIVATE'));
 }
});

test('actual Android probe orchestration is source-bound, one ABI/entry, cold, offline and finite',async()=>{
 const check=androidCiRun({rootClosed:true});await check.execute();assert.equal(check.rootCount(),1);assert.equal(check.disposed(),true);assert.equal(check.live(),false);assert.equal(check.removed(),true);
 const proof=check.writes.find(row=>row.path.endsWith('provenance.json')).value;assert.equal(proof.status,'passed');assert.equal(proof.api,36);assert.equal(proof.engineMatchesExpected,true);assert.ok(Object.values(proof.cleanup).every(value=>value===true));assert.equal(proof.schemaVersion,3);assert.equal(proof.buildStep,'source-preservation');assert.equal(Object.keys(proof).length,15);assert.equal(proof.receiptDiagnostic,null);assert.equal(check.writes.length,2);assert.ok(!JSON.stringify(check.writes).includes('PRIVATE'));
 const build=check.calls.find(row=>row[0].endsWith('/gradlew'));assert.deepEqual(build.slice(1,4),[':app:assembleRelease','--no-daemon','-PreactNativeArchitectures=x86_64']);assert.deepEqual(build.slice(1),[':app:assembleRelease','--no-daemon','-PreactNativeArchitectures=x86_64','--no-configuration-cache','--init-script','/private/engine-inputs.gradle']);assert.ok(!check.calls.some(row=>row.includes('bundleRelease')||row.includes('keytool')||row.includes('maestro')||row.includes('sqlite3')));
});

test('Android raw exec-out suppresses dd summaries while retaining exact receipt bytes and failure cleanup',async t=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'puptime-dd-receipt-')));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const path=join(root,'receipt.json'),raw=Buffer.from(JSON.stringify(expectedEngine)),summary=Buffer.from('0+1 records in\n0+1 records out\n');
 writeFileSync(path,raw);assert.deepEqual(readSqliteEngineReceipt(path),raw);
 writeFileSync(path,Buffer.concat([raw,summary]));assert.throws(()=>readSqliteEngineReceipt(path));
 const original=androidCiRun({ddSummary:true,ddWithoutStatus:true});
 await assert.rejects(original.execute(),error=>error.code==='ERR_ASSERTION'&&error.actual===raw.length+summary.length&&error.expected===raw.length);
 const failed=original.writes.find(row=>row.path.endsWith('provenance.json')).value;
 assert.equal(failed.status,'failed');assert.equal(failed.phase,'receipt-read');assert.equal(failed.engineMatchesExpected,null);assert.ok(Object.values(failed.cleanup).every(value=>value===true));assert.equal(original.writes.some(row=>row.path.endsWith('probe.json')),false);assert.equal(original.disposed(),true);assert.equal(original.removed(),true);
 const fixed=androidCiRun({ddSummary:true});await fixed.execute();
 const dd=fixed.calls.find(row=>row.includes('exec-out'));
 assert.deepEqual(dd,['/sdk/platform-tools/adb','-s','emulator-5588','exec-out','dd','if=/data/user/0/com.patrickchin.puptime/files/sqlite-engine-probe.json','bs=257','count=1','status=none']);
 assert.deepEqual(fixed.writes.find(row=>row.path.endsWith('probe.json')).value,expectedEngine);assert.equal(fixed.writes.find(row=>row.path.endsWith('provenance.json')).value.status,'passed');assert.equal(fixed.disposed(),true);assert.equal(fixed.removed(),true);
});

test('Android receipt phase groups preserve original failures, cleanup and the successful receipt phase',async()=>{
 for(const [boundary,phase] of [['wait','receipt-wait'],['path','receipt-path'],['read','receipt-read']]){
  const failure=new Error('PRIVATE_RECEIPT_FAILURE');Object.defineProperty(failure,'message',{get(){throw Error('No error inspection');}});
  const check=androidCiRun({receiptFailure:boundary,failure});await assert.rejects(check.execute(),error=>error===failure);
  const value=check.writes.find(row=>row.path.endsWith('provenance.json')).value;
  assert.equal(value.status,'failed');assert.equal(value.phase,phase);assert.equal(value.engineMatchesExpected,null);assert.equal(Object.keys(value).length,15);assert.ok(Object.values(value.cleanup).every(flag=>flag===true));assert.equal(check.writes.some(row=>row.path.endsWith('probe.json')),false);
  assert.equal(check.disposed(),true);assert.equal(check.removed(),true);assert.equal(check.live(),false);assert.ok(!JSON.stringify(check.writes).includes('PRIVATE'));
 }
 const success=androidCiRun();await success.execute();const value=success.writes.find(row=>row.path.endsWith('provenance.json')).value;assert.equal(value.status,'passed');assert.equal(value.phase,'receipt');assert.equal(value.engineMatchesExpected,true);
});

test('actual receipt wait distinguishes ownership rejection from deadline and reads no stale marker',async()=>{
 const owner=androidCiRun({receiptFailure:'wait'});await assert.rejects(owner.execute(),error=>error===owner.failure);
 const ownedProof=owner.writes.find(row=>row.path.endsWith('provenance.json')).value;
 assert.deepEqual(ownedProof.receiptDiagnostic,{waitOutcome:'owned-guard-failed',probeStage:null});
 assert.ok(!owner.calls.some(row=>row.includes('stat')&&row.at(-1).endsWith('sqlite-engine-stage.txt')));
 for(const options of [{},{markerReadFails:true},{probeStage:'PRIVATE https://private.invalid'},{receiptInnerOwnershipFails:true},{diagnosticOwnershipFails:true}]){
  const failure=new Error();Object.defineProperty(failure,'message',{get(){throw Error('PRIVATE getter');}});
  const check=androidCiRun({receiptWaitExpires:true,failure,deadlineError:failure,...options});await assert.rejects(check.execute(),error=>error===failure);
  const proof=check.writes.find(row=>row.path.endsWith('provenance.json')).value;
  assert.equal(proof.status,'failed');assert.equal(proof.phase,'receipt-wait');assert.equal(proof.engineMatchesExpected,null);
  assert.deepEqual(proof.receiptDiagnostic,{waitOutcome:'deadline-expired',probeStage:Object.keys(options).length?null:'database-open'});
  assert.ok(Object.values(proof.cleanup).every(value=>value===true));assert.equal(check.disposed(),true);assert.equal(check.removed(),true);
  const markerReads=check.calls.filter(row=>row.includes('stat')&&row.at(-1).endsWith('sqlite-engine-stage.txt'));
  if(options.receiptInnerOwnershipFails||options.diagnosticOwnershipFails)assert.equal(markerReads.length,0);else assert.ok(markerReads.length>=1);
  const deletion=check.calls.findIndex(row=>row.includes('rm')&&row.at(-1).endsWith('sqlite-engine-stage.txt')),launch=check.calls.findIndex(row=>row.includes('start'));
  assert.ok(deletion>=0&&deletion<launch);assert.ok(!JSON.stringify(proof).includes('PRIVATE'));
 }
 const ready=androidCiRun();await ready.execute();assert.equal(ready.writes.find(row=>row.path.endsWith('provenance.json')).value.receiptDiagnostic,null);
 assert.ok(!ready.calls.some(row=>row.includes('stat')&&row.at(-1).endsWith('sqlite-engine-stage.txt')));
});

test('failure marker reader uses one shared budget and rejects private, symlink, unstable and malformed bytes',()=>{
 const path='/data/user/0/com.patrickchin.puptime/files/sqlite-engine-stage.txt',stages=['file-create','database-open','query','close-after-query','close-after-query-error','receipt-write','complete'];
 const run=(raw,options={})=>{
  const calls=[];let now=0,stats=0;
  const value=readAndroidProbeStage((args,settings)=>{
   calls.push({args,settings});assert.equal(settings.timeout,5000-now);assert.ok(settings.maxBuffer<=256);now+=options.latency??1000;
   if(options.fail)throw options.fail;
   if(args[1]==='stat'){stats++;return `1 2 ${options.zero?0:raw.length} ${options.unstable&&stats===2?9:3} 4 ${options.symlink?'a1ff':'81a4'}\n`;}
   if(args[1]==='readlink')return options.foreign?'/private/foreign':path;
   assert.deepEqual(args,['exec-out','dd','if='+path,'bs=65','count=1','status=none']);assert.equal(settings.binaryOutput,true);assert.equal(settings.maxBuffer,65);return options.short?raw.subarray(1):raw;
  },()=>now);
  assert.ok(calls.length<=4);return{value,calls,now};
 };
 for(const stage of stages){const result=run(Buffer.from(stage));assert.equal(result.value,stage);assert.deepEqual(result.calls.map(row=>row.settings.timeout),[5000,4000,3000,2000]);}
 for(const raw of [Buffer.alloc(0),Buffer.alloc(65),Buffer.from([0xff]),Buffer.from('query\n'),Buffer.from('\ufeffquery'),Buffer.from('PRIVATE /private/path https://private.invalid')])assert.equal(run(raw).value,null);
 for(const options of [{zero:true},{symlink:true},{foreign:true},{unstable:true},{short:true},{latency:2000}])assert.equal(run(Buffer.from('query'),options).value,null);
 const failure=new Error();Object.defineProperty(failure,'message',{get(){throw Error('PRIVATE getter');}});assert.equal(run(Buffer.from('query'),{fail:failure}).value,null);
 const timed=run(Buffer.from('query'),{latency:3000});assert.equal(timed.value,null);assert.equal(timed.calls.length,2);assert.ok(timed.calls.every(row=>row.settings.timeout<=5000));
});

test('actual Android stat argv survives ADB shell joining at all receipt and marker sites',async()=>{
 const success=androidCiRun();await success.execute();
 const expired=androidCiRun({receiptWaitExpires:true});await assert.rejects(expired.execute(),error=>error.message==='Bounded readback timed out.');
 const receipt='/data/user/0/com.patrickchin.puptime/files/sqlite-engine-probe.json',marker='/data/user/0/com.patrickchin.puptime/files/sqlite-engine-stage.txt';
 const rows=[...success.calls.filter(row=>row[3]==='shell'&&row[4]==='stat'&&row.at(-1)===receipt),...expired.calls.filter(row=>row[3]==='shell'&&row[4]==='stat'&&row.at(-1)===marker)];
 assert.equal(rows.length,5);
 const format='%d %i %s %Y %Z %f';
 const stub=String.raw`stat() {
 [ "$#" -eq 3 ] && [ "$1" = '-c' ] && [ "$2" = '%d %i %s %Y %Z %f' ] && [ "$3" = "$PUPTIME_EXPECTED_STAT_PATH" ] || return 81
 printf '1 2 17 3 4 81a4\n'
}`;
 for(const row of rows){
  assert.ok([receipt,marker].includes(row.at(-1)));assert.deepEqual(row.slice(3,7),['shell','stat','-c',"'"+format+"'"]);
  // Android16 adb_shell joins argv with spaces, then adbd executes shell -c.
  const run=argv=>spawnSync('/bin/sh',['-c',stub+'\n'+argv.join(' ')],{env:{PUPTIME_EXPECTED_STAT_PATH:row.at(-1)},encoding:'utf8',timeout:3000,stdio:['ignore','pipe','pipe']});
  const old=run(row.slice(4).map(value=>value==="'"+format+"'"?format:value));
  assert.equal(old.error,undefined);assert.equal(old.status,81);assert.equal(old.stdout,'');assert.equal(old.stderr,'');
  const fixed=run(row.slice(4));assert.equal(fixed.error,undefined);assert.equal(fixed.status,0);assert.equal(fixed.stderr,'');assert.equal(androidReceiptStat(fixed.stdout).size,17);
 }
});

test('Android mismatches, setup/cleanup/writer failures never pass or replace the original failure',async()=>{
 const mismatch=androidCiRun({engineBytes:Buffer.from(JSON.stringify({...expectedEngine,version:'3.50.2'}))});await assert.rejects(mismatch.execute());assert.equal(mismatch.writes.find(row=>row.path.endsWith('provenance.json')).value.engineMatchesExpected,false);assert.equal(mismatch.writes.length,2);
 for(const options of [{buildFails:true},{selectionFails:true},{installFails:true},{launchFails:true},{buildFails:true,writerFails:true},{launchFails:true,processCleanupFails:true,writerFails:true}]){
  const failure=new Error('PRIVATE_ORIGINAL');Object.defineProperty(failure,'message',{get(){throw Error('No error inspection');}});const check=androidCiRun({...options,failure});await assert.rejects(check.execute(),error=>error===failure);assert.equal(check.disposed(),true);assert.equal(check.writes.some(row=>row.path.endsWith('probe.json')),false);
 }
 for(const options of [{apiWrong:true},{installedWrong:true},{portFails:true},{stopAppFails:true},{processCleanupFails:true},{commandCleanupFails:true},{apkPrivate:true}]){const check=androidCiRun(options);await assert.rejects(check.execute());const proof=check.writes.find(row=>row.path.endsWith('provenance.json')).value;assert.equal(proof.status,'failed');assert.equal(check.writes.some(row=>row.path.endsWith('probe.json')),false);assert.equal(check.live(),false);assert.ok(!JSON.stringify(check.writes).includes('PRIVATE'));if(options.apkPrivate)assert.equal(proof.apk,null);if(options.apiWrong)assert.equal(proof.api,null);}
 const guard=androidCiRun({wrongPlatform:true});await assert.rejects(guard.execute());assert.deepEqual(guard.calls,[]);assert.deepEqual(guard.writes,[]);
});

test('Android build-step reader admits only stable regular bounded exact source-owned enums',t=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'puptime-build-step-')));t.after(()=>rmSync(root,{recursive:true,force:true}));const path=join(root,'step');
 const steps=['gradle-root','gradle-projects','gradle-selected-component','gradle-selected-count','gradle-selected-identity','gradle-bundle-task','gradle-sqlite-flags','gradle-cmake-source','gradle-probe-entry','gradle-evidence-write','gradle-model-complete'];
 for(const value of steps){writeFileSync(path,value);assert.equal(readAndroidBuildStep(path),value);}
 for(const value of ['', 'PRIVATE_TOKEN /private/path https://private.invalid', 'selection-read', 'gradle-root\n', 'GRADLE-ROOT', '\ufeffgradle-root', 'x'.repeat(65), Buffer.from([0xff,0xfe])]){writeFileSync(path,value);assert.equal(readAndroidBuildStep(path),null);}
 assert.equal(readAndroidBuildStep(join(root,'missing')),null);assert.equal(readAndroidBuildStep(root),null);
 writeFileSync(path,'gradle-root');const alias=join(root,'alias');symlinkSync(path,alias);assert.equal(readAndroidBuildStep(alias),null);
 const original={lstatSync:fs.lstatSync,fstatSync:fs.fstatSync};let messageReads=0;
 try{
  fs.fstatSync=descriptor=>{const value=original.fstatSync(descriptor);return {...value,mtimeMs:value.mtimeMs+1};};syncBuiltinESMExports();assert.equal(readAndroidBuildStep(path),null);
  fs.fstatSync=original.fstatSync;fs.lstatSync=()=>{const error=new Error();Object.defineProperty(error,'message',{get(){messageReads++;throw Error('PRIVATE');}});throw error;};syncBuiltinESMExports();assert.equal(readAndroidBuildStep(path),null);assert.equal(messageReads,0);
 }finally{Object.assign(fs,original);syncBuiltinESMExports();}
});

test('Android graph guards execute in their owning tasks and remain mandatory with full component identity',()=>{
 const init=androidSelectionInit('/source','/private/selected.json','/private/build-step.txt');
 const sqliteStart=init.indexOf("def sqliteValidation = sqlite.tasks.register('verifyPuptimeSqliteEngineSource')"),appStart=init.indexOf("def appValidation = app.tasks.register('verifyPuptimeSqliteEngineSelection')");
 assert.ok(sqliteStart>0&&appStart>sqliteStart);assert.ok(!init.slice(0,sqliteStart).includes('.incoming.resolutionResult'));
 const sqlite=init.slice(sqliteStart,appStart),app=init.slice(appStart);
 assert.match(sqlite,/doLast \{\s*def identity = sqlite\.configurations\.getByName\('releaseRuntimeClasspath'\)\.incoming\.resolutionResult\.rootComponent\.get\(\)\.id/);
 for(const predicate of ['assert sqlite.ext.USE_LIBSQL == false && sqlite.ext.USE_SQLCIPHER == false',"assert sqlite.extensions.getByName('android').externalNativeBuild.cmake.path.canonicalFile",'sqliteInputs.set([id: identity, project: sqlite.projectDir.canonicalPath,'])assert.ok(sqlite.includes(predicate));
 assert.ok(!sqlite.includes('app.configurations')&&!sqlite.includes('evidence.text'));
 assert.match(app,/dependsOn\(sqliteValidation\)\s*doLast \{/);assert.ok(app.includes("app.configurations.getByName('releaseRuntimeClasspath').incoming.resolutionResult.allComponents"));
 assert.ok(app.includes("it.id instanceof ProjectComponentIdentifier && it.id.projectPath == ':expo-sqlite'"));
 assert.ok(app.includes('assert selected.size() == 1'));assert.ok(app.includes('assert validatedSqlite != null && selected.first().id == validatedSqlite.id'));
 assert.ok(app.indexOf('assert validatedSqlite != null')<app.indexOf('assert evidence.createNewFile()'));
 assert.ok(app.includes("app.tasks.named('assembleRelease').configure { dependsOn(appValidation) }"));
 for(const bypass of ['onlyIf','enabled = false','upToDateWhen','outputs.file','cacheIf','withMutableState','lenient','reselect'])assert.ok(!init.includes(bypass));
 assert.equal((init.match(/doLast \{/g)??[]).length,2);assert.equal((init.match(/\.incoming\.resolutionResult/g)??[]).length,2);
});

test('Android generated Gradle breadcrumbs precede existing predicates and cannot replace model failures',()=>{
 const init=androidSelectionInit('/source','/private/selected.json','/private/build-step.txt');
 const boundaries=[['gradle-root','if (current.rootProject.projectDir.canonicalFile !='],['gradle-projects',"def app = current.rootProject.findProject(':app')"],['gradle-sqlite-flags','assert sqlite.ext.USE_LIBSQL == false'],['gradle-cmake-source',"assert sqlite.extensions.getByName('android').externalNativeBuild"],['gradle-selected-component',"def selected = app.configurations.getByName('releaseRuntimeClasspath')"],['gradle-selected-count','assert selected.size() == 1'],['gradle-selected-identity','assert validatedSqlite != null && selected.first().id == validatedSqlite.id'],['gradle-bundle-task',"def bundle = app.tasks.named('createBundleReleaseJsAndAssets')"],['gradle-probe-entry','assert bundle.entryFile.get().asFile.canonicalFile'],['gradle-evidence-write','assert evidence.createNewFile()'],['gradle-model-complete',null]];
 assert.deepEqual([...init.matchAll(/markBuildStep\('([^']+)'\)/g)].map(match=>match[1]),boundaries.map(row=>row[0]));
 for(let i=0;i<boundaries.length;i++){
  const [step,predicate]=boundaries[i],start=init.indexOf(`markBuildStep('${step}')`),end=i+1<boundaries.length?init.indexOf(`markBuildStep('${boundaries[i+1][0]}')`):init.length;
  if(predicate){const at=init.indexOf(predicate);assert.ok(start<at&&at<end);}
 }
 assert.match(init,/breadcrumb\.setText\(value, 'UTF-8'\)\s*\} catch \(Throwable ignored\) \{\}/);
 assert.ok(init.indexOf('evidence.text = JsonOutput.toJson')<init.indexOf("markBuildStep('gradle-model-complete')"));
 assert.ok(!init.includes('println')&&!init.includes('stackTrace')&&!init.includes('getMessage'));
});

test('Android actual build diagnostics preserve original failures, finite schema and cleanup boundaries',async()=>{
 const cases=[{options:{buildFails:true},step:'gradle-command'},{options:{buildFails:true,buildStep:'gradle-cmake-source'},step:'gradle-cmake-source'},{options:{buildFails:true,buildStep:'gradle-selected-count'},step:'gradle-selected-count'},{options:{buildFails:true,buildStep:'gradle-selected-identity'},step:'gradle-selected-identity'},{options:{selectionReadFails:true},step:'selection-read'},{options:{selectionFails:true},step:'selection-validate'}];
 for(const {options,step} of cases){
  const failure=new Error();Object.defineProperty(failure,'message',{get(){throw Error('Do not inspect PRIVATE message');}});const check=androidCiRun({...options,failure});await assert.rejects(check.execute(),error=>error===failure);
  const value=check.writes.find(row=>row.path.endsWith('provenance.json')).value;
  assert.equal(value.schemaVersion,3);assert.equal(value.phase,'build');assert.equal(value.buildStep,step);assert.equal(value.status,'failed');assert.equal(value.selectedModule,null);assert.equal(value.engineMatchesExpected,null);assert.equal(value.api,null);assert.equal(value.apk,null);assert.equal(check.disposed(),true);assert.equal(check.removed(),true);assert.ok(Object.values(value.cleanup).every(flag=>flag===true));
  assert.deepEqual(Object.keys(value).sort(),['schemaVersion','stage','status','phase','buildStep','checkoutCommit','checkoutTree','runId','runAttempt','engineMatchesExpected','api','selectedModule','apk','cleanup','receiptDiagnostic'].sort());assert.ok(!JSON.stringify(value).includes('PRIVATE'));
 }
 const invalid=androidCiRun({selectionBytes:Buffer.from([0xff])});await assert.rejects(invalid.execute());assert.equal(invalid.writes.find(row=>row.path.endsWith('provenance.json')).value.buildStep,'selection-read');
 const setup=androidCiRun({prebuildFails:true});await assert.rejects(setup.execute(),error=>error===setup.failure);assert.equal(setup.writes.find(row=>row.path.endsWith('provenance.json')).value.buildStep,null);
 const complete=androidCiRun();await complete.execute();const value=complete.writes.find(row=>row.path.endsWith('provenance.json')).value;assert.equal(value.status,'passed');assert.equal(value.buildStep,'source-preservation');assert.equal(value.engineMatchesExpected,true);
 for(const options of [{buildFails:true,writerFails:true},{buildFails:true,commandCleanupFails:true}]){const check=androidCiRun(options);await assert.rejects(check.execute(),error=>error===check.failure);assert.equal(check.disposed(),true);}
});

test('current Android dispatch is exclusive and uploads only the two finite engine receipts',async()=>{
 const {createRequire}=await import('node:module'),{parse}=createRequire(import.meta.url)('yaml'),raw=readFileSync(join(project,'.github/workflows/ios-simulator.yml'),'utf8'),current=parse(raw);
 assert.equal(current.jobs.build.if,"github.event_name != 'workflow_dispatch' || (inputs.suite != 'accounts' && inputs.suite != 'sqlite-engine-android')");
 const job=current.jobs['sqlite-engine-android'];assert.equal(job.if,"github.event_name == 'workflow_dispatch' && inputs.suite == 'sqlite-engine-android'");assert.equal(job['runs-on'],'ubuntu-latest');assert.equal(job.steps.find(step=>step.name==='Build and query only the Android SQLite engine').run,'node scripts/verify-android-sqlite-engine.mjs');
 assert.ok(job.steps[0].with['sparse-checkout'].includes('!/.env\n'));const upload=job.steps.at(-1);assert.equal(upload.if,'always()');assert.equal(upload['continue-on-error'],true);assert.deepEqual(upload.with.path.trim().split('\n'),['build/android-sqlite-engine-check/sqlite-engine-probe.json','build/android-sqlite-engine-check/sqlite-engine-provenance.json']);
 assert.ok(!JSON.stringify(job).includes('publish-android')&&!JSON.stringify(job).includes('bundleRelease'));
});

test('Android owned child handles stdin, timeout and cleanup failures without masking the first error',async()=>{
 const text=readFileSync(join(project,'scripts/verify-android-sqlite-engine.mjs'),'utf8'),start=text.indexOf('async function runOwned('),end=text.indexOf('\n}\n',start)+2,body=text.slice(start,end);assert.ok(start>0&&end>start);
 for(const inheritOutput of [false,true])for(const mode of ['success','spawn','stdin','timeout','cleanup','spawn-reject','timeout-reject','cleanup-reject']){
  const failure=new Error('PRIVATE_CHILD_FAILURE'),cleanupError=new Error('PRIVATE_CLEANUP_FAILURE');let stopped=0,registered=0,cleared=0,pending;
  const child=new EventEmitter();child.pid=123;child.stdin=new EventEmitter();child.stdin.end=value=>{assert.equal(value,'no\n');if(mode==='stdin')queueMicrotask(()=>child.stdin.emit('error',failure));};
  const spawn=(binary,args,settings)=>{assert.equal(binary,'synthetic');assert.deepEqual(args,['fixed']);assert.equal(settings.detached,true);assert.deepEqual(settings.stdio,['pipe',inheritOutput?'inherit':'ignore',inheritOutput?'inherit':'ignore']);queueMicrotask(()=>{if(mode.startsWith('spawn'))child.emit('error',failure);else if(['success','cleanup','cleanup-reject'].includes(mode))child.emit('close',0);});return child;};
  const run=Function('spawn','ownProcess','assert','setTimeout','clearTimeout','return ('+body+');')(spawn,()=>()=>pending??=Promise.resolve().then(()=>{stopped++;if(mode.endsWith('-reject'))throw cleanupError;return mode!=='cleanup';}),assert,fn=>{if(mode.startsWith('timeout'))queueMicrotask(fn);return 7;},value=>{assert.equal(value,7);cleared++;});
  const result=run('synthetic',['fixed'],{cwd:'owned',env:{},input:'no\n',timeout:123,...(inheritOutput?{inheritOutput:true}:{}),own:()=>{registered++;}});
  if(mode==='success')await result;else await assert.rejects(result,error=>['spawn','spawn-reject','stdin'].includes(mode)?error===failure:mode.startsWith('timeout')?error.message==='Owned command timed out.':mode==='cleanup-reject'?error===cleanupError:error.code==='ERR_ASSERTION');
  assert.equal(stopped,1);assert.equal(registered,1);assert.equal(cleared,1);
 }
});

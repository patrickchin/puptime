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
 for(const kind of ['success','open','query','close','query-and-close','write']){
  const calls=[],failure=new Error(secret),closeError=new Error('synthetic close failure');
  for(const key of ['message','stack'])Object.defineProperty(failure,key,{get(){throw new Error('Never inspect the original Error');}});failure.toJSON=()=>{throw new Error('Never serialize the original Error');};
  class File{constructor(root,name){assert.equal(root,'synthetic-documents');assert.equal(name,'sqlite-engine-probe.json');}create(options){assert.deepEqual(options,{overwrite:true});calls.push('clear');}write(text){calls.push('write');assert.deepEqual(JSON.parse(text),expectedEngine);assert.deepEqual(Object.keys(JSON.parse(text)),['version','sourceId']);if(kind==='write')throw failure;}}
  const database={read:async action=>{calls.push('query');if(kind.startsWith('query'))throw failure;return action({getFirstAsync:async query=>{assert.equal(query,'SELECT sqlite_version() AS version, sqlite_source_id() AS sourceId');return expectedEngine;}});},close:async()=>{calls.push('close');if(kind==='close'||kind==='query-and-close')throw closeError;}};
  const open=async(...args)=>{calls.push('open');assert.deepEqual(args,[undefined,'puptime-engine-probe.db']);if(kind==='open')throw failure;return{database};};
  const record=Function('File','Paths','openLocalDatabase','sqliteEngineReceipt','return ('+body+');')(File,{document:'synthetic-documents'},open,sqliteEngineReceipt);
  if(kind==='success')await record();else await assert.rejects(record(),error=>error===(kind==='close'?closeError:failure));
  assert.deepEqual(calls,kind==='open'?['clear','open']:kind==='success'||kind==='write'?['clear','open','query','close','write']:['clear','open','query','close']);
 }
 assert.deepEqual([...source.matchAll(/^import .* from '([^']+)'/gm)].map(match=>match[1]),['expo','react','expo-file-system','./src/local/open.native','./scripts/native-activity-probe/sqlite-engine']);
});

test('CI engine probe actual collector admits only stable canonical two-field native bytes',t=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'puptime-engine-receipt-')));t.after(()=>rmSync(root,{recursive:true,force:true}));const path=join(root,'sqlite-engine-probe.json'),valid=JSON.stringify(expectedEngine);
 writeFileSync(path,valid);assert.deepEqual(readSqliteEngineReceipt(path),Buffer.from(valid));
 for(const raw of ['',Buffer.alloc(257),Buffer.from([255]),valid+'\n',JSON.stringify({...expectedEngine,version:'3.50.2'}),JSON.stringify({...expectedEngine,sourceId:'2026-03-13 10:38:09 '+'7'.repeat(64)}),JSON.stringify({...expectedEngine,history:[]}),valid.replace('{','{"version":"3.51.3",'),'null']){writeFileSync(path,raw);assert.throws(()=>readSqliteEngineReceipt(path));}
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
  if(args[1]==='list')return JSON.stringify({runtimes:[{isAvailable:true,identifier:'iOS-26'}]});if(args[1]==='create')return device;assert.equal(args[2],device);if(args[1]==='install'){assert.equal(args[3],'/owned-private/Puptime.app');assert.equal(settings.timeout,180000);}if(args[1]==='get_app_container')return'/synthetic-container';if(args[1]==='launch'){assert.equal(cleared,true);launched=true;if(options.launchFails)throw original;}return'';};
 const getHash=path=>path.endsWith('/sqlite3.c')?hashes['sqlite3.c'][1]:path.endsWith('/sqlite3.h')?hashes['sqlite3.h'][1]:path.includes('/owned-private/')?'c'.repeat(64):options.hostChanges&&calls.some(row=>row[0]==='bundle-finished')?'d'.repeat(64):path.endsWith('/Puptime')?'a'.repeat(64):'b'.repeat(64);
 const exists=path=>path==='/owned-private'?privateExists:path.endsWith('/sqlite-engine-probe.json')?launched:false;
 const cleanup=action=>({signal:null,run:action,dispose(){disposed=true;}});
 const remove=path=>{if(path==='/owned-private'){privateExists=false;calls.push(['remove-copy']);}else{assert.equal(path,'/synthetic-container/Documents/sqlite-engine-probe.json');cleared=true;calls.push(['remove-stale']);}};
 const deletion=value=>{assert.equal(value.device,device);assert.equal(value.privateDirectory,'/owned-private');assert.equal(value.preserve,false);calls.push(['delete-owned',device]);return{deleted:!options.deleteFails};};
 const writer=(path,text,settings)=>{assert.equal(settings.mode,0o600);assert.equal(settings.flag,'wx');if(options.writerFails)throw cleanupError;writes.push({path,value:JSON.parse(text)});};
 const load=Function('assert','process','standardFixtureEnvironment','execFileSync','realpathSync','join','lstatSync','existsSync','mkdirSync','mkdtempSync','tmpdir','installTaskCleanup','hash','postimages','cpSync','bundleProbe','deleteOwnedSimulator','rmSync','dirname','readSqliteEngineReceipt','writeFileSync','return ('+body+');');
 const run=load(assert,{env:environment,platform:'darwin',cwd:()=>'/synthetic-root'},standardFixtureEnvironment,execute,path=>path,join,()=>({isDirectory:()=>true,isSymbolicLink:()=>false,size:128}),exists,()=>{},()=>'/owned-private',()=>'/tmp',cleanup,getHash,Object.values(hashes).map(value=>value[1]),(host,copy,settings)=>{assert.equal(host,'/synthetic-root/build/ios-simulator/Build/Products/Release-iphonesimulator/Puptime.app');assert.equal(copy,'/owned-private/Puptime.app');assert.deepEqual(settings,{recursive:true,dereference:true,force:false,errorOnExist:true});},async(copy,env,own)=>{assertEnvironment(env);own(async()=>{calls.push(['stop-export']);if(options.stopFails)throw cleanupError;return true;});if(options.bundleFails)throw original;calls.push(['bundle-finished']);},deletion,remove,dirname,path=>{assert.equal(path,'/synthetic-container/Documents/sqlite-engine-probe.json');if(options.receiptFails)throw original;return Buffer.from(JSON.stringify(expectedEngine));},writer);
 return{run,calls,writes,original,cleanupError,disposed:()=>disposed,removed:()=>!privateExists};
}

test('CI engine probe actual orchestration keeps host source fixed, scrubs every child, and cleans its only captured UUID',async()=>{
 const check=ciEngineRun();await check.run();assert.equal(check.disposed(),true);assert.equal(check.removed(),true);assert.deepEqual(check.calls.filter(row=>row[0]==='delete-owned'),[['delete-owned','00000000-0000-4000-8000-000000000001']]);
 const producer=check.writes.find(row=>row.path.endsWith('/sqlite-engine-probe.json')),proof=check.writes.find(row=>row.path.endsWith('/sqlite-engine-provenance.json')).value;assert.deepEqual(producer.value,expectedEngine);assert.equal(proof.status,'passed');assert.deepEqual(proof.cleanup,{processesStopped:true,simulatorDeleted:true,copyRemoved:true});assert.equal(proof.checkoutCommit,'1'.repeat(40));assert.equal(proof.checkoutTree,'2'.repeat(40));assert.equal(proof.runId,'123');assert.equal(proof.runAttempt,2);assert.ok(!JSON.stringify(check.writes).includes('private-key'));assert.ok(!JSON.stringify(check.writes).includes('production.invalid'));
});

test('CI engine probe actual failures survive cleanup and evidence errors without leaving its UUID or copy',async()=>{
 for(const options of [{bundleFails:true},{launchFails:true},{receiptFails:true},{launchFails:true,stopFails:true,writerFails:true}]){
  const failure=new Error('synthetic original failure');for(const key of ['message','stack'])Object.defineProperty(failure,key,{get(){throw new Error('Never inspect Error fields');}});failure.toJSON=()=>{throw new Error('Never serialize Error');};const check=ciEngineRun({...options,failure});await assert.rejects(check.run(),error=>error===failure);assert.equal(check.disposed(),true);assert.equal(check.removed(),true);assert.equal(check.calls.filter(row=>row[0]==='delete-owned').length,options.bundleFails?0:1);assert.equal(check.writes.some(row=>row.path.endsWith('/sqlite-engine-probe.json')),false);
 }
 for(const options of [{deleteFails:true},{stopFails:true}]){const check=ciEngineRun(options);await assert.rejects(check.run());assert.equal(check.removed(),true);assert.equal(check.calls.filter(row=>row[0]==='delete-owned').length,1);assert.equal(check.writes.some(row=>row.path.endsWith('/sqlite-engine-probe.json')),false);}
 const changed=ciEngineRun({hostChanges:true});await assert.rejects(changed.run());assert.equal(changed.removed(),true);assert.equal(changed.calls.some(row=>row[0]==='xcrun'),false);assert.equal(changed.writes.some(row=>row.path.endsWith('/sqlite-engine-probe.json')),false);
});

test('CI engine probe workflow uses its own compiled host before other suites and uploads only two finite files',async()=>{
 const {createRequire}=await import('node:module'),{parse}=createRequire(import.meta.url)('yaml'),steps=parse(readFileSync(join(project,'.github/workflows/ios-simulator.yml'),'utf8')).jobs.build.steps,index=steps.findIndex(step=>step.name==='Verify the actual iOS SQLite engine'),probe=steps[index],upload=steps[index+1];
 assert.equal(steps[index-1].name,'Upload compiled iOS host for testing');assert.equal(probe.run,'node scripts/verify-ios-sqlite-engine.mjs');assert.equal(probe['timeout-minutes'],25);assert.equal(upload.if,'always()');assert.equal(upload['continue-on-error'],true);assert.equal(upload.with.name,'puptime-ios-sqlite-engine-verdict');assert.deepEqual(upload.with.path.trim().split('\n'),['build/sqlite-engine-check/sqlite-engine-probe.json','build/sqlite-engine-check/sqlite-engine-provenance.json']);assert.equal(steps[index+2].name,'Install Maestro');
 const helper=readFileSync(join(project,'scripts/verify-ios-sqlite-engine.mjs'),'utf8');assert.match(helper,/assert\.equal\(process\.argv\.length, 2\)/);assert.ok(!helper.includes('run-hosted-ios-account-case'));assert.ok(!helper.includes('readFileSync(receipt'));
});

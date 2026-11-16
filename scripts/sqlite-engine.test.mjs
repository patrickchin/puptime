import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import {chmodSync,cpSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,renameSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {sqliteEngineReceipt} from './native-activity-probe/sqlite-engine.js';
import {nativeHostInputs} from './native-runtime-inputs.mjs';

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

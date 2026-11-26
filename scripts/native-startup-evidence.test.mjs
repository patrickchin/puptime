import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {startupEvidence} from './native-startup-evidence.mjs';

test('startup receipts retain only fixed stage/status and actual finite failure categories',()=>{
 assert.deepEqual(startupEvidence('simulator-boot','started'),{stage:'simulator-boot',status:'started'});
 assert.deepEqual(startupEvidence('case-result','passed'),{stage:'case-result',status:'passed'});
 assert.deepEqual(startupEvidence('candidate-bundle-launch','passed'),{stage:'candidate-bundle-launch',status:'passed'});
 for(const [error,expected] of [[{code:'ETIMEDOUT'},'timeout'],[{code:'ERR_ASSERTION'},'assertion'],[new assert.AssertionError({message:'private detail'}),'assertion'],[{status:1},'process-exit'],[{status:0},'other'],[{signal:'SIGTERM'},'signal'],[{code:'EADDRINUSE'},'system-error'],[new Error('private cause'),'other']])assert.equal(startupEvidence('sdk-process','failed',error).failure.category,expected);
 assert.deepEqual(startupEvidence('sdk-process','failed',{status:1,signal:null}),{stage:'sdk-process',status:'failed',failure:{category:'process-exit',code:'other',exitStatus:1,signal:null}});
 for(const status of [undefined,NaN,256,-256,'1'])assert.equal(startupEvidence('sdk-process','failed',{status}).failure.exitStatus,null);
});

test('secret-rich errors and unknown fields cannot escape into startup evidence',()=>{
 const secret='identity@example.invalid 654321 Bearer private-cookie /private/auth https://private.invalid/api?token=private';
 const error={code:secret,status:secret,signal:secret,name:secret,message:secret,stack:secret,stdout:secret,stderr:secret,path:secret,spawnargs:[secret],cause:{body:secret}};
 const result=startupEvidence(secret,'failed',error);assert.deepEqual(result,{stage:'unknown',status:'failed',failure:{category:'other',code:'other',exitStatus:null,signal:null}});assert.ok(!JSON.stringify(result).includes(secret));
 assert.deepEqual(startupEvidence('host-install',secret,error),{stage:'host-install',status:'unknown'});
 assert.deepEqual(startupEvidence('maestro-process','started',error),{stage:'maestro-process',status:'started'});
});


test('error fields are captured once; throwing or changing getters cannot leak a later raw value',()=>{
 let reads=0;const error={get code(){reads++;return reads===1?'ETIMEDOUT':'private-identity@example.invalid';}};
 const result=startupEvidence('sdk-process','failed',error);assert.equal(reads,1);assert.equal(result.failure.code,'ETIMEDOUT');assert.ok(!JSON.stringify(result).includes('private-identity'));
 const throwing={get status(){throw new Error('private credential');}};assert.deepEqual(startupEvidence('sdk-process','failed',throwing),{stage:'sdk-process',status:'failed',failure:{category:'other',code:'other',exitStatus:null,signal:null}});
});


test('actual marker callbacks survive failed writes and actual catches preserve the original error and cleanup',async()=>{
 const actualCatch=source=>{
  const parsed=ts.createSourceFile('actual-runner.mjs',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),matches=[];
  assert.equal(parsed.parseDiagnostics.length,0);
  const visit=node=>{if(ts.isCatchClause(node)&&node.block.statements[0]?.getText(parsed)==="markStartup(startupStage,'failed',error);")matches.push(node.getText(parsed));ts.forEachChild(node,visit);};visit(parsed);
  assert.equal(matches.length,1,'Require one actual startup catch, with no missing/ambiguous fallback.');return matches[0];
 };
 assert.throws(()=>actualCatch('try {} catch(error) { throw error; }'));
 assert.throws(()=>actualCatch("try {} catch(error) { markStartup(startupStage,'failed',error); throw error; }\ntry {} catch(error) { markStartup(startupStage,'failed',error); throw error; }"));
 for(const file of ['run-hosted-ios-account-case.mjs','verify-native-guest-account.mjs'])for(const standard of file==='verify-native-guest-account.mjs'?[false,true]:[false])for(const code of ['ENOSPC','EACCES']){
  const source=readFileSync(new URL('./'+file,import.meta.url),'utf8');
  const marker=source.match(/^const markStartup=.+;$/m)?.[0],failureCatch=actualCatch(source);
  assert.ok(marker&&failureCatch,'Exercise the actual committed writer and catch rather than a parallel implementation.');
  const original=new Error('original synthetic startup failure'),writeFailure=Object.assign(new Error('private disk detail'),{code});let writes=0,cleanups=0,disposals=0,spawnCallback;
  const context={startupEvidence,output:'synthetic-output',android:false,standard,standardStage:'synthetic',markStandardStage(){},requests:new Set(),identityRequests:{sendCode:0,verifyCode:0,signOut:0},requestCounts:{enroll:0,push:0},cookie:'',join:(...parts)=>parts.join('/'),writeFileSync(){writes++;throw writeFailure;},original,task:{async run(){cleanups++;},dispose(){disposals++;}},child:{once(event,callback){assert.equal(event,'spawn');spawnCallback=callback;}}};
  runInNewContext("let startupStage='sdk-spawn';"+marker,context);
  if(file==='run-hosted-ios-account-case.mjs'){
   const registration=source.match(/child\.once\('spawn',\(\)=>markStartup\('sdk-process'\)\)/)?.[0];assert.ok(registration);runInNewContext(registration,context);
   // An EventEmitter spawn callback runs outside the awaiting Promise body.
   assert.doesNotThrow(()=>spawnCallback());assert.equal(runInNewContext('startupStage',context),'sdk-process');
  }
  const actualFinally=source.match(/finally\{await task\.run\(\);task\.dispose\(\);\}/)?.[0];assert.ok(actualFinally);
  const promise=runInNewContext('(async()=>{try{try{throw original;}'+actualFinally+'}'+failureCatch+'})()',context);
  await assert.rejects(promise,error=>error===original);assert.equal(cleanups,1);assert.equal(disposals,1);assert.equal(writes,file==='run-hosted-ios-account-case.mjs'||standard?2:1);
 }
});


test('actual SDK assertion phases stay finite without exposing assertion details',()=>{
 const source=readFileSync(new URL('./verify-native-guest-account.mjs',import.meta.url),'utf8');
 const stages=[...source.matchAll(/markStartup\('(assert-[a-z-]+)'\)/g)].map(match=>match[1]);
 assert.ok(stages.length>0);assert.equal(new Set(stages).size,stages.length);
 const secret='private-note identity@example.invalid 654321 Bearer cookie';
 for(const stage of stages){
  const result=startupEvidence(stage,'failed',Object.assign(new assert.AssertionError({message:secret}),{actual:secret,expected:secret}));
  assert.deepEqual(result,{stage,status:'failed',failure:{category:'assertion',code:'ERR_ASSERTION',exitStatus:null,signal:null}});
  assert.ok(!JSON.stringify(result).includes(secret));assert.equal(startupEvidence(stage+':'+secret,'failed',{}).stage,'unknown');
 }
});

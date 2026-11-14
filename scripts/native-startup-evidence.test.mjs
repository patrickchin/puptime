import assert from 'node:assert/strict';
import test from 'node:test';
import {startupEvidence} from './native-startup-evidence.mjs';

test('startup receipts retain only fixed stage/status and actual finite failure categories',()=>{
 assert.deepEqual(startupEvidence('simulator-boot','started'),{stage:'simulator-boot',status:'started'});
 assert.deepEqual(startupEvidence('case-result','passed'),{stage:'case-result',status:'passed'});
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

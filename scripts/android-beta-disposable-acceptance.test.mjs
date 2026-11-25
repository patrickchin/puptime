import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,writeFileSync,mkdtempSync,rmSync,chmodSync,symlinkSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {assertBoundPins,runDisposableAcceptance,validateReceipt,makeLinuxIO,recoverDisposableCleanup,PHASES,ENGINE,OLD125} from './android-beta-disposable-acceptance.mjs';
import {reviewedOracleSource,installFailureProjection,preservationEquality,coldPreservationEquality,readSqliteEngineReceipt} from './android-beta-disposable-oracles.mjs';

const digest=value=>createHash('sha256').update(value).digest('hex');
const pins=()=>({schema:1,driverSource:'a'.repeat(40),reviewSHA256:'b'.repeat(64),candidate:{source:'a'.repeat(40),run:1,attempt:1,artifact:2,artifactBytes:1000,artifactDigest:'c'.repeat(64),sha256:'d'.repeat(64),bytes:900,certificateSHA256:'e'.repeat(64),manifestSHA256:'f'.repeat(64),custodySHA256:'1'.repeat(64),version:'1.13.0',versionCode:1013000,minSdk:24,targetSdk:36}});
const qaCopy={sha256:'2'.repeat(64),bundleSHA256:'3'.repeat(64),certificateSHA256:'4'.repeat(64),ordinaryMembersCompared:20,nativeLibrariesCompared:2,allOrdinaryMemberBytesAndCompressionEqual:true};
const methods=['bind','artifacts','lease','installOld','seedOld','oldSnapshot','rejectCandidate','assertRejectedPreserved','removeSynthetic','installCandidate','seedCandidate','assertColdPreserved','bundleProbe','createVerifiedProbeCopy','installProbe','queryEngine'];
function mockIO(defect){
 const calls=[],written=[],io=Object.fromEntries(methods.map(name=>[name,async()=>{calls.push(name);if(name===defect)throw new Error('PRIVATE schema path token body');if(name==='rejectCandidate')return 'INSTALL_FAILED_UPDATE_INCOMPATIBLE';if(name==='createVerifiedProbeCopy')return {...qaCopy};if(name==='queryEngine')return {...ENGINE};return {artificial:true};}]));
 io.cleanup=async()=>{calls.push('cleanup');return Object.fromEntries(['commandsStopped','emulatorStopped','adbStopped','avdDeleted','privateFilesDeleted','portsFree'].map(name=>[name,true]));};
 io.writeReceipt=async value=>{written.push(JSON.parse(JSON.stringify(value)));};return {io,calls,written};
}

test('committed pins are unbound; malformed or policy-lowering tuples make zero adapter calls',async()=>{
 const unbound=JSON.parse(readFileSync(new URL('./android-beta-disposable-pins.json',import.meta.url)));let calls=0;
 await assert.rejects(runDisposableAcceptance(unbound,()=>{calls++;throw Error('No I/O allowed');}));assert.equal(calls,0);
 for(const change of [p=>{p.candidate.attempt=2;},p=>{p.candidate.targetSdk=35;},p=>{p.candidate.minSdk=37;},p=>{p.candidate.certificateSHA256=OLD125.certificateSHA256;},p=>{p.candidate.source='b'.repeat(40);},p=>{p.candidate.PRIVATE='secret';}]){const p=pins();change(p);assert.throws(()=>assertBoundPins(p));}
 const higher=pins();higher.candidate.targetSdk=37;assert.equal(assertBoundPins(higher).candidate.targetSdk,37);
});

test('fixed real-adapter order qualifies safe rejection and fresh product separately from QA-copy query',async()=>{
 const m=mockIO(),result=await runDisposableAcceptance(pins(),()=>m.io);assert.equal(result.status,'PASS');assert.deepEqual(result.phases.map(row=>row.phase),PHASES);assert.equal(result.rejection,'INSTALL_FAILED_UPDATE_INCOMPATIBLE');assert.equal(result.freshProduct,true);assert.deepEqual(result.qaCopy,qaCopy);assert.deepEqual(result.engine,ENGINE);
 assert.deepEqual(m.calls,['bind','artifacts','lease','installOld','seedOld','oldSnapshot','rejectCandidate','assertRejectedPreserved','removeSynthetic','installCandidate','seedCandidate','assertColdPreserved','bundleProbe','createVerifiedProbeCopy','removeSynthetic','installProbe','queryEngine','cleanup']);assert.equal(m.written.length,1);
});

test('every failed boundary stops later actions, retains FAIL, and runs exactly one cleanup',async()=>{
 for(const name of methods){const m=mockIO(name),result=await runDisposableAcceptance(pins(),()=>m.io);assert.equal(result.status,'FAIL');assert.equal(m.calls.at(-1),'cleanup');assert.equal(m.calls.filter(value=>value==='cleanup').length,1);assert.equal(m.written.length,1);assert.equal(JSON.stringify(result).includes('PRIVATE'),false);assert.ok(result.failure);assert.equal(result.phases.find(row=>row.status==='failed').phase,result.failure.phase);}
});

test('unexpected update acceptance or wrong engine can never produce a pass or a retry',async()=>{
 for(const defect of ['update','engine']){const m=mockIO();if(defect==='update')m.io.rejectCandidate=async()=>{m.calls.push('rejectCandidate');return 'Success';};else m.io.queryEngine=async()=>({version:'3.51.2',sourceId:ENGINE.sourceId});const result=await runDisposableAcceptance(pins(),()=>m.io);assert.equal(result.status,'FAIL');if(defect==='update'){assert.equal(result.rejection,null);assert.equal(m.calls.includes('removeSynthetic'),false);assert.equal(m.calls.filter(value=>value==='rejectCandidate').length,1);}else assert.equal(result.engine,null);}
});

test('cleanup failure and a secret-rich failure cannot become a green or widened receipt',async()=>{
 const m=mockIO();m.io.cleanup=async()=>({commandsStopped:true,emulatorStopped:false,adbStopped:true,avdDeleted:false,privateFilesDeleted:false,portsFree:false});const result=await runDisposableAcceptance(pins(),()=>m.io);assert.equal(result.status,'FAIL');assert.equal(result.failure.phase,'cleanup');assert.equal(result.phases.at(-1).status,'failed');
 for(const change of [v=>{v.PRIVATE='secret';},v=>{v.failure={phase:'cleanup',class:'PRIVATE',status:null};},v=>{v.qaCopy.extra='PRIVATE';},v=>{v.engine={...ENGINE,private:'PRIVATE'};},v=>{v.cleanup.portsFree='yes';}]){const v=structuredClone(result);change(v);assert.throws(()=>validateReceipt(v));}
 const adversarial=mockIO();let reads=0;adversarial.io.artifacts=async()=>{const error=new Error('PRIVATE');Object.defineProperty(error,'status',{get(){reads++;return 'PRIVATE';}});throw error;};const guarded=await runDisposableAcceptance(pins(),()=>adversarial.io);assert.equal(reads,0);assert.equal(guarded.status,'FAIL');assert.equal(JSON.stringify(guarded).includes('PRIVATE'),false);
});

test('all copied strict/observer/lease bodies remain byte-identical to the existing proof',()=>{
 const source=readFileSync(new URL('./verify-android-signing-upgrade.mjs',import.meta.url),'utf8'),copy=readFileSync(new URL('./android-beta-disposable-oracles.mjs',import.meta.url),'utf8');assert.equal(digest(source),reviewedOracleSource.producerSHA256);
 for(const [name,expected] of Object.entries(reviewedOracleSource.functions)){const start=new RegExp('^(?:async )?function '+name+'\\(','m').exec(source);assert.ok(start);const rest=source.slice(start.index),end=/\n(?=(?:async )?function |const |\/\/ Host-only)/.exec(rest),body=end?rest.slice(0,end.index+1):rest;assert.equal(digest(body),expected);assert.ok(copy.includes(body));}
});

test('safe rejection parser retains only the exact observed public mismatch code',()=>{
 const path='/private/generated/candidate.apk',result={status:1,stdout:'Performing Streamed Install\n',stderr:'adb: failed to install '+path+': Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE: PRIVATE_DETAIL]\n'};
 assert.deepEqual(installFailureProjection(result,path),{installCode:'INSTALL_FAILED_UPDATE_INCOMPATIBLE'});assert.equal(JSON.stringify(installFailureProjection({...result,stdout:'Success'},path)).includes('PRIVATE'),false);assert.equal(installFailureProjection({...result,stdout:'Success'},path).installCode,undefined);
});

test('strict rejection preserves every row/UID/widget/byte while cold permits only SQLite physical variation',()=>{
 const tables=Object.fromEntries(['metadata','puppies','events','routines','settings','pet_settings','local_revisions','local_sync_owner','local_sync_pets','local_sync_outbox','local_sync_records','local_sync_acks','local_sync_baseline','sqlite_sequence'].map(name=>[name,[]]));tables.puppies=[{id:'pet_generated',name:'Generated'}];
 const before={tables,uid:'10123',widgets:{id:'7'},files:{'files/SQLite/puptime-v2.db':{sha256:'db'},'shared_prefs/generated.xml':{sha256:'prefs'}},sqlite:{schema:[],metadata:{user_version:0}}},transition=(a,b)=>assert.deepEqual(b,a),strict=preservationEquality(transition,row=>row),cold=coldPreservationEquality(transition,row=>row);
 const physical=structuredClone(before);physical.files['files/SQLite/puptime-v2.db'].sha256='changed';assert.throws(()=>strict(before,physical));assert.doesNotThrow(()=>cold(before,physical));
 for(const name of Object.keys(tables)){const changed=structuredClone(before);changed.tables[name].push({generated:'changed'});assert.throws(()=>strict(before,changed));assert.throws(()=>cold(before,changed));}
 for(const change of [v=>{v.uid='10124';},v=>{v.widgets.id='8';},v=>{v.files['shared_prefs/generated.xml'].sha256='changed';},v=>{v.sqlite.metadata.user_version=1;}]){const v=structuredClone(before);change(v);assert.throws(()=>cold(before,v));}
});

test('existing stable fixed-query reader accepts only its bounded canonical engine receipt',t=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'puptime-beta-reader-generated-')));chmodSync(root,0o700);t.after(()=>rmSync(root,{recursive:true,force:true}));const path=join(root,'engine.json');writeFileSync(path,JSON.stringify(ENGINE),{mode:0o600});assert.deepEqual(JSON.parse(readSqliteEngineReceipt(path)),ENGINE);
 for(const text of ['{}',JSON.stringify({...ENGINE,PRIVATE:'secret'}),JSON.stringify(ENGINE)+'\n','x'.repeat(257)]){writeFileSync(path,text);assert.throws(()=>readSqliteEngineReceipt(path));}
 rmSync(path);writeFileSync(join(root,'target'),JSON.stringify(ENGINE));symlinkSync(join(root,'target'),path);assert.throws(()=>readSqliteEngineReceipt(path));
});

test('unbound host and cleanup entries refuse before artifact, port or native work',async()=>{
 const unbound=JSON.parse(readFileSync(new URL('./android-beta-disposable-pins.json',import.meta.url)));await assert.rejects(makeLinuxIO(unbound));await assert.rejects(recoverDisposableCleanup(unbound));
 if(process.platform!=='linux'){await assert.rejects(makeLinuxIO(pins()));await assert.rejects(recoverDisposableCleanup(pins()));}
});

test('actual task signal handler writes CANCELLED after one cleanup, with later native stages unreached',()=>{
 const module=new URL('./android-beta-disposable-acceptance.mjs',import.meta.url).href;
 const script=`import {runDisposableAcceptance} from ${JSON.stringify(module)};const pins=${JSON.stringify(pins())};let cleaned=0;setInterval(()=>{},1000);const io={bind:async()=>{},artifacts:async()=>{},lease:()=>new Promise(()=>{}),cleanup:async()=>{cleaned++;return Object.fromEntries(['commandsStopped','emulatorStopped','adbStopped','avdDeleted','privateFilesDeleted','portsFree'].map(k=>[k,true]));},writeReceipt:async receipt=>console.log(JSON.stringify({receipt,cleaned}))};setTimeout(()=>process.kill(process.pid,'SIGTERM'),30);await runDisposableAcceptance(pins,()=>io);`;
 const result=spawnSync(process.execPath,['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON','--input-type=module','-e',script],{encoding:'utf8',timeout:5000,maxBuffer:16384,stdio:['ignore','pipe','pipe']});assert.equal(result.status,143);assert.equal(result.stderr,'');const value=JSON.parse(result.stdout);assert.equal(value.cleaned,1);assert.equal(value.receipt.status,'CANCELLED');assert.equal(value.receipt.failure.phase,'lease');assert.equal(value.receipt.failure.class,'cancelled');assert.deepEqual(value.receipt.phases.map(row=>row.phase),['binding','artifact-identity','lease','cleanup']);validateReceipt(value.receipt);
});

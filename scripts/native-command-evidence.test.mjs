import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,mkdirSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {nativeCommandState,readNativeCommandState} from './native-command-evidence.mjs';

const unknown={status:'UNKNOWN',kind:'unknown',targetId:null,sequence:0};
const row=(key,value,status,sequenceNumber=0)=>({command:{[key]:value},metadata:{status,sequenceNumber}});
const failed=row('scrollUntilVisible',{selector:{idRegex:'fontLicenses.react-native-vector-icons'}},'FAILED',26);
const running=row('tapOnElement',{selector:{idRegex:'account.sendCode'}},'RUNNING',27);

test('project actual leaf status/sequence, never infer failure or order competing unfinished leaves',()=>{
 assert.deepEqual(nativeCommandState([row('runFlowCommand',{},'FAILED',8),failed]),{status:'FAILED',kind:'scroll',targetId:'fontLicenses.react-native-vector-icons',sequence:26});
 assert.deepEqual(nativeCommandState([row('runFlowCommand',{},'FAILED',8),running]),{status:'RUNNING',kind:'tap',targetId:'account.sendCode',sequence:27});
 for(const records of [[failed,running],[running,failed],[failed,failed],[running,running]])assert.deepEqual(nativeCommandState(records),unknown);
 assert.deepEqual(nativeCommandState([row('assertConditionCommand',{condition:{visible:{idRegex:'account.code.input'}}},'FAILED')]),{status:'FAILED',kind:'assert',targetId:'account.code.input',sequence:0});
 assert.equal(nativeCommandState([row('assertConditionCommand',{condition:{notVisible:{idRegex:'screen.fontLicenses'}}},'FAILED')]).targetId,'screen.fontLicenses');
 for(const records of [null,{},[],Array(10001),[row('runFlowCommand',{},'FAILED')],[row('unknownCommand',{},'FAILED')],[{command:{tapOnElement:{},inputTextCommand:{}},metadata:{status:'FAILED',sequenceNumber:1}}],[{...failed,metadata:{status:'COMPLETED'}}]])assert.deepEqual(nativeCommandState(records),unknown);
 for(const sequenceNumber of [undefined,-1,0.5,'26',Number.MAX_SAFE_INTEGER+1])assert.deepEqual(nativeCommandState([{...failed,metadata:{status:'FAILED',sequenceNumber}}]),unknown);
});

test('discard secret-rich values, evaluated commands, errors, paths and arbitrary selectors',()=>{
 const secrets=['private-identity@example.invalid','873921','cookie=private-session','/private/auth/trace','private error stack'];
 const secret=secrets.join(' '),entry={command:{inputTextCommand:{text:secret,value:secret,path:secret}},metadata:{status:'FAILED',sequenceNumber:4,error:secret,stackTrace:secret,evaluatedCommand:{inputTextCommand:{text:secret}}},unknown:secret};
 assert.deepEqual(nativeCommandState([entry]),{status:'FAILED',kind:'input',targetId:null,sequence:4});
 for(const key of ['tapOnElement','scrollUntilVisible','assertConditionCommand']){
  const value={selector:{idRegex:secret,textRegex:secret},condition:{visible:{idRegex:secret,textRegex:secret}},text:secret};
  const projected=nativeCommandState([{...entry,command:{[key]:value}}]);assert.equal(projected.targetId,null);
  for(const value of secrets)assert.ok(!JSON.stringify(projected).includes(value));
  assert.deepEqual(Object.keys(projected),['status','kind','targetId','sequence']);
 }
 assert.deepEqual(nativeCommandState([{...entry,metadata:{status:secret,sequenceNumber:1}}]),unknown);
 const ambiguous={condition:{visible:{idRegex:'account.code.input'},notVisible:{idRegex:'account.email.input'}}};
 assert.equal(nativeCommandState([{...entry,command:{assertConditionCommand:ambiguous}}]).targetId,null);
});

test('identify only literal enable/open-account targets without exposing predicate text or runtime values',()=>{
 const ids=['screen.account','nav.account','account.enable','account.status','account.local.count','account.combine.dialog','account.combine.confirm'];
 const secret='private-identity@example.invalid 873921 cookie=private-session /private/auth';
 for(const id of ids)for(const [key,value,kind] of [
  ['tapOnElement',{selector:{idRegex:id,textRegex:secret}},'tap'],
  ['scrollUntilVisible',{selector:{idRegex:id,textRegex:secret}},'scroll'],
  ['assertConditionCommand',{condition:{visible:{idRegex:id,textRegex:secret}}},'assert'],
  ['assertConditionCommand',{condition:{notVisible:{idRegex:id,textRegex:secret}}},'assert'],
 ]){
  const entry=row(key,value,'FAILED',11);entry.metadata.error=secret;entry.metadata.evaluatedCommand={secret};
  const result=nativeCommandState([entry]);assert.deepEqual(result,{status:'FAILED',kind,targetId:id,sequence:11});assert.ok(!JSON.stringify(result).includes(secret));
 }
 for(const id of [secret,'account.enable.*','^account.enable$','account.enable/'+secret,'screen\\.(today|settings|account)','account.back']){
  const result=nativeCommandState([row('assertConditionCommand',{condition:{visible:{idRegex:id,textRegex:secret}}},'FAILED',11)]);
  assert.deepEqual(result,{status:'FAILED',kind:'assert',targetId:null,sequence:11});assert.ok(!JSON.stringify(result).includes(secret));
 }
 const failed=row('assertConditionCommand',{condition:{visible:{idRegex:'account.enable'}}},'FAILED',11),running=row('tapOnElement',{selector:{idRegex:'account.combine.confirm'}},'RUNNING',12);
 for(const records of [[failed,running],[running,failed]])assert.deepEqual(nativeCommandState(records),unknown);
});

test('read the observed2.11 timestamp/flow/commands.json layout without returning manifest or raw data',()=>{
 const root=mkdtempSync(join(tmpdir(),'puptime-command-layout-'));
 try{
  const flow=join(root,'2026-11-14_174137','Synthetic flow');mkdirSync(flow,{recursive:true});
  writeFileSync(join(flow,'manifest.json'),JSON.stringify({$schema:'https://storage.googleapis.com/maestro-schemas/artifact-manifest/v1.schema.json',entries:[{kind:'COMMAND_METADATA',format:'JSON',relativePath:'commands.json'}]}));
  writeFileSync(join(flow,'commands.json'),JSON.stringify([row('runFlowCommand',{},'FAILED',8),failed]));
  assert.deepEqual(readNativeCommandState(root),{status:'FAILED',kind:'scroll',targetId:'fontLicenses.react-native-vector-icons',sequence:26});
  const boundary=JSON.stringify([failed]).padEnd(2*1024*1024,' ');writeFileSync(join(flow,'commands.json'),boundary);assert.equal(readNativeCommandState(root).status,'FAILED');
  writeFileSync(join(flow,'commands.json'),JSON.stringify([running]));assert.equal(readNativeCommandState(root).status,'RUNNING');
  writeFileSync(join(root,'commands.json'),JSON.stringify([failed]));assert.deepEqual(readNativeCommandState(root),unknown);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('missing, malformed, oversized, invalid UTF8, symlink and ambiguous files fail closed',()=>{
 const root=mkdtempSync(join(tmpdir(),'puptime-command-reader-')),file=join(root,'commands.json');
 try{
  assert.deepEqual(readNativeCommandState(root),unknown);assert.deepEqual(readNativeCommandState(join(root,'missing')),unknown);
  for(const body of ['not json',Buffer.from([0xff]),Buffer.alloc(2*1024*1024+1,32),JSON.stringify([failed,running])]){writeFileSync(file,body);assert.deepEqual(readNativeCommandState(root),unknown);}
  rmSync(file);const outside=join(root,'private-raw.json');writeFileSync(outside,JSON.stringify([failed]));symlinkSync(outside,file);assert.deepEqual(readNativeCommandState(root),unknown);
  rmSync(file);mkdirSync(file);assert.deepEqual(readNativeCommandState(root),unknown);rmSync(file,{recursive:true});
  // No guessed historical filename alias is accepted.
  writeFileSync(join(root,'commands-(Synthetic flow).json'),JSON.stringify([failed]));assert.deepEqual(readNativeCommandState(root),unknown);
  for(let i=0;i<1025;i++)writeFileSync(join(root,'entry-'+i),'');assert.deepEqual(readNativeCommandState(root),unknown);
 }finally{rmSync(root,{recursive:true,force:true});}
});


// cli-2.11.0 commit c8c361be1cc89b2e742f185466a302a22778be6b:
// maestro-orchestra-models/src/main/java/maestro/orchestra/MaestroCommand.kt
// declares/constructs scrollUntilVisible (lines66/119); Commands.kt owns selector.
test('pinned2.11 serialized scroll uses only scrollUntilVisible, never the invented Command suffix',()=>{
 const value={selector:{idRegex:'fontLicenses.react-native-vector-icons',textRegex:'private identity@example.invalid 654321'},direction:'DOWN',scrollDuration:'601',timeout:'20000',visibilityPercentage:100,centerElement:false};
 const metadata={status:'FAILED',sequenceNumber:41,error:'private body/header/cookie',evaluatedCommand:{private:'secret'}};
 const result=nativeCommandState([{command:{scrollUntilVisible:value},metadata}]);
 assert.deepEqual(result,{status:'FAILED',kind:'scroll',targetId:'fontLicenses.react-native-vector-icons',sequence:41});
 for(const secret of ['identity@example.invalid','654321','private body/header/cookie','secret'])assert.ok(!JSON.stringify(result).includes(secret));
 assert.deepEqual(nativeCommandState([{command:{scrollUntilVisibleCommand:value},metadata}]),unknown,'No legacy alias for a key absent from the pinned model.');
 assert.deepEqual(nativeCommandState([{command:{scrollUntilVisible:value,scrollUntilVisibleCommand:value},metadata}]),unknown,'A mixed command union remains ambiguous.');
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {EventEmitter} from 'node:events';
import {existsSync,lstatSync,mkdtempSync,mkdirSync,readFileSync,realpathSync,renameSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {nativeCommandState,readNativeCommandState,nativeFlowSources,readNativeFlowCommandState} from './native-command-evidence.mjs';
import {prepareFlowCommandRoot,writeFlowCommandVerdict} from './native-flow-command-verdict.mjs';
import {standardSelection,conversationalFiles} from './native-standard-suite.mjs';
import {standardVerdict,conversationalVerdict,writeStandardVerdict,writeConversationalVerdict} from './native-standard-verdict.mjs';
import {execFileSync,spawnSync} from 'node:child_process';
import {createRequire,syncBuiltinESMExports} from 'node:module';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs';

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

// cli-2.11.0 YamlFluentCommand.extendedWait maps notVisible to the same
// AssertConditionCommand; ThemePicker owns this literal close-button testID.
test('project the actual picker-dismissal notVisible boundary without disclosing unknown selectors',()=>{
 const secret='private@example.invalid 873921 cookie=private-session /private/raw';
 const entry=id=>{const value=row('assertConditionCommand',{condition:{notVisible:{idRegex:id,textRegex:secret}},timeout:'5000'},'FAILED',151);value.metadata.error=secret;value.metadata.evaluatedCommand={secret};return value;};
 assert.deepEqual(nativeCommandState([entry('appearance.close')]),{status:'FAILED',kind:'assert',targetId:'appearance.close',sequence:151});
 for(const id of [secret,'appearance.close.extra','^appearance.close$','appearance.*']){
  const result=nativeCommandState([entry(id)]);assert.deepEqual(result,{status:'FAILED',kind:'assert',targetId:null,sequence:151});assert.ok(!JSON.stringify(result).includes(secret));
 }
 assert.deepEqual(nativeCommandState([{...entry('appearance.close'),command:{unknownCommand:{secret}}}]),unknown);
 for(const records of [[entry('appearance.close'),running],[running,entry('appearance.close')]])assert.deepEqual(nativeCommandState(records),unknown);
});

test('identify only literal enable/open-account targets without exposing predicate text or runtime values',()=>{
 const comparisonIds=['account.connection.phone.name','account.connection.phone.count','account.connection.cloud.name','account.connection.cloud.count','account.combine.phone.name','account.combine.phone.count','account.combine.cloud.name','account.combine.cloud.count','account.combine.cancel','account.keepLocal'];
 const ids=['screen.account','nav.account','account.enable','account.status','account.local.count','account.combine.dialog','account.combine.confirm',...comparisonIds];
 const flow=readFileSync(new URL('../.maestro/account-preservation/comparison-preview.yaml',import.meta.url),'utf8');for(const id of comparisonIds)assert.ok(flow.includes('id: '+id+'\n'));
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
 for(const id of [secret,'account.enable.*','^account.enable$','account.enable/'+secret,'screen\\.(today|settings|account)','account.back','account.connection.phone.secret','account.connection.*','account.combine.phone.name.extra']){
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

test('actual diagnostic flow catches preserve original errors and cleanup on reader, writer and screenshot failures',async()=>{
 const sdk=readFileSync(new URL('./verify-native-guest-account.mjs',import.meta.url),'utf8'),start=sdk.indexOf('async function flow(name,env={}){'),end=sdk.indexOf("\nlet email=",start);assert.ok(start>0&&end>start);
 const body=sdk.slice(start,end),secret='synthetic-identity@example.invalid 873921 cookie=private-session /private/auth/trace';
 const execute=Function('name','privateDir','run','writeFileSync','readNativeCommandState','rmSync','existsSync','readdirSync','join','resolve','process','android','simctl',`return (async()=>{let activeFlow='startup',flowSequence=0,setupWindow;const device='synthetic',output='/synthetic-output',email='synthetic-identity@example.invalid',code='',requests=new Set(['/api/config']),authResponses=[],homedir=()=>'/synthetic-home',Date={now:()=>42},markStartup=()=>{},console={log(){}};${body};await flow(name);})();`);
 for(const options of [{},{readerFails:true},{writerFails:true},{name:'request'},{name:'comparison-preview',android:false},{name:'comparison-preview',android:false,readerFails:true},{name:'comparison-preview',android:false,writerFails:true},{name:'comparison-preview',android:false,captureFails:true},{name:'comparison-preview',android:true},{name:'request',android:false},{name:'verify',android:false}]){
  const name=options.name??'add-logs',file=name==='add-logs'?'fixture-add-logs-command.json':name==='comparison-preview'?'fixture-comparison-command.json':null,target=name==='comparison-preview'?'account.connection.phone.count':'account.local.count',root=mkdtempSync(join(tmpdir(),'puptime-flow-command-')),artifacts=join(root,'maestro-'+name+'-42'),writes=[],captures=[];let reads=0,cleaned=0;
  try{
   mkdirSync(artifacts);writeFileSync(join(artifacts,'commands.json'),JSON.stringify([row('assertConditionCommand',{condition:{visible:{idRegex:target,textRegex:secret}}},'FAILED',12)]));
   const original=new Error(secret);for(const key of ['message','stack'])Object.defineProperty(original,key,{get(){throw new Error('Do not read raw Error fields');}});original.toJSON=()=>{throw new Error('Do not serialize the Error');};
   const promise=execute(name,root,async()=>{throw original;},(path,text,mode)=>{if(options.writerFails&&path.endsWith('/'+file))throw new Error('Synthetic writer failure');writes.push({path,value:JSON.parse(text),mode});},path=>{reads++;assert.equal(path,artifacts);if(options.readerFails)throw new Error('Synthetic reader failure');return readNativeCommandState(path);},(path,options)=>{cleaned++;assert.equal(path,artifacts);rmSync(path,options);},path=>path===artifacts&&existsSync(path),()=>['commands.json','synthetic-hierarchy.json'],join,resolve,{env:{}},options.android??true,(...args)=>{captures.push(args);if(options.captureFails)throw new Error(secret);});
   await assert.rejects(promise,error=>error===original);assert.equal(cleaned,1);assert.equal(existsSync(artifacts),false);assert.equal(reads,file?1:0);
   const evidence=writes.filter(row=>row.path.endsWith('/'+file));
   if(file&&!options.readerFails&&!options.writerFails)assert.deepEqual(evidence,[{path:'/synthetic-output/'+file,value:{phase:name,flowSequence:1,status:'FAILED',kind:'assert',targetId:target,sequence:12},mode:{mode:0o600}}]);else assert.deepEqual(evidence,[]);
   assert.deepEqual(captures,name==='comparison-preview'&&options.android===false?[['io','synthetic','screenshot','/synthetic-output/failure-comparison-preview.png']]:[]);assert.ok(!writes.some(row=>row.path.endsWith('-hierarchy.txt')));
   assert.ok(!JSON.stringify(writes).includes(secret));assert.equal(writes.filter(row=>row.path.endsWith('/fixture-native-reach.json')).length,1);assert.equal(writes.filter(row=>row.path.endsWith('/fixture-auth-readiness.json')).length,1);
  }finally{rmSync(root,{recursive:true,force:true});}
 }
});

test('comparison preview and its only helper navigate and inspect without entering credentials',()=>{
 const flow=readFileSync(new URL('../.maestro/account-preservation/comparison-preview.yaml',import.meta.url),'utf8'),helper=readFileSync(new URL('../.maestro/helpers/open-account.yaml',import.meta.url),'utf8');
 assert.deepEqual([...flow.matchAll(/runFlow: (.+)/g)].map(match=>match[1]),['../helpers/open-account.yaml','../helpers/open-account.yaml']);
 for(const source of [flow,helper])assert.doesNotMatch(source,/inputText|eraseText|runScript|TEST_EMAIL|MAESTRO_TEST_CODE|account\.(email|code|sendCode|verify)/);
 const sdk=readFileSync(new URL('./verify-native-guest-account.mjs',import.meta.url),'utf8'),start=sdk.indexOf('async function verifyPuppyComparison(){'),end=sdk.indexOf('\nconst childEnv=',start);assert.ok(start>0&&end>start);const body=sdk.slice(start,end);
 assert.equal((body.match(/flow\('comparison-preview'/g)??[]).length,1);assert.ok(body.indexOf('await signIn();')<body.indexOf("flow('comparison-preview'"));
 assert.ok(sdk.includes("if(!android&&['prepare','add-logs'].includes(name)){"),'Comparison capture must never enter the legacy hierarchy-export branch.');
});

// Execute only the actual reader functions with request mocks, never SDK main or sockets.
function accountReader(name,request){
 const sdk=readFileSync(new URL('./verify-native-guest-account.mjs',import.meta.url),'utf8');
 const start=sdk.indexOf('async function '+name+'('),end=sdk.indexOf(name==='remote'?'\nasync function assertCloud(':'\nfunction drainReceipt(',start);assert.ok(start>0&&end>start);
 return Function('request','secureRequest','backPort','front','certificate','assert','cookie','return ('+sdk.slice(start,end)+');')(request,request,1,'https://127.0.0.1:1',Buffer.from('synthetic-ca'),assert,'synthetic');
}
function accountRequest({body,error}={}){
 const calls=[];
 const request=(url,options,callback)=>{const req=new EventEmitter();calls.push({url,options,timeout:null});req.setTimeout=ms=>{calls.at(-1).timeout=ms;return req;};req.end=()=>queueMicrotask(()=>{if(error){req.emit('error',error);return;}const response=new EventEmitter();response.statusCode=200;callback(response);response.emit('data',JSON.stringify(body));response.emit('end');});return req;};
 return {request,calls};
}
test('actual account verification readers use one-request agents with exact URLs, explicit headers, CA and inspection timeout',async()=>{
 const session=accountRequest({body:{user:{id:'usr_synthetic'}}});
 assert.deepEqual(await accountReader('inspectSession',session.request)('synthetic'),{status:200,body:{user:{id:'usr_synthetic'}}});
 assert.deepEqual(session.calls,[{url:'http://127.0.0.1:1/api/account',options:{agent:false,headers:{cookie:'synthetic'}},timeout:15000}]);
 for(const inspectBehindFault of [false,true]){
  const remote=accountRequest({body:{changes:[],hasMore:false}});
  assert.deepEqual(await accountReader('remote',remote.request)({inspectBehindFault,sessionCookie:'synthetic',allKinds:true}),[]);
  assert.deepEqual(remote.calls,[{url:(inspectBehindFault?'http://127.0.0.1:1':'https://127.0.0.1:1')+'/api/sync/pull?after=0',options:{agent:false,...(!inspectBehindFault?{ca:Buffer.from('synthetic-ca')}:{}),headers:{cookie:'synthetic',origin:'https://127.0.0.1:1',host:'127.0.0.1:1'}},timeout:null}]);
 }
});
test('actual account verification readers preserve request Error identity and never retry',async()=>{
 const original=new Error('synthetic request failure');original.code='ECONNRESET';
 for(const name of ['inspectSession','remote'])for(const inspectBehindFault of name==='remote'?[false,true]:[false]){
  const mock=accountRequest({error:original}),argument=name==='remote'?{inspectBehindFault,sessionCookie:'synthetic',allKinds:true}:'synthetic';
  await assert.rejects(accountReader(name,mock.request)(argument),error=>error===original);assert.equal(mock.calls.length,1);
 }
});

const absentFlow={flowIndex:null,...unknown,observedLeaves:{nonCausal:true,complete:false,rows:[]}};
const flowIdentity=path=>{const value=lstatSync(path);return {dev:String(value.dev),ino:String(value.ino)};};
function fixedTree(root,suite,records=[failed]){
 const session=join(root,'2026-11-16_123456');
 for(const [,name] of nativeFlowSources[suite]){mkdirSync(join(session,name),{recursive:true});writeFileSync(join(session,name,'commands.json'),Buffer.from([255]));}
 const selected=join(session,nativeFlowSources[suite][0][1],'commands.json');writeFileSync(selected,JSON.stringify(records));return {session,selected};
}
function flowTemporary(run){const root=realpathSync(mkdtempSync(join(tmpdir(),'puptime-fixed-flow-')));try{return run(root);}finally{rmSync(root,{recursive:true,force:true});}}
const require=createRequire(import.meta.url),{parse}=require('yaml');
test('all30 fixed source mappings are literal, sanitized and unique; added targets come only from the approved00 closure',()=>{
 assert.deepEqual(nativeFlowSources.standard13.map(([flow])=>flow),standardSelection('standard-all').files);assert.deepEqual(nativeFlowSources.conversational17.map(([flow])=>flow),conversationalFiles);
 for(const rows of Object.values(nativeFlowSources)){
  assert.equal(new Set(rows.map(([,name])=>name)).size,rows.length);assert.ok(Object.isFrozen(rows));
  for(const [flow,name] of rows){const config=parse(readFileSync(flow,'utf8').split('\n---')[0]);assert.equal(typeof config.name,'string');assert.ok(!config.name.includes('${'));assert.equal(name,config.name.replaceAll('/','_'));}
 }
 const closure=['.maestro/ios/00-onboarding.yaml','.maestro/conversational/03-skip-optional-setup.yaml','.maestro/helpers/conversational/to-reminders.yaml','.maestro/helpers/conversational/skip-sharing.yaml'];
 const ids=new Set(closure.flatMap(path=>[...readFileSync(path,'utf8').matchAll(/^\s+id: ([A-Za-z][A-Za-z0-9_.-]*)\s*$/gm)].map(match=>match[1])));
 for(const id of ids)assert.equal(nativeCommandState([row('tapOnElement',{selector:{idRegex:id}},'FAILED',2)]).targetId,id);
 // The149 comparison targets remain approved; regex/text/dynamic values do not.
 for(const id of ['account.connection.phone.name','account.connection.phone.count','account.connection.cloud.name','account.connection.cloud.count','account.combine.phone.name','account.combine.phone.count','account.combine.cloud.name','account.combine.cloud.count','account.combine.cancel','account.keepLocal'])assert.equal(nativeCommandState([row('tapOnElement',{selector:{idRegex:id}},'FAILED',2)]).targetId,id);
 for(const id of ['^preview.skip$','preview.(skip|back)','${PRIVATE}','private@example.invalid'])assert.equal(nativeCommandState([row('tapOnElement',{selector:{idRegex:id}},'FAILED',2)]).targetId,null);
});

test('fixed13/17 selects only its one literal commands file, retaining actual primary ambiguity and noncausal retry order',()=>{
 for(const suite of ['standard13','conversational17'])flowTemporary(root=>{
  const {selected}=fixedTree(root,suite),original=fs.openSync,opened=[];
  try{fs.openSync=(path,...args)=>{opened.push(String(path));return original(path,...args);};syncBuiltinESMExports();
   const value=readNativeFlowCommandState(root,suite,0,flowIdentity(root));assert.deepEqual(value,{flowIndex:0,...nativeCommandState([failed]),observedLeaves:{nonCausal:true,complete:true,rows:[nativeCommandState([failed])]}});assert.deepEqual(opened,[selected]);
  }finally{fs.openSync=original;syncBuiltinESMExports();}
  writeFileSync(selected,JSON.stringify([failed]).padEnd(2*1024*1024,' '));assert.equal(readNativeFlowCommandState(root,suite,0,flowIdentity(root)).status,'FAILED');
  for(const records of [[failed,running],[running,failed],[failed,{...failed,metadata:{status:'FAILED',sequenceNumber:99}}]]){
   writeFileSync(selected,JSON.stringify(records));const value=readNativeFlowCommandState(root,suite,0,flowIdentity(root));assert.deepEqual({...value,flowIndex:undefined,observedLeaves:undefined},{...unknown,flowIndex:undefined,observedLeaves:undefined});assert.deepEqual(value.observedLeaves,{nonCausal:true,complete:true,rows:records.map(record=>nativeCommandState([record]))});
  }
  const secret='private@example.invalid 654321 cookie=SECRET /private/raw';const privateRows=[row('inputTextCommand',{text:secret},'FAILED',4),row('tapOnElement',{selector:{idRegex:secret,textRegex:secret}},'RUNNING',5)];for(const entry of privateRows){entry.metadata.error=secret;entry.metadata.evaluatedCommand={text:secret};}writeFileSync(selected,JSON.stringify(privateRows));const projected=readNativeFlowCommandState(root,suite,0,flowIdentity(root));assert.equal(projected.status,'UNKNOWN');assert.deepEqual(projected.observedLeaves.rows,privateRows.map(entry=>nativeCommandState([entry])));assert.ok(!JSON.stringify(projected).includes('SECRET'));
  writeFileSync(selected,JSON.stringify([failed]));const fstat=fs.fstatSync;let calls=0;try{fs.fstatSync=(...args)=>{const value=fstat(...args);return ++calls===2?{...value,mtimeMs:value.mtimeMs+1}:value;};syncBuiltinESMExports();assert.deepEqual(readNativeFlowCommandState(root,suite,0,flowIdentity(root)),absentFlow);}finally{fs.fstatSync=fstat;syncBuiltinESMExports();}
  writeFileSync(selected,JSON.stringify(Array(10001).fill({})));assert.deepEqual(readNativeFlowCommandState(root,suite,0,flowIdentity(root)).observedLeaves,{nonCausal:true,complete:false,rows:[]});
  for(const [records,expected] of [[[],{nonCausal:true,complete:true,rows:[]}],[[row('runFlowCommand',{},'FAILED',1)],{nonCausal:true,complete:true,rows:[]}],[[row('unreviewedCommand',{secret:'private'},'FAILED',1)],{nonCausal:true,complete:false,rows:[unknown]}],[Array(9).fill(failed),{nonCausal:true,complete:false,rows:[]}]]){writeFileSync(selected,JSON.stringify(records));assert.deepEqual(readNativeFlowCommandState(root,suite,0,flowIdentity(root)).observedLeaves,expected);}
 });
});

test('missing custody, stale/multiple sessions, collision/shard aliases and unsafe bounded input never select a guessed file',()=>{
 for(const kind of ['missing-identity','wrong-identity','missing','two-sessions','suffix','shard','flat','nested','symlink','directory','oversized','utf8','malformed','deep','entries'])flowTemporary(root=>{
  const {session,selected}=fixedTree(root,'standard13');let identity=flowIdentity(root);
  if(kind==='missing-identity')identity=undefined;
  if(kind==='wrong-identity')identity={...identity,ino:'0'};
  if(kind==='missing')rmSync(selected);
  if(kind==='two-sessions')mkdirSync(join(root,'2026-11-16_123457')); // No newest/single-target fallback.
  if(kind==='suffix'||kind==='shard')renameSync(join(session,nativeFlowSources.standard13[0][1]),join(session,nativeFlowSources.standard13[0][1]+(kind==='suffix'?'-2':'-shard-1')));
  if(kind==='flat'){rmSync(session,{recursive:true});writeFileSync(join(root,'commands.json'),JSON.stringify([failed]));}
  if(kind==='nested'){mkdirSync(join(selected,'../extra'));writeFileSync(join(selected,'../extra/commands.json'),JSON.stringify([failed]));}
  if(kind==='symlink'){rmSync(selected);writeFileSync(join(root,'outside'),JSON.stringify([failed]));symlinkSync(join(root,'outside'),selected);}
  if(kind==='directory'){rmSync(selected);mkdirSync(selected);}
  if(kind==='oversized')writeFileSync(selected,Buffer.alloc(2*1024*1024+1));
  if(kind==='utf8')writeFileSync(selected,Buffer.from([255]));
  if(kind==='malformed')writeFileSync(selected,'private token=SECRET');
  if(kind==='deep')mkdirSync(join(selected,'../a/b/c'),{recursive:true});
  if(kind==='entries')for(let i=0;i<1025;i++)writeFileSync(join(session,'entry-'+i),'');
  assert.deepEqual(readNativeFlowCommandState(root,'standard13',0,identity),absentFlow,kind);
 });
});

const commandEnv={GITHUB_RUN_ID:'123456789',GITHUB_RUN_ATTEMPT:'2',FLOW_COMMAND_PREPARATION_OUTCOME:'success'};
function commandCheckout(root){execFileSync('git',['init','--quiet'],{cwd:root});execFileSync('git',['-c','core.hooksPath=/dev/null','-c','commit.gpgsign=false','-c','user.name=Synthetic','-c','user.email=fixture@example.invalid','commit','--allow-empty','--quiet','-m','fixture'],{cwd:root});}
function writeSourceVerdict(root,suite,custody){const rows=nativeFlowSources[suite],xml='<testsuites><testsuite tests="'+rows.length+'" failures="1">'+rows.map(([flow],i)=>'<testcase file="'+flow+'" status="'+(i===0?'ERROR':'SUCCESS')+'"/>').join('')+'</testsuite></testsuites>',name=suite==='standard13'?'standard':'conversational',project=suite==='standard13'?standardVerdict:conversationalVerdict;const value=project(xml,{...custody,runAttempt:String(custody.runAttempt),stepConclusion:'failure'});writeFileSync(join(root,'build',name+'-verdict.json'),JSON.stringify(value));return value;}
test('preparation rejects preexisting verdicts or carriers before creating custody, preserving prior bytes',()=>{
 for(const suite of ['standard13','conversational17'])for(const suffix of ['-command-custody.json','-verdict.json','-failed-command.json'])flowTemporary(root=>{
  commandCheckout(root);mkdirSync(join(root,'build'));const name=suite==='standard13'?'standard':'conversational',file=join(root,'build',name+suffix),bytes=Buffer.from('synthetic old receipt');writeFileSync(file,bytes);
  assert.throws(()=>prepareFlowCommandRoot(root,suite,commandEnv));assert.deepEqual(readFileSync(file),bytes);assert.equal(existsSync(join(root,'build',suite==='standard13'?'maestro-results':'onboarding-maestro-results')),false);
  if(suffix!=='-failed-command.json'){const value=writeFlowCommandVerdict(root,suite,{...commandEnv,FLOW_COMMAND_PREPARATION_OUTCOME:'failure'});assert.equal(value.status,'UNKNOWN');assert.deepEqual(value.observedLeaves,{nonCausal:true,complete:false,rows:[]});assert.deepEqual(readFileSync(file),bytes);}
 });
});
test('actual producer binds fresh exclusive preparation, source/run/attempt and one exactERROR, exposing no other fields',()=>{
 for(const suite of ['standard13','conversational17'])for(const kind of ['valid','failed-preparation','wrong-source','wrong-run','partial','multiple','unknown-field','missing-custody','wrong-marker','old-marker','missing-directory','wrong-directory'])flowTemporary(root=>{
  commandCheckout(root);const name=suite==='standard13'?'standard':'conversational',output=join(root,'build',suite==='standard13'?'maestro-results':'onboarding-maestro-results');
  const custody=prepareFlowCommandRoot(root,suite,commandEnv);const {selected}=fixedTree(output,suite);const value=writeSourceVerdict(root,suite,custody),report=join(root,'build',name+'-verdict.json');let environment=commandEnv;
  if(kind==='failed-preparation'){assert.throws(()=>prepareFlowCommandRoot(root,suite,commandEnv));environment={...commandEnv,FLOW_COMMAND_PREPARATION_OUTCOME:'failure'};}
  if(kind==='wrong-source')value.checkoutCommit='a'.repeat(40);
  if(kind==='wrong-run')value.runId='999';
  if(kind==='partial')value.complete=false;
  if(kind==='multiple')value.flows[1].status='ERROR';
  if(kind==='unknown-field')value.private='private@example.invalid 123456 cookie=SECRET';
  if(kind==='missing-custody')rmSync(join(root,'build',name+'-command-custody.json'));
  if(kind==='wrong-marker'||kind==='old-marker'){const marker={...custody,...(kind==='wrong-marker'?{checkoutCommit:'a'.repeat(40)}:{runAttempt:1})};writeFileSync(join(root,'build',name+'-command-custody.json'),JSON.stringify(marker));}
  if(kind==='missing-directory')rmSync(output,{recursive:true});
  if(kind==='wrong-directory'){renameSync(output,output+'-old');mkdirSync(output);fixedTree(output,suite);}
  writeFileSync(report,JSON.stringify(value));const original=fs.openSync,opened=[];let result;
  try{fs.openSync=(path,...args)=>{if(String(path).endsWith('/commands.json'))opened.push(String(path));return original(path,...args);};syncBuiltinESMExports();result=writeFlowCommandVerdict(root,suite,environment);}finally{fs.openSync=original;syncBuiltinESMExports();}
  assert.equal(result.status,kind==='valid'?'FAILED':'UNKNOWN');assert.deepEqual(opened,kind==='valid'?[selected]:[]);assert.ok(!JSON.stringify(result).includes('SECRET'));
  assert.equal(result.custodyConfirmed,!['failed-preparation','missing-custody','wrong-marker','old-marker','missing-directory','wrong-directory'].includes(kind));
  const file=join(root,'build',name+'-failed-command.json'),bytes=readFileSync(file);assert.equal(lstatSync(file).mode&0o777,0o600);assert.throws(()=>writeFlowCommandVerdict(root,suite,environment));assert.deepEqual(readFileSync(file),bytes);
 });
});

test('actual stale raw JUnit reproduction is rejected before custody/root creation and never opens commands',()=>{
 for(const [suite,name,report,project] of [['standard13','standard','maestro-report.xml',writeStandardVerdict],['conversational17','conversational','onboarding-maestro-report.xml',writeConversationalVerdict]])flowTemporary(root=>{
  commandCheckout(root);mkdirSync(join(root,'build'));const rows=nativeFlowSources[suite],xml='<testsuites><testsuite tests="'+rows.length+'" failures="1">'+rows.map(([flow],i)=>'<testcase file="'+flow+'" status="'+(i===0?'ERROR':'SUCCESS')+'"/>').join('')+'</testsuite></testsuites>',file=join(root,'build',report);writeFileSync(file,xml);
  assert.throws(()=>prepareFlowCommandRoot(root,suite,commandEnv));const output=join(root,'build',suite==='standard13'?'maestro-results':'onboarding-maestro-results');assert.equal(existsSync(output),false);assert.equal(existsSync(join(root,'build',name+'-command-custody.json')),false);
  // Reproject the old XML with the unchanged real producer, as in the peer repro.
  const old=project(root,{...commandEnv,STANDARD_STEP_CONCLUSION:'failure',ONBOARDING_STEP_CONCLUSION:'failure'});assert.equal(old.complete,true);assert.equal(old.flows[0].status,'ERROR');
  const open=fs.openSync,opened=[];let value;try{fs.openSync=(path,...args)=>{if(String(path).endsWith('/commands.json'))opened.push(String(path));return open(path,...args);};syncBuiltinESMExports();value=writeFlowCommandVerdict(root,suite,{...commandEnv,FLOW_COMMAND_PREPARATION_OUTCOME:'failure'});}finally{fs.openSync=open;syncBuiltinESMExports();}
  assert.equal(value.custodyConfirmed,false);assert.deepEqual({flowIndex:value.flowIndex,status:value.status,kind:value.kind,targetId:value.targetId,sequence:value.sequence,observedLeaves:value.observedLeaves},absentFlow);assert.deepEqual(opened,[]);assert.equal(existsSync(output),false);assert.equal(readFileSync(file,'utf8'),xml);
 });
});

test('fresh actual JUnit projection confirms custody before error selection, including allSUCCESS without a command claim',()=>{
 for(const [suite,report,project] of [['standard13','maestro-report.xml',writeStandardVerdict],['conversational17','onboarding-maestro-report.xml',writeConversationalVerdict]])for(const errorIndex of [-1,0])flowTemporary(root=>{
  commandCheckout(root);prepareFlowCommandRoot(root,suite,commandEnv);const output=join(root,'build',suite==='standard13'?'maestro-results':'onboarding-maestro-results'),{selected}=fixedTree(output,suite),rows=nativeFlowSources[suite],xml='<testsuites><testsuite tests="'+rows.length+'" failures="'+Number(errorIndex>=0)+'">'+rows.map(([flow],i)=>'<testcase file="'+flow+'" status="'+(i===errorIndex?'ERROR':'SUCCESS')+'"/>').join('')+'</testsuite></testsuites>';writeFileSync(join(root,'build',report),xml);project(root,{...commandEnv,STANDARD_STEP_CONCLUSION:errorIndex<0?'success':'failure',ONBOARDING_STEP_CONCLUSION:errorIndex<0?'success':'failure'});
  const open=fs.openSync,opened=[];let value;try{fs.openSync=(path,...args)=>{if(String(path).endsWith('/commands.json'))opened.push(String(path));return open(path,...args);};syncBuiltinESMExports();value=writeFlowCommandVerdict(root,suite,commandEnv);}finally{fs.openSync=open;syncBuiltinESMExports();}
  assert.equal(value.custodyConfirmed,true);assert.equal(value.status,errorIndex<0?'UNKNOWN':'FAILED');assert.deepEqual(opened,errorIndex<0?[]:[selected]);if(errorIndex<0){assert.equal(value.flowIndex,null);assert.deepEqual(value.observedLeaves,{nonCausal:true,complete:false,rows:[]});}
 });
});

test('fixed producer CLI has no arbitrary path/mode and writer failures cannot replace original workflow failures',()=>flowTemporary(root=>{
 commandCheckout(root);const cli=fileURLToPath(new URL('./native-flow-command-verdict.mjs',import.meta.url));
 for(const args of [[],['--standard13','private-path'],['--arbitrary'],['private-path']]){const value=spawnSync(process.execPath,[cli,...args],{cwd:root,env:{...process.env,...commandEnv},encoding:'utf8'});assert.equal(value.status,1);assert.equal(value.stdout,'');assert.equal(value.stderr,'Flow command evidence unavailable.\n');}
 const prepare=spawnSync(process.execPath,[cli,'--prepare-standard13'],{cwd:root,env:{...process.env,...commandEnv},encoding:'utf8'});assert.equal(prepare.status,0);assert.equal(prepare.stdout+prepare.stderr,'');
 const original=fs.writeFileSync;try{fs.writeFileSync=()=>{throw new Error('private writer failure');};syncBuiltinESMExports();assert.throws(()=>writeFlowCommandVerdict(root,'standard13',commandEnv),/private writer failure/);}finally{fs.writeFileSync=original;syncBuiltinESMExports();}
 const custody=JSON.parse(readFileSync(join(root,'build/standard-command-custody.json')));fixedTree(join(root,'build/maestro-results'),'standard13');writeSourceVerdict(root,'standard13',custody);const actual=spawnSync(process.execPath,[cli,'--standard13'],{cwd:root,env:{...process.env,...commandEnv},encoding:'utf8'});assert.equal(actual.status,0);assert.equal(actual.stdout+actual.stderr,'');const output=join(root,'build/standard-failed-command.json'),prior=readFileSync(output);assert.equal(JSON.parse(prior).status,'FAILED');const rejected=spawnSync(process.execPath,[cli,'--standard13'],{cwd:root,env:{...process.env,...commandEnv},encoding:'utf8'});assert.equal(rejected.status,1);assert.equal(rejected.stdout,'');assert.equal(rejected.stderr,'Flow command evidence unavailable.\n');assert.deepEqual(readFileSync(output),prior);
 const steps=parse(readFileSync('.github/workflows/ios-simulator.yml','utf8')).jobs.build.steps;
 for(const [suite,name,runId] of [['standard13','standard','standard_maestro'],['conversational17','conversational','onboarding_combined']]){
  const before=steps.findIndex(step=>step.id===runId),prep=steps[before-1],capture=steps.find(step=>step.name==='Capture finite '+name+' failed command'),upload=steps[steps.indexOf(capture)+1];
  assert.equal(prep.id,name+'_command_prepare');assert.equal(prep['continue-on-error'],true);assert.equal(prep.run,'node scripts/native-flow-command-verdict.mjs --prepare-'+suite);
  assert.equal(capture.if,'always()');assert.equal(capture['continue-on-error'],true);assert.deepEqual(capture.env,{FLOW_COMMAND_PREPARATION_OUTCOME:'${{ steps.'+name+'_command_prepare.outcome }}'});assert.equal(capture.run,'node scripts/native-flow-command-verdict.mjs --'+suite);
  assert.equal(capture.id,name+'_command_capture');assert.equal(upload.if,"always() && steps."+name+"_command_capture.outcome == 'success'");assert.equal(upload['continue-on-error'],true);assert.equal(upload.with.path,'build/'+name+'-failed-command.json');assert.equal(upload.with.name,'puptime-ios-'+name+'-failed-command');
 }
}));

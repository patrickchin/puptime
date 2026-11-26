import assert from 'node:assert/strict';
import test from 'node:test';
import {EventEmitter} from 'node:events';
import {existsSync,mkdtempSync,mkdirSync,readFileSync,readdirSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {parseAllDocuments} from 'yaml';
import {nativeCommandState,readNativeCommandState} from './native-command-evidence.mjs';

// Proxy regression: execute the real source without starting its native/worker main.
test('fixture proxy settles truncated upstream responses and records finite outcomes',async()=>{
 const {createServer,request}=await import('node:http');
 const source=readFileSync(new URL('./verify-native-guest-account.mjs',import.meta.url),'utf8');
 const declarations=source.slice(source.indexOf('let worker,workerError,'),source.indexOf('function wireFailure('));
 const start=source.indexOf('  const forward=(req,res)=>{'),end=source.indexOf('\n  proxy=secureServer',start);assert.ok(start>0&&end>start);
 const unused=()=>{throw new Error('Unexpected synthetic proxy branch.');};
 const make=Function('request','front','backPort','upgrading','capturedJson','mutationSchema','wireFailure','pushResponseSchema','pullPageSchema',declarations+"\nactiveFlow='onboarding-request';flowSequence=1;\n"+source.slice(start,end)+'\nreturn {forward,read:()=>({activeForwarded,responses:authResponses})};');
 async function run(mode){
  const servers=[],sockets=new Set(),timers=new Set();let observer,truncated=false,closed,upstreamClosed;const responseClosed=new Promise(resolve=>{closed=resolve;}),upstreamResponseClosed=new Promise(resolve=>{upstreamClosed=resolve;});
  const row={headers:false,bytes:0,status:null,terminal:null,settledBeforeDeadline:false,active:null,responses:null,cleanup:null};
  const own=server=>{servers.push(server);server.on('connection',socket=>sockets.add(socket));return server;};
  const listen=async server=>{await new Promise((yes,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',yes);});return server.address().port;};
  try{
   const backend=own(createServer((req,res)=>{
    assert.equal(req.method,'POST');assert.equal(req.url,'/api/auth/email-otp/send-verification-otp');req.resume();res.once('close',upstreamClosed);
    if(mode==='complete')res.writeHead(200,{'content-type':'application/json'}).end('{"synthetic":true}');
    else if(mode==='before-headers')req.socket.destroy();
    else{
     res.writeHead(mode==='client-abandon'?302:200,{'content-type':'application/json','content-length':'64'});res.flushHeaders();res.write('{"synthetic":');
     if(mode!=='client-abandon'){const timer=setTimeout(()=>{truncated=true;res.socket?.destroy();timers.delete(timer);},50);timers.add(timer);}
    }
   }));
   const backPort=await listen(backend),proxy=own(createServer((req,res)=>{res.once('close',closed);observer.forward(req,res);})),frontPort=await listen(proxy);
   observer=make(request,'http://127.0.0.1:'+frontPort,backPort,false,unused,{parse:unused},unused,{parse:unused},{parse:unused});
   await new Promise(resolve=>{
    let settled=false,deadline=false,response;
    const finish=terminal=>{if(settled)return;settled=true;row.terminal=terminal;row.settledBeforeDeadline=!deadline;clearTimeout(timer);timers.delete(timer);resolve();};
    const req=request('http://127.0.0.1:'+frontPort+'/api/auth/email-otp/send-verification-otp',{method:'POST',agent:false,headers:{'content-type':'application/json'}},res=>{
     response=res;row.headers=true;row.status=res.statusCode;res.on('data',b=>{row.bytes+=b.length;});res.once('end',()=>finish('end'));res.once('aborted',()=>finish('aborted'));res.once('error',()=>finish('response-error'));res.once('close',()=>finish('close'));
     if(mode==='client-abandon'){res.destroy();req.destroy();}
    });
    req.once('error',()=>finish('request-error'));
    const timer=setTimeout(()=>{deadline=true;req.destroy();response?.destroy();setImmediate(()=>finish('control-cancel'));},1000);timers.add(timer);req.end('{"synthetic":true}');
   });
   if(mode==='client-abandon')await Promise.race([Promise.all([responseClosed,upstreamResponseClosed]),new Promise((_,reject)=>{const timer=setTimeout(()=>reject(new Error('Synthetic proxy close deadline.')),1000);timers.add(timer);})]);
   await new Promise(setImmediate);const state=observer.read();row.active=state.activeForwarded;row.responses=state.responses.map(value=>({...value}));row.truncated=truncated;return row;
  }finally{
   for(const timer of timers)clearTimeout(timer);timers.clear();for(const socket of sockets)socket.destroy();
   await Promise.all(servers.map(server=>!server.listening?Promise.resolve():new Promise(resolve=>{server.close(resolve);server.closeAllConnections();})));await new Promise(setImmediate);
   row.cleanup=servers.every(s=>!s.listening)&&[...sockets].every(s=>s.destroyed)&&timers.size===0;
  }
 }
 const complete=await run('complete');assert.equal(complete.terminal,'end');assert.equal(complete.status,200);assert.equal(complete.settledBeforeDeadline,true);assert.equal(complete.active,0);assert.equal(complete.cleanup,true);
 const truncated=await run('truncated');assert.equal(truncated.truncated,true);assert.equal(truncated.headers,true);assert.ok(truncated.bytes>0&&truncated.bytes<64);assert.equal(truncated.active,0);assert.equal(truncated.cleanup,true);
 assert.equal(truncated.settledBeforeDeadline,true,'Require downstream settlement after actual upstream truncation.');
 assert.equal(complete.responses[0].upstream,'complete');assert.ok(['response-error','response-closed'].includes(truncated.responses[0].upstream));
 const before=await run('before-headers');assert.equal(before.status,502);assert.equal(before.terminal,'end');assert.equal(before.settledBeforeDeadline,true);assert.equal(before.active,0);assert.equal(before.cleanup,true);assert.equal(before.responses[0].upstream,'request-error');
 const abandoned=await run('client-abandon');assert.equal(abandoned.headers,true);assert.equal(abandoned.status,302);assert.equal(abandoned.settledBeforeDeadline,true);assert.equal(abandoned.cleanup,true);
 assert.equal(abandoned.active,0,'Client abandonment must close the owned upstream before the next fault transition.');
 assert.equal(abandoned.responses[0].state,'closed');assert.equal(abandoned.responses[0].status,302,'Retain the observed HTTP status after client abandonment; close is not completion.');
 assert.equal(complete.responses[0].state,'completed');assert.equal(complete.responses[0].status,200);assert.equal(before.responses[0].state,'completed');assert.equal(before.responses[0].status,502);
 for(const value of [complete,truncated,before,abandoned]){
  assert.equal(value.responses.length,1);const response=value.responses[0];assert.deepEqual(Object.keys(response),['phase','flowSequence','route','method','status','state','upstream']);assert.ok(['pending','headers','complete','request-error','response-error','response-closed'].includes(response.upstream));
 }
});
// End proxy regression.

test('actual onboarding, sign-in and prepare failure catch emits only command flags and preserves the original failure and cleanup',async t=>{
 const {runInNewContext}=await import('node:vm');
 const source=readFileSync(new URL('./verify-native-guest-account.mjs',import.meta.url),'utf8'),start=source.indexOf('async function flow('),end=source.indexOf('\nlet email=',start);assert.ok(start>0&&end>start);
 const secret='PRIVATE identity@example.invalid 654321 cookie=private /private/path';
 for(const [phase,id] of [['onboarding-request','account.email.open'],['onboarding-request','preview.account'],['onboarding-verify','preview.name'],['prepare','screen.today'],['request','account.email.input']]){
  const commandFile=phase==='prepare'?'fixture-prepare-command.json':'fixture-onboarding-command.json';
  const yaml=readFileSync(new URL('../.maestro/account-preservation/'+phase+'.yaml',import.meta.url),'utf8');assert.ok(yaml.includes('id: '+id+'\n'));
  for(const mode of ['known','ambiguous','writer-fails']){
   const root=mkdtempSync(join(tmpdir(),'puptime-onboarding-command-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
   const privateDir=join(root,'private'),artifacts=join(privateDir,'maestro-'+phase+'-1000'),output=join(root,'output');mkdirSync(artifacts,{recursive:true});mkdirSync(output);
   const entry={command:{tapOnElement:{selector:{idRegex:id,textRegex:secret},input:secret}},metadata:{status:'FAILED',sequenceNumber:7,error:secret,evaluatedCommand:{inputTextCommand:{text:secret}}}};
   writeFileSync(join(artifacts,'commands.json'),JSON.stringify(mode==='ambiguous'?[entry,entry]:[entry]));
   const original=new Error(secret),writerError=new Error('PRIVATE writer failure');let removed=0,receiptWrites=0;
   const context={join,homedir:()=>join(root,'home'),existsSync,readdirSync,Date:{now:()=>1000},markStartup(){},run:async()=>{throw original;},device:'synthetic-device',email:secret,code:secret,privateDir,process:{env:{}},resolve,output,requests:new Set(['/api/config','/api/account']),authResponses:[],readFileSync,readNativeCommandState,android:false,phase,
    writeFileSync(path,bytes,options){if(path.endsWith(commandFile)){receiptWrites++;assert.deepEqual(Object.keys(options).sort(),['flag','mode']);assert.equal(options.flag,'wx');assert.equal(options.mode,0o600);if(mode==='writer-fails')throw writerError;}writeFileSync(path,bytes,options);},
    rmSync(path,options){assert.equal(path,artifacts);removed++;rmSync(path,options);}};
   const promise=runInNewContext("(async()=>{let activeFlow='startup',flowSequence=0;"+source.slice(start,end)+';await flow(phase);})()',context);
   await assert.rejects(promise,error=>error===original);assert.equal(receiptWrites,1);assert.equal(removed,1);assert.equal(existsSync(artifacts),false);
   const receipt=join(output,commandFile);assert.equal(existsSync(receipt),mode!=='writer-fails');
   if(mode!=='writer-fails'){
    const raw=readFileSync(receipt,'utf8'),value=JSON.parse(raw);assert.ok(!raw.includes('PRIVATE')&&!raw.includes('identity@example.invalid')&&!raw.includes('654321')&&!raw.includes('cookie=')&&!raw.includes('/private/path'));
    assert.deepEqual(value,{phase,flowSequence:1,...(mode==='ambiguous'?{status:'UNKNOWN',kind:'unknown',targetId:null,sequence:0}:{status:'FAILED',kind:'tap',targetId:id,sequence:7})});
   }
  }
 }
});

const unknown={status:'UNKNOWN',kind:'unknown',targetId:null,sequence:0};
const row=(key,value,status,sequenceNumber=0)=>({command:{[key]:value},metadata:{status,sequenceNumber}});
const failed=row('scrollUntilVisible',{selector:{idRegex:'fontLicenses.react-native-vector-icons'}},'FAILED',26);
const running=row('tapOnElement',{selector:{idRegex:'account.sendCode'}},'RUNNING',27);

test('project literal case16 flow targets without exposing adjacent values or choosing retry leaves',()=>{
 const root=new URL('../.maestro/',import.meta.url),files=new Set(['conversational/16-native-time-boundaries.yaml','helpers/conversational/start.yaml','helpers/conversational/finish-alone.yaml','helpers/conversational/skip-sharing.yaml','helpers/conversational/assert-normal.yaml']);
 const visited=new Set(),ids=new Set();
 function flow(url){
  assert.ok(url.href.startsWith(root.href));const name=url.href.slice(root.href.length);assert.ok(files.has(name));if(visited.has(name))return;visited.add(name);
  function walk(value){
   if(Array.isArray(value)){value.forEach(walk);return;}
   if(!value||typeof value!=='object')return;
   for(const [key,item] of Object.entries(value)){
    if(key==='id'){assert.equal(typeof item,'string');assert.match(item,/^[A-Za-z0-9][A-Za-z0-9._-]*$/);ids.add(item);}
    if(key==='runFlow'){const path=typeof item==='string'?item:item?.file;if(path!==undefined){assert.equal(typeof path,'string');flow(new URL(path,url));}}
    walk(item);
   }
  }
  for(const document of parseAllDocuments(readFileSync(url,'utf8'))){assert.deepEqual(document.errors,[]);walk(document.toJSON());}
 }
 flow(new URL('conversational/16-native-time-boundaries.yaml',root));assert.deepEqual(visited,files);assert.equal(ids.size,29);
 const secret='private-synthetic@example.invalid 839201 cookie=private-value';
 for(const id of ids)for(const [key,value,kind] of [
  ['tapOnElement',{selector:{idRegex:id,textRegex:secret}},'tap'],
  ['scrollUntilVisible',{selector:{idRegex:id,textRegex:secret}},'scroll'],
  ['assertConditionCommand',{condition:{visible:{idRegex:id,textRegex:secret}}},'assert'],
  ['assertConditionCommand',{condition:{notVisible:{idRegex:id,textRegex:secret}}},'assert'],
 ]){
  const entry=row(key,value,'FAILED',9);entry.metadata.error=secret;entry.metadata.evaluatedCommand={input:secret};
  const result=nativeCommandState([entry]);assert.deepEqual(result,{status:'FAILED',kind,targetId:id,sequence:9});assert.ok(!JSON.stringify(result).includes(secret));
 }
 assert.ok(ids.has('preview.skip'));
 for(const id of [secret,'preview.skip.extra','preview.skip-extra','^preview.skip$','preview.*','${PRIVATE_VALUE}']){
  const result=nativeCommandState([row('tapOnElement',{selector:{idRegex:id,textRegex:'preview.skip'}},'FAILED',9)]);
  assert.deepEqual(result,{status:'FAILED',kind:'tap',targetId:null,sequence:9});assert.ok(!JSON.stringify(result).includes(secret));
 }
 assert.equal(nativeCommandState([row('tapOnElement',{selector:{textRegex:'preview.skip'}},'FAILED',9)]).targetId,null);
 const failed=row('tapOnElement',{selector:{idRegex:'preview.skip'}},'FAILED',9),running=row('tapOnElement',{selector:{idRegex:'preview.continue'}},'RUNNING',99);
 for(const records of [[failed,running],[running,failed],[failed,failed]])assert.deepEqual(nativeCommandState(records),unknown);
});

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
  const name=options.name??'add-logs',file=name==='add-logs'?'fixture-add-logs-command.json':name==='comparison-preview'?'fixture-comparison-command.json':name==='request'?'fixture-onboarding-command.json':null,target=name==='comparison-preview'?'account.connection.phone.count':'account.local.count',root=mkdtempSync(join(tmpdir(),'puptime-flow-command-')),artifacts=join(root,'maestro-'+name+'-42'),writes=[],captures=[];let reads=0,cleaned=0;
  try{
   mkdirSync(artifacts);writeFileSync(join(artifacts,'commands.json'),JSON.stringify([row('assertConditionCommand',{condition:{visible:{idRegex:target,textRegex:secret}}},'FAILED',12)]));
   const original=new Error(secret);for(const key of ['message','stack'])Object.defineProperty(original,key,{get(){throw new Error('Do not read raw Error fields');}});original.toJSON=()=>{throw new Error('Do not serialize the Error');};
   const promise=execute(name,root,async()=>{throw original;},(path,text,mode)=>{if(options.writerFails&&path.endsWith('/'+file))throw new Error('Synthetic writer failure');writes.push({path,value:JSON.parse(text),mode});},path=>{reads++;assert.equal(path,artifacts);if(options.readerFails)throw new Error('Synthetic reader failure');return readNativeCommandState(path);},(path,options)=>{cleaned++;assert.equal(path,artifacts);rmSync(path,options);},path=>path===artifacts&&existsSync(path),()=>['commands.json','synthetic-hierarchy.json'],join,resolve,{env:{}},options.android??true,(...args)=>{captures.push(args);if(options.captureFails)throw new Error(secret);});
   await assert.rejects(promise,error=>error===original);assert.equal(cleaned,1);assert.equal(existsSync(artifacts),false);assert.equal(reads,file?1:0);
   const evidence=writes.filter(row=>row.path.endsWith('/'+file));
   if(file&&!options.readerFails&&!options.writerFails)assert.deepEqual(evidence,[{path:'/synthetic-output/'+file,value:{phase:name,flowSequence:1,status:'FAILED',kind:'assert',targetId:target,sequence:12},mode:{...(name==='request'?{flag:'wx'}:{}),mode:0o600}}]);else assert.deepEqual(evidence,[]);
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

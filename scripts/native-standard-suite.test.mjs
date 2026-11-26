import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import test from 'node:test';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {conversationalFiles,conversationalResults,runStandardSuite,standardFixtureEnvironment,standardResults,standardSelection} from './native-standard-suite.mjs';

const csv=standardSelection('standard-csv'),all=standardSelection('standard-all');
// cli-2.11.0 c8c361be JUnitTestSuiteReporter: file/status/counts are attributes,
// properties wrap property attributes, and failure contains escaped text only.
const xml=(files,status='SUCCESS')=>'<?xml version="1.0" encoding="UTF-8"?><testsuites><testsuite name="Test Suite" device="private-device" tests="'+files.length+'" failures="'+(status==='ERROR'?files.length:0)+'"><properties><property name="private-name" value="private-value"/></properties>'+files.map(file=>`<testcase id="private-id" file="${file}" name="private-value" status="${status}"><properties><property name="tags" value="private-value"/></properties>${status==='ERROR'?'<failure>private error/body/cookie</failure>':''}</testcase>`).join('')+'</testsuite></testsuites>';
const root=()=>{const path=mkdtempSync(join(tmpdir(),'puptime-standard-test-'));mkdirSync(join(path,'output'));return path;};

test('only two fixed selections run unchanged CSV or the exact thirteen standard sources',()=>{
 assert.equal(csv.target,'.maestro/ios/07-csv-recovery.yaml');assert.equal(all.target,'.maestro');assert.equal(all.files.length,13);
 assert.equal(new Set(all.files).size,13);assert.ok(all.files.every(file=>existsSync(file)));
 assert.equal(csv.timeoutMs,3600000);assert.equal(all.timeoutMs,3600000);
 for(const value of [undefined,'all','baseline','../private.yaml','standard-csv --extra','standard'])assert.throws(()=>standardSelection(value));
 const config=readFileSync('.maestro/config.yaml','utf8');assert.match(config,/flows:\n  - ios\/\*\.yaml\n  - guide-audio.yaml/);
});

test('isolated environment removes inherited public config, disables dotenv and both PostHog clients',()=>{
 const previous={PATH:'/synthetic/bin',CI:'1',EXPO_PUBLIC_CLOUD_API_URL:'https://production.invalid',EXPO_PUBLIC_APP_POSTHOG_KEY:'private-app-token',EXPO_PUBLIC_POSTHOG_KEY:'private-web-token',EXPO_PUBLIC_APP_POSTHOG_HOST:'https://production-analytics.invalid',EXPO_PUBLIC_UNKNOWN:'private-other'};
 const env=standardFixtureEnvironment(previous,'https://127.0.0.1:8797');
 assert.equal(env.PATH,previous.PATH);assert.equal(env.EXPO_NO_DOTENV,'1');assert.equal(env.EXPO_PUBLIC_CLOUD_API_URL,'https://127.0.0.1:8797');
 assert.equal(env.EXPO_PUBLIC_APP_POSTHOG_KEY,'');assert.equal(env.EXPO_PUBLIC_POSTHOG_KEY,'');assert.equal(env.EXPO_PUBLIC_APP_POSTHOG_HOST,'');assert.equal(env.EXPO_PUBLIC_POSTHOG_HOST,'');assert.ok(!Object.hasOwn(env,'EXPO_PUBLIC_UNKNOWN'));
 assert.equal(previous.EXPO_PUBLIC_APP_POSTHOG_KEY,'private-app-token');assert.ok(!JSON.stringify(env).includes('production'));assert.ok(!JSON.stringify(env).includes('private-'));
 for(const origin of ['http://127.0.0.1:8797','https://production.invalid:8797','https://127.0.0.1','https://127.0.0.1:8797/path','https://user@127.0.0.1:8797','https://127.0.0.1:8797?key=private'])assert.throws(()=>standardFixtureEnvironment(previous,origin));
});

test('installed Expo env/production Babel transform inline only the fixture and unconfigure actual native telemetry',()=>{
 const require=createRequire(import.meta.url),{transformSync}=require('@babel/core');
 const {expoInlineEnvVars}=require(join(dirname(require.resolve('babel-preset-expo')),'plugins/inline-env-vars.js'));
 const saved={...process.env};
 try{
  const environment=standardFixtureEnvironment({...process.env,EXPO_PUBLIC_APP_POSTHOG_KEY:'private-app-token',EXPO_PUBLIC_POSTHOG_KEY:'private-web-token',EXPO_PUBLIC_CLOUD_API_URL:'https://production.invalid'},'https://127.0.0.1:8797');
  for(const key of Object.keys(process.env))if(key.startsWith('EXPO_PUBLIC_'))delete process.env[key];Object.assign(process.env,environment);
  assert.deepEqual(require('@expo/env').getEnvFiles({mode:'production'}),[]);
  const compile=file=>transformSync(readFileSync(file,'utf8'),{configFile:false,babelrc:false,parserOpts:{plugins:['typescript']},plugins:[expoInlineEnvVars],caller:{name:'metro',bundler:'metro',platform:'ios',isDev:false}}).code;
  const auth=compile('src/cloud/auth.native.ts'),telemetry=compile('src/telemetry.native.ts');
  assert.ok(auth.includes('https://127.0.0.1:8797'));assert.ok(!auth.includes('process.env.EXPO_PUBLIC_CLOUD_API_URL'));
  assert.match(telemetry,/appTelemetryConfigured = Boolean\(""\)/);assert.match(telemetry,/if \(!appTelemetryConfigured\) return/);
  assert.ok(!telemetry.includes('private-app-token'));assert.ok(!auth.includes('production.invalid'));
 }finally{for(const key of Object.keys(process.env))if(!Object.hasOwn(saved,key))delete process.env[key];Object.assign(process.env,saved);}
});

test('JUnit projection retains only allowlisted source/status and rejects missing, duplicate or secret-rich ambiguity',()=>{
 assert.deepEqual(standardResults(xml(csv.files),csv.files),{complete:true,flows:[{flow:csv.files[0],status:'SUCCESS'}]});
 const failure=xml(csv.files,'ERROR').replace('private error/body/cookie','private@example.invalid 123456 cookie=private');
 const result=standardResults(failure,csv.files);assert.equal(result.flows[0].status,'ERROR');assert.ok(!JSON.stringify(result).includes('private'));
 for(const report of ['',xml([]),xml([...csv.files,...csv.files]),xml(['private@example.invalid']),xml(csv.files).replace('status="SUCCESS"','status="SUCCESS" status="ERROR"'),'<!DOCTYPE private>'+xml(csv.files),' '.repeat(2*1024*1024+1)])assert.equal(standardResults(report,csv.files).complete,false);
 assert.equal(standardResults(xml(csv.files).replace('</testcase>','<failure>private</failure></testcase>'),csv.files).flows[0].status,'UNKNOWN');
 assert.equal(standardResults(xml(csv.files,'private error'),csv.files).flows[0].status,'UNKNOWN');
});

test('whole finalized XML envelope, exact nesting/counts and canonical producer states are mandatory',()=>{
 const report=xml(csv.files),row=report.match(/<testcase\b[\s\S]*?<\/testcase>/)[0];
 const bad=[
  row,report.slice(0,-13),report+'trailing-private',report+report,
  report.replace(row,'<!--'+row+'-->'),report.replace(row,'<![CDATA['+row+']]>'),
  report.replace(row,'<unknown>'+row+'</unknown>'),report.replace('<testsuites>','<testsuites><testcase/>'),
  report.replace('<testsuites>','<unknown>').replace('</testsuites>','</unknown>'),
  report.replace('</testsuites>','<testsuite tests="0" failures="0"/></testsuites>'),
  report.replace('tests="1"','tests="13"'),report.replace('failures="0"','failures="1"'),
  report.replace(row,row+row),report.replace('file="'+csv.files[0]+'"','file="'+csv.files[0]+'" file="private"'),
  report.replace('status="SUCCESS"','status="SUCCESS" status="ERROR"'),
  report.replace('status="SUCCESS"','status="SUCCESS" private="x" private="y"'),
  report.replace('</testcase>','<error>private cookie</error></testcase>'),
  report.replace('</testcase>','<failure>private cookie</failure></testcase>'),
  report.replace('</testcase>','<properties/></testcase>'),
  report.replace('<?xml version="1.0" encoding="UTF-8"?>','<!DOCTYPE testsuites [<!ENTITY private "private-cookie">]>'),
  report.replace('<?xml version="1.0" encoding="UTF-8"?>','<!DOCTYPE testsuites SYSTEM "file:///private/never-read">'),
  report.replace('</testcase>','<failure>&private;</failure></testcase>'),
  report.replace('status="SUCCESS"',''),report.replace('file="'+csv.files[0]+'"',''),
 ];
 for(const value of bad){const result=standardResults(value,csv.files);assert.equal(result.complete,false);assert.ok(!JSON.stringify(result).includes('private'));}
 for(const status of ['PENDING','PREPARING','INSTALLING','RUNNING','CANCELED','STOPPED','WARNING','SKIPPED']){
  const result=standardResults(xml(csv.files,status),csv.files);assert.equal(result.complete,false);assert.equal(result.flows[0].status,'UNKNOWN');
 }
 const secret='private@example.invalid 123456 cookie=private /private/raw';
 const result=standardResults(xml(csv.files,'ERROR').replace('private error/body/cookie',secret+' &lt;testcase status=&quot;SUCCESS&quot;/&gt;'),csv.files);
 assert.equal(result.complete,true);assert.equal(result.flows[0].status,'ERROR');assert.ok(!JSON.stringify(result).includes('private'));
 assert.equal(standardResults(report.replace('name="private-value"','unknown="private" name="private-value"'),csv.files).complete,true);
 assert.deepEqual(standardResults(report,['private@example.invalid']),{complete:false,flows:[]});
 const previousPath=process.env.PATH;try{process.env.PATH='';assert.deepEqual(standardResults(report,csv.files),{complete:false,flows:[]});}finally{if(previousPath===undefined)delete process.env.PATH;else process.env.PATH=previousPath;}
});

test('conversational results admit only the exact seventeen sources without expanding standard selections',()=>{
 assert.equal(conversationalFiles.length,17);assert.equal(Object.isFrozen(conversationalFiles),true);
 assert.deepEqual([...conversationalFiles],readdirSync('.maestro/conversational').filter(name=>name.endsWith('.yaml')).sort().map(name=>'.maestro/conversational/'+name));
 const mixed=xml(conversationalFiles).replace('failures="0"','failures="1"').replace('status="SUCCESS"','status="ERROR"');
 const result=conversationalResults(mixed);assert.equal(result.complete,true);assert.deepEqual(result.flows,conversationalFiles.map((flow,index)=>({flow,status:index===0?'ERROR':'SUCCESS'})));assert.ok(!JSON.stringify(result).includes('private'));
 assert.equal(conversationalResults(xml(conversationalFiles)).complete,true);
 assert.deepEqual(standardResults(xml(conversationalFiles),conversationalFiles),{complete:false,flows:[]});
 assert.throws(()=>standardSelection('conversational-fixed17'));
 const project=(files,mode=['--conversational-fixed17'])=>JSON.parse(execFileSync('python3',['-I',fileURLToPath(new URL('./native-standard-report.py',import.meta.url)),...mode,...files],{input:xml(files),encoding:'utf8'}));
 assert.equal(project([...conversationalFiles]).complete,true);
 for(const files of [[...conversationalFiles].reverse(),conversationalFiles.slice(1),[...conversationalFiles,conversationalFiles[0]],[...conversationalFiles.slice(0,-1),'private-flow'],all.files])assert.deepEqual(project(files),{complete:false,rows:[]});
 assert.deepEqual(project([...conversationalFiles],[]),{complete:false,rows:[]});
});

test('the fixed seventeen mode preserves whole-report restrictions and unknown states without leaking report values',()=>{
 const valid=xml(conversationalFiles),secret='private@example.invalid 123456 cookie=private /private/raw';
 for(const report of [undefined,'',valid.slice(0,-13),valid+valid,valid.replace('tests="17"','tests="13"'),valid.replace('failures="0"','failures="1"'),valid.replace(conversationalFiles[0],'private-flow'),valid.replace('status="SUCCESS"','status="SUCCESS" status="ERROR"'),'<!DOCTYPE testsuites SYSTEM "file:///private/never-read">'+valid,valid.replace('</testcase>','<unknown>'+secret+'</unknown></testcase>'),' '.repeat(2*1024*1024+1)]){
  const result=conversationalResults(report);assert.equal(result.complete,false);assert.ok(!JSON.stringify(result).includes('private'));
 }
 const pending=conversationalResults(valid.replace('status="SUCCESS"','status="RUNNING"'));assert.equal(pending.complete,false);assert.equal(pending.flows[0].status,'UNKNOWN');assert.equal(pending.flows.length,17);
 const failed=conversationalResults(xml(conversationalFiles,'ERROR').replaceAll('private error/body/cookie',secret+' &lt;testcase status=&quot;SUCCESS&quot;/&gt;'));assert.equal(failed.complete,true);assert.ok(failed.flows.every(row=>row.status==='ERROR'));assert.ok(!JSON.stringify(failed).includes(secret));
});

for(const scenario of ['standard-csv','standard-all'])test('fixed '+scenario+' preserves CLI/config/bound and deletes raw producer artifacts',async()=>{
 const path=root(),output=join(path,'output'),selection=standardSelection(scenario);let artifacts;
 try{
  const result=await runStandardSuite({scenario,device:'owned-device',privateDirectory:path,output,environment:{MAESTRO_DRIVER_STARTUP_TIMEOUT:'300000'},execute:async(binary,args,env,cwd,timeout)=>{
   assert.equal(binary,'maestro');assert.deepEqual(args.slice(0,10),['test','--platform','ios','--device','owned-device','--config','.maestro/config.yaml','--format','JUNIT','--output']);assert.equal(args.at(-1),selection.target);
   assert.equal(timeout,3600000);assert.equal(env.MAESTRO_DRIVER_STARTUP_TIMEOUT,'300000');assert.equal(env.MAESTRO_CLI_NO_ANALYTICS,'1');
   artifacts=args[args.indexOf('--test-output-dir')+1];writeFileSync(args[10],xml(selection.files));writeFileSync(join(artifacts,'private-raw.log'),'private@example.invalid cookie=private');
  }});
  assert.equal(result.flows.length,selection.files.length);assert.ok(!existsSync(artifacts));
  const receipt=readFileSync(join(output,'standard-flow-results.json'),'utf8');assert.equal(JSON.parse(receipt).status,'passed');assert.ok(!receipt.includes('private'));
 }finally{rmSync(path,{recursive:true,force:true});}
});

test('actual driver error identity survives finite projection/write failure, with private artifacts removed',async()=>{
 for(const missingOutput of [false,true]){
  const path=root(),error=new Error('private raw failure cookie=private');let artifacts;
  try{
   const output=missingOutput?join(path,'missing/output'):join(path,'output');
   await assert.rejects(runStandardSuite({scenario:'standard-csv',device:'owned',privateDirectory:path,output,environment:{},execute:async(binary,args)=>{
    artifacts=args[args.indexOf('--test-output-dir')+1];writeFileSync(join(artifacts,'commands.json'),JSON.stringify([{command:{tapOnElement:{selector:{idRegex:'settings.import',textRegex:'private@example.invalid'}}},metadata:{status:'FAILED',sequenceNumber:64,error:'private'}}]));writeFileSync(args[10],xml(csv.files,'ERROR'));throw error;
   }}),value=>value===error);
   assert.ok(!existsSync(artifacts));
   if(!missingOutput){const receipt=readFileSync(join(output,'standard-flow-results.json'),'utf8');assert.equal(JSON.parse(receipt).status,'failed');assert.equal(JSON.parse(receipt).command.kind,'tap');assert.ok(!receipt.includes('private'));}
  }finally{rmSync(path,{recursive:true,force:true});}
 }
});

test('a zero CLI exit never qualifies missing or failing standard cases',async()=>{
 for(const report of [xml([]),xml(all.files.slice(1)),xml(all.files,'ERROR')]){
  const path=root();try{
   await assert.rejects(runStandardSuite({scenario:'standard-all',device:'owned',privateDirectory:path,output:join(path,'output'),environment:{},execute:async(binary,args)=>writeFileSync(args[10],report)}));
   assert.equal(JSON.parse(readFileSync(join(path,'output/standard-flow-results.json'),'utf8')).status,'failed');
  }finally{rmSync(path,{recursive:true,force:true});}
 }
});

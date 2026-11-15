// Fixed standard-flow entry points; no arbitrary flow or production configuration.
import assert from 'node:assert/strict';
import {lstatSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {readNativeCommandState} from './native-command-evidence.mjs';

const standardFiles=['00-onboarding','00-onboarding-notifications','01-navigation','02-log-crud','03-simple-log','04-schedule','05-settings','05b-notifications','05c-timed-reminders','06-insights-and-timeline','07-csv-recovery','08-appearance-modes'].map(name=>'.maestro/ios/'+name+'.yaml').concat('.maestro/guide-audio.yaml');
export function standardSelection(scenario){
 assert.ok(['standard-csv','standard-all'].includes(scenario),'Select only a fixed standard case.');
 return {mode:scenario==='standard-csv'?'--standard-csv':'--standard-all',target:scenario==='standard-csv'?'.maestro/ios/07-csv-recovery.yaml':'.maestro',files:scenario==='standard-csv'?['.maestro/ios/07-csv-recovery.yaml']:[...standardFiles],timeoutMs:60*60*1000};
}

export function standardFixtureEnvironment(environment,origin){
 const url=new URL(origin);assert.equal(url.protocol,'https:');assert.equal(url.hostname,'127.0.0.1');
 assert.ok(url.port&&url.pathname==='/'&&!url.username&&!url.password&&!url.search&&!url.hash);
 const result=Object.fromEntries(Object.entries(environment).filter(([key])=>!key.startsWith('EXPO_PUBLIC_')));
 return {...result,EXPO_NO_DOTENV:'1',EXPO_PUBLIC_CLOUD_API_URL:url.origin,EXPO_PUBLIC_APP_POSTHOG_KEY:'',EXPO_PUBLIC_APP_POSTHOG_HOST:'',EXPO_PUBLIC_POSTHOG_KEY:'',EXPO_PUBLIC_POSTHOG_HOST:''};
}

// Finite projection of Maestro's JUnit testcase headers, never their failure body,
// device, name, error, properties or arbitrary file values. This is not an XML API.
export function standardResults(xml,files){
 const unknown={complete:false,flows:[]};
 if(typeof xml!=='string'||Buffer.byteLength(xml)>2*1024*1024||/<!DOCTYPE|<!ENTITY/i.test(xml))return unknown;
 const rows=[...xml.matchAll(/<testcase\b([^>]*?)(?:\/>|>[\s\S]*?<\/testcase>)/g)],flows=[];
 for(const row of rows){
  const file=[...row[1].matchAll(/\bfile="([^"]*)"/g)],status=[...row[1].matchAll(/\bstatus="([^"]*)"/g)];
  if(file.length!==1||status.length!==1||!files.includes(file[0][1])||flows.some(value=>value.flow===file[0][1]))return unknown;
  const observed=['SUCCESS','ERROR','SKIPPED'].includes(status[0][1])?status[0][1]:'UNKNOWN';
  flows.push({flow:file[0][1],status:observed==='SUCCESS'&&/<(?:failure|error|skipped)\b/.test(row[0])?'UNKNOWN':observed});
 }
 return {complete:flows.length===files.length&&flows.every(row=>row.status!=='UNKNOWN'),flows};
}

export async function runStandardSuite({scenario,device,privateDirectory,output,execute,environment}){
 const selection=standardSelection(scenario),artifacts=mkdtempSync(join(privateDirectory,'standard-maestro-')),report=join(artifacts,'junit.xml');
 let failure,result={complete:false,flows:[]};
 const receipt=status=>writeFileSync(join(output,'standard-flow-results.json'),JSON.stringify({stage:'standard-maestro',scenario,status,expectedFlows:selection.files.length,...result,command:readNativeCommandState(artifacts)},null,2)+'\n');
 try{
  await execute('maestro',['test','--platform','ios','--device',device,'--config','.maestro/config.yaml','--format','JUNIT','--output',report,'--test-output-dir',artifacts,selection.target],{...environment,MAESTRO_CLI_NO_ANALYTICS:'1'},process.cwd(),selection.timeoutMs);
  const file=lstatSync(report);assert.ok(file.isFile()&&!file.isSymbolicLink()&&file.size<=2*1024*1024,'Require the bounded standard report.');
  const bytes=readFileSync(report);assert.ok(bytes.length<=2*1024*1024);
  result=standardResults(new TextDecoder('utf-8',{fatal:true}).decode(bytes),selection.files);
  assert.ok(result.complete&&result.flows.every(row=>row.status==='SUCCESS'),'Every selected standard flow must actually pass.');
  receipt('passed');return result;
 }catch(error){
  failure=error;
  // A projection/persistence failure must never mask the driver failure.
  try{const file=lstatSync(report);if(file.isFile()&&!file.isSymbolicLink()&&file.size<=2*1024*1024){const bytes=readFileSync(report);if(bytes.length<=2*1024*1024)result=standardResults(new TextDecoder('utf-8',{fatal:true}).decode(bytes),selection.files);}}catch{}
  try{receipt('failed');}catch{}
  throw error;
 }finally{try{rmSync(artifacts,{recursive:true,force:true});}catch(error){if(!failure)throw error;}}
}

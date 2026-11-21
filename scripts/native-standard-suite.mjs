// Fixed standard-flow entry points; no arbitrary flow or production configuration.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {lstatSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readNativeCommandState} from './native-command-evidence.mjs';

// Pinned2.11 TestSuiteInteractor→FileUtils makes in-workspace flow.filePath
// relative to WorkingDirectory.baseDir (user.dir), including these .maestro paths.
const standardFiles=['00-onboarding','00-onboarding-notifications','01-navigation','02-log-crud','03-simple-log','04-schedule','05-settings','05b-notifications','05c-timed-reminders','06-insights-and-timeline','07-csv-recovery','08-appearance-modes'].map(name=>'.maestro/ios/'+name+'.yaml').concat('.maestro/guide-audio.yaml');
export const conversationalFiles=Object.freeze(['01-dismiss-and-navigate','02-log-from-spotlight','03-skip-optional-setup','04-entry-profile-back','05-ages-meals-and-cancel','06-meals-only','07-skip-meals-keep-poop','08-skip-grouped-meals','09-all-reminder-options','10-notifications-allow','11-notifications-deny','12-notifications-blocked','13-spotlight-pee','14-spotlight-poop','15-interrupted-setup','16-native-time-boundaries','17-sharing'].map(name=>'.maestro/conversational/'+name+'.yaml'));
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

// The isolated stdlib parser must finalize the entire pinned JUnit structure.
// Its bridge returns only numeric allowlist indexes and closed status values.
export function standardResults(xml,files){
 const unknown={complete:false,flows:[]};
 if(typeof xml!=='string'||Buffer.byteLength(xml)>2*1024*1024||!Array.isArray(files))return unknown;
 if(JSON.stringify(files)!==JSON.stringify(standardFiles)&&JSON.stringify(files)!==JSON.stringify(standardSelection('standard-csv').files))return unknown;
 return reportResults(xml,files,[]);
}
export function conversationalResults(xml){
 return reportResults(xml,conversationalFiles,['--conversational-fixed17']);
}
function reportResults(xml,files,mode){
 const unknown={complete:false,flows:[]};
 if(typeof xml!=='string'||Buffer.byteLength(xml)>2*1024*1024)return unknown;
 try{
  const raw=execFileSync('python3',['-I',fileURLToPath(new URL('./native-standard-report.py',import.meta.url)),...mode,...files],{input:xml,encoding:'utf8',timeout:10000,maxBuffer:16384,stdio:['pipe','pipe','ignore']});
  const result=JSON.parse(raw);if(typeof result.complete!=='boolean'||!Array.isArray(result.rows)||result.rows.length>files.length)return unknown;
  const seen=new Set(),flows=[];
  for(const row of result.rows){
   if(!Number.isSafeInteger(row.index)||row.index<0||row.index>=files.length||seen.has(row.index)||!['SUCCESS','ERROR','UNKNOWN'].includes(row.status))return unknown;
   seen.add(row.index);flows.push({flow:files[row.index],status:row.status});
  }
  return {complete:result.complete&&flows.length===files.length&&flows.every(row=>row.status!=='UNKNOWN'),flows};
 }catch{return unknown;}
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

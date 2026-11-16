// Producer-only projection. Never upload or print the underlying JUnit report.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {closeSync,constants,fstatSync,lstatSync,mkdirSync,openSync,readSync,realpathSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {conversationalFiles,conversationalResults,standardResults,standardSelection} from './native-standard-suite.mjs';

const files=standardSelection('standard-all').files,limit=2*1024*1024;
export function standardVerdict(xml,metadata={}){
 return verdict(standardResults(xml,files),files,'standard-maestro-verdict',metadata);
}
export function conversationalVerdict(xml,metadata={}){
 return verdict(conversationalResults(xml),conversationalFiles,'conversational-maestro-verdict',metadata);
}
function verdict(result,files,stage,metadata){
 const statuses=new Map(result.flows.map(row=>[row.flow,row.status]));
 const sha=value=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value)?value:null;
 const attempt=metadata.runAttempt;
 return {
  schemaVersion:1,stage,expectedFlows:files.length,complete:result.complete,
  flows:files.map(flow=>({flow,status:statuses.get(flow)??'UNKNOWN'})),
  stepConclusion:['success','failure','cancelled','skipped'].includes(metadata.stepConclusion)?metadata.stepConclusion:'UNKNOWN',
  checkoutCommit:sha(metadata.checkoutCommit),checkoutTree:sha(metadata.checkoutTree),
  runId:typeof metadata.runId==='string'&&/^[1-9][0-9]{0,19}$/.test(metadata.runId)?metadata.runId:null,
  runAttempt:typeof attempt==='string'&&/^[1-9][0-9]{0,15}$/.test(attempt)&&Number.isSafeInteger(Number(attempt))?Number(attempt):null,
 };
}
function report(root,filename){
 let descriptor;
 try{
  const directory=join(root,'build'),path=join(directory,filename);
  assert.equal(realpathSync(directory),directory);assert.ok(lstatSync(directory).isDirectory()&&!lstatSync(directory).isSymbolicLink());
  descriptor=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  const before=fstatSync(descriptor);assert.ok(before.isFile()&&before.size<=limit);
  const bytes=Buffer.alloc(limit+1);let length=0;
  while(length<bytes.length){const count=readSync(descriptor,bytes,length,bytes.length-length,null);if(!count)break;length+=count;}
  const after=fstatSync(descriptor),current=lstatSync(path);
  assert.ok(current.isFile()&&!current.isSymbolicLink()&&length===before.size&&length<=limit);
  for(const field of ['dev','ino','size','mtimeMs','ctimeMs']){assert.equal(after[field],before[field]);assert.equal(current[field],before[field]);}
  return new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,length));
 }catch{return undefined;}
 finally{if(descriptor!==undefined)closeSync(descriptor);}
}
export function writeStandardVerdict(root,environment){
 return writeVerdict(root,environment,false);
}
export function writeConversationalVerdict(root,environment){
 return writeVerdict(root,environment,true);
}
function writeVerdict(root,environment,conversational){
 root=realpathSync(root);let checkoutCommit,checkoutTree;
 try{[checkoutCommit,checkoutTree]=execFileSync('git',['rev-parse','HEAD','HEAD^{tree}'],{cwd:root,encoding:'utf8',timeout:10000,maxBuffer:1024,stdio:['ignore','pipe','ignore']}).trim().split('\n');}catch{}
 const project=conversational?conversationalVerdict:standardVerdict;
 const value=project(report(root,conversational?'onboarding-maestro-report.xml':'maestro-report.xml'),{checkoutCommit,checkoutTree,runId:environment.GITHUB_RUN_ID,runAttempt:environment.GITHUB_RUN_ATTEMPT,stepConclusion:conversational?environment.ONBOARDING_STEP_CONCLUSION:environment.STANDARD_STEP_CONCLUSION});
 const directory=join(root,'build');mkdirSync(directory,{recursive:true});assert.equal(realpathSync(directory),directory);assert.ok(!lstatSync(directory).isSymbolicLink());
 writeFileSync(join(directory,conversational?'conversational-verdict.json':'standard-verdict.json'),JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});
 return value;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  assert.ok(process.argv.length===2||process.argv.length===3&&process.argv[2]==='--conversational-fixed17');
  (process.argv.length===2?writeStandardVerdict:writeConversationalVerdict)(process.cwd(),process.env);
 }
 catch{console.error('Standard verdict evidence unavailable.');process.exitCode=1;}
}

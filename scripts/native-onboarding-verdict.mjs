// Producer-only last-reached command boundary; never read reports or auth outputs.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {closeSync,constants,fstatSync,lstatSync,mkdirSync,openSync,readSync,realpathSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const phases=['conversational','fault-recovery','onboarding-sign-in-fixture','guest-account-fixture','completed','UNKNOWN'],limit=128;
export function onboardingVerdict(raw,metadata={}){
 const match=typeof raw==='string'&&Buffer.byteLength(raw)<=limit?/^([^\n]+)\n(0|[1-9][0-9]{0,2})\n$/.exec(raw):null;
 const valid=match&&phases.includes(match[1])&&Number(match[2])<=255&&(match[1]!=='completed'||match[2]==='0');
 const sha=value=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value)?value:null,attempt=metadata.runAttempt;
 return {
  schemaVersion:1,stage:'onboarding-command-boundary',phase:valid?match[1]:'UNKNOWN',exitCode:valid?Number(match[2]):null,
  stepConclusion:['success','failure','cancelled','skipped'].includes(metadata.stepConclusion)?metadata.stepConclusion:'UNKNOWN',
  checkoutCommit:sha(metadata.checkoutCommit),checkoutTree:sha(metadata.checkoutTree),
  runId:typeof metadata.runId==='string'&&/^[1-9][0-9]{0,19}$/.test(metadata.runId)?metadata.runId:null,
  runAttempt:typeof attempt==='string'&&/^[1-9][0-9]{0,15}$/.test(attempt)&&Number.isSafeInteger(Number(attempt))?Number(attempt):null,
 };
}
function boundary(root){
 let descriptor;
 try{
  const directory=join(root,'build'),path=join(directory,'onboarding-stage.txt');
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
export function writeOnboardingVerdict(root,environment){
 root=realpathSync(root);let checkoutCommit,checkoutTree;
 try{[checkoutCommit,checkoutTree]=execFileSync('git',['rev-parse','HEAD','HEAD^{tree}'],{cwd:root,encoding:'utf8',timeout:10000,maxBuffer:1024,stdio:['ignore','pipe','ignore']}).trim().split('\n');}catch{}
 const value=onboardingVerdict(boundary(root),{checkoutCommit,checkoutTree,runId:environment.GITHUB_RUN_ID,runAttempt:environment.GITHUB_RUN_ATTEMPT,stepConclusion:environment.ONBOARDING_STEP_CONCLUSION});
 const directory=join(root,'build');mkdirSync(directory,{recursive:true});assert.equal(realpathSync(directory),directory);assert.ok(!lstatSync(directory).isSymbolicLink());
 writeFileSync(join(directory,'onboarding-verdict.json'),JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});
 return value;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{assert.equal(process.argv.length,2);writeOnboardingVerdict(process.cwd(),process.env);}
 catch{console.error('Onboarding boundary evidence unavailable.');process.exitCode=1;}
}

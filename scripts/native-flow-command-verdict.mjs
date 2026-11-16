// Separate finite producer. Raw commands remain private; imports perform no I/O.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {closeSync,constants,fstatSync,lstatSync,mkdirSync,openSync,readSync,realpathSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {nativeFlowSources,readNativeFlowCommandState} from './native-command-evidence.mjs';

const modes={standard13:['standard','maestro-results','standard-maestro-verdict'],conversational17:['conversational','onboarding-maestro-results','conversational-maestro-verdict']};
const keys=(value,expected)=>value&&typeof value==='object'&&!Array.isArray(value)&&JSON.stringify(Object.keys(value).sort())===JSON.stringify([...expected].sort());
const fields=['checkoutCommit','checkoutTree','runId','runAttempt'];
function binding(root,environment){
 let checkoutCommit=null,checkoutTree=null;
 try{const values=execFileSync('git',['rev-parse','HEAD','HEAD^{tree}'],{cwd:root,encoding:'utf8',timeout:10000,maxBuffer:1024,stdio:['ignore','pipe','ignore']}).trim().split('\n');if(values.length===2&&values.every(value=>/^[a-f0-9]{40}$/.test(value)))[checkoutCommit,checkoutTree]=values;}catch{}
 const {GITHUB_RUN_ID:runId,GITHUB_RUN_ATTEMPT:attempt}=environment;
 return {checkoutCommit,checkoutTree,runId:typeof runId==='string'&&/^[1-9][0-9]{0,19}$/.test(runId)?runId:null,runAttempt:typeof attempt==='string'&&/^[1-9][0-9]{0,15}$/.test(attempt)&&Number.isSafeInteger(Number(attempt))?Number(attempt):null};
}
function build(root){const path=join(root,'build');mkdirSync(path,{recursive:true});assert.equal(realpathSync(path),path);assert.ok(lstatSync(path).isDirectory()&&!lstatSync(path).isSymbolicLink());return path;}
function readJson(path,limit){
 let descriptor;
 try{
  descriptor=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);const before=fstatSync(descriptor);assert.ok(before.isFile()&&before.size<=limit);
  const bytes=Buffer.alloc(limit+1);let length=0;
  while(length<bytes.length){const count=readSync(descriptor,bytes,length,bytes.length-length,null);if(!count)break;length+=count;}
  const after=fstatSync(descriptor),current=lstatSync(path);assert.ok(current.isFile()&&!current.isSymbolicLink()&&length===before.size&&length<=limit);
  for(const field of ['dev','ino','size','mtimeMs','ctimeMs']){assert.equal(after[field],before[field]);assert.equal(current[field],before[field]);}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,length)));
 }finally{if(descriptor!==undefined)closeSync(descriptor);}
}
function selection(suite){assert.ok(Object.hasOwn(modes,suite));return modes[suite];}
export function prepareFlowCommandRoot(root,suite,environment){
 root=realpathSync(root);const [name,output]=selection(suite),metadata=binding(root,environment);assert.ok(Object.values(metadata).every(value=>value!==null));
 const directory=build(root),path=join(directory,output);
 for(const suffix of ['-command-custody.json','-verdict.json','-failed-command.json'])assert.throws(()=>lstatSync(join(directory,name+suffix)),{code:'ENOENT'});
 mkdirSync(path,{mode:0o700});
 const stat=lstatSync(path),value={schemaVersion:1,stage:name+'-command-custody',...metadata,directory:{dev:String(stat.dev),ino:String(stat.ino)}};
 writeFileSync(join(directory,name+'-command-custody.json'),JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});return value;
}
export function writeFlowCommandVerdict(root,suite,environment){
 root=realpathSync(root);const [name,output,stage]=selection(suite),metadata=binding(root,environment),directory=build(root),sources=nativeFlowSources[suite];
 let command={flowIndex:null,status:'UNKNOWN',kind:'unknown',targetId:null,sequence:0,observedLeaves:{nonCausal:true,complete:false,rows:[]}};
 try{
  assert.equal(environment.FLOW_COMMAND_PREPARATION_OUTCOME,'success');assert.ok(Object.values(metadata).every(value=>value!==null));
  const custody=readJson(join(directory,name+'-command-custody.json'),4096);
  assert.ok(keys(custody,['schemaVersion','stage',...fields,'directory']));assert.equal(custody.schemaVersion,1);assert.equal(custody.stage,name+'-command-custody');
  assert.ok(keys(custody.directory,['dev','ino'])&&Object.values(custody.directory).every(value=>typeof value==='string'&&/^[0-9]{1,30}$/.test(value)));
  for(const field of fields)assert.equal(custody[field],metadata[field]);
  const value=readJson(join(directory,name+'-verdict.json'),32768);
  assert.ok(keys(value,['schemaVersion','stage','expectedFlows','complete','flows','stepConclusion',...fields]));assert.equal(value.schemaVersion,1);assert.equal(value.stage,stage);assert.equal(value.expectedFlows,sources.length);assert.equal(value.complete,true);
  assert.ok(['success','failure','cancelled','skipped','UNKNOWN'].includes(value.stepConclusion));for(const field of fields)assert.equal(value[field],metadata[field]);
  assert.ok(Array.isArray(value.flows)&&value.flows.length===sources.length);
  for(const [index,row] of value.flows.entries())assert.ok(keys(row,['flow','status'])&&row.flow===sources[index][0]&&['SUCCESS','ERROR'].includes(row.status));
  const failed=value.flows.map((row,index)=>row.status==='ERROR'?index:-1).filter(index=>index>=0);assert.equal(failed.length,1);
  command=readNativeFlowCommandState(join(directory,output),suite,failed[0],custody.directory);
 }catch{/* Missing, stale, partial or ambiguous input is not a failed command. */}
 const value={schemaVersion:1,stage:name+'-failed-command',expectedFlows:sources.length,...command,...metadata};
 writeFileSync(join(directory,name+'-failed-command.json'),JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});return value;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  assert.equal(process.argv.length,3);const mode=process.argv[2],prepare=mode.startsWith('--prepare-'),suite=mode.slice(prepare?10:2);
  assert.equal(mode,(prepare?'--prepare-':'--')+suite);selection(suite);
  (prepare?prepareFlowCommandRoot:writeFlowCommandVerdict)(process.cwd(),suite,process.env);
 }catch{console.error('Flow command evidence unavailable.');process.exitCode=1;}
}

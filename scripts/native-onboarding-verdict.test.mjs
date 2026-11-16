import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {lstatSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {onboardingVerdict,writeOnboardingVerdict} from './native-onboarding-verdict.mjs';

const require=createRequire(import.meta.url),{parse}=require('yaml');
const workflow=parse(readFileSync('.github/workflows/ios-simulator.yml','utf8')),steps=workflow.jobs.build.steps;
const combined=steps.find(step=>step.id==='onboarding_combined'),phases=['conversational','fault-recovery','onboarding-sign-in-fixture','guest-account-fixture'];
const secret='private@example.invalid 123456 token=PRIVATE /private/raw';
const metadata={checkoutCommit:'a'.repeat(40),checkoutTree:'b'.repeat(40),runId:'123456789',runAttempt:'2',stepConclusion:'failure'};
function temporary(run){const root=realpathSync(mkdtempSync(join(tmpdir(),'puptime-onboarding-verdict-')));try{return run(root);}finally{rmSync(root,{recursive:true,force:true});}}

// Execute the actual entire RUN with shell functions replacing only its tools.
// Nothing invokes a real exporter, xcrun, Maestro, Node fixture or device.
function runCombined({failedPhase='',code=17,cleanupFails=false,writerFails=false,setupFails=false,beforeTrapFails=false}={}){
 return temporary(root=>{
  mkdirSync(join(root,'build'));if(writerFails)mkdirSync(join(root,'build/onboarding-stage.txt'));
  const stubs=`
  check() { printf '%s\\n' "$1" >> calls; test "$1" != "$FAILED_PHASE" || return "$FAILURE_CODE"; }
  ditto() { :; }
  codesign() { :; }
  jq() { printf '%s\\n' runtime; }
  xcrun() {
    case "$2" in
      create) printf '%s\\n' owned-device ;;
      delete) printf '%s\\n' "$3" >> cleanup; test "$CLEANUP_FAILS" != true ;;
      boot) test "$SETUP_FAILS" != true || return 19 ;;
    esac
  }
  maestro() { check conversational; }
  node() {
    case "$1" in
      node_modules/*) test "$BEFORE_TRAP_FAILS" != true || return 21 ;;
      scripts/verify-ios-conversational-failures.mjs) check fault-recovery ;;
      scripts/verify-ios-guest-account.mjs)
        case "$*" in *--onboarding-sign-in*) check onboarding-sign-in-fixture ;; *) check guest-account-fixture ;; esac ;;
      *) return 99 ;;
    esac
  }
  `;
  const run=spawnSync('bash',['-e','-o','pipefail','-c',stubs+'\n'+combined.run],{cwd:root,encoding:'utf8',env:{...process.env,GITHUB_RUN_ID:'123',FAILED_PHASE:failedPhase,FAILURE_CODE:String(code),CLEANUP_FAILS:String(cleanupFails),SETUP_FAILS:String(setupFails),BEFORE_TRAP_FAILS:String(beforeTrapFails)}});
  const lines=name=>{try{return readFileSync(join(root,name),'utf8').trim().split('\n');}catch{return [];}};
  let raw;try{raw=readFileSync(join(root,'build/onboarding-stage.txt'),'utf8');}catch{}
  return {status:run.status,stdout:run.stdout,stderr:run.stderr,calls:lines('calls'),cleanup:lines('cleanup'),value:onboardingVerdict(raw)};
 });
}
test('actual RUN trap preserves each of four original failures, stops later commands, and deletes exactly its device once',()=>{
 for(const [index,phase] of phases.entries()){
  const result=runCombined({failedPhase:phase,code:17+index});assert.equal(result.status,17+index);assert.deepEqual(result.calls,phases.slice(0,index+1));assert.deepEqual(result.cleanup,['owned-device']);assert.equal(result.value.phase,phase);assert.equal(result.value.exitCode,17+index);assert.equal(result.stdout,'');assert.equal(result.stderr,'');
 }
 const result=runCombined();assert.equal(result.status,0);assert.deepEqual(result.calls,phases);assert.deepEqual(result.cleanup,['owned-device']);assert.equal(result.value.phase,'completed');assert.equal(result.value.exitCode,0);
});
test('actual trap write and cleanup failures cannot replace original status or bypass cleanup; setup has UNKNOWN boundary',()=>{
 for(const options of [{writerFails:true},{cleanupFails:true},{writerFails:true,cleanupFails:true}])for(const failedPhase of ['',phases[1]]){
  const result=runCombined({...options,failedPhase,code:43});assert.equal(result.status,failedPhase?43:0);assert.deepEqual(result.cleanup,['owned-device']);assert.deepEqual(result.calls,failedPhase?phases.slice(0,2):phases);assert.equal(result.stdout,'');assert.equal(result.stderr,'');assert.equal(result.value.phase,options.writerFails?'UNKNOWN':failedPhase||'completed');
 }
 const setup=runCombined({setupFails:true});assert.equal(setup.status,19);assert.deepEqual(setup.calls,[]);assert.deepEqual(setup.cleanup,['owned-device']);assert.equal(setup.value.phase,'UNKNOWN');assert.equal(setup.value.exitCode,19);
 const early=runCombined({beforeTrapFails:true});assert.equal(early.status,21);assert.deepEqual(early.calls,[]);assert.deepEqual(early.cleanup,[]);assert.equal(early.value.phase,'UNKNOWN');assert.equal(early.value.exitCode,null);
});
test('projection accepts only fixed bounded phases/statuses and never emits unknown fields, values or secret text',()=>{
 for(const phase of [...phases,'UNKNOWN','completed']){
  const value=onboardingVerdict(phase+'\n0\n',metadata);assert.equal(value.phase,phase);assert.equal(value.exitCode,0);assert.equal(value.checkoutCommit,metadata.checkoutCommit);assert.equal(value.runAttempt,2);assert.deepEqual(Object.keys(value),['schemaVersion','stage','phase','exitCode','stepConclusion','checkoutCommit','checkoutTree','runId','runAttempt']);
 }
 for(const raw of [undefined,null,false,17,{},secret,'conversational\n256\n','conversational\n01\n','conversational\n-1\n','conversational\n1.5\n','conversational\n1','completed\n1\n','conversational\n1\n'+secret,'conversational\r\n1\r\n','conversational\n1\n\n','x'.repeat(129)]){const value=onboardingVerdict(raw,metadata);assert.equal(value.phase,'UNKNOWN');assert.equal(value.exitCode,null);assert.ok(!JSON.stringify(value).includes('private'));}
 const invalid=onboardingVerdict(undefined,{checkoutCommit:secret,checkoutTree:secret,runId:secret,runAttempt:secret,stepConclusion:secret,secret});assert.equal(invalid.stepConclusion,'UNKNOWN');assert.ok(Object.values(invalid).every(value=>!String(value).includes('private')));
 for(const attempt of ['0','01','-1','1.5','9007199254740992',1,true])assert.equal(onboardingVerdict(undefined,{runAttempt:attempt}).runAttempt,null);
 for(const field of ['checkoutCommit','checkoutTree','runId'])for(const input of [null,false,123,{},[]])assert.equal(onboardingVerdict(undefined,{[field]:input})[field],null);
 assert.equal(onboardingVerdict('conversational\n255\n').exitCode,255);
 for(const conclusion of ['success','failure','cancelled','skipped'])assert.equal(onboardingVerdict(undefined,{stepConclusion:conclusion}).stepConclusion,conclusion);
});
test('real producer admits only a stable bounded regular stage file; missing/invalid/symlink input stays UNKNOWN',()=>{
 for(const kind of ['valid','missing','oversized','invalid-utf8','file-link','directory-link','directory'])temporary(root=>{
  const build=join(root,'build'),external=join(root,'other');mkdirSync(external);if(kind==='directory-link')symlinkSync(external,build);else mkdirSync(build);
  const path=join(build,'onboarding-stage.txt');
  if(kind==='file-link'){writeFileSync(join(external,'stage'),'conversational\n17\n');symlinkSync(join(external,'stage'),path);}
  else if(kind==='directory')mkdirSync(path);
  else if(kind!=='missing')writeFileSync(path,kind==='oversized'?Buffer.alloc(129):kind==='invalid-utf8'?Buffer.from([255]):'conversational\n17\n');
  if(kind==='directory-link'){assert.throws(()=>writeOnboardingVerdict(root,{}));assert.throws(()=>lstatSync(join(external,'onboarding-verdict.json')));return;}
  const value=writeOnboardingVerdict(root,{});assert.equal(value.phase,kind==='valid'?'conversational':'UNKNOWN');assert.equal(value.exitCode,kind==='valid'?17:null);assert.equal(lstatSync(join(build,'onboarding-verdict.json')).mode&0o777,0o600);
 });
});
test('actual CLI binds actual checkout independently of supplied SHA, writes exclusively, and prints no private input',()=>temporary(root=>{
 execFileSync('git',['init','--quiet'],{cwd:root});execFileSync('git',['-c','user.name=Synthetic','-c','user.email=fixture@example.invalid','commit','--allow-empty','--quiet','-m','fixture'],{cwd:root});mkdirSync(join(root,'build'));writeFileSync(join(root,'build/onboarding-stage.txt'),secret);
 const run=spawnSync(process.execPath,[fileURLToPath(new URL('./native-onboarding-verdict.mjs',import.meta.url))],{cwd:root,encoding:'utf8',env:{...process.env,GITHUB_SHA:'f'.repeat(40),GITHUB_RUN_ID:'123456789',GITHUB_RUN_ATTEMPT:'3',ONBOARDING_STEP_CONCLUSION:'failure'}});assert.equal(run.status,0);assert.equal(run.stdout,'');assert.equal(run.stderr,'');
 const path=join(root,'build/onboarding-verdict.json'),prior=readFileSync(path),value=JSON.parse(prior),git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();assert.equal(value.checkoutCommit,git(['rev-parse','HEAD']));assert.equal(value.checkoutTree,git(['rev-parse','HEAD^{tree}']));assert.notEqual(value.checkoutCommit,'f'.repeat(40));assert.equal(value.phase,'UNKNOWN');assert.equal(value.exitCode,null);assert.equal(value.runId,'123456789');assert.equal(value.runAttempt,3);assert.equal(value.stepConclusion,'failure');assert.ok(!prior.includes(Buffer.from(secret)));assert.throws(()=>writeOnboardingVerdict(root,{}));assert.deepEqual(readFileSync(path),prior);
}));
test('workflow preserves one aggregate deadline and publishes only a separate finite verdict before later deletion',()=>{
 const index=steps.indexOf(combined),capture=steps[index+1],upload=steps[index+2];assert.equal(combined['timeout-minutes'],120);assert.deepEqual(combined.env,{CI:'1',MAESTRO_CLI_NO_ANALYTICS:'1',MAESTRO_DRIVER_STARTUP_TIMEOUT:'300000'});
 assert.equal(capture.if,'always()');assert.equal(capture['continue-on-error'],true);assert.equal(capture.run,'node scripts/native-onboarding-verdict.mjs');assert.equal(capture.env.ONBOARDING_STEP_CONCLUSION,'${{ steps.onboarding_combined.conclusion }}');assert.equal(upload.if,'always()');assert.equal(upload['continue-on-error'],true);assert.equal(upload.uses,'actions/upload-artifact@v6');assert.equal(upload.with.name,'puptime-ios-onboarding-verdict');assert.equal(upload.with.path,'build/onboarding-verdict.json');assert.equal(steps[index+3].name,'Capture finite conversational flow verdict');assert.equal(steps[index+4].name,'Upload finite conversational flow verdict');assert.equal(steps[index+5].name,'Verify native cloud account deletion preserves local history');assert.match(readFileSync('.github/workflows/checks.yml','utf8'),/node --test [^\n]*scripts\/native-onboarding-verdict\.test\.mjs/);
});

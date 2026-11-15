import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {lstatSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {standardSelection} from './native-standard-suite.mjs';
import {standardVerdict,writeStandardVerdict} from './native-standard-verdict.mjs';

const files=standardSelection('standard-all').files,secret='private@example.invalid 123456 token=PRIVATE /private/raw';
const xml=(selected=files,error=-1)=>'<testsuites><testsuite tests="'+selected.length+'" failures="'+Number(error>=0)+'">'+selected.map((file,i)=>'<testcase file="'+file+'" status="'+(i===error?'ERROR':'SUCCESS')+'" name="'+secret+'">'+(i===error?'<failure>'+secret+'</failure>':'')+'</testcase>').join('')+'</testsuite></testsuites>';
const metadata={checkoutCommit:'a'.repeat(40),checkoutTree:'b'.repeat(40),runId:'123456789',runAttempt:'2',stepConclusion:'failure'};
function temporary(run){const root=realpathSync(mkdtempSync(join(tmpdir(),'puptime-standard-verdict-')));try{return run(root);}finally{rmSync(root,{recursive:true,force:true});}}

test('closed thirteen-flow projection preserves actual mixed results and independent step outcome without private report fields',()=>{
 for(const error of [-1,10]){const value=standardVerdict(xml(files,error),metadata);assert.equal(value.expectedFlows,13);assert.equal(value.complete,true);assert.equal(value.flows.length,13);assert.deepEqual(value.flows.map(row=>row.flow),files);assert.equal(value.flows.filter(row=>row.status==='ERROR').length,Number(error>=0));assert.equal(value.stepConclusion,'failure');assert.equal(value.checkoutCommit,metadata.checkoutCommit);assert.equal(value.runAttempt,2);assert.ok(!JSON.stringify(value).includes('private'));assert.ok(!JSON.stringify(value).includes('PRIVATE'));}
});
test('missing, malformed, partial, duplicate and unsupported reports stay UNKNOWN rather than thirteen failures',()=>{
 for(const input of [undefined,'',xml().slice(0,-5),xml(files.slice(1)),xml([...files.slice(1),files[1]]),'<!DOCTYPE testsuites>'+xml(),xml().replace(files[0],'private-file')]){const value=standardVerdict(input,metadata);assert.equal(value.complete,false);assert.ok(value.flows.every(row=>row.status==='UNKNOWN'));assert.equal(value.stepConclusion,'failure');}
 const pending=standardVerdict(xml().replace('status="SUCCESS"','status="RUNNING"'),metadata);assert.equal(pending.complete,false);assert.equal(pending.flows[0].status,'UNKNOWN');assert.ok(pending.flows.slice(1).every(row=>row.status==='SUCCESS'));
});
test('source/run/step metadata uses only exact bounded identifiers and enum values',()=>{
 const empty=standardVerdict(undefined,{checkoutCommit:secret,checkoutTree:'c'.repeat(41),runId:secret,runAttempt:secret,stepConclusion:secret});
 assert.equal(empty.checkoutCommit,null);assert.equal(empty.checkoutTree,null);assert.equal(empty.runId,null);assert.equal(empty.runAttempt,null);assert.equal(empty.stepConclusion,'UNKNOWN');assert.ok(!JSON.stringify(empty).includes('private'));
 for(const attempt of ['0','01','-1','1.5','9007199254740992'])assert.equal(standardVerdict(undefined,{runAttempt:attempt}).runAttempt,null);
 for(const conclusion of ['success','failure','cancelled','skipped'])assert.equal(standardVerdict(undefined,{stepConclusion:conclusion}).stepConclusion,conclusion);
});
test('actual producer reads only the fixed bounded regular report; missing, oversized, invalid UTF8 and symlinks stay unknown',()=>{
 for(const kind of ['valid','missing','oversized','invalid-utf8','file-link','directory-link','directory'])temporary(root=>{
  const build=join(root,'build'),external=join(root,'other');mkdirSync(external);
  if(kind==='directory-link')symlinkSync(external,build);else mkdirSync(build);
  const path=join(build,'maestro-report.xml');
  if(kind==='file-link'){writeFileSync(join(external,'report'),xml());symlinkSync(join(external,'report'),path);}
  else if(kind==='directory')mkdirSync(path);
  else if(kind!=='missing')writeFileSync(path,kind==='oversized'?Buffer.alloc(2*1024*1024+1):kind==='invalid-utf8'?Buffer.from([255]):xml());
  if(kind==='directory-link'){assert.throws(()=>writeStandardVerdict(root,{}));assert.throws(()=>lstatSync(join(external,'standard-verdict.json')));return;}
  const value=writeStandardVerdict(root,{});assert.equal(value.complete,kind==='valid');if(kind!=='valid')assert.ok(value.flows.every(row=>row.status==='UNKNOWN'));
  assert.equal(lstatSync(join(build,'standard-verdict.json')).mode&0o777,0o600);
 });
});
test('the real no-argument CLI binds checkout HEAD/tree, ignores GITHUB_SHA, and uploads no report content',()=>temporary(root=>{
 execFileSync('git',['init','--quiet'],{cwd:root});execFileSync('git',['-c','user.name=Synthetic','-c','user.email=fixture@example.invalid','commit','--allow-empty','--quiet','-m','fixture'],{cwd:root});
 mkdirSync(join(root,'build'));writeFileSync(join(root,'build/maestro-report.xml'),xml(files,10));
 const run=spawnSync(process.execPath,[fileURLToPath(new URL('./native-standard-verdict.mjs',import.meta.url))],{cwd:root,encoding:'utf8',env:{...process.env,GITHUB_SHA:'f'.repeat(40),GITHUB_RUN_ID:'123456789',GITHUB_RUN_ATTEMPT:'3',STANDARD_STEP_CONCLUSION:'failure'}});assert.equal(run.status,0);assert.equal(run.stdout,'');assert.equal(run.stderr,'');
 const value=JSON.parse(readFileSync(join(root,'build/standard-verdict.json'))),git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();assert.equal(value.checkoutCommit,git(['rev-parse','HEAD']));assert.equal(value.checkoutTree,git(['rev-parse','HEAD^{tree}']));assert.notEqual(value.checkoutCommit,'f'.repeat(40));assert.equal(value.runId,'123456789');assert.equal(value.runAttempt,3);assert.equal(value.flows[10].status,'ERROR');assert.ok(!JSON.stringify(value).includes('private'));
 const prior=readFileSync(join(root,'build/standard-verdict.json'));assert.throws(()=>writeStandardVerdict(root,{}));assert.deepEqual(readFileSync(join(root,'build/standard-verdict.json')),prior);
}));
test('ordinary workflow projects and separately uploads only the finite receipt before conversational auth, without changing the standard test',()=>{
 const require=createRequire(import.meta.url),{parse}=require('yaml'),workflow=parse(readFileSync('.github/workflows/ios-simulator.yml','utf8')),steps=workflow.jobs.build.steps;
 const index=steps.findIndex(step=>step.id==='standard_maestro'),standard=steps[index],capture=steps[index+1],upload=steps[index+2];assert.ok(index>0);assert.equal(standard.name,'Run Maestro end-to-end tests');assert.equal(standard['timeout-minutes'],60);assert.equal(standard.env.MAESTRO_DRIVER_STARTUP_TIMEOUT,'300000');assert.match(standard.run,/--output build\/maestro-report\.xml/);assert.match(standard.run,/\.maestro\s*$/);
 assert.equal(capture.if,'always()');assert.equal(capture['continue-on-error'],true);assert.equal(capture.run,'node scripts/native-standard-verdict.mjs');assert.equal(capture.env.STANDARD_STEP_CONCLUSION,'${{ steps.standard_maestro.conclusion }}');
 assert.equal(upload.if,'always()');assert.equal(upload['continue-on-error'],true);assert.equal(upload.uses,'actions/upload-artifact@v6');assert.equal(upload.with.name,'puptime-ios-standard-verdict');assert.equal(upload.with.path,'build/standard-verdict.json');assert.equal(steps[index+3].name,'Run conversational onboarding into the real app');
 assert.match(readFileSync('.github/workflows/checks.yml','utf8'),/node --test [^\n]*scripts\/native-standard-verdict\.test\.mjs/);
});

import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {lstatSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createRequire,syncBuiltinESMExports} from 'node:module';
import {conversationalFiles,standardSelection} from './native-standard-suite.mjs';
import {conversationalVerdict,standardVerdict,writeConversationalVerdict,writeStandardVerdict} from './native-standard-verdict.mjs';

const files=standardSelection('standard-all').files,secret='private@example.invalid 123456 token=PRIVATE /private/raw';
const xml=(selected=files,error=-1)=>'<testsuites><testsuite tests="'+selected.length+'" failures="'+Number(error>=0)+'">'+selected.map((file,i)=>'<testcase file="'+file+'" status="'+(i===error?'ERROR':'SUCCESS')+'" name="'+secret+'">'+(i===error?'<failure>'+secret+'</failure>':'')+'</testcase>').join('')+'</testsuite></testsuites>';
const metadata={checkoutCommit:'a'.repeat(40),checkoutTree:'b'.repeat(40),runId:'123456789',runAttempt:'2',stepConclusion:'failure'};
function temporary(run){const root=realpathSync(mkdtempSync(join(tmpdir(),'puptime-standard-verdict-')));try{return run(root);}finally{rmSync(root,{recursive:true,force:true});}}

test('fixed conversational verdict retains all seventeen actual statuses and only its closed source metadata',()=>{
 const value=conversationalVerdict(xml(conversationalFiles,6),metadata);
 assert.deepEqual(Object.keys(value),['schemaVersion','stage','expectedFlows','complete','flows','stepConclusion','checkoutCommit','checkoutTree','runId','runAttempt']);
 assert.equal(value.stage,'conversational-maestro-verdict');assert.equal(value.expectedFlows,17);assert.equal(value.complete,true);assert.equal(value.flows[6].status,'ERROR');assert.equal(value.flows.filter(row=>row.status==='SUCCESS').length,16);assert.deepEqual(value.flows.map(row=>row.flow),conversationalFiles);assert.ok(!JSON.stringify(value).includes('private'));
 for(const input of [undefined,xml(files),xml(conversationalFiles).slice(0,-5),xml(conversationalFiles.slice(1))]){const result=conversationalVerdict(input,metadata);assert.equal(result.complete,false);assert.equal(result.flows.length,17);assert.ok(result.flows.every(row=>row.status==='UNKNOWN'));}
 const invalid=conversationalVerdict(undefined,{checkoutCommit:secret,checkoutTree:secret,runId:secret,runAttempt:secret,stepConclusion:secret});assert.equal(invalid.checkoutCommit,null);assert.equal(invalid.checkoutTree,null);assert.equal(invalid.runId,null);assert.equal(invalid.runAttempt,null);assert.equal(invalid.stepConclusion,'UNKNOWN');assert.ok(!JSON.stringify(invalid).includes('private'));
});

test('conversational producer reads only its fixed stable bounded report and writes a separate exclusive receipt',()=>{
 for(const kind of ['valid','missing','standard-only','oversized','invalid-utf8','file-link','directory-link','directory'])temporary(root=>{
  const build=join(root,'build'),external=join(root,'other');mkdirSync(external);
  if(kind==='directory-link')symlinkSync(external,build);else mkdirSync(build);
  const path=join(build,'onboarding-maestro-report.xml');
  if(kind==='file-link'){writeFileSync(join(external,'report'),xml(conversationalFiles));symlinkSync(join(external,'report'),path);}
  else if(kind==='directory')mkdirSync(path);
  else if(kind==='standard-only')writeFileSync(join(build,'maestro-report.xml'),xml());
  else if(kind!=='missing')writeFileSync(path,kind==='oversized'?Buffer.alloc(2*1024*1024+1):kind==='invalid-utf8'?Buffer.from([255]):xml(conversationalFiles,6));
  if(kind==='directory-link'){assert.throws(()=>writeConversationalVerdict(root,{}));assert.throws(()=>lstatSync(join(external,'conversational-verdict.json')));return;}
  const value=writeConversationalVerdict(root,{});assert.equal(value.complete,kind==='valid');assert.equal(value.flows.length,17);if(kind!=='valid')assert.ok(value.flows.every(row=>row.status==='UNKNOWN'));
  const output=join(build,'conversational-verdict.json'),prior=readFileSync(output);assert.equal(lstatSync(output).mode&0o777,0o600);assert.throws(()=>lstatSync(join(build,'standard-verdict.json')));assert.ok(!prior.includes(Buffer.from(secret)));assert.throws(()=>writeConversationalVerdict(root,{}));assert.deepEqual(readFileSync(output),prior);
 });
});

test('an observed descriptor change makes the actual conversational report incomplete',()=>temporary(root=>{
 mkdirSync(join(root,'build'));writeFileSync(join(root,'build/onboarding-maestro-report.xml'),xml(conversationalFiles));
 const original=fs.fstatSync;let calls=0;
 try{
  fs.fstatSync=(...args)=>{const value=original(...args);return ++calls===2?{...value,mtimeMs:value.mtimeMs+1}:value;};syncBuiltinESMExports();
  const value=writeConversationalVerdict(root,{});assert.equal(calls,2);assert.equal(value.complete,false);assert.ok(value.flows.every(row=>row.status==='UNKNOWN'));
 }finally{fs.fstatSync=original;syncBuiltinESMExports();}
}));

test('the one fixed conversational CLI binds checkout and onboarding outcome, and rejects arbitrary flags or paths',()=>temporary(root=>{
 execFileSync('git',['init','--quiet'],{cwd:root});execFileSync('git',['-c','user.name=Synthetic','-c','user.email=fixture@example.invalid','commit','--allow-empty','--quiet','-m','fixture'],{cwd:root});mkdirSync(join(root,'build'));writeFileSync(join(root,'build/onboarding-maestro-report.xml'),xml(conversationalFiles,6));
 const cli=fileURLToPath(new URL('./native-standard-verdict.mjs',import.meta.url)),env={...process.env,GITHUB_SHA:'f'.repeat(40),GITHUB_RUN_ID:'123456789',GITHUB_RUN_ATTEMPT:'3',ONBOARDING_STEP_CONCLUSION:'failure',STANDARD_STEP_CONCLUSION:'success'};
 for(const args of [['--conversational'],['--conversational-fixed17','private-path'],['private-path']]){const run=spawnSync(process.execPath,[cli,...args],{cwd:root,encoding:'utf8',env});assert.equal(run.status,1);assert.equal(run.stdout,'');assert.equal(run.stderr,'Standard verdict evidence unavailable.\n');assert.throws(()=>lstatSync(join(root,'build/conversational-verdict.json')));}
 const run=spawnSync(process.execPath,[cli,'--conversational-fixed17'],{cwd:root,encoding:'utf8',env});assert.equal(run.status,0);assert.equal(run.stdout,'');assert.equal(run.stderr,'');
 const value=JSON.parse(readFileSync(join(root,'build/conversational-verdict.json'))),git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();assert.equal(value.checkoutCommit,git(['rev-parse','HEAD']));assert.equal(value.checkoutTree,git(['rev-parse','HEAD^{tree}']));assert.notEqual(value.checkoutCommit,env.GITHUB_SHA);assert.equal(value.runId,'123456789');assert.equal(value.runAttempt,3);assert.equal(value.stepConclusion,'failure');assert.equal(value.expectedFlows,17);assert.equal(value.flows[6].status,'ERROR');assert.throws(()=>lstatSync(join(root,'build/standard-verdict.json')));
}));

test('workflow separately projects fixed conversational results after the original boundary without changing its run or deadline',()=>{
 const require=createRequire(import.meta.url),{parse}=require('yaml'),steps=parse(readFileSync('.github/workflows/ios-simulator.yml','utf8')).jobs.build.steps;
 const combined=steps.find(step=>step.id==='onboarding_combined'),index=steps.findIndex(step=>step.name==='Capture finite conversational flow verdict'),capture=steps[index],upload=steps[index+1];assert.equal(combined['timeout-minutes'],120);assert.match(combined.run,/--output build\/onboarding-maestro-report\.xml/);assert.match(combined.run,/\.maestro\/conversational\n/);
 assert.equal(steps[index-1].name,'Upload finite onboarding command boundary');assert.equal(capture.if,'always()');assert.equal(capture['continue-on-error'],true);assert.equal(capture.run,'node scripts/native-standard-verdict.mjs --conversational-fixed17');assert.equal(capture.env.ONBOARDING_STEP_CONCLUSION,'${{ steps.onboarding_combined.conclusion }}');
 assert.equal(upload.if,'always()');assert.equal(upload['continue-on-error'],true);assert.equal(upload.uses,'actions/upload-artifact@v6');assert.equal(upload.with.name,'puptime-ios-conversational-verdict');assert.equal(upload.with.path,'build/conversational-verdict.json');assert.equal(steps[index+2].name,'Verify native cloud account deletion preserves local history');assert.equal(steps[index+2].if,undefined);
});

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

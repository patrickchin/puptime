import assert from 'node:assert/strict';
import test from 'node:test';
import {assertNativeHostPolicy,assertSameHostAttempt,compileStep,testHostUploadStep} from './native-host-policy.mjs';
const now=Date.parse('2026-11-15T00:10:00Z');
function fixture(){
 const run={id:123,run_attempt:2,repository:{full_name:'patrickchin/puptime'},head_repository:{full_name:'patrickchin/puptime'},head_branch:'main',event:'push',path:'.github/workflows/ios-simulator.yml',head_sha:'a'.repeat(40),status:'completed',conclusion:'success'};
 const artifact={id:456,name:'puptime-ios-simulator',size_in_bytes:1024,expired:false,digest:'sha256:'+'b'.repeat(64),created_at:'2026-11-15T00:05:02Z',updated_at:'2026-11-15T00:05:10Z',expires_at:'2026-11-22T00:05:02Z',workflow_run:{id:123,head_sha:run.head_sha,head_branch:'main'}};
 const step=(name,number,started_at,completed_at)=>({name,number,started_at,completed_at,status:'completed',conclusion:'success'});
 const jobs={total_count:1,jobs:[{id:789,name:'build',run_id:123,run_attempt:2,head_sha:run.head_sha,status:'in_progress',steps:[step(compileStep,9,'2026-11-15T00:00:00Z','2026-11-15T00:05:00Z'),step(testHostUploadStep,10,'2026-11-15T00:05:01Z','2026-11-15T00:05:10Z')]}]};
 return {run,artifacts:{total_count:1,artifacts:[artifact]},jobs,now};
}
const rejects=(change,policy='compiled-for-testing')=>{const value=fixture();change(value);assert.throws(()=>assertNativeHostPolicy({...value,policy}));};

test('default policy still requires full workflow success and never falls back',()=>{
 const value=fixture(),before=structuredClone(value),result=assertNativeHostPolicy(value);assert.equal(result.proof.hostQualification,'full-suite-success');assert.equal(result.proof.releaseQualified,false);assert.deepEqual(value,before);
 for(const conclusion of ['failure','cancelled','timed_out',null])rejects(value=>{value.run.conclusion=conclusion;},'full-suite-success');
 rejects(value=>{value.run.status='in_progress';value.run.conclusion=null;},'full-suite-success');
 assert.throws(()=>assertNativeHostPolicy({...value,policy:'allow-failed'}));
});

test('explicit compiled policy permits more tests while preserving actual red or pending full-suite state',()=>{
 for(const [status,conclusion] of [['completed','success'],['completed','failure'],['completed','timed_out'],['completed','cancelled'],['in_progress',null]]){
  const value=fixture();Object.assign(value.run,{status,conclusion});const proof=assertNativeHostPolicy({...value,policy:'compiled-for-testing'}).proof;
  assert.equal(proof.hostQualification,'compiled-for-testing');assert.equal(proof.releaseQualified,false);assert.equal(proof.hostRunStatus,status);assert.equal(proof.hostRunConclusion,conclusion);assert.equal(proof.nativeHostRunAttempt,2);assert.equal(proof.nativeHostBuildJobId,789);
 }
 rejects(value=>{value.run.status='queued';});rejects(value=>{value.run.conclusion='unknown';});
});

test('trusted source, complete metadata and immutable artifact identity are required',()=>{
 for(const change of [v=>v.run.head_branch='feature',v=>v.run.event='pull_request',v=>v.run.path='other.yml',v=>v.run.repository.full_name='other/repo',v=>v.run.head_repository.full_name='fork/repo',v=>v.run.head_sha='invalid',v=>v.artifacts.total_count++,v=>v.artifacts.artifacts.push(structuredClone(v.artifacts.artifacts[0])),v=>v.artifacts.artifacts[0].expired=true,v=>v.artifacts.artifacts[0].expires_at='2026-11-14T00:00:00Z',v=>v.artifacts.artifacts[0].expires_at='2027-02-31T00:00:00Z',v=>v.artifacts.artifacts[0].digest='unknown',v=>v.artifacts.artifacts[0].workflow_run.id++,v=>v.artifacts.artifacts[0].workflow_run.head_sha='c'.repeat(40),v=>v.artifacts.artifacts[0].workflow_run.head_branch='feature',v=>v.artifacts.artifacts[0].size_in_bytes=0,v=>v.artifacts.artifacts[0].size_in_bytes=257*1024*1024])rejects(change);
});

test('only unique successful compile/upload steps in the selected attempt can qualify',()=>{
 for(const change of [v=>v.jobs.total_count++,v=>v.jobs.jobs.push(structuredClone(v.jobs.jobs[0])),v=>v.jobs.jobs[0].run_attempt--,v=>v.jobs.jobs[0].run_id++,v=>v.jobs.jobs[0].head_sha='c'.repeat(40),v=>v.jobs.jobs[0].steps.pop(),v=>v.jobs.jobs[0].steps.push(structuredClone(v.jobs.jobs[0].steps[0])),v=>v.jobs.jobs[0].steps[0].conclusion='failure',v=>v.jobs.jobs[0].steps[1].conclusion='skipped',v=>v.jobs.jobs[0].steps[1].status='in_progress',v=>v.jobs.jobs[0].steps[1].number=8,v=>v.jobs.jobs[0].steps[1].started_at='2026-11-15T00:04:59Z'])rejects(change);
});

test('stale earlier-attempt artifacts fail; only the observed one-second metadata envelope is allowed',()=>{
 for(const change of [v=>v.artifacts.artifacts[0].created_at='2026-11-14T23:59:59Z',v=>v.artifacts.artifacts[0].updated_at='2026-11-15T00:05:12Z',v=>v.artifacts.artifacts[0].created_at='2026-11-15T00:05:12Z',v=>v.artifacts.artifacts[0].updated_at='2026-11-15T00:05:01Z'])rejects(change);
 const value=fixture();value.artifacts.artifacts[0].created_at=value.artifacts.artifacts[0].updated_at='2026-11-15T00:05:11Z';assertNativeHostPolicy({...value,policy:'compiled-for-testing'});
});

test('a new attempt/source during download must be explicitly selected again',()=>{
 const {run}=fixture();assertSameHostAttempt(run,structuredClone(run));
 for(const key of ['id','run_attempt','head_sha']){const changed=structuredClone(run);changed[key]=key==='head_sha'?'d'.repeat(40):changed[key]+1;assert.throws(()=>assertSameHostAttempt(run,changed));}
});

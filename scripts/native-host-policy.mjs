// Metadata admission only. Download digest, native inputs and signed code are
// independently checked by the caller before creating a simulator.
import assert from 'node:assert/strict';

export const hostPolicies=['full-suite-success','compiled-for-testing'];
export const compileStep='Build app and widget for iOS Simulator';
export const testHostUploadStep='Upload compiled iOS host for testing';
const stamp=value=>{assert.match(value??'',/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);const time=Date.parse(value);assert.ok(Number.isFinite(time));assert.equal(new Date(time).toISOString().replace('.000Z','Z'),value);return time;};
const positive=value=>{assert.ok(Number.isSafeInteger(value)&&value>0);return value;};

export function assertNativeHostRun(run,policy='full-suite-success',repository='patrickchin/puptime'){
 assert.ok(hostPolicies.includes(policy),'Choose an explicit supported test-host policy.');
 positive(run.id);positive(run.run_attempt);
 assert.equal(repository,'patrickchin/puptime');assert.equal(run.repository?.full_name,repository);assert.equal(run.head_repository?.full_name,repository);
 assert.equal(run.head_branch,'main');assert.equal(run.event,'push');assert.equal(run.path,'.github/workflows/ios-simulator.yml');assert.match(run.head_sha??'',/^[a-f0-9]{40}$/);
 if(policy==='full-suite-success'){
  assert.equal(run.status,'completed');assert.equal(run.conclusion,'success','Default hosts require the entire workflow to succeed.');
 }else{
  assert.ok(['in_progress','completed'].includes(run.status));
  if(run.status==='in_progress')assert.equal(run.conclusion,null);else assert.ok(['success','failure','timed_out','cancelled'].includes(run.conclusion));
 }
}
export function assertNativeHostPolicy({policy='full-suite-success',run,artifacts,jobs,repository='patrickchin/puptime',now=Date.now()}){
 assertNativeHostRun(run,policy,repository);
 assert.equal(artifacts.total_count,artifacts.artifacts.length,'Do not accept a truncated artifact listing.');
 const matches=artifacts.artifacts.filter(value=>value.name==='puptime-ios-simulator');assert.equal(matches.length,1);
 const artifact=matches[0];positive(artifact.id);positive(artifact.size_in_bytes);assert.ok(artifact.size_in_bytes<=256*1024*1024);
 assert.equal(artifact.expired,false);assert.ok(stamp(artifact.expires_at)>now);assert.match(artifact.digest??'',/^sha256:[a-f0-9]{64}$/);
 assert.equal(artifact.workflow_run?.id,run.id);assert.equal(artifact.workflow_run?.head_sha,run.head_sha);assert.equal(artifact.workflow_run?.head_branch,'main');
 let build;
 if(policy==='compiled-for-testing'){
  assert.equal(jobs.total_count,jobs.jobs.length,'Use all jobs from the explicitly selected attempt.');
  const matches=jobs.jobs.filter(value=>value.name==='build');assert.equal(matches.length,1);build=matches[0];
  positive(build.id);assert.equal(build.run_id,run.id);assert.equal(build.run_attempt,run.run_attempt);assert.equal(build.head_sha,run.head_sha);
  const step=name=>{const values=build.steps.filter(value=>value.name===name);assert.equal(values.length,1);const value=values[0];assert.equal(value.status,'completed');assert.equal(value.conclusion,'success');positive(value.number);assert.ok(stamp(value.completed_at)>=stamp(value.started_at));return value;};
  const compile=step(compileStep),upload=step(testHostUploadStep);
  assert.ok(upload.number>compile.number&&stamp(upload.started_at)>=stamp(compile.completed_at));
  // Actual GitHub metadata rounded artifact creation one second later than the
  // upload step's completion. This one-second precision envelope is bounded;
  // an earlier attempt's artifact cannot fall inside this upload window.
  const start=stamp(upload.started_at)-1000,end=stamp(upload.completed_at)+1000;
  const created=stamp(artifact.created_at),updated=stamp(artifact.updated_at);
  assert.ok(created>=start&&created<=end&&updated>=created&&updated<=end,'Artifact must belong to this attempt and upload time window.');
 }
 return {artifact,proof:{hostQualification:policy,releaseQualified:false,nativeHostRunAttempt:run.run_attempt,hostRunObservedAt:new Date(now).toISOString(),hostRunStatus:run.status,hostRunConclusion:run.conclusion,...(build?{nativeHostBuildJobId:build.id}:{})}};
}

export function assertSameHostAttempt(first,current){
 for(const key of ['id','run_attempt','head_sha'])assert.equal(current[key],first[key],'Host attempt/source changed while downloading; select it again explicitly.');
}

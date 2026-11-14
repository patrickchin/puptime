// Reuse a real, attested iOS artifact; no native build, owner account or SDK mock.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync,spawn} from 'node:child_process';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,statSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,isAbsolute,join,resolve} from 'node:path';
import {deleteOwnedSimulator,installTaskCleanup,ownProcess} from './native-task-cleanup.mjs';

const repository=process.env.GITHUB_REPOSITORY,runId=process.env.PUPTIME_NATIVE_HOST_RUN_ID;
assert.equal(repository,'patrickchin/puptime','Run only in the intended repository.');
assert.match(runId??'',/^\d+$/);
const scenario=process.env.PUPTIME_ACCOUNT_SCENARIO;
assert.ok(['baseline','comparison','offline','isolation','photos','deletion','enrolled-upgrade'].includes(scenario));
const output=resolve('build/isolated-native-account',scenario);mkdirSync(output,{recursive:true});
const privateDirectory=mkdtempSync(join(tmpdir(),'puptime-native-host-'));
const command=(binary,args,options={})=>execFileSync(binary,args,{encoding:'utf8',timeout:120000,stdio:['ignore','pipe','pipe'],...options}).trim();
const api=path=>JSON.parse(command('gh',['api',`repos/${repository}/${path}`]));
const source=command('git',['rev-parse','HEAD']);
const run=api(`actions/runs/${runId}`);
assert.equal(run.status,'completed');assert.equal(run.conclusion,'success');
assert.equal(run.head_repository?.full_name,repository);assert.equal(run.head_branch,'main');
assert.equal(run.event,'push','Use a main push artifact; a pull-request head is not its compiled merge checkout.');
assert.equal(run.path,'.github/workflows/ios-simulator.yml');
assert.match(run.head_sha,/^[a-f0-9]{40}$/);
command('git',['fetch','--no-tags','--depth=1','origin',run.head_sha]);
// These produce the compiled native host. Candidate JavaScript is re-bundled by
// the existing account runner, so it is identified separately in the receipt.
const nativeInputs=['package.json','package-lock.json','app.json','app.config.*','eas.json','.npmrc','plugins','patches','assets','ios'];
const changedNativeInputs=command('git',['diff','--name-only',run.head_sha,source,'--',...nativeInputs]);
assert.equal(changedNativeInputs,'','Native inputs changed: use a newly qualified native host.');
const artifacts=api(`actions/runs/${runId}/artifacts`).artifacts.filter(artifact=>artifact.name==='puptime-ios-simulator');
assert.equal(artifacts.length,1);const artifact=artifacts[0];assert.equal(artifact.expired,false);
assert.match(artifact.digest??'',/^sha256:[a-f0-9]{64}$/);
const archive=process.env.PUPTIME_NATIVE_HOST_ARCHIVE?readFileSync(resolve(process.env.PUPTIME_NATIVE_HOST_ARCHIVE))
 :execFileSync('gh',['api',`repos/${repository}/actions/artifacts/${artifact.id}/zip`],{timeout:180000,maxBuffer:256*1024*1024,stdio:['ignore','pipe','pipe']});
assert.equal('sha256:'+createHash('sha256').update(archive).digest('hex'),artifact.digest,'Verify the downloaded artifact bytes.');
const archivePath=join(privateDirectory,'host-artifact.zip');writeFileSync(archivePath,archive);
command('unzip',['-q',archivePath,'-d',privateDirectory]);
const appArchive=join(privateDirectory,'Puptime-iOS-Simulator.zip');assert.ok(existsSync(appArchive));
command('ditto',['-x','-k',appArchive,join(privateDirectory,'host')]);
const host=join(privateDirectory,'host/Puptime.app');assert.ok(existsSync(host));
command('codesign',['--verify','--deep','--strict',host]);
assert.equal(command('plutil',['-extract','CFBundleIdentifier','raw','-o','-',join(host,'Info.plist')]),'com.patrickchin.puptime');
assert.match(command('lipo',['-archs',join(host,'Puptime')]),/\barm64\b/);
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const provenance={scenario,candidateSource:source,nativeSource:run.head_sha,nativeHostRunId:runId,artifactId:artifact.id,artifactDigest:artifact.digest,archiveSource:process.env.PUPTIME_NATIVE_HOST_ARCHIVE?'verified-local-cache':'download',nativeInputsUnchanged:true,nativeExecutableSHA256:hash(join(host,'Puptime')),scope:scenario==='enrolled-upgrade'?'Driver source with privately prepared historical native/source inputs; the successful-main artifact is a reference attestation, and the prepared older native host is installed first. Actual native email SDK and isolated local HTTPS service; controlled-origin runtime qualification only.':'Actual native email SDK + ephemeral local HTTPS Better Auth/D1/SQLite DO; synthetic identity and history only; no production or provider OAuth qualification.'};
let initialHost=host;
if(scenario==='enrolled-upgrade'){
 const path=process.env.PUPTIME_ENROLLED_RUNTIME_INPUTS;assert.ok(path&&isAbsolute(path));assert.equal(realpathSync(path),path);assert.equal(statSync(path).mode&0o777,0o600);assert.equal(statSync(dirname(path)).mode&0o777,0o700);assert.ok(statSync(path).size<2097152);
 const inputs=JSON.parse(readFileSync(path,'utf8'));assert.equal(inputs.status,'prepared');assert.equal(inputs.stage,'controlled-origin-enrolled-preparation');assert.equal(inputs.upgradeExecuted,false);assert.equal(inputs.appsInstalled,false);assert.equal(inputs.javaScriptModified,false);
 const older=inputs.runtimes[0];assert.equal(older.name,'older');assert.equal(older.source,'008b4a0b7f4d8a77cc8c13d95f39001534d8fd70');
 initialHost=join(dirname(path),'inputs/older/host/Puptime.app');assert.equal(older.host,initialHost);assert.equal(realpathSync(initialHost),initialHost);
 assert.equal(hash(join(initialHost,'Puptime')),'1d278f77e8e1358a1855c854462bde2c85e689f7e270fd2ea88ab0982c814971');assert.equal(hash(join(initialHost,'main.jsbundle')),'793aea3e98318fca08598782e4629e40542182bc2cbd3697f4f3533593ca5da7');command('codesign',['--verify','--deep','--strict',initialHost]);
 assert.equal(command('plutil',['-extract','CFBundleIdentifier','raw','-o','-',join(initialHost,'Info.plist')]),'com.patrickchin.puptime');
 provenance.initialHistoricalSource=older.source;provenance.initialHistoricalNativeSHA256=hash(join(initialHost,'Puptime'));
}
writeFileSync(join(output,'native-provenance.json'),JSON.stringify(provenance,null,2)+'\n');
const runtimes=JSON.parse(command('xcrun',['simctl','list','runtimes','-j'])).runtimes;
const runtime=runtimes.filter(item=>item.isAvailable&&item.identifier.includes('iOS-26')).at(-1);assert.ok(runtime);
provenance.environment={runnerArchitecture:process.arch,runnerImage:process.env.ImageOS??null,runnerImageVersion:process.env.ImageVersion??null,xcodeVersion:command('xcodebuild',['-version']),developerDirectory:command('xcode-select',['-p']),runtime:{identifier:runtime.identifier,name:runtime.name,version:runtime.version,buildVersion:runtime.buildversion},deviceType:'com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro'};
writeFileSync(join(output,'native-provenance.json'),JSON.stringify(provenance,null,2)+'\n');
const device=command('xcrun',['simctl','create',`Puptime Account ${scenario} CI ${process.env.GITHUB_RUN_ID}`,'com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro',runtime.identifier]);
let completed=false,stopCaseChild;
const task=installTaskCleanup(async()=>{
 const processesStopped=stopCaseChild?await stopCaseChild():true;
 const simulator=deleteOwnedSimulator({device,privateDirectory,preserve:!completed});
 writeFileSync(join(output,'task-cleanup.json'),JSON.stringify({status:processesStopped&&simulator.deleted?'passed':'failed',processesStopped,...simulator},null,2)+'\n');
 if(!processesStopped||!simulator.deleted)process.exitCode=1;
});
try{
 const bootStarted=Date.now();
 try{command('xcrun',['simctl','boot',device]);command('xcrun',['simctl','bootstatus',device,'-b'],{timeout:300000});}
 catch(error){
  // This is before app install or identity setup: retain actual OS progress, not
  // Node's truncated rendering of the child-process error's stdout property.
  writeFileSync(join(output,'simulator-boot-failure.log'),String(error.stdout??'').slice(-65536)+'\n'+String(error.stderr??'').slice(-8192));
  let state='unavailable';try{const all=JSON.parse(command('xcrun',['simctl','list','devices','available','-j'],{timeout:15000}));state=Object.values(all.devices).flat().find(item=>item.udid===device)?.state??'missing';}catch{}
  writeFileSync(join(output,'simulator-boot-failure.json'),JSON.stringify({stage:'simulator-boot',appInstalled:false,elapsedMs:Date.now()-bootStarted,category:error.code==='ETIMEDOUT'?'timeout':'command-failed',state},null,2)+'\n');throw error;
 }
 command('xcrun',['simctl','install',device,initialHost]);
 const mode={baseline:[],comparison:['--puppy-comparison'],offline:['--offline-lifecycle'],isolation:['--account-isolation'],photos:['--photo-lifecycle'],deletion:['--deletion-faults'],'enrolled-upgrade':['--enrolled-runtime-upgrade']}[scenario];
 const args=['scripts/verify-ios-guest-account.mjs',device,initialHost,'--replace-synthetic',output,...mode];
 await new Promise((resolveCase,reject)=>{const child=spawn(process.execPath,args,{stdio:'inherit',detached:true,env:{...process.env,CI:'1'}});stopCaseChild=ownProcess(child,{graceMs:120000});child.once('error',reject);child.once('close',async code=>{const stopped=await stopCaseChild();code===0&&stopped?resolveCase():reject(new Error(`Native ${scenario} case failed (${code}).`));});});
 assert.equal(JSON.parse(readFileSync(join(output,'verification.json'),'utf8')).status,'passed');assert.equal(task.signal,null);completed=true;
}finally{await task.run();task.dispose();}

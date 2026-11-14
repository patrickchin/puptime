// Reuse a real, attested iOS artifact; no native build, owner account or SDK mock.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync,spawn} from 'node:child_process';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';

const repository=process.env.GITHUB_REPOSITORY,runId=process.env.PUPTIME_NATIVE_HOST_RUN_ID;
assert.equal(repository,'patrickchin/puptime','Run only in the intended repository.');
assert.match(runId??'',/^\d+$/);
const scenario=process.env.PUPTIME_ACCOUNT_SCENARIO;
assert.ok(['baseline','comparison','offline','isolation','photos','deletion'].includes(scenario));
const output=resolve('build/isolated-native-account',scenario);mkdirSync(output,{recursive:true});
const privateDirectory=mkdtempSync(join(tmpdir(),'puptime-native-host-'));
const command=(binary,args,options={})=>execFileSync(binary,args,{encoding:'utf8',timeout:120000,stdio:['ignore','pipe','pipe'],...options}).trim();
const api=path=>JSON.parse(command('gh',['api',`repos/${repository}/${path}`]));
const source=command('git',['rev-parse','HEAD']);
const run=api(`actions/runs/${runId}`);
assert.equal(run.status,'completed');assert.equal(run.conclusion,'success');
assert.equal(run.head_repository?.full_name,repository);assert.equal(run.head_branch,'main');
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
const archive=execFileSync('gh',['api',`repos/${repository}/actions/artifacts/${artifact.id}/zip`],{timeout:180000,maxBuffer:256*1024*1024,stdio:['ignore','pipe','pipe']});
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
const provenance={scenario,candidateSource:source,nativeSource:run.head_sha,nativeHostRunId:runId,artifactId:artifact.id,artifactDigest:artifact.digest,nativeInputsUnchanged:true,nativeExecutableSHA256:hash(join(host,'Puptime')),scope:'Actual native email SDK + ephemeral local HTTPS Better Auth/D1/SQLite DO; synthetic identity and history only; no production or provider OAuth qualification.'};
writeFileSync(join(output,'native-provenance.json'),JSON.stringify(provenance,null,2)+'\n');
const runtimes=JSON.parse(command('xcrun',['simctl','list','runtimes','-j'])).runtimes;
const runtime=runtimes.filter(item=>item.isAvailable&&item.identifier.includes('iOS-26')).at(-1);assert.ok(runtime);
const device=command('xcrun',['simctl','create',`Puptime Account ${scenario} CI ${process.env.GITHUB_RUN_ID}`,'com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro',runtime.identifier]);
try{
 command('xcrun',['simctl','boot',device]);command('xcrun',['simctl','bootstatus',device,'-b']);
 command('xcrun',['simctl','install',device,host]);
 const mode={baseline:[],comparison:['--puppy-comparison'],offline:['--offline-lifecycle'],isolation:['--account-isolation'],photos:['--photo-lifecycle'],deletion:['--deletion-faults']}[scenario];
 const args=['scripts/verify-ios-guest-account.mjs',device,host,'--replace-synthetic',output,...mode];
 await new Promise((resolveCase,reject)=>{const child=spawn(process.execPath,args,{stdio:'inherit',env:{...process.env,CI:'1'}});child.once('error',reject);child.once('close',code=>code===0?resolveCase():reject(new Error(`Native ${scenario} case failed (${code}).`)));});
 assert.equal(JSON.parse(readFileSync(join(output,'verification.json'),'utf8')).status,'passed');
}finally{try{command('xcrun',['simctl','delete',device]);}catch{/* Preserve the original case failure. */}}

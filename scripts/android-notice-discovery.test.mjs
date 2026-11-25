import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,symlinkSync,readFileSync,chmodSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {publicDiscovery,publicNdk} from './android-notice-discovery.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
const project=(f,inspect=()=>({nativeFiles:[]}))=>publicDiscovery(f.root,f.cache,f.input,f.discovery,inspect,publicNdk(f.sdk,f.ndk));
function fixture(t){
 const root=mkdtempSync(join(tmpdir(),'puptime-notice-projection-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const pkg=join(root,'node_modules/example'),cache=join(root,'gradle-cache'),sdk=join(root,'sdk'),ndkRoot=join(sdk,'ndk/27.1.12297006');mkdirSync(pkg,{recursive:true});mkdirSync(cache);
 writeFileSync(join(pkg,'package.json'),JSON.stringify({name:'example',version:'1.2.3'}));writeFileSync(join(pkg,'index.js'),'public synthetic code');writeFileSync(join(pkg,'build.gradle'),'// synthetic native project');writeFileSync(join(pkg,'LICENSE'),'Synthetic public notice');
 const lock=JSON.stringify({packages:{'node_modules/example':{version:'1.2.3',integrity:'sha512-c3ludGhldGlj'}}});writeFileSync(join(root,'package-lock.json'),lock);
 writeFileSync(join(cache,'public.jar'),'synthetic public artifact');
 const ndk={schema:1,project:':app',configuredVersion:'27.1.12297006',sdkRoot:sdk,ndkRoot};
 for(const source of ['source.properties','NOTICE','NOTICE.toolchain','toolchains/llvm/prebuilt/linux-x86_64/NOTICE',...['arm-linux-androideabi','aarch64-linux-android','i686-linux-android','x86_64-linux-android'].map(triple=>'toolchains/llvm/prebuilt/linux-x86_64/sysroot/usr/lib/'+triple+'/libc++_shared.so')]){const file=join(ndkRoot,source);mkdirSync(join(file,'..'),{recursive:true});writeFileSync(file,source==='source.properties'?'Pkg.Revision = 27.1.12297006\n':'synthetic public SDK bytes');}
 const input={schema:1,configuration:'releaseRuntimeClasspath',components:[{projectBuildFile:join(pkg,'build.gradle')},{group:'example.group',name:'module',version:'2.0',artifacts:[{file:join(cache,'public.jar'),sha256:hash('synthetic public artifact')}]}]};
 const discovery={schema:1,platform:'android',complete:false,sourceCommit:'a'.repeat(40),lockSHA256:hash(lock),components:[{component:'npm:example@1.2.3',name:'example',version:'1.2.3',ecosystem:'npm',vendors:[],vendorNotices:{},nativeInputs:{'node_modules/example':{sha256:'c'.repeat(64),files:4,excludedBuildPaths:['build','.cxx']}},notices:[{source:'node_modules/example/LICENSE',sha256:hash('Synthetic public notice')}]}],sources:[{path:'node_modules/example/index.js',sha256:hash('public synthetic code')}]};
 return {root,pkg,cache,input,discovery,sdk,ndk};
}
test('actual projection preserves selected identities/digests without private paths or bodies',t=>{
 const f=fixture(t),result=project(f),encoded=JSON.stringify(result);
 assert.equal(result.status,'INCOMPLETE');assert.equal(result.complete,false);assert.equal(result.mavenArtifacts[0].component,'maven:example.group:module@2.0');assert.equal(result.nativeProjects[0].sourcePath,'build.gradle');assert.equal(result.metroPackages[0].component,'npm:example@1.2.3');
 assert.ok(!encoded.includes(f.root)&&!encoded.includes('public synthetic code')&&!encoded.includes('synthetic public artifact'));
});
test('changed artifact/lock/source boundary fails closed',t=>{
 const f=fixture(t);
 f.input.components[1].artifacts[0].sha256='f'.repeat(64);assert.throws(()=>project(f));
 f.input.components.pop();writeFileSync(join(f.pkg,'package.json'),JSON.stringify({name:'example',version:'9.9.9'}));assert.throws(()=>project(f));
});
test('artifact outside Gradle cache and absolute notice source are rejected',t=>{
 const f=fixture(t);f.input.components[1].artifacts[0].file=join(f.pkg,'index.js');assert.throws(()=>project(f));
 f.input.components.pop();f.discovery.components[0].notices[0].source='/private/never-output';assert.throws(()=>project(f));
});
test('native source symlink escaping installed modules is rejected',t=>{
 const f=fixture(t);writeFileSync(join(f.root,'outside.gradle'),'private synthetic sentinel');symlinkSync(join(f.root,'outside.gradle'),join(f.pkg,'escape.gradle'));
 f.input.components[0].projectBuildFile=join(f.pkg,'escape.gradle');assert.throws(()=>project(f));
});

function localMaven(t){
 const f=fixture(t),publication={groupId:'example.group',artifactId:'module',version:'1.2.3',repository:'local-maven-repo'};
 const source='local-maven-repo/example/group/module/1.2.3/module-1.2.3.aar',artifact=join(f.pkg,source);
 mkdirSync(join(f.pkg,'local-maven-repo/example/group/module/1.2.3'),{recursive:true});writeFileSync(artifact,'synthetic public local AAR');
 writeFileSync(join(f.pkg,'expo-module.config.json'),JSON.stringify({android:{publication}}));
 const lock=JSON.parse(readFileSync(join(f.root,'package-lock.json')));lock.packages['node_modules/example'].resolved='https://registry.npmjs.org/example/-/example-1.2.3.tgz';const encoded=JSON.stringify(lock);writeFileSync(join(f.root,'package-lock.json'),encoded);f.discovery.lockSHA256=hash(encoded);
 f.input.components=[{group:publication.groupId,name:publication.artifactId,version:publication.version,artifacts:[{file:artifact,sha256:hash('synthetic public local AAR')}]}];
 f.discovery.components[0].nativeInputs={};
 return {...f,publication,artifact,source};
}
test('declared locked npm local-Maven AAR records relative owner/SRI/config/file provenance',t=>{
 const f=localMaven(t),value=project(f),row=value.mavenArtifacts[0];
 assert.equal(row.npmSource.component,'npm:example@1.2.3');assert.equal(row.npmSource.sourcePath,f.source);assert.equal(row.npmSource.sourceSHA256,row.sha256);assert.equal(row.npmSource.publicationConfigSHA256,hash(readFileSync(join(f.pkg,'expo-module.config.json'))));assert.equal(row.npmSource.integrity,'sha512-c3ludGhldGlj');assert.equal(row.npmSource.upstream,'https://registry.npmjs.org/example/-/example-1.2.3.tgz');assert.ok(!JSON.stringify(value).includes(f.root));
});
test('arbitrary package archives and publication coordinate/version mismatches are rejected',t=>{
 const f=localMaven(t),selected=f.input.components[0],original=selected.artifacts[0].file;
 writeFileSync(join(f.pkg,'arbitrary.aar'),'synthetic public local AAR');selected.artifacts[0].file=join(f.pkg,'arbitrary.aar');assert.throws(()=>project(f));
 selected.artifacts[0].file=original;selected.group='other.group';assert.throws(()=>project(f));
 selected.group=f.publication.groupId;selected.version='9.9.9';assert.throws(()=>project(f));
});
test('local-Maven artifact, config and package-manifest symlink escapes fail closed',t=>{
 const f=localMaven(t),outside=join(f.root,'outside.fixture'),cacheTarget=join(f.cache,'same-local-artifact.aar');writeFileSync(cacheTarget,'synthetic public local AAR');
 rmSync(f.artifact);symlinkSync(cacheTarget,f.artifact);assert.throws(()=>project(f));
 rmSync(f.artifact);writeFileSync(f.artifact,'synthetic public local AAR');const config=join(f.pkg,'expo-module.config.json');writeFileSync(outside,JSON.stringify({android:{publication:f.publication}}));rmSync(config);symlinkSync(outside,config);assert.throws(()=>project(f));
 rmSync(config);writeFileSync(config,JSON.stringify({android:{publication:f.publication}}));const manifest=join(f.pkg,'package.json');writeFileSync(outside,JSON.stringify({name:'example',version:'1.2.3'}));rmSync(manifest);symlinkSync(outside,manifest);assert.throws(()=>project(f));
});
test('local-Maven source requires a credential-free public locked upstream',t=>{
 const f=localMaven(t),lock=JSON.parse(readFileSync(join(f.root,'package-lock.json')));lock.packages['node_modules/example'].resolved='https://private:secret@registry.npmjs.org/example.tgz';const encoded=JSON.stringify(lock);writeFileSync(join(f.root,'package-lock.json'),encoded);f.discovery.lockSHA256=hash(encoded);assert.throws(()=>project(f));
});

test('closed Android vendor references and native project fingerprints survive projection',t=>{
 const f=fixture(t),component=f.discovery.components[0];component.vendors=['vendor/example'];component.vendorNotices={'vendor/example':[component.notices[0].source]};
 const result=project(f);assert.deepEqual(result.components[0].vendors,component.vendors);assert.deepEqual(result.components[0].vendorNotices,component.vendorNotices);assert.deepEqual(result.nativeProjects[0].sourceTrees,component.nativeInputs);
 assert.equal(result.ndk.runtimeSources.length,4);assert.equal(result.ndk.packagedOriginVerified,false);assert.equal(result.ndk.officialPackage.archiveBytesVerified,false);
 for(const mutate of [value=>value.vendors.push('../private'),value=>value.vendorNotices.other=[],value=>value.vendorNotices['vendor/example'].push('node_modules/example/unknown'),value=>value.nativeInputs['node_modules/example'].extra='not allowed',value=>value.nativeInputs['node_modules/example'].sha256='wrong',value=>value.nativeInputs['node_modules/example'].excludedBuildPaths.push('/private/path')]){
  const saved=structuredClone(component);mutate(component);assert.throws(()=>project(f));f.discovery.components[0]=saved;Object.assign(component,saved);f.discovery.components[0]=component;
 }
});

test('actual pinned archive inspector binds duplicate library basenames to each outer AAR',t=>{
 const f=fixture(t),reader=join(f.root,'notice-archive.py'),readerBytes=execFileSync('git',['show','dba1d8ca454b08aad3e624e262f62b5a97875efe:scripts/notice-archive.py']);
 assert.equal(hash(readerBytes),'44c4a9c19ca7c34fb72d99f50b25a8d71d1fc6a0c89b568fc88c7e7fc257b88e');writeFileSync(reader,readerBytes,{flag:'wx'});
 execFileSync('python3',['-I','-c',String.raw`import pathlib,sys,zipfile
root=pathlib.Path(sys.argv[1])
for name,data in [('first.aar',b'ONE SYNTHETIC LIBRARY'),('second.aar',b'TWO SYNTHETIC LIBRARY')]:
 with zipfile.ZipFile(root/name,'w',compression=zipfile.ZIP_DEFLATED) as z:z.writestr('jni/arm64-v8a/libsame.so',data)
`,f.cache]);
 f.input.components[1].artifacts=['first.aar','second.aar'].map(name=>({file:join(f.cache,name),sha256:hash(readFileSync(join(f.cache,name)))}));
 const inspect=path=>JSON.parse(execFileSync('python3',['-I',reader,path],{encoding:'utf8',stdio:['ignore','pipe','pipe']})),result=project(f,inspect);
 assert.equal(result.nativeMembers.length,2);assert.ok(result.nativeMembers.every(value=>value.memberPath==='jni/arm64-v8a/libsame.so'&&value.declaredABI==='arm64-v8a'));assert.notEqual(result.nativeMembers[0].artifactSHA256,result.nativeMembers[1].artifactSHA256);assert.notEqual(result.nativeMembers[0].sha256,result.nativeMembers[1].sha256);assert.ok(!JSON.stringify(result).includes('SYNTHETIC LIBRARY'));
 assert.throws(()=>project(f,()=>({nativeFiles:[{path:'jni/made-up/libx.so',sha256:'a'.repeat(64)}]})));
 assert.throws(()=>project(f,()=>({nativeFiles:[{path:'../libx.so',sha256:'a'.repeat(64)}]})));
 let inspected=false;f.input.components[1].artifacts[0].file=join(f.pkg,'index.js');assert.throws(()=>project(f,()=>{inspected=true;return {nativeFiles:[]};}));assert.equal(inspected,false);
});

test('Maven non-text notice descriptors remain bound to the exact selected archive',t=>{
 const f=fixture(t),sum=f.input.components[1].artifacts[0].sha256;
 f.discovery.components.push({component:'maven:example.group:module@2.0',name:'example.group:module',version:'2.0',ecosystem:'maven',notices:[],vendors:[],vendorNotices:{},nativeInputs:{noticeArchives:[{archiveSHA256:sum,nonTextNotices:[{kind:'empty-bytes',source:'maven:example.group:module:2.0/public.jar!META-INF/NOTICE',bytes:0,sha256:hash(''),crc32:'00000000'}]}]}});
 assert.deepEqual(project(f).components[1].nativeInputs,f.discovery.components[1].nativeInputs);
 f.discovery.components[1].nativeInputs.noticeArchives[0].archiveSHA256='f'.repeat(64);assert.throws(()=>project(f));
});

test('reviewed own-attribution fields retain owner/source bindings and reject unknown values',t=>{
 const f=fixture(t),item=f.discovery.components[0];
 item.nativeInputs.ownAttribution={kind:'pinned-upstream-own-attribution',ownerNpmID:item.component,packagePath:'node_modules/example',packageJSON:{source:'node_modules/example/package.json',sha256:hash(readFileSync(join(f.pkg,'package.json')))},tarball:'https://registry.npmjs.org/example/-/example-1.2.3.tgz',integrity:'sha512-c3ludGhldGlj',publisherDeclaration:{gitHead:'a'.repeat(40),metadataURL:'https://registry.npmjs.org/example/1.2.3',metadataSHA256:'b'.repeat(64)},selectedSources:[{source:'node_modules/example/index.js',sha256:hash('public synthetic code')}],text:{...item.notices[0],upstream:'https://raw.githubusercontent.com/example/example/'+'a'.repeat(40)+'/LICENSE'}};
 assert.deepEqual(project(f).components[0].nativeInputs.ownAttribution,item.nativeInputs.ownAttribution);
 const original=structuredClone(item.nativeInputs.ownAttribution);
 for(const mutate of [value=>value.unknown='no',value=>value.packageJSON.source='/private/data',value=>value.tarball='https://private:secret@example.invalid/file',value=>value.selectedSources[0].sha256='f'.repeat(64),value=>value.text.source='unknown',value=>value.ownerNpmID='npm:other@1.0']){const value=structuredClone(original);mutate(value);item.nativeInputs.ownAttribution=value;assert.throws(()=>project(f));}
});

test('selected NDK version, private boundaries, regular files and output secrecy are enforced',t=>{
 const f=fixture(t),result=publicNdk(f.sdk,f.ndk);assert.ok(!JSON.stringify(result).includes(f.root)&&!JSON.stringify(result).includes('synthetic public SDK bytes'));
 for(const change of [{...f.ndk,configuredVersion:'27.2.0'},{...f.ndk,project:':other'},{...f.ndk,ndkRoot:f.root},{...f.ndk,unknown:'no'}])assert.throws(()=>publicNdk(f.sdk,change));
 writeFileSync(join(f.ndk.ndkRoot,'source.properties'),'Pkg.Revision = 27.2.0\n');assert.throws(()=>publicNdk(f.sdk,f.ndk));writeFileSync(join(f.ndk.ndkRoot,'source.properties'),'Pkg.Revision = 27.1.12297006\n');
 const notice=join(f.ndk.ndkRoot,'NOTICE'),sentinel=join(f.root,'outside-notice');writeFileSync(sentinel,'synthetic');rmSync(notice);symlinkSync(sentinel,notice);assert.throws(()=>publicNdk(f.sdk,f.ndk));
});

test('actual discovery shell invokes only the two metadata tasks with the Android root',t=>{
 const f=fixture(t),android=join(f.root,'android'),privateRoot=join(f.root,'private');mkdirSync(android);mkdirSync(privateRoot);
 const driver=join(android,'gradlew');writeFileSync(driver,'#!/usr/bin/env python3\nimport json,os,pathlib,sys\npathlib.Path(os.environ["PUPTIME_NOTICE_PRIVATE"],"argv.json").write_text(json.dumps({"cwd":os.getcwd(),"args":sys.argv[1:]}))\n');chmodSync(driver,0o700);
 const workflow=readFileSync(new URL('../.github/workflows/android-apk.yml',import.meta.url),'utf8'),lines=workflow.split('\n').filter(line=>line.includes('if ! (cd android && ./gradlew -I'));
 assert.equal(lines.length,1);execFileSync('bash',['-c','set -euo pipefail\n'+lines[0].trim()+'\nexit 37\nfi\n'],{cwd:f.root,env:{PATH:process.env.PATH,PUPTIME_NOTICE_PRIVATE:privateRoot},stdio:['ignore','pipe','pipe']});
 const invocation=JSON.parse(readFileSync(join(privateRoot,'argv.json'))),expectedRoot=realpathSync(android);
 assert.equal(invocation.cwd,expectedRoot);assert.deepEqual(invocation.args,['-I',privateRoot+'/tools/scripts/notices-runtime.init.gradle','-I','../scripts/android-notice-ndk.init.gradle',':app:writeNoticeRuntimeInputs',':app:writeNoticeNdkInputs','--no-daemon','--no-configuration-cache','--no-build-cache','-PnoticeMainProjectRoot='+expectedRoot,'-PnoticeInputsOutput='+privateRoot+'/runtime-inputs.json']);
});

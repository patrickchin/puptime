import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {publicDiscovery} from './android-notice-discovery.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
function fixture(t){
 const root=mkdtempSync(join(tmpdir(),'puptime-notice-projection-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const pkg=join(root,'node_modules/example'),cache=join(root,'gradle-cache');mkdirSync(pkg,{recursive:true});mkdirSync(cache);
 writeFileSync(join(pkg,'package.json'),JSON.stringify({name:'example',version:'1.2.3'}));writeFileSync(join(pkg,'index.js'),'public synthetic code');writeFileSync(join(pkg,'build.gradle'),'// synthetic native project');
 const lock=JSON.stringify({packages:{'node_modules/example':{version:'1.2.3',integrity:'sha512-c3ludGhldGlj'}}});writeFileSync(join(root,'package-lock.json'),lock);
 writeFileSync(join(cache,'public.jar'),'synthetic public artifact');
 const input={schema:1,configuration:'releaseRuntimeClasspath',components:[{projectBuildFile:join(pkg,'build.gradle')},{group:'example.group',name:'module',version:'2.0',artifacts:[{file:join(cache,'public.jar'),sha256:hash('synthetic public artifact')}]}]};
 const discovery={schema:1,platform:'android',complete:false,sourceCommit:'a'.repeat(40),lockSHA256:hash(lock),components:[{component:'npm:example@1.2.3',name:'example',version:'1.2.3',ecosystem:'npm',notices:[{source:'node_modules/example/LICENSE',sha256:'b'.repeat(64)}]}],sources:[{path:'node_modules/example/index.js',sha256:hash('public synthetic code')}]};
 return {root,pkg,cache,input,discovery};
}
test('actual projection preserves selected identities/digests without private paths or bodies',t=>{
 const f=fixture(t),result=publicDiscovery(f.root,f.cache,f.input,f.discovery),encoded=JSON.stringify(result);
 assert.equal(result.status,'INCOMPLETE');assert.equal(result.complete,false);assert.equal(result.mavenArtifacts[0].component,'maven:example.group:module@2.0');assert.equal(result.nativeProjects[0].sourcePath,'build.gradle');assert.equal(result.metroPackages[0].component,'npm:example@1.2.3');
 assert.ok(!encoded.includes(f.root)&&!encoded.includes('public synthetic code')&&!encoded.includes('synthetic public artifact'));
});
test('changed artifact/lock/source boundary fails closed',t=>{
 const f=fixture(t);
 f.input.components[1].artifacts[0].sha256='f'.repeat(64);assert.throws(()=>publicDiscovery(f.root,f.cache,f.input,f.discovery));
 f.input.components.pop();writeFileSync(join(f.pkg,'package.json'),JSON.stringify({name:'example',version:'9.9.9'}));assert.throws(()=>publicDiscovery(f.root,f.cache,f.input,f.discovery));
});
test('artifact outside Gradle cache and absolute notice source are rejected',t=>{
 const f=fixture(t);f.input.components[1].artifacts[0].file=join(f.pkg,'index.js');assert.throws(()=>publicDiscovery(f.root,f.cache,f.input,f.discovery));
 f.input.components.pop();f.discovery.components[0].notices[0].source='/private/never-output';assert.throws(()=>publicDiscovery(f.root,f.cache,f.input,f.discovery));
});
test('native source symlink escaping installed modules is rejected',t=>{
 const f=fixture(t);writeFileSync(join(f.root,'outside.gradle'),'private synthetic sentinel');symlinkSync(join(f.root,'outside.gradle'),join(f.pkg,'escape.gradle'));
 f.input.components[0].projectBuildFile=join(f.pkg,'escape.gradle');assert.throws(()=>publicDiscovery(f.root,f.cache,f.input,f.discovery));
});

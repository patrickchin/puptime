// Discovery projection only: no signing, compilation, app data or license approval.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,realpathSync,statSync,existsSync,writeFileSync,lstatSync} from 'node:fs';
import {join,dirname,relative,sep,basename} from 'node:path';
import {pathToFileURL} from 'node:url';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const inside=(root,path)=>path===root||path.startsWith(root+sep);
const text=value=>{assert.ok(typeof value==='string'&&value.length>0&&value.length<=512&&!/[\x00-\x1f\\]/.test(value));return value;};
const publicPath=value=>{text(value);assert.ok(!value.startsWith('/')&&!/^[A-Za-z]:/.test(value)&&!value.split('/').includes('..'));return value;};
const digest=value=>{assert.match(value,/^[a-f0-9]{64}$/);return value;};
const bytes=path=>{assert.ok(statSync(path).isFile()&&statSync(path).size<=512*1024*1024);return readFileSync(path);};
export function publicDiscovery(root,cache,input,discovery){
 root=realpathSync(root);cache=realpathSync(cache);const modules=realpathSync(join(root,'node_modules'));
 const lockBytes=bytes(join(root,'package-lock.json')),lock=JSON.parse(lockBytes);
 assert.equal(input.schema,1);assert.equal(input.configuration,'releaseRuntimeClasspath');
 assert.ok(Array.isArray(input.components)&&input.components.length>0&&input.components.length<=2048);
 assert.equal(discovery.schema,1);assert.equal(discovery.platform,'android');assert.equal(discovery.complete,false);
 assert.match(discovery.sourceCommit,/^[a-f0-9]{40}$/);assert.equal(discovery.lockSHA256,sha(lockBytes));
 assert.ok(Array.isArray(discovery.components)&&discovery.components.length<=2048);
 const owner=supplied=>{
  const file=realpathSync(supplied);assert.ok(inside(modules,file));let folder=dirname(file),pkg;
  while(folder!==modules){const candidate=join(folder,'package.json');if(existsSync(candidate)){assert.equal(realpathSync(candidate),candidate);assert.ok(!lstatSync(candidate).isSymbolicLink());pkg=JSON.parse(bytes(candidate));if(pkg.name&&pkg.version)break;}folder=dirname(folder);assert.ok(inside(modules,folder));}
  assert.ok(pkg?.name&&pkg.version&&folder!==modules);const path='node_modules/'+relative(modules,folder).split(sep).join('/'),item=lock.packages[path];
  assert.equal(item?.version,pkg.version);assert.ok(typeof item.integrity==='string'&&item.integrity.startsWith('sha512-'));
  return {component:'npm:'+text(pkg.name)+'@'+text(pkg.version),packagePath:path,packageJSONSHA256:sha(bytes(join(folder,'package.json'))),integrity:text(item.integrity),sourcePath:relative(folder,file).split(sep).join('/')};
 };
 const maven=[],nativeProjects=[];
 for(const item of input.components){
  if(item.projectBuildFile){const source=owner(item.projectBuildFile);nativeProjects.push({...source,sourceSHA256:sha(bytes(realpathSync(item.projectBuildFile)))});continue;}
  const component='maven:'+text(item.group)+':'+text(item.name)+'@'+text(item.version);assert.ok(Array.isArray(item.artifacts)&&item.artifacts.length>0&&item.artifacts.length<=64);
  for(const artifact of item.artifacts){
   assert.ok(!lstatSync(artifact.file).isSymbolicLink());
   const path=realpathSync(artifact.file);let npmSource;
   if(!inside(cache,path)){
    // Expo ships selected prebuilt AARs in a locked package's local Maven repo.
    // Admit only its declared publication; arbitrary workspace/module files fail.
    const source=owner(path),packageRoot=join(modules,source.packagePath.slice('node_modules/'.length)),configPath=join(packageRoot,'expo-module.config.json');
    assert.equal(realpathSync(configPath),configPath);const configBytes=bytes(configPath),publication=JSON.parse(configBytes).android?.publication;
    assert.deepEqual(Object.keys(publication??{}).sort(),['artifactId','groupId','repository','version']);
    assert.equal(publication.repository,'local-maven-repo');assert.equal(publication.groupId,item.group);assert.equal(publication.artifactId,item.name);assert.equal(publication.version,item.version);
    assert.equal(publication.version,lock.packages[source.packagePath].version);
    const expected='local-maven-repo/'+item.group.replaceAll('.','/')+'/'+item.name+'/'+item.version+'/'+item.name+'-'+item.version+'.aar';
    assert.equal(source.sourcePath,expected);assert.equal(realpathSync(join(packageRoot,expected)),path);
    const upstream=new URL(lock.packages[source.packagePath].resolved);assert.equal(upstream.protocol,'https:');assert.equal(upstream.hostname,'registry.npmjs.org');assert.ok(!upstream.username&&!upstream.password&&!upstream.search&&!upstream.hash);
    npmSource={...source,publicationConfigSHA256:sha(configBytes),upstream:upstream.href};
   }
   const sum=sha(bytes(path));assert.equal(sum,digest(artifact.sha256));
   maven.push({component,file:text(basename(path)),sha256:sum,...(npmSource?{npmSource:{...npmSource,sourceSHA256:sum}}:{})});
  }
 }
 const components=discovery.components.map(item=>{
  assert.ok(['npm','maven'].includes(item.ecosystem));return {component:text(item.component),name:text(item.name),version:text(item.version),ecosystem:item.ecosystem,notices:item.notices.map(value=>({source:publicPath(value.source),sha256:digest(value.sha256)}))};
 });
 assert.ok(maven.length<=4096&&nativeProjects.length<=256);
 assert.ok(Array.isArray(discovery.sources)&&discovery.sources.length>0&&discovery.sources.length<=100000);
 const metroPackages=new Map();for(const source of discovery.sources){if(source.path?.startsWith('node_modules/')){const value=owner(join(root,source.path));metroPackages.set(value.packagePath,{component:value.component,packagePath:value.packagePath,packageJSONSHA256:value.packageJSONSHA256,integrity:value.integrity});}}
 return {schema:1,status:'INCOMPLETE',complete:false,discoveryOnly:true,sourceCommit:discovery.sourceCommit,packageLockSHA256:sha(lockBytes),sourceGraphSHA256:sha(JSON.stringify(discovery.sources)),components,mavenArtifacts:maven,nativeProjects,metroPackages:[...metroPackages.values()].sort((a,b)=>a.packagePath.localeCompare(b.packagePath)),scope:'Selected dependency identities, public relative source paths and byte digests only; no app source bodies, runner paths, credentials, APKs or completed rights/release claim.'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  assert.equal(process.argv.length,2);const root=process.cwd(),privateRoot=process.env.PUPTIME_NOTICE_PRIVATE;assert.ok(privateRoot&&process.env.GRADLE_USER_HOME);
  const read=path=>{const data=bytes(path);assert.ok(data.length<=32*1024*1024);return JSON.parse(data);};
  const output=publicDiscovery(root,process.env.GRADLE_USER_HOME,read(join(privateRoot,'runtime-inputs.json')),read('build/notices/android/discovery.json'));
  const encoded=JSON.stringify(output,null,2)+'\n';assert.ok(Buffer.byteLength(encoded)<=8*1024*1024);
  writeFileSync('build/notices/android/review/dependency-inventory.json',encoded,{flag:'wx',mode:0o600});
  console.log('PASS finite Android dependency discovery projection; INCOMPLETE, no release qualification.');
 }catch{console.error('Android dependency discovery projection failed closed; no raw error or private input output.');process.exitCode=1;}
}

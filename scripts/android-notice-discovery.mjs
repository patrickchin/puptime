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
const exact=(value,keys)=>assert.deepEqual(Object.keys(value??{}).sort(),[...keys].sort());
const array=(value,maximum)=>{assert.ok(Array.isArray(value)&&value.length<=maximum);return value;};
const unique=value=>{assert.equal(new Set(value).size,value.length);return value;};
const https=value=>{const url=new URL(text(value));assert.equal(url.protocol,'https:');assert.ok(!url.username&&!url.password&&!url.search&&!url.hash);return url.href;};
const abis={'armeabi-v7a':'arm-linux-androideabi','arm64-v8a':'aarch64-linux-android',x86:'i686-linux-android',x86_64:'x86_64-linux-android'};
function regular(root,source,maximum){
 const path=join(root,publicPath(source));assert.equal(realpathSync(path),path);const info=lstatSync(path);assert.ok(info.isFile()&&!info.isSymbolicLink()&&info.size>0&&info.size<=maximum);
 const body=bytes(path);assert.equal(body.length,info.size);return {source,bytes:body.length,sha256:sha(body)};
}
// Public SDK metadata only. These are candidate input hashes, not proof that
// AGP packaged this runtime or that the installed SDK matches a whole archive.
export function publicNdk(sdk,selected){
 exact(selected,['schema','project','configuredVersion','sdkRoot','ndkRoot']);assert.equal(selected.schema,1);assert.equal(selected.project,':app');
 assert.match(selected.configuredVersion,/^\d{1,2}\.\d{1,2}\.\d{1,10}$/);
 sdk=realpathSync(sdk);assert.equal(realpathSync(selected.sdkRoot),sdk);
 const root=join(sdk,'ndk',selected.configuredVersion);assert.equal(realpathSync(selected.ndkRoot),root);assert.equal(realpathSync(root),root);
 const sourceProperties=regular(root,'source.properties',16384),properties=readFileSync(join(root,sourceProperties.source),'utf8');
 const revision=[...properties.matchAll(/^Pkg\.Revision\s*=\s*(\S+)\s*$/gm)];assert.equal(revision.length,1);assert.equal(revision[0][1],selected.configuredVersion);
 // The Linux producer is pinned to the existing Expo/RN-selected NDK. Do not
 // invent upstream provenance for a different toolchain or host.
 assert.equal(selected.configuredVersion,'27.1.12297006');
 const prebuilt='toolchains/llvm/prebuilt/linux-x86_64';
 const notices=['NOTICE','NOTICE.toolchain',prebuilt+'/NOTICE'].map(source=>regular(root,source,4*1024*1024));
 const runtimeSources=Object.entries(abis).map(([abi,triple])=>({abi,...regular(root,prebuilt+'/sysroot/usr/lib/'+triple+'/libc++_shared.so',32*1024*1024)}));
 return {version:selected.configuredVersion,sourceProperties,notices,runtimeSources,officialPackage:{metadataUpstream:'https://dl.google.com/android/repository/repository2-3.xml',upstream:'https://dl.google.com/android/repository/android-ndk-r27b-linux.zip',bytes:663976775,sha1:'6fc476b2e57d7c01ac0c95817746b927035b9749',archiveBytesVerified:false},packagedOriginVerified:false};
}
function androidMetadata(root,item,maven,projects,owner){
 const notices=array(item.notices,4096).map(value=>({source:publicPath(value.source),sha256:digest(value.sha256)})),sources=new Set(notices.map(value=>value.source));assert.equal(sources.size,notices.length);
 const archiveSource=source=>maven.some(row=>row.component===item.component&&source.startsWith(row.component.replace('@',':')+'/'+row.file+'!')&&publicPath(source.slice(source.indexOf('!')+1)));
 for(const notice of notices){
  if(item.ecosystem==='maven')assert.ok(archiveSource(notice.source));
  else if(notice.source.startsWith('node_modules/')){assert.equal(owner(notice.source).component,item.component);assert.equal(sha(bytes(join(root,notice.source))),notice.sha256);}
  else{assert.match(notice.source,/^assets\/notices\/sources\/[A-Za-z0-9._-]+\.txt$/);assert.equal(regular(root,notice.source,1024*1024).sha256,notice.sha256);}
 }
 const vendors=unique(array(item.vendors??[],4096).map(publicPath));
 const vendorNotices=Object.fromEntries(Object.entries(item.vendorNotices??{}).map(([vendor,refs])=>{assert.ok(vendors.includes(publicPath(vendor)));return [vendor,unique(array(refs,4096).map(source=>{assert.ok(sources.has(publicPath(source)));return source;}))];}));
 const nativeInputs={};
 for(const [key,value] of Object.entries(item.nativeInputs??{})){
  assert.ok(Object.keys(nativeInputs).length<256);
  if(key==='noticeArchives'){
   assert.equal(item.ecosystem,'maven');
   nativeInputs[key]=array(value,64).map(archive=>{exact(archive,['archiveSHA256','nonTextNotices']);assert.ok(maven.some(row=>row.component===item.component&&row.sha256===digest(archive.archiveSHA256)));
    return {archiveSHA256:archive.archiveSHA256,nonTextNotices:array(archive.nonTextNotices,4096).map(note=>{exact(note,['kind','source','bytes','sha256','crc32']);assert.ok(['empty-bytes','empty-json-descriptor'].includes(note.kind));assert.ok(Number.isSafeInteger(note.bytes)&&note.bytes>=0&&note.bytes<=1024*1024);assert.equal(note.bytes===0,note.kind==='empty-bytes');assert.match(note.crc32,/^[a-f0-9]{8}$/);assert.ok(archiveSource(note.source));if(note.bytes===0){assert.equal(note.sha256,sha(''));assert.equal(note.crc32,'00000000');}return {...note,source:publicPath(note.source),sha256:digest(note.sha256)};})};
   });
  }else if(key==='ownAttribution'){
   assert.equal(item.ecosystem,'npm');exact(value,['kind','ownerNpmID','packagePath','packageJSON','tarball','integrity','publisherDeclaration','selectedSources','text']);assert.equal(value.kind,'pinned-upstream-own-attribution');assert.equal(value.ownerNpmID,item.component);
   exact(value.packageJSON,['source','sha256']);const actual=owner(value.packageJSON.source);assert.equal(actual.component,item.component);assert.equal(actual.packagePath,publicPath(value.packagePath));assert.equal(actual.packageJSONSHA256,digest(value.packageJSON.sha256));assert.equal(actual.integrity,text(value.integrity));
   exact(value.publisherDeclaration,['gitHead','metadataURL','metadataSHA256']);assert.match(value.publisherDeclaration.gitHead,/^[a-f0-9]{40}$/);digest(value.publisherDeclaration.metadataSHA256);https(value.publisherDeclaration.metadataURL);
   exact(value.text,['source','sha256','upstream']);assert.ok(sources.has(publicPath(value.text.source)));assert.ok(notices.some(note=>note.source===value.text.source&&note.sha256===digest(value.text.sha256)));https(value.text.upstream);https(value.tarball);
   const selectedSources=array(value.selectedSources,8).map(source=>{exact(source,['source','sha256']);const selected=owner(source.source);assert.equal(selected.packagePath,value.packagePath);assert.equal(sha(bytes(join(root,source.source))),digest(source.sha256));return {...source};});assert.ok(selectedSources.length);
   nativeInputs[key]={...value,packagePath:actual.packagePath,selectedSources};
  }else{
   assert.equal(item.ecosystem,'npm');publicPath(key);assert.ok(key.startsWith('node_modules/'));exact(value,['sha256','files','excludedBuildPaths']);assert.ok(Number.isSafeInteger(value.files)&&value.files>0&&value.files<=100000);
   assert.ok(projects.some(project=>project.component===item.component&&join(project.packagePath,dirname(project.sourcePath)).split(sep).join('/')===key));
   nativeInputs[key]={sha256:digest(value.sha256),files:value.files,excludedBuildPaths:unique(array(value.excludedBuildPaths,256).map(publicPath))};
  }
 }
 return {notices,vendors,vendorNotices,nativeInputs};
}
export function publicDiscovery(root,cache,input,discovery,inspectArchive,ndk){
 root=realpathSync(root);cache=realpathSync(cache);const modules=realpathSync(join(root,'node_modules'));
 const lockBytes=bytes(join(root,'package-lock.json')),lock=JSON.parse(lockBytes);
 assert.equal(input.schema,1);assert.equal(input.configuration,'releaseRuntimeClasspath');
 assert.ok(Array.isArray(input.components)&&input.components.length>0&&input.components.length<=2048);
 assert.equal(discovery.schema,1);assert.equal(discovery.platform,'android');assert.equal(discovery.complete,false);
 assert.match(discovery.sourceCommit,/^[a-f0-9]{40}$/);assert.equal(discovery.lockSHA256,sha(lockBytes));
 assert.ok(Array.isArray(discovery.components)&&discovery.components.length<=2048);
 const owner=supplied=>{
  supplied=join(root,publicPath(supplied));
  const file=realpathSync(supplied);assert.ok(inside(modules,file));let folder=dirname(file),pkg;
  while(folder!==modules){const candidate=join(folder,'package.json');if(existsSync(candidate)){assert.equal(realpathSync(candidate),candidate);assert.ok(!lstatSync(candidate).isSymbolicLink());pkg=JSON.parse(bytes(candidate));if(pkg.name&&pkg.version)break;}folder=dirname(folder);assert.ok(inside(modules,folder));}
  assert.ok(pkg?.name&&pkg.version&&folder!==modules);const path='node_modules/'+relative(modules,folder).split(sep).join('/'),item=lock.packages[path];
  assert.equal(item?.version,pkg.version);assert.ok(typeof item.integrity==='string'&&item.integrity.startsWith('sha512-'));
  return {component:'npm:'+text(pkg.name)+'@'+text(pkg.version),packagePath:path,packageJSONSHA256:sha(bytes(join(folder,'package.json'))),integrity:text(item.integrity),sourcePath:relative(folder,file).split(sep).join('/')};
 };
 assert.equal(typeof inspectArchive,'function');const maven=[],nativeProjects=[],nativeMembers=[];
 for(const item of input.components){
  if(item.projectBuildFile){const source=owner(relative(root,realpathSync(item.projectBuildFile)).split(sep).join('/'));nativeProjects.push({...source,sourceSHA256:sha(bytes(realpathSync(item.projectBuildFile)))});continue;}
  const component='maven:'+text(item.group)+':'+text(item.name)+'@'+text(item.version);assert.ok(Array.isArray(item.artifacts)&&item.artifacts.length>0&&item.artifacts.length<=64);
  for(const artifact of item.artifacts){
   assert.ok(!lstatSync(artifact.file).isSymbolicLink());
   const path=realpathSync(artifact.file);let npmSource;
   if(!inside(cache,path)){
    // Expo ships selected prebuilt AARs in a locked package's local Maven repo.
    // Admit only its declared publication; arbitrary workspace/module files fail.
    const source=owner(relative(root,path).split(sep).join('/')),packageRoot=join(modules,source.packagePath.slice('node_modules/'.length)),configPath=join(packageRoot,'expo-module.config.json');
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
   assert.ok(maven.length<4096);maven.push({component,file:text(basename(path)),sha256:sum,...(npmSource?{npmSource:{...npmSource,sourceSHA256:sum}}:{})});
   for(const member of array(inspectArchive(path).nativeFiles,4096)){
    exact(member,['path','sha256']);const memberPath=publicPath(member.path),match=memberPath.match(/^(?:jni\/([^/]+)\/|prefab\/modules\/[^/]+\/libs\/android\.([^/]+)\/)[^/]+\.so$/),declaredABI=match?.[1]??match?.[2]??null;
    assert.ok(declaredABI===null||Object.hasOwn(abis,declaredABI));assert.ok(nativeMembers.length<16384);nativeMembers.push({component,artifactSHA256:sum,memberPath,declaredABI,sha256:digest(member.sha256)});
   }
  }
 }
 const components=discovery.components.map(item=>{
  assert.ok(['npm','maven'].includes(item.ecosystem));return {component:text(item.component),name:text(item.name),version:text(item.version),ecosystem:item.ecosystem,...androidMetadata(root,item,maven,nativeProjects,owner)};
 });
 for(const project of nativeProjects){const component=components.find(value=>value.component===project.component);assert.ok(component);project.sourceTrees=Object.fromEntries(Object.entries(component.nativeInputs).filter(([source])=>source===project.packagePath||source.startsWith(project.packagePath+'/')));assert.ok(Object.keys(project.sourceTrees).length>0,'Keep actual Gradle source fingerprints, not only build-file hashes.');}
 assert.ok(maven.length<=4096&&nativeProjects.length<=256);
 assert.ok(Array.isArray(discovery.sources)&&discovery.sources.length>0&&discovery.sources.length<=100000);
 const metroPackages=new Map();for(const source of discovery.sources){if(source.path?.startsWith('node_modules/')){const value=owner(source.path);metroPackages.set(value.packagePath,{component:value.component,packagePath:value.packagePath,packageJSONSHA256:value.packageJSONSHA256,integrity:value.integrity});}}
 assert.ok(nativeMembers.length<=16384);unique(nativeMembers.map(value=>JSON.stringify([value.component,value.artifactSHA256,value.memberPath])));assert.ok(ndk&&ndk.packagedOriginVerified===false);
 return {schema:1,status:'INCOMPLETE',complete:false,discoveryOnly:true,sourceCommit:discovery.sourceCommit,packageLockSHA256:sha(lockBytes),sourceGraphSHA256:sha(JSON.stringify(discovery.sources)),components,mavenArtifacts:maven,nativeProjects,nativeMembers,ndk,metroPackages:[...metroPackages.values()].sort((a,b)=>a.packagePath.localeCompare(b.packagePath)),scope:'Selected dependency/source fingerprints, admitted prebuilt native members and NDK input candidates only. Source-built libraries require the final AGP packaging/strip mapping to reviewed source projects; no bit-reproducible-build claim. No app bodies, runner paths, credentials, APKs, packaged-origin or completed rights/release qualification.'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  assert.equal(process.argv.length,2);const root=process.cwd(),privateRoot=process.env.PUPTIME_NOTICE_PRIVATE;assert.ok(privateRoot&&process.env.GRADLE_USER_HOME);
  const read=path=>{const data=bytes(path);assert.ok(data.length<=32*1024*1024);return JSON.parse(data);};
  const helper=join(privateRoot,'tools/scripts/native-notice-inputs.mjs'),archive=join(privateRoot,'tools/scripts/notice-archive.py');
  assert.equal(sha(bytes(helper)),'6eb0faeb67cb5989083987982a975b5913fd51dc6bbd05dc1383546cd2978b92');assert.equal(sha(bytes(archive)),'44c4a9c19ca7c34fb72d99f50b25a8d71d1fc6a0c89b568fc88c7e7fc257b88e');
  const {inspectNoticeArchive}=await import(pathToFileURL(helper));
  const ndk=publicNdk(process.env.ANDROID_HOME,read(join(privateRoot,'ndk-inputs.json')));
  const output=publicDiscovery(root,process.env.GRADLE_USER_HOME,read(join(privateRoot,'runtime-inputs.json')),read('build/notices/android/discovery.json'),inspectNoticeArchive,ndk);
  const encoded=JSON.stringify(output,null,2)+'\n';assert.ok(Buffer.byteLength(encoded)<=8*1024*1024);
  writeFileSync('build/notices/android/review/dependency-inventory.json',encoded,{flag:'wx',mode:0o600});
  console.log('PASS finite Android dependency discovery projection; INCOMPLETE, no release qualification.');
 }catch{console.error('Android dependency discovery projection failed closed; no raw error or private input output.');process.exitCode=1;}
}

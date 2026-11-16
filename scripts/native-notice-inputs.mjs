import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync,readFileSync,readdirSync,realpathSync,lstatSync,statSync,openSync,readSync,fstatSync,closeSync,constants} from 'node:fs';
import {basename,dirname,join,relative,resolve,sep} from 'node:path';
import {createRequire} from 'node:module';
import {digest,nativeNoticeInput,npmNoticeInputs,nativeSourceNotices,noticeText,capturedSource,safeRelative} from './app-notices.mjs';

const require=createRequire(import.meta.url),archiveReader=new URL('./notice-archive.py',import.meta.url);

// Only finite diagnostics escape the CLI catch. Never serialize an Error,
// message, cause, path or unvalidated dependency name into review artifacts.
const operations=new Set(['review-inputs','source-graph','native-inputs','npm-notices','notice-union','reviewed-notices','coverage','pod-lock','pod-lock-entries','pod-acknowledgements','pod-source-scan','pod-notices','source-root','source-provider','source-path','source-boundary','source-bytes','source-npm','gradle-archive-scan']);
const components=new Set(['review','metro','ios','android','npm','cocoapods','maven']);
const contexts=new WeakMap();
const sourceErrorCodes=new Set(['ERR_INVALID_ARG_TYPE','ERR_INVALID_ARG_VALUE','ERR_INVALID_URL','ERR_ASSERTION','ENOENT','ENOTDIR','EISDIR','ELOOP','EACCES','EPERM']);
const assertionCategories=new Map([['Notice must be readable UTF-8.','invalid-utf8'],['Native source link escapes its component.','source-boundary'],['Native source inventory exceeds its bound.','input-bound'],['Too many native source entries.','input-bound'],['Empty or oversized notice.','input-bound'],['Notice inputs exceed the review bound.','input-bound']]);
export function noticeInputStep(operation,component,run,id,source,archiveSHA256){
 assert.ok(operations.has(operation)&&components.has(component));
 const archive=operation==='gradle-archive-scan';assert.ok(archive?component==='maven'&&typeof id==='string'&&id.startsWith('maven:')&&source===undefined&&typeof archiveSHA256==='string'&&/^[a-f0-9]{64}$/.test(archiveSHA256):component!=='maven'&&archiveSHA256===undefined);
 try{return run();}catch(thrown){
  const error=thrown instanceof Error?thrown:new Error('Notice input failed.');
  if(!contexts.has(error)){
   let fields={};try{fields={code:error.code,status:error.status,message:error.message};}catch{}
   const {code,status,message}=fields;
   const category=code==='ENOENT'?'missing-input':['EACCES','EPERM'].includes(code)?'unreadable-input':error instanceof SyntaxError?'invalid-format':code==='ERR_ASSERTION'?(assertionCategories.get(message)??'invalid-input'):Number.isInteger(status)?'subprocess-failed':'unsupported-input';
   contexts.set(error,{operation,component,errorCategory:category,...(id?{componentSHA256:digest(id)}:{}),...(archive?{archiveSHA256}:{}),...(operation.startsWith('source-')?{errorClass:error instanceof TypeError?'TypeError':error instanceof SyntaxError?'SyntaxError':error instanceof ReferenceError?'ReferenceError':error instanceof RangeError?'RangeError':code==='ERR_ASSERTION'?'AssertionError':'Error',errorCode:sourceErrorCodes.has(code)?code:'other',...(typeof source==='string'?{sourceSHA256:digest(source)}:{})}:{})});
  }
  throw error;
 }
}
export function noticeFailureContext(error){const value=contexts.get(error);return value?{...value}:undefined;}
export function inspectNoticeArchive(path,payloadPath,bundlePath){
 return JSON.parse(execFileSync('python3',[archiveReader.pathname,path,...(payloadPath?[payloadPath]:[]),...(bundlePath?[bundlePath]:[])],{encoding:'utf8',maxBuffer:32*1024*1024,timeout:60000,stdio:['ignore','pipe','pipe']}));
}
// Only CocoaPods-selected literal frameworks may cross a Pod sandbox, and
// only into the exact installed package owning its locked external podspec.
export function podLinkedSources(root,name,source,external){
 const list=join(root,'ios/Pods/Target Support Files',safeRelative(name),name+'-xcframeworks-input-files.xcfilelist');
 if(!external?.[':podspec']||!existsSync(list))return {linkedSources:[]};
 const bytes=readFileSync(list),text=noticeText(bytes,1024*1024),prefix='${PODS_ROOT}/'+name+'/',selected=[];
 for(const line of text.split(/\r?\n/).filter(Boolean)){
  if(!line.endsWith('.xcframework'))continue;
  assert.ok(line.startsWith(prefix),'Native source link escapes its component.');
  const item=safeRelative(line.slice(prefix.length));assert.ok(!/[*?{}$]/.test(item),'Native source link escapes its component.');selected.push(item);
 }
 const candidates=[],boundary=realpathSync(source),frameworkInputList={source:safeRelative(relative(root,list)),sha256:digest(bytes)};
 for(const item of new Set(selected)){
  const path=join(source,item);assert.ok(existsSync(path)&&statSync(path).isDirectory(),'Native source link escapes its component.');if(!lstatSync(path).isSymbolicLink())continue;
  const target=realpathSync(path);if(target===boundary||target.startsWith(boundary+sep))continue;candidates.push({source:item,target});
 }
 if(!candidates.length)return {linkedSources:[],frameworkInputList};
 const spec=resolve(root,'ios',external[':podspec']),owner=npmNoticeInputs(root,[spec])[0];assert.ok(owner,'Native source link escapes its component.');
 const modules=realpathSync(join(root,'node_modules')),linkedSources=candidates.map(value=>({source:value.source,target:'node_modules/'+safeRelative(relative(modules,value.target)),packagePath:owner.packagePath,component:owner.id}));
 return {linkedSources,frameworkInputList,externalPodspec:capturedSource(root,spec)};
}

// Only these reviewed Pod/package pairs may use their own package's exact text.
// This never searches parents or supplies a vendored framework's attribution.
function podOwnLicense(root,name,version,source,external){
 const pins=JSON.parse(readFileSync(new URL('./app-notice-provenance.json',import.meta.url))).knownLicenseSources??[];
 const pin=pins.find(value=>value.component===`cocoapods:${name}@${version}`&&value.ownerNpmID);
 if(!pin)return;
 assert.equal(pin.ecosystem,'cocoapods');assert.equal(pin.version,version);assert.ok(['path','podspec'].includes(pin.sourceKind));
 assert.deepEqual(Object.keys(external??{}),[':'+pin.sourceKind],'Require the exact selected Pod source form.');
 const project=realpathSync(root),modules=realpathSync(join(root,'node_modules')),packagePath=safeRelative(pin.packagePath),owner=realpathSync(join(root,packagePath));
 assert.equal('node_modules/'+safeRelative(relative(modules,owner)),packagePath,'Require the exact installed package root.');
 assert.equal(pin.packageJSONSource,packagePath+'/package.json');
 const checked=(logical,expected)=>{safeRelative(logical);const path=realpathSync(join(root,logical));assert.ok(path.startsWith(owner+sep),'Bound licence inputs must stay in their owning package.');const bytes=readFileSync(path);assert.equal(digest(bytes),expected,'Bound licence input bytes changed.');return {path,bytes};};
 const packageJSON=checked(pin.packageJSONSource,pin.packageJSONSHA256),pkg=JSON.parse(noticeText(packageJSON.bytes)),lock=JSON.parse(readFileSync(join(root,'package-lock.json'))).packages?.[packagePath];
 assert.equal(`npm:${pkg.name}@${pkg.version}`,pin.ownerNpmID);assert.equal(lock?.version,pkg.version);assert.equal(lock.resolved,pin.upstream);assert.equal(lock.integrity,pin.upstreamIntegrity);
 const spec=checked(pin.podspecSource,pin.podspecSHA256),selected=realpathSync(source),selector=realpathSync(resolve(root,'ios',external[':'+pin.sourceKind]));
 if(pin.sourceKind==='path'){assert.equal(selected,dirname(spec.path));assert.equal(selector,selected);}
 else{const sandbox=join(project,'ios/Pods',name);assert.equal(selector,spec.path);assert.equal(selected,sandbox);assert.equal(realpathSync(sandbox),sandbox);}
 const license=checked(pin.source,pin.sha256),body=noticeText(license.bytes);
 return {notice:{source:pin.source,sha256:pin.sha256,body},binding:{ownerNpmID:pin.ownerNpmID,packagePath,sourceKind:pin.sourceKind,packageJSON:{source:pin.packageJSONSource,sha256:pin.packageJSONSHA256},podspec:{source:pin.podspecSource,sha256:pin.podspecSHA256},license:{source:pin.source,sha256:pin.sha256},upstream:pin.upstream,upstreamIntegrity:pin.upstreamIntegrity}};
}

// Finite observations alone grant no attribution. Explicit bindings must
// revalidate the actual selected form and owning bytes on every capture.
export function podActualSelectors(root,lock,versions,podLockSHA256){
 assert.match(podLockSHA256,/^[a-f0-9]{64}$/);
 return [['ExpoRouter','57.0.28','expo-router','57.0.28','ios/ExpoRouter.podspec'],['ExpoUI','57.0.25','@expo/ui','57.0.25','ios/ExpoUI.podspec'],['Yoga','0.0.0','react-native','0.86.3','ReactCommon/yoga/Yoga.podspec']].map(([name,version,npm,npmVersion,spec])=>{
  const value=lock['EXTERNAL SOURCES']?.[name],keys=value&&typeof value==='object'&&!Array.isArray(value)?Object.keys(value):[];
  const kind=value===undefined?'missing':keys.length>1?'ambiguous':keys.length===1&&[':path',':podspec'].includes(keys[0])&&typeof value[keys[0]]==='string'?keys[0].slice(1):'other';
  const result={component:`cocoapods:${name}@${version}`,resolvedVersionMatches:versions.get(name)===version,kind,canonicalOwnerMatches:false,selectedRelativePathMatches:false,podLockSHA256,ownerPackageJSONSHA256:null,selectedPodspecSHA256:null};
  try{
   const modules=realpathSync(join(root,'node_modules')),owner=realpathSync(join(root,'node_modules',npm));assert.equal(owner,join(modules,npm));
   const manifest=join(owner,'package.json');assert.equal(realpathSync(manifest),manifest);assert.ok(lstatSync(manifest).isFile()&&!lstatSync(manifest).isSymbolicLink());const bytes=readFileSync(manifest),pkg=JSON.parse(noticeText(bytes));
   assert.equal(pkg.name,npm);assert.equal(pkg.version,npmVersion);result.canonicalOwnerMatches=true;result.ownerPackageJSONSHA256=digest(bytes);
   if(result.resolvedVersionMatches&&['path','podspec'].includes(kind)){
    const expected=join(owner,spec);assert.equal(realpathSync(expected),expected);assert.ok(lstatSync(expected).isFile()&&!lstatSync(expected).isSymbolicLink());
    result.selectedRelativePathMatches=realpathSync(resolve(root,'ios',value[':'+kind]))===(kind==='path'?dirname(expected):expected);
    if(result.selectedRelativePathMatches)result.selectedPodspecSHA256=digest(readFileSync(expected));
   }
  }catch{/* Never emit unknown source paths, lock values, package data or errors. */}
  return result;
 });
}

// Observation only: normal Pod setup supplies the copied pair and options.
// This neither approves the component nor excludes any scanned vendor root.
export function sqlitePodSourceEvidence(root,source,external,podLockSHA256){
 root=realpathSync(root);const modules=realpathSync(join(root,'node_modules')),owner=join(modules,'expo-sqlite');
 assert.equal(realpathSync(owner),owner);assert.deepEqual(Object.keys(external??{}),[':path']);
 assert.equal(realpathSync(source),join(owner,'ios'));assert.equal(realpathSync(resolve(root,'ios',external[':path'])),join(owner,'ios'));
 const pkg=npmNoticeInputs(root,[join(owner,'package.json')])[0],lock=JSON.parse(readFileSync(join(root,'package-lock.json'))).packages?.['node_modules/expo-sqlite'];
 assert.equal(pkg?.id,'npm:expo-sqlite@57.0.5');assert.equal(lock?.resolved,'https://registry.npmjs.org/expo-sqlite/-/expo-sqlite-57.0.5.tgz');
 assert.equal(lock.integrity,'sha512-WYBPXDL0WCMmGSvBgmCXk06yUS4p9GCXUP7CNZBjnb30ZLAuibhsOSzVGDTHcCfs+O/wEC6DNMkNDsw+0xKp7g==');assert.match(podLockSHA256,/^[a-f0-9]{64}$/);
 const inputs=new Map(),files=[];
 for(const logical of ['node_modules/expo-sqlite/package.json','node_modules/expo-sqlite/LICENSE','node_modules/expo-sqlite/ios/ExpoSQLite.podspec','node_modules/expo-sqlite/vendor/sqlite3/sqlite3.c','node_modules/expo-sqlite/vendor/sqlite3/sqlite3.h','node_modules/expo-sqlite/ios/sqlite3.c','node_modules/expo-sqlite/ios/sqlite3.h','ios/Podfile.properties.json']){
  const path=join(root,logical),expected=logical.startsWith('node_modules/')?join(owner,logical.slice('node_modules/expo-sqlite/'.length)):path;
  assert.equal(realpathSync(path),expected);assert.ok(lstatSync(path).isFile()&&!lstatSync(path).isSymbolicLink());
  const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
   const before=fstatSync(fd,{bigint:true}),maximum=/\/sqlite3\.[ch]$/.test(logical)?16*1024*1024:1024*1024;
   assert.ok(before.isFile()&&before.size>0n&&before.size<=BigInt(maximum),'Native source inventory exceeds its bound.');
   const bytes=Buffer.alloc(Number(before.size)+1);let size=0,count;
   while(size<bytes.length&&(count=readSync(fd,bytes,size,bytes.length-size,null)))size+=count;
   assert.equal(size,Number(before.size));const after=fstatSync(fd,{bigint:true}),current=lstatSync(path,{bigint:true});
   for(const key of ['dev','ino','mode','size','mtimeNs','ctimeNs']){assert.equal(after[key],before[key]);assert.equal(current[key],before[key]);}
   assert.equal(realpathSync(path),expected);const body=bytes.subarray(0,size);inputs.set(logical,body);files.push({source:logical,bytes:size,sha256:digest(body)});
  }finally{closeSync(fd);}
 }
 const properties=JSON.parse(noticeText(inputs.get('ios/Podfile.properties.json')));assert.ok(properties&&typeof properties==='object'&&!Array.isArray(properties));
 const enabled=key=>properties['expo.sqlite.'+key]==='true',useSQLCipher=enabled('useSQLCipher'),useLibSQL=enabled('useLibSQL'),withSQLiteVecExtension=enabled('withSQLiteVecExtension');
 const copiedPairMatches=['c','h'].every(ext=>inputs.get('node_modules/expo-sqlite/ios/sqlite3.'+ext).equals(inputs.get('node_modules/expo-sqlite/vendor/sqlite3/sqlite3.'+ext)));
 return {schema:1,scope:'sqlite-pod-source-observation',discoveryOnly:true,component:'cocoapods:ExpoSQLite@57.0.5',ownerNpmID:pkg.id,sourceKind:'path',podLockSHA256,files,options:{useSQLCipher,useLibSQL,withSQLiteVecExtension},copiedPairMatches,compiledSelectionVerified:false,finalArtifactVerified:false};
}

export function podNoticeInputs(root){
 const lockPath=join(root,'ios/Podfile.lock'),support=join(root,'ios/Pods/Target Support Files');
 if(!existsSync(lockPath)||!existsSync(support))return {components:[],unresolved:[{component:'native:ios',reason:'missing-resolved-pod-inputs'}],nativeFiles:[]};
 const [lock,podLockSHA256]=noticeInputStep('pod-lock','cocoapods',()=>{const bytes=readFileSync(lockPath);return [require('yaml').parse(noticeText(bytes,16*1024*1024)),digest(bytes)];}),plist=require('@expo/plist').default,versions=new Map(),texts=new Map(),acknowledgements=[];
 noticeInputStep('pod-lock-entries','cocoapods',()=>{for(const row of lock.PODS??[]){
  const value=typeof row==='string'?row:Object.keys(row)[0],match=value.match(/^([^\s(]+) \(([^\s)]+)/);assert.ok(match,'Unsupported resolved pod entry.');
  const name=match[1].split('/')[0],version=match[2];assert.ok(!versions.has(name)||versions.get(name)===version);versions.set(name,version);
 }
 assert.ok(versions.size,'Missing resolved pods.');});
 noticeInputStep('pod-acknowledgements','cocoapods',()=>{for(const target of readdirSync(support).sort()){
  const path=join(support,target,target+'-acknowledgements.plist');if(!existsSync(path))continue;
  const bytes=readFileSync(path);acknowledgements.push({source:relative(root,path).split(sep).join('/'),sha256:digest(bytes)});
  for(const row of plist.parse(noticeText(bytes,16*1024*1024)).PreferenceSpecifiers??[]){
   if(!versions.has(row.Title)||typeof row.FooterText!=='string')continue;
   const list=texts.get(row.Title)??[],body=row.FooterText;
   if(!list.some(value=>value.sha256===digest(body)))list.push({source:`cocoapods:${target}/${row.Title}`,body,sha256:digest(body)});
   texts.set(row.Title,list);
  }
 }
 });
 const actualSelectors=podActualSelectors(root,lock,versions,podLockSHA256);
 const unresolved=[],components=[];
 for(const [name,version] of versions){
  const notices=texts.get(name)??[],external=lock['EXTERNAL SOURCES']?.[name];let scan={vendors:[],vendorNotices:{},nativeInputs:{},notices:[]};
  const source=external?.[':path']?resolve(root,'ios',external[':path']):join(root,'ios/Pods',name);
  if(!existsSync(source))unresolved.push({component:`cocoapods:${name}@${version}`,reason:'missing-resolved-pod-source'});
  else scan=noticeInputStep('pod-source-scan','cocoapods',()=>{
   const own=podOwnLicense(root,name,version,source,external),{linkedSources,...metadata}=podLinkedSources(root,name,source,external),value=nativeSourceNotices(root,source,`cocoapods:${name}`,{linkedSources});
   if(own)value.notices.push(own.notice);
   const actualSelector=actualSelectors.find(row=>row.component===`cocoapods:${name}@${version}`);
   Object.assign(value.nativeInputs[`cocoapods:${name}`],metadata,...(own?[{ownLicense:own.binding}]:[]),...(actualSelector?[{actualSelector}]:[]),...(name==='ExpoSQLite'&&version==='57.0.5'?[{sqliteSourceEvidence:sqlitePodSourceEvidence(root,source,external,podLockSHA256)}]:[]));return value;
  },`cocoapods:${name}@${version}`);
  components.push(noticeInputStep('pod-notices','cocoapods',()=>nativeNoticeInput({id:`cocoapods:${name}@${version}`,name,version,ecosystem:'cocoapods',...scan,notices:[...notices,...scan.notices].sort((a,b)=>a.source.localeCompare(b.source))}),`cocoapods:${name}@${version}`));
 }
 return {components,unresolved,nativeFiles:[],actualSelectors,inputHashes:{podLock:podLockSHA256,podAcknowledgements:digest(JSON.stringify(acknowledgements))}};
}
export function gradleNoticeInputs(root,inputFile){
 if(!inputFile||!existsSync(inputFile))return {components:[],unresolved:[{component:'native:android',reason:'missing-resolved-gradle-inputs'}],nativeFiles:[]};
 const input=JSON.parse(readFileSync(inputFile));assert.equal(input.schema,1);assert.equal(input.configuration,'releaseRuntimeClasspath');assert.ok(input.components.length);
 const components=[],nativeFiles=[];
 for(const value of input.components){
  if(value.projectBuildFile){
   const pkg=npmNoticeInputs(root,[value.projectBuildFile])[0];assert.ok(pkg,'Native Gradle project must have its own installed package.');
   const prefix='node_modules/'+relative(realpathSync(join(root,'node_modules')),realpathSync(dirname(value.projectBuildFile))).split(sep).join('/');assert.ok(prefix===pkg.packagePath||prefix.startsWith(pkg.packagePath+'/'));
   const scope=prefix===pkg.packagePath?'':prefix.slice(pkg.packagePath.length+1),scan=nativeSourceNotices(root,dirname(value.projectBuildFile),prefix,{excluded:[value.projectBuildDirectory,value.projectCmakeStagingDirectory].filter(Boolean)});
   const scoped=key=>scope?scope+'/'+key:key;
   scan.vendors=scan.vendors.map(scoped);scan.vendorNotices=Object.fromEntries(Object.entries(scan.vendorNotices).map(([key,sources])=>[scoped(key),sources]));
   components.push(...unionNoticeInputs([pkg],[{...pkg,...scan}]));continue;
  }
  assert.ok(value.group&&value.name&&value.version&&value.artifacts.length);const notices=[],vendors=[],noticeArchives=[];
  for(const artifact of value.artifacts){
   const bytes=readFileSync(artifact.file);assert.equal(digest(bytes),artifact.sha256,'Resolved artifact changed.');
   const inspected=noticeInputStep('gradle-archive-scan','maven',()=>inspectNoticeArchive(artifact.file),`maven:${value.group}:${value.name}@${value.version}`,undefined,artifact.sha256),prefix='maven:'+value.group+':'+value.name+':'+value.version+'/'+basename(artifact.file)+'!';
   notices.push(...inspected.notices.map(item=>({...item,source:prefix+item.source})));
   if(inspected.nonTextNotices.length)noticeArchives.push({archiveSHA256:artifact.sha256,nonTextNotices:inspected.nonTextNotices.map(item=>({...item,source:prefix+item.source}))});
   nativeFiles.push(...inspected.nativeFiles.map(item=>({...item,component:`maven:${value.group}:${value.name}@${value.version}`})));
   for(const item of [...inspected.notices,...inspected.nonTextNotices])if(/(^|\/)(vendor|third[-_]?party)(\/|$)/i.test(item.source))vendors.push(item.source);
  }
  components.push(nativeNoticeInput({id:`maven:${value.group}:${value.name}@${value.version}`,name:value.group+':'+value.name,version:value.version,ecosystem:'maven',notices,vendors,nativeInputs:noticeArchives.length?{noticeArchives:noticeArchives.sort((a,b)=>a.archiveSHA256.localeCompare(b.archiveSHA256)||a.nonTextNotices[0].source.localeCompare(b.nonTextNotices[0].source))}:{}}));
 }
 return {components,nativeFiles,unresolved:[],inputHashes:{gradle:digest(readFileSync(inputFile))}};
}
export function unionNoticeInputs(...groups){
 const merged=new Map();
 for(const item of groups.flat()){
  const previous=merged.get(item.id);
  if(!previous){merged.set(item.id,item);continue;}
  const notices=new Map(previous.notices.map(value=>[value.source,value]));
  for(const value of item.notices){const before=notices.get(value.source);assert.ok(!before||before.sha256===value.sha256,'One source has conflicting notice bytes.');notices.set(value.source,value);}
  const nativeInputs={...previous.nativeInputs};for(const [key,value] of Object.entries(item.nativeInputs??{})){assert.ok(!nativeInputs[key]||JSON.stringify(nativeInputs[key])===JSON.stringify(value),'Native source input changed within one capture.');nativeInputs[key]=value;}
  const vendorNotices={...previous.vendorNotices};for(const [key,value] of Object.entries(item.vendorNotices??{}))vendorNotices[key]=[...new Set([...(vendorNotices[key]??[]),...value])].sort();
  merged.set(item.id,{...previous,nativeInputs,vendorNotices,vendors:[...new Set([...previous.vendors,...item.vendors])].sort(),notices:[...notices.values()].sort((a,b)=>a.source.localeCompare(b.source))});
 }
 return [...merged.values()].sort((a,b)=>a.id.localeCompare(b.id));
}

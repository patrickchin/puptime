// Build-time notice evidence. Importing never starts Metro, a device or a build.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {closeSync,existsSync,openSync,readFileSync,readSync,readdirSync,realpathSync,statSync} from 'node:fs';
import {dirname,isAbsolute,join,relative,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';

export const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
function fileDigest(path){const hash=createHash('sha256'),file=openSync(path,'r'),buffer=Buffer.alloc(1024*1024);try{let size;while((size=readSync(file,buffer,0,buffer.length,null)))hash.update(buffer.subarray(0,size));return hash.digest('hex');}finally{closeSync(file);}}
const inside=(root,path)=>path===root||path.startsWith(root+sep);
const noticeName=/^(licen[cs]es?|notices?|copying|copyright|third[._-]?party[._-]?(?:licen[cs]es?|notices?))([._-].*)?$/i;
const vendorName=/^(vendor|vendored|third[-_]?party)$/i;
const maximumTextBytes=1024*1024;
export function safeRelative(value){
 assert.equal(typeof value,'string');assert.ok(value&&!isAbsolute(value)&&!/^\w:[\\/]/.test(value)&&!value.split(/[\\/]/).includes('..'));
 return value.replaceAll('\\','/');
}
export function noticeText(bytes,maximum=maximumTextBytes){
 assert.ok(bytes.length>0&&bytes.length<=maximum,'Empty or oversized notice.');
 const text=bytes.toString('utf8');assert.ok(text.trim()&&!text.includes('\0')&&Buffer.from(text).equals(bytes),'Notice must be readable UTF-8.');return text;
}
function candidate(root,path,label){
 const bytes=readFileSync(path);noticeText(bytes);return {source:label??safeRelative(relative(root,path)),sha256:digest(bytes),body:bytes.toString('utf8')};
}
function nearbyNotices(boundary,start,prefix){
 const result=new Map();
 for(let folder=start;inside(boundary,folder);folder=dirname(folder)){
  for(const name of readdirSync(folder).filter(name=>noticeName.test(name))){
   const path=join(folder,name);assert.ok(inside(boundary,realpathSync(path)),'Notice link escapes its component.');
   const files=statSync(path).isFile()?[path]:readdirSync(path,{recursive:true,withFileTypes:true}).filter(value=>value.isFile()).map(value=>join(value.parentPath??value.path,value.name));assert.ok(files.length<=10000);
   for(const file of files){assert.ok(inside(boundary,realpathSync(file)));result.set(file,candidate(boundary,file,prefix+'/'+safeRelative(relative(boundary,file))));}
  }
  if(folder===boundary)break;
 }
 return [...result.values()];
}

// Shared native-source boundary walk. Generated Gradle output is excluded only
// through the actual project build-directory metadata, never a vendor wildcard.
export function nativeSourceNotices(root,supplied,prefix,{excluded=[]}={}){
 const boundary=realpathSync(supplied),project=realpathSync(root),modules=existsSync(join(root,'node_modules'))?realpathSync(join(root,'node_modules')):null;
 assert.ok((modules&&inside(modules,boundary))||boundary.startsWith(join(project,'ios/Pods')+sep)||boundary.startsWith(join(project,'modules')+sep),'Native source must be an identified package/Pod/local module, not arbitrary project data.');
 const canonicalFuture=path=>{path=resolve(path);let ancestor=path;while(!existsSync(ancestor))ancestor=dirname(ancestor);return resolve(realpathSync(ancestor),relative(ancestor,path));};
 const omitted=new Set(excluded.map(canonicalFuture)),files=[],notices=[],vendors=new Set(),visited=new Set();let count=0,total=0;
 function walk(folder,logical=''){
  const canonical=realpathSync(folder);assert.ok(inside(boundary,canonical),'Native source link escapes its component.');
  if(visited.has(canonical))return;visited.add(canonical);
  for(const entry of readdirSync(folder,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
   assert.ok(++count<=100000,'Too many native source entries.');
   const path=join(folder,entry.name),name=logical?logical+'/'+entry.name:entry.name;
   if(entry.name==='.git'||omitted.has(resolve(path)))continue;
   const actual=realpathSync(path);assert.ok(inside(boundary,actual),'Native source link escapes its component.');const info=statSync(path);
   if(vendorName.test(entry.name)||(info.isDirectory()&&vendorName.test(logical.split('/').at(-1)??''))||/\.(?:xcframework|framework|a|so|jar|aar)$/.test(entry.name))vendors.add(name);
   if(info.isDirectory()){walk(path,name);continue;}
   assert.ok(info.isFile()&&info.size<=512*1024*1024&&(total+=info.size)<=2*1024*1024*1024,'Native source inventory exceeds its bound.');
   files.push({path:name,sha256:fileDigest(path)});
   if(name.split('/').some(part=>noticeName.test(part)))notices.push(candidate(boundary,path,prefix+'/'+name));
  }
 }
 walk(boundary);
 const vendorNotices=Object.fromEntries([...vendors].sort().map(value=>[value,notices.filter(item=>item.source.startsWith(prefix+'/'+value+'/')).map(item=>item.source)]));
 return {notices,vendors:[...vendors].sort(),vendorNotices,nativeInputs:{[prefix]:{sha256:digest(JSON.stringify(files)),files:files.length,excludedBuildPaths:[...omitted].filter(path=>inside(boundary,path)).map(path=>safeRelative(relative(boundary,path))).sort()}}};
}

// Use the actual Metro-selected files, not all installed/declared dependencies.
// Nested packages never inherit another package's license or review decision.
export function npmNoticeInputs(root,modulePaths){
 const modules=realpathSync(join(root,'node_modules')),project=realpathSync(root),lock=JSON.parse(readFileSync(join(root,'package-lock.json'))),components=new Map();
 for(const supplied of modulePaths){
  const path=realpathSync(supplied);
  if(inside(project,path)&&!inside(modules,path))continue;
  assert.ok(inside(modules,path),'Metro source outside the project and installed modules.');
  let folder=dirname(path),pkg;
  while(inside(modules,folder)){
   if(existsSync(join(folder,'package.json'))){const value=JSON.parse(readFileSync(join(folder,'package.json')));if(value.name&&value.version){pkg=value;break;}}
   folder=dirname(folder);
  }
  assert.ok(folder!==modules&&inside(modules,folder),'Selected module has no owning package.');
  const lockPath='node_modules/'+safeRelative(relative(modules,folder));
  assert.ok(pkg.name&&pkg.version&&lock.packages[lockPath]?.version===pkg.version,'Selected package differs from package-lock.');
  const id=`npm:${pkg.name}@${pkg.version}`,item=components.get(id)??{id,name:pkg.name,version:pkg.version,ecosystem:'npm',packagePath:lockPath,notices:[],vendors:[],vendorNotices:{}};
  const moduleRelative=safeRelative(relative(folder,path)),parts=moduleRelative.split('/');
  for(let i=0;i<parts.length-1;i++)if(vendorName.test(parts[i]))item.vendors.push(parts.slice(0,Math.min(i+2,parts.length-1)).join('/'));
  item.notices.push(...nearbyNotices(folder,dirname(path),lockPath));
  for(const vendor of item.vendors)item.vendorNotices[vendor]=[...new Set([...(item.vendorNotices[vendor]??[]),...item.notices.filter(value=>value.source.startsWith(lockPath+'/'+vendor+'/')).map(value=>value.source)])].sort();
  components.set(id,item);
 }
 return [...components.values()].map(item=>{
  const notices=[...new Map(item.notices.map(value=>[value.source,value])).values()].sort((a,b)=>a.source.localeCompare(b.source)),vendors=[...new Set(item.vendors)].sort();
  return {...item,vendors,notices};
 }).sort((a,b)=>a.id.localeCompare(b.id));
}

// Native adapters must supply actual resolved coordinates and actual text,
// never a POM SPDX label or an assumed parent package's permission notice.
export function nativeNoticeInput({id,name,version,ecosystem,notices,vendors=[],vendorNotices={},nativeInputs={}}){
 assert.ok(['cocoapods','maven','native'].includes(ecosystem)&&id&&name&&version);
 assert.ok(Array.isArray(notices)&&Array.isArray(vendors));
 return {id,name,version,ecosystem,vendors,vendorNotices,nativeInputs,notices:notices.map(value=>{
  assert.ok(value.source&&!isAbsolute(value.source)&&!value.source.includes('..'));
  const body=noticeText(Buffer.from(value.body));assert.equal(digest(body),value.sha256);return {...value,body};
 })};
}

const qualificationKey=(platform,component)=>platform+':'+component;
function qualifications(ledger){
 assert.equal(ledger.schema,1);assert.ok(Array.isArray(ledger.components));const result=new Map();
 for(const value of ledger.components){assert.ok(['ios','android'].includes(value.platform)&&typeof value.component==='string'&&value.component);const key=qualificationKey(value.platform,value.component);assert.ok(!result.has(key),'Duplicate platform/component review.');result.set(key,value);}
 return result;
}
export function resolveNoticeCoverage(components,ledger,platform='ios'){
 assert.ok(['ios','android'].includes(platform));const approvedRecords=qualifications(ledger),unresolved=[],sections=[],seen=new Set(),records=[];
 for(const item of components){
  assert.ok(!seen.has(item.id),'Duplicate resolved component.');seen.add(item.id);
  const approved=approvedRecords.get(qualificationKey(platform,item.id));
  const record={component:item.id,name:item.name,version:item.version,ecosystem:item.ecosystem,vendors:item.vendors,vendorNotices:item.vendorNotices??{},nativeInputs:item.nativeInputs??{},notices:item.notices.map(({source,sha256})=>({source,sha256}))};records.push(record);
  const reject=reason=>unresolved.push({component:item.id,reason});
  if(!item.notices.length){reject('missing-notice-text');continue;}
  if(!approved){reject('unreviewed-component');continue;}
  if(!Array.isArray(approved.reviewedVendors)||item.vendors.some(value=>!approved.reviewedVendors.includes(value))){reject('unreviewed-vendored-source');continue;}
  if(item.vendors.some(value=>!(item.vendorNotices?.[value]?.length||approved.vendorNoticeSources?.[value]?.some(source=>item.notices.some(notice=>notice.source===source))))){reject('missing-vendored-notice');continue;}
  if(!isDeepStrictEqual(item.nativeInputs??{},approved.nativeInputs??{})){reject('native-source-digest-mismatch');continue;}
  const actual=item.notices.map(({source,sha256})=>({source,sha256})).sort((a,b)=>a.source.localeCompare(b.source));
  const expected=[...(approved.notices??[])].sort((a,b)=>a.source.localeCompare(b.source));
  if(JSON.stringify(actual)!==JSON.stringify(expected)){reject('notice-set-or-digest-mismatch');continue;}
  assert.ok(typeof approved.upstream==='string'&&approved.upstream.startsWith('https://'),'Review needs a pinned upstream reference.');
  const sectionId='library-'+digest(qualificationKey(platform,item.id)).slice(0,24);
  record.sectionId=sectionId;
  sections.push({id:sectionId,title:`${item.name} ${item.version}`,body:[...item.notices].sort((a,b)=>a.source.localeCompare(b.source)).map(value=>value.body).join('\n\n'),[platform==='android'?'androidOnly':'iosOnly']:true});
 }
 return {status:unresolved.length?'INCOMPLETE':'READY',components:records,unresolved,sections};
}
// Strict sealing verifies a committed platform union; it never rewrites it.
export function assertSourceNoticePayload(payload,coverage,ledger,fontProvenance){
 assert.equal(coverage.status,'READY');assert.equal(coverage.unresolved.length,0);assert.ok(coverage.components.length);
 const sections=JSON.parse(noticeText(payload,16*maximumTextBytes));assert.ok(Array.isArray(sections));assert.equal(new Set(sections.map(value=>value.id)).size,sections.length);
 for(const value of sections)assert.ok(typeof value.id==='string'&&typeof value.title==='string'&&typeof value.body==='string'&&Object.keys(value).every(key=>['id','title','body','androidOnly','iosOnly'].includes(key)),'Unexpected notice section fields.');
 const fonts=fontProvenance.notices;
 for(const [id,expected] of Object.entries(fonts)){const value=sections.find(value=>value.id===id);assert.ok(value);assert.equal(digest(value.body),expected);assertSectionPlatforms(value,fontProvenance.platforms[id]);}
 for(const value of coverage.sections)assert.deepEqual(sections.find(section=>section.id===value.id),value,'Actual included library differs from the committed union.');
 const known=new Map([...qualifications(ledger)].map(([key,value])=>['library-'+digest(key).slice(0,24),value]));
 for(const [id] of known)assert.ok(sections.some(value=>value.id===id),'The committed union is missing a reviewed platform section.');
 for(const section of sections){
  if(Object.hasOwn(fonts,section.id))continue;
  const approved=known.get(section.id);assert.ok(approved,'Unreviewed source notice section.');assert.equal(digest(section.body),approved.sectionSHA256,'Union text must match its reviewed provenance.');
  assertSectionPlatforms(section,[approved.platform]);
 }
 return sections;
}
export function assertSectionPlatforms(section,platforms){
 assert.ok(Array.isArray(platforms)&&platforms.length);const only=platforms.length===1?platforms[0]:null;
 assert.deepEqual({androidOnly:section.androidOnly,iosOnly:section.iosOnly},{androidOnly:only==='android'?true:undefined,iosOnly:only==='ios'?true:undefined},'Notice platform visibility changed.');
}

// Explicit reviewed upstream copies can supply text absent from a published
// AAR/JAR. They supplement, never replace, the artifact's discovered NOTICEs.
export function addReviewedNoticeFiles(root,components,ledger,platform){
 const reviewed=qualifications(ledger);
 return components.map(item=>({...item,notices:[...item.notices,...(reviewed.get(qualificationKey(platform,item.id))?.additionalNoticeFiles??[]).map(value=>{
  safeRelative(value.file);assert.ok(value.file.startsWith('assets/notices/sources/')&&value.upstream?.startsWith('https://'));
  const source=candidate(root,join(root,value.file));assert.equal(source.sha256,value.sha256);return source;
 })].sort((a,b)=>a.source.localeCompare(b.source))}));
}

const codeSource=path=>/\.(?:[cm]?js|jsx|tsx?|json)$/.test(path);
const expoGeneratedSources=new Set(['\0polyfill:external-require','\0polyfill:environment-variables','\0polyfill:assets-registry']);
const generatedProviders=new Map([['__prelude__','node_modules/metro/src/lib/getPreludeCode.js'],...[...expoGeneratedSources].map(id=>[id,'node_modules/expo/node_modules/@expo/cli/build/src/start/server/metro/withMetroMultiPlatform.js'])]);
export function capturedSource(root,supplied,ledger={generatedSources:{}},step=(_operation,run)=>run()){
 root=step('source-root',()=>realpathSync(root));const modules=step('source-root',()=>realpathSync(join(root,'node_modules')));
 if(Object.hasOwn(ledger.generatedSources??{},supplied))return step('source-provider',()=>{
  const value=ledger.generatedSources[supplied],expected=generatedProviders.get(supplied);assert.ok(expected,'Unknown virtual provider.');assert.equal(value.provider,expected);
  const provider=realpathSync(join(root,value.provider));assert.ok(inside(modules,provider));assert.equal(digest(readFileSync(provider)),value.sha256);
  const owner=npmNoticeInputs(root,[provider])[0];
  if(expoGeneratedSources.has(supplied)){assert.equal(owner.name,'@expo/cli');assert.equal(owner.packagePath,'node_modules/expo/node_modules/@expo/cli');assert.equal(owner.id,value.component,'Virtual provider owner/version changed.');}
  return {path:supplied,generated:true,provider:value.provider,sha256:value.sha256,component:owner.id};
 });
 const path=step('source-path',()=>{
  assert.ok(!/^[a-z]+:\/\//i.test(supplied)||supplied.startsWith('file://'),'Remote source-map paths are unsupported.');
  return realpathSync(supplied.startsWith('file://')?fileURLToPath(supplied):resolve(root,supplied));
 });
 const installed=inside(modules,path),name=step('source-boundary',()=>{
  assert.ok(installed||inside(root,path),'App source resolved from another checkout.');
  return installed?'node_modules/'+safeRelative(relative(modules,path)):safeRelative(relative(root,path));
 });
 const sha256=step('source-bytes',()=>digest(readFileSync(path)));
 return {path:name,sha256,code:codeSource(name),...(installed?{component:step('source-npm',()=>npmNoticeInputs(root,[path])[0].id)}:{app:true})};
}
export function assertCapturedSources(root,sources,readCommitted){
 assert.ok(sources.length);assert.equal(new Set(sources.map(value=>value.path)).size,sources.length);
 for(const value of sources){
  if(value.generated)continue;
  const bytes=readFileSync(join(root,value.path));assert.equal(digest(bytes),value.sha256,'Captured input changed.');
  if(value.app)assert.ok(bytes.equals(readCommitted(value.path)),'App graph does not equal its committed source.');
 }
}
export function assertFinalSourceMap(root,map,sources,ledger){
 const expected=new Map(sources.map(value=>[value.path,value])),observed=new Set();
 function check(value){
  assert.equal(value.version,3);assert.ok(!value.sourceRoot,'Use a map rooted at the canonical project.');
  if(value.sections){for(const section of value.sections){assert.ok(section.map&&!section.url);check(section.map);}return;}
  assert.ok(Array.isArray(value.sources)&&Array.isArray(value.sourcesContent)&&value.sources.length===value.sourcesContent.length);
  for(let i=0;i<value.sources.length;i++){
   const source=capturedSource(root,value.sources[i],ledger),before=expected.get(source.path);
   assert.ok(before,'Final map contains an uncaptured input.');assert.deepEqual(source,before,'Final map input changed.');observed.add(source.path);
   // Metro explicitly emits empty sourcesContent for assets, not for JS/JSON.
   if(!source.generated&&source.code)assert.equal(digest(Buffer.from(value.sourcesContent[i]??'')),source.sha256,'Final map embeds stale source contents.');
  }
 }
 check(map);
 for(const source of sources)if(source.code)assert.ok(observed.has(source.path),'Captured code is absent from the final map.');
 return {sources:observed.size,appSources:sources.filter(value=>value.app&&observed.has(value.path)).length,components:[...new Set([...observed].map(path=>expected.get(path).component).filter(Boolean))].sort()};
}

export function assertPackagedNativeCoverage(platform,files,resolvedNative,coverage,ledger){
 const covered=new Set(coverage.components.map(value=>value.component));
 return files.map(file=>{
  const path=safeRelative(file.path),matches=resolvedNative.filter(input=>{
   // APK/AAB stripping can alter bytes. Bind exact ABI/library names to the
   // verified source artifact; record final bytes separately, never equate them.
   const source=input.path.match(/(?:^|!)jni\/(.+\.so)$/)?.[1];
   return platform==='android'&&source&&(path==='lib/'+source||path==='base/lib/'+source);
  });
  const approved=ledger.packagedNative?.[platform]?.[path];
  const components=[...new Set(matches.map(value=>value.component))];
  if(approved){assert.ok(approved.review?.startsWith('https://'));components.push(...approved.components);}
  assert.ok(components.length&&components.every(id=>covered.has(id)),'Unmapped packaged native input.');
  return {path,sha256:file.sha256,components:[...new Set(components)].sort(),basis:matches.length?'resolved-artifact-abi-name':'reviewed-path-to-resolved-inputs'};
 });
}
export function publicNoticeReport({platform,sourceCommit,entry,lockSHA256,coverage,payload}){
 assert.ok(['ios','android'].includes(platform));assert.match(sourceCommit,/^[a-f0-9]{40}$/);safeRelative(entry);
 if(payload)assert.equal(coverage.status,'READY');
 return {schema:1,platform,sourceCommit,entry,lockSHA256,scope:payload?'precompile-input-verification':'resolved-input-discovery',status:payload?'READY':'INCOMPLETE',complete:Boolean(payload),components:coverage.components,unresolved:coverage.unresolved,...(payload?{payloadSHA256:digest(payload)}:{discoveryOnly:true})};
}
// Separate review input, never the view's JSON shape or a completed coverage
// claim. Only explicitly pinned public upstream files may include body text.
export function unreviewedOSSNoticeInputs(components,ledger){
 const approved=(ledger.knownLicenseSources??[]).filter(value=>value.public===true&&value.upstream?.startsWith('https://'));
 const result=[],unresolved=[];let bytes=0,count=0;
 for(const item of components){
  const notices=[];
  for(const value of item.notices){
   const pin=approved.find(pin=>item.id===pin.component&&item.ecosystem===pin.ecosystem&&item.version===pin.version&&value.source===pin.source&&value.sha256===pin.sha256);
   if(pin&&count<256&&bytes+Buffer.byteLength(value.body)<=4*1024*1024){
    safeRelative(value.source);assert.equal(digest(noticeText(Buffer.from(value.body))),value.sha256);
    notices.push({source:value.source,sha256:value.sha256,body:value.body});bytes+=Buffer.byteLength(value.body);count++;
   }else unresolved.push({componentSHA256:digest(item.id),sourceSHA256:digest(value.source),sha256:value.sha256,reason:pin?'review-artifact-limit':'public-origin-unconfirmed'});
  }
  if(!item.notices.length)unresolved.push({componentSHA256:digest(item.id),reason:'missing-notice-text'});
  if(notices.length)result.push({component:item.id,version:item.version,ecosystem:item.ecosystem,notices});
 }
 assert.ok(unresolved.length<=16384,'Review-input artifact exceeds its bound.');
 return {schema:1,status:'INCOMPLETE',complete:false,discoveryOnly:true,components:result,unresolved};
}
export function assertFinalNoticeEvidence({manifest,payload,observedComponents,resolvedBuildOnly,resources,retainedResources={}}){
 assert.equal(manifest.status,'READY');assert.equal(manifest.complete,true);assert.deepEqual(manifest.unresolved,[]);
 assert.equal(digest(payload),manifest.payloadSHA256,'Final packaged payload differs from captured source.');
 const data=JSON.parse(noticeText(payload,16*maximumTextBytes));assert.ok(Array.isArray(data));
 for(const component of manifest.components){const section=data.find(value=>value.id===component.sectionId);assert.ok(section?.body,'A resolved library has no readable notice section.');}
 assert.deepEqual([...new Set([...observedComponents,...resolvedBuildOnly.map(value=>value.component)])].sort(),manifest.components.map(value=>value.component).sort(),'Final evidence does not account for captured coverage.');
 for(const [name,expected] of Object.entries(retainedResources))assert.equal(resources[name],expected,'An existing shipped native notice was removed or changed.');
}

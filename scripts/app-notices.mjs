// Build-time notice evidence. Importing never starts Metro, a device or a build.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync,readFileSync,readdirSync,realpathSync,statSync} from 'node:fs';
import {dirname,isAbsolute,join,relative,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';

export const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
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
  const id=`npm:${pkg.name}@${pkg.version}`,item=components.get(id)??{id,name:pkg.name,version:pkg.version,ecosystem:'npm',notices:[],vendors:[]};
  const moduleRelative=safeRelative(relative(folder,path)),parts=moduleRelative.split('/');
  for(let i=0;i<parts.length-1;i++)if(vendorName.test(parts[i]))item.vendors.push(parts.slice(0,Math.min(i+2,parts.length-1)).join('/'));
  item.notices.push(...nearbyNotices(folder,dirname(path),lockPath));
  components.set(id,item);
 }
 return [...components.values()].map(item=>({...item,vendors:[...new Set(item.vendors)].sort(),notices:[...new Map(item.notices.map(value=>[value.source,value])).values()].sort((a,b)=>a.source.localeCompare(b.source))})).sort((a,b)=>a.id.localeCompare(b.id));
}

// Native adapters must supply actual resolved coordinates and actual text,
// never a POM SPDX label or an assumed parent package's permission notice.
export function nativeNoticeInput({id,name,version,ecosystem,notices,vendors=[]}){
 assert.ok(['cocoapods','maven','native'].includes(ecosystem)&&id&&name&&version);
 assert.ok(Array.isArray(notices)&&Array.isArray(vendors));
 return {id,name,version,ecosystem,vendors,notices:notices.map(value=>{
  assert.ok(value.source&&!isAbsolute(value.source)&&!value.source.includes('..'));
  const body=noticeText(Buffer.from(value.body));assert.equal(digest(body),value.sha256);return {...value,body};
 })};
}

export function resolveNoticeCoverage(components,ledger,platform){
 assert.equal(ledger.schema,1);const unresolved=[],sections=[],seen=new Set(),records=[];
 for(const item of components){
  assert.ok(!seen.has(item.id),'Duplicate resolved component.');seen.add(item.id);
  const approved=ledger.components[item.id];
  const record={component:item.id,name:item.name,version:item.version,ecosystem:item.ecosystem,vendors:item.vendors,notices:item.notices.map(({source,sha256})=>({source,sha256}))};records.push(record);
  const reject=reason=>unresolved.push({component:item.id,reason});
  if(!item.notices.length){reject('missing-notice-text');continue;}
  if(!approved){reject('unreviewed-component');continue;}
  if(!Array.isArray(approved.reviewedVendors)||item.vendors.some(value=>!approved.reviewedVendors.includes(value))){reject('unreviewed-vendored-source');continue;}
  const actual=item.notices.map(({source,sha256})=>({source,sha256})).sort((a,b)=>a.source.localeCompare(b.source));
  const expected=[...(approved.notices??[])].sort((a,b)=>a.source.localeCompare(b.source));
  if(JSON.stringify(actual)!==JSON.stringify(expected)){reject('notice-set-or-digest-mismatch');continue;}
  assert.ok(typeof approved.upstream==='string'&&approved.upstream.startsWith('https://'),'Review needs a pinned upstream reference.');
  assert.ok(Array.isArray(approved.platforms)&&approved.platforms.length&&new Set(approved.platforms).size===approved.platforms.length&&approved.platforms.every(value=>['ios','android'].includes(value)),'Review needs explicit platform scope.');
  if(platform&&!approved.platforms.includes(platform)){reject('component-not-reviewed-for-platform');continue;}
  const sectionId='library-'+digest(item.id).slice(0,24);
  record.sectionId=sectionId;
  sections.push({id:sectionId,title:`${item.name} ${item.version}`,body:[...item.notices].sort((a,b)=>a.source.localeCompare(b.source)).map(value=>value.body).join('\n\n'),...(approved.platforms.length===1?{[approved.platforms[0]==='android'?'androidOnly':'iosOnly']:true}:{})});
 }
 return {status:unresolved.length?'INCOMPLETE':'READY',components:records,unresolved,sections};
}
// Strict sealing verifies a committed platform union; it never rewrites it.
export function assertSourceNoticePayload(payload,coverage,ledger,fontProvenance){
 assert.equal(coverage.status,'READY');assert.equal(coverage.unresolved.length,0);assert.ok(coverage.components.length);
 const sections=JSON.parse(noticeText(payload,16*maximumTextBytes));assert.ok(Array.isArray(sections));assert.equal(new Set(sections.map(value=>value.id)).size,sections.length);
 const fonts=fontProvenance.notices;
 for(const [id,expected] of Object.entries(fonts)){const value=sections.find(value=>value.id===id);assert.ok(value);assert.equal(digest(value.body),expected);}
 for(const value of coverage.sections)assert.deepEqual(sections.find(section=>section.id===value.id),value,'Actual included library differs from the committed union.');
 const known=new Map(Object.entries(ledger.components).map(([id,value])=>['library-'+digest(id).slice(0,24),value]));
 for(const section of sections){
  if(Object.hasOwn(fonts,section.id))continue;
  const approved=known.get(section.id);assert.ok(approved,'Unreviewed source notice section.');assert.equal(digest(section.body),approved.sectionSHA256,'Union text must match its reviewed provenance.');
  assert.ok(!(section.androidOnly&&section.iosOnly));
  if(approved.platforms.length===1)assert.equal(section[approved.platforms[0]==='android'?'androidOnly':'iosOnly'],true);else assert.ok(!section.androidOnly&&!section.iosOnly);
 }
 return sections;
}

// Explicit reviewed upstream copies can supply text absent from a published
// AAR/JAR. They supplement, never replace, the artifact's discovered NOTICEs.
export function addReviewedNoticeFiles(root,components,ledger){
 return components.map(item=>({...item,notices:[...item.notices,...(ledger.components[item.id]?.additionalNoticeFiles??[]).map(value=>{
  safeRelative(value.file);assert.ok(value.file.startsWith('assets/notices/sources/')&&value.upstream?.startsWith('https://'));
  const source=candidate(root,join(root,value.file));assert.equal(source.sha256,value.sha256);return source;
 })].sort((a,b)=>a.source.localeCompare(b.source))}));
}

const codeSource=path=>/\.(?:[cm]?js|jsx|tsx?|json)$/.test(path);
export function capturedSource(root,supplied,ledger={generatedSources:{}}){
 root=realpathSync(root);const modules=realpathSync(join(root,'node_modules'));
 if(Object.hasOwn(ledger.generatedSources??{},supplied)){
  const value=ledger.generatedSources[supplied];safeRelative(value.provider);assert.ok(value.provider.startsWith('node_modules/'));
  const provider=realpathSync(join(root,value.provider));assert.ok(inside(modules,provider));assert.equal(digest(readFileSync(provider)),value.sha256);
  return {path:supplied,generated:true,provider:value.provider,sha256:value.sha256,component:npmNoticeInputs(root,[provider])[0].id};
 }
 assert.ok(!/^[a-z]+:\/\//i.test(supplied)||supplied.startsWith('file://'),'Remote source-map paths are unsupported.');
 const path=realpathSync(supplied.startsWith('file://')?fileURLToPath(supplied):resolve(root,supplied));
 const installed=inside(modules,path);assert.ok(installed||inside(root,path),'App source resolved from another checkout.');
 const name=installed?'node_modules/'+safeRelative(relative(modules,path)):safeRelative(relative(root,path));
 return {path:name,sha256:digest(readFileSync(path)),code:codeSource(name),...(installed?{component:npmNoticeInputs(root,[path])[0].id}:{app:true})};
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
 return {sources:observed.size,appSources:sources.filter(value=>value.app&&observed.has(value.path)).length};
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
  return {path,sha256:file.sha256,components:[...new Set(components)].sort()};
 });
}
export function publicNoticeReport({platform,sourceCommit,entry,lockSHA256,coverage,payload}){
 assert.ok(['ios','android'].includes(platform));assert.match(sourceCommit,/^[a-f0-9]{40}$/);safeRelative(entry);
 if(payload)assert.equal(coverage.status,'READY');
 return {schema:1,platform,sourceCommit,entry,lockSHA256,scope:payload?'precompile-input-verification':'resolved-input-discovery',status:payload?'READY':'INCOMPLETE',complete:Boolean(payload),components:coverage.components,unresolved:coverage.unresolved,...(payload?{payloadSHA256:digest(payload)}:{discoveryOnly:true})};
}
export function assertFinalNoticeEvidence({manifest,payload,finalComponents,resources,retainedResources={}}){
 assert.equal(manifest.status,'READY');assert.equal(manifest.complete,true);assert.deepEqual(manifest.unresolved,[]);
 assert.equal(digest(payload),manifest.payloadSHA256,'Final packaged payload differs from captured source.');
 const data=JSON.parse(noticeText(payload,16*maximumTextBytes));assert.ok(Array.isArray(data));
 for(const component of manifest.components){const section=data.find(value=>value.id===component.sectionId);assert.ok(section?.body,'A resolved library has no readable notice section.');}
 assert.deepEqual([...new Set(finalComponents)].sort(),manifest.components.map(value=>value.component).sort(),'Final runtime inventory differs from captured coverage.');
 for(const [name,expected] of Object.entries(retainedResources))assert.equal(resources[name],expected,'An existing shipped native notice was removed or changed.');
}

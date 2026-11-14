import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync,readFileSync,readdirSync,realpathSync} from 'node:fs';
import {basename,dirname,join,relative,resolve,sep} from 'node:path';
import {createRequire} from 'node:module';
import {digest,nativeNoticeInput,npmNoticeInputs,nativeSourceNotices,noticeText} from './app-notices.mjs';

const require=createRequire(import.meta.url),archiveReader=new URL('./notice-archive.py',import.meta.url);

// Only finite diagnostics escape the CLI catch. Never serialize an Error,
// message, cause, path or unvalidated dependency name into review artifacts.
const operations=new Set(['review-inputs','source-graph','native-inputs','npm-notices','notice-union','reviewed-notices','coverage','pod-lock','pod-lock-entries','pod-acknowledgements','pod-source-scan','pod-notices','source-root','source-provider','source-path','source-boundary','source-bytes','source-npm']);
const components=new Set(['review','metro','ios','android','npm','cocoapods']);
const contexts=new WeakMap();
const sourceErrorCodes=new Set(['ERR_INVALID_ARG_TYPE','ERR_INVALID_ARG_VALUE','ERR_INVALID_URL','ERR_ASSERTION','ENOENT','ENOTDIR','EISDIR','ELOOP','EACCES','EPERM']);
const assertionCategories=new Map([['Notice must be readable UTF-8.','invalid-utf8'],['Native source link escapes its component.','source-boundary'],['Native source inventory exceeds its bound.','input-bound'],['Too many native source entries.','input-bound'],['Empty or oversized notice.','input-bound'],['Notice inputs exceed the review bound.','input-bound']]);
export function noticeInputStep(operation,component,run,id,source){
 assert.ok(operations.has(operation)&&components.has(component));
 try{return run();}catch(thrown){
  const error=thrown instanceof Error?thrown:new Error('Notice input failed.');
  if(!contexts.has(error)){
   let fields={};try{fields={code:error.code,status:error.status,message:error.message};}catch{}
   const {code,status,message}=fields;
   const category=code==='ENOENT'?'missing-input':['EACCES','EPERM'].includes(code)?'unreadable-input':error instanceof SyntaxError?'invalid-format':code==='ERR_ASSERTION'?(assertionCategories.get(message)??'invalid-input'):Number.isInteger(status)?'subprocess-failed':'unsupported-input';
   contexts.set(error,{operation,component,errorCategory:category,...(id?{componentSHA256:digest(id)}:{}),...(operation.startsWith('source-')?{errorClass:error instanceof TypeError?'TypeError':error instanceof SyntaxError?'SyntaxError':error instanceof ReferenceError?'ReferenceError':error instanceof RangeError?'RangeError':code==='ERR_ASSERTION'?'AssertionError':'Error',errorCode:sourceErrorCodes.has(code)?code:'other',...(typeof source==='string'?{sourceSHA256:digest(source)}:{})}:{})});
  }
  throw error;
 }
}
export function noticeFailureContext(error){const value=contexts.get(error);return value?{...value}:undefined;}
export function inspectNoticeArchive(path,payloadPath,bundlePath){
 return JSON.parse(execFileSync('python3',[archiveReader.pathname,path,...(payloadPath?[payloadPath]:[]),...(bundlePath?[bundlePath]:[])],{encoding:'utf8',maxBuffer:32*1024*1024,timeout:60000,stdio:['ignore','pipe','pipe']}));
}
export function podNoticeInputs(root){
 const lockPath=join(root,'ios/Podfile.lock'),support=join(root,'ios/Pods/Target Support Files');
 if(!existsSync(lockPath)||!existsSync(support))return {components:[],unresolved:[{component:'native:ios',reason:'missing-resolved-pod-inputs'}],nativeFiles:[]};
 const lock=noticeInputStep('pod-lock','cocoapods',()=>require('yaml').parse(noticeText(readFileSync(lockPath),16*1024*1024))),plist=require('@expo/plist').default,versions=new Map(),texts=new Map(),acknowledgements=[];
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
 const unresolved=[],components=[];
 for(const [name,version] of versions){
  const notices=texts.get(name)??[],external=lock['EXTERNAL SOURCES']?.[name]?.[':path'];let scan={vendors:[],vendorNotices:{},nativeInputs:{},notices:[]};
  const source=external?resolve(root,'ios',external):join(root,'ios/Pods',name);
  if(!existsSync(source))unresolved.push({component:`cocoapods:${name}@${version}`,reason:'missing-resolved-pod-source'});
  else scan=noticeInputStep('pod-source-scan','cocoapods',()=>nativeSourceNotices(root,source,`cocoapods:${name}`),`cocoapods:${name}@${version}`);
  components.push(noticeInputStep('pod-notices','cocoapods',()=>nativeNoticeInput({id:`cocoapods:${name}@${version}`,name,version,ecosystem:'cocoapods',...scan,notices:[...notices,...scan.notices].sort((a,b)=>a.source.localeCompare(b.source))}),`cocoapods:${name}@${version}`));
 }
 return {components,unresolved,nativeFiles:[],inputHashes:{podLock:digest(readFileSync(lockPath)),podAcknowledgements:digest(JSON.stringify(acknowledgements))}};
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
  assert.ok(value.group&&value.name&&value.version&&value.artifacts.length);const notices=[],vendors=[];
  for(const artifact of value.artifacts){
   const bytes=readFileSync(artifact.file);assert.equal(digest(bytes),artifact.sha256,'Resolved artifact changed.');
   const inspected=inspectNoticeArchive(artifact.file),prefix='maven:'+value.group+':'+value.name+':'+value.version+'/'+basename(artifact.file)+'!';
   notices.push(...inspected.notices.map(item=>({...item,source:prefix+item.source})));
   nativeFiles.push(...inspected.nativeFiles.map(item=>({...item,component:`maven:${value.group}:${value.name}@${value.version}`})));
   for(const item of inspected.notices)if(/(^|\/)(vendor|third[-_]?party)(\/|$)/i.test(item.source))vendors.push(item.source);
  }
  components.push(nativeNoticeInput({id:`maven:${value.group}:${value.name}@${value.version}`,name:value.group+':'+value.name,version:value.version,ecosystem:'maven',notices,vendors}));
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

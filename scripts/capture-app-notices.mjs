// No source generation. Discovery is incomplete; seal/verify fail closed.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {chmodSync,existsSync,lstatSync,mkdirSync,readFileSync,realpathSync,rmSync,statSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname,join,relative,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {addReviewedNoticeFiles,assertCapturedSources,assertFinalNoticeEvidence,assertFinalSourceMap,assertPackagedNativeCoverage,assertSourceNoticePayload,capturedSource,digest,npmNoticeInputs,noticeText,publicNoticeReport,resolveNoticeCoverage,unreviewedOSSNoticeInputs} from './app-notices.mjs';
import {gradleNoticeInputs,inspectNoticeArchive,podNoticeInputs,unionNoticeInputs} from './native-notice-inputs.mjs';
import {installTaskCleanup} from './native-task-cleanup.mjs';

export const payloadPath='assets/notices/third_party_notices.json';
const ledgerPath='scripts/app-notice-provenance.json',fontPath='scripts/font-icon-provenance.json',entry='index.ts';
const readJSON=path=>{assert.ok(statSync(path).size<=128*1024*1024);return JSON.parse(noticeText(readFileSync(path),128*1024*1024));};
const git=(root,...args)=>execFileSync('git',args,{cwd:root,maxBuffer:32*1024*1024,stdio:['ignore','pipe','pipe']});
const committed=(root,path)=>git(root,'show','HEAD:'+path);
function strictSource(root,path){const bytes=readFileSync(join(root,path));assert.ok(bytes.equals(committed(root,path)),'Notice source is not committed.');return bytes;}
function nativeInputs(root,platform,gradleInput){return platform==='ios'?podNoticeInputs(root):gradleNoticeInputs(root,gradleInput);}

// Given the actual Metro-selected paths, capture component/own-source evidence.
// Injecting paths permits meaningful fixture checks without starting a bundler.
export function captureResolvedInputs(root,platform,paths,gradleInput){
 assert.ok(paths.length<=100000,'Metro graph exceeds the capture bound.');
 const ledger=readJSON(join(root,ledgerPath)),fonts=readJSON(join(root,fontPath)),unresolved=[],sources=[],physical=[];
 for(const path of new Set(paths)){
  if(path==='__prelude__'&&!Object.hasOwn(ledger.generatedSources??{},path)){unresolved.push({component:'metro:__prelude__',reason:'unreviewed-generated-source'});continue;}
  const value=capturedSource(root,path,ledger);sources.push(value);
  physical.push(join(root,value.generated?value.provider:value.path));
 }
 const native=nativeInputs(root,platform,gradleInput);
 const components=addReviewedNoticeFiles(root,unionNoticeInputs(npmNoticeInputs(root,physical),native.components),ledger,platform);
 assert.ok(components.length<=2048&&components.reduce((bytes,item)=>bytes+item.notices.reduce((sum,value)=>sum+Buffer.byteLength(value.body),0),0)<=16*1024*1024,'Notice inputs exceed the review bound.');
 const coverage=resolveNoticeCoverage(components,ledger,platform);coverage.unresolved.push(...unresolved,...native.unresolved);
 if(coverage.unresolved.length)coverage.status='INCOMPLETE';
 return {ledger,fonts,coverage,sources:sources.sort((a,b)=>a.path.localeCompare(b.path)),native,noticeInputs:components};
}

async function metroPaths(root,platform,privateRoot){
 // Same pinned export:embed loader, graph options, file-map patch and resolver
 // used by native builds. No HTTP server, export, platform compile or cache wipe.
 process.env.NODE_ENV='production';process.env.EXPO_NO_METRO_WORKSPACE_ROOT='1';process.env.TMPDIR=privateRoot;
 const require=createRequire(import.meta.url),expoRequire=createRequire(require.resolve('expo/package.json'));
 const cli=dirname(expoRequire.resolve('@expo/cli/package.json'));
 const {createMetroServerAndBundleRequestAsync}=require(join(cli,'build/src/export/embed/exportEmbedAsync.js'));
 let server;const cleanup=installTaskCleanup(async()=>{await server?.end();});
 // Metro diagnostics can include absolute developer paths/source excerpts.
 // This standalone discovery process emits finite summaries/reports only.
 const stdout=process.stdout.write,stderr=process.stderr.write;
 process.stdout.write=process.stderr.write=(_chunk,encoding,callback)=>{const done=typeof encoding==='function'?encoding:callback;if(done)queueMicrotask(done);return true;};
 try{
  const result=await createMetroServerAndBundleRequestAsync(root,{entryFile:entry,platform,dev:false,minify:false,maxWorkers:2,resetCache:false});server=result.server;
  return await server.getOrderedDependencyPaths(result.bundleRequest);
 }finally{try{await cleanup.run();}finally{cleanup.dispose();process.stdout.write=stdout;process.stderr.write=stderr;}}
}

export function assertReviewedSource(root,capture){
 assert.equal(realpathSync(root),realpathSync(git(root,'rev-parse','--show-toplevel').toString().trim()),'Use the canonical checkout root.');
 const {ledger,fonts,sources,coverage}=capture;
 assertCapturedSources(root,sources,path=>committed(root,path));
 for(const path of ['package.json','package-lock.json','app.json',ledgerPath,fontPath,payloadPath])strictSource(root,path);
 for(const [path,expected] of Object.entries(fonts.files))assert.equal(digest(readFileSync(join(root,path))),expected,'Installed font input drifted.');
 for(const component of ledger.components)for(const item of component.additionalNoticeFiles??[])strictSource(root,item.file);
 const payload=readFileSync(join(root,payloadPath));assertSourceNoticePayload(payload,coverage,ledger,fonts);
 assert.ok(sources.some(value=>value.path===payloadPath&&value.sha256===digest(payload)),'The offline view must import the same committed resource.');
 const app=readJSON(join(root,'app.json')).expo;
 assert.ok(app.plugins.some(value=>Array.isArray(value)&&value[0]==='expo-asset'&&JSON.stringify(value[1]?.assets)===JSON.stringify(['./'+payloadPath])),'Declare the exact raw notice resource through expo-asset.');
 if(existsSync(join(root,'android/app/src/main/assets/third_party_notices.json')))assert.ok(payload.equals(readFileSync(join(root,'android/app/src/main/assets/third_party_notices.json'))),'Android prebuild resource drifted.');
 return payload;
}

function outputDirectory(root,platform){
 const path=join(root,'build/notices',platform);let current=root;
 for(const part of relative(root,path).split(sep)){
  current=join(current,part);if(existsSync(current))assert.ok(!lstatSync(current).isSymbolicLink(),'Notice output must stay inside this worktree.');else mkdirSync(current,{mode:0o700});
 }
 return path;
}
function write(path,value){writeFileSync(path,JSON.stringify(value,null,2)+'\n',{mode:0o600});chmodSync(path,0o600);}
function inputHashes(root,capture){return {...capture.native.inputHashes,packageManifest:digest(readFileSync(join(root,'package.json'))),appConfig:digest(readFileSync(join(root,'app.json'))),packageLock:digest(readFileSync(join(root,'package-lock.json'))),ledger:digest(readFileSync(join(root,ledgerPath))),fontProvenance:digest(readFileSync(join(root,fontPath)))};}
export function createNoticeSeal(root,platform,capture){
 const payload=assertReviewedSource(root,capture),sourceCommit=git(root,'rev-parse','HEAD').toString().trim();
 return {...publicNoticeReport({platform,sourceCommit,entry,lockSHA256:digest(readFileSync(join(root,'package-lock.json'))),coverage:capture.coverage,payload}),sources:capture.sources,inputHashes:inputHashes(root,capture)};
}
const resourcePaths={
 apk:{platform:'android',payload:'assets/third_party_notices.json',bundle:'assets/index.android.bundle'},
 aab:{platform:'android',payload:'base/assets/third_party_notices.json',bundle:'base/assets/index.android.bundle'},
 ipa:{platform:'ios',payload:'Payload/Puptime.app/third_party_notices.json',bundle:'Payload/Puptime.app/main.jsbundle'},
};

function finalNoticeProof(root,platform,seal,capture,payload,options){
 const kind=options['--archive'].split('.').at(-1).toLowerCase(),paths=resourcePaths[kind];assert.equal(paths?.platform,platform);
 const mapEvidence=assertFinalSourceMap(root,readJSON(options['--source-map']),seal.sources,capture.ledger);
 const archive=inspectNoticeArchive(options['--archive'],paths.payload,paths.bundle);assert.ok(archive.payload&&archive.bundle);
 assert.ok(Buffer.from(archive.payload.base64,'base64').equals(payload));assert.equal(archive.bundle.sha256,digest(readFileSync(options['--bundle'])),'Final bundle differs from the mapped build output.');
 const native=assertPackagedNativeCoverage(platform,archive.nativeFiles,capture.native.nativeFiles,capture.coverage,capture.ledger);
 const observedComponents=[...new Set([...mapEvidence.components,...native.flatMap(value=>value.components)])].sort();
 // Static/DEX ownership cannot be read independently from these final bytes.
 // Reinspect actual resolved inputs after packaging and label that exact limit.
 const resolved=new Map(capture.native.components.map(value=>[value.id,{component:value.id,basis:platform==='ios'?'reinspected-pod-lock-and-source':'reinspected-gradle-artifacts-and-source'}]));
 for(const value of capture.sources.filter(value=>value.generated))resolved.set(value.component,{component:value.component,basis:'locked-generated-metro-provider'});
 const resolvedBuildOnly=[...resolved.values()].filter(value=>!observedComponents.includes(value.component)).sort((a,b)=>a.component.localeCompare(b.component));
 const resources=Object.fromEntries(archive.notices.map(value=>[kind==='aab'?value.source.replace(/^base\/root\//,''):value.source,value.sha256]));
 assertFinalNoticeEvidence({manifest:seal,payload,observedComponents,resolvedBuildOnly,resources,retainedResources:platform==='android'?capture.ledger.retainedAndroidResources:{}});
 return {schema:1,scope:'final-artifact-verification',status:'READY',sourceCommit:seal.sourceCommit,platform,payloadSHA256:digest(payload),archiveSHA256:digest(readFileSync(options['--archive'])),bundleSHA256:archive.bundle.sha256,sourceMapSHA256:digest(readFileSync(options['--source-map'])),mapEvidence,native,inventory:{observedComponents,resolvedBuildOnly,independentFinalComponentInventory:false,postPackageResolvedInputReinspection:true,postBuildResolutionRegenerated:false},complete:true};
}

export async function main(args=process.argv.slice(2)){
 const [mode,platform,...tail]=args;assert.ok(['collect','seal','verify'].includes(mode)&&['ios','android'].includes(platform),'Use collect|seal|verify ios|android.');
 const options={};assert.equal(tail.length%2,0);
 for(let i=0;i<tail.length;i+=2){assert.ok(['--gradle-input','--archive','--source-map','--bundle'].includes(tail[i])&&!options[tail[i]]);options[tail[i]]=resolve(tail[i+1]);}
 const root=realpathSync(process.cwd()),out=outputDirectory(root,platform),sourceCommit=git(root,'rev-parse','HEAD').toString().trim();let stage='metro';
 try{
  if(mode==='verify'){
   const kind=options['--archive']?.split('.').at(-1).toLowerCase();assert.ok(resourcePaths[kind]);rmSync(join(out,'final-'+kind+'.json'),{force:true});
   stage='source';const seal=readJSON(join(out,'seal.json'));assert.equal(seal.sourceCommit,sourceCommit);assert.equal(seal.platform,platform);
   const capture=captureResolvedInputs(root,platform,seal.sources.map(value=>value.generated?value.path:join(root,value.path)),options['--gradle-input']);
   assert.deepEqual(capture.sources,seal.sources);assert.deepEqual(inputHashes(root,capture),seal.inputHashes);assert.deepEqual(capture.coverage.components,seal.components);
   const payload=assertReviewedSource(root,capture);assert.equal(digest(payload),seal.payloadSHA256);
   stage='final-artifact';assert.ok(options['--source-map']&&options['--bundle']&&options['--archive']);
   write(join(out,'final-'+kind+'.json'),finalNoticeProof(root,platform,seal,capture,payload,options));
   console.log('Notices final verification: READY.');return;
  }
  if(mode==='seal'){rmSync(join(out,'seal.json'),{force:true});for(const kind of Object.keys(resourcePaths))rmSync(join(out,'final-'+kind+'.json'),{force:true});}
  const privateRoot=join(out,'private');mkdirSync(privateRoot,{recursive:true,mode:0o700});chmodSync(privateRoot,0o700);
  const paths=await metroPaths(root,platform,privateRoot);stage='native';const capture=captureResolvedInputs(root,platform,paths,options['--gradle-input']);
  const report=publicNoticeReport({platform,sourceCommit,entry,lockSHA256:digest(readFileSync(join(root,'package-lock.json'))),coverage:capture.coverage});
  write(join(out,'discovery.json'),{...report,sources:capture.sources,inputHashes:inputHashes(root,capture)});
  write(join(privateRoot,'unreviewed-inputs.json'),{schema:1,status:'INCOMPLETE',complete:false,discoveryOnly:true,components:capture.noticeInputs});
  const review=join(out,'review');mkdirSync(review,{recursive:true,mode:0o700});write(join(review,'unreviewed-oss-notice-inputs.json'),unreviewedOSSNoticeInputs(capture.noticeInputs,capture.ledger));
  if(mode==='collect'){console.log(`Notices discovery: INCOMPLETE (${capture.coverage.unresolved.length} unresolved inputs); no release payload generated.`);return;}
  stage='seal';write(join(out,'seal.json'),createNoticeSeal(root,platform,capture));
  console.log('Notices precompile verification: READY.');
 }catch{
  write(join(out,'failure.json'),{schema:1,status:'INCOMPLETE',complete:false,sourceCommit,platform,stage});
  console.error(`Notices verification failed closed at ${stage}; no completed payload or release qualification.`);process.exitCode=1;
 }
}
if(process.argv[1]&&realpathSync(process.argv[1])===fileURLToPath(import.meta.url))await main().catch(()=>{console.error('Invalid notice command; no release qualification.');process.exitCode=1;});

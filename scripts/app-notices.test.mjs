import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,realpathSync,chmodSync,symlinkSync,cpSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {parse} from 'yaml';
import {addKnownOwnNoticeFiles,npmNoticeInputs,nativeNoticeInput,resolveNoticeCoverage,assertSourceNoticePayload,publicNoticeReport,assertFinalNoticeEvidence,capturedSource,assertCapturedSources,assertFinalSourceMap,assertPackagedNativeCoverage,digest,unreviewedOSSNoticeInputs} from './app-notices.mjs';
import {captureResolvedInputs,createNoticeSeal} from './capture-app-notices.mjs';
import {podNoticeInputs} from './native-notice-inputs.mjs';

const mit=readFileSync(new URL('../node_modules/react-native/LICENSE',import.meta.url),'utf8');
function fixture(run){
 const root=mkdtempSync(join(tmpdir(),'puptime-notice-check-'));
 const file=(path,body)=>{mkdirSync(join(root,path,'..'),{recursive:true});writeFileSync(join(root,path),typeof body==='string'||Buffer.isBuffer(body)?body:JSON.stringify(body));return join(root,path);};
 try{return run({root,file});}finally{rmSync(root,{recursive:true,force:true});}
}
const review=(item,platform='ios')=>({platform,component:item.id,reviewedVendors:item.vendors,nativeInputs:item.nativeInputs??{},sectionSHA256:digest([...item.notices].sort((a,b)=>a.source.localeCompare(b.source)).map(value=>value.body).join('\n\n')),upstream:'https://example.invalid/pinned/source',notices:item.notices.map(({source,sha256})=>({source,sha256}))});
const ledger=(...items)=>({schema:1,components:items.map(item=>review(item))});
const font={id:'fixture-font',title:'Fixture font',body:mit},fonts={notices:{'fixture-font':digest(mit)},platforms:{'fixture-font':['ios','android','web']},files:{}};
const sourcePayload=coverage=>Buffer.from(JSON.stringify([font,...coverage.sections],null,2)+'\n');

test('initial upstream inventory hashes the actual installed licence texts without certifying component coverage',()=>{
 const preparation=JSON.parse(readFileSync(new URL('./app-notice-provenance.json',import.meta.url)));
 for(const value of preparation.knownLicenseSources)assert.equal(digest(readFileSync(new URL('../'+value.source,import.meta.url))),value.sha256);
});

test('actual selected packages keep nested and vendored rights separate, without parent-license inheritance',()=>fixture(({root,file})=>{
 file('package-lock.json',{packages:{'node_modules/parent':{version:'1.0.0'},'node_modules/parent/node_modules/child':{version:'2.0.0'}}});
 file('node_modules/parent/package.json',{name:'parent',version:'1.0.0'});file('node_modules/parent/LICENSE',mit);
 file('node_modules/parent/lib/package.json',{type:'commonjs'});
 const selected=file('node_modules/parent/lib/main.js','export const value=1;');
 file('node_modules/parent/node_modules/child/package.json',{name:'child',version:'2.0.0'});
 const child=file('node_modules/parent/node_modules/child/main.js','export const value=2;');
 const inputs=npmNoticeInputs(root,[selected,child]);assert.equal(inputs.length,2);
 const parent=inputs.find(value=>value.name==='parent'),nested=inputs.find(value=>value.name==='child');
 assert.equal(parent.notices[0].body,mit);assert.deepEqual(nested.notices,[]);
 assert.deepEqual(resolveNoticeCoverage(inputs,ledger(parent)).unresolved,[{component:nested.id,reason:'missing-notice-text'}]);
 const vendor=file('node_modules/parent/vendor/separate/main.js','module.exports=1');file('node_modules/parent/vendor/separate/NOTICE','Separate upstream notice\n');
 const vendored=npmNoticeInputs(root,[vendor])[0];assert.deepEqual(vendored.vendors,['vendor/separate']);assert.equal(vendored.notices.length,2);
 const stale=ledger(vendored);stale.components[0].reviewedVendors=[];
 assert.equal(resolveNoticeCoverage([vendored],stale).status,'INCOMPLETE');
 assert.equal(resolveNoticeCoverage([vendored],ledger(vendored)).status,'READY');
}));

test('a complete package label does not excuse missing or modified actual notice/NOTICE files',()=>fixture(({root,file})=>{
 file('package-lock.json',{packages:{'node_modules/qa':{version:'1.0.0'}}});file('node_modules/qa/package.json',{name:'qa',version:'1.0.0',license:'MIT'});
 const source=file('node_modules/qa/main.js','');
 const missing=npmNoticeInputs(root,[source]);assert.equal(resolveNoticeCoverage(missing,{schema:1,components:[]}).unresolved[0].reason,'missing-notice-text');
 file('node_modules/qa/LICENSE',mit);file('node_modules/qa/NOTICE','Preserve the vendored attribution\n');
 file('node_modules/qa/LICENSE-MIT',mit);file('node_modules/qa/LICENSES/Vendor-A.txt','Distinct actual vendor licence\n');file('node_modules/qa/THIRD_PARTY_NOTICES.md','More attribution\n');
 const input=npmNoticeInputs(root,[source])[0],approved=ledger(input);assert.equal(input.notices.length,5);
 approved.components[0].notices.pop();assert.equal(resolveNoticeCoverage([input],approved).status,'INCOMPLETE');
 const before=ledger(input);file('node_modules/qa/LICENSE',mit+'modified');
 assert.equal(resolveNoticeCoverage(npmNoticeInputs(root,[source]),before).status,'INCOMPLETE');
 file('node_modules/qa/package.json',{name:'qa',version:'2.0.0'});assert.throws(()=>npmNoticeInputs(root,[source]));
}));

test('collection remains explicitly incomplete and cannot create a release payload or disclose filesystem paths',()=>{
 const item=nativeNoticeInput({id:'maven:qa:library:1',name:'qa:library',version:'1',ecosystem:'maven',notices:[{source:'aar:qa-library.aar!META-INF/LICENSE',body:mit,sha256:digest(mit)}]});
 const missing=resolveNoticeCoverage([item],{schema:1,components:[]});assert.equal(missing.status,'INCOMPLETE');assert.throws(()=>assertSourceNoticePayload(sourcePayload(missing),missing,{schema:1,components:[]},fonts));
 const ready=resolveNoticeCoverage([item],ledger(item));
 const report=publicNoticeReport({platform:'android',sourceCommit:'a'.repeat(40),entry:'index.ts',lockSHA256:'b'.repeat(64),coverage:ready});
 assert.equal(report.status,'INCOMPLETE');assert.equal(report.complete,false);assert.equal(report.payloadSHA256,undefined);assert.equal(report.discoveryOnly,true);
 assert.ok(!JSON.stringify(report).includes(tmpdir()));
 assert.throws(()=>nativeNoticeInput({...item,notices:[{...item.notices[0],source:'/private/owner/credential'}]}));
 assert.throws(()=>assertSourceNoticePayload(Buffer.from(JSON.stringify([font])),{status:'READY',components:[],unresolved:[],sections:[]},{schema:1,components:[]},fonts));
});

test('final evidence requires the exact readable payload, runtime coverage and every retained native notice',()=>{
 const item=nativeNoticeInput({id:'cocoapods:QA@1',name:'QA',version:'1',ecosystem:'cocoapods',notices:[{source:'pod:QA/LICENSE',body:mit,sha256:digest(mit)}]});
 const coverage=resolveNoticeCoverage([item],ledger(item)),payload=sourcePayload(coverage);
 const manifest=publicNoticeReport({platform:'ios',sourceCommit:'a'.repeat(40),entry:'index.ts',lockSHA256:'b'.repeat(64),coverage,payload});
 assertSourceNoticePayload(payload,coverage,ledger(item),fonts);
 const input={manifest,payload,observedComponents:[item.id],resolvedBuildOnly:[],resources:{'META-INF/existing/NOTICE':'c'.repeat(64)},retainedResources:{'META-INF/existing/NOTICE':'c'.repeat(64)}};
 assertFinalNoticeEvidence(input);
 assert.throws(()=>assertFinalNoticeEvidence({...input,payload:Buffer.from('[]')}));
 assert.throws(()=>assertFinalNoticeEvidence({...input,observedComponents:[item.id,'native:unmapped@1']}));
 assert.throws(()=>assertFinalNoticeEvidence({...input,resources:{}}));
 assert.throws(()=>assertFinalNoticeEvidence({...input,manifest:{...manifest,complete:false}}));
 const changed=Buffer.from(payload.toString().replace('library-','missing-'));
 assert.throws(()=>assertFinalNoticeEvidence({...input,payload:changed,manifest:{...manifest,payloadSHA256:digest(changed)}}));
 assert.throws(()=>assertSourceNoticePayload(changed,coverage,ledger(item),fonts));
 const drift=ledger(item);drift.components[0].sectionSHA256='d'.repeat(64);assert.throws(()=>assertSourceNoticePayload(payload,coverage,drift,fonts));
 const wrongPlatform=ledger(item);wrongPlatform.components[0].platform='android';
 assert.equal(resolveNoticeCoverage([item],wrongPlatform,'ios').unresolved[0].reason,'unreviewed-component');
 for(const key of ['iosOnly','androidOnly']){
  const hidden=JSON.parse(payload);hidden[0][key]=true;
  assert.throws(()=>assertSourceNoticePayload(Buffer.from(JSON.stringify(hidden)),coverage,ledger(item),fonts));
 }
});

test('worktree source proof rejects a foreign checkout and stale final sourcesContent even with identical package coverage',()=>fixture(({root,file})=>{
 file('node_modules/.placeholder','');file('package-lock.json',{packages:{}});
 const content='export const guide = "current";\n',path=file('src/LearnScreen.tsx',content),source=capturedSource(root,path);
 assertCapturedSources(root,[source],()=>Buffer.from(content));
 const map={version:3,sources:['src/LearnScreen.tsx'],sourcesContent:[content]};
 assertFinalSourceMap(root,map,[source],{});
 assert.throws(()=>assertFinalSourceMap(root,{...map,sourcesContent:['export const guide = "stale";\n']},[source],{}));
 assert.throws(()=>assertCapturedSources(root,[source],()=>Buffer.from('another frozen source')));
 fixture(other=>{const foreign=other.file('src/LearnScreen.tsx',content);assert.throws(()=>capturedSource(root,foreign));assert.throws(()=>assertFinalSourceMap(root,{...map,sources:[foreign]},[source],{}));});
 file('src/LearnScreen.tsx',content+'// changed\n');assert.throws(()=>assertFinalSourceMap(root,map,[source],{}));
}));

test('unknown packaged native libraries cannot be certified by a complete JS inventory',()=>{
 const component='maven:qa:native@1',coverage={components:[{component}]};
 const file={path:'lib/arm64-v8a/libqa.so',sha256:'a'.repeat(64)},input={path:'jni/arm64-v8a/libqa.so',component,sha256:'b'.repeat(64)};
 assert.equal(assertPackagedNativeCoverage('android',[file],[input],coverage,{})[0].components[0],component);
 assert.throws(()=>assertPackagedNativeCoverage('android',[{...file,path:'lib/arm64-v8a/libunknown.so'}],[input],coverage,{}));
 const framework={path:'Payload/Puptime.app/Frameworks/QA.framework/QA',sha256:'c'.repeat(64)};
 assert.throws(()=>assertPackagedNativeCoverage('ios',[framework],[],coverage,{}));
 const reviewed={packagedNative:{ios:{[framework.path]:{components:[component],review:'https://example.invalid/pinned/native-source'}}}};
 assert.equal(assertPackagedNativeCoverage('ios',[framework],[],coverage,reviewed).length,1);
 assert.throws(()=>assertPackagedNativeCoverage('ios',[framework],[],{components:[]},reviewed));
});

test('real resolved-input collection leaves missing native/generated review incomplete without changing the tracked payload',()=>fixture(({root,file})=>{
 file('package-lock.json',{packages:{'node_modules/qa':{version:'1'}}});file('node_modules/qa/package.json',{name:'qa',version:'1'});file('node_modules/qa/LICENSE',mit);
 const path=file('node_modules/qa/index.js','module.exports=1;');
 file('scripts/app-notice-provenance.json',{schema:1,components:[],generatedSources:{}});file('scripts/font-icon-provenance.json',fonts);
 const payload=file('assets/notices/third_party_notices.json',JSON.stringify([font])),before=readFileSync(payload);
 const result=captureResolvedInputs(root,'ios',[path,'__prelude__']);
 assert.equal(result.coverage.status,'INCOMPLETE');assert.ok(result.coverage.unresolved.some(value=>value.reason==='missing-resolved-pod-inputs'));
 assert.ok(result.coverage.unresolved.some(value=>value.reason==='unreviewed-generated-source'));
 assert.ok(readFileSync(payload).equals(before));assert.ok(!JSON.stringify(result).includes(root));
}));

test('public review serialization includes only exact pinned public notice bodies and never private-origin data',()=>{
 const value=nativeNoticeInput({id:'native:private-component@1',name:'private-component',version:'1',ecosystem:'native',notices:[{source:'private/NOTICE',body:'private customer information',sha256:digest('private customer information')}]});
 const publicValue={id:'npm:qa@1',name:'qa',version:'1',ecosystem:'npm',notices:[{source:'node_modules/qa/LICENSE',body:mit,sha256:digest(mit)}],vendors:[]};
 const nativePublic=['cocoapods','maven'].map(ecosystem=>nativeNoticeInput({id:ecosystem+':public-qa@1',name:'public-qa',version:'1',ecosystem,notices:[{source:ecosystem+':public-qa/NOTICE',body:mit,sha256:digest(mit)}]}));
 const knownLicenseSources=[publicValue,...nativePublic].map(item=>({public:true,component:item.id,ecosystem:item.ecosystem,version:item.version,source:item.notices[0].source,sha256:digest(mit),upstream:'https://example.invalid/pinned/LICENSE'}));
 const data=unreviewedOSSNoticeInputs([publicValue,...nativePublic,value],{knownLicenseSources});
 assert.equal(data.status,'INCOMPLETE');assert.equal(data.complete,false);assert.equal(data.discoveryOnly,true);assert.equal(data.components[0].notices[0].body,mit);assert.equal(data.components.length,3);assert.equal(data.unresolved.length,1);
 for(const privateText of ['private-component','private/NOTICE','private customer information'])assert.ok(!JSON.stringify(data).includes(privateText));
 const changed={...publicValue,notices:[{...publicValue.notices[0],body:'changed private bytes',sha256:digest('changed private bytes')}]};
 const blocked=unreviewedOSSNoticeInputs([changed],{knownLicenseSources});
 assert.equal(blocked.components.length,0);assert.ok(!JSON.stringify(blocked).includes('changed private bytes'));
});

test('actual verify CLI derives final components from map/native inputs and rejects missing assets, extras and dirty HEAD inputs',()=>fixture(({root,file})=>{
 const runGit=(...args)=>execFileSync('git',['-c','core.hooksPath=/dev/null','-c','commit.gpgsign=false',...args],{cwd:root,stdio:['ignore','pipe','pipe']});
 file('.gitignore','node_modules/\nbuild/\n');file('package.json',{name:'fixture',version:'1'});
 const buildConfig='module.exports={presets:["controlled-preset"]};\n';file('babel.config.cjs',buildConfig);
 const app={expo:{plugins:[['expo-asset',{assets:['./assets/notices/third_party_notices.json']}]]}};file('app.json',app);
 const lock={packages:{'node_modules/qa':{version:'1'},'node_modules/assets':{version:'1'},'node_modules/extra':{version:'1'}}};file('package-lock.json',lock);
 for(const name of ['qa','assets','extra']){file(`node_modules/${name}/package.json`,{name,version:'1'});file(`node_modules/${name}/LICENSE`,mit);}
 const appCode='export const app=1;\n',moduleCode='module.exports=42;\n';
 const appPath=file('index.ts',appCode),modulePath=file('node_modules/qa/index.js',moduleCode),assetPath=file('node_modules/assets/font.ttf','synthetic font bytes');file('node_modules/extra/index.js','module.exports=0;');
 file('scripts/font-icon-provenance.json',fonts);file('assets/notices/third_party_notices.json','[]');
 const aar=file('build/source.aar',''),staticJar=file('build/static.jar','');
 execFileSync('python3',['-c',`import zipfile,sys\nwith zipfile.ZipFile(sys.argv[1],'w') as z:z.writestr('LICENSE',sys.argv[3]);z.writestr('jni/arm64-v8a/libqa.so',b'\\x7fELFcontrolled')\nwith zipfile.ZipFile(sys.argv[2],'w') as z:z.writestr('LICENSE',sys.argv[3])`,aar,staticJar,mit]);
 const gradle=file('build/runtime-inputs.json',{schema:1,configuration:'releaseRuntimeClasspath',components:[{group:'qa',name:'native',version:'1',artifacts:[{file:aar,sha256:digest(readFileSync(aar))}]},{group:'qa',name:'static',version:'1',artifacts:[{file:staticJar,sha256:digest(readFileSync(staticJar))}]}]});
 const ownSource='assets/notices/sources/qa-MIT.txt';file(ownSource,mit);const ownPackage={name:'qa',version:'1',license:'MIT',repository:'https://github.com/qa/library.git'};file('node_modules/qa/package.json',ownPackage);
 const tarball='https://registry.npmjs.org/qa/-/qa-1.tgz',integrity='sha512-'+Buffer.alloc(64).toString('base64');lock.packages['node_modules/qa']={version:'1',resolved:tarball,integrity};file('package-lock.json',lock);
 const ownPin={component:'npm:qa@1',ecosystem:'npm',version:'1',public:true,source:ownSource,sha256:digest(mit),upstream:'https://raw.githubusercontent.com/qa/library/'+ 'a'.repeat(40)+'/LICENSE',ownText:{kind:'pinned-upstream-own-attribution',ownerNpmID:'npm:qa@1',packagePath:'node_modules/qa',packageJSONSource:'node_modules/qa/package.json',packageJSONSHA256:digest(readFileSync(join(root,'node_modules/qa/package.json'))),tarball,integrity,publisher:{gitHead:'a'.repeat(40),metadataURL:'https://registry.npmjs.org/qa/1',metadataSHA256:'b'.repeat(64)},selectedSources:[{source:'node_modules/qa/index.js',sha256:digest(moduleCode)}]}};
 const empty={schema:1,components:[],knownLicenseSources:[ownPin],retainedAndroidResources:{'META-INF/NOTICE.json':digest('{"notice":"Required synthetic native notice"}\n')}};file('scripts/app-notice-provenance.json',empty);
 const paths=[appPath,modulePath,assetPath,join(root,'assets/notices/third_party_notices.json')];
 const initial=captureResolvedInputs(root,'android',paths,gradle),approved={...empty,components:initial.noticeInputs.map(item=>review(item,'android'))};file('scripts/app-notice-provenance.json',approved);
 const coverage=resolveNoticeCoverage(initial.noticeInputs,approved,'android');file('assets/notices/third_party_notices.json',sourcePayload(coverage));
 runGit('init','--quiet');runGit('add','.');runGit('reset','--',ownSource);runGit('-c','user.name=Notice test','-c','user.email=notice-test@example.invalid','commit','--quiet','-m','Synthetic notice fixture');
 assert.throws(()=>createNoticeSeal(root,'android',captureResolvedInputs(root,'android',paths,gradle)),'Even exact approved own text must be committed, not just untracked readable bytes.');
 runGit('add',ownSource);runGit('-c','user.name=Notice test','-c','user.email=notice-test@example.invalid','commit','--quiet','-m','Commit synthetic own text');
 const capture=captureResolvedInputs(root,'android',paths,gradle),seal=createNoticeSeal(root,'android',capture);file('build/notices/android/seal.json',seal);
 for(const name of ['app.json','package-lock.json']){const before=readFileSync(join(root,name));file(name,Buffer.concat([before,Buffer.from(' ')]));assert.throws(()=>createNoticeSeal(root,'android',capture));file(name,before);}
 assert.throws(()=>createNoticeSeal(join(root,'node_modules'), 'android',capture));
 const sourceMap={version:3,sources:['index.ts','node_modules/qa/index.js','node_modules/assets/font.ttf','assets/notices/third_party_notices.json'],sourcesContent:[appCode,moduleCode,'',readFileSync(join(root,'assets/notices/third_party_notices.json'),'utf8')]};
 const map=file('build/actual.map',sourceMap),bundle=file('build/index.android.bundle','controlled compiler output'),apk=join(root,'build/final.apk');
 const pack=(extra=false,emptyRetained=false)=>execFileSync('python3',['-c',`import zipfile,sys\nwith zipfile.ZipFile(sys.argv[1],'w') as z:\n z.write(sys.argv[2],'assets/third_party_notices.json');z.write(sys.argv[3],'assets/index.android.bundle');z.writestr('lib/arm64-v8a/libqa.so',b'\\x7fELFcontrolled');z.writestr('assets/font.ttf','synthetic font bytes');z.writestr('third_party_licenses.txt',b'');z.writestr('third_party_licenses.json',sys.argv[7]);z.writestr('META-INF/NOTICE.json',b'' if sys.argv[5]=='yes' else sys.argv[7] if sys.argv[5]=='json' else sys.argv[6])\n if sys.argv[4]=='yes':z.writestr('assets/unknown-executable',b'\\xcf\\xfa\\xed\\xfecontrolled')`,apk,join(root,'assets/notices/third_party_notices.json'),bundle,extra?'yes':'no',emptyRetained===true?'yes':emptyRetained==='json'?'json':'no','{"notice":"Required synthetic native notice"}\n','{}\n']);
 const verify=()=>spawnSync(process.execPath,[fileURLToPath(new URL('./capture-app-notices.mjs',import.meta.url)),'verify','android','--gradle-input',gradle,'--archive',apk,'--bundle',bundle,'--source-map',map],{cwd:root,encoding:'utf8',timeout:30000});
 pack();assert.equal(verify().status,0);
 const changedDeclaration=structuredClone(approved);changedDeclaration.knownLicenseSources[0].ownText.publisher.metadataSHA256='c'.repeat(64);file('scripts/app-notice-provenance.json',changedDeclaration);assert.equal(verify().status,1,'Final reinspection rejects changed own-text publisher provenance.');file('scripts/app-notice-provenance.json',approved);
 const ownBytes=readFileSync(join(root,ownSource));file(ownSource,Buffer.concat([ownBytes,Buffer.from('changed')]));assert.equal(verify().status,1,'Final reinspection rejects changed own-text bytes.');file(ownSource,ownBytes);assert.equal(verify().status,0);
 file('babel.config.cjs','module.exports={presets:["changed-preset"]};\n');
 assert.deepEqual(captureResolvedInputs(root,'android',paths,gradle).sources,capture.sources,'The selected source paths/bytes remain identical.');
 assert.throws(()=>createNoticeSeal(root,'android',capture),'Unselected dirty tracked build configuration cannot be labeled HEAD.');assert.equal(verify().status,1);
 runGit('add','babel.config.cjs');assert.throws(()=>createNoticeSeal(root,'android',capture),'Staged build configuration drift must fail too.');assert.equal(verify().status,1);
 file('babel.config.cjs',buildConfig);runGit('restore','--staged','--','babel.config.cjs');
 assert.equal(verify().status,0,'Ignored generated build outputs do not make the tracked worktree dirty.');
 const receipt=JSON.parse(readFileSync(join(root,'build/notices/android/final-apk.json')));assert.equal(receipt.inventory.independentFinalComponentInventory,false);
 assert.deepEqual(receipt.nonTextNotices,[{kind:'empty-bytes',source:'third_party_licenses.txt',bytes:0,sha256:digest(''),crc32:'00000000'},{kind:'empty-json-descriptor',source:'third_party_licenses.json',bytes:3,sha256:digest('{}\n'),crc32:'dda1b006'}]);
 pack(false,true);assert.equal(verify().status,1,'An empty retained file cannot satisfy a required nonempty native notice resource.');
 pack(false,'json');assert.equal(verify().status,1,'An empty JSON descriptor cannot satisfy a required nonempty native notice resource.');
 pack();assert.equal(verify().status,0);
 assert.deepEqual(receipt.inventory.resolvedBuildOnly,[{component:'maven:qa:static@1',basis:'reinspected-gradle-artifacts-and-source'}]);
 const missing={...sourceMap,sources:sourceMap.sources.filter((_,i)=>i!==2),sourcesContent:sourceMap.sourcesContent.filter((_,i)=>i!==2)};file('build/actual.map',missing);
 assert.equal(verify().status,1,'Captured asset-only package cannot be supplied back as an observed final component.');
 const extra={...sourceMap,sources:[...sourceMap.sources,'node_modules/extra/index.js'],sourcesContent:[...sourceMap.sourcesContent,'module.exports=0;']};file('build/actual.map',extra);assert.equal(verify().status,1);
 file('build/actual.map',sourceMap);pack(true);assert.equal(verify().status,1,'Unmapped extensionless Mach-O must fail through the production CLI.');
}));


test('actual failure CLI retains only finite Pod context and no private path, body, environment or stack',()=>fixture(({root,file})=>{
 const git=(...args)=>execFileSync('git',['-c','core.hooksPath=/dev/null','-c','commit.gpgsign=false',...args],{cwd:root,stdio:'pipe'});
 file('.gitignore','build/\nnode_modules/\n');file('index.ts','export const fixture=1;');
 file('package-lock.json',{packages:{}});file('node_modules/qa/package.json',{name:'qa',version:'1'});
 file('scripts/app-notice-provenance.json',{schema:1,components:[]});file('scripts/font-icon-provenance.json',fonts);
 file('ios/Podfile.lock','PODS:\n  - QA (1)\n');
 file('ios/Pods/Target Support Files/Pods-QA/Pods-QA-acknowledgements.plist','PRIVATE_NOTICE_BODY\0');
 git('init','--quiet');git('add','.');git('-c','user.name=Notice test','-c','user.email=notice-test@example.invalid','commit','--quiet','-m','Synthetic finite failure');
 const sourceCommit=git('rev-parse','HEAD').toString().trim();
 file('build/notices/ios/seal.json',{sourceCommit,platform:'ios',sources:[{path:'index.ts'}]});
 const result=spawnSync(process.execPath,[fileURLToPath(new URL('./capture-app-notices.mjs',import.meta.url)),'verify','ios','--archive',join(root,'build/never-built.ipa')],{cwd:root,encoding:'utf8',timeout:30000,env:{...process.env,PRIVATE_NOTICE_ENV:'SECRET_ENV_VALUE'}});
 assert.equal(result.status,1);
 const failure=JSON.parse(readFileSync(join(root,'build/notices/ios/failure.json')));
 assert.deepEqual(failure,{schema:1,status:'INCOMPLETE',complete:false,sourceCommit,platform:'ios',stage:'source',native:{operation:'pod-acknowledgements',component:'cocoapods',errorCategory:'invalid-utf8'}});
 const output=JSON.stringify(failure)+result.stdout+result.stderr;
 for(const secret of [root,'PRIVATE_NOTICE_BODY','SECRET_ENV_VALUE','stack','cause','at podNoticeInputs'])assert.ok(!output.includes(secret));
}));


test('actual pinned Metro path serializer returns flat strings including the explicit virtual prelude',async()=>{
 const {createRequire}=await import('node:module'),require=createRequire(import.meta.url);
 const metro=join(require.resolve('metro/package.json'),'../src/DeltaBundler/Serializers/getAllFiles.js');
 const getAllFiles=require(metro).default;
 const path=new URL('../node_modules/react-native/index.js',import.meta.url).pathname;
 const result=await getAllFiles([{path:'__prelude__'}],{dependencies:new Map([[path,{path,output:[{type:'js/module',data:{code:'',lineCount:0,map:[]}}]}]])},{platform:'ios',processModuleFilter:()=>true});
 assert.deepEqual(result,['__prelude__',path]);assert.ok(result.every(value=>typeof value==='string'));
});

test('actual graph failure CLI emits the precise source boundary and known class/code plus hash only',()=>fixture(({root,file})=>{
 const git=(...args)=>execFileSync('git',['-c','core.hooksPath=/dev/null','-c','commit.gpgsign=false',...args],{cwd:root,stdio:'pipe'});
 file('.gitignore','build/\nnode_modules/\n');file('package-lock.json',{packages:{}});file('node_modules/.keep','');
 file('scripts/app-notice-provenance.json',{schema:1,components:[]});file('scripts/font-icon-provenance.json',fonts);
 file('src/PRIVATE_SOURCE/.keep','');
 git('init','--quiet');git('add','.');git('-c','user.name=Notice test','-c','user.email=notice-test@example.invalid','commit','--quiet','-m','Synthetic source boundary');
 const sourceCommit=git('rev-parse','HEAD').toString().trim();
 file('build/notices/ios/seal.json',{sourceCommit,platform:'ios',sources:[{path:'src/PRIVATE_SOURCE'}]});
 const cli=spawnSync(process.execPath,[fileURLToPath(new URL('./capture-app-notices.mjs',import.meta.url)),'verify','ios','--archive',join(root,'build/unused.ipa')],{cwd:root,encoding:'utf8',timeout:30000,env:{...process.env,PRIVATE_NOTICE_ENV:'SECRET_ENV'}});
 assert.equal(cli.status,1);
 const failure=JSON.parse(readFileSync(join(root,'build/notices/ios/failure.json')));
 assert.deepEqual(failure.native,{operation:'source-bytes',component:'metro',errorCategory:'unsupported-input',errorClass:'Error',errorCode:'EISDIR',sourceSHA256:digest(join(realpathSync(root),'src/PRIVATE_SOURCE'))});
 const output=JSON.stringify(failure)+cli.stdout+cli.stderr;
 for(const secret of [root,'PRIVATE_SOURCE','SECRET_ENV','stack','cause','errno','syscall'])assert.ok(!output.includes(secret));
}));


test('actual discovery setup trap keeps original failures and writes finite phases, including metadata-writer failure',()=>fixture(({root,file})=>{
 const git=(...args)=>execFileSync('git',['-c','core.hooksPath=/dev/null','-c','commit.gpgsign=false',...args],{cwd:root,stdio:'pipe'});
 file('fixture.txt','synthetic source');git('init','--quiet');git('add','.');git('-c','user.name=Notice test','-c','user.email=notice-test@example.invalid','commit','--quiet','-m','Synthetic setup receipt');
 const sourceCommit=git('rev-parse','HEAD').toString().trim();
 const cli=fileURLToPath(new URL('./capture-app-notices.mjs',import.meta.url));mkdirSync(join(root,'scripts'));symlinkSync(cli,join(root,'scripts/capture-app-notices.mjs'));
 const npx=file('stubs/npx','#!/bin/sh\nprintf "%s\\n" prebuild >> "$NOTICE_TEST_CALLS"\nexit "$NOTICE_TEST_PREBUILD_STATUS"\n');
 const gradle=file('android/gradlew','#!/bin/sh\nprintf "%s\\n" gradle-resolution >> "$NOTICE_TEST_CALLS"\nexit "$NOTICE_TEST_GRADLE_STATUS"\n');chmodSync(npx,0o700);chmodSync(gradle,0o700);
 const workflow=parse(readFileSync(new URL('../.github/workflows/ios-simulator.yml',import.meta.url),'utf8'));
 const shell=workflow.jobs['notice-discovery'].steps.find(value=>value.name==='Prepare Android dependency inputs').run;
 const calls=join(root,'calls.txt'),failurePath=join(root,'build/notices/android/failure.json');
 for(const value of [{pre:17,gradle:0,phase:'prebuild'},{pre:0,gradle:23,phase:'gradle-resolution'},{pre:0,gradle:0},{pre:17,gradle:0,writerFailure:true}]){
  rmSync(join(root,'build'),{recursive:true,force:true});rmSync(calls,{force:true});if(value.writerFailure)file('build','force receipt writer failure');
  const result=spawnSync('bash',['-e','-o','pipefail','-c',shell],{cwd:root,encoding:'utf8',timeout:30000,env:{...process.env,PATH:join(root,'stubs')+':'+process.env.PATH,NOTICE_TEST_CALLS:calls,NOTICE_TEST_PREBUILD_STATUS:String(value.pre),NOTICE_TEST_GRADLE_STATUS:String(value.gradle),PRIVATE_SETUP_ENV:'SECRET_SETUP_ENV'}});
  assert.equal(result.status,value.pre||value.gradle);
  assert.equal(readFileSync(calls,'utf8'),value.pre?'prebuild\n':'prebuild\ngradle-resolution\n');
  if(value.phase){
   const failure=JSON.parse(readFileSync(failurePath));assert.deepEqual(failure,{schema:1,status:'INCOMPLETE',complete:false,sourceCommit,platform:'android',stage:'setup',setup:{phase:value.phase,errorCategory:'command-failed'}});
   const output=JSON.stringify(failure)+result.stdout+result.stderr;for(const secret of [root,'SECRET_SETUP_ENV','stack','cause'])assert.ok(!output.includes(secret));
  }else assert.equal(spawnSync('test',['-f',failurePath]).status,1);
 }
 rmSync(join(root,'build'),{recursive:true,force:true});
 const invalid=spawnSync(process.execPath,[cli,'setup-failure','android','--phase','PRIVATE_UNKNOWN_PHASE'],{cwd:root,encoding:'utf8',timeout:30000});assert.equal(invalid.status,1);assert.ok(!invalid.stderr.includes('PRIVATE_UNKNOWN_PHASE'));
}));

test('the explicit Expo virtual IDs resolve only to their pinned installed provider',()=>{
 assert.equal(digest('\0polyfill:external-require'),'f32cbb35a430d4c6ee0f555a934acc8f6a83aff8e2b19c414f6d756479b8f03e');
 const provenance={...JSON.parse(readFileSync(new URL('./app-notice-provenance.json',import.meta.url))),components:[]};
 for(const id of ['\0polyfill:external-require','\0polyfill:environment-variables','\0polyfill:assets-registry']){
 const result=capturedSource(process.cwd(),id,provenance);
 assert.deepEqual(result,{path:id,generated:true,provider:'node_modules/expo/node_modules/@expo/cli/build/src/start/server/metro/withMetroMultiPlatform.js',sha256:'50012292a38cb679ca3f692c5a462de57bebe0f69d5c862e937141a3fc54343f',component:'npm:@expo/cli@57.0.26'});
 }
 assert.deepEqual(provenance.components,[],'A technical provider mapping is not reviewed app-library notice coverage.');
});

test('virtual provider mapping rejects modified bytes, wrong path/owner/version and every unknown virtual ID',()=>fixture(({root,file})=>{
 for(const id of ['\0polyfill:external-require','\0polyfill:environment-variables','\0polyfill:assets-registry']){
 const provider='node_modules/expo/node_modules/@expo/cli/build/src/start/server/metro/withMetroMultiPlatform.js',packagePath='node_modules/expo/node_modules/@expo/cli',content='export const fixture=1;';
 const pkg={name:'@expo/cli',version:'1.2.3'},lock={packages:{[packagePath]:{version:'1.2.3'}}};file('package-lock.json',lock);file(packagePath+'/package.json',pkg);file(packagePath+'/LICENSE',mit);file(provider,content);
 const record={provider,sha256:digest(content),component:'npm:@expo/cli@1.2.3'},provenance={generatedSources:{[id]:record}};
 assert.equal(capturedSource(root,id,provenance).component,record.component);
 file(provider,content+'modified');assert.throws(()=>capturedSource(root,id,provenance));file(provider,content);
 assert.throws(()=>capturedSource(root,id,{generatedSources:{[id]:{...record,provider:'node_modules/metro/src/lib/getPreludeCode.js'}}}));
 file(packagePath+'/package.json',{...pkg,version:'9.9.9'});assert.throws(()=>capturedSource(root,id,provenance));
 file('package-lock.json',{packages:{[packagePath]:{version:'9.9.9'}}});assert.throws(()=>capturedSource(root,id,provenance),'Updating installed and locked version cannot evade the committed component pin.');
 file('package-lock.json',lock);file(packagePath+'/package.json',{...pkg,name:'private-other'});assert.throws(()=>capturedSource(root,id,provenance));file(packagePath+'/package.json',pkg);
 for(const unknown of ['\0polyfill:unknown','\0node:private','\0shim:private']){
  assert.throws(()=>capturedSource(root,unknown,provenance));
  assert.throws(()=>capturedSource(root,unknown,{generatedSources:{[unknown]:record}}),'An arbitrary virtual ID cannot reuse an allowed provider.');
 }
 }
}));

test('setup failure CLI retains only matching finite Gradle collector context and strips every untrusted record',()=>fixture(({root,file})=>{
 const git=(...args)=>execFileSync('git',['-c','core.hooksPath=/dev/null','-c','commit.gpgsign=false',...args],{cwd:root,stdio:'pipe'});
 file('fixture.txt','synthetic');git('init','--quiet');git('add','.');git('-c','user.name=Notice test','-c','user.email=notice-test@example.invalid','commit','--quiet','-m','Synthetic collector metadata');
 const sourceCommit=git('rev-parse','HEAD').toString().trim(),path='build/notices/android/failure.json';
 const generic={schema:1,status:'INCOMPLETE',complete:false,sourceCommit,platform:'android',stage:'setup',setup:{phase:'gradle-resolution',errorCategory:'command-failed'}};
 const chain=[{errorClass:'ResolveException',classSHA256:digest('org.gradle.api.artifacts.ResolveException')},{errorClass:'Throwable',classSHA256:digest('PRIVATE_UNKNOWN_CLASS')}],collector={phase:'runtime-resolution',errorClass:'ResolveException',causeChain:chain,causeChainEnd:'end'};
 const known={...generic,setup:{...generic.setup,collector}};
 const cli=phase=>spawnSync(process.execPath,[fileURLToPath(new URL('./capture-app-notices.mjs',import.meta.url)),'setup-failure','android','--phase',phase],{cwd:root,encoding:'utf8',timeout:30000});
 file(path,known);assert.equal(cli('gradle-resolution').status,0);assert.deepEqual(JSON.parse(readFileSync(join(root,path))),known);
 for(const changed of [{...known,sourceCommit:'b'.repeat(40)},{...known,privateMessage:'PRIVATE_BODY'},{...known,setup:{...known.setup,collector:{phase:'PRIVATE_PHASE',errorClass:'ResolveException'}}},{...known,setup:{...known.setup,collector:{phase:'runtime-resolution',errorClass:'PRIVATE_CLASS'}}},'PRIVATE_BODY'.repeat(500)]){
  file(path,changed);const result=cli('gradle-resolution');assert.equal(result.status,0);
  const value=JSON.parse(readFileSync(join(root,path)));assert.deepEqual(value,generic);assert.ok(!(JSON.stringify(value)+result.stdout+result.stderr).includes('PRIVATE'));
 }
 for(const bad of [{causeChain:[]},{causeChain:Array(9).fill(chain[0])},{causeChain:[{...chain[0],message:'PRIVATE_MESSAGE'}]},{causeChain:[{...chain[0],classSHA256:'PRIVATE_CLASS'}]},{causeChain:[{...chain[0],classSHA256:[chain[0].classSHA256]}]},{causeChain:[{...chain[0],errorClass:'PRIVATE_CLASS'}]},{causeChain:[chain[1]]},{causeChainEnd:'PRIVATE_END'},{causeChainEnd:'limit'}]){
  file(path,{...known,setup:{...known.setup,collector:{...collector,...bad}}});const result=cli('gradle-resolution');assert.equal(result.status,0);assert.deepEqual(JSON.parse(readFileSync(join(root,path))),generic);assert.ok(!(readFileSync(join(root,path),'utf8')+result.stdout+result.stderr).includes('PRIVATE'));
 }
 for(const end of ['end','cycle','unreadable','limit']){const causes=end==='limit'?Array(8).fill(chain[0]):chain;const value={...known,setup:{...known.setup,collector:{...collector,causeChain:causes,causeChainEnd:end}}};file(path,value);assert.equal(cli('gradle-resolution').status,0);assert.deepEqual(JSON.parse(readFileSync(join(root,path))),value);}
 const leaf={errorClass:'GradleException',classSHA256:'2a5335183636baba800ed56814f24536518c33cbd68932ba9a3fd10004d2b5fd'},selection={failureClassSHA256:digest('PRIVATE_FAILURE_CLASS'),componentKind:'module',componentSHA256:digest('PRIVATE_COMPONENT')};
 for(const componentKind of ['module','main-project']){const value={...known,setup:{...known.setup,collector:{...collector,causeChain:[chain[0],leaf],selection:{...selection,componentKind}}}};file(path,value);assert.equal(cli('gradle-resolution').status,0);assert.deepEqual(JSON.parse(readFileSync(join(root,path))),value);}
 for(const bad of [{...selection,message:'PRIVATE_BODY'},{...selection,componentKind:'PRIVATE_KIND'},{...selection,componentSHA256:'PRIVATE_COMPONENT'},{...selection,failureClassSHA256:[selection.failureClassSHA256]},null]){file(path,{...known,setup:{...known.setup,collector:{...collector,causeChain:[chain[0],leaf],selection:bad}}});assert.equal(cli('gradle-resolution').status,0);assert.deepEqual(JSON.parse(readFileSync(join(root,path))),generic);}
 file(path,{...known,setup:{...known.setup,collector:{...collector,selection}}});assert.equal(cli('gradle-resolution').status,0);assert.deepEqual(JSON.parse(readFileSync(join(root,path))),generic,'An unknown leaf cannot attach selector context.');
 file(path,{...known,setup:{...known.setup,collector:{...collector,causeChain:[chain[0],leaf,leaf],selection}}});assert.equal(cli('gradle-resolution').status,0);assert.deepEqual(JSON.parse(readFileSync(join(root,path))),generic,'Competing selection leaves cannot attach ambiguous context.');
 file(path,known);assert.equal(cli('prebuild').status,0);assert.deepEqual(JSON.parse(readFileSync(join(root,path))),{...generic,setup:{phase:'prebuild',errorCategory:'command-failed'}});
}));


test('actual pinned native polyfills and this app font asset route prove the two additional exact virtual providers',async()=>{
 const {createRequire}=await import('node:module'),require=createRequire(import.meta.url);
 const provider='node_modules/expo/node_modules/@expo/cli/build/src/start/server/metro/withMetroMultiPlatform.js',source=readFileSync(provider,'utf8');
 assert.equal(digest(source),'50012292a38cb679ca3f692c5a462de57bebe0f69d5c862e937141a3fc54343f');
 const providerRequire=createRequire(join(process.cwd(),provider)),tree=require('@babel/parser').parse(source,{sourceType:'script'});
 const definition=tree.program.body.find(value=>value.type==='FunctionDeclaration'&&value.id.name==='withWebPolyfills');assert.ok(definition);
 const fn=Function('_metroVirtualModules','require','debug','return ('+source.slice(definition.start,definition.end)+');')(providerRequire('./metroVirtualModules.js'),providerRequire,()=>{});
 const makeBundler=()=>({transformFile(){},_depGraph:{_fileSystem:{getSha1(){return 'source-only';}}}}),polyfillBundler=makeBundler();
 const configured=fn({serializer:{getPolyfills:()=>[]}},{getMetroBundler:()=>polyfillBundler});
 const polyfills=configured.serializer.getPolyfills({platform:'ios'});
 assert.deepEqual(polyfills.slice(0,2),['\0polyfill:external-require','\0polyfill:environment-variables']);
 assert.equal(polyfillBundler._depGraph._fileSystem.expoVirtualModules.get('\0polyfill:environment-variables').toString(),'//','This proof never generates or reads dynamic environment values.');
 assert.ok(readFileSync('App.tsx','utf8').includes("from '@expo/vector-icons/MaterialCommunityIcons'"));
 assert.ok(readFileSync('node_modules/@expo/vector-icons/build/MaterialCommunityIcons.js','utf8').includes('./vendor/react-native-vector-icons/Fonts/MaterialCommunityIcons.ttf'));
 const registry='@react-native/assets-registry/registry';assert.ok(readFileSync('node_modules/@expo/metro-config/build/ExpoMetroConfig.js','utf8').includes("assetRegistryPath: '"+registry+"'"));
 const ast=require(join(process.cwd(),'node_modules/metro/src/Bundler/util.js')).generateAssetCodeFileAst(registry,{__packager_asset:true,name:'MaterialCommunityIcons',type:'ttf',scales:[1]});
 const requires=[];const walk=value=>{if(!value||typeof value!=='object')return;if(value.type==='CallExpression'&&value.callee?.name==='require')requires.push(value.arguments[0].value);for(const child of Object.values(value))if(Array.isArray(child))child.forEach(walk);else if(child&&typeof child==='object')walk(child);};walk(ast);assert.deepEqual(requires,[registry]);
 const bundler=makeBundler(),config={projectRoot:process.cwd(),resolver:{platforms:['ios','android'],sourceExts:['js','jsx','ts','tsx','json'],nodeModulesPaths:[],unstable_conditionNames:[],unstable_conditionsByPlatform:{}},serializer:{},transformer:{asyncRequireModulePath:'@expo/metro-runtime/async-require',assetRegistryPath:registry}};
 const extended=providerRequire(providerRequire.resolve('./withMetroMultiPlatform.js')).withExtendedResolver(config,{isTsconfigPathsEnabled:false,isExporting:true,isReactServerComponentsEnabled:false,getMetroBundler:()=>bundler});
 for(const platform of ['ios','android'])assert.deepEqual(extended.resolver.resolveRequest({originModulePath:join(process.cwd(),'node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/MaterialCommunityIcons.ttf'),dev:false,customResolverOptions:{},resolveRequest(){throw new Error('Unintercepted asset request');}},registry,platform),{type:'sourceFile',filePath:'\0polyfill:assets-registry'});
 assert.ok(bundler._depGraph._fileSystem.expoVirtualModules.has('\0polyfill:assets-registry'));
});

function knownOwnTextFixture(run){return fixture(({root,file})=>{
 const provenance={...JSON.parse(readFileSync(new URL('./app-notice-provenance.json',import.meta.url))),components:[]},pins=provenance.knownLicenseSources.filter(value=>value.ownText&&value.ecosystem==='npm'),installed=JSON.parse(readFileSync(new URL('../package-lock.json',import.meta.url))),paths=[];
 assert.equal(pins.length,6);file('package-lock.json',{packages:Object.fromEntries(pins.map(pin=>[pin.ownText.packagePath,installed.packages[pin.ownText.packagePath]]))});
 for(const pin of pins){for(const source of [pin.ownText.packageJSONSource,...pin.ownText.selectedSources.map(value=>value.source),pin.source])file(source,readFileSync(new URL('../'+source,import.meta.url)));paths.push(join(root,pin.ownText.selectedSources[0].source));}
 const raw=()=>npmNoticeInputs(root,paths),capture=(ledger=provenance)=>addKnownOwnNoticeFiles(root,raw(),ledger);
 return run({root,file,provenance,pins,paths,raw,capture});
});}

test('six exact npm own-text records append public attribution without component, parent or vendor approval',()=>knownOwnTextFixture(({root,provenance,pins,raw,capture})=>{
 const before=raw(),items=capture();assert.equal(items.length,6);assert.equal(provenance.components.length,0);assert.ok(before.every(item=>item.notices.length===0));
 for(const item of items){const pin=pins.find(pin=>pin.component===item.id);assert.equal(item.notices.length,1);assert.equal(item.notices[0].sha256,pin.sha256);assert.ok(Buffer.from(item.notices[0].body).equals(readFileSync(join(root,pin.source))));assert.equal(item.nativeInputs.ownAttribution.ownerNpmID,item.id);assert.deepEqual(item.nativeInputs.ownAttribution.publisherDeclaration,pin.ownText.publisher);assert.deepEqual(item.vendors,before.find(value=>value.id===item.id).vendors);}
 const report=unreviewedOSSNoticeInputs(items,provenance);assert.equal(report.components.length,6);assert.equal(report.complete,false);assert.ok(!JSON.stringify(report).includes(root));assert.equal(resolveNoticeCoverage(items,provenance).status,'INCOMPLETE');assert.ok(resolveNoticeCoverage(items,provenance).unresolved.every(row=>row.reason==='unreviewed-component'));
 assert.equal(unreviewedOSSNoticeInputs(items,{...provenance,knownLicenseSources:[]}).components.length,0);
}));

test('own-text matched selectors reject changed bytes, owners, lock pins and unknown fields without fallback',()=>knownOwnTextFixture(({root,file,provenance,pins,raw,capture})=>{
 const pin=pins[0],mutate=(source,body)=>{const path=join(root,source),before=readFileSync(path);writeFileSync(path,body);assert.throws(capture);writeFileSync(path,before);};
 for(const source of [pin.source,pin.ownText.packageJSONSource,pin.ownText.selectedSources[0].source])mutate(source,Buffer.concat([readFileSync(join(root,source)),Buffer.from('changed')]));
 mutate(pin.source,'');const lock=JSON.parse(readFileSync(join(root,'package-lock.json')));for(const field of ['version','resolved','integrity']){const changed=structuredClone(lock);changed.packages[pin.ownText.packagePath][field]='changed';mutate('package-lock.json',JSON.stringify(changed));}
 for(const update of [p=>p.ownText.kind='unknown',p=>p.ownText.ownerNpmID='npm:other@1',p=>p.ownText.packagePath='node_modules/other',p=>p.ownText.publisher.gitHead='a'.repeat(40),p=>p.ownText.publisher.metadataURL='https://private.invalid/',p=>p.ownText.extra='PRIVATE',p=>p.ownText.selectedSources[0].source='node_modules/other/private.js',p=>p.source='../PRIVATE']){const changed=structuredClone(provenance);update(changed.knownLicenseSources.find(value=>value.component===pin.component));assert.throws(()=>capture(changed));}
 const old=join(root,pin.source),body=readFileSync(old);rmSync(old);symlinkSync(file('outside-private.txt',body),old);assert.throws(capture);rmSync(old);file(pin.source,body);
 const foreign=file('node_modules/unknown/index.js','source');file('node_modules/unknown/package.json',{name:'unknown',version:'1',license:'MIT'});file('node_modules/unknown/LICENSE',mit);const changed=JSON.parse(readFileSync(join(root,'package-lock.json')));changed.packages['node_modules/unknown']={version:'1'};file('package-lock.json',changed);const unknown=npmNoticeInputs(root,[foreign]);assert.deepEqual(addKnownOwnNoticeFiles(root,unknown,provenance),unknown);
 const current=raw()[0],version={...current,id:`npm:${current.name}@999`,version:'999'};assert.equal(addKnownOwnNoticeFiles(root,[version],provenance)[0].nativeInputs,undefined);
}));

test('reviewed publisher declarations and text-source provenance are fingerprinted, not runtime metadata verification',()=>knownOwnTextFixture(({provenance,pins,capture})=>{
 const items=capture(),item=items.find(item=>item.id===pins[0].component),approved={schema:1,components:[review(item)]};assert.equal(resolveNoticeCoverage([item],approved).status,'READY');
 for(const change of [pin=>pin.ownText.publisher.metadataSHA256='f'.repeat(64),pin=>{pin.ownText.publisher.gitHead='e'.repeat(40);pin.upstream=pin.upstream.replace(/[a-f0-9]{40}/,'e'.repeat(40));}]){const declaration=structuredClone(provenance);change(declaration.knownLicenseSources.find(pin=>pin.component===item.id));const changed=capture(declaration).find(value=>value.id===item.id);assert.equal(resolveNoticeCoverage([changed],approved).unresolved[0].reason,'native-source-digest-mismatch');}
 const removed={...item,nativeInputs:{}};assert.equal(resolveNoticeCoverage([removed],approved).unresolved[0].reason,'native-source-digest-mismatch');const textDropped={...item,notices:[]};assert.equal(resolveNoticeCoverage([textDropped],approved).unresolved[0].reason,'missing-notice-text');
}));

test('injected own text preserves discovered NOTICEs and cannot satisfy vendored-source attribution',()=>knownOwnTextFixture(({root,file,provenance,pins})=>{
 const pin=pins[0],source=file(pin.ownText.packagePath+'/vendor/separate/index.js','vendored source');file(pin.ownText.packagePath+'/NOTICE','Separate preserved NOTICE');
 const original=npmNoticeInputs(root,[source])[0],item=addKnownOwnNoticeFiles(root,[original],provenance)[0];assert.ok(item.notices.some(value=>value.source===original.notices[0].source&&value.sha256===original.notices[0].sha256));assert.deepEqual(item.vendorNotices,original.vendorNotices);assert.equal(resolveNoticeCoverage([item],{schema:1,components:[review(item)]}).unresolved[0].reason,'missing-vendored-notice');
}));

const reviewedIosMITComponents=['npm:@react-native/assets-registry@0.86.3','npm:@react-native/js-polyfills@0.86.3','npm:@react-native/normalize-colors@0.86.3','npm:@react-native/virtualized-lists@0.86.3','npm:qrcode-generator@2.0.4'];
const fiveReviewedLedger=()=>{const value=JSON.parse(readFileSync(new URL('./app-notice-provenance.json',import.meta.url)));return {...value,components:value.components.filter(record=>reviewedIosMITComponents.includes(record.component))};};
test('five exact iOS MIT reviews qualify only their actual captured owning provenance and original bodies',()=>knownOwnTextFixture(({root,capture})=>{
 const approved=fiveReviewedLedger(),items=capture(),coverage=resolveNoticeCoverage(items,approved);
 assert.deepEqual(approved.components.map(value=>value.component),reviewedIosMITComponents);assert.ok(approved.components.every(value=>value.platform==='ios'));
 assert.equal(coverage.status,'INCOMPLETE');assert.deepEqual(coverage.unresolved,[{component:'npm:@expo/ui@57.0.25',reason:'unreviewed-component'}]);assert.equal(coverage.sections.length,5);
 for(const record of approved.components){const item=items.find(value=>value.id===record.component),section=coverage.sections.find(value=>value.id==='library-'+digest('ios:'+item.id).slice(0,24));assert.deepEqual(item.nativeInputs,record.nativeInputs);assert.ok(Buffer.from(section.body).equals(readFileSync(join(root,item.notices[0].source))));assert.equal(digest(section.body),record.sectionSHA256);assert.equal(section.iosOnly,true);assert.equal(section.androidOnly,undefined);}
}));

test('the five reviews reject owning-source/notice/native drift, vendors and inferred sibling or Android approval',()=>knownOwnTextFixture(({capture})=>{
 const approved=fiveReviewedLedger(),items=capture().filter(value=>reviewedIosMITComponents.includes(value.id));
 const reject=(item,change,reason)=>{const changed=structuredClone(item);change(changed);assert.equal(resolveNoticeCoverage([changed],approved).unresolved[0].reason,reason);};
 for(const item of items){
  reject(item,value=>value.nativeInputs.ownAttribution.packageJSON.sha256='f'.repeat(64),'native-source-digest-mismatch');
  reject(item,value=>value.notices[0].sha256='f'.repeat(64),'notice-set-or-digest-mismatch');
  reject(item,value=>value.nativeInputs.unreviewedNativeInput={sha256:'f'.repeat(64)},'native-source-digest-mismatch');
  reject(item,value=>value.vendors.push('Unreviewed.xcframework'),'unreviewed-vendored-source');
  reject(item,value=>{value.id+='-unknown-sibling';},'unreviewed-component');
  reject(item,value=>{value.id=value.id.slice(0,value.id.lastIndexOf('@')+1)+'999';value.version='999';},'unreviewed-component');
 }
 assert.equal(resolveNoticeCoverage(items,approved,'android').unresolved.length,5);assert.ok(resolveNoticeCoverage(items,approved,'android').unresolved.every(value=>value.reason==='unreviewed-component'));
}));

test('five component reviews cannot seal the unchanged font-only payload',()=>knownOwnTextFixture(({capture})=>{
 const approved=fiveReviewedLedger(),items=capture().filter(value=>reviewedIosMITComponents.includes(value.id)),coverage=resolveNoticeCoverage(items,approved),payload=readFileSync(new URL('../assets/notices/third_party_notices.json',import.meta.url)),fontProvenance=JSON.parse(readFileSync(new URL('./font-icon-provenance.json',import.meta.url)));
 assert.equal(coverage.status,'READY');assert.throws(()=>assertSourceNoticePayload(payload,coverage,approved,fontProvenance),/Actual included library differs from the committed union/);
}));

const reviewedRuntimeComponents=['npm:@babel/runtime@7.29.7','npm:abort-controller@3.0.0','npm:base64-js@1.5.1','npm:event-target-shim@5.0.1','npm:flow-enums-runtime@0.0.6','npm:invariant@2.2.4','npm:memoize-one@5.2.1','npm:nullthrows@1.1.1','npm:promise@8.3.0','npm:react-is@16.13.1','npm:react@19.2.3','npm:regenerator-runtime@0.13.11','npm:scheduler@0.27.0','npm:stacktrace-parser@0.1.11','npm:whatwg-fetch@3.6.20'];
const twentyOneReviewedLedger=()=>{const value=JSON.parse(readFileSync(new URL('./app-notice-provenance.json',import.meta.url)));return {...value,components:value.components.slice(0,21),knownLicenseSources:value.knownLicenseSources.slice(0,128)};};
function runtimeNoticeFixture(run,approved=twentyOneReviewedLedger(),pins=approved.knownLicenseSources.filter(pin=>reviewedRuntimeComponents.includes(pin.component))){return fixture(({root,file})=>{
 const installed=JSON.parse(readFileSync(new URL('../package-lock.json',import.meta.url))),packages={},paths=[];
 for(const pin of pins){const packagePath=pin.source.slice(0,pin.source.lastIndexOf('/'));packages[packagePath]=installed.packages[packagePath];for(const source of [packagePath+'/package.json',pin.source])file(source,readFileSync(new URL('../'+source,import.meta.url)));paths.push(file(packagePath+'/selected.js','export const syntheticSelectedSource=1;\n'));}
 file('package-lock.json',{packages});return run({root,file,approved,pins,paths,capture:()=>npmNoticeInputs(root,paths)});
});}

test('the explicit21 review fixture preserves exact iOS reviews and15 public runtime text pins',()=>runtimeNoticeFixture(({root,approved,pins,capture})=>{
 assert.deepEqual(approved.components.map(value=>value.component),[...reviewedIosMITComponents,...reviewedRuntimeComponents,'cocoapods:ExpoFileSystem@57.0.7']);assert.ok(approved.components.every(value=>value.platform==='ios'));assert.equal(approved.knownLicenseSources.length,128);assert.deepEqual(pins.map(value=>value.component),reviewedRuntimeComponents);
 const items=capture(),coverage=resolveNoticeCoverage(items,approved),publicInput=unreviewedOSSNoticeInputs(items,approved),lock=JSON.parse(readFileSync(new URL('../package-lock.json',import.meta.url)));
 assert.equal(items.length,15);assert.equal(coverage.status,'READY');assert.equal(coverage.sections.length,15);assert.equal(publicInput.components.length,15);
 for(const pin of pins){const item=items.find(value=>value.id===pin.component),packagePath=pin.source.slice(0,pin.source.lastIndexOf('/'));assert.equal(pin.upstream,lock.packages[packagePath].resolved);assert.equal(pin.upstreamIntegrity,lock.packages[packagePath].integrity);assert.equal(item.notices.length,1);assert.equal(item.notices[0].sha256,pin.sha256);assert.ok(Buffer.from(item.notices[0].body).equals(readFileSync(join(root,pin.source))));assert.equal(approved.components.find(value=>value.component===item.id).sectionSHA256,pin.sha256);assert.deepEqual(item.vendors,[]);assert.deepEqual(item.nativeInputs??{},{});}
}));

test('runtime reviews keep changed text, additional NOTICE, native inputs, vendors, unknowns and Android unapproved',()=>runtimeNoticeFixture(({root,file,approved,pins,paths,capture})=>{
 const items=capture();for(const item of items){
  const changed=structuredClone(item);changed.nativeInputs={unreviewedNative:'synthetic'};assert.equal(resolveNoticeCoverage([changed],approved).unresolved[0].reason,'native-source-digest-mismatch');
  const sibling={...item,id:item.id+'-unreviewed'};assert.equal(resolveNoticeCoverage([sibling],approved).unresolved[0].reason,'unreviewed-component');
  const version={...item,id:item.id.slice(0,item.id.lastIndexOf('@')+1)+'999',version:'999'};assert.equal(resolveNoticeCoverage([version],approved).unresolved[0].reason,'unreviewed-component');
 }
 assert.equal(resolveNoticeCoverage(items,approved,'android').unresolved.length,15);
 const pin=pins[0],original=readFileSync(join(root,pin.source));file(pin.source,Buffer.concat([original,Buffer.from('PRIVATE_SYNTHETIC_CHANGED_TEXT')]));let changed=capture();assert.equal(resolveNoticeCoverage(changed,approved).unresolved[0].reason,'notice-set-or-digest-mismatch');assert.ok(!JSON.stringify(unreviewedOSSNoticeInputs(changed,approved)).includes('PRIVATE_SYNTHETIC_CHANGED_TEXT'));file(pin.source,original);
 const packagePath=pin.source.slice(0,pin.source.lastIndexOf('/')),notice=file(packagePath+'/NOTICE','A separate original notice');assert.equal(resolveNoticeCoverage(capture(),approved).unresolved[0].reason,'notice-set-or-digest-mismatch');rmSync(notice);
 const vendor=file(packagePath+'/vendor/separate/selected.js','Synthetic independently attributed vendor');assert.equal(resolveNoticeCoverage(npmNoticeInputs(root,[vendor]),approved).unresolved[0].reason,'unreviewed-vendored-source');
 const unknown=file('node_modules/unreviewed-sibling/index.js','source');file('node_modules/unreviewed-sibling/package.json',{name:'unreviewed-sibling',version:'1'});file('node_modules/unreviewed-sibling/LICENSE',original);const lock=JSON.parse(readFileSync(join(root,'package-lock.json')));lock.packages['node_modules/unreviewed-sibling']={version:'1'};file('package-lock.json',lock);const unreviewed=npmNoticeInputs(root,[unknown]);assert.equal(resolveNoticeCoverage(unreviewed,approved).unresolved[0].reason,'unreviewed-component');assert.equal(unreviewedOSSNoticeInputs(unreviewed,approved).components.length,0);
}));

test('ExpoFileSystem review binds only its exact63-file product and three own framework notice mappings',()=>{
 const approved=twentyOneReviewedLedger(),record=approved.components.find(value=>value.component==='cocoapods:ExpoFileSystem@57.0.7'),source='node_modules/expo-file-system/LICENSE',sha256='fb3ca4a837f5779e83cef89b78253a8949cfb9429c340309f62d0465ec6610b4',body=readFileSync(new URL('../'+source,import.meta.url),'utf8'),vendors=['ExpoFileSystem.xcframework','ExpoFileSystem.xcframework/ios-arm64/ExpoFileSystem.framework','ExpoFileSystem.xcframework/ios-arm64_x86_64-simulator/ExpoFileSystem.framework'];
 assert.deepEqual(record.reviewedVendors,vendors);assert.deepEqual(record.vendorNoticeSources,Object.fromEntries(vendors.map(value=>[value,[source]])));assert.equal(record.nativeInputs['cocoapods:ExpoFileSystem'].sha256,'2170187d5f6c7e19a06acf677791826a325457b75e4f15541f452b605edc646e');assert.equal(record.nativeInputs['cocoapods:ExpoFileSystem'].files,63);assert.equal(digest(body),sha256);
 const item=nativeNoticeInput({id:record.component,name:'ExpoFileSystem',version:'57.0.7',ecosystem:'cocoapods',vendors,notices:[{source,sha256,body}],nativeInputs:record.nativeInputs});assert.equal(resolveNoticeCoverage([item],approved).status,'READY');
 const changed=structuredClone(item);changed.nativeInputs['cocoapods:ExpoFileSystem'].sha256='f'.repeat(64);assert.equal(resolveNoticeCoverage([changed],approved).unresolved[0].reason,'native-source-digest-mismatch');
 for(const vendor of ['Unreviewed.xcframework','React.xcframework'])assert.equal(resolveNoticeCoverage([{...item,vendors:[...vendors,vendor]}],approved).unresolved[0].reason,'unreviewed-vendored-source');
 const mapping=structuredClone(approved);delete mapping.components.find(value=>value.component===record.component).vendorNoticeSources[vendors[0]];assert.equal(resolveNoticeCoverage([item],mapping).unresolved[0].reason,'missing-vendored-notice');
 assert.equal(resolveNoticeCoverage([{...item,notices:[{source,sha256:'f'.repeat(64),body}]}],approved).unresolved[0].reason,'notice-set-or-digest-mismatch');assert.throws(()=>nativeNoticeInput({...item,notices:[{source,sha256,body:body+'changed'}]}));assert.equal(resolveNoticeCoverage([item],approved,'android').unresolved[0].reason,'unreviewed-component');
});

const expoOwnProducts=[['ExpoFont','57.0.4','expo-font','1b4c071b9f19595a2fd3f6f9a12b17b3205b97a5a3673805c722a4aaacb35db6',35],['ExpoModulesCore','57.0.18','expo-modules-core','a822393fbf5a3da4d319e10c55e313a6e5a0c8a93eea610183e923fd6a1f3c10',193],['ExpoModulesWorklets','57.0.18','expo-modules-core','c1dfd76bbc396c9bffa4b05cbaee14bb4063ae9898caaf14f1f91faf5cc7c33c',49]];
const twentyFourReviewedLedger=()=>{const value=JSON.parse(readFileSync(new URL('./app-notice-provenance.json',import.meta.url)));return {...value,components:value.components.slice(0,24),knownLicenseSources:value.knownLicenseSources.slice(0,128)};};
test('the explicit24 review fixture preserves the21 scope and adds only the three Expo own products',()=>{
 const approved=twentyFourReviewedLedger();assert.deepEqual(approved.components.map(value=>value.component),[...reviewedIosMITComponents,...reviewedRuntimeComponents,'cocoapods:ExpoFileSystem@57.0.7',...expoOwnProducts.map(([name,version])=>`cocoapods:${name}@${version}`)]);assert.ok(approved.components.every(value=>value.platform==='ios'));assert.equal(approved.knownLicenseSources.length,128);
});

test('three Expo product reviews bind exact native/notice maps and reject extra vendors, drift, unknowns and Android',()=>{
 const approved=twentyFourReviewedLedger(),sha256='fb3ca4a837f5779e83cef89b78253a8949cfb9429c340309f62d0465ec6610b4';
 for(const [name,version,owner,fingerprint,files] of expoOwnProducts){
  const record=approved.components.find(value=>value.component===`cocoapods:${name}@${version}`),source=`node_modules/${owner}/LICENSE`,body=readFileSync(new URL('../'+source,import.meta.url),'utf8'),vendors=[`${name}.xcframework`,`${name}.xcframework/ios-arm64/${name}.framework`,`${name}.xcframework/ios-arm64_x86_64-simulator/${name}.framework`],key='cocoapods:'+name;
  assert.deepEqual(record.reviewedVendors,vendors);assert.deepEqual(record.vendorNoticeSources,Object.fromEntries(vendors.map(value=>[value,[source]])));assert.deepEqual(Object.keys(record.nativeInputs),[key]);assert.equal(record.nativeInputs[key].sha256,fingerprint);assert.equal(record.nativeInputs[key].files,files);assert.equal(record.nativeInputs[key].ownLicense.packagePath,'node_modules/'+owner);assert.equal(digest(body),sha256);
  const item=nativeNoticeInput({id:record.component,name,version,ecosystem:'cocoapods',vendors,notices:[{source,sha256,body}],nativeInputs:record.nativeInputs});assert.equal(resolveNoticeCoverage([item],approved).status,'READY');assert.equal(unreviewedOSSNoticeInputs([item],approved).components.length,1);
  for(const change of [value=>value[key].sha256='f'.repeat(64),value=>value[key].files++,value=>value[key].frameworkInputList.sha256='f'.repeat(64),value=>value[key].ownLicense.podspec.sha256='f'.repeat(64)]){const changed=structuredClone(item);change(changed.nativeInputs);assert.equal(resolveNoticeCoverage([changed],approved).unresolved[0].reason,'native-source-digest-mismatch');}
  for(const vendor of ['Unreviewed.xcframework','React.xcframework','Hermes.framework','JSI.framework'])assert.equal(resolveNoticeCoverage([{...item,vendors:[...vendors,vendor]}],approved).unresolved[0].reason,'unreviewed-vendored-source');
  const mapping=structuredClone(approved);mapping.components.find(value=>value.component===record.component).vendorNoticeSources[vendors[0]]=['node_modules/another-owner/LICENSE'];assert.equal(resolveNoticeCoverage([item],mapping).unresolved[0].reason,'missing-vendored-notice');
  assert.equal(resolveNoticeCoverage([{...item,notices:[{source,sha256:'f'.repeat(64),body}]}],approved).unresolved[0].reason,'notice-set-or-digest-mismatch');assert.throws(()=>nativeNoticeInput({...item,notices:[{source,sha256,body:body+'changed'}]}));assert.equal(resolveNoticeCoverage([{...item,id:'cocoapods:UnreviewedSibling@1'}],approved).unresolved[0].reason,'unreviewed-component');assert.equal(resolveNoticeCoverage([item],approved,'android').unresolved[0].reason,'unreviewed-component');
 }
});

const reviewedExpoJsComponents=["npm:expo-apple-authentication@57.0.2","npm:expo-application@57.0.3","npm:expo-asset@57.0.18","npm:expo-audio@57.0.5","npm:expo-blur@57.0.3","npm:expo-constants@57.0.22","npm:expo-crypto@57.0.4","npm:expo-document-picker@57.0.3","npm:expo-file-system@57.0.7","npm:expo-font@57.0.4","npm:expo-haptics@57.0.3","npm:expo-image-manipulator@57.0.21","npm:expo-image-picker@57.0.20","npm:expo-linking@57.0.13","npm:expo-modules-core@57.0.18","npm:expo-network@57.0.2","npm:expo-notifications@57.0.20","npm:expo-secure-store@57.0.4","npm:expo-sharing@57.0.21","npm:expo-speech-recognition@57.0.0","npm:expo-sqlite@57.0.4","npm:expo-status-bar@57.0.1","npm:expo-web-browser@57.0.3","npm:expo-widgets@57.0.26","npm:expo@57.0.24"];

const expoJsSourceLedger=(()=>{const value=JSON.parse(readFileSync(new URL('./app-notice-provenance.json',import.meta.url)));return {...value,components:value.components.slice(0,49),knownLicenseSources:value.knownLicenseSources.slice(0,152)};})();
const expoJsSourcePins=reviewedExpoJsComponents.map(component=>component==='npm:expo@57.0.24'?expoJsSourceLedger.knownLicenseSources.find(pin=>pin.component===component):expoJsSourceLedger.knownLicenseSources.slice(128).find(pin=>pin.component===component));
test('the explicit49 review fixture preserves24 reviews and128 pins, adds24 exact pins and reuses Expo tuple',()=>{
 assert.deepEqual(expoJsSourceLedger.components.map(value=>value.component),[...reviewedIosMITComponents,...reviewedRuntimeComponents,'cocoapods:ExpoFileSystem@57.0.7',...expoOwnProducts.map(([name,version])=>`cocoapods:${name}@${version}`),...reviewedExpoJsComponents]);assert.ok(expoJsSourceLedger.components.every(value=>value.platform==='ios'));assert.equal(expoJsSourceLedger.knownLicenseSources.length,152);assert.deepEqual(expoJsSourceLedger.knownLicenseSources.slice(128).map(pin=>pin.component),reviewedExpoJsComponents.filter(value=>value!=='npm:expo@57.0.24'));
 assert.deepEqual(expoJsSourcePins.at(-1),{component:'npm:expo@57.0.24',ecosystem:'npm',version:'57.0.24',public:true,source:'node_modules/expo/LICENSE',sha256:'fb3ca4a837f5779e83cef89b78253a8949cfb9429c340309f62d0465ec6610b4',upstream:'https://github.com/expo/expo/blob/sdk-57/LICENSE'});
});
test('25 Expo JS reviews preserve all original notice bytes and explicit public source qualification',()=>runtimeNoticeFixture(({root,approved,pins,capture})=>{
 const items=capture(),coverage=resolveNoticeCoverage(items,approved),publicInput=unreviewedOSSNoticeInputs(items,approved),lock=JSON.parse(readFileSync(new URL('../package-lock.json',import.meta.url)));assert.equal(items.length,25);assert.equal(coverage.status,'READY');assert.equal(coverage.sections.length,25);assert.equal(publicInput.components.length,25);
 for(const pin of pins){const item=items.find(value=>value.id===pin.component),packagePath=pin.source.slice(0,pin.source.lastIndexOf('/')),record=approved.components.find(value=>value.component===item.id);assert.equal(record.upstream,lock.packages[packagePath].resolved);if(pin.component!=='npm:expo@57.0.24'){assert.equal(pin.upstream,lock.packages[packagePath].resolved);assert.equal(pin.upstreamIntegrity,lock.packages[packagePath].integrity);}assert.deepEqual(item.vendors,[]);assert.deepEqual(item.nativeInputs??{},{});assert.equal(item.notices.length,1);assert.equal(item.notices[0].sha256,pin.sha256);assert.ok(Buffer.from(item.notices[0].body).equals(readFileSync(join(root,pin.source))));assert.equal(record.sectionSHA256,pin.sha256);}
},expoJsSourceLedger,expoJsSourcePins));

const reviewedRNSourcePods=['React-debug','React-defaultsnativemodule','React-domnativemodule','React-featureflags','React-featureflagsnativemodule','React-graphics','React-idlecallbacksnativemodule','React-ImageManager','React-intersectionobservernativemodule','React-microtasksnativemodule','React-mutationobservernativemodule','React-NativeModulesApple','React-networking','React-performancecdpmetrics','React-performancetimeline','React-rendererconsistency','React-renderercss','React-rendererdebug','React-RuntimeApple','React-RuntimeCore','React-runtimescheduler','React-timing','React-utils','React-viewtransitionnativemodule','React-webperformancenativemodule'];
const rnSourceLedger=(()=>{const value=JSON.parse(readFileSync(new URL('./app-notice-provenance.json',import.meta.url)));return {...value,components:value.components.slice(0,74),knownLicenseSources:value.knownLicenseSources.slice(0,152)};})();
const rnSourceRecords=rnSourceLedger.components.slice(49);
function rnSourceFixture(run){return fixture(({root,file})=>{
 const pkg='node_modules/react-native';
 for(const source of new Set([pkg+'/package.json',pkg+'/LICENSE',...rnSourceRecords.map(record=>dirname(record.nativeInputs['cocoapods:'+record.component.split(':')[1].split('@')[0]].ownLicense.podspec.source))])){
  const target=join(root,source);mkdirSync(dirname(target),{recursive:true});cpSync(new URL('../'+source,import.meta.url),target,{recursive:true});
 }
 const installed=JSON.parse(readFileSync(new URL('../package-lock.json',import.meta.url)));
 file('package-lock.json',{packages:{[pkg]:installed.packages[pkg]}});
 mkdirSync(join(root,'ios/Pods/Target Support Files'),{recursive:true});
 const lock={PODS:reviewedRNSourcePods.map(name=>`${name} (0.86.3)`),'EXTERNAL SOURCES':Object.fromEntries(rnSourceRecords.map(record=>{const name=record.component.split(':')[1].split('@')[0];return [name,{':path':'../'+dirname(record.nativeInputs['cocoapods:'+name].ownLicense.podspec.source)}];}))};
 file('ios/Podfile.lock',lock);return run({root,file,lock,capture:()=>podNoticeInputs(root),approved:rnSourceLedger});
});}

test('the explicit74 review fixture adds only25 exact RN source Pods without new public pins',()=>{
 assert.equal(rnSourceLedger.components.length,74);assert.deepEqual(rnSourceLedger.components.slice(0,49),expoJsSourceLedger.components);assert.equal(rnSourceLedger.knownLicenseSources.length,152);
 assert.deepEqual(rnSourceRecords.map(value=>value.component),reviewedRNSourcePods.map(name=>`cocoapods:${name}@0.86.3`));assert.ok(rnSourceLedger.components.every(value=>value.platform==='ios'));
 let files=0;for(const record of rnSourceRecords){const name=record.component.split(':')[1].split('@')[0],key='cocoapods:'+name,input=record.nativeInputs[key];assert.deepEqual(Object.keys(record.nativeInputs),[key]);assert.deepEqual(record.reviewedVendors,[]);assert.deepEqual(Object.keys(input),['sha256','files','excludedBuildPaths','ownLicense']);assert.deepEqual(input.excludedBuildPaths,[]);assert.equal(input.ownLicense.ownerNpmID,'npm:react-native@0.86.3');assert.equal(input.ownLicense.sourceKind,'path');assert.ok(input.ownLicense.podspec.source.startsWith('node_modules/react-native/ReactCommon/react/'));assert.deepEqual(record.notices,[{source:'node_modules/react-native/LICENSE',sha256:digest(mit)}]);assert.equal(record.sectionSHA256,digest(mit));files+=input.files;}
 assert.equal(files,357);
});
test('25 actual source-Pod captures match approved native fingerprints and original MIT bytes',()=>rnSourceFixture(({capture,approved})=>{
 const input=capture();assert.deepEqual(input.unresolved,[]);assert.equal(input.components.length,25);const coverage=resolveNoticeCoverage(input.components,approved);assert.equal(coverage.status,'READY');assert.equal(coverage.sections.length,25);assert.equal(unreviewedOSSNoticeInputs(input.components,approved).components.length,25);
 for(const item of input.components){const record=approved.components.find(value=>value.component===item.id);assert.deepEqual(item.nativeInputs,record.nativeInputs);assert.deepEqual(item.vendors,[]);assert.deepEqual(item.vendorNotices,{});assert.equal(item.notices.length,1);assert.equal(item.notices[0].body,mit);assert.deepEqual(item.notices.map(({source,sha256})=>({source,sha256})),record.notices);}
 assert.throws(()=>assertSourceNoticePayload(Buffer.from(JSON.stringify([font])+'\n'),coverage,fonts));
}));
test('RN source reviews reject actual source, own-text and selector drift without sibling or Android approval',()=>rnSourceFixture(({root,file,lock,capture,approved})=>{
 const items=capture().components,first=items.find(value=>value.name==='React-debug');assert.equal(resolveNoticeCoverage(items,expoJsSourceLedger).unresolved.length,25);assert.equal(resolveNoticeCoverage(items,approved,'android').unresolved.length,25);
 assert.equal(resolveNoticeCoverage([{...first,id:'cocoapods:React-UnreviewedSibling@0.86.3'}],approved).unresolved[0].reason,'unreviewed-component');assert.equal(resolveNoticeCoverage([{...first,id:'cocoapods:React-debug@999',version:'999'}],approved).unresolved[0].reason,'unreviewed-component');assert.equal(resolveNoticeCoverage([{...first,vendors:['vendor/unreviewed']}],approved).unresolved[0].reason,'unreviewed-vendored-source');
 const selected=dirname(first.nativeInputs['cocoapods:React-debug'].ownLicense.podspec.source),source=join(selected,readdirSync(join(root,selected)).find(name=>/\.(cpp|h)$/.test(name))),before=readFileSync(join(root,source));file(source,Buffer.concat([before,Buffer.from('\n// Unreviewed source drift\n')]));assert.equal(resolveNoticeCoverage(capture().components,approved).unresolved.find(value=>value.component===first.id).reason,'native-source-digest-mismatch');file(source,before);
 const text=readFileSync(join(root,'node_modules/react-native/LICENSE'));file('node_modules/react-native/LICENSE',Buffer.concat([text,Buffer.from('UNREVIEWED_TEXT')]));assert.throws(capture,/Bound licence input bytes changed/);file('node_modules/react-native/LICENSE',text);
 lock['EXTERNAL SOURCES']['React-debug'][':path']='../node_modules/react-native/ReactCommon/react/featureflags';file('ios/Podfile.lock',lock);assert.throws(capture,/Require the exact selected Pod source|Expected values/);
}));
test('Expo JavaScript review cannot infer Pod/native/vendor, unknown, changed text/NOTICE or Android approval',()=>runtimeNoticeFixture(({root,file,approved,pins,capture})=>{
 const items=capture();for(const item of items){const changed=structuredClone(item);changed.nativeInputs={unreviewedNative:true};assert.equal(resolveNoticeCoverage([changed],approved).unresolved[0].reason,'native-source-digest-mismatch');assert.equal(resolveNoticeCoverage([{...item,id:item.id+'-unknown'}],approved).unresolved[0].reason,'unreviewed-component');assert.equal(resolveNoticeCoverage([{...item,id:item.id.slice(0,item.id.lastIndexOf('@')+1)+'999',version:'999'}],approved).unresolved[0].reason,'unreviewed-component');}
 assert.equal(resolveNoticeCoverage(items,approved,'android').unresolved.length,25);const font=items.find(value=>value.id==='npm:expo-font@57.0.4'),speech=items.find(value=>value.id==='npm:expo-speech-recognition@57.0.0');assert.equal(resolveNoticeCoverage([{...font,id:'cocoapods:ExpoFont@57.0.4',name:'ExpoFont',ecosystem:'cocoapods'}],approved).unresolved[0].reason,'native-source-digest-mismatch');assert.equal(resolveNoticeCoverage([{...speech,id:'cocoapods:ExpoSpeechRecognition@57.0.0',name:'ExpoSpeechRecognition',ecosystem:'cocoapods'}],approved).unresolved[0].reason,'unreviewed-component');
 const pin=pins.find(value=>value.component===speech.id),body=readFileSync(join(root,pin.source));file(pin.source,Buffer.concat([body,Buffer.from('PRIVATE_UNREVIEWED_NOTICE')]));let changed=capture();assert.equal(resolveNoticeCoverage(changed,approved).unresolved[0].reason,'notice-set-or-digest-mismatch');assert.ok(!JSON.stringify(unreviewedOSSNoticeInputs(changed,approved)).includes('PRIVATE_UNREVIEWED_NOTICE'));file(pin.source,body);const packagePath=pin.source.slice(0,pin.source.lastIndexOf('/')),notice=file(packagePath+'/NOTICE','A separately attributed original notice');assert.equal(resolveNoticeCoverage(capture(),approved).unresolved[0].reason,'notice-set-or-digest-mismatch');rmSync(notice);const vendor=file(packagePath+'/vendor/separate/selected.js','synthetic source');assert.equal(resolveNoticeCoverage(npmNoticeInputs(root,[vendor]),approved).unresolved[0].reason,'unreviewed-vendored-source');
 const unknown=file('node_modules/unreviewed-expo-sibling/index.js','source');file('node_modules/unreviewed-expo-sibling/package.json',{name:'unreviewed-expo-sibling',version:'1',license:'MIT'});file('node_modules/unreviewed-expo-sibling/LICENSE',body);const lock=JSON.parse(readFileSync(join(root,'package-lock.json')));lock.packages['node_modules/unreviewed-expo-sibling']={version:'1'};file('package-lock.json',lock);const unreviewed=npmNoticeInputs(root,[unknown]);assert.equal(resolveNoticeCoverage(unreviewed,approved).unresolved[0].reason,'unreviewed-component');assert.equal(unreviewedOSSNoticeInputs(unreviewed,approved).components.length,0);
},expoJsSourceLedger,expoJsSourcePins));

const reviewedRemainingJsComponents=['npm:@better-auth/core@1.7.12','npm:@better-auth/expo@1.7.12','npm:@better-fetch/fetch@1.3.2','npm:@expo/devtools@57.0.1','npm:@react-native-async-storage/async-storage@2.2.0','npm:@react-native-google-signin/google-signin@16.1.5','npm:@ungap/structured-clone@1.4.0','npm:await-lock@2.2.2','npm:better-auth@1.7.12','npm:better-call@1.4.4','npm:defu@6.1.7','npm:hoist-non-react-statics@3.3.2','npm:nanostores@1.5.5','npm:react-native-drawer-layout@4.2.12','npm:react-native-is-edge-to-edge@1.3.1','npm:react-native-safe-area-context@5.7.0','npm:react-native-worklets@0.10.1','npm:semver@7.8.5','npm:use-latest-callback@0.2.6','npm:whatwg-url-minimum@0.1.2'];
const remainingJsSourceLedger=(()=>{const value=JSON.parse(readFileSync(new URL('./app-notice-provenance.json',import.meta.url)));return {...value,components:value.components.slice(0,94),knownLicenseSources:value.knownLicenseSources.slice(0,172)};})();
const remainingJsSourceRecords=remainingJsSourceLedger.components.slice(74),remainingJsSourcePins=remainingJsSourceLedger.knownLicenseSources.slice(152);
test('the explicit94 review fixture preserves74 records and152 pins and adds only the exact20 reviewed npm selectors',()=>{
 const before={...remainingJsSourceLedger,components:remainingJsSourceLedger.components.slice(0,74),knownLicenseSources:remainingJsSourceLedger.knownLicenseSources.slice(0,152)};
 assert.equal(digest(JSON.stringify(before)),'6972a07aff242ae06c096170007997a7c3373f9f675c73aead8ee63b9cdd0f8b');assert.equal(remainingJsSourceLedger.components.length,94);assert.equal(remainingJsSourceLedger.knownLicenseSources.length,172);
 assert.deepEqual(remainingJsSourceRecords.map(value=>value.component),reviewedRemainingJsComponents);assert.deepEqual(remainingJsSourcePins.map(value=>value.component),reviewedRemainingJsComponents);
 assert.equal(digest(JSON.stringify({components:remainingJsSourceRecords,pins:remainingJsSourcePins})),'107f16ca5d238e5272c776772cd46070e7cd8c3f722042fe0f5caa248ce8ce3a');
 for(const record of remainingJsSourceRecords){assert.equal(record.platform,'ios');assert.deepEqual(record.reviewedVendors,[]);assert.deepEqual(record.nativeInputs,{});assert.equal(record.notices.length,1);}
});
test('20 exact npm reviews export original public notices without native, vendor or Android inheritance',()=>runtimeNoticeFixture(({root,approved,pins,capture})=>{
 const items=capture(),coverage=resolveNoticeCoverage(items,approved),publicInput=unreviewedOSSNoticeInputs(items,approved),lock=JSON.parse(readFileSync(new URL('../package-lock.json',import.meta.url)));
 assert.deepEqual(items.map(value=>value.id),reviewedRemainingJsComponents);assert.equal(coverage.status,'READY');assert.equal(coverage.sections.length,20);assert.equal(publicInput.unresolved.length,0);assert.equal(publicInput.components.length,20);
 for(const item of items){const pin=pins.find(value=>value.component===item.id),record=remainingJsSourceRecords.find(value=>value.component===item.id),packagePath=pin.source.slice(0,pin.source.lastIndexOf('/'));assert.equal(pin.public,true);assert.equal(pin.upstream,lock.packages[packagePath].resolved);assert.equal(pin.upstreamIntegrity,lock.packages[packagePath].integrity);assert.equal(record.upstream,pin.upstream);assert.deepEqual(item.notices.map(({source,sha256})=>({source,sha256})),record.notices);assert.equal(digest(item.notices[0].body),record.sectionSHA256);assert.deepEqual(publicInput.components.find(value=>value.component===item.id).notices,item.notices);assert.ok(Buffer.from(item.notices[0].body).equals(readFileSync(join(root,pin.source))));}
 const first=items[0];assert.equal(resolveNoticeCoverage([{...first,nativeInputs:{unreviewedNative:true}}],approved).unresolved[0].reason,'native-source-digest-mismatch');assert.equal(resolveNoticeCoverage([{...first,vendors:['vendor/unreviewed']}],approved).unresolved[0].reason,'unreviewed-vendored-source');
 const worklets=items.find(value=>value.id==='npm:react-native-worklets@0.10.1');assert.equal(resolveNoticeCoverage([{...worklets,id:'cocoapods:RNWorklets@0.10.1',name:'RNWorklets',ecosystem:'cocoapods'}],approved).unresolved[0].reason,'unreviewed-component');assert.equal(resolveNoticeCoverage(items,rnSourceLedger).unresolved.length,20);
 const android=resolveNoticeCoverage(items,approved,'android');assert.equal(android.unresolved.length,20);assert.ok(android.unresolved.every(value=>value.reason==='unreviewed-component'));
 assert.throws(()=>assertSourceNoticePayload(readFileSync(new URL('../assets/notices/third_party_notices.json',import.meta.url)),coverage,approved,JSON.parse(readFileSync(new URL('./font-icon-provenance.json',import.meta.url)))),/Actual included library differs from the committed union/);
},remainingJsSourceLedger,remainingJsSourcePins));

const posthogJsSourceLedger=(()=>{const value=JSON.parse(readFileSync(new URL('./app-notice-provenance.json',import.meta.url)));return {...value,components:value.components.slice(0,95),knownLicenseSources:value.knownLicenseSources.slice(0,173)};})();
test('the explicit95 review fixture preserves94 reviews and172 pins and exports the entire scoped PostHog notice without core or native inheritance',()=>runtimeNoticeFixture(({approved,pins,capture})=>{
 const before={...approved,components:approved.components.slice(0,94),knownLicenseSources:approved.knownLicenseSources.slice(0,172)},component='npm:posthog-react-native@4.84.1',source='node_modules/posthog-react-native/LICENSE',sha256='d3fb92ac01f0bef4078f89aac9f20f76da3383ad45becf6204abdf5495f43f8f',upstream='https://registry.npmjs.org/posthog-react-native/-/posthog-react-native-4.84.1.tgz';
 assert.equal(digest(JSON.stringify(before)),'9bbf6cb78b07a1ef78ed7002c0827cd0cb21f75b7699f373ae9ef5da132a992a');assert.equal(approved.components.length,95);assert.equal(approved.knownLicenseSources.length,173);
 assert.deepEqual(approved.components.at(-1),{platform:'ios',component,reviewedVendors:[],nativeInputs:{},notices:[{source,sha256}],upstream,sectionSHA256:sha256});assert.deepEqual(pins,[{component,ecosystem:'npm',version:'4.84.1',public:true,source,sha256,upstream,upstreamIntegrity:'sha512-AqPWpqnYhi2YnGFNB4pQVlQwKlkbHqJWD/bwsqWZ9/wYofcWel6Cy9DZmaWxdSQQIDJeV6JYZbdFYbRfYnts9g=='}]);
 const items=capture(),coverage=resolveNoticeCoverage(items,approved),publicInput=unreviewedOSSNoticeInputs(items,approved);assert.equal(items.length,1);assert.equal(items[0].id,component);assert.equal(coverage.status,'READY');assert.equal(coverage.sections.length,1);assert.equal(Buffer.byteLength(coverage.sections[0].body),21550);assert.equal(digest(coverage.sections[0].body),sha256);assert.equal(publicInput.unresolved.length,0);assert.equal(publicInput.components.length,1);assert.deepEqual(publicInput.components[0].notices,items[0].notices);assert.equal(publicInput.components[0].notices[0].body,coverage.sections[0].body);
 const item=items[0],core={...item,id:'npm:@posthog/core@1.61.0',name:'@posthog/core',version:'1.61.0'};assert.equal(resolveNoticeCoverage([core],approved).unresolved[0].reason,'unreviewed-component');assert.equal(unreviewedOSSNoticeInputs([core],approved).components.length,0);assert.equal(resolveNoticeCoverage([{...item,nativeInputs:{unreviewedNative:true}}],approved).unresolved[0].reason,'native-source-digest-mismatch');assert.equal(resolveNoticeCoverage(items,approved,'android').unresolved[0].reason,'unreviewed-component');assert.equal(resolveNoticeCoverage(items,before).unresolved[0].reason,'unreviewed-component');
},posthogJsSourceLedger,[posthogJsSourceLedger.knownLicenseSources.at(-1)]));

const widgetIosSourceLedger=JSON.parse(readFileSync(new URL('./app-notice-provenance.json',import.meta.url)));
test('actual96 ledger preserves95 reviews and173 pins and exports the original widget MIT notice only for iOS',()=>runtimeNoticeFixture(({approved,pins,capture})=>{
 const before={...approved,components:approved.components.slice(0,95),knownLicenseSources:approved.knownLicenseSources.slice(0,173)},component='npm:react-native-android-widget@0.22.1',source='node_modules/react-native-android-widget/LICENSE',sha256='1893949b5f982bd87b686eb21acb84d60ec64d7525226a39329c8e352f7e62f1',upstream='https://registry.npmjs.org/react-native-android-widget/-/react-native-android-widget-0.22.1.tgz';
 assert.equal(digest(JSON.stringify(before)),'2a22bdef60c12420185887468e9f1de8e271bdfc5588184177e2ba4bfb6f7617');assert.equal(approved.components.length,96);assert.equal(approved.knownLicenseSources.length,174);
 assert.deepEqual(approved.components.at(-1),{platform:'ios',component,reviewedVendors:[],nativeInputs:{},notices:[{source,sha256}],upstream,sectionSHA256:sha256});assert.deepEqual(pins,[{component,ecosystem:'npm',version:'0.22.1',public:true,source,sha256,upstream,upstreamIntegrity:'sha512-BBMuqShRrxV23Z09Rn5zNHJaPegCnH3DhhZQgXbhw2GMh45Gez0RbwKTIWHftuW4nLrqWy6esz8XwecUZLiZKA=='}]);
 const items=capture(),coverage=resolveNoticeCoverage(items,approved),publicInput=unreviewedOSSNoticeInputs(items,approved);assert.equal(items.length,1);assert.equal(items[0].id,component);assert.equal(coverage.status,'READY');assert.equal(coverage.sections.length,1);const body=coverage.sections[0].body;assert.equal(Buffer.byteLength(body),1093);assert.equal(digest(body),sha256);assert.equal((body.match(/\r\n/g)??[]).length,20);assert.equal(publicInput.unresolved.length,0);assert.equal(publicInput.components.length,1);assert.deepEqual(publicInput.components[0].notices,items[0].notices);assert.equal(publicInput.components[0].notices[0].body,body);
 const item=items[0];assert.equal(resolveNoticeCoverage(items,before).unresolved[0].reason,'unreviewed-component');assert.equal(unreviewedOSSNoticeInputs(items,before).components.length,0);assert.equal(resolveNoticeCoverage(items,approved,'android').unresolved[0].reason,'unreviewed-component');assert.equal(resolveNoticeCoverage([{...item,nativeInputs:{unreviewedNative:true}}],approved).unresolved[0].reason,'native-source-digest-mismatch');assert.equal(resolveNoticeCoverage([{...item,vendors:['vendor/unreviewed']}],approved).unresolved[0].reason,'unreviewed-vendored-source');
},widgetIosSourceLedger,[widgetIosSourceLedger.knownLicenseSources.at(-1)]));

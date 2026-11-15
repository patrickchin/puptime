import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,realpathSync,chmodSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {parse} from 'yaml';
import {npmNoticeInputs,nativeNoticeInput,resolveNoticeCoverage,assertSourceNoticePayload,publicNoticeReport,assertFinalNoticeEvidence,capturedSource,assertCapturedSources,assertFinalSourceMap,assertPackagedNativeCoverage,digest,unreviewedOSSNoticeInputs} from './app-notices.mjs';
import {captureResolvedInputs,createNoticeSeal} from './capture-app-notices.mjs';

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
 const empty={schema:1,components:[],knownLicenseSources:[],retainedAndroidResources:{'META-INF/NOTICE.json':digest('{"notice":"Required synthetic native notice"}\n')}};file('scripts/app-notice-provenance.json',empty);
 const paths=[appPath,modulePath,assetPath,join(root,'assets/notices/third_party_notices.json')];
 const initial=captureResolvedInputs(root,'android',paths,gradle),approved={...empty,components:initial.noticeInputs.map(item=>review(item,'android'))};file('scripts/app-notice-provenance.json',approved);
 const coverage=resolveNoticeCoverage(initial.noticeInputs,approved,'android');file('assets/notices/third_party_notices.json',sourcePayload(coverage));
 runGit('init','--quiet');runGit('add','.');runGit('-c','user.name=Notice test','-c','user.email=notice-test@example.invalid','commit','--quiet','-m','Synthetic notice fixture');
 const capture=captureResolvedInputs(root,'android',paths,gradle),seal=createNoticeSeal(root,'android',capture);file('build/notices/android/seal.json',seal);
 for(const name of ['app.json','package-lock.json']){const before=readFileSync(join(root,name));file(name,Buffer.concat([before,Buffer.from(' ')]));assert.throws(()=>createNoticeSeal(root,'android',capture));file(name,before);}
 assert.throws(()=>createNoticeSeal(join(root,'node_modules'), 'android',capture));
 const sourceMap={version:3,sources:['index.ts','node_modules/qa/index.js','node_modules/assets/font.ttf','assets/notices/third_party_notices.json'],sourcesContent:[appCode,moduleCode,'',readFileSync(join(root,'assets/notices/third_party_notices.json'),'utf8')]};
 const map=file('build/actual.map',sourceMap),bundle=file('build/index.android.bundle','controlled compiler output'),apk=join(root,'build/final.apk');
 const pack=(extra=false,emptyRetained=false)=>execFileSync('python3',['-c',`import zipfile,sys\nwith zipfile.ZipFile(sys.argv[1],'w') as z:\n z.write(sys.argv[2],'assets/third_party_notices.json');z.write(sys.argv[3],'assets/index.android.bundle');z.writestr('lib/arm64-v8a/libqa.so',b'\\x7fELFcontrolled');z.writestr('assets/font.ttf','synthetic font bytes');z.writestr('third_party_licenses.txt',b'');z.writestr('third_party_licenses.json',sys.argv[7]);z.writestr('META-INF/NOTICE.json',b'' if sys.argv[5]=='yes' else sys.argv[7] if sys.argv[5]=='json' else sys.argv[6])\n if sys.argv[4]=='yes':z.writestr('assets/unknown-executable',b'\\xcf\\xfa\\xed\\xfecontrolled')`,apk,join(root,'assets/notices/third_party_notices.json'),bundle,extra?'yes':'no',emptyRetained===true?'yes':emptyRetained==='json'?'json':'no','{"notice":"Required synthetic native notice"}\n','{}\n']);
 const verify=()=>spawnSync(process.execPath,[fileURLToPath(new URL('./capture-app-notices.mjs',import.meta.url)),'verify','android','--gradle-input',gradle,'--archive',apk,'--bundle',bundle,'--source-map',map],{cwd:root,encoding:'utf8',timeout:30000});
 pack();assert.equal(verify().status,0);
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
 const provenance=JSON.parse(readFileSync(new URL('./app-notice-provenance.json',import.meta.url)));
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

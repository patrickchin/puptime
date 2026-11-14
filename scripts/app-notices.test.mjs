import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
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
 const app={expo:{plugins:[['expo-asset',{assets:['./assets/notices/third_party_notices.json']}]]}};file('app.json',app);
 const lock={packages:{'node_modules/qa':{version:'1'},'node_modules/assets':{version:'1'},'node_modules/extra':{version:'1'}}};file('package-lock.json',lock);
 for(const name of ['qa','assets','extra']){file(`node_modules/${name}/package.json`,{name,version:'1'});file(`node_modules/${name}/LICENSE`,mit);}
 const appCode='export const app=1;\n',moduleCode='module.exports=42;\n';
 const appPath=file('index.ts',appCode),modulePath=file('node_modules/qa/index.js',moduleCode),assetPath=file('node_modules/assets/font.ttf','synthetic font bytes');file('node_modules/extra/index.js','module.exports=0;');
 file('scripts/font-icon-provenance.json',fonts);file('assets/notices/third_party_notices.json','[]');
 const aar=file('build/source.aar',''),staticJar=file('build/static.jar','');
 execFileSync('python3',['-c',`import zipfile,sys\nwith zipfile.ZipFile(sys.argv[1],'w') as z:z.writestr('LICENSE',sys.argv[3]);z.writestr('jni/arm64-v8a/libqa.so',b'\\x7fELFcontrolled')\nwith zipfile.ZipFile(sys.argv[2],'w') as z:z.writestr('LICENSE',sys.argv[3])`,aar,staticJar,mit]);
 const gradle=file('build/runtime-inputs.json',{schema:1,configuration:'releaseRuntimeClasspath',components:[{group:'qa',name:'native',version:'1',artifacts:[{file:aar,sha256:digest(readFileSync(aar))}]},{group:'qa',name:'static',version:'1',artifacts:[{file:staticJar,sha256:digest(readFileSync(staticJar))}]}]});
 const empty={schema:1,components:[],knownLicenseSources:[],retainedAndroidResources:{}};file('scripts/app-notice-provenance.json',empty);
 const paths=[appPath,modulePath,assetPath,join(root,'assets/notices/third_party_notices.json')];
 const initial=captureResolvedInputs(root,'android',paths,gradle),approved={...empty,components:initial.noticeInputs.map(item=>review(item,'android'))};file('scripts/app-notice-provenance.json',approved);
 const coverage=resolveNoticeCoverage(initial.noticeInputs,approved,'android');file('assets/notices/third_party_notices.json',sourcePayload(coverage));
 runGit('init','--quiet');runGit('add','.');runGit('-c','user.name=Notice test','-c','user.email=notice-test@example.invalid','commit','--quiet','-m','Synthetic notice fixture');
 const capture=captureResolvedInputs(root,'android',paths,gradle),seal=createNoticeSeal(root,'android',capture);file('build/notices/android/seal.json',seal);
 for(const name of ['app.json','package-lock.json']){const before=readFileSync(join(root,name));file(name,Buffer.concat([before,Buffer.from(' ')]));assert.throws(()=>createNoticeSeal(root,'android',capture));file(name,before);}
 assert.throws(()=>createNoticeSeal(join(root,'node_modules'), 'android',capture));
 const sourceMap={version:3,sources:['index.ts','node_modules/qa/index.js','node_modules/assets/font.ttf','assets/notices/third_party_notices.json'],sourcesContent:[appCode,moduleCode,'',readFileSync(join(root,'assets/notices/third_party_notices.json'),'utf8')]};
 const map=file('build/actual.map',sourceMap),bundle=file('build/index.android.bundle','controlled compiler output'),apk=join(root,'build/final.apk');
 const pack=(extra=false)=>execFileSync('python3',['-c',`import zipfile,sys\nwith zipfile.ZipFile(sys.argv[1],'w') as z:\n z.write(sys.argv[2],'assets/third_party_notices.json');z.write(sys.argv[3],'assets/index.android.bundle');z.writestr('lib/arm64-v8a/libqa.so',b'\\x7fELFcontrolled');z.writestr('assets/font.ttf','synthetic font bytes')\n if sys.argv[4]=='yes':z.writestr('assets/unknown-executable',b'\\xcf\\xfa\\xed\\xfecontrolled')`,apk,join(root,'assets/notices/third_party_notices.json'),bundle,extra?'yes':'no']);
 const verify=()=>spawnSync(process.execPath,[fileURLToPath(new URL('./capture-app-notices.mjs',import.meta.url)),'verify','android','--gradle-input',gradle,'--archive',apk,'--bundle',bundle,'--source-map',map],{cwd:root,encoding:'utf8',timeout:30000});
 pack();assert.equal(verify().status,0);
 const receipt=JSON.parse(readFileSync(join(root,'build/notices/android/final-apk.json')));assert.equal(receipt.inventory.independentFinalComponentInventory,false);
 assert.deepEqual(receipt.inventory.resolvedBuildOnly,[{component:'maven:qa:static@1',basis:'reinspected-gradle-artifacts-and-source'}]);
 const missing={...sourceMap,sources:sourceMap.sources.filter((_,i)=>i!==2),sourcesContent:sourceMap.sourcesContent.filter((_,i)=>i!==2)};file('build/actual.map',missing);
 assert.equal(verify().status,1,'Captured asset-only package cannot be supplied back as an observed final component.');
 const extra={...sourceMap,sources:[...sourceMap.sources,'node_modules/extra/index.js'],sourcesContent:[...sourceMap.sourcesContent,'module.exports=0;']};file('build/actual.map',extra);assert.equal(verify().status,1);
 file('build/actual.map',sourceMap);pack(true);assert.equal(verify().status,1,'Unmapped extensionless Mach-O must fail through the production CLI.');
}));

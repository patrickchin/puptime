import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import test from 'node:test';
import {podNoticeInputs,gradleNoticeInputs,unionNoticeInputs,inspectNoticeArchive,noticeInputStep,noticeFailureContext} from './native-notice-inputs.mjs';
import {assertPackagedNativeCoverage,assertSourceNoticePayload,digest,npmNoticeInputs,resolveNoticeCoverage} from './app-notices.mjs';
const require=createRequire(import.meta.url),plist=require('@expo/plist');
const mit=readFileSync(new URL('../node_modules/react-native/LICENSE',import.meta.url),'utf8');
const approval=(item,platform='ios')=>({schema:1,components:[{platform,component:item.id,reviewedVendors:item.vendors,nativeInputs:item.nativeInputs??{},notices:item.notices.map(({source,sha256})=>({source,sha256})),upstream:'https://example.invalid/pinned/native',sectionSHA256:digest([...item.notices].sort((a,b)=>a.source.localeCompare(b.source)).map(value=>value.body).join('\n\n'))}]});
function fixture(run){
 const root=mkdtempSync(join(tmpdir(),'puptime-native-notice-'));
 const file=(path,body)=>{mkdirSync(join(root,path,'..'),{recursive:true});writeFileSync(join(root,path),typeof body==='string'||Buffer.isBuffer(body)?body:JSON.stringify(body));return join(root,path);};
 try{return run({root,file});}finally{rmSync(root,{recursive:true,force:true});}
}
test('resolved CocoaPods subspecs and actual generated plist text determine coverage; missing native inputs stay incomplete',()=>fixture(({root,file})=>{
 assert.equal(podNoticeInputs(root).unresolved.length,1);
 file('ios/Podfile.lock','PODS:\n  - QA/Core (1.2.3)\n  - QA/UI (1.2.3)\n  - Missing (4.5.6)\n');
 file('ios/Pods/QA/NOTICE','A distinct vendored attribution\n');file('ios/Pods/QA/Dependency.xcframework/Info.plist','');
 const text=plist.default.build;
 file('ios/Pods/Target Support Files/Pods-Puptime/Pods-Puptime-acknowledgements.plist',text({PreferenceSpecifiers:[{Title:'Acknowledgements',FooterText:'Not a library'},{Title:'QA',FooterText:mit}]}));
 const input=podNoticeInputs(root);assert.equal(input.components.length,2);
 assert.ok(input.components.find(value=>value.name==='QA').notices.some(value=>value.body===mit));
 assert.ok(input.components.find(value=>value.name==='QA').notices.some(value=>value.body==='A distinct vendored attribution\n'));
 assert.deepEqual(input.components.find(value=>value.name==='QA').vendors,['Dependency.xcframework']);
 assert.equal(input.components.find(value=>value.name==='Missing').notices.length,0);
 assert.equal(resolveNoticeCoverage(input.components,{schema:1,components:[]}).status,'INCOMPLETE');
}));

test('actual AAR and nested JAR LICENSE plus NOTICE text are retained, with artifact digest and native-library provenance',()=>fixture(({root,file})=>{
 const aar=join(root,'fixture.aar');
 execFileSync('python3',['-c',`import io,zipfile,sys\nb=io.BytesIO()\nwith zipfile.ZipFile(b,'w') as z:z.writestr('META-INF/NOTICE','Nested attribution\\n')\nwith zipfile.ZipFile(sys.argv[1],'w') as z:\n z.writestr('META-INF/LICENSE',sys.argv[2]);z.writestr('classes.jar',b.getvalue());z.writestr('jni/arm64-v8a/libqa.so',b'\\x7fELFfixture')`,aar,mit]);
 const input={schema:1,configuration:'releaseRuntimeClasspath',components:[{group:'qa',name:'native',version:'1.2.3',artifacts:[{file:aar,sha256:digest(readFileSync(aar))}]}]};
 const path=file('private-gradle-input.json',input),read=gradleNoticeInputs(root,path);
 assert.equal(read.components.length,1);assert.equal(read.components[0].notices.length,2);assert.equal(read.nativeFiles.length,1);
 assert.ok(read.components[0].notices.some(value=>value.body===mit));assert.ok(read.components[0].notices.some(value=>value.body==='Nested attribution\n'));
 assert.ok(!JSON.stringify(read).includes(root),'Public notice inputs must omit private artifact paths.');
 input.components[0].artifacts[0].sha256='0'.repeat(64);file('private-gradle-input.json',input);assert.throws(()=>gradleNoticeInputs(root,path));
}));

test('archive reader rejects duplicate/traversal input, and reads the exact final JSON resource without extraction',()=>fixture(({root})=>{
 const path=join(root,'fixture.apk'),payload=JSON.stringify([{id:'qa',title:'QA',body:mit}])+'\n';
 execFileSync('python3',['-c',`import zipfile,sys\nwith zipfile.ZipFile(sys.argv[1],'w') as z:z.writestr('assets/third_party_notices.json',sys.argv[2])`,path,payload]);
 const result=inspectNoticeArchive(path,'assets/third_party_notices.json');assert.equal(result.payload.sha256,digest(payload));assert.equal(Buffer.from(result.payload.base64,'base64').toString(),payload);
 for(const name of ['../private/LICENSE','/absolute/LICENSE','C:/private/LICENSE']){
  execFileSync('python3',['-c',`import zipfile,sys\nwith zipfile.ZipFile(sys.argv[1],'w') as z:z.writestr(sys.argv[2],'text')`,path,name]);
  assert.throws(()=>inspectNoticeArchive(path));
 }
 execFileSync('python3',['-W','ignore','-c',`import zipfile,sys\nwith zipfile.ZipFile(sys.argv[1],'w') as z:z.writestr('LICENSE','one');z.writestr('LICENSE','two')`,path]);
 assert.throws(()=>inspectNoticeArchive(path));
}));

test('union of JS and autolinked native inputs cannot drop a NOTICE or accept conflicting bytes',()=>{
 const base={id:'npm:qa@1',name:'qa',version:'1',ecosystem:'npm',vendors:[],notices:[{source:'node_modules/qa/LICENSE',sha256:digest(mit),body:mit}]};
 const additional={...base,notices:[{source:'node_modules/qa/NOTICE',sha256:digest('extra'),body:'extra'}]};
 assert.equal(unionNoticeInputs([base],[additional])[0].notices.length,2);
 assert.throws(()=>unionNoticeInputs([base],[{...base,notices:[{...base.notices[0],sha256:'0'.repeat(64)}]}]));
});

test('autolinked Gradle inputs include nested native notices/vendors and bind source fingerprints without parent inheritance',()=>fixture(({root,file})=>{
 file('package-lock.json',{packages:{'node_modules/qa':{version:'1'}}});file('node_modules/qa/package.json',{name:'qa',version:'1'});file('node_modules/qa/LICENSE',mit);
 const build=file('node_modules/qa/android/build.gradle','// synthetic project\n');
 file('node_modules/qa/android/src/main/cpp/NOTICE','Native subtree attribution\n');file('node_modules/qa/android/src/main/cpp/main.cpp','int original=1;');
 file('node_modules/qa/android/.cxx-adjacent/source.cpp','int adjacent=1;');
 file('node_modules/qa/android/third_party/child/child.cpp','int child=1;');
 const input=file('gradle.json',{schema:1,configuration:'releaseRuntimeClasspath',components:[{projectBuildFile:build,projectBuildDirectory:join(root,'node_modules/qa/android/build'),projectCmakeStagingDirectory:join(root,'node_modules/qa/android/.cxx')}]});
 const initial=gradleNoticeInputs(root,input).components[0];assert.ok(initial.notices.some(value=>value.body==='Native subtree attribution\n'));
 assert.ok(initial.vendors.includes('android/third_party/child'));
 const missing=approval(initial);missing.components[0].reviewedVendors=[];
 assert.equal(resolveNoticeCoverage([initial],missing).unresolved[0].reason,'unreviewed-vendored-source');
 assert.equal(resolveNoticeCoverage([initial],approval(initial)).unresolved[0].reason,'missing-vendored-notice');
 file('node_modules/qa/android/third_party/child/LICENSE',mit);file('node_modules/qa/android/third_party/child/NOTICE','Child attribution\n');
 const complete=gradleNoticeInputs(root,input).components[0],approved=approval(complete);
 assert.equal(resolveNoticeCoverage([complete],approved).status,'READY');
 file('node_modules/qa/android/build/generated/Unrelated.cpp','generated output');file('node_modules/qa/android/.cxx/Release/vendor/generated/no-license.cpp','generated CMake output');
 assert.deepEqual(gradleNoticeInputs(root,input).components[0].nativeInputs,complete.nativeInputs);assert.equal(resolveNoticeCoverage(gradleNoticeInputs(root,input).components,approved).status,'READY');
 assert.deepEqual(complete.nativeInputs['node_modules/qa/android'].excludedBuildPaths,['.cxx','build']);
 file('node_modules/qa/android/.cxx-adjacent/source.cpp','int adjacent=2;');assert.equal(resolveNoticeCoverage(gradleNoticeInputs(root,input).components,approved).unresolved[0].reason,'native-source-digest-mismatch');file('node_modules/qa/android/.cxx-adjacent/source.cpp','int adjacent=1;');
 file('node_modules/qa/android/src/main/cpp/main.cpp','int changed=2;');
 assert.equal(resolveNoticeCoverage(gradleNoticeInputs(root,input).components,approved).unresolved[0].reason,'native-source-digest-mismatch');
}));

test('a custom AGP staging path does not exclude an unrelated directory merely named .cxx',()=>fixture(({root,file})=>{
 file('package-lock.json',{packages:{'node_modules/qa':{version:'1'}}});file('node_modules/qa/package.json',{name:'qa',version:'1'});file('node_modules/qa/LICENSE',mit);
 const build=file('node_modules/qa/android/build.gradle','// configured CMake staging\n');file('node_modules/qa/android/.cxx/source.cpp','int source=1;');
 const input=file('gradle.json',{schema:1,configuration:'releaseRuntimeClasspath',components:[{projectBuildFile:build,projectCmakeStagingDirectory:join(root,'node_modules/qa/android/generated-cmake')}]});
 const before=gradleNoticeInputs(root,input).components[0];file('node_modules/qa/android/generated-cmake/vendor/generated.cpp','generated');assert.deepEqual(gradleNoticeInputs(root,input).components[0].nativeInputs,before.nativeInputs);
 file('node_modules/qa/android/.cxx/source.cpp','int source=2;');assert.notDeepEqual(gradleNoticeInputs(root,input).components[0].nativeInputs,before.nativeInputs);
}));

test('one stable union independently qualifies the same npm ID with different Android native inputs',()=>fixture(({root,file})=>{
 file('package-lock.json',{packages:{'node_modules/qa':{version:'1'}}});file('node_modules/qa/package.json',{name:'qa',version:'1'});file('node_modules/qa/LICENSE',mit);
 const js=file('node_modules/qa/index.js','module.exports=1;'),build=file('node_modules/qa/android/build.gradle','// native build\n');file('node_modules/qa/android/src/NOTICE','Android native notice\n');
 const input=file('gradle.json',{schema:1,configuration:'releaseRuntimeClasspath',components:[{projectBuildFile:build}]});
 const ios=npmNoticeInputs(root,[js])[0],android=gradleNoticeInputs(root,input).components[0];assert.equal(ios.id,android.id);assert.ok(android.notices.length>ios.notices.length);
 const ledger={schema:1,components:[...approval(ios,'ios').components,...approval(android,'android').components]};
 const iosCoverage=resolveNoticeCoverage([ios],ledger,'ios'),androidCoverage=resolveNoticeCoverage([android],ledger,'android');assert.equal(iosCoverage.status,'READY');assert.equal(androidCoverage.status,'READY');
 assert.notEqual(iosCoverage.sections[0].id,androidCoverage.sections[0].id);
 const font={id:'font',title:'Font',body:mit},fonts={notices:{font:digest(mit)},platforms:{font:['ios','android','web']}},payload=Buffer.from(JSON.stringify([font,...iosCoverage.sections,...androidCoverage.sections]));
 assertSourceNoticePayload(payload,iosCoverage,ledger,fonts);assertSourceNoticePayload(payload,androidCoverage,ledger,fonts);
 assert.equal(resolveNoticeCoverage([android],approval(ios,'ios'),'android').status,'INCOMPLETE');
 assert.equal(resolveNoticeCoverage([android],approval(ios,'android'),'android').status,'INCOMPLETE');
 assert.throws(()=>resolveNoticeCoverage([ios],{schema:1,components:[...ledger.components,ledger.components[1]]},'ios'));
 assert.throws(()=>assertSourceNoticePayload(Buffer.from(JSON.stringify([font,...iosCoverage.sections])),iosCoverage,ledger,fonts));
 const hidden=JSON.parse(payload);delete hidden[2].androidOnly;hidden[2].iosOnly=true;assert.throws(()=>assertSourceNoticePayload(Buffer.from(JSON.stringify(hidden)),androidCoverage,ledger,fonts));
}));

test('Pods use the same source-only vendor boundary rule and reject raw invalid UTF-8 notices/acknowledgements',()=>fixture(({root,file})=>{
 file('ios/Podfile.lock','PODS:\n  - QA (1)\n');
 const ack=plist.default.build({PreferenceSpecifiers:[{Title:'QA',FooterText:mit}]}),ackPath='ios/Pods/Target Support Files/Pods-Puptime/Pods-Puptime-acknowledgements.plist';file(ackPath,ack);
 file('ios/Pods/QA/LICENSE',mit);file('ios/Pods/QA/vendor/child/file.cpp','int child=1;');
 const initial=podNoticeInputs(root).components[0];assert.ok(initial.vendors.includes('vendor/child'));
 const noReview=approval(initial);noReview.components[0].reviewedVendors=[];
 assert.equal(resolveNoticeCoverage([initial],noReview).unresolved[0].reason,'unreviewed-vendored-source');
 assert.equal(resolveNoticeCoverage([initial],approval(initial)).unresolved[0].reason,'missing-vendored-notice');
 file('ios/Pods/QA/vendor/child/NOTICE','Actual child attribution\n');const complete=podNoticeInputs(root).components[0];assert.equal(resolveNoticeCoverage([complete],approval(complete)).status,'READY');
 file('ios/Pods/QA/LICENSE',Buffer.from([0xff]));assert.throws(()=>podNoticeInputs(root),'Invalid source bytes must not be repaired into U+FFFD.');
 file('ios/Pods/QA/LICENSE',mit);const bytes=Buffer.from(ack),at=bytes.indexOf('Copyright');assert.ok(at>0);file(ackPath,Buffer.concat([bytes.subarray(0,at),Buffer.from([0xff]),bytes.subarray(at+1)]));assert.throws(()=>podNoticeInputs(root));
}));

test('archive inventory includes extensionless main/appex Mach-O and unknown executables require coverage',()=>fixture(({root})=>{
 const path=join(root,'fixture.ipa');
 execFileSync('python3',['-c',`import zipfile,struct,sys\nfat=struct.pack('>II',0xcafebabe,2)+struct.pack('>IIIII',12,0,48,8,0)+struct.pack('>IIIII',7,0,56,8,0)+b'\\xcf\\xfa\\xed\\xfeabcd'*2\nwith zipfile.ZipFile(sys.argv[1],'w') as z:\n for name in ['Payload/Puptime.app/Puptime','Payload/Puptime.app/PlugIns/Unknown.appex/Unknown','Payload/Puptime.app/Frameworks/QA.framework/QA']:z.writestr(name,b'\\xcf\\xfa\\xed\\xfecontrolled')\n z.writestr('Payload/Puptime.app/fat-native',fat);z.writestr('Payload/Puptime.app/Qa.class',bytes.fromhex('cafebabe000000340001'));z.writestr('Payload/Puptime.app/text','plain text')`,path]);
 const result=inspectNoticeArchive(path);assert.equal(result.nativeFiles.length,4);assert.ok(!result.nativeFiles.some(value=>value.path.endsWith('.class')));
 const component='native:qa@1',framework=result.nativeFiles.find(value=>value.path.includes('.framework/'));
 const ledger={packagedNative:{ios:{[framework.path]:{components:[component],review:'https://example.invalid/pinned/native'}}}};
 assert.throws(()=>assertPackagedNativeCoverage('ios',result.nativeFiles,[],{components:[{component}]},ledger),'Main and extension binaries cannot silently disappear from the inventory.');
}));

test('the exact raw JSON resource has its own 16 MiB bound and is not counted again as a generic 1 MiB notice',()=>fixture(({root})=>{
 const path=join(root,'fixture.apk'),payload=join(root,'payload.json');
 execFileSync('python3',['-c',`import json,zipfile,sys\nb=json.dumps([{'id':'large','title':'Large','body':'x'*(1024*1024+20)}]).encode();open(sys.argv[2],'wb').write(b)\nwith zipfile.ZipFile(sys.argv[1],'w') as z:z.writestr('assets/third_party_notices.json',b);z.writestr('META-INF/LICENSE','Actual small licence')`,path,payload]);
 const result=inspectNoticeArchive(path,'assets/third_party_notices.json');assert.equal(result.payload.sha256,digest(readFileSync(payload)));assert.equal(result.notices.length,1);
 execFileSync('python3',['-c',`import json,zipfile,sys\nwith zipfile.ZipFile(sys.argv[1],'w') as z:z.writestr('assets/third_party_notices.json',json.dumps([{'body':'x'*(17*1024*1024)}]))`,path]);
 assert.throws(()=>inspectNoticeArchive(path,'assets/third_party_notices.json'));
}));


test('finite native failure context preserves the innermost operation without raw error or component text',()=>fixture(({root,file})=>{
 file('ios/Podfile.lock','PODS:\n  - QA (1)\n');
 file('ios/Pods/Target Support Files/Pods-QA/Pods-QA-acknowledgements.plist',plist.default.build({PreferenceSpecifiers:[]}));
 file('ios/Pods/QA/LICENSE',Buffer.from([0xff]));
 let failed;
 try{noticeInputStep('native-inputs','ios',()=>podNoticeInputs(root));}catch(error){failed=error;}
 assert.deepEqual(noticeFailureContext(failed),{operation:'pod-source-scan',component:'cocoapods',errorCategory:'invalid-utf8',componentSHA256:digest('cocoapods:QA@1')});
 for(const code of ['ENOENT','EACCES','ERR_ASSERTION',undefined]){
  try{noticeInputStep('pod-source-scan','cocoapods',()=>{throw Object.assign(new Error('constructor '+root+' SECRET_BODY ENV_SECRET'),{code,cause:{password:'SECRET_AUTH'}});},'PRIVATE_COMPONENT');}catch(error){
   const text=JSON.stringify(noticeFailureContext(error));for(const secret of [root,'SECRET','PRIVATE_COMPONENT','constructor','cause','password'])assert.ok(!text.includes(secret));
   assert.ok(['missing-input','unreadable-input','invalid-input','unsupported-input'].includes(noticeFailureContext(error).errorCategory));
  }
 }
 try{noticeInputStep('source-path','metro',()=>{throw Object.assign(new TypeError('PRIVATE_MESSAGE'),{name:'PRIVATE_CLASS',code:'PRIVATE_CODE'});},undefined,'/PRIVATE_SOURCE');}catch(error){
  const value=noticeFailureContext(error);assert.deepEqual(value,{operation:'source-path',component:'metro',errorCategory:'unsupported-input',errorClass:'TypeError',errorCode:'other',sourceSHA256:digest('/PRIVATE_SOURCE')});assert.ok(!JSON.stringify(value).includes('PRIVATE'));
 }
 assert.equal(noticeFailureContext(Object.assign(new Error('private'),{native:{operation:'arbitrary'}})),undefined);
}));

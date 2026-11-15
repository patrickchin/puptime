import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync,cpSync,readdirSync,renameSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {createRequire} from 'node:module';
import test from 'node:test';
import {podNoticeInputs,gradleNoticeInputs,unionNoticeInputs,inspectNoticeArchive,noticeInputStep,noticeFailureContext,podLinkedSources} from './native-notice-inputs.mjs';
import {assertPackagedNativeCoverage,assertSourceNoticePayload,digest,npmNoticeInputs,resolveNoticeCoverage,nativeSourceNotices,unreviewedOSSNoticeInputs} from './app-notices.mjs';
const require=createRequire(import.meta.url),plist=require('@expo/plist');
const mit=readFileSync(new URL('../node_modules/react-native/LICENSE',import.meta.url),'utf8');
const approval=(item,platform='ios')=>({schema:1,components:[{platform,component:item.id,reviewedVendors:item.vendors,nativeInputs:item.nativeInputs??{},notices:item.notices.map(({source,sha256})=>({source,sha256})),upstream:'https://example.invalid/pinned/native',sectionSHA256:digest([...item.notices].sort((a,b)=>a.source.localeCompare(b.source)).map(value=>value.body).join('\n\n'))}]});
function fixture(run){
 const root=mkdtempSync(join(tmpdir(),'puptime-native-notice-'));
 const file=(path,body)=>{mkdirSync(join(root,path,'..'),{recursive:true});writeFileSync(join(root,path),typeof body==='string'||Buffer.isBuffer(body)?body:JSON.stringify(body));return join(root,path);};
 try{return run({root,file});}finally{rmSync(root,{recursive:true,force:true});}
}
function ownLicenseFixture(run){return fixture(({root,file})=>{
 const provenance=JSON.parse(readFileSync(new URL('./app-notice-provenance.json',import.meta.url))),pins=provenance.knownLicenseSources.filter(value=>value.ownerNpmID),installed=JSON.parse(readFileSync(new URL('../package-lock.json',import.meta.url))),lock={PODS:[], 'EXTERNAL SOURCES':{}};
 assert.equal(pins.length,3);file('package-lock.json',{packages:Object.fromEntries(pins.map(pin=>[pin.packagePath,installed.packages[pin.packagePath]]))});mkdirSync(join(root,'ios/Pods/Target Support Files'),{recursive:true});
 for(const pin of pins){const name=pin.component.slice('cocoapods:'.length,-pin.version.length-1);lock.PODS.push(name+' ('+pin.version+')');lock['EXTERNAL SOURCES'][name]={[':'+pin.sourceKind]:'../'+(pin.sourceKind==='path'?dirname(pin.podspecSource):pin.podspecSource)};for(const path of [pin.packageJSONSource,pin.podspecSource,pin.source])file(path,readFileSync(new URL('../'+path,import.meta.url)));file('ios/Pods/'+name+'/source.m','Synthetic alternate Pod root for source-form negatives');if(pin.sourceKind==='podspec')for(const arch of ['ios-arm64','ios-arm64_x86_64-simulator'])file('ios/Pods/'+name+'/'+name+'.xcframework/'+arch+'/'+name+'.framework/Info.plist','Synthetic framework source inventory');}
 file('ios/Podfile.lock',lock);return run({root,file,pins,lock,provenance,capture:()=>podNoticeInputs(root).components});
});}

test('three explicitly bound Pods retain exact own-package text without approving their vendor coverage',()=>ownLicenseFixture(({root,pins,provenance,capture})=>{
 const items=capture();assert.equal(items.length,3);assert.equal(provenance.components.length,0);assert.equal(resolveNoticeCoverage(items,provenance).status,'INCOMPLETE');
 for(const pin of pins){const item=items.find(value=>value.id===pin.component),bytes=readFileSync(new URL('../'+pin.source,import.meta.url));assert.equal(item.notices.length,1);assert.equal(item.notices[0].source,pin.source);assert.equal(item.notices[0].sha256,pin.sha256);assert.ok(Buffer.from(item.notices[0].body).equals(bytes));assert.equal(item.nativeInputs['cocoapods:'+item.name].ownLicense.ownerNpmID,pin.ownerNpmID);assert.ok(!JSON.stringify(item).includes(root));}
 const filesystem=items.find(value=>value.name==='ExpoFileSystem');assert.equal(filesystem.vendors.length,3);assert.equal(resolveNoticeCoverage([filesystem],approval(filesystem)).unresolved[0].reason,'missing-vendored-notice');
 const publicInput=unreviewedOSSNoticeInputs(items,provenance);assert.equal(publicInput.components.length,3);assert.equal(publicInput.complete,false);for(const value of publicInput.components)assert.equal(value.notices[0].body,items.find(item=>item.id===value.component).notices[0].body);
}));

for(const name of ['ExpoAppleAuthentication','ExpoFileSystem','ExpoAdapterGoogleSignIn'])test(`${name} own-license binding rejects changed bytes, owner and lock provenance`,()=>ownLicenseFixture(({root,file,pins,capture})=>{
 const pin=pins.find(value=>value.component.startsWith('cocoapods:'+name+'@'));
 const mutate=(path,bytes)=>{const before=readFileSync(join(root,path));file(path,bytes);assert.throws(capture);file(path,before);};
 for(const path of [pin.packageJSONSource,pin.podspecSource,pin.source])mutate(path,Buffer.concat([readFileSync(join(root,path)),Buffer.from('\nPRIVATE_CHANGED_BYTES')]));
 mutate(pin.source,Buffer.from([0xc3,0x28]));const pkg=JSON.parse(readFileSync(join(root,pin.packageJSONSource)));
 for(const changed of [{...pkg,name:'private-other-owner'},{...pkg,version:'999.0.0'}])mutate(pin.packageJSONSource,JSON.stringify(changed));
 const lock=JSON.parse(readFileSync(join(root,'package-lock.json')));for(const changed of [{version:'999.0.0'},{resolved:'https://example.invalid/PRIVATE'},{integrity:'PRIVATE_INTEGRITY'}])mutate('package-lock.json',JSON.stringify({...lock,packages:{...lock.packages,[pin.packagePath]:{...lock.packages[pin.packagePath],...changed}}}));
 const outside=file('outside/LICENSE',readFileSync(join(root,pin.source)));rmSync(join(root,pin.source));symlinkSync(outside,join(root,pin.source));assert.throws(capture);rmSync(join(root,pin.source));
}));

test('own-license bindings reject source-form switches, extra selectors and wrong canonical Pod roots',()=>ownLicenseFixture(({root,file,pins,lock,capture})=>{
 for(const pin of pins){const name=pin.component.slice('cocoapods:'.length,-pin.version.length-1),original=lock['EXTERNAL SOURCES'][name];
  for(const changed of [{[pin.sourceKind==='path'?':podspec':':path']:'../'+(pin.sourceKind==='path'?pin.podspecSource:dirname(pin.podspecSource))},{...original,privateSelector:'PRIVATE_PATH'}]){file('ios/Podfile.lock',{...lock,'EXTERNAL SOURCES':{...lock['EXTERNAL SOURCES'],[name]:changed}});let failure;try{capture();}catch(error){failure=error;}assert.ok(failure);const safe=JSON.stringify(noticeFailureContext(failure));assert.ok(!safe.includes('PRIVATE')&&!safe.includes(root));}file('ios/Podfile.lock',lock);
  if(pin.sourceKind==='path'){const wrong=pin.packagePath+'/wrong-pod-root';file(wrong+'/source.m','Synthetic adjacent source');file('ios/Podfile.lock',{...lock,'EXTERNAL SOURCES':{...lock['EXTERNAL SOURCES'],[name]:{':path':'../'+wrong}}});assert.throws(capture);file('ios/Podfile.lock',lock);}
  else{const selected=join(root,'ios/Pods',name),outside=join(root,'outside-pod');renameSync(selected,outside);symlinkSync(outside,selected);assert.throws(capture);rmSync(selected);renameSync(outside,selected);}
 }
}));

test('unknown sibling Pods and changed Pod versions never inherit an explicit package binding',()=>ownLicenseFixture(({file,pins,lock,capture})=>{
 const pin=pins[0],sibling='UnboundSibling';file('ios/Podfile.lock',{...lock,PODS:[...lock.PODS,sibling+' ('+pin.version+')'],'EXTERNAL SOURCES':{...lock['EXTERNAL SOURCES'],[sibling]:{':path':'../'+dirname(pin.podspecSource)}}});assert.deepEqual(capture().find(value=>value.name===sibling).notices,[]);
 for(const pin of pins){const name=pin.component.slice('cocoapods:'.length,-pin.version.length-1);file('ios/Podfile.lock',{...lock,PODS:lock.PODS.map(value=>value===name+' ('+pin.version+')'?name+' (999.0.0)':value)});assert.deepEqual(capture().find(value=>value.name===name).notices,[]);}file('ios/Podfile.lock',lock);
}));

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


test('source diagnostics keep ReferenceError finite and snapshot changing or throwing Error fields once',()=>{
 const capture=error=>{let caught;try{noticeInputStep('source-path','metro',()=>{throw error;},undefined,'/PRIVATE_SOURCE');}catch(value){caught=value;}assert.equal(caught,error);return noticeFailureContext(caught);};
 const reference=Object.assign(new ReferenceError('PRIVATE_MESSAGE'),{name:'PRIVATE_CLASS',code:'PRIVATE_CODE',cause:{token:'PRIVATE_TOKEN'}});
 const projected=capture(reference);assert.equal(projected.errorClass,'ReferenceError');assert.equal(projected.errorCode,'other');assert.ok(!JSON.stringify(projected).includes('PRIVATE'));
 const reads={code:0,status:0,message:0},changing=new Error('PRIVATE_ORIGINAL');
 Object.defineProperties(changing,{
  code:{get(){return ++reads.code===1?'ERR_INVALID_ARG_TYPE':'PRIVATE_CHANGED_CODE';}},
  status:{get(){reads.status++;return undefined;}},
  message:{get(){reads.message++;return 'PRIVATE_CHANGED_MESSAGE';}},
 });
 const stable=capture(changing);assert.equal(stable.errorCode,'ERR_INVALID_ARG_TYPE');assert.deepEqual(reads,{code:1,status:1,message:1});assert.ok(!JSON.stringify(stable).includes('PRIVATE'));
 for(const throwing of ['code','status','message']){
  const counts={code:0,status:0,message:0},original=new Error('PRIVATE_ORIGINAL');
  for(const field of Object.keys(counts))Object.defineProperty(original,field,{get(){counts[field]++;if(field===throwing)throw new ReferenceError('PRIVATE_GETTER_FAILURE');return field==='code'?'ERR_ASSERTION':field==='status'?23:'PRIVATE_MESSAGE';}});
  const value=capture(original);assert.equal(value.errorCode,'other');assert.equal(value.errorCategory,'unsupported-input');assert.ok(!JSON.stringify(value).includes('PRIVATE'));
  assert.equal(counts[throwing],1);assert.ok(Object.values(counts).every(count=>count<=1));
 }
});

test('archive diagnostics preserve the original error and expose only fixed enums and verified hashes',()=>{
 const hash=digest('SYNTHETIC_ARCHIVE'),id='maven:PRIVATE_GROUP:PRIVATE_MODULE@PRIVATE_VERSION',original=new Error('PRIVATE_MESSAGE'),reads={stdout:0,stderr:0,stack:0,status:0};
 for(const key of ['stdout','stderr','stack'])Object.defineProperty(original,key,{get(){reads[key]++;throw new Error('PRIVATE_CHILD_OUTPUT');}});
 Object.defineProperty(original,'status',{get(){return ++reads.status===1?7:'PRIVATE_CHANGED_STATUS';}});
 let caught;try{noticeInputStep('native-inputs','android',()=>noticeInputStep('gradle-archive-scan','maven',()=>{throw original;},id,undefined,hash));}catch(error){caught=error;}
 assert.equal(caught,original);assert.deepEqual(reads,{stdout:0,stderr:0,stack:0,status:1});assert.deepEqual(noticeFailureContext(caught),{operation:'gradle-archive-scan',component:'maven',errorCategory:'subprocess-failed',componentSHA256:digest(id),archiveSHA256:hash});assert.ok(!JSON.stringify(noticeFailureContext(caught)).includes('PRIVATE'));
 for(const hashValue of [undefined,'PRIVATE_HASH',hash.toUpperCase(),{toString(){throw new Error('PRIVATE_COERCION');}}]){let invoked=false;assert.throws(()=>noticeInputStep('gradle-archive-scan','maven',()=>{invoked=true;},id,undefined,hashValue));assert.equal(invoked,false);}
 for(const [operation,component,source] of [['pod-source-scan','cocoapods',undefined],['pod-source-scan','maven',undefined],['gradle-archive-scan','android',undefined],['gradle-archive-scan','maven','PRIVATE_PATH']])assert.throws(()=>noticeInputStep(operation,component,()=>{},id,source,hash));
});

test('actual Gradle archive inspection reports its verified component/archive hashes and keeps success and drift strict',()=>fixture(({root,file})=>{
 const path=file('PRIVATE_ARCHIVE.aar','PRIVATE_NOT_A_ZIP'),hash=digest(readFileSync(path)),input={schema:1,configuration:'releaseRuntimeClasspath',components:[{group:'qa',name:'archive',version:'1',artifacts:[{file:path,sha256:hash}]}]},metadata=file('private-runtime.json',input);
 let failure;try{noticeInputStep('native-inputs','android',()=>gradleNoticeInputs(root,metadata));}catch(error){failure=error;}
 assert.equal(failure.status,1,'The original Python nonzero exit is preserved.');assert.deepEqual(noticeFailureContext(failure),{operation:'gradle-archive-scan',component:'maven',errorCategory:'subprocess-failed',componentSHA256:digest('maven:qa:archive@1'),archiveSHA256:hash});for(const secret of [root,'PRIVATE','Traceback','stderr','message'])assert.ok(!JSON.stringify(noticeFailureContext(failure)).includes(secret));
 input.components[0].artifacts[0].sha256=digest('DIFFERENT_BYTES');file('private-runtime.json',input);let drift;try{noticeInputStep('native-inputs','android',()=>gradleNoticeInputs(root,metadata));}catch(error){drift=error;}assert.ok(drift.message.startsWith('Resolved artifact changed.'));assert.equal(noticeFailureContext(drift).operation,'native-inputs');assert.equal(noticeFailureContext(drift).archiveSHA256,undefined,'Unverified bytes cannot gain archive context.');
 execFileSync('python3',['-c',"import zipfile,sys\nwith zipfile.ZipFile(sys.argv[1],'w') as z:z.writestr('META-INF/LICENSE','Actual synthetic notice\\n')",path]);const bytes=readFileSync(path);input.components[0].artifacts[0].sha256=digest(bytes);file('private-runtime.json',input);const result=gradleNoticeInputs(root,metadata);assert.equal(result.components[0].id,'maven:qa:archive@1');assert.deepEqual(result.components[0].notices,[{source:'maven:qa:archive:1/PRIVATE_ARCHIVE.aar!META-INF/LICENSE',sha256:digest('Actual synthetic notice\n'),body:'Actual synthetic notice\n'}]);assert.deepEqual(result.nativeFiles,[]);
}));


test('Pods follow only exact selected frameworks into the locked podspec package and still require vendor notices',()=>fixture(({root,file})=>{
 const pkg='node_modules/qa-sdk',pod='ios/Pods/QA',list='ios/Pods/Target Support Files/QA/QA-xcframeworks-input-files.xcfilelist';
 const lock={PODS:['QA (1)'],'EXTERNAL SOURCES':{QA:{':podspec':'../node_modules/qa-sdk/ios/QA.podspec'}}},packages={packages:{[pkg]:{version:'1'}}};
 file('package-lock.json',packages);file(pkg+'/package.json',{name:'qa-sdk',version:'1'});file(pkg+'/LICENSE',mit);file(pkg+'/ios/QA.podspec','public synthetic podspec');file('ios/Podfile.lock',lock);
 file('ios/Pods/Target Support Files/Pods-QA/Pods-QA-acknowledgements.plist',plist.default.build({PreferenceSpecifiers:[{Title:'QA',FooterText:mit}]}));file(pod+'/LICENSE',mit);
 const target=pkg+'/prebuilds/spm-deps/Shared/debug/Shared.xcframework',binary=target+'/Shared',link=join(root,pod,'Shared.xcframework');file(binary,Buffer.from([0xcf,0xfa,0xed,0xfe,1]));symlinkSync(join(root,target),link);
 const input='${PODS_ROOT}/Target Support Files/QA/QA-xcframeworks.sh\n${PODS_ROOT}/QA/Shared.xcframework\n';file(list,input);
 const initial=podNoticeInputs(root).components[0],fingerprint=initial.nativeInputs['cocoapods:QA'];
 assert.deepEqual(fingerprint.linkedSources,[{source:'Shared.xcframework',target,packagePath:pkg,component:'npm:qa-sdk@1'}]);assert.equal(fingerprint.frameworkInputList.sha256,digest(input));assert.equal(fingerprint.externalPodspec.component,'npm:qa-sdk@1');assert.equal(fingerprint.externalPodspec.sha256,digest('public synthetic podspec'));
 assert.ok(!JSON.stringify(initial).includes(root));assert.ok(initial.vendors.includes('Shared.xcframework'));assert.deepEqual(initial.vendorNotices['Shared.xcframework'],[]);
 assert.equal(resolveNoticeCoverage([initial],approval(initial)).unresolved[0].reason,'missing-vendored-notice','The owning package and Pod acknowledgement cannot license a separate vendor.');
 file(target+'/LICENSE','Distinct vendor licence\n');const complete=podNoticeInputs(root).components[0],reviewed=approval(complete);assert.equal(resolveNoticeCoverage([complete],reviewed).status,'READY');
 file(binary,Buffer.from([0xcf,0xfa,0xed,0xfe,2]));assert.equal(resolveNoticeCoverage(podNoticeInputs(root).components,reviewed).unresolved[0].reason,'native-source-digest-mismatch');file(binary,Buffer.from([0xcf,0xfa,0xed,0xfe,1]));
 file(list,input+'\n');assert.equal(resolveNoticeCoverage(podNoticeInputs(root).components,reviewed).unresolved[0].reason,'native-source-digest-mismatch');file(list,input);
 file(pkg+'/ios/QA.podspec','changed public synthetic podspec');assert.equal(resolveNoticeCoverage(podNoticeInputs(root).components,reviewed).unresolved[0].reason,'native-source-digest-mismatch');file(pkg+'/ios/QA.podspec','public synthetic podspec');
 const descriptor=podLinkedSources(root,'QA',join(root,pod),lock['EXTERNAL SOURCES'].QA).linkedSources[0];
 assert.throws(()=>nativeSourceNotices(root,join(root,pod),'cocoapods:QA'),'Undeclared boundary crossing is not generally accepted.');
 const guarded=nativeSourceNotices(root,join(root,pod),'cocoapods:QA',{linkedSources:[{...descriptor,privateBody:'PRIVATE_BODY'}]});assert.ok(!JSON.stringify(guarded).includes('PRIVATE_BODY'));
 for(const text of ['${PODS_ROOT}/QA/*.xcframework\n','${PODS_ROOT}/QA/Missing.xcframework\n','${PODS_ROOT}/QA/../Shared.xcframework\n']){file(list,text);assert.throws(()=>podLinkedSources(root,'QA',join(root,pod),lock['EXTERNAL SOURCES'].QA));}file(list,'${PODS_ROOT}/Target Support Files/QA/QA-xcframeworks.sh\n');assert.throws(()=>podNoticeInputs(root));file(list,input);
 file('node_modules/other/package.json',{name:'other',version:'1'});file('node_modules/other/LICENSE',mit);file('node_modules/other/ios/Other.podspec','other');file('node_modules/other/Other.xcframework/Other','private');file('package-lock.json',{packages:{...packages.packages,'node_modules/other':{version:'1'}}});
 rmSync(link);symlinkSync(join(root,'node_modules/other/Other.xcframework'),link);assert.throws(()=>podNoticeInputs(root),'A selected link cannot leave its exact podspec-owning package.');rmSync(link);symlinkSync(join(root,target),link);
 file('ios/Podfile.lock',{...lock,'EXTERNAL SOURCES':{QA:{':podspec':'../node_modules/other/ios/Other.podspec'}}});assert.throws(()=>podNoticeInputs(root));file('ios/Podfile.lock',lock);
 file(pkg+'/package.json',{name:'qa-sdk',version:'2'});assert.throws(()=>podNoticeInputs(root),'An installed owner differing from package-lock cannot qualify the link.');file(pkg+'/package.json',{name:'qa-sdk',version:'1'});
 file(pkg+'/outside/NOTICE','Not inside the selected vendor root');symlinkSync(join(root,pkg,'outside'),join(root,target,'outside'));assert.throws(()=>podNoticeInputs(root),'Nested links cannot escape even into another part of the owner package.');
}));

test('only the two locked generated Pods admit their actual autolink/config/spec closure, without inheriting licences',()=>fixture(({root,file})=>{
 const pins=JSON.parse(readFileSync(new URL('./app-notice-provenance.json',import.meta.url))).generatedPods,packages=[...pins.producerPackages,...pins.libraries],unique=[...new Map(packages.map(value=>[value.packagePath,value])).values()];
 file('package.json',{name:'notice-fixture',version:'1'});file('package-lock.json',{packages:Object.fromEntries(unique.map(value=>[value.packagePath,{version:value.component.slice(value.component.lastIndexOf('@')+1)}]))});
 for(const value of unique){file(value.packagePath+'/package.json',readFileSync(value.packagePath+'/package.json'));for(const notice of npmNoticeInputs(process.cwd(),[join(process.cwd(),value.packagePath,'package.json')])[0].notices)file(notice.source,notice.body);}
 for(const value of pins.producerFiles)file(value.source,readFileSync(value.source));
 for(const value of [...pins.producerTrees,...pins.coreSourceTrees,...pins.libraries.filter(value=>value.codegen)]){const target=value.source;mkdirSync(join(root,target),{recursive:true});cpSync(target,join(root,target),{recursive:true});for(const spec of value.podspecs??[])file(spec.source,readFileSync(spec.source));}
 const names=['ReactAppDependencyProvider','ReactCodegen'],lock={PODS:names.map(name=>name+' (0.86.3)'),'EXTERNAL SOURCES':Object.fromEntries(names.map(name=>[name,{':path':'build/generated/ios/'+name}]))};file('ios/Podfile.lock',lock);mkdirSync(join(root,'ios/Pods/Target Support Files'),{recursive:true});
 const metadata={root,reactNativePath:join(root,'node_modules/react-native'),dependencies:Object.fromEntries(pins.libraries.map(value=>[JSON.parse(readFileSync(value.packagePath+'/package.json')).name,{root:join(root,value.packagePath),platforms:{ios:{}}}])),project:{privateBody:'PRIVATE_EMAIL_AND_PATH'}};const metaPath='ios/build/generated/autolinking/autolinking.json';file(metaPath,metadata);
 const provider='ios/build/generated/ios/ReactAppDependencyProvider',codegen='ios/build/generated/ios/ReactCodegen';
 for(const [name,template] of Object.entries({'RCTAppDependencyProvider.h':'RCTAppDependencyProviderH.template','RCTAppDependencyProvider.mm':'RCTAppDependencyProviderMM.template','ReactAppDependencyProvider.podspec':'ReactAppDependencyProvider.podspec.template'})){let bytes=readFileSync('node_modules/react-native/scripts/codegen/templates/'+template);if(name.endsWith('.podspec'))bytes=Buffer.from(bytes.toString().replace('{react-native-version}','0.86.3').replace('{react-native-licence}','MIT'));file(provider+'/'+name,bytes);}
 for(const name of ['ReactCodegen.podspec',...['RCTThirdPartyComponentsProvider','RCTModuleProviders','RCTModulesConformingToProtocolsProvider','RCTUnstableModulesRequiringMainQueueSetupProvider'].flatMap(value=>[value+'.h',value+'.mm'])])file(codegen+'/'+name,'Synthetic generated output; no native execution or licence approval.\n');
 const capture=()=>podNoticeInputs(root).components,initial=capture();assert.equal(initial.length,2);
 for(const item of initial){const value=item.nativeInputs['cocoapods:'+item.name].generated;assert.equal(value.libraries.length,9);assert.equal(value.libraries.filter(value=>value.codegen).length,7);assert.equal(resolveNoticeCoverage([item],approval(item)).unresolved[0].reason,'missing-vendored-notice');assert.ok(!JSON.stringify(item).includes(root)&&!JSON.stringify(item).includes('PRIVATE'));
  if(item.name==='ReactCodegen'){file(codegen+'/RCTModuleProviders.h','Changed synthetic generated output');assert.notEqual(capture().find(v=>v.name===item.name).nativeInputs['cocoapods:ReactCodegen'].sha256,item.nativeInputs['cocoapods:ReactCodegen'].sha256);file(codegen+'/RCTModuleProviders.h','Synthetic generated output; no native execution or licence approval.\n');}
 }
 const rejects=()=>assert.throws(capture),mutate=(path,bytes)=>{const before=readFileSync(join(root,path));file(path,bytes);rejects();file(path,before);};
 mutate(pins.producerFiles[0].source,'Changed generator bytes');mutate('node_modules/react-native/scripts/codegen/generate-artifacts-executor/index.js','Changed dispatcher');
 const core=pins.coreSourceTrees[0].source,coreEntry=readdirSync(join(root,core),{recursive:true,withFileTypes:true}).find(value=>value.isFile());mutate(join(coreEntry.parentPath??coreEntry.path,coreEntry.name).slice(root.length+1),'Changed React Native core spec source');
 mutate(pins.libraries.find(value=>value.codegen).podspecs[0].source,'Changed platform-selection podspec');
 const source=pins.libraries.find(value=>value.codegen).source,entry=readdirSync(join(root,source),{recursive:true,withFileTypes:true}).find(value=>value.isFile());mutate(join(entry.parentPath??entry.path,entry.name).slice(root.length+1),'Changed selected spec input');
 mutate(provider+'/RCTAppDependencyProvider.h','Modified provider');file(provider+'/unknown-output.h','unknown');rejects();rmSync(join(root,provider+'/unknown-output.h'));
 const metaClone=()=>JSON.parse(JSON.stringify(metadata));
 for(const change of [v=>delete v.dependencies.expo,v=>v.dependencies.unknown={root},v=>v.dependencies.expo.platforms.ios=null,v=>v.dependencies.expo.root=root,v=>v.root=join(root,'elsewhere')]){const v=metaClone();change(v);file(metaPath,v);rejects();}file(metaPath,metadata);
 file('package.json',{name:'notice-fixture',codegenConfig:{jsSrcsDir:'src'}});rejects();file('package.json',{name:'notice-fixture',version:'1'});
 const version=JSON.parse(JSON.stringify(lock));version.PODS[0]='ReactAppDependencyProvider (0.86.4)';file('ios/Podfile.lock',version);rejects();file('ios/Podfile.lock',lock);
 mutate('node_modules/react-native/package.json',JSON.stringify({...JSON.parse(readFileSync('node_modules/react-native/package.json')),version:'0.86.4'}));
 file('outside/private','PRIVATE_SOURCE');symlinkSync(join(root,'outside'),join(root,codegen,'escaping'));rejects();rmSync(join(root,codegen,'escaping'));
 assert.throws(()=>nativeSourceNotices(root,join(root,codegen),'cocoapods:UnknownGenerated'));
 assert.throws(()=>nativeSourceNotices(root,join(root,provider),'cocoapods:ReactCodegen'));
 const absent=join(root,metaPath);rmSync(absent);rejects();file(metaPath,metadata);assert.equal(capture().length,2);
}));

test('the pinned RN selector uses actual autolinking metadata, with app config absent and core evidence kept separate',()=>fixture(({root,file})=>{
 const pins=JSON.parse(readFileSync(new URL('./app-notice-provenance.json',import.meta.url))).generatedPods,utils=require('react-native/scripts/codegen/generate-artifacts-executor/utils.js');
 const meta={root,reactNativePath:join(process.cwd(),'node_modules/react-native'),dependencies:Object.fromEntries(pins.libraries.map(value=>[JSON.parse(readFileSync(value.packagePath+'/package.json')).name,{root:join(process.cwd(),value.packagePath),platforms:{ios:{}}}]))};file('ios/build/generated/autolinking/autolinking.json',meta);
 const log=console.log,warn=console.warn;let selected,config;
 try{console.log=()=>{};console.warn=()=>{};config=utils.readReactNativeConfig(root,join(root,'ios'));selected=utils.findCodegenEnabledLibraries({name:'notice-fixture'},root,join(root,'ios'),config,{}).filter(value=>!utils.findDisabledLibrariesByPlatform(config,'ios').includes(value.name));}finally{console.log=log;console.warn=warn;}
 assert.deepEqual(selected.map(value=>{const pkg=JSON.parse(readFileSync(join(value.libraryPath,'package.json')));return 'npm:'+pkg.name+'@'+pkg.version;}).sort(),pins.libraries.filter(value=>value.codegen).map(value=>value.component).sort());
 assert.deepEqual(pins.coreSourceTrees.map(value=>value.source),['node_modules/react-native/src','node_modules/react-native/React/FBReactNativeSpec']);assert.ok(JSON.parse(readFileSync('node_modules/react-native/package.json')).codegenConfig.libraries.some(value=>value.name==='FBReactNativeSpec'));
}));

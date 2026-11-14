import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import test from 'node:test';
import {podNoticeInputs,gradleNoticeInputs,unionNoticeInputs,inspectNoticeArchive} from './native-notice-inputs.mjs';
import {digest,resolveNoticeCoverage} from './app-notices.mjs';
const require=createRequire(import.meta.url),plist=require('@expo/plist');
const mit=readFileSync(new URL('../node_modules/react-native/LICENSE',import.meta.url),'utf8');
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
 assert.equal(resolveNoticeCoverage(input.components,{schema:1,components:{}}).status,'INCOMPLETE');
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

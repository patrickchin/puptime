const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const fs=require('node:fs'),path=require('node:path'),root=path.resolve(__dirname,'../..');
const parser=require('@babel/parser');
const source=file=>fs.readFileSync(path.join(root,file),'utf8');
function transformer(){
 const sandbox={module:{exports:{}},__dirname,require:name=>name.endsWith('/babel-transformer.js')?{transform:args=>args}:require(name)};
 vm.runInNewContext(source('scripts/native-activity-probe/reload-transformer.cjs'),sandbox);
 return sandbox.module.exports;
}
test('Reload observation parses against actual frozen controls and retains original guard/callback',()=>{
 const transform=transformer();
 for(const filename of ['src/components/EventHistoryPanel.tsx','src/components/AccountSignIn.tsx']){
  const result=transform.transform({filename,src:source(filename)}).src;
  parser.parse(result,{sourceType:'module',plugins:['typescript','jsx']});
  assert.match(result,/import \{recordReload\}/);
  if(filename.includes('EventHistoryPanel')){
   assert.match(result,/recordReload\('handler'.*\n  if\(savingRef.current\)return;/);
   assert.match(result,/setSelected\(null\);selectedRef.current=null;setConfirm\(false\)/);
  }else assert.match(result,/recordReload\('press',\{disabled\}\);onPress\(\);/);
 }
 assert.throws(()=>transform.transform({filename:'src/components/EventHistoryPanel.tsx',src:source('src/components/EventHistoryPanel.tsx').replace(' const reload=()=>{',' const renamed=()=>{')}),/target changed/);
 const unrelated={filename:'src/domain.ts',src:source('src/domain.ts')};assert.equal(transform.transform(unrelated).src,unrelated.src);
});
test('Probe is bounded, excludes arbitrary fields/events and cannot interrupt the original action',()=>{
 let written,fail=false;
 const sandbox={ProbeFile:class{create(){}write(value){if(fail)throw Error('disk unavailable');written=JSON.parse(value);}},ProbePaths:{document:'synthetic'}};
 const script=source('scripts/native-activity-probe/reload-probe.js').replace("import {File,Paths} from 'expo-file-system';","const File=ProbeFile,Paths=ProbePaths;").replace('export function recordReload','function recordReload');
 vm.runInNewContext(script+'\nthis.record=recordReload;',sandbox);
 sandbox.record('private email',{email:'private@example.invalid'});assert.equal(written.events.length,0);
 for(let n=0;n<300;n++)sandbox.record('handler',{savingRef:false,x:201.2,email:'private@example.invalid',token:'private'});
 assert.equal(written.events.length,256);assert.equal(written.dropped,44);
 assert.deepEqual(Object.keys(written.events[0]).sort(),['at','event','savingRef','x']);
 fail=true;assert.doesNotThrow(()=>sandbox.record('press',{disabled:false}));
});
test('Reload configuration does not activate the existing SQLite/render observers',()=>{
 const previous=()=>{},load=enabled=>{
  const config={resolver:{resolveRequest:previous},transformer:{}};
  const sandbox={module:{exports:{}},__dirname,process:{env:{PUPTIME_HISTORY_RELOAD_PROBE:enabled}},require:name=>name==='expo/metro-config'?{getDefaultConfig:()=>config}:require(name)};
  vm.runInNewContext(source('scripts/native-activity-probe/metro.config.cjs'),sandbox);return sandbox.module.exports;
 };
 const observed=load('1'),normal=load('0');
 assert.equal(observed.resolver.resolveRequest,previous);assert.notEqual(normal.resolver.resolveRequest,previous);
 assert.equal(observed.transformer.babelTransformerPath,path.join(__dirname,'reload-transformer.cjs'));
 assert.equal(normal.transformer.babelTransformerPath,path.join(__dirname,'transformer.cjs'));
});
test('Failure cleanup collects actual probe before simulator disposal and preserves original failure',()=>{
 const {spawnSync}=require('node:child_process'),directory=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'puptime-reload-collector-'));
 try{
  const container=path.join(directory,'container'),output=path.join(directory,'output');fs.mkdirSync(path.join(container,'Documents'),{recursive:true});fs.mkdirSync(output);
  const evidence='{"events":[{"event":"handler","savingRef":false}]}';fs.writeFileSync(path.join(container,'Documents/history-reload-probe.json'),evidence);
  const run=source('scripts/run-ios-history-ci.sh'),cleanup=run.slice(run.indexOf('cleanup() {'),run.indexOf('trap cleanup EXIT'));
  const script=`set -euo pipefail\niphone_id=synthetic\nobserver_directory=''\noutput="$TEST_OUTPUT"\nxcrun(){ printf '%s\\n' "$2" >> "$TEST_CALLS"; if [ "$2" = get_app_container ]; then printf '%s' "$TEST_CONTAINER"; fi; }\n${cleanup}\ntrap cleanup EXIT\nfalse\n`;
  const result=spawnSync('bash',['-c',script],{env:{...process.env,PUPTIME_HISTORY_RELOAD_PROBE:'1',TEST_OUTPUT:output,TEST_CONTAINER:container,TEST_CALLS:path.join(directory,'calls')}});
  assert.equal(result.status,1);
  assert.equal(fs.readFileSync(path.join(output,'history-reload-probe.json'),'utf8'),evidence);
  assert.deepEqual(fs.readFileSync(path.join(directory,'calls'),'utf8').trim().split('\n'),['get_app_container','shutdown','delete']);
  assert.equal(fs.readFileSync(path.join(output,'exit-code.txt'),'utf8'),'1\n');
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});

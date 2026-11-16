// One disposable Linux/API36 probe. No application screens, accounts or publication.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import {constants,closeSync,existsSync,fstatSync,lstatSync,mkdirSync,mkdtempSync,openSync,readFileSync,readlinkSync,readSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {createServer} from 'node:net';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {installTaskCleanup,ownProcess} from './native-task-cleanup.mjs';
import {standardFixtureEnvironment} from './native-standard-suite.mjs';
import {readSqliteEngineReceipt} from './verify-ios-sqlite-engine.mjs';

const app='com.patrickchin.puptime',serial='emulator-5588';
const expected={version:'3.51.3',sourceId:'2026-03-13 10:38:09 737ae4a34738ffa0c3ff7f9bb18df914dd1cad163f28fd6b6e114a344fe6d618'};
const engineHashes=['abc152fd93810c76628dcf415e66e6cdd3182ce1ede4f45a5ea8c64b83dc1dfe','1be81cbb8a2cc6d943cd9f15f48001aa14073bcba750d8b475e0f7892bfca606'];
const templateKeySHA256='221e0a3106aa4c3ccc154e0a418b55020b3f9ea6e84f92e8749cd9e2f39f5e58',testCertificateSHA256='fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const gradleBuildSteps=['gradle-root','gradle-projects','gradle-selected-component','gradle-selected-count','gradle-selected-identity','gradle-bundle-task','gradle-sqlite-flags','gradle-cmake-source','gradle-probe-entry','gradle-evidence-write','gradle-model-complete'];

// Last entered source-owned boundary only; never an error or a completed-step claim.
export function readAndroidBuildStep(path){
 let descriptor;
 try{
  const initial=lstatSync(path);assert.ok(initial.isFile()&&!initial.isSymbolicLink()&&initial.size>0&&initial.size<=64);
  descriptor=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  const before=fstatSync(descriptor),buffer=Buffer.alloc(65);
  for(const key of ['dev','ino','size','mtimeMs','ctimeMs'])assert.equal(before[key],initial[key]);
  const length=readSync(descriptor,buffer,0,buffer.length,null);assert.equal(length,before.size);assert.equal(readSync(descriptor,buffer,length,1,null),0);
  for(const after of [fstatSync(descriptor),lstatSync(path)])for(const key of ['dev','ino','size','mtimeMs','ctimeMs'])assert.equal(after[key],before[key]);
  const step=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(buffer.subarray(0,length));return gradleBuildSteps.includes(step)?step:null;
 }catch{return null;}
 finally{if(descriptor!==undefined)try{closeSync(descriptor);}catch{}}
}

function stableFile(path,limit=256*1024*1024){
 const initial=lstatSync(path);assert.ok(initial.isFile()&&!initial.isSymbolicLink()&&initial.size>0&&initial.size<=limit);
 const descriptor=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{
  const before=fstatSync(descriptor),digest=createHash('sha256'),buffer=Buffer.alloc(1024*1024);let bytes=0;
  for(const key of ['dev','ino','size','mtimeMs','ctimeMs'])assert.equal(before[key],initial[key]);
  for(;;){const count=readSync(descriptor,buffer,0,Math.min(buffer.length,limit+1-bytes),null);if(!count)break;bytes+=count;assert.ok(bytes<=limit);digest.update(buffer.subarray(0,count));}
  assert.equal(bytes,before.size);
  for(const after of [fstatSync(descriptor),lstatSync(path)])for(const key of ['dev','ino','size','mtimeMs','ctimeMs'])assert.equal(after[key],before[key]);
  return digest.digest('hex');
 }finally{closeSync(descriptor);}
}

// Raw paths stay inside the private Gradle-to-checker boundary; provenance contains hashes/booleans only.
export function validateAndroidSelection(value,root){
 assert.ok(value&&Object.keys(value).sort().join(',')==='cmake,entry,libsql,project,selected,sqlcipher');
 assert.equal(value.selected,true);assert.equal(value.libsql,false);assert.equal(value.sqlcipher,false);
 const canonical=path=>{assert.equal(typeof path,'string');return realpathSync(path);};
 assert.equal(canonical(value.project),join(root,'node_modules/expo-sqlite/android'));
 assert.equal(canonical(value.cmake),join(root,'node_modules/expo-sqlite/android/CMakeLists.txt'));
 assert.equal(canonical(value.entry),join(root,'index.sqlite-engine-probe.js'));
 return {name:'expo-sqlite',version:'57.0.5',localProject:true,sourceCMake:true,probeEntry:true,useLibSQL:false,useSQLCipher:false};
}

export function androidSelectionInit(root,output,buildStepOutput){
 const hex=value=>Buffer.from(value).toString('hex');
 return `import groovy.json.JsonOutput
import org.gradle.api.artifacts.component.ProjectComponentIdentifier
def sourceRoot = new File(new String('${hex(root)}'.decodeHex(), 'UTF-8')).canonicalFile
def evidence = new File(new String('${hex(output)}'.decodeHex(), 'UTF-8'))
def breadcrumb = new File(new String('${hex(buildStepOutput)}'.decodeHex(), 'UTF-8'))
def markBuildStep = { value ->
  try {
    if (breadcrumb.createNewFile()) {
      breadcrumb.setReadable(false, false); breadcrumb.setWritable(false, false)
      breadcrumb.setReadable(true, true); breadcrumb.setWritable(true, true)
    }
    breadcrumb.setText(value, 'UTF-8')
  } catch (Throwable ignored) {}
}
gradle.projectsEvaluated { current ->
  markBuildStep('gradle-root')
  if (current.rootProject.projectDir.canonicalFile != new File(sourceRoot, 'android').canonicalFile) return
  markBuildStep('gradle-projects')
  def app = current.rootProject.findProject(':app')
  def sqlite = current.rootProject.findProject(':expo-sqlite')
  assert app != null && sqlite != null
  assert sqlite.projectDir.canonicalFile == new File(sourceRoot, 'node_modules/expo-sqlite/android').canonicalFile
  markBuildStep('gradle-selected-component')
  def selected = app.configurations.getByName('releaseRuntimeClasspath').incoming.resolutionResult.allComponents.findAll {
    it.id instanceof ProjectComponentIdentifier && it.id.projectPath == ':expo-sqlite'
  }
  markBuildStep('gradle-selected-count')
  assert selected.size() == 1
  markBuildStep('gradle-selected-identity')
  assert selected.first().id == sqlite.configurations.getByName('releaseRuntimeClasspath').incoming.resolutionResult.rootComponent.get().id
  markBuildStep('gradle-bundle-task')
  def bundle = app.tasks.named('createBundleReleaseJsAndAssets').get()
  markBuildStep('gradle-sqlite-flags')
  assert sqlite.ext.USE_LIBSQL == false && sqlite.ext.USE_SQLCIPHER == false
  markBuildStep('gradle-cmake-source')
  assert sqlite.extensions.getByName('android').externalNativeBuild.cmake.path.canonicalFile == new File(sourceRoot, 'node_modules/expo-sqlite/android/CMakeLists.txt').canonicalFile
  markBuildStep('gradle-probe-entry')
  assert bundle.entryFile.get().asFile.canonicalFile == new File(sourceRoot, 'index.sqlite-engine-probe.js').canonicalFile && bundle.devEnabled.get() == false
  markBuildStep('gradle-evidence-write')
  assert evidence.createNewFile()
  evidence.setReadable(false, false); evidence.setWritable(false, false)
  assert evidence.setReadable(true, true) && evidence.setWritable(true, true)
  evidence.text = JsonOutput.toJson([project: sqlite.projectDir.canonicalPath,
    cmake: sqlite.extensions.getByName('android').externalNativeBuild.cmake.path.canonicalPath,
    entry: bundle.entryFile.get().asFile.canonicalPath, selected: true,
    libsql: sqlite.ext.USE_LIBSQL, sqlcipher: sqlite.ext.USE_SQLCIPHER])
  markBuildStep('gradle-model-complete')
}
`;
}

export function androidReceiptStat(text){
 assert.match(text,/^\d+ \d+ (?:0|[1-9]\d{0,2}) \d+ \d+ [a-f0-9]+\n?$/);
 const [device,inode,size,modified,changed,mode]=text.trim().split(' ');
 assert.ok(Number(size)>0&&Number(size)<=256);assert.equal(parseInt(mode,16)&0xf000,0x8000);
 return {device,inode,size:Number(size),modified,changed,mode};
}

export function androidOffline(value){
 const text=value.connectivity.replaceAll('\r',''),section=text.match(/^[ \t]*Current Networks:[ \t]*\n([\s\S]*?)^[ \t]*Status for known UIDs:[ \t]*$/m);
 assert.equal(value.airplane.trim(),'1');assert.equal(value.wifiPreference.trim(),'0');assert.equal(value.wifiStatus.replaceAll('\r','').split('\n')[0].trim(),'Wifi is disabled');
 assert.equal((text.match(/^[ \t]*Active default network: [^\n]*$/gm)??[]).length,1);assert.match(text,/^[ \t]*Active default network: none[ \t]*$/m);
 assert.equal((text.match(/^[ \t]*Current Networks:[ \t]*$/gm)??[]).length,1);assert.equal((text.match(/^[ \t]*Status for known UIDs:[ \t]*$/gm)??[]).length,1);assert.ok(section&&section[1].trim()==='');
 return true;
}

export function androidProcessIdentity(files,expected){
 const state=text=>{const fields=text.slice(text.lastIndexOf(')')+2).trim().split(/\s+/);assert.match(fields[19]??'',/^\d+$/);return {start:fields[19],alive:!['Z','X'].includes(fields[0])};};
 const before=state(files.stat),after=state(files.afterStat);assert.equal(after.start,before.start);
 const argv=files.cmdline.split('\0').filter(Boolean),uids=files.status.match(/^Uid:\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/m)?.slice(1);
 return {...after,owned:after.alive&&expected.executables.includes(files.exe)&&expected.executables.includes(argv[0])&&JSON.stringify(argv.slice(1))===JSON.stringify(expected.arguments)&&JSON.stringify(files.environ.split('\0').filter(value=>value.startsWith('ANDROID_AVD_HOME=')))===JSON.stringify(['ANDROID_AVD_HOME='+expected.home])&&!!uids&&uids.every(value=>value===expected.uid)};
}

const apkInspection=String.raw`import hashlib,json,struct,sys,zipfile
with zipfile.ZipFile(sys.argv[1]) as z:
 entries=z.infolist(); names=[i.filename for i in entries]
 assert len(names)==len(set(names)) and len(names)<=20000
 assert {n.split('/')[1] for n in names if n.startswith('lib/') and n.endswith('.so')}=={'x86_64'}
 result={}
 for name,key,limit in [('lib/x86_64/libexpo-sqlite.so','sqliteLibrarySHA256',32*1024*1024),('assets/index.android.bundle','bundleSHA256',64*1024*1024)]:
  i=z.getinfo(name); assert not i.is_dir() and not i.flag_bits&1 and 0<i.file_size<=limit
  h=hashlib.sha256(); length=0; header=b''
  with z.open(i) as f:
   while True:
    b=f.read(min(1024*1024,limit+1-length))
    if not b: break
    if length==0: header=b[:64]
    length+=len(b); assert length<=limit; h.update(b)
  assert length==i.file_size
  if key=='sqliteLibrarySHA256': assert header[:6]==b'\x7fELF\x02\x01' and struct.unpack('<H',header[18:20])[0]==62
  result[key]=h.hexdigest()
 result.update(abi='x86_64',elfClass=64,elfMachine=62)
 print(json.dumps(result))
`;

async function portsFree(){
 for(const port of [5588,5589])for(const host of ['127.0.0.1','::1'])assert.ok(await new Promise(resolve=>{const server=createServer();server.once('error',()=>resolve(false));server.listen({port,host,exclusive:true},()=>server.close(()=>resolve(true)));}));
}

async function runOwned(binary,args,{cwd,env,timeout=120000,input,own,inheritOutput=false}={}){
 const child=spawn(binary,args,{cwd,env,stdio:[input===undefined?'ignore':'pipe',inheritOutput?'inherit':'ignore',inheritOutput?'inherit':'ignore'],detached:true}),stop=ownProcess(child);let timer,failure;
 own?.(stop);
 try{
  await new Promise((pass,fail)=>{child.once('error',fail);child.stdin?.once('error',fail);child.once('close',code=>code===0?pass():fail(new Error('Owned command failed.')));timer=setTimeout(()=>{const error=new Error('Owned command timed out.');void stop().then(()=>fail(error),()=>fail(error));},timeout);if(input!==undefined)child.stdin.end(input);});
 }catch(error){failure=error;throw error;}
 finally{clearTimeout(timer);try{assert.ok(await stop());}catch(error){if(!failure)throw error;}}
}

export async function verifyAndroidSqliteEngine(){
 assert.equal(process.platform,'linux');assert.equal(process.env.GITHUB_ACTIONS,'true');assert.equal(process.env.GITHUB_REPOSITORY,'patrickchin/puptime');
 const runId=process.env.GITHUB_RUN_ID,attempt=Number(process.env.GITHUB_RUN_ATTEMPT);assert.match(runId??'',/^[1-9]\d{0,19}$/);assert.ok(Number.isSafeInteger(attempt)&&attempt>0);
 const root=realpathSync(process.cwd()),sdk=realpathSync(process.env.ANDROID_HOME??''),runner=realpathSync(process.env.RUNNER_TEMP??'');assert.ok(lstatSync(join(root,'node_modules')).isDirectory()&&!lstatSync(join(root,'node_modules')).isSymbolicLink());
 assert.equal(existsSync(join(root,'.env')),false);
 const env=standardFixtureEnvironment(process.env,'https://127.0.0.1:1');for(const key of ['EXPO_OVERRIDE_METRO_CONFIG','NODE_OPTIONS','NODE_PATH'])delete env[key];Object.assign(env,{CI:'1',EXPO_NO_TELEMETRY:'1',EXPO_NO_METRO_WORKSPACE_ROOT:'1',ENTRY_FILE:'index.sqlite-engine-probe.js'});
 const command=(binary,args,{timeout=30000,maxBuffer=16384,binaryOutput=false,ok=[0],cwd=root}={})=>{const result=spawnSync(binary,args,{cwd,env,timeout,maxBuffer,encoding:binaryOutput?undefined:'utf8',stdio:['ignore','pipe','ignore']});if(result.error)throw result.error;assert.ok(ok.includes(result.status),'Bounded command failed.');return result.stdout;};
 const source=command('git',['rev-parse','HEAD']).trim(),tree=command('git',['rev-parse','HEAD^{tree}']).trim();assert.match(source,/^[a-f0-9]{40}$/);assert.match(tree,/^[a-f0-9]{40}$/);command('git',['diff','--quiet','HEAD','--']);
 const output=join(root,'build/android-sqlite-engine-check');assert.ok(!existsSync(output));mkdirSync(output,{recursive:true,mode:0o700});
 const emulator=join(sdk,'emulator/emulator'),adbPath=join(sdk,'platform-tools/adb'),tools=join(sdk,'build-tools/36.0.0'),avdmanager=join(realpathSync(process.env.PUPTIME_ANDROID_CMDLINE_BIN??''),'avdmanager');assert.ok(realpathSync(avdmanager).startsWith(sdk+'/'));
 const privateRoot=mkdtempSync(join(runner,'puptime-android-engine-')),avdHome=join(privateRoot,'avd'),name='Puptime_SQLite_Engine_'+runId+'_'+attempt,ownedStops=[];
 const args=['-avd',name,'-port','5588','-no-window','-no-audio','-no-snapshot','-gpu','swiftshader_indirect'];
 const cleanup={appStopped:false,processesStopped:false,emulatorExited:false,avdRemoved:false,portsReleased:false,privateMaterialRemoved:false};
 const buildStepOutput=join(privateRoot,'build-step.txt');
 let child,stopEmulator,ownerStart,spawnError,failure,mayStop=false,phase='source',buildStep=null,engineBytes,engineMatchesExpected=null,api=null,apkSHA256,installedApkSHA256,apk,selectedModule;
 const inspect=()=>{
  // An unreadable inspection never inherits a prior permission to signal.
  mayStop=false;
  if(!child?.pid)return null;
  try{const proc='/proc/'+child.pid,stat=readFileSync(join(proc,'stat'),'utf8');return androidProcessIdentity({stat,exe:readlinkSync(join(proc,'exe')),cmdline:readFileSync(join(proc,'cmdline'),'utf8'),environ:readFileSync(join(proc,'environ'),'utf8'),status:readFileSync(join(proc,'status'),'utf8'),afterStat:readFileSync(join(proc,'stat'),'utf8')},{executables:[emulator,join(sdk,'emulator/qemu/linux-x86_64/qemu-system-x86_64'),join(sdk,'emulator/qemu/linux-x86_64/qemu-system-x86_64-headless')].filter(existsSync).map(path=>realpathSync(path)),arguments:args,home:avdHome,uid:String(process.getuid())});}catch(error){if(error.code==='ENOENT'||error.code==='ESRCH')return null;throw error;}
 };
 const owned=()=>{if(spawnError)throw spawnError;const value=inspect();assert.ok(value?.alive&&value.owned&&(ownerStart===undefined||value.start===ownerStart),'Require the exact live task emulator.');ownerStart??=value.start;mayStop=true;};
 const adb=(args,settings)=>{owned();return command(adbPath,['-s',serial,...args],settings);};
 const poll=async(ms,read)=>{const deadline=Date.now()+ms;do{owned();if(await read())return;await new Promise(resolve=>setTimeout(resolve,250));}while(Date.now()<deadline);throw new Error('Bounded readback timed out.');};
 const task=installTaskCleanup(async()=>{
  mayStop=false;let commandsStopped=true;
  for(const stop of ownedStops)try{commandsStopped=(await stop())&&commandsStopped;}catch{commandsStopped=false;}
  try{
   if(child){const state=inspect();if(state?.alive){mayStop=state.owned&&state.start===ownerStart;assert.ok(mayStop);try{adb(['shell','am','force-stop',app]);cleanup.appStopped=true;}finally{try{adb(['emu','kill']);}catch{}}}else{mayStop=ownerStart!==undefined&&(!state||state.start===ownerStart);cleanup.appStopped=true;}}
   else{mayStop=true;cleanup.appStopped=true;}
  }finally{
   try{const emulatorStopped=mayStop&&(stopEmulator?await stopEmulator():true);cleanup.processesStopped=commandsStopped&&emulatorStopped;cleanup.emulatorExited=!inspect()?.alive;assert.ok(cleanup.processesStopped&&cleanup.emulatorExited);}
   finally{try{if(cleanup.emulatorExited&&cleanup.processesStopped){rmSync(privateRoot,{recursive:true,force:true});cleanup.avdRemoved=!existsSync(avdHome);cleanup.privateMaterialRemoved=!existsSync(privateRoot);}await portsFree();cleanup.portsReleased=true;}finally{assert.ok(Object.values(cleanup).every(value=>value===true));}}
  }
 });
 const run=(binary,args,options)=>runOwned(binary,args,{...options,own:stop=>ownedStops.push(stop)});
 try{
  mkdirSync(avdHome,{mode:0o700});env.ANDROID_AVD_HOME=avdHome;
  const pkg=JSON.parse(readFileSync(join(root,'package.json'),'utf8'));assert.ok(pkg.expo.autolinking.android.buildFromSource.includes('expo-sqlite'));assert.equal(JSON.parse(readFileSync(join(root,'node_modules/expo-sqlite/package.json'),'utf8')).version,'57.0.5');
  const hashes=()=>['sqlite3.c','sqlite3.h'].map(name=>stableFile(join(root,'node_modules/expo-sqlite/vendor/sqlite3',name),12*1024*1024));assert.deepEqual(hashes(),engineHashes);
  phase='prebuild';await run(process.execPath,['node_modules/expo/bin/cli','prebuild','--platform','android','--no-install'],{cwd:root,env,timeout:600000});
  assert.equal(stableFile(join(root,'android/app/debug.keystore'),16384),templateKeySHA256);
  const selection=join(privateRoot,'selected-module.json'),init=join(privateRoot,'engine-inputs.gradle');writeFileSync(init,androidSelectionInit(root,selection,buildStepOutput),{flag:'wx',mode:0o600});
  phase='build';buildStep='gradle-command';await run(join(root,'android/gradlew'),[':app:assembleRelease','--no-daemon','-PreactNativeArchitectures=x86_64','--init-script',init],{cwd:join(root,'android'),env,timeout:1800000,inheritOutput:true});
  buildStep='selection-read';const selectedStat=lstatSync(selection);assert.ok(selectedStat.isFile()&&!selectedStat.isSymbolicLink()&&selectedStat.size<=8192);const selectedValue=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(readFileSync(selection)));
  buildStep='selection-validate';selectedModule=validateAndroidSelection(selectedValue,root);buildStep='source-preservation';assert.deepEqual(hashes(),engineHashes);command('git',['diff','--quiet','HEAD','--']);
  phase='package';const apkPath=join(root,'android/app/build/outputs/apk/release/app-release.apk');apkSHA256=stableFile(apkPath);
  const certificate=command(join(tools,'apksigner'),['verify','--verbose','--print-certs',apkPath]);assert.equal((certificate.match(/Signer #[1-9]\d* certificate SHA-256 digest: ([a-f0-9]{64})/g)??[]).length,1);assert.ok(certificate.includes('Signer #1 certificate SHA-256 digest: '+testCertificateSHA256));
  const badging=command(join(tools,'aapt2'),['dump','badging',apkPath]);assert.match(badging,/^package: name='com\.patrickchin\.puptime' /);assert.match(badging,/^minSdkVersion:'24'$/m);assert.match(badging,/^targetSdkVersion:'36'$/m);
  const inspected=JSON.parse(command('python3',['-I','-c',apkInspection,apkPath],{maxBuffer:2048}));assert.equal(Object.keys(inspected).sort().join(','),'abi,bundleSHA256,elfClass,elfMachine,sqliteLibrarySHA256');assert.equal(inspected.abi,'x86_64');assert.equal(inspected.elfClass,64);assert.equal(inspected.elfMachine,62);for(const key of ['bundleSHA256','sqliteLibrarySHA256'])assert.match(inspected[key],/^[a-f0-9]{64}$/);
  apk={abi:'x86_64',elfClass:64,elfMachine:62,sqliteLibrarySHA256:inspected.sqliteLibrarySHA256,bundleSHA256:inspected.bundleSHA256};
  assert.equal(stableFile(apkPath),apkSHA256);
  phase='create';await portsFree();await run(avdmanager,['create','avd','--name',name,'--package','system-images;android-36;google_apis;x86_64'],{cwd:root,env,input:'no\n'});
  child=spawn(emulator,args,{env,stdio:'ignore',detached:true});child.once('error',error=>{spawnError=error;});stopEmulator=ownProcess(child);
  const ownerDeadline=Date.now()+5000;for(;;){if(spawnError)throw spawnError;const value=inspect();if(value?.alive&&value.owned){ownerStart=value.start;break;}assert.ok(Date.now()<ownerDeadline,'Require the owned launcher before adb.');await new Promise(resolve=>setTimeout(resolve,250));}
  phase='boot';const consoleName=()=>{try{return adb(['emu','avd','name'],{timeout:3000}).replaceAll('\r','').trim()===name+'\nOK';}catch{return false;}};
  await poll(180000,()=>{try{return consoleName()&&adb(['shell','getprop','sys.boot_completed']).trim()==='1';}catch{return false;}});
  owned();const rootResult=spawnSync(adbPath,['-s',serial,'root'],{env,encoding:'utf8',timeout:20000,maxBuffer:1024,stdio:['ignore','pipe','pipe']});const rootText=(rootResult.stdout??'')+(rootResult.stderr??'');assert.ok(!rootResult.error&&(rootResult.status===0&&['','adbd is already running as root\n','restarting adbd as root\n'].includes(rootText.replaceAll('\r',''))||rootResult.status===1&&rootResult.stdout===''&&rootResult.stderr.replaceAll('\r','')==='adb: unable to connect for root: closed\n'));
  await poll(60000,()=>{try{return consoleName()&&adb(['shell','getprop','sys.boot_completed']).trim()==='1'&&adb(['shell','id','-u']).trim()==='0';}catch{return false;}});
  assert.equal(adb(['shell','getprop','ro.build.version.sdk']).trim(),'36');api=36;assert.equal(adb(['shell','getprop','ro.product.cpu.abi']).trim(),'x86_64');
  adb(['shell','svc','wifi','disable']);adb(['shell','svc','data','disable']);adb(['shell','cmd','connectivity','airplane-mode','enable']);
  await poll(30000,()=>{try{return androidOffline({airplane:adb(['shell','settings','get','global','airplane_mode_on']),wifiPreference:adb(['shell','settings','get','global','wifi_on']),wifiStatus:adb(['shell','cmd','wifi','status']),connectivity:adb(['shell','dumpsys','connectivity'],{maxBuffer:256*1024})});}catch{return false;}});
  assert.equal(adb(['shell','pm','path',app],{ok:[1]}),'');
  phase='install';assert.match(adb(['install',apkPath],{timeout:180000}),/^(?:Performing (?:Streamed|Push) Install\r?\n)?Success\s*$/);
  const installed=adb(['shell','pm','path',app]).trim();assert.match(installed,/^package:\/data\/app\/[^\n]+\/base\.apk$/);const readback=join(privateRoot,'installed.apk');adb(['pull',installed.slice(8),readback]);installedApkSHA256=stableFile(readback);assert.equal(installedApkSHA256,apkSHA256);
  const receipt='/data/user/0/'+app+'/files/sqlite-engine-probe.json';adb(['shell','am','force-stop',app]);adb(['shell','rm','-f',receipt]);
  phase='launch';adb(['shell','am','start','-W','-n',app+'/.MainActivity']);
  phase='receipt';await poll(60000,()=>{try{return androidReceiptStat(adb(['shell','stat','-c','%d %i %s %Y %Z %f',receipt])).size>0;}catch{return false;}});
  assert.equal(adb(['shell','readlink','-f',receipt]).trim(),receipt);const before=androidReceiptStat(adb(['shell','stat','-c','%d %i %s %Y %Z %f',receipt]));
  const raw=adb(['exec-out','dd','if='+receipt,'bs=257','count=1'],{binaryOutput:true,maxBuffer:257});assert.equal(raw.length,before.size);assert.deepEqual(androidReceiptStat(adb(['shell','stat','-c','%d %i %s %Y %Z %f',receipt])),before);
  const local=join(privateRoot,'query-receipt.json');writeFileSync(local,raw,{flag:'wx',mode:0o600});engineBytes=readSqliteEngineReceipt(local);engineMatchesExpected=engineBytes.equals(Buffer.from(JSON.stringify(expected)));assert.equal(engineMatchesExpected,true,'Require the expected Android SQLite engine.');assert.equal(task.signal,null);
 }catch(error){failure=error;if(phase==='build'&&buildStep==='gradle-command')buildStep=readAndroidBuildStep(buildStepOutput)??buildStep;}
 finally{
  try{await task.run();}catch(error){failure??=error;}finally{task.dispose();}
  try{
   command('git',['diff','--quiet','HEAD','--']);assert.deepEqual(['sqlite3.c','sqlite3.h'].map(name=>stableFile(join(root,'node_modules/expo-sqlite/vendor/sqlite3',name),12*1024*1024)),engineHashes);
   if(engineBytes&&Object.values(cleanup).every(value=>value===true))writeFileSync(join(output,'sqlite-engine-probe.json'),engineBytes,{flag:'wx',mode:0o600});
   writeFileSync(join(output,'sqlite-engine-provenance.json'),JSON.stringify({schemaVersion:2,stage:'android-sqlite-engine-ci',status:failure?'failed':'passed',phase,buildStep,checkoutCommit:source,checkoutTree:tree,runId,runAttempt:attempt,engineMatchesExpected,api,selectedModule:selectedModule?{...selectedModule,sourceHashes:engineHashes}:null,apk:apk?{...apk,sha256:apkSHA256,installedSHA256:installedApkSHA256??null,testCertificateSHA256}:null,cleanup},null,2)+'\n',{flag:'wx',mode:0o600});
  }catch(error){failure??=error;}
 }
 if(failure)throw failure;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{assert.equal(process.argv.length,2);await verifyAndroidSqliteEngine();}
 catch{console.error('Android SQLite engine CI check failed.');process.exitCode=1;}
}

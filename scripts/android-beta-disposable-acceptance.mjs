// One offline, artificial API36 fixture. Never an owner upgrade or Play verdict.
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {createHash,randomBytes} from 'node:crypto';
import {cpSync,existsSync,lstatSync,mkdirSync,readFileSync,readdirSync,readlinkSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {createServer} from 'node:net';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {installTaskCleanup,ownProcess} from './native-task-cleanup.mjs';
import {standardFixtureEnvironment} from './native-standard-suite.mjs';
import {createSnapshotTools,preservationEquality,coldPreservationEquality,installFailureProjection,
 processStart,processIdentity,ownedProcess,recordOwnedEmulator,emulatorRoot,emulatorOffline,stopEmulator,
 readOffline,offlineReady,stableFile,readSqliteEngineReceipt,androidReceiptStat,diagnosticFields} from './android-beta-disposable-oracles.mjs';

export const OLD125=Object.freeze({sha256:'82fa41075db35d747360183a2c3ff364e5c4fb4813519135d7a5eb076249a927',certificateSHA256:'fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c',version:'1.12.5',versionCode:1012005});
export const ENGINE=Object.freeze({version:'3.51.3',sourceId:'2026-03-13 10:38:09 737ae4a34738ffa0c3ff7f9bb18df914dd1cad163f28fd6b6e114a344fe6d618'});
export const PHASES=['binding','artifact-identity','lease','old-install','old-ui-fixture','old-snapshot','candidate-update-rejected','rejection-preservation','fixture-remove','candidate-install','candidate-ui-offline','candidate-cold-preservation','qa-bundle','qa-copy-final-member-proof','candidate-remove','qa-copy-install','native-engine-query','cleanup'];
const app='com.patrickchin.puptime',serial='emulator-5588',hex=/^[a-f0-9]{64}$/,commit=/^[a-f0-9]{40}$/;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const exactKeys=(value,keys)=>assert.ok(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(','));
const positive=value=>assert.ok(Number.isSafeInteger(value)&&value>0);

export function assertBoundPins(pins){
 exactKeys(pins,['schema','driverSource','reviewSHA256','candidate']);assert.equal(pins.schema,1);assert.match(pins.driverSource??'',commit);assert.match(pins.reviewSHA256??'',hex);
 const p=pins.candidate;exactKeys(p,['source','run','attempt','artifact','artifactBytes','artifactDigest','sha256','bytes','certificateSHA256','manifestSHA256','custodySHA256','version','versionCode','minSdk','targetSdk']);
 assert.equal(p.source,pins.driverSource);for(const key of ['run','artifact','artifactBytes','bytes','versionCode','minSdk','targetSdk'])positive(p[key]);assert.equal(p.attempt,1);
 assert.ok(p.artifactBytes<=512*1024*1024&&p.bytes<=256*1024*1024&&p.minSdk<=36&&p.targetSdk>=36);
 for(const key of ['artifactDigest','sha256','certificateSHA256','manifestSHA256','custodySHA256'])assert.match(p[key]??'',hex);
 assert.notEqual(p.certificateSHA256,OLD125.certificateSHA256);assert.match(p.version??'',/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);assert.ok(p.versionCode>OLD125.versionCode&&p.versionCode<=2100000000);
 return pins;
}

const cleanupKeys=['commandsStopped','emulatorStopped','adbStopped','avdDeleted','privateFilesDeleted','portsFree'];
export function processGroupAbsent(pid,probe=(group,signal)=>process.kill(group,signal)){
 positive(pid);try{probe(-pid,0);return false;}catch(error){return diagnosticFields(error,['code'])?.code==='ESRCH';}
}
async function assertTaskPortsFree(){for(const port of [5037,5588,5589])for(const host of ['127.0.0.1','::1'])assert.ok(await new Promise(done=>{const server=createServer();server.once('error',()=>done(false));server.listen({port,host,exclusive:true},()=>server.close(()=>done(true)));}));}
export function validateReceipt(value){
 exactKeys(value,['schema','scope','status','source','admissionSHA256','reviewSHA256','custodySHA256','candidateSHA256','candidateCertificateSHA256','producer','phases','rejection','freshProduct','qaCopy','engine','failure','cleanup']);
 assert.equal(value.schema,1);assert.equal(value.scope,'disposable-upload-signer-rejection-and-fresh-product');assert.ok(['PASS','FAIL','CANCELLED'].includes(value.status));
 assert.match(value.source,commit);for(const key of ['admissionSHA256','reviewSHA256','custodySHA256','candidateSHA256','candidateCertificateSHA256'])assert.match(value[key],hex);
 exactKeys(value.producer,['run','attempt','artifact','artifactDigest']);positive(value.producer.run);positive(value.producer.artifact);assert.equal(value.producer.attempt,1);assert.match(value.producer.artifactDigest,hex);
 assert.ok(Array.isArray(value.phases)&&value.phases.length<=PHASES.length);const seen=new Set();
 for(const row of value.phases){exactKeys(row,['phase','status']);assert.ok(PHASES.includes(row.phase)&&!seen.has(row.phase));seen.add(row.phase);assert.ok(['started','passed','failed'].includes(row.status));}
 assert.ok([null,'INSTALL_FAILED_UPDATE_INCOMPATIBLE'].includes(value.rejection));assert.ok([null,true].includes(value.freshProduct));
 if(value.qaCopy!==null){exactKeys(value.qaCopy,['sha256','bundleSHA256','certificateSHA256','ordinaryMembersCompared','nativeLibrariesCompared','allOrdinaryMemberBytesAndCompressionEqual']);for(const key of ['sha256','bundleSHA256','certificateSHA256'])assert.match(value.qaCopy[key],hex);for(const key of ['ordinaryMembersCompared','nativeLibrariesCompared'])assert.ok(Number.isSafeInteger(value.qaCopy[key])&&value.qaCopy[key]>0&&value.qaCopy[key]<=20000);assert.equal(value.qaCopy.allOrdinaryMemberBytesAndCompressionEqual,true);}
 if(value.engine!==null){exactKeys(value.engine,['version','sourceId']);assert.deepEqual(value.engine,ENGINE);}
 if(value.failure!==null){exactKeys(value.failure,['phase','class','status']);assert.ok(PHASES.includes(value.failure.phase));assert.ok(['assertion','command-failed','timeout','missing-tool','other','cancelled'].includes(value.failure.class));assert.ok(value.failure.status===null||Number.isInteger(value.failure.status)&&value.failure.status>=0&&value.failure.status<=255);}
 exactKeys(value.cleanup,cleanupKeys);for(const name of cleanupKeys)assert.equal(typeof value.cleanup[name],'boolean');
 if(value.status==='PASS'){assert.equal(value.failure,null);assert.equal(value.rejection,'INSTALL_FAILED_UPDATE_INCOMPATIBLE');assert.equal(value.freshProduct,true);assert.ok(value.qaCopy);assert.deepEqual(value.engine,ENGINE);assert.ok(Object.values(value.cleanup).every(Boolean));assert.deepEqual(value.phases.map(row=>[row.phase,row.status]),PHASES.map(phase=>[phase,'passed']));}
 return value;
}

function finiteFailure(error,phase){
 const fields=diagnosticFields(error,['code','commandFailed','status'])??{},value={phase,class:fields.code==='ERR_ASSERTION'?'assertion':fields.code==='ETIMEDOUT'?'timeout':fields.code==='ENOENT'?'missing-tool':fields.commandFailed===true?'command-failed':'other',status:null};
 if(Number.isInteger(fields.status)&&fields.status>=0&&fields.status<=255)value.status=fields.status;return value;
}

// The fixed phase order is shared by the real adapter and generated-data checks.
export async function runDisposableAcceptance(pins,makeIO=makeLinuxIO){
 assertBoundPins(pins); // No artifact, device, process, port or private-path I/O before this.
 const io=await makeIO(pins),p=pins.candidate,receipt={schema:1,scope:'disposable-upload-signer-rejection-and-fresh-product',status:'FAIL',source:p.source,admissionSHA256:sha(JSON.stringify(pins)),reviewSHA256:pins.reviewSHA256,custodySHA256:p.custodySHA256,candidateSHA256:p.sha256,candidateCertificateSHA256:p.certificateSHA256,producer:{run:p.run,attempt:p.attempt,artifact:p.artifact,artifactDigest:p.artifactDigest},phases:[],rejection:null,freshProduct:null,qaCopy:null,engine:null,failure:null,cleanup:Object.fromEntries(cleanupKeys.map(name=>[name,false]))};
 let phase='binding',failure,before,fresh;
 const step=async(name,run)=>{phase=name;const row={phase:name,status:'started'};receipt.phases.push(row);try{const result=await run();row.status='passed';return result;}catch(error){row.status='failed';throw error;}};
 const task=installTaskCleanup(async()=>{
  if(task.signal&&!failure){failure=true;receipt.failure={phase,class:'cancelled',status:null};}
  const row={phase:'cleanup',status:'started'};receipt.phases.push(row);
  try{receipt.cleanup=await io.cleanup();assert.ok(Object.values(receipt.cleanup).every(Boolean));row.status='passed';}catch(error){row.status='failed';failure??=error;receipt.failure??=finiteFailure(error,'cleanup');}
  receipt.status=task.signal?'CANCELLED':failure?'FAIL':'PASS';validateReceipt(receipt);await io.writeReceipt(receipt);
 });
 try{
  await step('binding',()=>io.bind());await step('artifact-identity',()=>io.artifacts());await step('lease',()=>io.lease());
  await step('old-install',()=>io.installOld());await step('old-ui-fixture',()=>io.seedOld());before=await step('old-snapshot',()=>io.oldSnapshot());
  await step('candidate-update-rejected',async()=>{assert.equal(await io.rejectCandidate(),'INSTALL_FAILED_UPDATE_INCOMPATIBLE');receipt.rejection='INSTALL_FAILED_UPDATE_INCOMPATIBLE';});
  await step('rejection-preservation',()=>io.assertRejectedPreserved(before));await step('fixture-remove',()=>io.removeSynthetic());
  await step('candidate-install',()=>io.installCandidate());fresh=await step('candidate-ui-offline',()=>io.seedCandidate());
  await step('candidate-cold-preservation',async()=>{await io.assertColdPreserved(fresh);receipt.freshProduct=true;});
  await step('qa-bundle',()=>io.bundleProbe());receipt.qaCopy=await step('qa-copy-final-member-proof',()=>io.createVerifiedProbeCopy());
  await step('candidate-remove',()=>io.removeSynthetic());await step('qa-copy-install',()=>io.installProbe());
  receipt.engine=await step('native-engine-query',async()=>{const actual=await io.queryEngine();assert.deepEqual(actual,ENGINE);return actual;});
 }catch(error){failure=error;receipt.failure=finiteFailure(error,phase);}
 finally{try{await task.run();}finally{task.dispose();}}
 return validateReceipt(receipt);
}

// Implemented below with the existing SDK/oracle/custody boundaries. There is no
// implicit download, key enrollment, backend operation or product instrumentation.
export async function makeLinuxIO(pins,{recover=false}={}){
 assertBoundPins(pins);assert.equal(process.platform,'linux');assert.equal(process.env.GITHUB_ACTIONS,'true');assert.equal(process.env.GITHUB_REPOSITORY,'patrickchin/puptime');assert.equal(process.env.GITHUB_SHA,pins.driverSource);
 process.umask(0o077);
 const run=process.env.GITHUB_RUN_ID,attempt=process.env.GITHUB_RUN_ATTEMPT;assert.match(run??'',/^[1-9]\d{0,15}$/);assert.equal(attempt,'1');
 const checkout=realpathSync(process.cwd()),runner=realpathSync(process.env.RUNNER_TEMP??''),sdk=realpathSync(process.env.ANDROID_HOME??'');
 const root=join(runner,'puptime-beta-disposable-'+run+'-'+attempt);assert.equal(process.env.PUPTIME_BETA_PRIVATE,root);assert.equal(realpathSync(root),root);
 const rootStat=lstatSync(root);assert.ok(rootStat.isDirectory()&&!rootStat.isSymbolicLink()&&(rootStat.mode&0o777)===0o700&&rootStat.uid===process.getuid());
 assert.equal(readFileSync(join(root,'NOT-FOR-RELEASE'),'utf8'),pins.driverSource);assert.equal(existsSync(join(checkout,'.env')),false);
 const avdHome=join(root,'avd'),name='Puptime_Beta_QA_'+run+'_'+attempt,adbPath=join(sdk,'platform-tools/adb'),emulator=join(sdk,'emulator/emulator');
 const cmdline=realpathSync(process.env.PUPTIME_ANDROID_CMDLINE_BIN??'');assert.ok(cmdline.startsWith(sdk+'/'));
 const toolVersions=readdirSync(join(sdk,'build-tools')).filter(value=>/^\d+\.\d+\.\d+$/.test(value)).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));assert.ok(toolVersions.length);
 const tools=join(sdk,'build-tools',toolVersions.at(-1)),inputs=join(root,'inputs'),old=join(inputs,'old125.apk'),product=join(inputs,'candidate.apk'),archive=join(inputs,'candidate.zip');
 const head=spawnSync('git',['rev-parse','HEAD'],{cwd:checkout,encoding:'utf8',timeout:30000,stdio:['ignore','pipe','ignore']});assert.equal(head.status,0);assert.equal(head.stdout.trim(),pins.driverSource);
 const {nativeSnapshot,assertNativeTransition}=recover?{}:await import('./native-account-evidence.mjs'),{eventDataFromSql}=recover?{}:await import('../src/record-sql.ts');
 const output=join(checkout,'build/android-beta-disposable-safe');if(!recover)assert.equal(existsSync(output),false);
 const baseEnvironment=Object.fromEntries(['PATH','JAVA_HOME','LANG','LC_ALL','TMPDIR'].filter(key=>process.env[key]).map(key=>[key,process.env[key]]));
 const environment=standardFixtureEnvironment({...baseEnvironment,HOME:join(root,'home'),ANDROID_HOME:sdk,ANDROID_SDK_ROOT:sdk,ANDROID_AVD_HOME:avdHome,CI:'1',EXPO_NO_TELEMETRY:'1',EXPO_NO_METRO_WORKSPACE_ROOT:'1',MAESTRO_CLI_NO_ANALYTICS:'1',MAESTRO_DRIVER_STARTUP_TIMEOUT:'180000'},'https://127.0.0.1:1');
 environment.MAESTRO_HOME=join(environment.HOME,'.maestro');environment.PATH=join(environment.MAESTRO_HOME,'bin')+':'+environment.PATH;
 const ownedStops=[],cleanup=Object.fromEntries(cleanupKeys.map(key=>[key,false]));let child,ownerStart,spawnError,adbServer,adbStop,adbStart,adbSpawnError,installedSHA=null,probeSHA=null,lastSnapshotSite=null;
 const commandJournal=join(root,'owned-commands.json'),emulatorJournal=join(root,'owned-emulator.json'),liveCommands=[];
 const journal=(path,value)=>{if(existsSync(root))writeFileSync(path,JSON.stringify(value)+'\n',{mode:0o600});};
 const commandStart=pid=>{try{return processStart(readFileSync('/proc/'+pid+'/stat','utf8')).start;}catch{return null;}};
 const saveCommands=()=>journal(commandJournal,{schema:1,source:pins.driverSource,uid:String(process.getuid()),groups:liveCommands});
 const saveEmulator=()=>journal(emulatorJournal,{schema:1,source:pins.driverSource,rootDev:String(rootStat.dev),rootIno:String(rootStat.ino),uid:String(process.getuid()),name,home:avdHome,arguments:emulatorArgs,emulator:child?.pid?{pid:child.pid,start:ownerStart??null}:null,adb:adbServer?.pid?{pid:adbServer.pid,start:adbStart??null}:null});
 const privateJSON=path=>{const before=lstatSync(path);assert.ok(before.isFile()&&!before.isSymbolicLink()&&(before.mode&0o777)===0o600&&before.size>0&&before.size<=16384);const bytes=readFileSync(path);const after=lstatSync(path);for(const key of ['dev','ino','size','mtimeMs','ctimeMs'])assert.equal(after[key],before[key]);assert.equal(bytes.length,before.size);return JSON.parse(bytes);};
 const command=(binary,args,{ok=[0],binaryOutput=false,timeout=120000,maxBuffer=256*1024*1024}={})=>{
  if(binary==='adb'){owned();binary=adbPath;}
  const result=spawnSync(binary,args,{cwd:checkout,env:environment,encoding:binaryOutput?undefined:'utf8',timeout,maxBuffer,stdio:['ignore','pipe','pipe']});
  if(result.error||!ok.includes(result.status))throw Object.assign(new Error('Bounded private command failed.'),{commandFailed:true,code:result.error?.code,status:result.status});
  return result.stdout;
 };
 const adb=(...args)=>command('adb',['-s',serial,...args]);
 const emulatorArgs=['-avd',name,'-port','5588','-no-window','-no-audio','-no-snapshot','-gpu','swiftshader_indirect'];
 const executables=[emulator,join(sdk,'emulator/qemu/linux-x86_64/qemu-system-x86_64'),join(sdk,'emulator/qemu/linux-x86_64/qemu-system-x86_64-headless')].filter(existsSync).map(path=>realpathSync(path));
 const inspect=()=>{
  if(!child?.pid)return null;
  try{const proc='/proc/'+child.pid;return processIdentity({stat:readFileSync(join(proc,'stat'),'utf8'),exe:readlinkSync(join(proc,'exe')),cmdline:readFileSync(join(proc,'cmdline'),'utf8'),environ:readFileSync(join(proc,'environ'),'utf8'),status:readFileSync(join(proc,'status'),'utf8'),afterStat:readFileSync(join(proc,'stat'),'utf8')},{executables,arguments:emulatorArgs,home:avdHome,uid:String(process.getuid())});}
  catch(error){if(['ENOENT','ESRCH'].includes(error.code))return null;throw error;}
 };
 const inspectADB=()=>{if(!adbServer?.pid)return null;try{const proc='/proc/'+adbServer.pid;return processIdentity({stat:readFileSync(join(proc,'stat'),'utf8'),exe:readlinkSync(join(proc,'exe')),cmdline:readFileSync(join(proc,'cmdline'),'utf8'),environ:readFileSync(join(proc,'environ'),'utf8'),status:readFileSync(join(proc,'status'),'utf8'),afterStat:readFileSync(join(proc,'stat'),'utf8')},{executables:[realpathSync(adbPath)],arguments:['-L','tcp:localhost:5037','nodaemon','server'],home:avdHome,uid:String(process.getuid())});}catch(error){if(['ENOENT','ESRCH'].includes(error.code))return null;throw error;}};
 const ownedEmulator=()=>{if(spawnError)throw spawnError;assert.ok(ownedProcess(inspect(),ownerStart),'Require exact owned emulator before ADB.');};
 const owned=()=>{ownedEmulator();if(adbSpawnError)throw adbSpawnError;assert.ok(ownedProcess(inspectADB(),adbStart),'Require exact owned ADB server.');};
 const wait=async(ms,read)=>{const deadline=Date.now()+ms;do{if(await read())return;await new Promise(done=>setTimeout(done,250));}while(Date.now()<deadline);throw Object.assign(new Error('Bounded wait ended.'),{code:'ETIMEDOUT'});};
 const runOwned=async(binary,args,{timeout=120000,input,env=environment,cwd=checkout}={})=>{
  const processChild=spawn(binary,args,{env,cwd,stdio:[input===undefined?'ignore':'pipe','ignore','ignore'],detached:true}),stop=ownProcess(processChild),record={pid:processChild.pid,start:processChild.pid?commandStart(processChild.pid):null};ownedStops.push(stop);if(record.pid){liveCommands.push(record);saveCommands();}let timer,failure;
  try{await new Promise((pass,fail)=>{processChild.once('error',fail);processChild.stdin?.once('error',fail);processChild.once('close',status=>status===0?pass():fail(Object.assign(new Error('Owned command failed.'),{commandFailed:true,status})));timer=setTimeout(()=>{void stop().finally(()=>fail(Object.assign(new Error('Owned command timed out.'),{code:'ETIMEDOUT'})));},timeout);if(input!==undefined)processChild.stdin.end(input);});}
  catch(error){failure=error;throw error;}
  finally{clearTimeout(timer);try{assert.ok(await stop());const index=liveCommands.indexOf(record);if(index>=0)liveCommands.splice(index,1);saveCommands();}catch(error){if(!failure)throw error;}}
 };
 const portsFree=assertTaskPortsFree;
 const hostState={};
 const hostIO=()=>({name,start:ownerStart,inspect,now:Date.now,pause:()=>Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,1000),save(){},signal:signal=>{ownedEmulator();process.kill(child.pid,signal);},adb:(args,timeout=3000)=>{ownedEmulator();if(!ownedProcess(inspectADB(),adbStart))return{status:1,stdout:'',stderr:''};const result=spawnSync(adbPath,['-s',serial,...args],{env:environment,encoding:'utf8',timeout,maxBuffer:256*1024,stdio:['ignore','pipe','pipe']});return {status:result.status,stdout:result.stdout??'',stderr:result.stderr??''};}});
 const snapshotTools=createSnapshotTools({root,device:serial,command,adb,nativeSnapshot,mark:value=>{lastSnapshotSite=value;}}),strict=preservationEquality(assertNativeTransition,eventDataFromSql),cold=coldPreservationEquality(assertNativeTransition,eventDataFromSql);
 const offline=()=>{owned();assert.ok(offlineReady(readOffline((args,timeout)=>{const value=command('adb',['-s',serial,...args],{timeout,maxBuffer:256*1024});return {status:0,stdout:value};})));};
 const pullHash=async()=>{owned();return snapshotTools.installedApkHash();};
 const measure=(path,expected)=>{
  assert.equal(stableFile(path),expected.sha256);const text=command(join(tools,'apksigner'),['verify','--verbose','--print-certs',path],{maxBuffer:65536});
  assert.deepEqual([...text.matchAll(/^Signer #\d+ certificate SHA-256 digest: ([a-f0-9]{64})$/gm)].map(value=>value[1]),[expected.certificateSHA256]);
  const badging=command(join(tools,'aapt2'),['dump','badging',path],{maxBuffer:2*1024*1024}),identity=/^package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'(?: .*)?$/m.exec(badging);assert.ok(identity);assert.deepEqual(identity.slice(1),[app,String(expected.versionCode),expected.version]);
  if(expected.minSdk!==undefined){const minimum=[...badging.matchAll(/^(?:minSdkVersion|sdkVersion):'(\d+)'$/gm)],target=[...badging.matchAll(/^targetSdkVersion:'(\d+)'$/gm)];assert.equal(minimum.length,1);assert.equal(target.length,1);assert.equal(Number(minimum[0][1]),expected.minSdk);assert.equal(Number(target[0][1]),expected.targetSdk);}
  assert.equal(stableFile(path),expected.sha256);
 };
 const install=async(path,expected)=>{offline();measure(path,expected);assert.match(adb('install',path),/Success/);assert.equal(await pullHash(),expected.sha256);installedSHA=expected.sha256;};
 const launch=()=>{offline();adb('shell','am','start','-W','-n',app+'/.MainActivity');};
 const flow=async(label,steps)=>{const path=join(root,label+'.yaml'),results=join(root,label+'-maestro');writeFileSync(path,'appId: '+app+'\n---\n'+steps,{flag:'wx',mode:0o600});await runOwned('maestro',['--device',serial,'test',path,'--test-output-dir',results],{timeout:240000});};
 const tap=id=>'- tapOn: {id: '+id+'}\n',scroll=id=>'- scrollUntilVisible:\n    element: {id: '+id+'}\n    direction: DOWN\n    visibilityPercentage: 100\n    centerElement: true\n';
 const settings=tap('nav.open')+'- assertVisible: {id: nav.close}\n'+scroll('nav.settings')+tap('nav.settings')+'- assertVisible: {id: screen.settings}\n';
 const seed=async(label,version)=>{
  launch();await flow(label+'-seed','- runFlow: '+JSON.stringify(resolve('.maestro/helpers/skip-onboarding.yaml'))+'\n- assertVisible: {id: screen.today}\n- repeat:\n    times: 4\n    commands:\n      - tapOn: {id: quick.pee}\n      - tapOn: {id: quick.poop}\n      - tapOn: {id: quick.meal}\n- tapOn: {id: event.meal.edit, index: 0}\n'+scroll('editor.note.input')+tap('editor.note.input')+'- inputText: Signing QA note\n- pressKey: Back\n- scrollUntilVisible:\n    element: {id: editor.close}\n    direction: UP\n'+tap('editor.close')+settings+tap('settings.widget.open')+scroll('settings.widget.action.walk')+tap('settings.widget.action.walk')+tap('settings.widget.close')+tap('settings.theme.open')+tap('appearance.theme.dark')+tap('settings.language.open')+tap('appearance.language.es')+'- stopApp\n');
  launch();await flow(label+'-reminder','- extendedWaitUntil:\n    visible: {id: screen.today}\n    timeout: 90000\n'+settings+scroll('settings.notifications.open')+tap('settings.notifications.open')+scroll('settings.notifications.lead.15')+tap('settings.notifications.lead.15')+'- pressKey: Home\n');
  await flow(label+'-widget',"- longPressOn:\n    id: '.*:id/workspace'\n- tapOn: '^Widgets$'\n- scrollUntilVisible:\n    element: {text: '^Puptime$'}\n    direction: DOWN\n- tapOn: '^Puptime$'\n- scrollUntilVisible:\n    element: {text: '^Puptime Quick Log$'}\n    direction: DOWN\n    visibilityPercentage: 100\n    centerElement: true\n- tapOn: '^Puptime Quick Log$'\n- tapOn: '^Add$'\n- extendedWaitUntil:\n    visible: '^Log pee, last logged .+$'\n    timeout: 30000\n- tapOn: '^Log pee, last logged .+$'\n");
  await wait(10000,()=>adb('shell',`sqlite3 -readonly /data/user/0/${app}/files/SQLite/puptime-v2.db "SELECT COUNT(*) FROM events WHERE source='widget';"`).trim()==='1');
  const value=snapshotTools.snapshot(label+'-created'),prefs=Object.fromEntries(value.tables.settings.map(row=>[row.key,row.value]));
  assert.equal(value.tables.events.length,13);assert.equal(value.tables.events.filter(row=>row.source==='widget').length,1);assert.ok(value.tables.events.some(row=>row.note==='Signing QA note'));assert.deepEqual(value.tables.local_sync_owner,[]);assert.deepEqual(value.tables.local_sync_outbox,[]);
  assert.equal(value.tables.metadata.find(row=>row.key==='backup_app_version')?.value,version);assert.equal(prefs['puptime.theme.v1'],'dark');assert.equal(prefs['puptime.language.v1'],'es');assert.ok(JSON.parse(prefs['puptime.widgetActions.v1']).includes('walk'));assert.equal(JSON.parse(prefs['puptime.notificationPreferences.v1']).reminderLeadMinutes,15);offline();return value;
 };
 const python=String.raw`import importlib.util,json,sys
from pathlib import Path
spec=importlib.util.spec_from_file_location('copy',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
mode=sys.argv[2];p=[Path(x) for x in sys.argv[3:]]
if mode=='create': result=m.create_copy(p[0],p[1],p[2],str(p[3]))
elif mode=='verify': result=m.verify_copy(p[0],p[1],str(p[2]),str(p[3]))
elif mode=='inspect':
 values=m.member_manifest(p[0]);result={'manifestSHA256':values['AndroidManifest.xml'][0]}
elif mode=='artifact':
 spec2=importlib.util.spec_from_file_location('custody',str(Path(sys.argv[1]).with_name('publish-android-release.py')));c=importlib.util.module_from_spec(spec2);spec2.loader.exec_module(c)
 with c.archive(p[0],{'size_in_bytes':int(str(p[3])),'digest':'sha256:'+str(p[2])},{'app-release.apk'},256*1024*1024) as z:
  info=z.getinfo('app-release.apk');assert info.file_size==int(str(p[4]))
  with z.open(info) as f: assert m.stream_sha(f)==str(p[1])
 result={'artifactMemberBound':True}
else: raise ValueError('Unknown fixed copy operation')
print(json.dumps(result))
`;
 const copyOperation=(mode,...args)=>JSON.parse(command('python3',['-I','-c',python,join(checkout,'scripts/android-engine-probe-copy.py'),mode,...args],{maxBuffer:16384,timeout:120000}));
 const bundleDirectory=join(root,'probe-bundle'),bundle=join(bundleDirectory,'index.android.bundle'),unsigned=join(root,'probe-unsigned.apk'),aligned=join(root,'probe-aligned.apk'),probe=join(root,'probe-signed.apk');
 let bundleSHA,qaCertificate;
 if(recover){
  if(existsSync(commandJournal)){const value=privateJSON(commandJournal);exactKeys(value,['schema','source','uid','groups']);assert.equal(value.schema,1);assert.equal(value.source,pins.driverSource);assert.equal(value.uid,String(process.getuid()));assert.ok(Array.isArray(value.groups)&&value.groups.length<=32);
   for(const group of value.groups){exactKeys(group,['pid','start']);positive(group.pid);assert.match(group.start??'',/^\d+$/);ownedStops.push(async()=>{try{const proc='/proc/'+group.pid,stat=readFileSync(join(proc,'stat'),'utf8'),identity=processStart(stat);assert.equal(identity.start,group.start);const fields=stat.slice(stat.lastIndexOf(')')+2).trim().split(/\s+/);assert.equal(fields[2],String(group.pid));assert.deepEqual(readFileSync(join(proc,'status'),'utf8').match(/^Uid:\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/m)?.slice(1),Array(4).fill(String(process.getuid())));return ownProcess({pid:group.pid})();}catch(error){if(['ENOENT','ESRCH'].includes(error.code)){try{process.kill(-group.pid,0);return false;}catch(value){return value.code==='ESRCH';}}throw error;}});}
  }
  if(existsSync(emulatorJournal)){const value=privateJSON(emulatorJournal);exactKeys(value,['schema','source','rootDev','rootIno','uid','name','home','arguments','emulator','adb']);assert.equal(value.schema,1);assert.equal(value.source,pins.driverSource);assert.equal(value.rootDev,String(rootStat.dev));assert.equal(value.rootIno,String(rootStat.ino));assert.equal(value.uid,String(process.getuid()));assert.equal(value.name,name);assert.equal(value.home,avdHome);assert.deepEqual(value.arguments,emulatorArgs);
   for(const entry of [value.emulator,value.adb])if(entry){exactKeys(entry,['pid','start']);positive(entry.pid);assert.match(entry.start??'',/^\d+$/);}
   if(value.emulator){child={pid:value.emulator.pid};ownerStart=value.emulator.start;}if(value.adb){adbServer={pid:value.adb.pid};adbStart=value.adb.start;adbStop=ownProcess(adbServer);}
  }
 }
 return {
  bind(){assert.equal(command('git',['rev-parse','HEAD']).trim(),pins.driverSource);assert.equal(command('git',['status','--porcelain','--untracked-files=all']).trim(),'');assert.ok(!existsSync(avdHome));for(const file of [old,product,archive,join(inputs,'custody.json'),join(inputs,'source-review.json')]){const stat=lstatSync(file);assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&(stat.mode&0o077)===0);}assert.equal(stableFile(join(inputs,'custody.json'),65536),pins.candidate.custodySHA256);assert.equal(stableFile(join(inputs,'source-review.json'),256*1024),pins.reviewSHA256);mkdirSync(environment.HOME,{mode:0o700});mkdirSync(environment.MAESTRO_HOME,{mode:0o700});const maestro=join(realpathSync(process.env.HOME??''),'.maestro');for(const directory of ['bin','lib']){const path=join(maestro,directory);assert.ok(lstatSync(path).isDirectory()&&!lstatSync(path).isSymbolicLink());cpSync(path,join(environment.MAESTRO_HOME,directory),{recursive:true,errorOnExist:true,force:false});}assert.equal(command('maestro',['--version'],{maxBuffer:4096}).trim(),'2.11.0');saveCommands();saveEmulator();},
  artifacts(){
   const p=pins.candidate;assert.equal(lstatSync(product).size,p.bytes);assert.equal(lstatSync(archive).size,p.artifactBytes);assert.equal(stableFile(archive,512*1024*1024),p.artifactDigest);measure(old,OLD125);measure(product,p);assert.equal(copyOperation('inspect',product).manifestSHA256,p.manifestSHA256);
   assert.deepEqual(copyOperation('artifact',archive,p.sha256,p.artifactDigest,String(p.artifactBytes),String(p.bytes)),{artifactMemberBound:true});
   const proof=JSON.parse(readFileSync(join(inputs,'custody.json'),'utf8'));exactKeys(proof,['schema','candidate','checks']);assert.equal(proof.schema,1);const {custodySHA256,...admitted}=p;assert.deepEqual(proof.candidate,admitted);exactKeys(proof.checks,['artifactMemberBound','releaseFlags','fixtureFree','productionOrigin','analyticsConsent','audioRights','notices','allAbi16KB']);assert.ok(Object.values(proof.checks).every(value=>value===true));
  },
  async lease(){
   await portsFree();mkdirSync(avdHome,{mode:0o700});await runOwned(join(cmdline,'avdmanager'),['create','avd','--name',name,'--package','system-images;android-36;google_apis;x86_64'],{input:'no\n'});
   adbServer=spawn(adbPath,['-L','tcp:localhost:5037','nodaemon','server'],{env:environment,stdio:'ignore',detached:true});adbServer.once('error',error=>{adbSpawnError=error;});adbStop=ownProcess(adbServer);
   adbStart=adbServer.pid?commandStart(adbServer.pid):null;saveEmulator();
   await wait(5000,()=>{if(adbSpawnError)throw adbSpawnError;const value=inspectADB();if(value?.alive&&value.executable&&value.arguments&&value.home&&value.uid){adbStart=value.start;return true;}return false;});
   child=spawn(emulator,emulatorArgs,{env:environment,stdio:'ignore',detached:true});child.once('error',error=>{spawnError=error;});
   ownerStart=child.pid?commandStart(child.pid):null;saveEmulator();
   await wait(5000,()=>{if(spawnError)throw spawnError;const value=inspect();if(value?.alive&&value.executable&&value.arguments&&value.home&&value.uid){ownerStart=value.start;return true;}return false;});
   saveEmulator();recordOwnedEmulator(hostIO(),hostState);emulatorRoot(hostIO(),hostState);
   assert.equal(adb('shell','getprop','ro.build.version.sdk').trim(),'36');assert.equal(adb('shell','getprop','ro.product.cpu.abi').trim(),'x86_64');adb('shell','svc','wifi','disable');adb('shell','svc','data','disable');adb('shell','cmd','connectivity','airplane-mode','enable');emulatorOffline(hostIO(),hostState);offline();assert.equal(command('adb',['-s',serial,'shell','pm','path',app],{ok:[1]}),'');
  },
  installOld:()=>install(old,OLD125),seedOld:()=>seed('old','1.12.5/1012005'),oldSnapshot:()=>snapshotTools.snapshot('old-before-reject'),
  rejectCandidate(){offline();assert.equal(installedSHA,OLD125.sha256);const result=spawnSync(adbPath,['-s',serial,'install','-r',product],{env:environment,encoding:'utf8',timeout:120000,maxBuffer:65536,stdio:['ignore','pipe','pipe']});const projected=installFailureProjection(result,product);assert.deepEqual(projected,{installCode:'INSTALL_FAILED_UPDATE_INCOMPATIBLE'});return projected.installCode;},
  async assertRejectedPreserved(before){strict(before,snapshotTools.snapshot('old-after-reject'));assert.equal(await pullHash(),OLD125.sha256);offline();},
  async removeSynthetic(){offline();assert.ok(installedSHA===OLD125.sha256||installedSHA===pins.candidate.sha256);assert.equal(await pullHash(),installedSHA);assert.match(adb('uninstall',app),/^Success\s*$/);assert.equal(command('adb',['-s',serial,'shell','pm','path',app],{ok:[1]}),'');installedSHA=null;},
  installCandidate:()=>install(product,pins.candidate),seedCandidate:()=>seed('candidate',pins.candidate.version+'/'+pins.candidate.versionCode),
  async assertColdPreserved(before){launch();await flow('candidate-cold','- extendedWaitUntil:\n    visible: {id: screen.today}\n    timeout: 90000\n');cold(before,snapshotTools.snapshot('candidate-after-cold'));assert.equal(await pullHash(),pins.candidate.sha256);offline();},
  async bundleProbe(){mkdirSync(bundleDirectory,{mode:0o700});await runOwned(process.execPath,['node_modules/expo/bin/cli','export:embed','--entry-file','scripts/android-engine-probe-entry.js','--platform','android','--dev','false','--bytecode','--max-workers','2','--bundle-output',bundle,'--assets-dest',join(bundleDirectory,'assets')],{timeout:600000});assert.equal(readdirSync(bundleDirectory,{recursive:true,withFileTypes:true}).filter(value=>value.isFile()).length,1);bundleSHA=stableFile(bundle,64*1024*1024);assert.equal(stableFile(product),pins.candidate.sha256);},
  async createVerifiedProbeCopy(){
   copyOperation('create',product,bundle,unsigned,pins.candidate.sha256);command(join(tools,'zipalign'),['-P','16','4',unsigned,aligned]);
   const password=join(root,'qa-password'),key=join(root,'qa-only.p12');writeFileSync(password,randomBytes(32).toString('hex')+'\n',{flag:'wx',mode:0o600});
   command('keytool',['-genkeypair','-alias','qa-only','-keystore',key,'-storetype','PKCS12','-storepass:file',password,'-keyalg','RSA','-keysize','3072','-validity','2','-dname','CN=Puptime disposable QA NOT FOR RELEASE','-noprompt']);
   command(join(tools,'apksigner'),['sign','--ks',key,'--ks-pass','file:'+password,'--ks-key-alias','qa-only','--out',probe,aligned]);
   const proof=copyOperation('verify',product,probe,pins.candidate.sha256,bundleSHA);assert.equal(proof.allOrdinaryMemberBytesAndCompressionEqual,true);assert.equal(proof.onlyChangedProductMember,'assets/index.android.bundle');
   const text=command(join(tools,'apksigner'),['verify','--verbose','--print-certs',probe],{maxBuffer:65536});const certificates=[...text.matchAll(/^Signer #\d+ certificate SHA-256 digest: ([a-f0-9]{64})$/gm)].map(row=>row[1]);assert.equal(certificates.length,1);qaCertificate=certificates[0];assert.notEqual(qaCertificate,pins.candidate.certificateSHA256);assert.notEqual(qaCertificate,OLD125.certificateSHA256);probeSHA=stableFile(probe);assert.equal(stableFile(product),pins.candidate.sha256);return{sha256:probeSHA,bundleSHA256:bundleSHA,certificateSHA256:qaCertificate,ordinaryMembersCompared:proof.ordinaryMembersCompared,nativeLibrariesCompared:proof.nativeLibrariesCompared,allOrdinaryMemberBytesAndCompressionEqual:true};
  },
  installProbe:()=>install(probe,{...pins.candidate,sha256:probeSHA,certificateSHA256:qaCertificate}),
  async queryEngine(){
   launch();const remote='/data/user/0/'+app+'/files/sqlite-engine-probe.json',args=['shell','stat','-c',"'%d %i %s %Y %Z %f'",remote];await wait(60000,()=>{owned();try{return androidReceiptStat(adb(...args)).size>0;}catch{return false;}});
   assert.equal(adb('shell','readlink','-f',remote).trim(),remote);const before=androidReceiptStat(adb(...args));const bytes=command('adb',['-s',serial,'exec-out','dd','if='+remote,'bs=257','count=1','status=none'],{binaryOutput:true,maxBuffer:257});assert.equal(bytes.length,before.size);assert.deepEqual(androidReceiptStat(adb(...args)),before);
   const path=join(root,'engine.json');writeFileSync(path,bytes,{flag:'wx',mode:0o600});const value=JSON.parse(readSqliteEngineReceipt(path));assert.deepEqual(value,ENGINE);offline();assert.equal(stableFile(product),pins.candidate.sha256);return value;
  },
  async cleanup(){
   let stopped=true;for(const stop of ownedStops)try{stopped=(await stop())&&stopped;}catch{stopped=false;}cleanup.commandsStopped=stopped;
   try{const stopped=child?stopEmulator(hostIO(),hostState):true;cleanup.emulatorStopped=stopped&&(!child?.pid||processGroupAbsent(child.pid));}catch{cleanup.emulatorStopped=false;}
   try{const value=inspectADB();if(value)assert.equal(value.start,adbStart);if(value?.alive)assert.ok(ownedProcess(value,adbStart));if(!value&&adbServer?.pid){try{process.kill(-adbServer.pid,0);throw Error('Absent leader with a live group is not cleanup proof.');}catch(error){if(error.code!=='ESRCH')throw error;}}cleanup.adbStopped=adbStop?await adbStop():true;}catch{cleanup.adbStopped=false;}
   cleanup.avdDeleted=false;cleanup.privateFilesDeleted=false;
   if(cleanup.commandsStopped&&cleanup.emulatorStopped&&cleanup.adbStopped){const current=lstatSync(root);assert.equal(current.dev,rootStat.dev);assert.equal(current.ino,rootStat.ino);rmSync(root,{recursive:true});cleanup.avdDeleted=!existsSync(avdHome);cleanup.privateFilesDeleted=!existsSync(root);}
   try{await portsFree();cleanup.portsFree=true;}catch{cleanup.portsFree=false;}return {...cleanup};
  },
  writeReceipt(value){validateReceipt(value);mkdirSync(output,{recursive:true,mode:0o700});writeFileSync(join(output,'verification.json'),JSON.stringify(value,null,2)+'\n',{mode:0o600});}
 };
}

// Separate hosted `if: always()` entry. It adopts only the private task lease and
// exact process start/UID/SDK/arguments, never a global device/server selector.
export async function recoverDisposableCleanup(pins){
 assertBoundPins(pins);assert.equal(process.platform,'linux');assert.equal(process.env.GITHUB_ACTIONS,'true');assert.equal(process.env.GITHUB_REPOSITORY,'patrickchin/puptime');assert.equal(process.env.GITHUB_SHA,pins.driverSource);
 assert.match(process.env.GITHUB_RUN_ID??'',/^[1-9]\d{0,15}$/);assert.equal(process.env.GITHUB_RUN_ATTEMPT,'1');
 const root=resolve(process.env.PUPTIME_BETA_PRIVATE??''),expected=join(realpathSync(process.env.RUNNER_TEMP??''),'puptime-beta-disposable-'+process.env.GITHUB_RUN_ID+'-'+process.env.GITHUB_RUN_ATTEMPT);assert.equal(root,expected);
 let cleanup;
 if(existsSync(root))cleanup=await(await makeLinuxIO(pins,{recover:true})).cleanup();
 else{const previous=validateReceipt(JSON.parse(readFileSync(resolve('build/android-beta-disposable-safe/verification.json'),'utf8')));assert.equal(previous.source,pins.driverSource);assert.ok(Object.values(previous.cleanup).every(Boolean));await assertTaskPortsFree();cleanup={...previous.cleanup};}
 exactKeys(cleanup,cleanupKeys);for(const key of cleanupKeys)assert.equal(typeof cleanup[key],'boolean');
 const receipt={schema:1,scope:'owned-resource-cleanup-only',source:pins.driverSource,status:Object.values(cleanup).every(Boolean)?'CLEAN':'INCOMPLETE',cleanup},directory=resolve('build/android-beta-disposable-safe');mkdirSync(directory,{recursive:true,mode:0o700});writeFileSync(join(directory,'cleanup.json'),JSON.stringify(receipt,null,2)+'\n',{mode:0o600});return receipt;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 let admission='unbound';
 try{
  assert.equal(process.argv.length,4);assert.ok(['--run','--cleanup'].includes(process.argv[2]));
  const path=resolve(process.argv[3]),info=lstatSync(path);assert.ok(info.isFile()&&!info.isSymbolicLink()&&(info.mode&0o777)===0o600&&info.size<=16384);
  const pins=assertBoundPins(JSON.parse(readFileSync(path,'utf8')));admission=process.argv[2]==='--cleanup'?'cleanup-recovery':'adapter-construction';
  const result=process.argv[2]==='--cleanup'?await recoverDisposableCleanup(pins):await runDisposableAcceptance(pins,async value=>{const io=await makeLinuxIO(value);admission='receipt-finalization';return io;});console.log(JSON.stringify(result));if(!['PASS','CLEAN'].includes(result.status))process.exitCode=1;
 }catch{console.log(JSON.stringify({schema:1,status:admission==='unbound'?'UNBOUND':'FAIL',category:admission==='unbound'?'reviewed-source-and-artifact-binding-required':admission+'-failed'}));process.exitCode=2;}
}

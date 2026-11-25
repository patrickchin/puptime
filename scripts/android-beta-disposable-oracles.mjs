// Disposable beta acceptance only. These oracle bodies are byte-identical to the
// existing signing proof; the original proof and its source guards are untouched.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {types as utilTypes,isDeepStrictEqual} from 'node:util';
import {constants,constants as fsConstants,createReadStream,fstatSync,fchmodSync,lstatSync,openSync,closeSync,mkdtempSync,mkdirSync,writeFileSync,rmSync,readSync,realpathSync} from 'node:fs';
import {dirname,join,resolve,isAbsolute} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
const hash=value=>createHash('sha256').update(value).digest('hex');
const app='com.patrickchin.puptime';
const preservationFailures=new WeakMap();
const preservationSites=['native-tables','uid','widget-binding','file-hashes'];
const preservationTables=['metadata','puppies','events','routines','settings','pet_settings','local_revisions','local_sync_owner','local_sync_pets','local_sync_outbox','local_sync_records','local_sync_acks','local_sync_baseline','sqlite_sequence'];
const sqliteFile=name=>/^files\/SQLite\/puptime-v2\.db(?:-wal|-shm|-journal)?$/.test(name);

const installFailureCodes=new Set([
 'INSTALL_FAILED_ALREADY_EXISTS','INSTALL_FAILED_INVALID_APK','INSTALL_FAILED_INVALID_URI','INSTALL_FAILED_INSUFFICIENT_STORAGE',
 'INSTALL_FAILED_DUPLICATE_PACKAGE','INSTALL_FAILED_NO_SHARED_USER','INSTALL_FAILED_UPDATE_INCOMPATIBLE','INSTALL_FAILED_SHARED_USER_INCOMPATIBLE',
 'INSTALL_FAILED_MISSING_SHARED_LIBRARY','INSTALL_FAILED_REPLACE_COULDNT_DELETE','INSTALL_FAILED_DEXOPT','INSTALL_FAILED_OLDER_SDK',
 'INSTALL_FAILED_CONFLICTING_PROVIDER','INSTALL_FAILED_NEWER_SDK','INSTALL_FAILED_TEST_ONLY','INSTALL_FAILED_CPU_ABI_INCOMPATIBLE',
 'INSTALL_FAILED_MISSING_FEATURE','INSTALL_FAILED_CONTAINER_ERROR','INSTALL_FAILED_INVALID_INSTALL_LOCATION','INSTALL_FAILED_MEDIA_UNAVAILABLE',
 'INSTALL_FAILED_VERIFICATION_TIMEOUT','INSTALL_FAILED_VERIFICATION_FAILURE','INSTALL_FAILED_PACKAGE_CHANGED','INSTALL_FAILED_UID_CHANGED',
 'INSTALL_FAILED_VERSION_DOWNGRADE','INSTALL_PARSE_FAILED_NOT_APK','INSTALL_PARSE_FAILED_BAD_MANIFEST','INSTALL_PARSE_FAILED_UNEXPECTED_EXCEPTION',
 'INSTALL_PARSE_FAILED_NO_CERTIFICATES','INSTALL_PARSE_FAILED_INCONSISTENT_CERTIFICATES','INSTALL_PARSE_FAILED_CERTIFICATE_ENCODING','INSTALL_PARSE_FAILED_BAD_PACKAGE_NAME',
 'INSTALL_PARSE_FAILED_BAD_SHARED_USER_ID','INSTALL_PARSE_FAILED_MANIFEST_MALFORMED','INSTALL_PARSE_FAILED_MANIFEST_EMPTY','INSTALL_FAILED_INTERNAL_ERROR',
 'INSTALL_FAILED_USER_RESTRICTED','INSTALL_FAILED_DUPLICATE_PERMISSION','INSTALL_FAILED_NO_MATCHING_ABIS','INSTALL_FAILED_ABORTED',
 'INSTALL_FAILED_BAD_DEX_METADATA','INSTALL_FAILED_MISSING_SPLIT','INSTALL_FAILED_DEPRECATED_SDK_VERSION','INSTALL_FAILED_BAD_SIGNATURE',
 'INSTALL_FAILED_WRONG_INSTALLED_VERSION','INSTALL_FAILED_PROCESS_NOT_DEFINED','INSTALL_FAILED_SESSION_INVALID','INSTALL_FAILED_SHARED_LIBRARY_BAD_CERTIFICATE_DIGEST',
 'INSTALL_FAILED_MULTI_ARCH_NOT_MATCH_ALL_NATIVE_ABIS',
]);
const installCommandKinds=['adb-install','package-path','installed-apk-readback','unrecognized'];
const installCodeDeclines=['not-install-command','process-state','output-type-or-size','stderr-frame','ambiguous-content','unlisted-code'];
const ambiguityPredicates=['success-token','code-token-count','failure-marker-count'],countBuckets=['zero','one','multiple'];
function diagnosticFields(value,names){
 try{
  if(!value||typeof value!=='object'||utilTypes.isProxy(value))return;
  const fields={};for(const name of names){const descriptor=Object.getOwnPropertyDescriptor(value,name);if(descriptor&&!Object.hasOwn(descriptor,'value'))return;fields[name]=descriptor?.value;}return fields;
 }catch{return;}
}
function installAmbiguity(content){
 const successToken=/Success|INSTALL_SUCCEEDED/i.test(content),tokens=content.match(/\bINSTALL_(?:PARSE_)?FAILED_[A-Z_]+\b/gi)??[],markers=content.match(/\bFailure\s*\[/gi)??[];
 if(!successToken&&tokens.length===1&&markers.length===1)return;
 const bucket=count=>count===0?'zero':count===1?'one':'multiple';
 return {firstPredicate:successToken?'success-token':tokens.length!==1?'code-token-count':'failure-marker-count',successToken,codeTokens:bucket(tokens.length),failureMarkers:bucket(markers.length),publicCodes:[...installFailureCodes].filter(code=>tokens.includes(code)).sort(),unknownCodeObserved:tokens.some(code=>!installFailureCodes.has(code))};
}
function finiteInstallAmbiguity(value){
 const fields=diagnosticFields(value,['firstPredicate','successToken','codeTokens','failureMarkers','publicCodes','unknownCodeObserved']);if(!fields)return;
 if(!ambiguityPredicates.includes(fields.firstPredicate)||typeof fields.successToken!=='boolean'||typeof fields.unknownCodeObserved!=='boolean'||!countBuckets.includes(fields.codeTokens)||!countBuckets.includes(fields.failureMarkers))return;
 const expected=fields.successToken?'success-token':fields.codeTokens!=='one'?'code-token-count':fields.failureMarkers!=='one'?'failure-marker-count':undefined;if(fields.firstPredicate!==expected)return;
 const codes=fields.publicCodes;if(utilTypes.isProxy(codes)||!Array.isArray(codes))return;
 const length=diagnosticFields(codes,['length'])?.length;if(!Number.isSafeInteger(length)||length<0||length>installFailureCodes.size)return;
 const publicCodes=[];for(let i=0;i<length;i++){const code=diagnosticFields(codes,[String(i)])?.[i];if(!installFailureCodes.has(code)||(i>0&&publicCodes[i-1]>=code))return;publicCodes.push(code);}
 if(fields.codeTokens==='zero'&&(length||fields.unknownCodeObserved)||fields.codeTokens==='one'&&length+Number(fields.unknownCodeObserved)!==1||fields.codeTokens==='multiple'&&!length&&!fields.unknownCodeObserved)return;
 return {firstPredicate:fields.firstPredicate,successToken:fields.successToken,codeTokens:fields.codeTokens,failureMarkers:fields.failureMarkers,publicCodes,unknownCodeObserved:fields.unknownCodeObserved};
}
// The first declined predicate describes this projection, never the cause or actual install mode.
function installFailureProjection(result,path){
 const decline=installCodeDecline=>({installCodeDecline});
 const fields=diagnosticFields(result,['error','status','stdout','stderr']);
 if(!fields||fields.error||fields.status!==1)return decline('process-state');
 const {stdout,stderr}=fields;
 if(typeof stdout!=='string'||typeof stderr!=='string'||Buffer.byteLength(stdout)>32768||Buffer.byteLength(stderr)>32768)return decline('output-type-or-size');
 if(typeof path!=='string'||!path||/[\x00-\x1f\x7f\u2028\u2029]/.test(path))return decline('stderr-frame');
 const prefix='adb: failed to install '+path+': ';if(!stderr.startsWith(prefix))return decline('stderr-frame');
 const frame=stderr.slice(prefix.length),match=/^Failure \[(INSTALL_(?:PARSE_)?FAILED_[A-Z_]+)(?:: [^\x00-\x1f\x7f\u2028\u2029[\]]*)?\]\n{1,2}$/.exec(frame);
 if(!match||match[0]!==frame)return decline('stderr-frame');
 // stdout is not a pure mode/announcement protocol. Trust only the complete
 // owned-file stderr frame; report an observed ADB code, never its cause/mode.
 const ambiguity=installAmbiguity(stdout+'\n'+stderr);
 if(ambiguity)return {...decline('ambiguous-content'),installCodeAmbiguity:ambiguity};
 if(!installFailureCodes.has(match[1]))return decline('unlisted-code');
 return {installCode:match[1]};
}

function nativeErrorFields(error){
 try{
  if(utilTypes.isProxy(error)||!utilTypes.isNativeError(error))return {};
  const fields={};for(const key of ['code','operator','expected','actual']){const descriptor=Object.getOwnPropertyDescriptor(error,key);if(descriptor&&Object.hasOwn(descriptor,'value'))fields[key]=descriptor;}
  return fields;
 }catch{return {};}
}

function preservationProjection(before,after,firstSite,eventData,transition){
 assert.ok(preservationSites.includes(firstSite));
 const tableEqual=Object.fromEntries(preservationTables.map(table=>[table,isDeepStrictEqual(before.tables[table],after.tables[table])]));
 const hashes=files=>Object.fromEntries(Object.entries(files).map(([name,value])=>[name,value.sha256]));
 const categories=['sqlite','preferences','backup','photo','other'],changes=Object.fromEntries(categories.map(category=>[category,{added:0,removed:0,changed:0}]));
 const category=name=>sqliteFile(name)?'sqlite':name.startsWith('shared_prefs/')?'preferences':name.startsWith('files/activity-backups/')?'backup':/^files\/(?:puppy|dog)-photos\//.test(name)?'photo':'other';
 for(const name of new Set([...Object.keys(before.files),...Object.keys(after.files)])){
  const old=Object.hasOwn(before.files,name),current=Object.hasOwn(after.files,name),kind=!old?'added':!current?'removed':before.files[name].sha256!==after.files[name].sha256?'changed':undefined;
  if(kind)changes[category(name)][kind]++;
 }
 const bucket=count=>count===0?'zero':count===1?'one':'multiple';
 const matches=run=>{try{run();return true;}catch(error){return nativeErrorFields(error).code?.value==='ERR_ASSERTION'?false:null;}};
 return {firstSite,nativeTablesEqual:isDeepStrictEqual(before.tables,after.tables),uidEqual:before.uid===after.uid,widgetBindingEqual:isDeepStrictEqual(before.widgets,after.widgets),fileHashesEqual:isDeepStrictEqual(hashes(before.files),hashes(after.files)),tableEqual,fileChanges:Object.fromEntries(categories.map(name=>[name,Object.fromEntries(Object.entries(changes[name]).map(([kind,count])=>[kind,bucket(count)]))])),bridge126TablesMatch:matches(()=>transition(expectedLaunch(before.tables,'1.12.6/1012006'),after.tables)),bridge126ProtectedFilesMatch:matches(()=>protectedFiles(before.files,after.files,'1.12.6/1012006',before.tables.events,eventData,before.tables.puppies[0].name,1))};
}
// Closed test seam: production and source self-checks exercise the same equal().

function preservationEquality(assertNativeTransition,eventDataFromSql){
 return function equal(before,after){let site='native-tables';try{assertNativeTransition(before.tables,after.tables);site='uid';assert.equal(after.uid,before.uid);site='widget-binding';assert.deepEqual(after.widgets,before.widgets);site='file-hashes';assert.deepEqual(Object.fromEntries(Object.entries(after.files).map(([k,v])=>[k,v.sha256])),Object.fromEntries(Object.entries(before.files).map(([k,v])=>[k,v.sha256])));}catch(error){try{preservationFailures.delete(error);preservationFailures.set(error,preservationProjection(before,after,site,eventDataFromSql,assertNativeTransition));}catch{/* Diagnostic faults never replace the original failure. */}throw error;}};
}

function coldPreservationEquality(assertNativeTransition,eventDataFromSql){
 return function equalCold(before,after){
  assertNativeTransition(before.tables,after.tables);assert.equal(after.uid,before.uid);assert.deepEqual(after.widgets,before.widgets);
  assert.ok(before.sqlite&&after.sqlite,'Require private SQLite state from both stopped snapshots.');assert.deepEqual(after.sqlite,before.sqlite);
  protectedFiles(before.files,after.files,'1.12.7/1012007',before.tables.events,eventDataFromSql,before.tables.puppies[0].name,0);
 };
}

function expectedLaunch(before,version){return {...before,metadata:before.metadata.map(row=>row.key==='backup_app_version'?{...row,value:version}:row)};}

function sqliteState(db){
 // Durable schema/format/application settings, without physical placement or write/schema counters.
 return {schema:db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name,tbl_name').all().map(row=>({...row})),metadata:Object.fromEntries(['user_version','application_id','page_size','encoding','auto_vacuum','journal_mode'].map(name=>[name,Object.values(db.prepare('PRAGMA '+name).get())[0]]))};
}

function protectedFiles(before,after,version,events,eventData=row=>row,puppyName,expectedBackups=0){
 for(const [name,value] of Object.entries(before))if(!sqliteFile(name))assert.equal(after[name]?.sha256,value.sha256,'Existing protected file changed: '+name);
 let addedBackups=0;for(const [name,value] of Object.entries(after))if(!(name in before)&&!sqliteFile(name)){
  addedBackups++;
  assert.match(name,/^files\/activity-backups\/bkp_[a-f0-9]{32}\.json$/,'Unexpected new protected file');
  const backup=JSON.parse(value.bytes);assert.deepEqual(Object.keys(backup).sort(),['appVersion','createdAt','events','format','petId','puppyName','reason','version'].sort());assert.equal(backup.puppyName,puppyName);assert.equal(backup.reason,'before-update');assert.equal(backup.appVersion,version);
  assert.equal(backup.format,'puptime-activity');assert.equal(backup.version,1);assert.equal(backup.petId,events[0].pet_id);assert.ok(Number.isSafeInteger(backup.createdAt));
  const ordered=values=>values.slice().sort((a,b)=>a.id.localeCompare(b.id));assert.deepEqual(ordered(backup.events),ordered(events.map(row=>({id:row.id,...eventData(row)}))));
 }
 assert.equal(addedBackups,expectedBackups,'Require exactly the source-defined before-update backup count.');
}
// Exact user-0 package row; retain the full UID string, without dumpsys aliases.

function packageUid(text){
 const match=typeof text==='string'&&/^package:com\.patrickchin\.puptime uid:([1-9][0-9]{0,9})\n?$/.exec(text);
 assert.ok(match&&match[0]===text&&Number(match[1])<=2147483647,'Require one exact package row with a positive full Java-int UID.');
 return match[1];
}

function widgetBinding(text,mark=()=>{}){
 text=text.replaceAll('\r','');const section=text.split('\nWidgets:\n')[1]?.split('\nHosts:\n')[0];mark('widget-section');assert.ok(section,'Inspect the actual Widgets section.');
 const blocks=section.split(/(?=^\s*\[\d+\] id=)/m).filter(part=>part.includes(app+'/'));
 mark('widget-count');assert.equal(blocks.length,1,'Require one real bound Puptime widget.');const block=blocks[0];
 const id=block.match(/^\s*\[\d+\] id=(\d+)/m)?.[1],host=block.match(/^\s*host=(HostId\{[^\n]+\})/m)?.[1],provider=block.match(/^\s*provider=(ProviderId\{[^\n]+\})/m)?.[1];
 mark('widget-identity');assert.ok(id&&host&&provider);return {id,host,provider};
}

function offlineSnapshot({airplane,wifiPreference,wifiStatus,connectivity,mobilePreference}){
 const text=connectivity.replaceAll('\r',''),defaults=text.match(/^[ \t]*Active default network: [^\n]*$/gm)??[],starts=text.match(/^[ \t]*Current Networks:[ \t]*$/gm)??[],ends=text.match(/^[ \t]*Status for known UIDs:[ \t]*$/gm)??[],section=text.match(/^[ \t]*Current Networks:[ \t]*\n([\s\S]*?)^[ \t]*Status for known UIDs:[ \t]*$/m);
 return {airplaneEnabled:airplane.trim()==='1',wifiPreferenceDisabled:wifiPreference.trim()==='0',wifiDisabled:wifiStatus.replaceAll('\r','').split('\n')[0].trim()==='Wifi is disabled',noDefaultNetwork:defaults.length===1&&defaults[0].trim()==='Active default network: none',noRegisteredNetworks:starts.length===1&&ends.length===1&&!!section&&section[1].trim()==='',mobileDataPreference:({'0':'disabled','1':'enabled',null:'unset'})[mobilePreference.trim()]??'other'};
}

const offlineReady=value=>['airplaneEnabled','wifiPreferenceDisabled','wifiDisabled','noDefaultNetwork','noRegisteredNetworks'].every(key=>value[key]===true);

function readOffline(adb){
 const read=(...args)=>{const result=adb(['shell',...args],5000);assert.equal(result.status,0,'Offline readback command failed.');return result.stdout;};
 return offlineSnapshot({airplane:read('settings','get','global','airplane_mode_on'),wifiPreference:read('settings','get','global','wifi_on'),wifiStatus:read('cmd','wifi','status'),connectivity:read('dumpsys','connectivity'),mobilePreference:read('settings','get','global','mobile_data')});
}

function emulatorOffline(io,state){
 state.offline='pending';io.save(state);const until=io.now()+30000;
 do{
  assert.ok(ownedProcess(io.inspect(),io.start),'Offline setup requires the same live owned emulator.');Object.assign(state,readOffline(io.adb));
  if(offlineReady(state)){state.offline='verified';io.save(state);return;}io.save(state);io.pause();
 }while(io.now()<until);
 state.offline='timeout';io.save(state);throw new Error('Actual offline connectivity readback timed out.');
}

function processStart(stat){const fields=stat.slice(stat.lastIndexOf(')')+2).trim().split(/\s+/);assert.match(fields[19]??'',/^\d+$/);return {start:fields[19],alive:!['Z','X'].includes(fields[0])};}

function safeHostState(value){
 const allowed={liveness:['not-started','owned','identity-mismatch','exited'],boot:['not-started','pending','complete'],rootRequest:['not-issued','acknowledged','closed-transport','refused'],rootReadback:['not-attempted','pending','verified','timeout','identity-mismatch'],cleanup:['not-attempted','already-exited','console-exit','term-exit','kill-exit','ownership-refused','still-alive'],setup:['failed'],offline:['pending','verified','timeout'],mobileDataPreference:['enabled','disabled','unset','other']},safe={};
 for(const [key,values] of Object.entries(allowed))if(key in value){assert.ok(values.includes(value[key]));safe[key]=value[key];}
 for(const key of ['privateMaterialRemoved','airplaneEnabled','wifiPreferenceDisabled','wifiDisabled','noDefaultNetwork','noRegisteredNetworks','offlinePreKey'])if(key in value){assert.equal(typeof value[key],'boolean');safe[key]=value[key];}return safe;
}

function ownedProcess(value,start){return !!value?.alive&&value.start===start&&value.executable&&value.arguments&&value.home&&value.uid;}

function processIdentity(files,expected){
 const stat=processStart(files.stat);if(!stat.alive)return stat;
 const after=processStart(files.afterStat);assert.equal(after.start,stat.start,'Process changed during /proc read.');
 const argv=files.cmdline.split('\0').filter(Boolean),uids=files.status.match(/^Uid:\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/m)?.slice(1);
 return {...stat,alive:after.alive,executable:expected.executables.includes(files.exe),arguments:expected.executables.includes(argv[0])&&JSON.stringify(argv.slice(1))===JSON.stringify(expected.arguments),home:JSON.stringify(files.environ.split('\0').filter(value=>value.startsWith('ANDROID_AVD_HOME=')))===JSON.stringify(['ANDROID_AVD_HOME='+expected.home]),uid:!!uids&&uids.every(value=>value===expected.uid)};
}

function recordOwnedEmulator(io,state){
 const until=io.now()+5000;do{const value=io.inspect();if(ownedProcess(value,io.start)){state.liveness='owned';io.save(state);return;}if(!value?.alive||value.start!==io.start)break;io.pause();}while(io.now()<until);
 state.liveness=io.inspect()?.alive?'identity-mismatch':'exited';io.save(state);throw new Error('Launcher did not become the exact owned SDK process within five seconds.');
}

function emulatorRoot(io,state){
 const live=()=>{const value=io.inspect();state.liveness=value?.alive?(ownedProcess(value,io.start)?'owned':'identity-mismatch'):'exited';io.save(state);assert.equal(state.liveness,'owned','Recorded emulator process is not live and owned.');};
 const poll=(seconds,read)=>{const until=io.now()+seconds*1000;do{live();if(read())return true;io.pause();}while(io.now()<until);return false;};
 const name=()=>{const result=io.adb(['emu','avd','name']);if(result.status!==0)return false;if(result.stdout.replaceAll('\r','').trim()!==io.name+'\nOK'){state.rootReadback='identity-mismatch';io.save(state);throw new Error('Unexpected emulator console identity.');}return true;};
 state.boot='pending';io.save(state);
 assert.ok(poll(180,()=>{if(!name())return false;const boot=io.adb(['shell','getprop','sys.boot_completed']);return boot.status===0&&boot.stdout.trim()==='1';}),'Owned emulator boot readback timed out.');state.boot='complete';
 const result=io.adb(['root'],20000),text=result.stdout+result.stderr;
 state.rootRequest=result.status===0&&['','adbd is already running as root\n','restarting adbd as root\n'].includes(text.replaceAll('\r',''))?'acknowledged':result.status===1&&result.stdout===''&&result.stderr.replaceAll('\r','')==='adb: unable to connect for root: closed\n'?'closed-transport':'refused';io.save(state);
 assert.notEqual(state.rootRequest,'refused','Root request failed outside the observed closed-transport case.');
 state.rootReadback='pending';io.save(state);
 const ready=poll(60,()=>{
  if(!name())return false;
  const boot=io.adb(['shell','getprop','sys.boot_completed']),uid=io.adb(['shell','id','-u']);
  return boot.status===0&&boot.stdout.trim()==='1'&&uid.status===0&&uid.stdout.trim()==='0';
 });state.rootReadback=ready?'verified':'timeout';io.save(state);assert.ok(ready,'Root UID/boot/owned-AVD readback timed out; no second root request.');
}

function stopEmulator(io,state){
 const inspect=()=>{const value=io.inspect();if(!value?.alive)return 'exited';return ownedProcess(value,io.start)?'owned':'identity-mismatch';};
 const wait=seconds=>{const until=io.now()+seconds*1000;do{const value=inspect();if(value!=='owned')return value;io.pause();}while(io.now()<until);return inspect();};
 const finish=value=>{state.cleanup=value;io.save(state);return !['ownership-refused','still-alive'].includes(value);};
 let current=inspect();if(current==='exited')return finish('already-exited');if(current!=='owned')return finish('ownership-refused');
 const name=io.adb(['emu','avd','name']);
 if(name.status===0&&name.stdout.replaceAll('\r','').trim()===io.name+'\nOK'){
  io.adb(['emu','kill']);current=wait(10);if(current==='exited')return finish('console-exit');if(current!=='owned')return finish('ownership-refused');
 }
 for(const [signal,seconds,label] of [['SIGTERM',10,'term-exit'],['SIGKILL',5,'kill-exit']]){
  current=inspect();if(current==='exited')return finish('already-exited');if(current!=='owned')return finish('ownership-refused');
  io.signal(signal);current=wait(seconds);if(current==='exited')return finish(label);if(current!=='owned')return finish('ownership-refused');
 }
 return finish('still-alive');
}

async function fileHash(path,fd,size){const digest=createHash('sha256');for await(const chunk of createReadStream(path,fd===undefined?undefined:{fd,autoClose:false,start:0,end:size-1}))digest.update(chunk);return digest.digest('hex');}


export function createSnapshotTools({root,device,command,adb,nativeSnapshot,mark=()=>{}}){
 const snapshotCategories=new Map([['files/SQLite','sqlite'],['files/activity-backups','backup'],['files/puppy-photos','photo'],['files/dog-photos','photo'],['shared_prefs','preferences']]);
 const snapshotCategory=remote=>snapshotCategories.get(remote);
 const exerciseEvidence={begin(){},end(){},snapshotSite:mark};

async function installedApkHash(){
 const installed=adb('shell','pm','path',app).trim();assert.match(installed,/^package:\/data\/app\/[^\n]+\/base\.apk$/);
 const directory=mkdtempSync(join(root,'apk-readback-')),path=join(directory,'base.apk');
 command('adb',['-s',device,'pull',installed.slice(8),path]);
 const fd=openSync(path,fsConstants.O_RDONLY|fsConstants.O_NOFOLLOW|fsConstants.O_NONBLOCK);let actual,complete=false;
 try{
  const initial=fstatSync(fd,{bigint:true});assert.ok(initial.isFile()&&initial.nlink===1n&&initial.size>0n&&initial.size<=256n*1024n*1024n);
  fchmodSync(fd,0o600);const before=fstatSync(fd,{bigint:true}),fields=['dev','ino','mode','nlink','uid','gid','size','mtimeNs','ctimeNs'];
  for(const key of fields.filter(key=>key!=='mode'&&key!=='ctimeNs'))assert.equal(before[key],initial[key]);
  actual=await fileHash(path,fd,Number(before.size));
  for(const after of [fstatSync(fd,{bigint:true}),lstatSync(path,{bigint:true})])assert.deepEqual(fields.map(key=>after[key]),fields.map(key=>before[key]));
  complete=true;
 }finally{try{closeSync(fd);}catch(error){if(complete)throw error;}}
 // On an earlier error, the existing owned-root cleanup removes partial data.
 rmSync(directory,{recursive:true});return actual;
}

function snapshot(label){
 exerciseEvidence.begin('snapshot-'+label);
 adb('shell','am','force-stop',app);const dest=join(root,'snapshot-'+label);mkdirSync(dest,{mode:0o700});const files={};
 for(const remote of ['files/SQLite','files/activity-backups','files/puppy-photos','files/dog-photos','shared_prefs']){
  const path='/data/user/0/'+app+'/'+remote;
  exerciseEvidence.snapshotSite(snapshotCategory(remote)+'-list');
  const listed=command('adb',['-s',device,'shell',`if test -d ${path}; then find ${path} -type f; fi`]);
  for(const full of listed.trim().split(/\r?\n/).filter(Boolean)){
   const name=full.slice(('/data/user/0/'+app+'/').length);exerciseEvidence.snapshotSite('path-containment');assert.ok(full.startsWith('/data/user/0/'+app+'/')&&!name.includes('..')&&!isAbsolute(name));exerciseEvidence.snapshotSite(snapshotCategory(remote)+'-read');const bytes=command('adb',['-s',device,'exec-out','cat',full],{binaryOutput:true});files[name]={sha256:hash(bytes),bytes};const target=join(dest,name);mkdirSync(resolve(target,'..'),{recursive:true,mode:0o700});writeFileSync(target,bytes);
  }
 }
 const db=new DatabaseSync(join(dest,'files/SQLite/puptime-v2.db'),{readOnly:true});db.exec('BEGIN');let tables,sqlite;try{exerciseEvidence.snapshotSite('sqlite-integrity');assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');exerciseEvidence.snapshotSite('sqlite-foreign-keys');assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);exerciseEvidence.snapshotSite('table-inventory');tables=nativeSnapshot(db);sqlite=sqliteState(db);}finally{db.exec('ROLLBACK');db.close();}
 const packageInfo=adb('shell','cmd','package','list','packages','-U','--user','0',app);exerciseEvidence.snapshotSite('package-uid');const uid=packageUid(packageInfo);
 const widgets=widgetBinding(adb('shell','dumpsys','appwidget'),site=>exerciseEvidence.snapshotSite(site));
 exerciseEvidence.end('snapshot-'+label);return {tables,files,uid,widgets,sqlite};
}

 return {installedApkHash,snapshot};
}

export {nativeErrorFields,preservationProjection,preservationEquality,coldPreservationEquality,expectedLaunch,sqliteState,protectedFiles,packageUid,widgetBinding,offlineSnapshot,readOffline,emulatorOffline,processStart,safeHostState,ownedProcess,processIdentity,recordOwnedEmulator,emulatorRoot,stopEmulator,installFailureProjection,fileHash,offlineReady};

export const reviewedOracleSource={"producerSHA256":"2be373b591fc2df0a4241a425bb4f3454cacc4d91446a13b54f32532b831ad57","functions":{"nativeErrorFields":"34cb1267e5c7a7e883d39be51d3e41c74f69101a326febe66e612c5bc854f8db","preservationProjection":"c14cd2e2b9faeb88f4ca11b2d655c68698cc115508c09a106abc9c45de3fb674","preservationEquality":"d23c18cd46ed77906bd51c2e4d5410f3f6b15c4e9c9f30c6c35b91cd9040fad9","coldPreservationEquality":"6684c7155754f5544d98fece8ce84a68f91fb7098818b46ed8d47b89293fc366","expectedLaunch":"df6f8680ce73918b284a8e42320debc0273a04d69e108d13899adf207d23a4ce","sqliteState":"506585fd1c6f755746dfc5e05ea41f54a738b8f520f560711b7c294379a5014e","protectedFiles":"af01145965297a2a944617a9ef30ff1435c92abe6553bc9252cb1d2884b6267a","packageUid":"abf68868cab469a05481e7a0c4d141044c54129c95bff5deb99721b8f53e4ef4","widgetBinding":"9eb034387e37aef24addce24d5049abf5b7ab06c0d542e1b2c6e107e33cef2e2","offlineSnapshot":"13c80bf3c6616594a82148c287fe4d6a84f4ee45b57585a11977693cd5f24074","readOffline":"e67e89c0f1c00186f4ff5becdc7dfc1e2b6b3acbdb736fe73e3d913df0a07c13","emulatorOffline":"c078ccdd86baff4647035bfdbe00e969bd7202d4c7c52cfa4dbf7069bf5b67d5","processStart":"5ba99856d4d8c3777cf54baee032d8491e5a07a38df4dc4f2e9f424aa6a9f884","safeHostState":"fc74aff840d877594cb61c017e06f2139e1daabc7d90e792243cb40142dffa21","ownedProcess":"b266521b48232c5d10fe16d711310f9914aff21e91a7e7114fb7eb020717827a","processIdentity":"f98d8e6f4dce6740d7a26fd13b4123c82b9719634a0dbe2c61df6eef1217df4f","recordOwnedEmulator":"bfdcfc57df262b1989a2bebff27188b1d6571c567f7ae3755a19eea7e98312e7","emulatorRoot":"ea5d7026a07258784244804e8afe2b04db31b9422f076ebe37bb1fd043f37825","stopEmulator":"7961558b228fff169a22981d9f416ab4c7a768c14a61a2056ae9ab2644d54cd7","fileHash":"d90f5930b8cd53b4366f98e75251d9624edf8b5e01f36864a517dd7c91e322d7","installedApkHash":"9914b85119a8269cb990dbe08d79690ef81c6ef0c34eb7df437b447d97ad3e1a","snapshot":"2c4afdca22893a938f788d631b455e85cb7aa855c5698789be698c63738a14be"}};

function readSqliteEngineReceipt(path) {
  let descriptor;
  try {
    const directory = dirname(path);
    assert.equal(realpathSync(directory), directory); assert.ok(lstatSync(directory).isDirectory() && !lstatSync(directory).isSymbolicLink());
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const before = fstatSync(descriptor); assert.ok(before.isFile() && before.size > 0 && before.size <= 256);
    const bytes = Buffer.alloc(257); let length = 0;
    while (length < bytes.length) { const count = readSync(descriptor, bytes, length, bytes.length - length, null); if (!count) break; length += count; }
    const after = fstatSync(descriptor), current = lstatSync(path);
    assert.ok(current.isFile() && !current.isSymbolicLink() && length === before.size && length <= 256);
    for (const field of ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs']) { assert.equal(after[field], before[field]); assert.equal(current[field], before[field]); }
    const raw = bytes.subarray(0, length), text = new TextDecoder('utf-8', { fatal: true }).decode(raw), value = JSON.parse(text);
    assert.ok(value && Object.keys(value).sort().join(',') === 'sourceId,version');
    assert.equal(typeof value.version, 'string'); assert.match(value.version, /^\d{1,3}\.\d{1,3}\.\d{1,3}$/);
    assert.equal(typeof value.sourceId, 'string'); assert.match(value.sourceId, /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d [a-f0-9]{64}$/);
    assert.equal(text, JSON.stringify({ version: value.version, sourceId: value.sourceId }));
    return raw;
  } finally { if (descriptor !== undefined) closeSync(descriptor); }
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


function androidReceiptStat(text){
 assert.match(text,/^\d+ \d+ (?:0|[1-9]\d{0,2}) \d+ \d+ [a-f0-9]+\n?$/);
 const [device,inode,size,modified,changed,mode]=text.trim().split(' ');
 assert.ok(Number(size)>0&&Number(size)<=256);assert.equal(parseInt(mode,16)&0xf000,0x8000);
 return {device,inode,size:Number(size),modified,changed,mode};
}


export {readSqliteEngineReceipt,stableFile,androidReceiptStat,diagnosticFields};
export const reviewedEngineReaderSource={"commit":"a6683e246a3b6eae7a954ae7a60ed37695202917","functions":{"readSqliteEngineReceipt":"5f2cc21222256b700ef3b23c016a0fe607dbcce3d664a8d675b9e7f448877360","stableFile":"22b0db26fdbd8812e15a8b0163582ec192cf75d34f9f7c35c3a7eb9bfa4787ea","androidReceiptStat":"c8be0fd5e2ca1d5ce0c39cadb5c9049bb27967c201646820c2a12aab241e3efb"}};

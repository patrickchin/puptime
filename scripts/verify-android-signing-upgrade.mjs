// Disposable signing QA only. Never upload its private directory or install on a personal device.
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import {createReadStream,createWriteStream,existsSync,lstatSync,mkdirSync,openSync,closeSync,mkdtempSync,readFileSync,readdirSync,writeFileSync,chmodSync,readlinkSync,realpathSync,rmSync} from 'node:fs';
import {join,resolve,isAbsolute} from 'node:path';
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {DatabaseSync} from 'node:sqlite';
import {tmpdir} from 'node:os';
import {types as utilTypes,isDeepStrictEqual} from 'node:util';
import {readNativeCommandState} from './native-command-evidence.mjs';

const app='com.patrickchin.puptime',oldSHA='82fa41075db35d747360183a2c3ff364e5c4fb4813519135d7a5eb076249a927';
const oldCert='fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c';
const keySHA='221e0a3106aa4c3ccc154e0a418b55020b3f9ea6e84f92e8749cd9e2f39f5e58';
const caps={'installed data':true,'shared UID':false,permission:false,rollback:false,auth:false};
const permissionEvidencePath='scripts/android-permission-experiment.py';
const permissionSource='fcf9d544d9324d447514a957daf87a0e59603fde';
const permissionRuns=['43623634026','43623654003'];
const permissionQualificationDigests=['0948d51163a14ebb03a00bd665dfc9f0c602af8c361e044a1da1e3e3527a7b31','269f093e480aedb14124070861e5a909a17324b243dedc64c8e66289af33727c'];
function permissionSelection(value){assert.ok(value===undefined||value==='false'||value==='true');return value==='true';}
const hash=value=>createHash('sha256').update(value).digest('hex');
const exerciseStages=['exercise-preconditions','original-artifact-validation','bridge-input-validation','later-input-validation','public-template-validation','qa-key-creation','qa-certificate-readback','lineage-creation','lineage-inspection','plain6-sign','plain6-verify','bridge6-sign','bridge6-verify','plain7-sign','plain7-verify','bridge-lineage-inspection','plain6-lineage-absence','plain7-lineage-absence','bridge-v31-validation','native-evidence-imports','original-install','original-launch','guest-seed','reminder-preference-seed','widget-binding','widget-first-save','snapshot-old-created','original-state-validation','plain-B-reject','snapshot-plain-B-rejected','plain-B-preservation','bridge-install','snapshot-bridge-before-launch','bridge-before-launch-preservation','bridge-launch','bridge-visible','snapshot-bridge-launched','bridge-state-validation','bridge-widget-save','snapshot-bridge-widget','bridge-widget-validation','higher-A-reject','snapshot-higher-A-rollback-rejected','higher-A-preservation','later-install','snapshot-later-before-launch','later-before-launch-preservation','later-launch','later-visible','snapshot-later-launched','later-state-validation','later-cold-restart','snapshot-later-cold','later-cold-preservation','exercise-finalize'];
const exerciseFlows=['old-ui-seed','old-reminder-lead','bind-real-launcher-widget','bridge-visible','bridge-cold','later-visible','later-cold'];
exerciseStages.push('permission-inventory-recheck','permission-lineage-creation','permission-lineage-inspection','control6-sign','control6-verify','control6-lineage-inspection','control6-v31-validation','permission-payload-equality','permission-owner-original','permission-control-install','permission-control-preservation','snapshot-permission-control-rejected','permission-owner-control');
// Last entered assertion boundary only, not a diagnosis or captured data.
const snapshotSites=['path-containment','sqlite-integrity','sqlite-foreign-keys','table-inventory','package-uid','widget-section','widget-count','widget-identity','sqlite-list','sqlite-read','backup-list','backup-read','photo-list','photo-read','preferences-list','preferences-read'];
const snapshotCategories=new Map([['files/SQLite','sqlite'],['files/activity-backups','backup'],['files/puppy-photos','photo'],['files/dog-photos','photo'],['shared_prefs','preferences']]);
const snapshotCategory=remote=>snapshotCategories.get(remote);
// Android16r1 PackageManager.installStatusToString: fixed names only; never retain its free-form message.
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
function installCommandFailure(binary,args,result,phase,root){
 const file=phase==='original-install'?'original125.apk':phase==='bridge-install'?'bridge6.apk':phase==='later-install'?'plain7.apk':phase==='permission-control-install'?'control6.apk':undefined;if(!file)return;
 const exact=expected=>binary==='adb'&&Array.isArray(args)&&args.length===expected.length&&args.every((value,i)=>value===expected[i]);
 const path=join(root,file),install=['-s','emulator-5588','install',...(phase==='original-install'?[]:['-r']),path];
 let commandKind='unrecognized';
 if(exact(install))commandKind='adb-install';
 else if(exact(['-s','emulator-5588','shell','pm','path',app]))commandKind='package-path';
 else if(typeof args?.[4]==='string'&&/^\/data\/app\/[^\n]+\/base\.apk$/.exec(args[4])?.[0]===args[4]&&exact(['-s','emulator-5588','exec-out','cat',args[4]]))commandKind='installed-apk-readback';
 return {commandKind,...(commandKind==='adb-install'?installFailureProjection(result,path):{installCodeDecline:'not-install-command'})};
}
const commandFailures=new WeakMap();
const preservationFailures=new WeakMap();
const preservationSites=['native-tables','uid','widget-binding','file-hashes'];
const preservationTables=['metadata','puppies','events','routines','settings','pet_settings','local_revisions','local_sync_owner','local_sync_pets','local_sync_outbox','local_sync_records','local_sync_acks','local_sync_baseline','sqlite_sequence'];
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
function preservationLaunched(assertNativeTransition,eventDataFromSql){
 return function launched(before,after,version){assertNativeTransition(expectedLaunch(before.tables,version),after.tables);assert.equal(after.uid,before.uid);assert.deepEqual(after.widgets,before.widgets);protectedFiles(before.files,after.files,version,before.tables.events,eventDataFromSql,before.tables.puppies[0].name,1);};
}
function beforeManualLaunch(before,after,version,equal,launched){
 assert.ok(['1.12.6/1012006','1.12.7/1012007'].includes(version));
 try{equal(before,after);}catch(original){
  if(nativeErrorFields(original).code?.value!=='ERR_ASSERTION')throw original;
  try{launched(before,after,version);}catch{throw original;}
 }
}
function permissionControl(error){
 const value=commandFailures.get(error);assert.equal(value?.class,'command-failed');assert.equal(value.status,1);assert.equal(value.commandKind,'adb-install');
 if(value.installCode==='INSTALL_FAILED_DUPLICATE_PERMISSION')return {...value,evidence:'unambiguous-observed-code'};
 assert.equal(value.installCode,undefined);assert.equal(value.installCodeDecline,'ambiguous-content');const observed=finiteInstallAmbiguity(value.installCodeAmbiguity);assert.ok(observed);assert.equal(observed.successToken,false);assert.equal(observed.unknownCodeObserved,false);assert.deepEqual(observed.publicCodes,['INSTALL_FAILED_DUPLICATE_PERMISSION']);
 return {...value,evidence:'consistent-observed-set-only'};
}
function commandFailure(error,result,details){
 const value={class:result.error?.code==='ETIMEDOUT'?'timeout':result.error?.code==='ENOENT'?'missing-tool':'command-failed'};
 if(Number.isInteger(result.status)&&result.status>=0&&result.status<=255)value.status=result.status;
 if(installCommandKinds.includes(details?.commandKind)){
  value.commandKind=details.commandKind;
  if(details.commandKind==='adb-install'&&details.installCodeDecline!=='ambiguous-content'&&installFailureCodes.has(details.installCode))value.installCode=details.installCode;
  else if(installCodeDeclines.includes(details.installCodeDecline))value.installCodeDecline=details.installCodeDecline;
  if(value.commandKind==='adb-install'&&value.installCodeDecline==='ambiguous-content'){const ambiguity=finiteInstallAmbiguity(diagnosticFields(details,['installCodeAmbiguity'])?.installCodeAmbiguity);if(ambiguity)value.installCodeAmbiguity=ambiguity;}
 }
 commandFailures.set(error,value);return error;
}
const positiveInstallStages=new Set(['original-install','bridge-install','later-install']);
const regexpSource=Object.getOwnPropertyDescriptor(RegExp.prototype,'source').get;
const regexpFlags=['hasIndices','global','ignoreCase','multiline','dotAll','unicode','unicodeSets','sticky'].map(name=>Object.getOwnPropertyDescriptor(RegExp.prototype,name)?.get);
function nativeErrorFields(error){
 try{
  if(utilTypes.isProxy(error)||!utilTypes.isNativeError(error))return {};
  const fields={};for(const key of ['code','operator','expected','actual']){const descriptor=Object.getOwnPropertyDescriptor(error,key);if(descriptor&&Object.hasOwn(descriptor,'value'))fields[key]=descriptor;}
  return fields;
 }catch{return {};}
}
function installAssertionSite(fields){
 try{
  if(!fields.operator||!fields.expected||!fields.actual)return 'UNKNOWN';
  const operator=fields.operator.value,expected=fields.expected.value;
  if(operator==='match'){
   if(utilTypes.isProxy(expected)||!utilTypes.isRegExp(expected))return 'UNKNOWN';
   const keys=Reflect.ownKeys(expected);if(keys.length!==1||keys[0]!=='lastIndex'||Object.getOwnPropertyDescriptor(expected,'lastIndex')?.value!==0)return 'UNKNOWN';
   if(regexpFlags.some(get=>typeof get!=='function'||get.call(expected)!==false))return 'UNKNOWN';
   const source=regexpSource.call(expected);
   return source==='Success'?'success-text':source==='^package:\\/data\\/app\\/[^\\n]+\\/base\\.apk$'?'package-path':'UNKNOWN';
  }
  // Only the strictEqual assertion consumes actual: it is a hash, never output.
  if(operator==='strictEqual'&&typeof expected==='string'&&/^[a-f0-9]{64}$/.test(expected)){
   const actual=fields.actual.value;if(typeof actual==='string'&&/^[a-f0-9]{64}$/.test(actual)&&actual!==expected)return 'installed-byte-hash';
  }
 }catch{/* Unknown data must not mask the original assertion or cleanup. */}
 return 'UNKNOWN';
}
function finiteFailure(error,phase){
 const command=commandFailures.get(error);if(command)return command;
 const fields=nativeErrorFields(error),assertion=fields.code?.value==='ERR_ASSERTION';
 return {class:assertion?'assertion':'other',...(assertion&&positiveInstallStages.has(phase)?{installAssertionSite:installAssertionSite(fields)}:{})};
}
function exerciseRecorder(save){
 const history=[],active=[];let failure,nativeCommand,snapshotSite,preservationComparison;
 const snapshot=()=>({phase:active.at(-1)??history.at(-1)?.phase??'exercise-preconditions',state:failure?'failed':active.length?'started':'completed',history:history.map(({phase,state})=>({phase,state})),...(failure?{failure:{...failure}}:{}),...(nativeCommand?{nativeCommand:{...nativeCommand}}:{}),...(snapshotSite?{snapshotSite}:{}),...(preservationComparison?{preservationComparison}:{})});
 const event=(phase,state)=>{assert.ok(exerciseStages.includes(phase));assert.ok(['started','completed','failed'].includes(state));assert.ok(history.length<256);history.push({phase,state});};
 return {phase:()=>active.at(-1),snapshotSite(site){assert.ok(snapshotSites.includes(site));assert.ok(active.at(-1)?.startsWith('snapshot-'));snapshotSite=site;},flowFailure(flow,directory){assert.ok(exerciseFlows.includes(flow));const stage=active.at(-1);assert.ok(exerciseStages.includes(stage));const {status,kind,targetId,sequence}=readNativeCommandState(directory);nativeCommand={flow,stage,status,kind,targetId,sequence};save(snapshot());},begin(phase){event(phase,'started');active.push(phase);snapshotSite=undefined;save(snapshot());},end(phase){assert.equal(active.at(-1),phase);event(phase,'completed');active.pop();snapshotSite=undefined;save(snapshot());},persist(){save(snapshot());},fail(error){failure=finiteFailure(error,active.at(-1)??history.at(-1)?.phase);preservationComparison=preservationFailures.get(error);event(active.at(-1)??history.at(-1)?.phase??'exercise-preconditions','failed');save(snapshot());}};
}
// Images are limited to two exact fresh/offline guest flow/stage pairs.
// Capture is best-effort; the original failure still ends the attempt.
function guestFailureImage(flow,stage,io){
 if(!((flow==='old-ui-seed'&&stage==='guest-seed')||(flow==='bind-real-launcher-widget'&&stage==='widget-binding')))return false;
 try{if(!io.owned())return false;const bytes=io.capture();if(!Buffer.isBuffer(bytes)||bytes.length<8||bytes.length>8*1024*1024||!bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')))return false;io.save(bytes);return true;}catch{return false;}
}
function installAssertionSelfCheck(){
 const secret='PRIVATE token=password /private/key.pem output message stack',capture=run=>{try{run();}catch(error){return error;}assert.fail('Expected native assertion');};
 const sites=[['success-text',()=>assert.match(secret,/Success/)],['package-path',()=>assert.match(secret,/^package:\/data\/app\/[^\n]+\/base\.apk$/)],['installed-byte-hash',()=>assert.equal(hash('actual'),hash('expected'))]];
 for(const phase of positiveInstallStages)for(const [site,run] of sites){
  const error=capture(run),fields=nativeErrorFields(error);assert.ok(utilTypes.isNativeError(error));assert.equal(fields.code?.value,'ERR_ASSERTION');assert.equal(fields.operator?.value,site==='installed-byte-hash'?'strictEqual':'match');assert.deepEqual(finiteFailure(error,phase),{class:'assertion',installAssertionSite:site});
  let saved,cleaned=false,caught;const record=exerciseRecorder(value=>saved=value);record.begin(phase);try{try{throw error;}catch(original){record.fail(original);throw original;}}catch(original){caught=original;}finally{cleaned=true;}assert.equal(caught,error);assert.equal(cleaned,true);assert.deepEqual(saved.failure,{class:'assertion',installAssertionSite:site});assert.ok(!JSON.stringify(saved).includes(secret));
  for(const outside of ['original-launch','plain-B-reject','snapshot-old-created',undefined,secret])assert.deepEqual(finiteFailure(error,outside),{class:'assertion'});
 }
 let getters=0,traps=0;const fixture=(operator='match',expected=/Success/,actual=secret)=>Object.assign(new Error(secret),{code:'ERR_ASSERTION',operator,expected,actual});
 const unknown=[fixture('match',/Other/),...['d','g','i','m','s','u','v','y'].map(flags=>fixture('match',new RegExp('Success',flags))),fixture('match',{}),fixture('match',new Proxy(/Success/,{get(){traps++;throw new Error(secret);},ownKeys(){traps++;throw new Error(secret);}})),fixture('other'),fixture('strictEqual','a'.repeat(64),'a'.repeat(64)),fixture('strictEqual','A'.repeat(64),'b'.repeat(64)),fixture('strictEqual',secret,secret),fixture('strictEqual',Buffer.from(secret),Buffer.from(secret)),fixture('strictEqual','a'.repeat(64),{get value(){getters++;throw new Error(secret);}})];
 const custom=/Success/;Object.defineProperty(custom,'source',{get(){getters++;throw new Error(secret);}});unknown.push(fixture('match',custom));const shifted=/Success/;shifted.lastIndex=1;unknown.push(fixture('match',shifted));
 for(const key of ['operator','expected','actual']){const error=fixture();Object.defineProperty(error,key,{get(){getters++;throw new Error(secret);}});unknown.push(error);const missing=fixture();delete missing[key];unknown.push(missing);}
 const inherited=fixture();delete inherited.operator;Object.setPrototypeOf(inherited,{operator:'match'});unknown.push(inherited);
 for(const error of unknown)assert.deepEqual(finiteFailure(error,'original-install'),{class:'assertion',installAssertionSite:'UNKNOWN'});
 const getCode=fixture();Object.defineProperty(getCode,'code',{get(){getters++;throw new Error(secret);}});const proxy=new Proxy(fixture(),{get(){traps++;throw new Error(secret);},getOwnPropertyDescriptor(){traps++;throw new Error(secret);}}),revoked=Proxy.revocable(fixture(),{});revoked.revoke();
 for(const error of [getCode,proxy,revoked.proxy,{code:'ERR_ASSERTION',operator:'match',expected:/Success/,actual:secret},null,undefined,secret])assert.deepEqual(finiteFailure(error,'original-install'),{class:'other'});
 // Intrinsic accessors ignore inherited source/flags getters on a genuine RegExp.
 const intrinsic=/Success/;Object.setPrototypeOf(intrinsic,{get source(){getters++;throw new Error(secret);},get flags(){getters++;throw new Error(secret);}});assert.deepEqual(finiteFailure(fixture('match',intrinsic),'original-install'),{class:'assertion',installAssertionSite:'success-text'});
 const command=commandFailure(capture(sites[0][1]),{status:1},{commandKind:'package-path',installCodeDecline:'not-install-command'});assert.deepEqual(finiteFailure(command,'original-install'),{class:'command-failed',status:1,commandKind:'package-path',installCodeDecline:'not-install-command'});assert.equal(getters,0);assert.equal(traps,0);
 console.log('PASS native assertion shapes, three closed install sites, UNKNOWN adversarial fields, no getter/proxy access and unchanged command-error precedence.');
}
function installAmbiguitySelfCheck(){
 const secret='PRIVATE token=password /private/key.pem',unknown='INSTALL_FAILED_PRIVATE_TOKEN',path='/private/qa/bridge6.apk',first='INSTALL_FAILED_INVALID_APK',second='INSTALL_FAILED_UPDATE_INCOMPATIBLE';
 const result=(stdout='',detail='',candidate=first)=>({status:1,stdout,stderr:'adb: failed to install '+path+': Failure ['+candidate+(detail?': '+detail:'')+']\n'});
 const evidence=(firstPredicate,successToken,codeTokens,failureMarkers,publicCodes,unknownCodeObserved=false)=>({firstPredicate,successToken,codeTokens,failureMarkers,publicCodes,unknownCodeObserved});
 const rows=[
  [result('Success\n'+secret),evidence('success-token',true,'one','one',[first])],
  [result('',first),evidence('code-token-count',false,'multiple','one',[first])],
  [result(second),evidence('code-token-count',false,'multiple','one',[first,second])],
  [result(unknown+' '+secret),evidence('code-token-count',false,'multiple','one',[first],true)],
  [result('INSTALL_SUCCEEDED\n'+unknown+'\nFailure [transport]'),evidence('success-token',true,'multiple','multiple',[first],true)],
  [result('Failure [transport] '+secret),evidence('failure-marker-count',false,'one','multiple',[first])],
  [result(first.toLowerCase()),evidence('code-token-count',false,'multiple','one',[first],true)],
  [result('Success','',unknown),evidence('success-token',true,'one','one',[],true)],
 ];
 for(const [input,expected] of rows){
  const projected=installFailureProjection(input,path);assert.deepEqual(projected,{installCodeDecline:'ambiguous-content',installCodeAmbiguity:expected});assert.equal(projected.installCode,undefined);assert.deepEqual(finiteInstallAmbiguity(projected.installCodeAmbiguity),expected);
  const original=new Error(secret),error=commandFailure(original,input,{commandKind:'adb-install',...projected,installCode:first});assert.equal(error,original);const finite=finiteFailure(error,'bridge-install');assert.deepEqual(finite,{class:'command-failed',status:1,commandKind:'adb-install',installCodeDecline:'ambiguous-content',installCodeAmbiguity:expected});for(const privateValue of [secret,unknown])assert.ok(!JSON.stringify(finite).includes(privateValue));
 }
 for(const code of installFailureCodes){const input=result('Success','',code),projected=installFailureProjection(input,path);assert.deepEqual(projected.installCodeAmbiguity.publicCodes,[code]);assert.equal(projected.installCodeAmbiguity.unknownCodeObserved,false);assert.equal(projected.installCode,undefined);}
 assert.deepEqual(installFailureProjection(result(secret),path),{installCode:first});
 assert.deepEqual(installAmbiguity(''),evidence('code-token-count',false,'zero','zero',[]));assert.equal(installAmbiguity('Failure ['+first+']'),undefined);
 let getters=0,traps=0;const proxy=new Proxy(result(),{get(){traps++;throw new Error(secret);},getOwnPropertyDescriptor(){traps++;throw new Error(secret);}}),revoked=Proxy.revocable(result(),{});revoked.revoke();
 for(const input of [proxy,revoked.proxy,Object.create(result()),{...result(),error:new Proxy({}, {get(){traps++;throw new Error(secret);}})}])assert.deepEqual(installFailureProjection(input,path),{installCodeDecline:'process-state'});
 for(const field of ['error','status','stdout','stderr']){const input=result();Object.defineProperty(input,field,{get(){getters++;throw new Error(secret);}});assert.deepEqual(installFailureProjection(input,path),{installCodeDecline:'process-state'});}
 const good=result('Success');for(const [input,reason] of [[{...good,status:0},'process-state'],[{...good,error:{code:'ETIMEDOUT'}},'process-state'],[{...good,stdout:Buffer.from(secret)},'output-type-or-size'],[{...good,stderr:'x'.repeat(32769)},'output-type-or-size'],[{...good,stdout:'x'.repeat(32769)},'output-type-or-size'],[{...good,stderr:good.stderr.replace(path,path+'-other')},'stderr-frame'],[{...good,stderr:good.stderr+'extra'},'stderr-frame']])assert.deepEqual(installFailureProjection(input,path),{installCodeDecline:reason});
 const valid=rows[0][1],bad=[null,secret,{...valid,firstPredicate:secret},{...valid,successToken:secret},{...valid,codeTokens:2},{...valid,failureMarkers:secret},{...valid,publicCodes:[unknown]},{...valid,publicCodes:[first,first]},{...valid,publicCodes:[second,first]},{...valid,publicCodes:Array(50).fill(first)},{...valid,unknownCodeObserved:secret},{...valid,firstPredicate:'code-token-count'},{...valid,publicCodes:[first,second]},{...valid,publicCodes:[],unknownCodeObserved:false}];
 for(const field of Object.keys(valid)){const input={...valid};Object.defineProperty(input,field,{get(){getters++;throw new Error(secret);}});bad.push(input);}
 const array=[first];Object.defineProperty(array,0,{get(){getters++;throw new Error(secret);}});bad.push({...valid,publicCodes:array},{...valid,publicCodes:new Proxy([first],{get(){traps++;throw new Error(secret);}})},new Proxy(valid,{getOwnPropertyDescriptor(){traps++;throw new Error(secret);}}));
 for(const input of bad)assert.equal(finiteInstallAmbiguity(input),undefined);
 const details={commandKind:'adb-install',installCodeDecline:'ambiguous-content'};Object.defineProperty(details,'installCodeAmbiguity',{get(){getters++;throw new Error(secret);}});assert.deepEqual(finiteFailure(commandFailure(new Error(secret),good,details)),{class:'command-failed',status:1,commandKind:'adb-install',installCodeDecline:'ambiguous-content'});assert.equal(getters,0);assert.equal(traps,0);
 console.log('PASS finite first-predicate/count buckets and literal public-code sets; ambiguous codes stay unaccepted, unknown tokens/private data/getters/proxies are excluded.');
}
function installCodeSelfCheck(){
 installAssertionSelfCheck();
 installAmbiguitySelfCheck();
 const secret='PRIVATE token=password /private/key.pem',root='/private/qa',path=join(root,'bridge6.apk'),args=['-s','emulator-5588','install','-r',path];
 const result=(code,detail='',ending='\n\n')=>({status:1,stdout:'Performing Streamed Install\n',stderr:'adb: failed to install '+path+': Failure ['+code+(detail?': '+detail:'')+']'+ending});
 const stdoutVariants=['','Performing Streamed Install\n','Unrelated bounded progress\n','Performing Incremental Install\nPerforming Streamed Install\n'];
 for(const code of installFailureCodes)for(const detail of ['',secret])for(const ending of ['\n','\n\n'])for(const stdout of stdoutVariants){
  const value={...result(code,detail,ending),stdout};assert.deepEqual(installFailureProjection(value,path),{installCode:code});
  const original=Object.assign(new Error(secret),{stdout:secret,stderr:secret,stack:secret}),error=commandFailure(original,value,installCommandFailure('adb',args,value,'bridge-install',root));assert.equal(error,original);assert.deepEqual(finiteFailure(error),{class:'command-failed',status:1,commandKind:'adb-install',installCode:code});assert.ok(!JSON.stringify(finiteFailure(error)).includes(secret));
 }
 const good=result('INSTALL_FAILED_UPDATE_INCOMPATIBLE',secret),cases=[
  ['process-state',null],['process-state',{}],...[-1,0,2,256,null,'1'].map(status=>['process-state',{...good,status}]),...['ETIMEDOUT','ENOENT'].map(code=>['process-state',{...good,error:{code,message:secret}}]),
  ...[{...good,stdout:Buffer.from(secret)},{...good,stderr:Buffer.from(secret)},{...good,stdout:'x'.repeat(32769)},{...good,stderr:'x'.repeat(32769)}].map(value=>['output-type-or-size',value]),
  ...['Success\n','INSTALL_SUCCEEDED\n','extra INSTALL_FAILED_INVALID_APK\n','extra install_failed_invalid_apk\n','Failure [transport]\n','Performing Incremental Install\nFailure [INSTALL_FAILED_INVALID_APK]\nPerforming Streamed Install\n'].map(stdout=>['ambiguous-content',{...good,stdout}]),
  ['unlisted-code',result('INSTALL_FAILED_UNKNOWN')],['unlisted-code',result('INSTALL_FAILED_UPDATE_INCOMPATIBLE_EXTRA')],['ambiguous-content',result('INSTALL_FAILED_UPDATE_INCOMPATIBLE',secret+' INSTALL_PARSE_FAILED_BAD_MANIFEST')],['ambiguous-content',result('INSTALL_FAILED_UPDATE_INCOMPATIBLE','Success')],['ambiguous-content',result('INSTALL_FAILED_UPDATE_INCOMPATIBLE','INSTALL_SUCCEEDED')],
  ...[result('INSTALL_FAILED_UPDATE_INCOMPATIBLE','nested [message]'),result('INSTALL_FAILED_UPDATE_INCOMPATIBLE',secret+'\n'),result('INSTALL_FAILED_UPDATE_INCOMPATIBLE',secret+'\u2028'),result('INSTALL_FAILED_UPDATE_INCOMPATIBLE','',''),result('INSTALL_FAILED_UPDATE_INCOMPATIBLE','','\n\n\n'),{...good,stderr:good.stderr+'Failure [INSTALL_FAILED_INVALID_APK]\n'},{...good,stderr:'prefix\n'+good.stderr},{...good,stderr:good.stderr.replace(']','')},{...good,stderr:good.stderr.replace('Failure [','Failure [prefix ')}].map(value=>['stderr-frame',value]),
 ];
 for(const [reason,value] of cases){const projected=installFailureProjection(value,path);assert.equal(projected.installCodeDecline,reason);if(reason!=='ambiguous-content')assert.deepEqual(projected,{installCodeDecline:reason});else{assert.deepEqual(finiteInstallAmbiguity(projected.installCodeAmbiguity),projected.installCodeAmbiguity);assert.equal(projected.installCode,undefined);}}
 for(const value of [undefined,null,'',path+'wrong',path+'\n'])assert.deepEqual(installFailureProjection(good,value),{installCodeDecline:'stderr-frame'});
 assert.deepEqual(installFailureProjection({...good,stdout:''},path),{installCode:'INSTALL_FAILED_UPDATE_INCOMPATIBLE'});
 for(const [argv,kind] of [[['-s','emulator-5588','shell','pm','path',app],'package-path'],[['-s','emulator-5588','exec-out','cat','/data/app/synthetic/base.apk'],'installed-apk-readback'],[['-s','wrong','install','-r',path],'unrecognized']])assert.deepEqual(installCommandFailure('adb',argv,good,'bridge-install',root),{commandKind:kind,installCodeDecline:'not-install-command'});
 for(const phase of ['plain-B-reject','snapshot-old-created','constructor',secret,undefined])assert.equal(installCommandFailure('adb',args,good,phase,root),undefined);
 assert.deepEqual(finiteFailure(commandFailure(new Error(secret),good,{commandKind:secret,installCode:secret,installCodeDecline:secret})),{class:'command-failed',status:1});
 const record=exerciseRecorder(value=>{assert.ok(!JSON.stringify(value).includes(secret));});record.begin('bridge-install');const error=commandFailure(new Error(secret),good,installCommandFailure('adb',args,good,'bridge-install',root));record.fail(error);assert.equal(finiteFailure(error).installCode,'INSTALL_FAILED_UPDATE_INCOMPATIBLE');
 console.log('PASS owned stderr failure-frame codes independent of unrelated bounded stdout; conflicts remain UNKNOWN and no ADB mode/cause is inferred.');
}

function exerciseEvidenceSelfCheck(){
 const secret='PRIVATE token=password key=/private/secret.pem stdout stderr stack';let saved;const make=()=>exerciseRecorder(value=>saved=JSON.parse(JSON.stringify(value)));
 const rich=()=>Object.assign(new Error(secret),{stack:secret,argv:[secret],stdout:Buffer.from(secret),stderr:secret,key:secret,password:secret,path:secret,token:secret,status:secret});
 const errors=[{error:rich(),expected:{class:'other'}},{error:Object.assign(rich(),{code:'ERR_ASSERTION',actual:secret,expected:secret}),expected:{class:'assertion'}}];
 for(const [code,status,kind] of [[undefined,17,'command-failed'],['ETIMEDOUT',null,'timeout'],['ENOENT',null,'missing-tool'],[undefined,0,'command-failed']])errors.push({error:commandFailure(rich(),{status,error:{code,message:secret},stdout:secret,stderr:secret}),expected:{class:kind,...(status===null?{}:{status})}});
 for(const {error,expected} of errors){const record=make();record.begin('original-artifact-validation');record.fail(error);assert.equal(saved.phase,'original-artifact-validation');assert.equal(saved.state,'failed');assert.deepEqual(saved.failure,expected);assert.deepEqual(saved.history,[{phase:'original-artifact-validation',state:'started'},{phase:'original-artifact-validation',state:'failed'}]);const text=JSON.stringify(saved);for(const key of ['PRIVATE','password','argv','stdout','stderr','stack','token','path'])assert.ok(!text.includes(key));}
 for(const status of [-1,256,NaN,'17',null])assert.deepEqual(finiteFailure(commandFailure(rich(),{status})),{class:'command-failed'});
 const record=make();record.begin('plain-B-preservation');record.begin('snapshot-plain-B-rejected');record.end('snapshot-plain-B-rejected');assert.equal(saved.phase,'plain-B-preservation');record.end('plain-B-preservation');assert.equal(saved.state,'completed');record.persist();assert.ok(!('failure' in saved));assert.throws(()=>record.begin(secret));assert.ok(!JSON.stringify(saved).includes(secret));
 const directory=mkdtempSync(join(tmpdir(),'puptime-command-state-'));chmodSync(directory,0o700);
 try{
  mkdirSync(join(directory,'timestamp','flow'),{recursive:true,mode:0o700});const file=join(directory,'timestamp','flow','commands.json');
  const leaf={command:{tapOnElement:{selector:{idRegex:'screen.today',text:secret},input:secret}},metadata:{status:'FAILED',sequenceNumber:23,error:secret,stack:secret}};
  writeFileSync(file,JSON.stringify([leaf]),{mode:0o600});const record=make();record.begin('guest-seed');record.flowFailure('old-ui-seed',directory);record.fail(errors[2].error);
  assert.deepEqual(saved.nativeCommand,{flow:'old-ui-seed',stage:'guest-seed',status:'FAILED',kind:'tap',targetId:'screen.today',sequence:23});assert.deepEqual(saved.failure,{class:'command-failed',status:17});assert.ok(!JSON.stringify(saved).includes(secret));
  for(const records of [[{...leaf,command:{inputTextCommand:{text:secret}}}],[{...leaf,command:{tapOnElement:{selector:{idRegex:secret}}}}],[leaf,{...leaf,metadata:{status:'RUNNING',sequenceNumber:24}}]]){
   writeFileSync(file,JSON.stringify(records));record.flowFailure('old-ui-seed',directory);assert.equal(saved.nativeCommand.targetId,null);assert.ok(!JSON.stringify(saved).includes(secret));
  }
  assert.equal(saved.nativeCommand.status,'UNKNOWN');assert.equal(saved.nativeCommand.sequence,0);assert.throws(()=>record.flowFailure(secret,directory));assert.ok(!JSON.stringify(saved).includes(secret));
  writeFileSync(file,JSON.stringify([{...leaf,command:{tapOnElement:{selector:{text:secret}}}}]));const widget=make();widget.begin('widget-binding');widget.flowFailure('bind-real-launcher-widget',directory);widget.fail(errors[2].error);assert.deepEqual(saved.nativeCommand,{flow:'bind-real-launcher-widget',stage:'widget-binding',status:'FAILED',kind:'tap',targetId:null,sequence:23});assert.ok(!JSON.stringify(saved).includes(secret));
 }finally{rmSync(directory,{recursive:true});}
 const png=Buffer.from('89504e470d0a1a0a','hex');let captures=0,saves=0;const io={owned:()=>true,capture:()=>{captures++;return png;},save:value=>{assert.deepEqual(value,png);saves++;}};
 for(const [flow,stage] of [['old-ui-seed','guest-seed'],['bind-real-launcher-widget','widget-binding']]){
  const beforeCaptures=captures,beforeSaves=saves;assert.equal(guestFailureImage(flow,stage,io),true);assert.equal(captures,beforeCaptures+1);assert.equal(saves,beforeSaves+1);
  assert.equal(guestFailureImage(flow,stage,{...io,owned:()=>false}),false);assert.equal(captures,beforeCaptures+1);
  for(const patch of [{owned:()=>{throw rich();}},{capture:()=>{throw rich();}},{capture:()=>Buffer.from(secret)},{capture:()=>Buffer.alloc(8*1024*1024+1)},{save:()=>{throw rich();}}])assert.equal(guestFailureImage(flow,stage,{...io,...patch}),false);
 }
 const beforeDisallowed=captures;for(const [flow,stage] of [['later-visible','later-visible'],['old-ui-seed','qa-key-creation'],['old-ui-seed','widget-binding'],['bind-real-launcher-widget','guest-seed'],['bind-real-launcher-widget','qa-key-creation'],[secret,'guest-seed']])assert.equal(guestFailureImage(flow,stage,io),false);assert.equal(captures,beforeDisallowed);
 const original=errors[2].error;let caught;try{try{throw original;}catch(error){guestFailureImage('old-ui-seed','guest-seed',{...io,capture:()=>{throw rich();}});throw error;}}catch(error){caught=error;}assert.equal(caught,original);assert.deepEqual(finiteFailure(caught),{class:'command-failed',status:17});
 console.log('PASS finite exercise stage/error/status evidence and secret-rich negative checks; no command, keys or device operations.');
}

const toolingPaths=['.github/workflows/android-signing-proof.yml','scripts/verify-android-signing-upgrade.mjs'];
const nativeCommandPath='scripts/native-command-evidence.mjs';
function validateDriver(expected,actual){assert.match(expected??'',/^[a-f0-9]{40}$/);assert.equal(actual,expected,'Pin the reviewed driver SHA separately from artifact source.');}
function equivalentChanges(raw,permissionExperiment=false){
 if(!raw)return [];
 assert.ok(raw.endsWith('\0'));const fields=raw.slice(0,-1).split('\0');assert.equal(fields.length%2,0);
 const changes=[];
 for(let i=0;i<fields.length;i+=2){
  const modified=fields[i].match(/^:100644 100644 ([a-f0-9]{40}) ([a-f0-9]{40}) M$/),added=fields[i].match(/^:000000 100644 (0{40}) ([a-f0-9]{40}) A$/),path=fields[i+1];
  assert.ok(modified&&toolingPaths.includes(path)||added&&(path===nativeCommandPath||permissionExperiment&&path===permissionEvidencePath)&&added[2]!=='0'.repeat(40),'Only two same-mode tooling edits and explicitly selected regular-file evidence helpers are allowed.');
  const match=modified??added;assert.ok(!changes.some(value=>value.path===path));changes.push({path,mode:'100644',sourceBlob:match[1],driverBlob:match[2],...(added?{changeType:'A'}:{})});
 }
 return changes;
}
// These Android widget files/lock are identical in the original125 source and
// the reviewed candidate. English accessibility labels do not follow app locale.
// RNWidgetProvider persists only WIDGET_SIZES width/height; palette is rendered
// into RemoteViews/derived images, not SharedPreferences. Keep every pref strict.
const widgetSourceBlobs={
 'src/widgets/QuickLogWidget.android.tsx':'3bc44bcf181856800d23afa68f354c76c994e9a7',
 'src/widgets/sync.android.tsx':'de2ba1d976628045c7d04eac04223bfa0b6e7547',
 'src/widget-task-handler.tsx':'163f9b022061fc878858c903b3c7e1c39adf235b',
 'package-lock.json':'8f50766ef2f6e7c671d02b2c959147e124e94c9c',
};
function assertWidgetSource(){for(const [name,blob] of Object.entries(widgetSourceBlobs)){const bytes=readFileSync(name);assert.equal(createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex'),blob,'Re-review widget serialization/selectors if '+name+' changes.');}}

async function fileHash(path){const digest=createHash('sha256');for await(const chunk of createReadStream(path))digest.update(chunk);return digest.digest('hex');}
function validateRun(run,jobs,repo,source,id){
 assert.equal(run.id,Number(id));assert.equal(run.repository.full_name,repo);assert.equal(run.head_repository.full_name,repo);
 assert.equal(run.head_sha,source);assert.equal(run.path,'.github/workflows/android-apk.yml');
 assert.equal(run.event,'workflow_dispatch');assert.equal(run.status,'completed');assert.equal(run.conclusion,'success');
 assert.deepEqual(jobs.map(job=>[job.name,job.conclusion]).sort(),[['build','success'],['publish','skipped']]);
}
function chooseArtifact(items,name,runId){const matches=items.filter(item=>item.name===name);assert.equal(matches.length,1);const item=matches[0];assert.equal(item.expired,false);assert.match(item.digest,/^sha256:[a-f0-9]{64}$/);assert.equal(item.workflow_run.id,Number(runId));return item;}
function inspectCapabilities(text,a,b,expected=caps){
 const blocks=text.split(/(?=Signer #\d+ in lineage certificate DN:)/).filter(value=>value.trim());assert.equal(blocks.length,2);
 for(const [i,cert] of [a,b].entries())assert.ok(blocks[i].includes('certificate SHA-256 digest: '+cert));
 for(const [name,value] of Object.entries(expected))assert.match(blocks[0],new RegExp('Has '+name+' capability\\s*:\\s*'+value+'(?:\\s|$)'));
}
function permissionCapabilityPair(control,experiment,a,b){
 inspectCapabilities(control,a,b);inspectCapabilities(experiment,a,b,{...caps,permission:true});
 const oldBlock=text=>text.split(/(?=Signer #\d+ in lineage certificate DN:)/).filter(value=>value.trim())[0];
 for(const text of [control,experiment])for(const name of Object.keys(caps))assert.equal([...oldBlock(text).matchAll(new RegExp('Has '+name+' capability\\s*:\\s*(true|false)(?=\\s|$)','g'))].length,1);
 const normalize=text=>text.replace(/(Has permission capability\s*:\s*)true(?=\s|$)/,'$1false');
 assert.equal(normalize(experiment),control,'Only old-A PERMISSION may differ, including all other signer fields.');
}
function expectedLaunch(before,version){return {...before,metadata:before.metadata.map(row=>row.key==='backup_app_version'?{...row,value:version}:row)};}
const sqliteFile=name=>/^files\/SQLite\/puptime-v2\.db(?:-wal|-shm|-journal)?$/.test(name);
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
function packageUidSelfCheck(){
 const row=uid=>'package:com.patrickchin.puptime uid:'+uid;
 for(const uid of ['1','10001','2147483647'])for(const suffix of ['','\n']){const actual=packageUid(row(uid)+suffix);assert.equal(actual,uid);assert.equal(typeof actual,'string');}
 const invalid=[null,undefined,{},new String(row('10001')),'',row('0'),...['-1','+10001','010001','00','2147483648','9999999999','10000000000','1e4','0x2711','10.0','10001,10002','١٠٠٠١','１０００１','NaN','Infinity',' 10001','10001 '].map(row),row('10001')+'\n\n',row('10001')+'\r\n',row('10001')+'\nextra','\n'+row('10001'),' '+row('10001'),row('10001')+' extra',row('10001')+'\n'+row('10001'),row('10001')+'\n'+row('10002')+'\n',row('10001').replace('puptime','puptime.extra'),row('10001').replace('package:','package:prefix.'),row('10001').replace(' uid:','\tuid:'),row('10001').replace('uid:','userId:'),'userId=10001','appId=10001'];
 for(const value of invalid)assert.throws(()=>packageUid(value),{code:'ERR_ASSERTION'});
 console.log('PASS strict exact-package full UID rows, Java-int bounds and adversarial output rejection; no legacy aliases or commands.');
}
function widgetBinding(text,mark=()=>{}){
 text=text.replaceAll('\r','');const section=text.split('\nWidgets:\n')[1]?.split('\nHosts:\n')[0];mark('widget-section');assert.ok(section,'Inspect the actual Widgets section.');
 const blocks=section.split(/(?=^\s*\[\d+\] id=)/m).filter(part=>part.includes(app+'/'));
 mark('widget-count');assert.equal(blocks.length,1,'Require one real bound Puptime widget.');const block=blocks[0];
 const id=block.match(/^\s*\[\d+\] id=(\d+)/m)?.[1],host=block.match(/^\s*host=(HostId\{[^\n]+\})/m)?.[1],provider=block.match(/^\s*provider=(ProviderId\{[^\n]+\})/m)?.[1];
 mark('widget-identity');assert.ok(id&&host&&provider);return {id,host,provider};
}
function snapshotSiteSelfCheck(){
 const secret='PRIVATE raw path UID widget database error token',rich=()=>Object.assign(new Error(secret),{code:'ERR_ASSERTION',actual:secret,expected:secret,stdout:secret,stderr:secret,stack:secret});
 for(const site of snapshotSites){
  let saved,writes=0;const record=exerciseRecorder(value=>{writes++;saved=JSON.parse(JSON.stringify(value));});record.begin('snapshot-old-created');const before=writes;
  record.snapshotSite(site);assert.equal(writes,before,'Markers are in-memory only.');const error=rich();let caught;try{throw error;}catch(value){caught=value;record.fail(value);}assert.equal(caught,error);assert.equal(saved.snapshotSite,site);assert.deepEqual(saved.failure,{class:'assertion'});assert.deepEqual(saved.history,[{phase:'snapshot-old-created',state:'started'},{phase:'snapshot-old-created',state:'failed'}]);assert.ok(!JSON.stringify(saved).includes(secret));
 }
 let saved,writes=0;const record=exerciseRecorder(value=>{writes++;saved=JSON.parse(JSON.stringify(value));});record.begin('snapshot-old-created');record.snapshotSite('package-uid');const before=writes;
 for(const invalid of [secret,'',null,{},['package-uid']])assert.throws(()=>record.snapshotSite(invalid));assert.equal(writes,before);record.fail(commandFailure(rich(),{status:17}));assert.equal(saved.snapshotSite,'package-uid');assert.deepEqual(saved.failure,{class:'command-failed',status:17});assert.ok(!JSON.stringify(saved).includes(secret));
 const clean=exerciseRecorder(value=>saved=value);clean.begin('snapshot-old-created');clean.snapshotSite('widget-identity');clean.end('snapshot-old-created');assert.ok(!('snapshotSite' in saved));clean.begin('snapshot-bridge-before-launch');assert.ok(!('snapshotSite' in saved));clean.snapshotSite('package-uid');clean.begin('snapshot-bridge-launched');assert.ok(!('snapshotSite' in saved));
 const outside=exerciseRecorder(value=>saved=value);outside.begin('guest-seed');assert.throws(()=>outside.snapshotSite('package-uid'));outside.fail(rich());assert.ok(!('snapshotSite' in saved));
 const valid='\nWidgets:\n  [0] id=2\n    host=HostId{'+secret+'}\n    provider=ProviderId{'+app+'/'+app+'.widget.PuptimeQuickLog '+secret+'}\nHosts:\n';
 for(const [text,site] of [[secret,'widget-section'],['\nWidgets:\n  unrelated\nHosts:\n','widget-count'],[valid.replace('    host=','    missing='),'widget-identity']]){
  const capture=exerciseRecorder(value=>saved=value);capture.begin('snapshot-old-created');let error;try{widgetBinding(text,value=>capture.snapshotSite(value));}catch(value){error=value;capture.fail(value);}assert.equal(error?.code,'ERR_ASSERTION');assert.equal(saved.snapshotSite,site);assert.deepEqual(saved.failure,{class:'assertion'});assert.ok(!JSON.stringify(saved).includes(secret));
 }
 const entered=[];assert.equal(widgetBinding(valid,site=>entered.push(site)).id,'2');assert.deepEqual(entered,['widget-section','widget-count','widget-identity']);
 console.log('PASS sixteen finite in-memory snapshot sites, preserved failures/status, marker reset and production widget assertion boundaries. No native data or commands.');
}
function snapshotIoSiteSelfCheck(){
 const secret='PRIVATE raw path email token',expected=[['files/SQLite','sqlite'],['files/activity-backups','backup'],['files/puppy-photos','photo'],['files/dog-photos','photo'],['shared_prefs','preferences']];
 assert.deepEqual([...snapshotCategories],expected);assert.deepEqual([...new Set(expected.flatMap(([,category])=>[category+'-list',category+'-read']))].sort(),snapshotSites.slice(8).sort());
 for(const unknown of [secret,'','files/SQLite/extra','shared_prefs2','toString','__proto__',null,undefined,{}])assert.equal(snapshotCategory(unknown),undefined);
 const source=readFileSync(resolve(process.argv[1]),'utf8'),matches=[...source.matchAll(/^function snapshot\(label\)\{/gm)];assert.equal(matches.length,1);const start=matches[0].index,end=source.indexOf('\nconst equal=preservationEquality',start);assert.ok(start>0&&end>start);
 const execute=Function('assert','exerciseEvidence','adb','command','mkdirSync','join','root','app','device','isAbsolute','snapshotCategory',source.slice(start,end)+';return snapshot("old-created");');
 for(const [remote,category] of expected)for(const operation of ['list','read','containment']){
  let saved,writes=0,reads=0;const record=exerciseRecorder(value=>{writes++;saved=value;}),original=commandFailure(new Error(secret),{status:255}),before=()=>writes;
  const run=(binary,args)=>{
   assert.equal(binary,'adb');assert.deepEqual(args.slice(0,2),['-s','owned']);
   if(args[2]==='shell'){
    const selected=expected.find(([name])=>args[3]===`if test -d /data/user/0/${app}/${name}; then find /data/user/0/${app}/${name} -type f; fi`);assert.ok(selected);
    assert.equal(recordedSite(),selected[1]+'-list');
    if(selected[0]!==remote)return '';if(operation==='list')throw original;
    return operation==='containment'?'/private/'+secret:'/data/user/0/'+app+'/'+remote+'/fixture';
   }
   assert.deepEqual(args,['-s','owned','exec-out','cat','/data/user/0/'+app+'/'+remote+'/fixture']);assert.equal(recordedSite(),category+'-read');reads++;throw original;
  };
  let site;const evidence={...record,snapshotSite(value){const count=before();record.snapshotSite(value);assert.equal(writes,count);site=value;}};const recordedSite=()=>site;
  let caught;try{execute(assert,evidence,(...args)=>{assert.deepEqual(args,['shell','am','force-stop',app]);},run,()=>{},join,'/synthetic',app,'owned',isAbsolute,snapshotCategory);}catch(error){caught=error;record.fail(error);}
  assert.equal(saved.snapshotSite,operation==='containment'?'path-containment':category+'-'+operation);assert.ok(!JSON.stringify(saved).includes(secret));
  if(operation==='containment'){assert.equal(caught.code,'ERR_ASSERTION');assert.equal(reads,0);assert.deepEqual(saved.failure,{class:'assertion'});}else{assert.equal(caught,original);assert.deepEqual(saved.failure,{class:'command-failed',status:255});assert.equal(reads,Number(operation==='read'));}
 }
 console.log('PASS five exact directory categories, eight closed I/O sites and actual-source list/read/containment failure placement; no native commands or data.');
}
function preservationSelfCheck(){
 const secret='PRIVATE_EMAIL_TOKEN pet_PRIVATE evt_PRIVATE /private/record.json raw-error',event={id:'evt_PRIVATE',pet_id:'pet_PRIVATE',type:'pee',source:'widget',at:1,note:secret};
 const eventData=({id,pet_id,...body})=>body,transition=(before,after)=>assert.deepEqual(after,before),equal=preservationEquality(transition,eventData);
 const tables=Object.fromEntries(preservationTables.map(name=>[name,[]]));Object.assign(tables,{metadata:[{key:'backup_app_version',value:'1.12.5/1012005'},{key:'active_pet_id',value:'pet_PRIVATE'}],puppies:[{id:'pet_PRIVATE',name:secret}],events:[event]});
 const before={tables,uid:'10123',widgets:{id:'77',host:secret,provider:secret},files:{'files/SQLite/puptime-v2.db':{sha256:hash('db'),bytes:Buffer.from(secret)},'shared_prefs/PRIVATE.xml':{sha256:hash('prefs'),bytes:Buffer.from(secret)},'files/puppy-photos/pet_PRIVATE.jpg':{sha256:hash('photo'),bytes:Buffer.from(secret)}}};
 assert.equal(preservationTables.length,14);assert.equal(new Set(preservationTables).size,14);assert.equal(equal(before,structuredClone(before)),undefined);
 const projection=(after,site)=>{const oldBefore=JSON.stringify(before),oldAfter=JSON.stringify(after);let error;try{equal(before,after);}catch(value){error=value;}assert.equal(JSON.stringify(before),oldBefore);assert.equal(JSON.stringify(after),oldAfter);assert.ok(error);const value=preservationFailures.get(error);assert.ok(value);assert.equal(value.firstSite,site);assert.deepEqual(Object.keys(value.tableEqual),preservationTables);assert.equal(Object.keys(value.tableEqual).length,14);assert.deepEqual(Object.keys(value.fileChanges),['sqlite','preferences','backup','photo','other']);assert.ok(!JSON.stringify(value).includes('PRIVATE'));assert.ok(!JSON.stringify(value).includes('10123'));return {error,value};};
 for(const site of preservationSites){
  const after=structuredClone(before);if(site==='native-tables')after.tables.events[0].note=secret+' changed';if(site==='uid')after.uid='10124';if(site==='widget-binding')after.widgets.id='78';if(site==='file-hashes')after.files['shared_prefs/PRIVATE.xml'].sha256=hash('changed');
  const {error,value}=projection(after,site);assert.deepEqual([value.nativeTablesEqual,value.uidEqual,value.widgetBindingEqual,value.fileHashesEqual],preservationSites.map(name=>name!==site));
  assert.equal(value.tableEqual.events,site!=='native-tables');assert.equal(Object.values(value.tableEqual).filter(flag=>!flag).length,site==='native-tables'?1:0);assert.deepEqual(finiteFailure(error,'bridge-before-launch-preservation'),{class:'assertion'});
  let saved;const record=exerciseRecorder(value=>saved=value);record.begin('bridge-before-launch-preservation');record.fail(error);assert.deepEqual(saved.preservationComparison,value);assert.deepEqual(saved.failure,{class:'assertion'});assert.equal(saved.state,'failed');assert.ok(!JSON.stringify(saved).includes('PRIVATE'));
 }
 const mixed=structuredClone(before);mixed.tables.events[0].note=secret+' changed';mixed.uid='10124';mixed.widgets.id='78';mixed.files['shared_prefs/PRIVATE.xml'].sha256=hash('changed');const all=projection(mixed,'native-tables').value;assert.deepEqual([all.nativeTablesEqual,all.uidEqual,all.widgetBindingEqual,all.fileHashesEqual],[false,false,false,false]);
 const files=structuredClone(before);files.files['files/SQLite/puptime-v2.db'].sha256=hash('checkpoint');files.files['shared_prefs/PRIVATE.xml'].sha256=hash('changed');delete files.files['files/puppy-photos/pet_PRIVATE.jpg'];files.files['files/activity-backups/bkp_'+ 'b'.repeat(32)+'.json']={sha256:hash('backup'),bytes:Buffer.from(secret)};files.files['files/other-PRIVATE-A']={sha256:hash('other-a')};files.files['files/other-PRIVATE-B']={sha256:hash('other-b')};
 const change=projection(files,'file-hashes').value.fileChanges;assert.deepEqual(change.sqlite,{added:'zero',removed:'zero',changed:'one'});assert.equal(change.preferences.changed,'one');assert.equal(change.photo.removed,'one');assert.equal(change.backup.added,'one');assert.equal(change.other.added,'multiple');
 const version=structuredClone(before);version.tables=expectedLaunch(version.tables,'1.12.6/1012006');version.files['files/SQLite/puptime-v2.db'].sha256=hash('checkpoint');
 const backup={format:'puptime-activity',version:1,createdAt:1,petId:'pet_PRIVATE',puppyName:secret,reason:'before-update',appVersion:'1.12.6/1012006',events:[{id:event.id,...eventData(event)}]},backupBytes=Buffer.from(JSON.stringify(backup)),backupPath='files/activity-backups/bkp_'+ 'a'.repeat(32)+'.json';version.files[backupPath]={sha256:hash(backupBytes),bytes:backupBytes};
 const expected=projection(version,'native-tables');assert.equal(expected.value.bridge126TablesMatch,true);assert.equal(expected.value.bridge126ProtectedFilesMatch,true);assert.equal(expected.value.nativeTablesEqual,false);assert.equal(expected.value.tableEqual.metadata,false);assert.equal(Object.values(expected.value.tableEqual).filter(flag=>!flag).length,1);assert.deepEqual(finiteFailure(expected.error,'bridge-before-launch-preservation'),{class:'assertion'});
 version.files[backupPath].bytes=Buffer.from(secret);assert.equal(projection(version,'native-tables').value.bridge126ProtectedFilesMatch,null,'Unexpected diagnostic exceptions are unknown, never a failed original oracle.');
 const original=commandFailure(new Error(secret),{status:19}),throwing=preservationEquality(()=>{throw original;},eventData);let caught;
 try{throwing(before,structuredClone(before));}catch(error){caught=error;}assert.equal(caught,original);assert.ok(preservationFailures.has(original));
 const broken=structuredClone(before);Object.defineProperty(broken,'files',{get(){throw Object.assign(new Error(secret),{code:'EACCES'});}});
 try{throwing(before,broken);}catch(error){caught=error;}assert.equal(caught,original);assert.equal(preservationFailures.has(original),false,'A failed diagnostic clears stale evidence for the same error identity.');let saved;const record=exerciseRecorder(value=>saved=value);record.begin('bridge-before-launch-preservation');record.fail(caught);assert.deepEqual(saved.failure,{class:'command-failed',status:19});assert.ok(!('preservationComparison' in saved));assert.ok(!JSON.stringify(saved).includes('PRIVATE'));
 for(const primitive of [null,secret]){const compare=preservationEquality(()=>{throw primitive;},eventData);let caught;try{compare(before,structuredClone(before));}catch(error){caught=error;}assert.equal(caught,primitive);assert.equal(preservationFailures.get(caught),undefined);assert.deepEqual(finiteFailure(caught,'bridge-before-launch-preservation'),{class:'other'});}
 console.log('PASS actual equality wrapper table/UID/widget/file failures, closed14-table/file-bucket evidence, version-only still rejected, unknown diagnostic faults and original error/status/privacy preservation.');
}
function beforeManualLaunchSelfCheck(){
 const secret='PRIVATE_EMAIL_TOKEN pet_PRIVATE evt_PRIVATE /private/history.json',eventData=({id,pet_id,...body})=>body,transition=(before,after)=>assert.deepEqual(after,before);
 const equal=preservationEquality(transition,eventData),launched=preservationLaunched(transition,eventData);
 const copy=value=>{const result=structuredClone(value);for(const [name,file] of Object.entries(value.files))if(file.bytes)result.files[name].bytes=Buffer.from(file.bytes);return result;};
 let rejected=0,legitimate=0;
 for(const [previous,target,other] of [['1.12.5/1012005','1.12.6/1012006','1.12.7/1012007'],['1.12.6/1012006','1.12.7/1012007','1.12.6/1012006']]){
  const event={id:'evt_PRIVATE',pet_id:'pet_PRIVATE',type:'pee',source:'widget',at:1,note:secret},tables=Object.fromEntries(preservationTables.map(name=>[name,[]]));
  Object.assign(tables,{metadata:[{key:'backup_app_version',value:previous},{key:'active_pet_id',value:'pet_PRIVATE'}],puppies:[{id:'pet_PRIVATE',name:secret}],events:[event],settings:[{key:'preference',value:secret}],routines:[{id:'rtn_PRIVATE',enabled:1}],local_revisions:[{sequence:1,local_id:event.id,after_data:secret}]});
  const before={tables,uid:'10123',widgets:{id:'77',host:secret,provider:secret},files:{'files/SQLite/puptime-v2.db':{sha256:hash('db')},'shared_prefs/PRIVATE.xml':{sha256:hash('prefs')},'files/puppy-photos/pet_PRIVATE.jpg':{sha256:hash('photo')},['files/activity-backups/bkp_'+ 'c'.repeat(32)+'.json']:{sha256:hash('existing-backup')}}};
  const path='files/activity-backups/bkp_'+ 'a'.repeat(32)+'.json',extra='files/activity-backups/bkp_'+ 'b'.repeat(32)+'.json',updated=copy(before);updated.tables=expectedLaunch(updated.tables,target);updated.files['files/SQLite/puptime-v2.db'].sha256=hash('checkpoint');
  const body={format:'puptime-activity',version:1,createdAt:1,petId:'pet_PRIVATE',puppyName:secret,reason:'before-update',appVersion:target,events:[{id:event.id,...eventData(event)}]},bytes=Buffer.from(JSON.stringify(body));updated.files[path]={sha256:hash(bytes),bytes};
  let alternatives=0;const upgrade=(...args)=>{alternatives++;return launched(...args);};assert.equal(beforeManualLaunch(before,copy(before),target,equal,upgrade),undefined);assert.equal(alternatives,0);legitimate++;
  assert.throws(()=>equal(before,updated),{code:'ERR_ASSERTION'});assert.equal(beforeManualLaunch(before,updated,target,equal,upgrade),undefined);assert.equal(alternatives,1);legitimate++;
  const wal=copy(updated);wal.files['files/SQLite/puptime-v2.db-wal']={sha256:hash('new-wal')};beforeManualLaunch(before,wal,target,equal,launched);launched(before,updated,target);assert.throws(()=>launched(updated,updated,target),{code:'ERR_ASSERTION'},'Post-manual verification must retain the original baseline and one backup total.');
  const rewriteBackup=(after,mutate)=>{const value=JSON.parse(after.files[path].bytes);mutate(value);const bytes=Buffer.from(JSON.stringify(value));after.files[path]={sha256:hash(bytes),bytes};};
  const corruptions=[...preservationTables.filter(name=>name!=='metadata').map(name=>[name,after=>after.tables[name].push({id:'extra_PRIVATE',value:secret})]),['pet-id',after=>after.tables.puppies[0].id='pet_OTHER'],['pet-name',after=>after.tables.puppies[0].name=secret+' changed'],['event-id',after=>after.tables.events[0].id='evt_OTHER'],['event-pet',after=>after.tables.events[0].pet_id='pet_OTHER'],['event-type',after=>after.tables.events[0].type='poop'],['event-note',after=>after.tables.events[0].note=secret+' changed'],['uid',after=>after.uid='10124'],['widget',after=>after.widgets.id='78'],['preference',after=>after.tables.settings[0].value='changed'],['other-metadata',after=>after.tables.metadata[1].value='pet_OTHER'],['added-metadata',after=>after.tables.metadata.push({key:'other',value:secret})],['wrong-version',after=>after.tables.metadata[0].value='1.12.9/1012009'],['backup-with-old-metadata',after=>after.tables.metadata[0].value=previous],['sql-only-without-version',after=>{after.tables.metadata[0].value=previous;delete after.files[path];}],['prefs-file',after=>after.files['shared_prefs/PRIVATE.xml'].sha256=hash('changed')],['photo',after=>after.files['files/puppy-photos/pet_PRIVATE.jpg'].sha256=hash('changed')],['missing-photo',after=>delete after.files['files/puppy-photos/pet_PRIVATE.jpg']],['missing-preference',after=>delete after.files['shared_prefs/PRIVATE.xml']],['changed-old-backup',after=>after.files['files/activity-backups/bkp_'+ 'c'.repeat(32)+'.json'].sha256=hash('changed')],['extra-file',after=>after.files['shared_prefs/extra.xml']={sha256:hash('extra')}],['missing-backup',after=>delete after.files[path]],['duplicate-backup',after=>after.files[extra]={...after.files[path]}],['bad-json-backup',after=>after.files[path]={sha256:hash(secret),bytes:Buffer.from(secret)}],...['format','version','reason','appVersion','petId','puppyName'].map(key=>['backup-'+key,after=>rewriteBackup(after,value=>value[key]=key==='version'?2:secret+' changed')]),['backup-note',after=>rewriteBackup(after,value=>value.events[0].note=secret+' changed')],['backup-id',after=>rewriteBackup(after,value=>value.events[0].id='evt_OTHER')],['backup-events',after=>rewriteBackup(after,value=>value.events=[])],['backup-extra-field',after=>rewriteBackup(after,value=>value.extra=secret)],['backup-invalid-time',after=>rewriteBackup(after,value=>value.createdAt=null)]];
  const reject=(after,version=target,label='wrong-target')=>{const originalBefore=JSON.stringify(before),originalAfter=JSON.stringify(after);let original,caught;const strict=(...args)=>{try{return equal(...args);}catch(error){original=error;throw error;}};try{beforeManualLaunch(before,after,version,strict,launched);}catch(error){caught=error;}assert.ok(caught,label);assert.equal(caught,original);assert.deepEqual(finiteFailure(caught,'bridge-before-launch-preservation'),{class:'assertion'});assert.equal(JSON.stringify(before),originalBefore);assert.equal(JSON.stringify(after),originalAfter);rejected++;};
  for(const [label,mutate] of corruptions){const after=copy(updated);mutate(after);reject(after,target,label);}reject(copy(updated),other);
  const command=commandFailure(new Error(secret),{status:29});let caught,called=false;try{beforeManualLaunch(before,updated,target,()=>{throw command;},()=>{called=true;});}catch(error){caught=error;}assert.equal(caught,command);assert.equal(called,false);assert.deepEqual(finiteFailure(caught),{class:'command-failed',status:29});
  let invoked=false;assert.throws(()=>beforeManualLaunch(before,before,'1.12.8/1012008',()=>{invoked=true;},()=>{invoked=true;}));assert.equal(invoked,false);
 }
 assert.equal(legitimate,4);assert.ok(rejected>80);console.log('PASS both real prelaunch oracle states, '+rejected+' corruption/wrong-target cases, original-baseline postlaunch backup checks and preserved non-assertion errors. No native inputs.');
}
function selfCheck(){
 beforeManualLaunchSelfCheck();
 preservationSelfCheck();
 for(const value of [undefined,'false'])assert.equal(permissionSelection(value),false);assert.equal(permissionSelection('true'),true);for(const value of ['',true,false,'TRUE','1','other'])assert.throws(()=>permissionSelection(value));
 const permissionAddition=`:000000 100644 ${'0'.repeat(40)} ${'c'.repeat(40)} A\0${permissionEvidencePath}\0`;assert.throws(()=>equivalentChanges(permissionAddition));assert.equal(equivalentChanges(permissionAddition,true).length,1);
 for(const raw of [permissionAddition.replace('100644','100755'),permissionAddition.replace(' A\0',' M\0'),permissionAddition.replace(permissionEvidencePath,'scripts/other.py'),permissionAddition+permissionAddition])assert.throws(()=>equivalentChanges(raw,true));
 const pairText=permission=>'Signer #1 in lineage certificate DN: A\ncertificate SHA-256 digest: a\n'+Object.entries({...caps,permission}).map(([name,value])=>'Has '+name+' capability: '+value).join('\n')+'\nSigner #2 in lineage certificate DN: B\ncertificate SHA-256 digest: b\nHas permission capability: true\n';
 permissionCapabilityPair(pairText(false),pairText(true),'a','b');for(const changed of [pairText(false),pairText(true).replace('shared UID capability: false','shared UID capability: true'),pairText(true).replace('DN: B','DN: OTHER'),pairText(true)+'extra',pairText(true).replace('Has permission capability: true','Has permission capability: true\nHas permission capability: true')])assert.throws(()=>permissionCapabilityPair(pairText(false),changed,'a','b'));
 for(const [name,value] of Object.entries(caps))if(name!=='permission')assert.throws(()=>permissionCapabilityPair(pairText(false),pairText(true).replace('Has '+name+' capability: '+value,'Has '+name+' capability: '+!value),'a','b'));
 const controlled=value=>commandFailure(new Error('PRIVATE'),{status:1},value),code={commandKind:'adb-install',installCode:'INSTALL_FAILED_DUPLICATE_PERMISSION'},ambiguous={commandKind:'adb-install',installCodeDecline:'ambiguous-content',installCodeAmbiguity:{firstPredicate:'code-token-count',successToken:false,codeTokens:'multiple',failureMarkers:'multiple',publicCodes:['INSTALL_FAILED_DUPLICATE_PERMISSION'],unknownCodeObserved:false}};
 assert.equal(permissionControl(controlled(code)).evidence,'unambiguous-observed-code');assert.equal(permissionControl(controlled(ambiguous)).evidence,'consistent-observed-set-only');assert.equal(permissionControl(controlled(ambiguous)).installCode,undefined);
 for(const value of [{...code,installCode:'INSTALL_FAILED_UPDATE_INCOMPATIBLE'},{...code,commandKind:'package-path'},{...ambiguous,installCodeAmbiguity:{...ambiguous.installCodeAmbiguity,successToken:true,firstPredicate:'success-token'}},{...ambiguous,installCodeAmbiguity:{...ambiguous.installCodeAmbiguity,unknownCodeObserved:true}},{...ambiguous,installCodeAmbiguity:{...ambiguous.installCodeAmbiguity,publicCodes:['INSTALL_FAILED_ABORTED','INSTALL_FAILED_DUPLICATE_PERMISSION']}},{}])assert.throws(()=>permissionControl(controlled(value)));
 for(const error of [undefined,new Error('PRIVATE'),commandFailure(new Error('PRIVATE'),{status:0},code),commandFailure(new Error('PRIVATE'),{status:1,error:{code:'ETIMEDOUT'}},code)])assert.throws(()=>permissionControl(error));
 const controlRoot='/private/SYNTHETIC',controlPath=join(controlRoot,'control6.apk'),controlArgs=['-s','emulator-5588','install','-r',controlPath],controlResult={status:1,stdout:'',stderr:'adb: failed to install '+controlPath+': Failure [INSTALL_FAILED_DUPLICATE_PERMISSION]\n'};
 assert.deepEqual(installCommandFailure('adb',controlArgs,controlResult,'permission-control-install',controlRoot),code);
 for(const args of [controlArgs.slice(0,-1).concat('/private/OTHER.apk'),controlArgs.concat('--extra'),controlArgs.filter(value=>value!=='-r')])assert.throws(()=>permissionControl(controlled(installCommandFailure('adb',args,controlResult,'permission-control-install',controlRoot))));
 installCodeSelfCheck();
 exerciseEvidenceSelfCheck();
 snapshotSiteSelfCheck();
 snapshotIoSiteSelfCheck();
 packageUidSelfCheck();
 emulatorSelfCheck();
 offlineSelfCheck();
 assertWidgetSource();
 validateDriver('d'.repeat(40),'d'.repeat(40));assert.throws(()=>validateDriver('d'.repeat(40),'e'.repeat(40)));assert.throws(()=>validateDriver('short','short'));
 const change=path=>`:100644 100644 ${'a'.repeat(40)} ${'b'.repeat(40)} M\0${path}\0`;
 assert.equal(equivalentChanges(toolingPaths.map(change).join('')).length,2);assert.deepEqual(equivalentChanges(''),[]);
 const addition=path=>`:000000 100644 ${'0'.repeat(40)} ${'c'.repeat(40)} A\0${path}\0`;assert.equal(equivalentChanges(toolingPaths.map(change).join('')+addition(nativeCommandPath)).length,3);assert.deepEqual(equivalentChanges(addition(nativeCommandPath)),[{path:nativeCommandPath,mode:'100644',sourceBlob:'0'.repeat(40),driverBlob:'c'.repeat(40),changeType:'A'}]);
 for(const path of ['App.tsx','package-lock.json','plugins/native.js','scripts/other.mjs',...toolingPaths])assert.throws(()=>equivalentChanges(addition(path)));
 for(const raw of [change(nativeCommandPath),addition(nativeCommandPath).replace('000000','100644'),addition(nativeCommandPath).replace('100644','100755'),addition(nativeCommandPath).replace('100644','120000'),addition(nativeCommandPath).replace(' A\0',' D\0'),addition(nativeCommandPath).replace('0'.repeat(40),'a'.repeat(40)),addition(nativeCommandPath).replace('c'.repeat(40),'0'.repeat(40)),addition(nativeCommandPath)+addition(nativeCommandPath)])assert.throws(()=>equivalentChanges(raw));

 for(const path of ['App.tsx','package-lock.json','plugins/native.js','server/auth.ts','.github/workflows/android-apk.yml'])assert.throws(()=>equivalentChanges(change(path)));
 for(const raw of [change(toolingPaths[0]).replace('100644','100755'),change(toolingPaths[0]).replace(' M\0',' D\0'),change(toolingPaths[0]).slice(0,-1)])assert.throws(()=>equivalentChanges(raw));
 const repo='example/qa',source='a'.repeat(40),run={id:1,repository:{full_name:repo},head_repository:{full_name:repo},head_sha:source,path:'.github/workflows/android-apk.yml',event:'workflow_dispatch',status:'completed',conclusion:'success'},jobs=[{name:'build',conclusion:'success'},{name:'publish',conclusion:'skipped'}];
 validateRun(run,jobs,repo,source,'1');for(const patch of [{head_sha:'b'.repeat(40)},{event:'push'},{repository:{full_name:'other/repo'}},{path:'different.yml'},{conclusion:'failure'}])assert.throws(()=>validateRun({...run,...patch},jobs,repo,source,'1'));
 assert.throws(()=>validateRun(run,[jobs[0],{name:'publish',conclusion:'success'}],repo,source,'1'));
 const artifact={id:2,name:'apk',expired:false,digest:'sha256:'+'c'.repeat(64),workflow_run:{id:1}};chooseArtifact([artifact],'apk',1);
 for(const items of [[],[artifact,artifact],[{...artifact,expired:true}],[{...artifact,digest:null}],[{...artifact,workflow_run:{id:9}}]])assert.throws(()=>chooseArtifact(items,'apk',1));
 const capabilityText='Signer #1 in lineage certificate DN: A\ncertificate SHA-256 digest: a\n'+Object.entries(caps).map(([n,v])=>'Has '+n+' capability: '+v).join('\n')+'\nSigner #2 in lineage certificate DN: B\ncertificate SHA-256 digest: b\n';inspectCapabilities(capabilityText,'a','b');for(const [name,value] of Object.entries(caps))assert.throws(()=>inspectCapabilities(capabilityText.replace(name+' capability: '+value,name+' capability: '+!value),'a','b'));
 const before={metadata:[{key:'backup_app_version',value:'old'},{key:'active_pet_id',value:'pet_qa'}],events:[{id:'evt_qa'}]};assert.deepEqual(expectedLaunch(before,'new'),{...before,metadata:[{key:'backup_app_version',value:'new'},before.metadata[1]]});assert.equal(before.metadata[0].value,'old');assert.throws(()=>assert.deepEqual(expectedLaunch(before,'new'),{...before,metadata:[...expectedLaunch(before,'new').metadata,{key:'unexpected',value:'changed'}]}));
 protectedFiles({'shared_prefs/x':{sha256:'x'}},{'shared_prefs/x':{sha256:'x'}},'new',[]);assert.throws(()=>protectedFiles({'shared_prefs/x':{sha256:'x'}},{'shared_prefs/x':{sha256:'y'}},'new',[]));
 const event={id:'evt_qa',pet_id:'pet_qa',type:'pee'},backup={format:'puptime-activity',version:1,createdAt:1,petId:'pet_qa',puppyName:'QA',reason:'before-update',appVersion:'new',events:[{id:'evt_qa',type:'pee'}]},backupFile=value=>({'files/activity-backups/bkp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.json':{bytes:Buffer.from(JSON.stringify(value))}});
 protectedFiles({},backupFile(backup),'new',[event],row=>({type:row.type}),'QA',1);
 for(const patch of [{reason:'daily'},{appVersion:'old'},{petId:'pet_other'},{puppyName:'Other'},{events:[{id:'evt_qa',type:'poop'}]},{extra:'forbidden'}])assert.throws(()=>protectedFiles({},backupFile({...backup,...patch}),'new',[event],row=>({type:row.type}),'QA',1));
 assert.throws(()=>protectedFiles({},{'files/SQLite/unexpected.db':{bytes:Buffer.from('{}')}},'new',[event]));
 const dump='\nWidgets:\n  [0] id=2\n    host=HostId{user:0, app:10001, hostId:1024, pkg:launcher}\n    provider=ProviderId{user:0, app:10002, cmp:ComponentInfo{'+app+'/'+app+'.widget.PuptimeQuickLog}}\n    views=random\nHosts:\n';assert.equal(widgetBinding(dump).id,'2');assert.throws(()=>widgetBinding(dump.replace(app+'/','other/')));assert.throws(()=>widgetBinding(dump.replace('    host=','    invalid=')));
 console.log('PASS signing QA source self-checks; no network, keys, signing or device operations.');
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
function offlineSelfCheck(){
 const empty='Active default network: none\n\nCurrent network preferences: \n\nCurrent Networks:\n\nStatus for known UIDs:\n',fixture={airplane:'1\n',wifiPreference:'0\n',wifiStatus:'Wifi is disabled\nWifi scanning is always available\n',connectivity:empty,mobilePreference:'1\n'};
 const good=offlineSnapshot(fixture);assert.ok(offlineReady(good));assert.equal(good.mobileDataPreference,'enabled','A saved preference is diagnostic, never connectivity proof.');
 for(const patch of [{airplane:'0'},{wifiPreference:'1'},{wifiStatus:'Wifi is enabled\n'},{wifiStatus:'unknown\n'},{connectivity:empty.replace('network: none','network: 100')},{connectivity:empty.replace('Current Networks:\n','Current Networks:\n  NetworkAgentInfo{cellular connected}\n')},{connectivity:empty.replace('Active default network: none','')},{connectivity:empty+'Active default network: none\n'},{connectivity:empty.replace('Status for known UIDs:','Unknown:')},{connectivity:empty+'Current Networks:\n'},{connectivity:'permission denied'}])assert.ok(!offlineReady(offlineSnapshot({...fixture,mobilePreference:'0',...patch})),'Saved preference0 cannot hide missing/ambiguous/live network evidence.');
 const responses={'settings get global airplane_mode_on':fixture.airplane,'settings get global wifi_on':fixture.wifiPreference,'cmd wifi status':fixture.wifiStatus,'dumpsys connectivity':empty,'settings get global mobile_data':'1'};let time=0,reads=0;const state={},calls=[],io={start:'42',inspect:()=>({alive:true,start:'42',executable:true,arguments:true,home:true,uid:true}),save:()=>{},now:()=>time,pause:()=>time+=1000,adb:args=>{calls.push(args.join(' '));return {status:0,stdout:responses[args.slice(1).join(' ')],stderr:''};}};
 assert.deepEqual(readOffline(io.adb),good);io.adb=args=>({status:0,stdout:args[1]==='dumpsys'&&reads++===0?empty.replace('network: none','network: 100'):responses[args.slice(1).join(' ')],stderr:''});emulatorOffline(io,state);assert.equal(state.offline,'verified');assert.equal(time,1000);
 time=0;io.adb=args=>({status:0,stdout:args[1]==='dumpsys'?empty.replace('Current Networks:\n','Current Networks:\n  nondefault active network\n'):responses[args.slice(1).join(' ')],stderr:''});assert.throws(()=>emulatorOffline(io,state));assert.equal(state.offline,'timeout');assert.equal(time,30000);
 for(const status of [1,null])assert.throws(()=>readOffline(()=>({status,stdout:'',stderr:'private failure'})));
 io.inspect=()=>null;assert.throws(()=>emulatorOffline(io,state));assert.ok(calls.every(value=>!value.includes(' root')&&!value.includes(' put ')));
 console.log('PASS actual offline production-parser/command/readiness stubs; saved mobile-data preference never substitutes for absent connectivity.');
}

function emulatorSelfCheck(){
 const base={alive:true,start:'42',executable:true,arguments:true,home:true,uid:true};
 const stub=()=>{let now=0,alive=true;const calls=[],state={},io={name:'Puptime_Signing_QA_123',start:'42',inspect:()=>({...base,alive}),save:()=>{},now:()=>now,pause:()=>now+=1000,signal:signal=>{calls.push(signal);alive=false;},adb:args=>{calls.push(args.join(' '));return {status:0,stdout:args[0]==='root'?'restarting adbd as root\n':args[0]==='emu'?'Puptime_Signing_QA_123\nOK\n':args[1]==='id'?'0\n':'1\n',stderr:''};}};return {io,state,calls,exit:()=>alive=false};};
 const closed={status:1,stdout:'',stderr:'adb: unable to connect for root: closed\n'};
 for(const outcome of [{status:0,stdout:'restarting adbd as root\n',stderr:''},{status:0,stdout:'adbd is already running as root\n',stderr:''},closed]){
  const t=stub(),adb=t.io.adb;let reads=0;t.io.adb=args=>args[0]==='root'?(t.calls.push('root'),outcome):args[1]==='id'&&reads++===0?{status:1,stdout:'',stderr:'closed'}:adb(args);emulatorRoot(t.io,t.state);assert.equal(t.state.rootReadback,'verified');assert.equal(t.calls.filter(c=>c==='root').length,1);
 }
 for(const outcome of [{status:1,stdout:'',stderr:'permission denied\n'},{status:0,stdout:'adbd cannot run as root in production builds\n',stderr:''},{status:null,stdout:'',stderr:''},{...closed,stderr:closed.stderr+'extra\n'}]){
  const t=stub(),adb=t.io.adb;t.io.adb=args=>args[0]==='root'?(t.calls.push('root'),outcome):adb(args);assert.throws(()=>emulatorRoot(t.io,t.state));assert.equal(t.state.rootRequest,'refused');assert.equal(t.calls.filter(c=>c==='root').length,1);
 }
 for(const fault of ['nonroot','wrong-avd','dead','pid-reuse','wrong-executable']){
  const t=stub(),adb=t.io.adb;let requested=false;t.io.adb=args=>{if(args[0]==='root'){t.calls.push('root');requested=true;return closed;}if(requested&&fault==='nonroot'&&args[1]==='id')return {status:0,stdout:'2000\n',stderr:''};if(requested&&fault==='wrong-avd'&&args[0]==='emu')return {status:0,stdout:'Foreign\nOK\n',stderr:''};return adb(args);};t.io.inspect=()=>({...base,...(requested?fault==='dead'?{alive:false}:fault==='pid-reuse'?{start:'99'}:fault==='wrong-executable'?{executable:false}:{}:{})});assert.throws(()=>emulatorRoot(t.io,t.state));assert.notEqual(t.state.rootReadback,'verified');assert.equal(t.calls.filter(c=>c==='root').length,1);
 }
 for(const field of ['start','executable','arguments','home','uid']){const t=stub();t.io.inspect=()=>({...base,[field]:field==='start'?'99':false});assert.equal(stopEmulator(t.io,t.state),false);assert.equal(t.state.cleanup,'ownership-refused');assert.deepEqual(t.calls,[]);}
 {const t=stub();t.exit();assert.equal(stopEmulator(t.io,t.state),true);assert.equal(t.state.cleanup,'already-exited');assert.deepEqual(t.calls,[]);}
 {const t=stub(),adb=t.io.adb;t.io.adb=args=>{const value=adb(args);if(args[1]==='kill')t.exit();return value;};assert.equal(stopEmulator(t.io,t.state),true);assert.equal(t.state.cleanup,'console-exit');assert.ok(!t.calls.includes('SIGTERM'));}
 for(const required of ['SIGTERM','SIGKILL']){const t=stub();t.io.adb=()=>closed;t.io.signal=signal=>{t.calls.push(signal);if(signal===required)t.exit();};assert.equal(stopEmulator(t.io,t.state),true);assert.equal(t.state.cleanup,required==='SIGTERM'?'term-exit':'kill-exit');assert.deepEqual(t.calls,required==='SIGTERM'?['SIGTERM']:['SIGTERM','SIGKILL']);}
 {const t=stub();t.io.adb=()=>closed;t.io.signal=signal=>t.calls.push(signal);assert.equal(stopEmulator(t.io,t.state),false);assert.equal(t.state.cleanup,'still-alive');assert.deepEqual(t.calls,['SIGTERM','SIGKILL']);}
 {const t=stub();let replaced=false;t.io.adb=()=>closed;t.io.signal=signal=>{t.calls.push(signal);replaced=true;};t.io.inspect=()=>({...base,start:replaced?'99':'42'});assert.equal(stopEmulator(t.io,t.state),false);assert.equal(t.state.cleanup,'ownership-refused');assert.deepEqual(t.calls,['SIGTERM']);}

 const stat='123 (qemu with spaces) S '+Array(18).fill('0').join(' ')+' 42 0',expected={executables:['/sdk/emulator/emulator','/sdk/emulator/qemu/linux-x86_64/qemu-system-x86_64','/sdk/emulator/qemu/linux-x86_64/qemu-system-x86_64-headless'],arguments:['-avd','Puptime_Signing_QA_123','-port','5588','-no-window','-no-audio','-no-snapshot','-gpu','swiftshader_indirect'],home:'/private/qa/avd',uid:'1001'};
 const files={stat,afterStat:stat,exe:expected.executables[0],cmdline:[expected.executables[0],...expected.arguments].join('\0')+'\0',environ:'UNRELATED=private-not-retained\0ANDROID_AVD_HOME='+expected.home+'\0',status:'Name:\tqemu\nUid:\t1001\t1001\t1001\t1001\n'};
 for(const exe of expected.executables)assert.ok(ownedProcess(processIdentity({...files,exe,cmdline:[exe,...expected.arguments].join('\0')+'\0'},expected),'42'),'Accept same-PID launcher→QEMU exec with unchanged tail args.');
 for(const patch of [{exe:'/foreign/qemu'},{afterStat:stat.replace(') S ',') Z ')},{cmdline:files.cmdline.replace('/sdk/emulator/emulator','/foreign/argv0')},{cmdline:files.cmdline.replace('QA_123','QA_999')},{cmdline:files.cmdline+'-extra\0'},{environ:'ANDROID_AVD_HOME=/foreign\0'},{environ:'OTHER_ANDROID_AVD_HOME='+expected.home+'\0'},{status:files.status.replaceAll('1001','1002')},{status:files.status.replace('1001\t1001','1001\t0')},{environ:files.environ+'ANDROID_AVD_HOME=/foreign\0'},{stat:stat.replace(' 42 ',' 99 '),afterStat:stat.replace(' 42 ',' 99 ')}])assert.ok(!ownedProcess(processIdentity({...files,...patch},expected),'42'));
 assert.throws(()=>processIdentity({...files,afterStat:stat.replace(' 42 ',' 99 ')},expected));
 {const t=stub();let reads=0;t.io.inspect=()=>({...base,executable:reads++>1});recordOwnedEmulator(t.io,t.state);assert.equal(t.state.liveness,'owned');assert.ok(t.io.now()<5000);}
 for(const fault of [{executable:false},{start:'99'},{alive:false}]){const t=stub();t.io.inspect=()=>({...base,...fault});assert.throws(()=>recordOwnedEmulator(t.io,t.state));assert.notEqual(t.state.liveness,'owned');assert.deepEqual(t.calls,[]);assert.ok(t.io.now()<=5000);}
 assert.deepEqual(safeHostState({liveness:'owned',argv:'PRIVATE',path:'PRIVATE',pid:123}),{liveness:'owned'});assert.throws(()=>safeHostState({liveness:'PRIVATE'}));
 assert.deepEqual(processStart('123 (qemu with spaces) S '+Array(18).fill('0').join(' ')+' 42 0'),{start:'42',alive:true});assert.equal(processStart('123 (qemu) Z '+Array(18).fill('0').join(' ')+' 42 0').alive,false);assert.throws(()=>processStart('invalid'));
 console.log('PASS bounded one-request root/readback, process ownership/PID reuse, and console/TERM/KILL cleanup stubs. No processes, adb or emulator invoked.');
}

// Host-only setup/cleanup. Root is requested once; a closed transport is not proof
// of success. AOSP documents adbd's restart: docs/dev/root.md in packages/modules/adb.
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
function emulatorHost(mode){
 assert.equal(process.env.GITHUB_ACTIONS,'true');assert.equal(process.env.RUNNER_OS,'Linux');validateDriver(process.env.PUPTIME_EXPECTED_DRIVER,process.env.GITHUB_SHA);process.umask(0o077);
 const {PUPTIME_SIGNING_PRIVATE:privatePath,RUNNER_TEMP,GITHUB_RUN_ID:run,GITHUB_RUN_ATTEMPT:attempt,ANDROID_HOME:sdk}=process.env;
 assert.match(run??'',/^[1-9]\d*$/);assert.match(attempt??'',/^[1-9]\d*$/);assert.ok(RUNNER_TEMP&&privatePath&&sdk);
 const folder=resolve(privatePath);assert.equal(folder,join(resolve(RUNNER_TEMP),'puptime-signing-'+run+'-'+attempt));assert.ok(!lstatSync(folder).isSymbolicLink());assert.equal(lstatSync(folder).mode&0o777,0o700);assert.equal(readFileSync(join(folder,'NOT-FOR-RELEASE'),'utf8'),process.env.PUPTIME_EXPECTED_SOURCE);
 try{
 const name='Puptime_Signing_QA_'+run,ownerFile=join(folder,'emulator-owner.json'),stateFile=join(folder,'emulator-host-state.json');
 const state=existsSync(stateFile)?JSON.parse(readFileSync(stateFile)): {liveness:'not-started',boot:'not-started',rootRequest:'not-issued',rootReadback:'not-attempted',cleanup:'not-attempted'};
 const save=value=>writeFileSync(stateFile,JSON.stringify(safeHostState(value)),{mode:0o600});
 const pidFile=join(folder,'emulator.pid');let owner=existsSync(ownerFile)?JSON.parse(readFileSync(ownerFile)):null;
 const pid=owner?.pid??(existsSync(pidFile)?Number(readFileSync(pidFile,'utf8').trim()):null);if(pid!==null)assert.ok(Number.isSafeInteger(pid)&&pid>1);
 const executables=[join(sdk,'emulator/emulator'),join(sdk,'emulator/qemu/linux-x86_64/qemu-system-x86_64'),join(sdk,'emulator/qemu/linux-x86_64/qemu-system-x86_64-headless')].filter(existsSync).map(path=>realpathSync(path));
 const inspect=()=>{
  if(pid===null)return null;
  try{
   const proc='/proc/'+pid,stat=processStart(readFileSync(join(proc,'stat'),'utf8'));if(!stat.alive)return stat;
   return processIdentity({stat:readFileSync(join(proc,'stat'),'utf8'),exe:readlinkSync(join(proc,'exe')),cmdline:readFileSync(join(proc,'cmdline'),'utf8'),environ:readFileSync(join(proc,'environ'),'utf8'),status:readFileSync(join(proc,'status'),'utf8'),afterStat:readFileSync(join(proc,'stat'),'utf8')},{executables,arguments:['-avd',name,'-port','5588','-no-window','-no-audio','-no-snapshot','-gpu','swiftshader_indirect'],home:join(folder,'avd'),uid:String(process.getuid())});
  }catch(error){if(error.code==='ENOENT'||error.code==='ESRCH')return null;throw error;}
 };
 // Read-only use of the same exact PID/start/SDK executable/args/home/UID guard.
 if(mode==='--emulator-owned')return !!owner&&ownedProcess(inspect(),owner.start);
 const io={name,start:owner?.start,inspect,save,now:Date.now,pause:()=>Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,1000),signal:signal=>{try{process.kill(pid,signal);}catch(error){if(error.code!=='ESRCH')throw error;}},adb:(args,timeout=3000)=>{const value=spawnSync(join(sdk,'platform-tools/adb'),['-s','emulator-5588',...args],{encoding:'utf8',timeout,maxBuffer:256*1024,stdio:['ignore','pipe','pipe']});return {status:value.status,stdout:value.stdout??'',stderr:value.stderr??''};}};
 if(mode==='--emulator-record'){
  assert.equal(owner,null);assert.ok(pid);const value=processStart(readFileSync('/proc/'+pid+'/stat','utf8'));assert.ok(value.alive);owner={pid,start:value.start};writeFileSync(ownerFile,JSON.stringify(owner),{flag:'wx',mode:0o600});io.start=value.start;recordOwnedEmulator(io,state);
 }else if(mode==='--emulator-root'||mode==='--emulator-offline'){
  assert.ok(owner);try{if(mode==='--emulator-root')emulatorRoot(io,state);else emulatorOffline(io,state);}catch(error){state.setup='failed';save(state);throw error;}
 }else{
  let stopped=false;
  try{stopped=stopEmulator(io,state);}finally{
   if(stopped){rmSync(folder,{recursive:true});state.privateMaterialRemoved=true;}else state.privateMaterialRemoved=false;
   const receiptPath=resolve('build/android-signing-safe/verification.json');
   if(existsSync(receiptPath)){const receipt=JSON.parse(readFileSync(receiptPath));receipt.emulatorHost=safeHostState(state);writeFileSync(receiptPath,JSON.stringify(receipt,null,2),{mode:0o600});}
  }
  assert.ok(stopped,'Owned emulator exit could not be confirmed; cleanup is incomplete.');
 }
 console.log('PASS host-only '+mode.slice(2)+'; no keys or app operations.');
 }catch(error){if(existsSync(folder))writeFileSync(join(folder,'emulator-host-failure.txt'),String(error.stack),{mode:0o600});throw error;}
}

const [mode]=process.argv.slice(2);if(['--emulator-record','--emulator-root','--emulator-offline','--emulator-cleanup'].includes(mode)){try{emulatorHost(mode);process.exit(0);}catch{console.error('FAIL host-only '+mode.slice(2)+'; raw process/error evidence remains private.');process.exit(1);}}
const permissionExperimentSelected=['--self-check','--preflight','--exercise'].includes(mode)?permissionSelection(process.env.PUPTIME_PERMISSION_EXPERIMENT):false;if(mode==='--self-check'){selfCheck();if(permissionExperimentSelected)execFileSync('python3',[permissionEvidencePath,'--self-check'],{timeout:15000,maxBuffer:65536,stdio:['ignore','pipe','pipe']});process.exit(0);}
const exerciseReceipt=resolve('build/android-signing-safe/verification.json');let exercisePrivateRoot;
const exerciseEvidence=mode==='--exercise'?exerciseRecorder(value=>{mkdirSync(resolve(exerciseReceipt,'..'),{recursive:true,mode:0o700});const prior=existsSync(exerciseReceipt)?JSON.parse(readFileSync(exerciseReceipt)):{};writeFileSync(exerciseReceipt,JSON.stringify({...prior,...(value.failure?{status:'exercise-failed'}:{}),scope:'Guest-only API36 exercise stage evidence; no credential or Play acceptance. Started/completed markers do not establish later signing/data success.',exercise:value},null,2),{mode:0o600});}):null;
try{
exerciseEvidence?.begin('exercise-preconditions');
assert.ok(['--preflight','--exercise'].includes(mode));assert.equal(process.env.GITHUB_ACTIONS,'true');assert.equal(process.env.RUNNER_OS,'Linux');process.umask(0o077);
const root=resolve(process.env.PUPTIME_SIGNING_PRIVATE??'');assert.ok(process.env.RUNNER_TEMP&&root.startsWith(resolve(process.env.RUNNER_TEMP)+'/puptime-signing-'));
const source=process.env.PUPTIME_EXPECTED_SOURCE,driverSource=process.env.PUPTIME_EXPECTED_DRIVER;assert.match(source??'',/^[a-f0-9]{40}$/);validateDriver(driverSource,process.env.GITHUB_SHA);assertWidgetSource();
const repo=process.env.GITHUB_REPOSITORY;assert.equal(repo,'patrickchin/puptime');
function command(binary,args,{ok=[0],binaryOutput=false,timeout=120000,maxBuffer=256*1024*1024}={}){
 const result=spawnSync(binary,args,{encoding:binaryOutput?undefined:'utf8',timeout,maxBuffer,stdio:['ignore','pipe','pipe']});
 if(!ok.includes(result.status)){
  if(existsSync(root))writeFileSync(join(root,'last-command-failure.txt'),String(result.stdout??'').slice(0,32768)+'\n'+String(result.stderr??'').slice(0,32768),{mode:0o600});
  const details=installCommandFailure(binary,args,result,exerciseEvidence?.phase(),root);
  throw commandFailure(new Error(binary+' failed (exit '+result.status+'); private command/driver evidence was not uploaded.'),result,details);
 }
 return binaryOutput?result.stdout:String(result.stdout??'')+(result.status?String(result.stderr??''):'');
}
assert.equal(command('git',['rev-parse','HEAD']).trim(),driverSource);
assert.equal(command('git',['status','--porcelain','--untracked-files=no']).trim(),'','Require an unchanged tracked checkout.');
if(spawnSync('git',['cat-file','-e',source+'^{commit}'],{stdio:'ignore',timeout:30000}).status!==0)command('git',['fetch','--no-tags','--depth=1','origin',source]);
const sourceEquivalence={source,driverSource,sourceTree:command('git',['rev-parse',source+'^{tree}']).trim(),driverTree:command('git',['rev-parse',driverSource+'^{tree}']).trim(),changes:equivalentChanges(command('git',['diff-tree','--no-commit-id','--raw','--no-abbrev','--no-renames','-r','-z',source,driverSource]),permissionExperimentSelected),allOtherBlobsAndModesEqual:true};
const output=resolve('build/android-signing-safe');
const api=path=>JSON.parse(command('gh',['api',`repos/${repo}/${path}`]));
async function download(url,path,digest,token=false){
 let response=await fetch(url,{redirect:'manual',headers:token?{Authorization:'Bearer '+process.env.GH_TOKEN}:{},signal:AbortSignal.timeout(120000)});
 if(response.status===302){const target=new URL(response.headers.get('location'));assert.equal(target.protocol,'https:');assert.ok(['.blob.core.windows.net','.githubusercontent.com','.actions.githubusercontent.com'].some(suffix=>target.hostname.endsWith(suffix)));response=await fetch(target,{signal:AbortSignal.timeout(120000)});}
 assert.equal(response.status,200);let size=0;const sum=createHash('sha256');
 await pipeline(Readable.fromWeb(response.body),new Transform({transform(chunk,_encoding,callback){size+=chunk.length;if(size>220*1024*1024)return callback(new Error('Oversized QA input'));sum.update(chunk);callback(null,chunk);}}),createWriteStream(path,{flags:'wx',mode:0o600}));
 assert.equal(sum.digest('hex'),digest);return size;
}
function zipEntry(zip,name,path){const fd=openSync(path,'wx',0o600);try{execFileSync('unzip',['-p',zip,name],{timeout:120000,stdio:['ignore',fd,'pipe']});}finally{closeSync(fd);}return path;}
const marker=join(root,'NOT-FOR-RELEASE');
const permissionEvidence=mode=>JSON.parse(command('python3',[permissionEvidencePath,mode,root],{maxBuffer:65536}));
function assertPermissionInputs(){assert.equal(source,permissionSource);assert.deepEqual([process.env.PUPTIME_BRIDGE_RUN,process.env.PUPTIME_LATER_RUN],permissionRuns);assert.equal(hash(command('git',['show',source+':.github/workflows/android-apk.yml'],{binaryOutput:true})),'94966e86d0a01b1099c33271a7c00d81a30d9e3f8c6385a305a09d33baa4c7fe');}
if(mode==='--preflight'){
 assert.ok(!existsSync(root),'Fresh private directory required.');mkdirSync(root,{mode:0o700});writeFileSync(marker,source);
 const ids=[process.env.PUPTIME_BRIDGE_RUN,process.env.PUPTIME_LATER_RUN];assert.ok(ids.every(id=>/^[1-9]\d+$/.test(id??'')));assert.notEqual(...ids);
 const inputs={source,driverSource,sourceEquivalence,baselineSHA:oldSHA,artifacts:[]};
 if(permissionExperimentSelected)assertPermissionInputs();
 for(const [index,id] of ids.entries()){
  const run=api('actions/runs/'+id),jobs=api('actions/runs/'+id+'/jobs?per_page=100');assert.equal(jobs.total_count,jobs.jobs.length);validateRun(run,jobs.jobs,repo,source,id);
  const list=api('actions/runs/'+id+'/artifacts?per_page=100');assert.equal(list.total_count,list.artifacts.length);
  const folder=join(root,index?'later':'bridge');mkdirSync(folder,{mode:0o700});
  for(const name of ['puptime-android-apk','puptime-android-qualification']){
   const artifact=chooseArtifact(list.artifacts,name,id),zip=join(folder,name+'.zip');await download(`https://api.github.com/repos/${repo}/actions/artifacts/${artifact.id}/zip`,zip,artifact.digest.slice(7),true);
   if(name==='puptime-android-apk')zipEntry(zip,'app-release.apk',join(folder,'input.apk'));
   else {if(permissionExperimentSelected)assert.equal(artifact.digest,'sha256:'+permissionQualificationDigests[index]);for(const file of ['BUILD-INFO.json','SHA256SUMS.txt',...(permissionExperimentSelected?['APK-MANIFEST.xml']:[])])zipEntry(zip,file,join(folder,file));}
  }
  const info=JSON.parse(readFileSync(join(folder,'BUILD-INFO.json')));assert.deepEqual(Object.keys(info).sort(),['configuredPackage','configuredVersion','configuredVersionCode','runId','sourceCommit'].sort());assert.equal(info.sourceCommit,source);assert.equal(String(info.runId),id);assert.equal(info.configuredPackage,app);assert.equal(info.configuredVersion,'1.12.'+(index+6));assert.equal(info.configuredVersionCode,1012006+index);
  const digest=readFileSync(join(folder,'SHA256SUMS.txt'),'utf8').match(/^([a-f0-9]{64})\s+app-release\.apk$/m)?.[1];assert.ok(digest);assert.equal(await fileHash(join(folder,'input.apk')),digest);
  inputs.artifacts.push({run:Number(id),...info,sha256:digest});
 }
 await download(`https://github.com/${repo}/releases/download/v1.12.5/Puptime-1.12.5.apk`,join(root,'original125.apk'),oldSHA);
 if(permissionExperimentSelected){
  const home=realpathSync(process.env.ANDROID_HOME),folder=join(home,'cmdline-tools'),analyzers=[...new Set(readdirSync(folder).map(name=>join(folder,name,'bin/apkanalyzer')).filter(existsSync).map(path=>realpathSync(path)))];assert.equal(analyzers.length,1,'Require one installed SDK apkanalyzer; do not guess a tool version.');const analyzer=realpathSync(analyzers[0]);assert.ok(analyzer.startsWith(folder+'/')&&lstatSync(analyzer).isFile());
  writeFileSync(join(root,'original125-manifest.xml'),command(analyzer,['manifest','print',join(root,'original125.apk')],{binaryOutput:true,maxBuffer:65536}),{flag:'wx',mode:0o600});
  inputs.permissionInventory=permissionEvidence('--inventory');inputs.originalManifestToolSHA256=await fileHash(analyzer);
 }
 inputs.permissionExperimentSelected=permissionExperimentSelected;
 writeFileSync(join(root,'inputs.json'),JSON.stringify(inputs,null,2));mkdirSync(output,{recursive:true,mode:0o700});writeFileSync(join(output,'verification.json'),JSON.stringify({status:'preflight-passed',source,driverSource,sourceEquivalence,artifacts:inputs.artifacts,phases:[],...(permissionExperimentSelected?{permissionExperiment:{inventory:inputs.permissionInventory,originalManifestToolSHA256:inputs.originalManifestToolSHA256}}:{}),scope:'Pinned equivalent driver/app inputs only; no keys or Android runtime.'},null,2));console.log('PASS pinned driver/input tree equivalence, artifact-only runs, ZIP/APK digests and exact source/version metadata. No signing or Android runtime.');process.exit(0);
}
assert.equal(readFileSync(marker,'utf8'),source);assert.equal(lstatSync(root).mode&0o777,0o700);exercisePrivateRoot=root;
const inputs=JSON.parse(readFileSync(join(root,'inputs.json')));assert.equal(inputs.source,source);assert.equal(inputs.driverSource,driverSource);assert.deepEqual(inputs.sourceEquivalence,sourceEquivalence);assert.equal(await fileHash(join(root,'original125.apk')),oldSHA);
assert.equal(inputs.permissionExperimentSelected,permissionExperimentSelected);
const permissionExperiment=permissionExperimentSelected?{inventory:inputs.permissionInventory,originalManifestToolSHA256:inputs.originalManifestToolSHA256}:undefined;
if(permissionExperimentSelected){exerciseEvidence.begin('permission-inventory-recheck');assertPermissionInputs();assert.deepEqual(permissionEvidence('--inventory'),inputs.permissionInventory);exerciseEvidence.end('permission-inventory-recheck');}
function persistPermission(){const prior=JSON.parse(readFileSync(join(output,'verification.json')));writeFileSync(join(output,'verification.json'),JSON.stringify({...prior,permissionExperiment},null,2),{mode:0o600});exerciseEvidence.persist();}
for(const [i,name] of ['bridge','later'].entries())assert.equal(await fileHash(join(root,name,'input.apk')),inputs.artifacts[i].sha256);
const device='emulator-5588',adb=(...args)=>command('adb',['-s',device,...args]);assert.equal(adb('emu','avd','name').trim().split(/\r?\n/)[0],'Puptime_Signing_QA_'+process.env.GITHUB_RUN_ID);assert.equal(adb('shell','getprop','ro.build.version.sdk').trim(),'36');
assert.equal(adb('shell','settings','get','global','airplane_mode_on').trim(),'1');assert.equal(adb('shell','id','-u').trim(),'0');assert.equal(command('adb',['-s',device,'shell','pm','path',app],{ok:[1]}),'','The task emulator must not contain any pre-existing Puptime installation.');
assert.equal(adb('shell','settings','get','global','wifi_on').trim(),'0');
// Saved mobile_data may target a different/no subscription. Require actual network absence.
const offline=readOffline((args,timeout)=>({status:0,stdout:command('adb',['-s',device,...args],{timeout})}));writeFileSync(join(root,'emulator-host-state.json'),JSON.stringify(safeHostState({...JSON.parse(readFileSync(join(root,'emulator-host-state.json'))),...offline,offlinePreKey:offlineReady(offline)})),{mode:0o600});assert.ok(offlineReady(offline),'Pre-key actual offline readback failed.');
exerciseEvidence.end('exercise-preconditions');
const tools=join(process.env.ANDROID_HOME,'build-tools/36.0.0'),signer=join(tools,'apksigner'),aapt=join(tools,'aapt2');
function artifact(path,code,cert){const verified=command(signer,['verify','--verbose','--print-certs',path]);assert.ok(verified.includes('certificate SHA-256 digest: '+cert));const manifest=command(aapt,['dump','badging',path]).split('\n').slice(0,3);assert.ok(manifest[0].includes(`name='${app}' versionCode='${code}'`));assert.equal(manifest[1],"minSdkVersion:'24'");assert.equal(manifest[2],"targetSdkVersion:'36'");}
exerciseEvidence.begin('original-artifact-validation');artifact(join(root,'original125.apk'),1012005,oldCert);exerciseEvidence.end('original-artifact-validation');for(const [i,name] of ['bridge','later'].entries()){const stage=i?'later-input-validation':'bridge-input-validation';exerciseEvidence.begin(stage);artifact(join(root,name,'input.apk'),1012006+i,oldCert);exerciseEvidence.end(stage);}
exerciseEvidence.begin('public-template-validation');const template=command('tar',['-xOf','node_modules/expo/template.tgz','package/android/app/debug.keystore'],{binaryOutput:true});assert.equal(hash(template),keySHA);exerciseEvidence.end('public-template-validation');
exerciseEvidence.begin('qa-key-creation');writeFileSync(join(root,'public-A.keystore'),template);writeFileSync(join(root,'A-password'),'android\n');writeFileSync(join(root,'B-password'),randomBytes(32).toString('hex')+'\n');
command('keytool',['-genkeypair','-alias','qa-only','-keystore',join(root,'QA-only-B.p12'),'-storetype','PKCS12','-storepass:file',join(root,'B-password'),'-keyalg','RSA','-keysize','3072','-validity','2','-dname','CN=Puptime QA NOT FOR RELEASE','-noprompt']);exerciseEvidence.end('qa-key-creation');
exerciseEvidence.begin('qa-certificate-readback');const b=hash(command('keytool',['-exportcert','-alias','qa-only','-keystore',join(root,'QA-only-B.p12'),'-storepass:file',join(root,'B-password')],{binaryOutput:true}));exerciseEvidence.end('qa-certificate-readback');
const key=(name,alias)=>['--ks',join(root,name==='A'?'public-A.keystore':'QA-only-B.p12'),'--ks-pass','file:'+join(root,name+'-password'),'--ks-key-alias',alias];
const A=key('A','androiddebugkey'),B=key('B','qa-only'),lineage=join(root,'QA-only.lineage');
exerciseEvidence.begin('lineage-creation');command(signer,['rotate','--out',lineage,'--old-signer',...A,...Object.entries(caps).flatMap(([name,value])=>['--set-'+({'installed data':'installed-data','shared UID':'shared-uid'}[name]??name),String(value)]),'--new-signer',...B]);exerciseEvidence.end('lineage-creation');
exerciseEvidence.begin('lineage-inspection');inspectCapabilities(command(signer,['lineage','--in',lineage,'--print-certs','-v']),oldCert,b);exerciseEvidence.end('lineage-inspection');
let signingLineage=lineage;
if(permissionExperimentSelected){
 signingLineage=join(root,'QA-only-permission.lineage');exerciseEvidence.begin('permission-lineage-creation');command(signer,['rotate','--out',signingLineage,'--old-signer',...A,...Object.entries({...caps,permission:true}).flatMap(([name,value])=>['--set-'+({'installed data':'installed-data','shared UID':'shared-uid'}[name]??name),String(value)]),'--new-signer',...B]);exerciseEvidence.end('permission-lineage-creation');
 exerciseEvidence.begin('permission-lineage-inspection');permissionCapabilityPair(command(signer,['lineage','--in',lineage,'--print-certs','-v']),command(signer,['lineage','--in',signingLineage,'--print-certs','-v']),oldCert,b);exerciseEvidence.end('permission-lineage-inspection');
}
for(const [name,input,keys] of [['plain6','bridge',B],['bridge6','bridge',[...A,'--next-signer',...B,'--lineage',signingLineage,'--rotation-min-sdk-version','33']],['plain7','later',B],...(permissionExperimentSelected?[['control6','bridge',[...A,'--next-signer',...B,'--lineage',lineage,'--rotation-min-sdk-version','33']]]:[])]){
 const target=join(root,name+'.apk');exerciseEvidence.begin(name+'-sign');command(signer,['sign',...keys,'--out',target,join(root,input,'input.apk')]);exerciseEvidence.end(name+'-sign');exerciseEvidence.begin(name+'-verify');artifact(target,name==='plain7'?1012007:1012006,b);
 assert.deepEqual(command('unzip',['-p',target,'AndroidManifest.xml'],{binaryOutput:true}),command('unzip',['-p',join(root,input,'input.apk'),'AndroidManifest.xml'],{binaryOutput:true}));exerciseEvidence.end(name+'-verify');
}
exerciseEvidence.begin('bridge-lineage-inspection');inspectCapabilities(command(signer,['lineage','--in',join(root,'bridge6.apk'),'--print-certs','-v']),oldCert,b,permissionExperimentSelected?{...caps,permission:true}:caps);exerciseEvidence.end('bridge-lineage-inspection');
if(permissionExperimentSelected){exerciseEvidence.begin('control6-lineage-inspection');permissionCapabilityPair(command(signer,['lineage','--in',join(root,'control6.apk'),'--print-certs','-v']),command(signer,['lineage','--in',join(root,'bridge6.apk'),'--print-certs','-v']),oldCert,b);exerciseEvidence.end('control6-lineage-inspection');}
for(const name of ['plain6','plain7']){exerciseEvidence.begin(name+'-lineage-absence');assert.match(command(signer,['lineage','--in',join(root,name+'.apk'),'--print-certs'],{ok:[1]}),/does not contain a valid lineage/);exerciseEvidence.end(name+'-lineage-absence');}
exerciseEvidence.begin('bridge-v31-validation');const bridgeVerification=command(signer,['verify','--verbose','--print-certs','--min-sdk-version','33','--max-sdk-version','36',join(root,'bridge6.apk')]);assert.ok(bridgeVerification.includes('Verified using v3.1 scheme (APK Signature Scheme v3.1): true'));exerciseEvidence.end('bridge-v31-validation');
if(permissionExperimentSelected){
 exerciseEvidence.begin('control6-v31-validation');const controlVerification=command(signer,['verify','--verbose','--print-certs','--min-sdk-version','33','--max-sdk-version','36',join(root,'control6.apk')]);assert.ok(controlVerification.includes('Verified using v3.1 scheme (APK Signature Scheme v3.1): true'));exerciseEvidence.end('control6-v31-validation');
 exerciseEvidence.begin('permission-payload-equality');permissionExperiment.payload=permissionEvidence('--payload');permissionExperiment.capabilities={control:{...caps},experiment:{...caps,permission:true}};persistPermission();exerciseEvidence.end('permission-payload-equality');
}

exerciseEvidence.begin('native-evidence-imports');const {nativeSnapshot,assertNativeTransition}=await import('./native-account-evidence.mjs');
const {eventDataFromSql}=await import('../src/record-sql.ts');exerciseEvidence.end('native-evidence-imports');
const phases=[];function pass(phase,state){phases.push({phase,protectedStateSHA256:hash(JSON.stringify(state))});writeFileSync(join(output,'verification.json'),JSON.stringify({status:'in-progress',source,driverSource,sourceEquivalence,artifacts:inputs.artifacts,phases,...(permissionExperimentSelected?{permissionExperiment}:{}),scope:'Guest-only API36 x86; no credential or Play acceptance.'},null,2));exerciseEvidence.persist();console.log('PASS signing QA phase: '+phase);}
function flow(name,steps){
 const path=join(root,name+'.yaml');writeFileSync(path,`appId: ${app}\n---\n${steps}\n`);
 try{command('maestro',['--device',device,'test',path,'--test-output-dir',join(root,name+'-driver')],{timeout:240000});}
 catch(error){
  try{exerciseEvidence.flowFailure(name,join(root,name+'-driver'));}catch{}
  guestFailureImage(name,exerciseEvidence.phase(),{owned:()=>emulatorHost('--emulator-owned'),capture:()=>command('adb',['-s','emulator-5588','exec-out','screencap','-p'],{binaryOutput:true,timeout:5000}),save:bytes=>writeFileSync(resolve('build/android-signing-safe/guest-seed-failure.png'),bytes,{mode:0o600})});
  throw error;
 }
}
const tap=id=>`- tapOn: {id: ${id}}\n`,scroll=id=>`- scrollUntilVisible:\n    element: {id: ${id}}\n    direction: DOWN\n    visibilityPercentage: 100\n    centerElement: true\n`;
const settings=tap('nav.open')+'- assertVisible: {id: nav.close}\n'+scroll('nav.settings')+tap('nav.settings')+'- assertVisible: {id: screen.settings}\n';
function launch(){adb('shell','am','start','-W','-n',app+'/.MainActivity');}
async function install(path,replace=false){assert.match(adb('install',...(replace?['-r']:[]),path),/Success/);const installed=adb('shell','pm','path',app).trim();assert.match(installed,/^package:\/data\/app\/[^\n]+\/base\.apk$/);assert.equal(hash(command('adb',['-s',device,'exec-out','cat',installed.slice(8)],{binaryOutput:true})),await fileHash(path),'Installed APK must be the exact input.');} 
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
 const db=new DatabaseSync(join(dest,'files/SQLite/puptime-v2.db'),{readOnly:true});db.exec('BEGIN');let tables;try{exerciseEvidence.snapshotSite('sqlite-integrity');assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');exerciseEvidence.snapshotSite('sqlite-foreign-keys');assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);exerciseEvidence.snapshotSite('table-inventory');tables=nativeSnapshot(db);}finally{db.exec('ROLLBACK');db.close();}
 const packageInfo=adb('shell','cmd','package','list','packages','-U','--user','0',app);exerciseEvidence.snapshotSite('package-uid');const uid=packageUid(packageInfo);
 const widgets=widgetBinding(adb('shell','dumpsys','appwidget'),site=>exerciseEvidence.snapshotSite(site));
 exerciseEvidence.end('snapshot-'+label);return {tables,files,uid,widgets};
}
const equal=preservationEquality(assertNativeTransition,eventDataFromSql);
const launched=preservationLaunched(assertNativeTransition,eventDataFromSql);
async function waitWidgetCount(count){const deadline=Date.now()+10000;do{const value=adb('shell',`sqlite3 -readonly /data/user/0/${app}/files/SQLite/puptime-v2.db "SELECT COUNT(*) FROM events WHERE source='widget';"`).trim();if(value===String(count)){await new Promise(done=>setTimeout(done,500));return;}await new Promise(done=>setTimeout(done,200));}while(Date.now()<deadline);throw new Error('Widget did not commit exactly once within the bounded wait.');}
function rejectUpdate(path,before,label){const prefix=label==='plain-B-rejected'?'plain-B':'higher-A';exerciseEvidence.begin(prefix+'-reject');const result=command('adb',['-s',device,'install','-r',path],{ok:[1]});assert.match(result,/INSTALL_FAILED_UPDATE_INCOMPATIBLE/);exerciseEvidence.end(prefix+'-reject');exerciseEvidence.begin(prefix+'-preservation');equal(before,snapshot(label));pass(label,before);exerciseEvidence.end(prefix+'-preservation');}
function permissionOwner(label){
 const stage='permission-owner-'+label;exerciseEvidence.begin(stage);
 writeFileSync(join(root,stage+'.txt'),command('adb',['-s',device,'shell','cmd','package','list','permissions','-f'],{binaryOutput:true,maxBuffer:2*1024*1024}),{flag:'wx',mode:0o600});
 const value=permissionEvidence('--owner-'+label);assert.equal(value.ownerObserved,true);assert.equal(value.expectedAppOwnsPermission,true);assert.equal(value.signatureOnly,true);exerciseEvidence.end(stage);return value;
}
exerciseEvidence.begin('original-install');await install(join(root,'original125.apk'));exerciseEvidence.end('original-install');
if(permissionExperimentSelected){permissionExperiment.originalOwner=permissionOwner('original');persistPermission();}
exerciseEvidence.begin('original-launch');launch();exerciseEvidence.end('original-launch');
exerciseEvidence.begin('guest-seed');flow('old-ui-seed',`- runFlow: ${JSON.stringify(resolve('.maestro/helpers/skip-onboarding.yaml'))}\n- assertVisible: {id: screen.today}\n- repeat:\n    times: 4\n    commands:\n      - tapOn: {id: quick.pee}\n      - tapOn: {id: quick.poop}\n      - tapOn: {id: quick.meal}\n- tapOn: {id: event.meal.edit, index: 0}\n${scroll('editor.note.input')+tap('editor.note.input')}- inputText: Signing QA note\n- pressKey: Back\n- scrollUntilVisible:\n    element: {id: editor.close}\n    direction: UP\n${tap('editor.close')+settings}${tap('settings.widget.open')+scroll('settings.widget.action.walk')+tap('settings.widget.action.walk')+tap('settings.widget.close')+tap('settings.theme.open')+tap('appearance.theme.dark')+tap('settings.language.open')+tap('appearance.language.es')}- stopApp\n`);exerciseEvidence.end('guest-seed');
exerciseEvidence.begin('reminder-preference-seed');launch();
flow('old-reminder-lead','- extendedWaitUntil:\n    visible: {id: screen.today}\n    timeout: 90000\n'+settings+scroll('settings.notifications.open')+tap('settings.notifications.open')+scroll('settings.notifications.lead.15')+tap('settings.notifications.lead.15')+'- pressKey: Home\n');exerciseEvidence.end('reminder-preference-seed');
exerciseEvidence.begin('widget-binding');flow('bind-real-launcher-widget',`- longPressOn:\n    id: '.*:id/workspace'\n- tapOn: '^Widgets$'\n- scrollUntilVisible:\n    element: {text: '^Puptime$'}\n    direction: DOWN\n- tapOn: '^Puptime$'\n- scrollUntilVisible:\n    element: {text: '^Puptime Quick Log$'}\n    direction: DOWN\n    visibilityPercentage: 100\n    centerElement: true\n- tapOn: '^Puptime Quick Log$'\n- tapOn: '^Add$'\n- extendedWaitUntil:\n    visible: '^Log pee, last logged .+$'\n    timeout: 30000\n- tapOn: '^Log pee, last logged .+$'\n`);exerciseEvidence.end('widget-binding');
exerciseEvidence.begin('widget-first-save');await waitWidgetCount(1);exerciseEvidence.end('widget-first-save');const before=snapshot('old-created');exerciseEvidence.begin('original-state-validation');assert.equal(before.tables.events.length,13);assert.ok(before.tables.events.some(row=>row.note==='Signing QA note'));assert.equal(before.tables.events.filter(row=>row.source==='widget').length,1);assert.deepEqual(before.tables.local_sync_owner,[]);assert.deepEqual(before.tables.local_sync_outbox,[]);
assert.equal(before.tables.metadata.find(row=>row.key==='backup_app_version')?.value,'1.12.5/1012005');const prefs=Object.fromEntries(before.tables.settings.map(row=>[row.key,row.value]));assert.equal(prefs['puptime.theme.v1'],'dark');assert.equal(prefs['puptime.language.v1'],'es');assert.ok(JSON.parse(prefs['puptime.widgetActions.v1']).includes('walk'));assert.equal(JSON.parse(prefs['puptime.notificationPreferences.v1']).reminderLeadMinutes,15);pass('original125-created-state',before);exerciseEvidence.end('original-state-validation');
rejectUpdate(join(root,'plain6.apk'),before,'plain-B-rejected');
if(permissionExperimentSelected){
 exerciseEvidence.begin('permission-control-install');let original;try{command('adb',['-s',device,'install','-r',join(root,'control6.apk')]);}catch(error){original=error;}try{permissionExperiment.control=permissionControl(original);}catch(error){throw original??error;}persistPermission();exerciseEvidence.end('permission-control-install');
 exerciseEvidence.begin('permission-control-preservation');equal(before,snapshot('permission-control-rejected'));
 const installed=adb('shell','pm','path',app).trim();assert.match(installed,/^package:\/data\/app\/[^\n]+\/base\.apk$/);assert.equal(hash(command('adb',['-s',device,'exec-out','cat',installed.slice(8)],{binaryOutput:true})),oldSHA);
 assert.deepEqual(permissionOwner('control'),permissionExperiment.originalOwner);Object.assign(permissionExperiment.control,{protectedStateUnchanged:true,installedOriginalUnchanged:true,ownerUnchanged:true});pass('permission-false-control-rejected',before);exerciseEvidence.end('permission-control-preservation');
}
exerciseEvidence.begin('bridge-install');await install(join(root,'bridge6.apk'),true);exerciseEvidence.end('bridge-install');exerciseEvidence.begin('bridge-before-launch-preservation');beforeManualLaunch(before,snapshot('bridge-before-launch'),'1.12.6/1012006',equal,launched);exerciseEvidence.end('bridge-before-launch-preservation');exerciseEvidence.begin('bridge-launch');launch();exerciseEvidence.end('bridge-launch');exerciseEvidence.begin('bridge-visible');flow('bridge-visible','- extendedWaitUntil:\n    visible: {id: screen.today}\n    timeout: 90000\n');exerciseEvidence.end('bridge-visible');const bridge=snapshot('bridge-launched');exerciseEvidence.begin('bridge-state-validation');launched(before,bridge,'1.12.6/1012006');exerciseEvidence.end('bridge-state-validation');
exerciseEvidence.begin('bridge-widget-save');launch();flow('bridge-cold','- extendedWaitUntil:\n    visible: {id: screen.today}\n    timeout: 90000\n- pressKey: Home\n- assertVisible: ^Log pee, last logged .+$\n- tapOn: ^Log pee, last logged .+$\n');await waitWidgetCount(2);exerciseEvidence.end('bridge-widget-save');const widget=snapshot('bridge-widget');
exerciseEvidence.begin('bridge-widget-validation');const added=widget.tables.events.filter(row=>!bridge.tables.events.some(old=>old.id===row.id));assert.equal(added.length,1);assert.equal(added[0].type,'pee');assert.equal(added[0].source,'widget');const revisions=widget.tables.local_revisions.slice(bridge.tables.local_revisions.length);assert.equal(revisions.length,1);assert.equal(revisions[0].local_id,added[0].id);assert.equal(revisions[0].kind,'event');assert.equal(revisions[0].sequence,Math.max(0,...bridge.tables.local_revisions.map(row=>row.sequence))+1);assert.equal(revisions[0].pet_id,added[0].pet_id);assert.equal(revisions[0].source,'local');assert.ok(Number.isSafeInteger(revisions[0].created_at)&&revisions[0].created_at>=added[0].at);assert.equal(revisions[0].before_data,null);assert.deepEqual(JSON.parse(revisions[0].after_data),eventDataFromSql(added[0]));
assertNativeTransition(bridge.tables,widget.tables,{events:[...bridge.tables.events,added[0]],local_revisions:[...bridge.tables.local_revisions,revisions[0]],sqlite_sequence:bridge.tables.sqlite_sequence.map(row=>row.name==='local_revisions'?{...row,seq:row.seq+1}:row)});assert.equal(widget.uid,bridge.uid);assert.deepEqual(widget.widgets,bridge.widgets);protectedFiles(bridge.files,widget.files,'1.12.6/1012006',bridge.tables.events,eventDataFromSql,bridge.tables.puppies[0].name);pass('bridge-and-existing-widget-save',widget);exerciseEvidence.end('bridge-widget-validation');
rejectUpdate(join(root,'later/input.apk'),widget,'higher-A-rollback-rejected');exerciseEvidence.begin('later-install');await install(join(root,'plain7.apk'),true);exerciseEvidence.end('later-install');exerciseEvidence.begin('later-before-launch-preservation');beforeManualLaunch(widget,snapshot('later-before-launch'),'1.12.7/1012007',equal,launched);exerciseEvidence.end('later-before-launch-preservation');exerciseEvidence.begin('later-launch');launch();exerciseEvidence.end('later-launch');exerciseEvidence.begin('later-visible');flow('later-visible','- extendedWaitUntil:\n    visible: {id: screen.today}\n    timeout: 90000\n');exerciseEvidence.end('later-visible');const later=snapshot('later-launched');exerciseEvidence.begin('later-state-validation');launched(widget,later,'1.12.7/1012007');exerciseEvidence.end('later-state-validation');exerciseEvidence.begin('later-cold-restart');launch();flow('later-cold','- extendedWaitUntil:\n    visible: {id: screen.today}\n    timeout: 90000\n');exerciseEvidence.end('later-cold-restart');exerciseEvidence.begin('later-cold-preservation');equal(later,snapshot('later-cold'));pass('later-B-update-and-cold-restart',later);exerciseEvidence.end('later-cold-preservation');
exerciseEvidence.begin('exercise-finalize');writeFileSync(join(output,'verification.json'),JSON.stringify({status:'passed',source,driverSource,sourceEquivalence,artifacts:inputs.artifacts,phases,capabilities:permissionExperimentSelected?{...caps,permission:true}:caps,...(permissionExperimentSelected?{permissionExperiment}:{}),oldCertificate:oldCert,qaCertificate:b,scope:'Untouched125 guest→numeric QA bridge→numeric B update, API36 x86 only. No nonempty SecureStore/auth, genuine provider, ARM/OEM, Play or production-key acceptance.'},null,2));
for(const path of readdirSync(root,{recursive:true}))if(lstatSync(join(root,path)).isFile())chmodSync(join(root,path),0o600);

exerciseEvidence.end('exercise-finalize');
}catch(error){
 if(mode!=='--exercise')throw error;
 try{if(exercisePrivateRoot&&existsSync(exercisePrivateRoot))writeFileSync(join(exercisePrivateRoot,'exercise-failure.txt'),String(error.stack??error),{mode:0o600});}catch{}
 try{exerciseEvidence.fail(error);}catch{console.error('FAIL safe exercise receipt could not be persisted.');}
 console.error('FAIL signing QA exercise; only finite stage/error evidence is retained in the safe receipt.');process.exitCode=1;
}

// Disposable signing QA only. Never upload its private directory or install on a personal device.
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import {createReadStream,createWriteStream,existsSync,lstatSync,mkdirSync,openSync,closeSync,readFileSync,readdirSync,writeFileSync,chmodSync,readlinkSync,realpathSync,rmSync} from 'node:fs';
import {join,resolve,isAbsolute} from 'node:path';
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {DatabaseSync} from 'node:sqlite';

const app='com.patrickchin.puptime',oldSHA='82fa41075db35d747360183a2c3ff364e5c4fb4813519135d7a5eb076249a927';
const oldCert='fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c';
const keySHA='221e0a3106aa4c3ccc154e0a418b55020b3f9ea6e84f92e8749cd9e2f39f5e58';
const caps={'installed data':true,'shared UID':false,permission:false,rollback:false,auth:false};
const hash=value=>createHash('sha256').update(value).digest('hex');
const toolingPaths=['.github/workflows/android-signing-proof.yml','scripts/verify-android-signing-upgrade.mjs'];
function validateDriver(expected,actual){assert.match(expected??'',/^[a-f0-9]{40}$/);assert.equal(actual,expected,'Pin the reviewed driver SHA separately from artifact source.');}
function equivalentChanges(raw){
 if(!raw)return [];
 assert.ok(raw.endsWith('\0'));const fields=raw.slice(0,-1).split('\0');assert.equal(fields.length%2,0);
 const changes=[];
 for(let i=0;i<fields.length;i+=2){
  const match=fields[i].match(/^:100644 100644 ([a-f0-9]{40}) ([a-f0-9]{40}) M$/),path=fields[i+1];
  assert.ok(match,'Only same-mode regular-file tooling edits are allowed.');assert.ok(toolingPaths.includes(path),'App/native/lock/other paths must be blob-and-mode identical.');
  assert.ok(!changes.some(value=>value.path===path));changes.push({path,mode:'100644',sourceBlob:match[1],driverBlob:match[2]});
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
function inspectCapabilities(text,a,b){
 const blocks=text.split(/(?=Signer #\d+ in lineage certificate DN:)/).filter(value=>value.trim());assert.equal(blocks.length,2);
 for(const [i,cert] of [a,b].entries())assert.ok(blocks[i].includes('certificate SHA-256 digest: '+cert));
 for(const [name,value] of Object.entries(caps))assert.match(blocks[0],new RegExp('Has '+name+' capability\\s*:\\s*'+value+'(?:\\s|$)'));
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
function widgetBinding(text){
 text=text.replaceAll('\r','');const section=text.split('\nWidgets:\n')[1]?.split('\nHosts:\n')[0];assert.ok(section,'Inspect the actual Widgets section.');
 const blocks=section.split(/(?=^\s*\[\d+\] id=)/m).filter(part=>part.includes(app+'/'));
 assert.equal(blocks.length,1,'Require one real bound Puptime widget.');const block=blocks[0];
 const id=block.match(/^\s*\[\d+\] id=(\d+)/m)?.[1],host=block.match(/^\s*host=(HostId\{[^\n]+\})/m)?.[1],provider=block.match(/^\s*provider=(ProviderId\{[^\n]+\})/m)?.[1];
 assert.ok(id&&host&&provider);return {id,host,provider};
}
function selfCheck(){
 emulatorSelfCheck();
 offlineSelfCheck();
 assertWidgetSource();
 validateDriver('d'.repeat(40),'d'.repeat(40));assert.throws(()=>validateDriver('d'.repeat(40),'e'.repeat(40)));assert.throws(()=>validateDriver('short','short'));
 const change=path=>`:100644 100644 ${'a'.repeat(40)} ${'b'.repeat(40)} M\0${path}\0`;
 assert.equal(equivalentChanges(toolingPaths.map(change).join('')).length,2);assert.deepEqual(equivalentChanges(''),[]);
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

const [mode]=process.argv.slice(2);if(['--emulator-record','--emulator-root','--emulator-offline','--emulator-cleanup'].includes(mode)){try{emulatorHost(mode);process.exit(0);}catch{console.error('FAIL host-only '+mode.slice(2)+'; raw process/error evidence remains private.');process.exit(1);}}if(mode==='--self-check'){selfCheck();process.exit(0);}
assert.ok(['--preflight','--exercise'].includes(mode));assert.equal(process.env.GITHUB_ACTIONS,'true');assert.equal(process.env.RUNNER_OS,'Linux');process.umask(0o077);
const root=resolve(process.env.PUPTIME_SIGNING_PRIVATE??'');assert.ok(process.env.RUNNER_TEMP&&root.startsWith(resolve(process.env.RUNNER_TEMP)+'/puptime-signing-'));
const source=process.env.PUPTIME_EXPECTED_SOURCE,driverSource=process.env.PUPTIME_EXPECTED_DRIVER;assert.match(source??'',/^[a-f0-9]{40}$/);validateDriver(driverSource,process.env.GITHUB_SHA);assertWidgetSource();
const repo=process.env.GITHUB_REPOSITORY;assert.equal(repo,'patrickchin/puptime');
function command(binary,args,{ok=[0],binaryOutput=false,timeout=120000}={}){
 const result=spawnSync(binary,args,{encoding:binaryOutput?undefined:'utf8',timeout,maxBuffer:256*1024*1024,stdio:['ignore','pipe','pipe']});
 if(!ok.includes(result.status)){
  if(existsSync(root))writeFileSync(join(root,'last-command-failure.txt'),String(result.stdout??'').slice(0,32768)+'\n'+String(result.stderr??'').slice(0,32768),{mode:0o600});
  throw new Error(binary+' failed (exit '+result.status+'); private command/driver evidence was not uploaded.');
 }
 return binaryOutput?result.stdout:String(result.stdout??'')+(result.status?String(result.stderr??''):'');
}
assert.equal(command('git',['rev-parse','HEAD']).trim(),driverSource);
assert.equal(command('git',['status','--porcelain','--untracked-files=no']).trim(),'','Require an unchanged tracked checkout.');
if(spawnSync('git',['cat-file','-e',source+'^{commit}'],{stdio:'ignore',timeout:30000}).status!==0)command('git',['fetch','--no-tags','--depth=1','origin',source]);
const sourceEquivalence={source,driverSource,sourceTree:command('git',['rev-parse',source+'^{tree}']).trim(),driverTree:command('git',['rev-parse',driverSource+'^{tree}']).trim(),changes:equivalentChanges(command('git',['diff-tree','--no-commit-id','--raw','--no-abbrev','--no-renames','-r','-z',source,driverSource])),allOtherBlobsAndModesEqual:true};
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
if(mode==='--preflight'){
 assert.ok(!existsSync(root),'Fresh private directory required.');mkdirSync(root,{mode:0o700});writeFileSync(marker,source);
 const ids=[process.env.PUPTIME_BRIDGE_RUN,process.env.PUPTIME_LATER_RUN];assert.ok(ids.every(id=>/^[1-9]\d+$/.test(id??'')));assert.notEqual(...ids);
 const inputs={source,driverSource,sourceEquivalence,baselineSHA:oldSHA,artifacts:[]};
 for(const [index,id] of ids.entries()){
  const run=api('actions/runs/'+id),jobs=api('actions/runs/'+id+'/jobs?per_page=100');assert.equal(jobs.total_count,jobs.jobs.length);validateRun(run,jobs.jobs,repo,source,id);
  const list=api('actions/runs/'+id+'/artifacts?per_page=100');assert.equal(list.total_count,list.artifacts.length);
  const folder=join(root,index?'later':'bridge');mkdirSync(folder,{mode:0o700});
  for(const name of ['puptime-android-apk','puptime-android-qualification']){
   const artifact=chooseArtifact(list.artifacts,name,id),zip=join(folder,name+'.zip');await download(`https://api.github.com/repos/${repo}/actions/artifacts/${artifact.id}/zip`,zip,artifact.digest.slice(7),true);
   if(name==='puptime-android-apk')zipEntry(zip,'app-release.apk',join(folder,'input.apk'));
   else for(const file of ['BUILD-INFO.json','SHA256SUMS.txt'])zipEntry(zip,file,join(folder,file));
  }
  const info=JSON.parse(readFileSync(join(folder,'BUILD-INFO.json')));assert.deepEqual(Object.keys(info).sort(),['configuredPackage','configuredVersion','configuredVersionCode','runId','sourceCommit'].sort());assert.equal(info.sourceCommit,source);assert.equal(String(info.runId),id);assert.equal(info.configuredPackage,app);assert.equal(info.configuredVersion,'1.12.'+(index+6));assert.equal(info.configuredVersionCode,1012006+index);
  const digest=readFileSync(join(folder,'SHA256SUMS.txt'),'utf8').match(/^([a-f0-9]{64})\s+app-release\.apk$/m)?.[1];assert.ok(digest);assert.equal(await fileHash(join(folder,'input.apk')),digest);
  inputs.artifacts.push({run:Number(id),...info,sha256:digest});
 }
 await download(`https://github.com/${repo}/releases/download/v1.12.5/Puptime-1.12.5.apk`,join(root,'original125.apk'),oldSHA);
 writeFileSync(join(root,'inputs.json'),JSON.stringify(inputs,null,2));mkdirSync(output,{recursive:true,mode:0o700});writeFileSync(join(output,'verification.json'),JSON.stringify({status:'preflight-passed',source,driverSource,sourceEquivalence,artifacts:inputs.artifacts,phases:[],scope:'Pinned equivalent driver/app inputs only; no keys or Android runtime.'},null,2));console.log('PASS pinned driver/input tree equivalence, artifact-only runs, ZIP/APK digests and exact source/version metadata. No signing or Android runtime.');process.exit(0);
}
assert.equal(readFileSync(marker,'utf8'),source);assert.equal(lstatSync(root).mode&0o777,0o700);
const inputs=JSON.parse(readFileSync(join(root,'inputs.json')));assert.equal(inputs.source,source);assert.equal(inputs.driverSource,driverSource);assert.deepEqual(inputs.sourceEquivalence,sourceEquivalence);assert.equal(await fileHash(join(root,'original125.apk')),oldSHA);
for(const [i,name] of ['bridge','later'].entries())assert.equal(await fileHash(join(root,name,'input.apk')),inputs.artifacts[i].sha256);
const device='emulator-5588',adb=(...args)=>command('adb',['-s',device,...args]);assert.equal(adb('emu','avd','name').trim().split(/\r?\n/)[0],'Puptime_Signing_QA_'+process.env.GITHUB_RUN_ID);assert.equal(adb('shell','getprop','ro.build.version.sdk').trim(),'36');
assert.equal(adb('shell','settings','get','global','airplane_mode_on').trim(),'1');assert.equal(adb('shell','id','-u').trim(),'0');assert.equal(command('adb',['-s',device,'shell','pm','path',app],{ok:[1]}),'','The task emulator must not contain any pre-existing Puptime installation.');
assert.equal(adb('shell','settings','get','global','wifi_on').trim(),'0');
// Saved mobile_data may target a different/no subscription. Require actual network absence.
const offline=readOffline((args,timeout)=>({status:0,stdout:command('adb',['-s',device,...args],{timeout})}));writeFileSync(join(root,'emulator-host-state.json'),JSON.stringify(safeHostState({...JSON.parse(readFileSync(join(root,'emulator-host-state.json'))),...offline,offlinePreKey:offlineReady(offline)})),{mode:0o600});assert.ok(offlineReady(offline),'Pre-key actual offline readback failed.');
const tools=join(process.env.ANDROID_HOME,'build-tools/36.0.0'),signer=join(tools,'apksigner'),aapt=join(tools,'aapt2');
function artifact(path,code,cert){const verified=command(signer,['verify','--verbose','--print-certs',path]);assert.ok(verified.includes('certificate SHA-256 digest: '+cert));const manifest=command(aapt,['dump','badging',path]).split('\n').slice(0,3);assert.ok(manifest[0].includes(`name='${app}' versionCode='${code}'`));assert.equal(manifest[1],"minSdkVersion:'24'");assert.equal(manifest[2],"targetSdkVersion:'36'");}
artifact(join(root,'original125.apk'),1012005,oldCert);for(const [i,name] of ['bridge','later'].entries())artifact(join(root,name,'input.apk'),1012006+i,oldCert);
const template=command('tar',['-xOf','node_modules/expo/template.tgz','package/android/app/debug.keystore'],{binaryOutput:true});assert.equal(hash(template),keySHA);
writeFileSync(join(root,'public-A.keystore'),template);writeFileSync(join(root,'A-password'),'android\n');writeFileSync(join(root,'B-password'),randomBytes(32).toString('hex')+'\n');
command('keytool',['-genkeypair','-alias','qa-only','-keystore',join(root,'QA-only-B.p12'),'-storetype','PKCS12','-storepass:file',join(root,'B-password'),'-keyalg','RSA','-keysize','3072','-validity','2','-dname','CN=Puptime QA NOT FOR RELEASE','-noprompt']);
const b=hash(command('keytool',['-exportcert','-alias','qa-only','-keystore',join(root,'QA-only-B.p12'),'-storepass:file',join(root,'B-password')],{binaryOutput:true}));
const key=(name,alias)=>['--ks',join(root,name==='A'?'public-A.keystore':'QA-only-B.p12'),'--ks-pass','file:'+join(root,name+'-password'),'--ks-key-alias',alias];
const A=key('A','androiddebugkey'),B=key('B','qa-only'),lineage=join(root,'QA-only.lineage');
command(signer,['rotate','--out',lineage,'--old-signer',...A,...Object.entries(caps).flatMap(([name,value])=>['--set-'+({'installed data':'installed-data','shared UID':'shared-uid'}[name]??name),String(value)]),'--new-signer',...B]);
inspectCapabilities(command(signer,['lineage','--in',lineage,'--print-certs','-v']),oldCert,b);
for(const [name,input,keys] of [['plain6','bridge',B],['bridge6','bridge',[...A,'--next-signer',...B,'--lineage',lineage,'--rotation-min-sdk-version','33']],['plain7','later',B]]){
 const target=join(root,name+'.apk');command(signer,['sign',...keys,'--out',target,join(root,input,'input.apk')]);artifact(target,name==='plain7'?1012007:1012006,b);
 assert.deepEqual(command('unzip',['-p',target,'AndroidManifest.xml'],{binaryOutput:true}),command('unzip',['-p',join(root,input,'input.apk'),'AndroidManifest.xml'],{binaryOutput:true}));
}
inspectCapabilities(command(signer,['lineage','--in',join(root,'bridge6.apk'),'--print-certs','-v']),oldCert,b);
for(const name of ['plain6','plain7'])assert.match(command(signer,['lineage','--in',join(root,name+'.apk'),'--print-certs'],{ok:[1]}),/does not contain a valid lineage/);
const bridgeVerification=command(signer,['verify','--verbose','--print-certs','--min-sdk-version','33','--max-sdk-version','36',join(root,'bridge6.apk')]);assert.ok(bridgeVerification.includes('Verified using v3.1 scheme (APK Signature Scheme v3.1): true'));

const {nativeSnapshot,assertNativeTransition}=await import('./native-account-evidence.mjs');
const {eventDataFromSql}=await import('../src/record-sql.ts');
const phases=[];function pass(phase,state){phases.push({phase,protectedStateSHA256:hash(JSON.stringify(state))});writeFileSync(join(output,'verification.json'),JSON.stringify({status:'in-progress',source,driverSource,sourceEquivalence,artifacts:inputs.artifacts,phases,scope:'Guest-only API36 x86; no credential or Play acceptance.'},null,2));console.log('PASS signing QA phase: '+phase);}
function flow(name,steps){const path=join(root,name+'.yaml');writeFileSync(path,`appId: ${app}\n---\n${steps}\n`);command('maestro',['--device',device,'test',path,'--test-output-dir',join(root,name+'-driver')],{timeout:240000});}
const tap=id=>`- tapOn: {id: ${id}}\n`,scroll=id=>`- scrollUntilVisible:\n    element: {id: ${id}}\n    direction: DOWN\n    visibilityPercentage: 100\n    centerElement: true\n`;
const settings=tap('nav.open')+'- assertVisible: {id: nav.close}\n'+tap('nav.settings')+'- assertVisible: {id: screen.settings}\n';
function launch(){adb('shell','am','start','-W','-n',app+'/.MainActivity');}
async function install(path,replace=false){assert.match(adb('install',...(replace?['-r']:[]),path),/Success/);const installed=adb('shell','pm','path',app).trim();assert.match(installed,/^package:\/data\/app\/[^\n]+\/base\.apk$/);assert.equal(hash(command('adb',['-s',device,'exec-out','cat',installed.slice(8)],{binaryOutput:true})),await fileHash(path),'Installed APK must be the exact input.');} 
function snapshot(label){
 adb('shell','am','force-stop',app);const dest=join(root,'snapshot-'+label);mkdirSync(dest,{mode:0o700});const files={};
 for(const remote of ['files/SQLite','files/activity-backups','files/puppy-photos','files/dog-photos','shared_prefs']){
  const path='/data/user/0/'+app+'/'+remote;
  const listed=command('adb',['-s',device,'shell',`if test -d ${path}; then find ${path} -type f; fi`]);
  for(const full of listed.trim().split(/\r?\n/).filter(Boolean)){
   const name=full.slice(('/data/user/0/'+app+'/').length);assert.ok(full.startsWith('/data/user/0/'+app+'/')&&!name.includes('..')&&!isAbsolute(name));const bytes=command('adb',['-s',device,'exec-out','cat',full],{binaryOutput:true});files[name]={sha256:hash(bytes),bytes};const target=join(dest,name);mkdirSync(resolve(target,'..'),{recursive:true,mode:0o700});writeFileSync(target,bytes);
  }
 }
 const db=new DatabaseSync(join(dest,'files/SQLite/puptime-v2.db'),{readOnly:true});db.exec('BEGIN');let tables;try{assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);tables=nativeSnapshot(db);}finally{db.exec('ROLLBACK');db.close();}
 const uid=adb('shell','dumpsys','package',app).match(/\buserId=(\d+)/)?.[1];assert.ok(uid);
 const widgets=widgetBinding(adb('shell','dumpsys','appwidget'));
 return {tables,files,uid,widgets};
}
function equal(before,after){assertNativeTransition(before.tables,after.tables);assert.equal(after.uid,before.uid);assert.deepEqual(after.widgets,before.widgets);assert.deepEqual(Object.fromEntries(Object.entries(after.files).map(([k,v])=>[k,v.sha256])),Object.fromEntries(Object.entries(before.files).map(([k,v])=>[k,v.sha256])));}
function launched(before,after,version){assertNativeTransition(expectedLaunch(before.tables,version),after.tables);assert.equal(after.uid,before.uid);assert.deepEqual(after.widgets,before.widgets);protectedFiles(before.files,after.files,version,before.tables.events,eventDataFromSql,before.tables.puppies[0].name,1);}
async function waitWidgetCount(count){const deadline=Date.now()+10000;do{const value=adb('shell',`sqlite3 -readonly /data/user/0/${app}/files/SQLite/puptime-v2.db "SELECT COUNT(*) FROM events WHERE source='widget';"`).trim();if(value===String(count)){await new Promise(done=>setTimeout(done,500));return;}await new Promise(done=>setTimeout(done,200));}while(Date.now()<deadline);throw new Error('Widget did not commit exactly once within the bounded wait.');}
function rejectUpdate(path,before,label){const result=command('adb',['-s',device,'install','-r',path],{ok:[1]});assert.match(result,/INSTALL_FAILED_UPDATE_INCOMPATIBLE/);equal(before,snapshot(label));pass(label,before);}
await install(join(root,'original125.apk'));launch();
flow('old-ui-seed',`- runFlow: ${JSON.stringify(resolve('.maestro/helpers/skip-onboarding.yaml'))}\n- assertVisible: {id: screen.today}\n- repeat:\n    times: 4\n    commands:\n      - tapOn: {id: quick.pee}\n      - tapOn: {id: quick.poop}\n      - tapOn: {id: quick.meal}\n- tapOn: {id: event.meal.edit, index: 0}\n${scroll('editor.note.input')+tap('editor.note.input')}- inputText: Signing QA note\n- pressKey: Back\n- scrollUntilVisible:\n    element: {id: editor.close}\n    direction: UP\n${tap('editor.close')+settings}${tap('settings.widget.open')+scroll('settings.widget.action.walk')+tap('settings.widget.action.walk')+tap('settings.widget.close')+tap('settings.theme.open')+tap('appearance.theme.dark')+tap('settings.language.open')+tap('appearance.language.es')}- stopApp\n`);
launch();
flow('old-reminder-lead','- extendedWaitUntil:\n    visible: {id: screen.today}\n    timeout: 90000\n'+settings+scroll('settings.notifications.open')+tap('settings.notifications.open')+scroll('settings.notifications.lead.15')+tap('settings.notifications.lead.15')+'- pressKey: Home\n');
flow('bind-real-launcher-widget',`- longPressOn:\n    id: '.*:id/workspace'\n- tapOn: '^Widgets$'\n- scrollUntilVisible:\n    element: {text: '^Puptime$'}\n    direction: DOWN\n- tapOn: '^Puptime$'\n- tapOn: '^Puptime Quick Log$'\n- tapOn: '^Add$'\n- extendedWaitUntil:\n    visible: '^Log pee, last logged .+$'\n    timeout: 30000\n- tapOn: '^Log pee, last logged .+$'\n`);
await waitWidgetCount(1);const before=snapshot('old-created');assert.equal(before.tables.events.length,13);assert.ok(before.tables.events.some(row=>row.note==='Signing QA note'));assert.equal(before.tables.events.filter(row=>row.source==='widget').length,1);assert.deepEqual(before.tables.local_sync_owner,[]);assert.deepEqual(before.tables.local_sync_outbox,[]);
assert.equal(before.tables.metadata.find(row=>row.key==='backup_app_version')?.value,'1.12.5/1012005');const prefs=Object.fromEntries(before.tables.settings.map(row=>[row.key,row.value]));assert.equal(prefs['puptime.theme.v1'],'dark');assert.equal(prefs['puptime.language.v1'],'es');assert.ok(JSON.parse(prefs['puptime.widgetActions.v1']).includes('walk'));assert.equal(JSON.parse(prefs['puptime.notificationPreferences.v1']).reminderLeadMinutes,15);pass('original125-created-state',before);
rejectUpdate(join(root,'plain6.apk'),before,'plain-B-rejected');await install(join(root,'bridge6.apk'),true);equal(before,snapshot('bridge-before-launch'));launch();flow('bridge-visible','- extendedWaitUntil:\n    visible: {id: screen.today}\n    timeout: 90000\n');const bridge=snapshot('bridge-launched');launched(before,bridge,'1.12.6/1012006');
launch();flow('bridge-cold','- extendedWaitUntil:\n    visible: {id: screen.today}\n    timeout: 90000\n- pressKey: Home\n- assertVisible: ^Log pee, last logged .+$\n- tapOn: ^Log pee, last logged .+$\n');await waitWidgetCount(2);const widget=snapshot('bridge-widget');
const added=widget.tables.events.filter(row=>!bridge.tables.events.some(old=>old.id===row.id));assert.equal(added.length,1);assert.equal(added[0].type,'pee');assert.equal(added[0].source,'widget');const revisions=widget.tables.local_revisions.slice(bridge.tables.local_revisions.length);assert.equal(revisions.length,1);assert.equal(revisions[0].local_id,added[0].id);assert.equal(revisions[0].kind,'event');assert.equal(revisions[0].sequence,Math.max(0,...bridge.tables.local_revisions.map(row=>row.sequence))+1);assert.equal(revisions[0].pet_id,added[0].pet_id);assert.equal(revisions[0].source,'local');assert.ok(Number.isSafeInteger(revisions[0].created_at)&&revisions[0].created_at>=added[0].at);assert.equal(revisions[0].before_data,null);assert.deepEqual(JSON.parse(revisions[0].after_data),eventDataFromSql(added[0]));
assertNativeTransition(bridge.tables,widget.tables,{events:[...bridge.tables.events,added[0]],local_revisions:[...bridge.tables.local_revisions,revisions[0]],sqlite_sequence:bridge.tables.sqlite_sequence.map(row=>row.name==='local_revisions'?{...row,seq:row.seq+1}:row)});assert.equal(widget.uid,bridge.uid);assert.deepEqual(widget.widgets,bridge.widgets);protectedFiles(bridge.files,widget.files,'1.12.6/1012006',bridge.tables.events,eventDataFromSql,bridge.tables.puppies[0].name);pass('bridge-and-existing-widget-save',widget);
rejectUpdate(join(root,'later/input.apk'),widget,'higher-A-rollback-rejected');await install(join(root,'plain7.apk'),true);equal(widget,snapshot('later-before-launch'));launch();flow('later-visible','- extendedWaitUntil:\n    visible: {id: screen.today}\n    timeout: 90000\n');const later=snapshot('later-launched');launched(widget,later,'1.12.7/1012007');launch();flow('later-cold','- extendedWaitUntil:\n    visible: {id: screen.today}\n    timeout: 90000\n');equal(later,snapshot('later-cold'));pass('later-B-update-and-cold-restart',later);
writeFileSync(join(output,'verification.json'),JSON.stringify({status:'passed',source,driverSource,sourceEquivalence,artifacts:inputs.artifacts,phases,capabilities:caps,oldCertificate:oldCert,qaCertificate:b,scope:'Untouched125 guest→numeric QA bridge→numeric B update, API36 x86 only. No nonempty SecureStore/auth, genuine provider, ARM/OEM, Play or production-key acceptance.'},null,2));
for(const path of readdirSync(root,{recursive:true}))if(lstatSync(join(root,path)).isFile())chmodSync(join(root,path),0o600);

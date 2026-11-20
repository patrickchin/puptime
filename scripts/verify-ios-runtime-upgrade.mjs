// Frozen original iOS app -> original app runtime replacement, not a store upgrade.
// --inspect-only downloads/attests only. --replace-synthetic owns a fresh simulator.
// --prepare-enrolled ABSOLUTE_PRIVATE_DIRECTORY only prepares verified inputs.
// --numeric-upgrade exercises the pinned AACD1.12.0/1 -> ordinary1.12.6/2 archives.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync,spawn} from 'node:child_process';
import {chmodSync,closeSync,cpSync,existsSync,mkdirSync,mkdtempSync,openSync,readFileSync,readdirSync,realpathSync,renameSync,rmSync,statSync,symlinkSync,writeFileSync} from 'node:fs';
import {homedir,tmpdir} from 'node:os';
import {basename,dirname,isAbsolute,join,relative,resolve,sep} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {nativeSnapshot,nativeTables} from './native-account-evidence.mjs';
import {assertArchivedSource,nativeTextSection,nativeCodeFingerprint,nativeHostInputs} from './native-runtime-inputs.mjs';
import {deleteOwnedSimulator,installTaskCleanup,ownProcess} from './native-task-cleanup.mjs';
import {eventDataFromSql,eventSqlColumns,eventSqlDefinition} from '../src/record-sql.ts';
import {parseEvents} from '../src/storage-validation.ts';

const repository='patrickchin/puptime',app='com.patrickchin.puptime';
const originalCuts=[
 {name:'older',source:'008b4a0b7f4d8a77cc8c13d95f39001534d8fd70',event:'pull_request',branch:'codex/themed-puppy-confirmation',checkout:'4de8d80dd6f31f5b3fee7da09928cd24a0bdfe4e',tree:'7e3886c23141b4cb9843782a81566cd2aa714a84',run:43263326680,artifact:13982701381,digest:'eb3e73181cc0b8e816e5414afe613be5667a4a019a206e9f103268b24a066a09'},
 {name:'newer',source:'aacd58fd0a7102a629b92dbf8813496870aec21c',event:'push',branch:'main',checkout:'aacd58fd0a7102a629b92dbf8813496870aec21c',tree:'abb69c7d347964ad7a6cd9bcce80a8472544ab2e',run:43383649287,artifact:14029395865,digest:'2e889cd3b6eea1b0ce5b878665a8d259af002a68f54e1f77a3bdf7cf13003865'},
];
// This ordinary archive is uploaded before any preview/fixture re-bundling.
// Its entire workflow must also succeed; an uploaded archive alone is not acceptance.
const numericTarget={name:'newer',source:'f8ba094042df97f0300a2ccc01d1124dbc18ac24',event:'pull_request',branch:'codex/sqlite-engine-maintenance',run:44461658975,attempt:1,checkout:'abcd4447052d0ce9d6773177197774fa6a3a6250',tree:'532f419ed533a3695d2d3ed7fbb2fbf5827e90f0',artifact:14502365649,bytes:49760202,digest:'6c33c79ef8ce4b8e3da7c3cfe11ac335deccbfb961ad40cd33e11e5d4b440ffd',expiresAt:'2026-11-26T05:31:31Z',version:'1.12.6',build:'2'};
const nativeInputs=[...nativeHostInputs,'.env'];
const [mode='--inspect-only',destination=process.env.GITHUB_ACTIONS==='true'?'build/native-runtime-replacement':join(homedir(),'Pictures/Screenshots/Codex/puptime-runtime-replacement')]=process.argv.slice(2);
assert.ok(['--inspect-only','--replace-synthetic','--prepare-enrolled','--numeric-upgrade','--self-check'].includes(mode));
const numeric=mode==='--numeric-upgrade';
const cuts=numeric?[{...originalCuts[1],name:'older',attempt:1,bytes:67784040,expiresAt:'2026-11-20T10:31:10Z',version:'1.12.0',build:'1'},numericTarget]:originalCuts;
const preparing=mode==='--prepare-enrolled';
const command=(binary,args,options={})=>execFileSync(binary,args,{encoding:'utf8',timeout:120000,stdio:['ignore','pipe','pipe'],...options}).trim();
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const simctl=(...args)=>command('xcrun',['simctl',...args]);
const jsonPlist=path=>JSON.parse(command('plutil',['-convert','json','-o','-',path]));
const inside=(root,path)=>{const name=relative(root,path);return name===''||name!=='..'&&!name.startsWith('..'+sep)&&!isAbsolute(name);};
function assertNumericPins(selected=cuts){
 for(const cut of selected){
  assert.ok(Number.isSafeInteger(cut.artifact)&&cut.artifact>0&&Number.isSafeInteger(cut.bytes)&&cut.bytes>0,'Bind the actual numeric-upgrade artifact ID and byte size before execution.');
  for(const field of ['checkout','tree'])assert.match(cut[field]??'',/^[a-f0-9]{40}$/,'Bind the actual compiled checkout and tree before execution.');
  assert.match(cut.digest??'',/^[a-f0-9]{64}$/,'Bind the full ordinary archive SHA-256 before execution.');
 }
}
function assertNumericMetadata(cut,run,artifact,now=Date.now()){
 assertNumericPins([cut]);assert.equal(run.id,cut.run);assert.equal(run.run_attempt,cut.attempt);assert.equal(run.status,'completed');assert.equal(run.conclusion,'success');
 assert.equal(run.head_sha,cut.source);assert.equal(run.event,cut.event);assert.equal(run.head_branch,cut.branch);assert.equal(run.path,'.github/workflows/ios-simulator.yml');assert.equal(run.head_repository?.full_name,repository);
 assert.equal(artifact.id,cut.artifact);assert.equal(artifact.name,'puptime-ios-simulator');assert.equal(artifact.size_in_bytes,cut.bytes);assert.equal(artifact.digest,'sha256:'+cut.digest);assert.equal(artifact.expired,false);assert.equal(artifact.expires_at,cut.expiresAt);assert.ok(Date.parse(artifact.expires_at)>now,'Numeric runtime archives must remain unexpired.');
 assert.equal(artifact.workflow_run.id,cut.run);assert.equal(artifact.workflow_run.head_sha,cut.source);assert.equal(artifact.workflow_run.head_branch,cut.branch);
}
const backupPath=/^activity-backups\/bkp_[a-f0-9]{32}\.json$/;
const digestBytes=bytes=>createHash('sha256').update(bytes).digest('hex');
function documentFiles(directory){
 return Object.fromEntries((existsSync(directory)?readdirSync(directory,{recursive:true,withFileTypes:true}):[]).flatMap(entry=>{
  assert.ok(!entry.isSymbolicLink()&&(entry.isDirectory()||entry.isFile()),'Reject untracked nonregular saved files.');
  if(entry.isDirectory())return [];
  const parent=entry.parentPath??entry.path,path=join(parent,entry.name),name=path.slice(directory.length+1);
  return [[name,hash(path)]];
 }).sort(([left],[right])=>left.localeCompare(right)));
}
const protectedDocumentFiles=directory=>Object.fromEntries(Object.entries(documentFiles(directory)).filter(([name])=>!/^SQLite\/puptime-v2\.db(?:-wal|-shm|-journal)?$/.test(name)));
function strictBackup(raw){
 assert.equal(typeof raw,'string');const value=JSON.parse(raw);
 assert.deepEqual(Object.keys(value).sort(),['format','version','createdAt','petId','puppyName','reason','appVersion','events'].sort());
 assert.equal(raw,JSON.stringify(value),'Require the exact compact JSON emitted by the original backup writer.');
 assert.equal(value.format,'puptime-activity');assert.equal(value.version,1);
 assert.ok(Number.isSafeInteger(value.createdAt)&&value.createdAt>=0&&value.createdAt<=8640000000000000);
 assert.match(value.petId,/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);assert.ok(typeof value.puppyName==='string'&&value.puppyName.length>0&&value.puppyName.length<=256);
 assert.ok(['daily','before-update','account-change','cloud-replace','import','recovery','delete'].includes(value.reason));
 assert.ok(typeof value.appVersion==='string'&&value.appVersion.length>0&&value.appVersion.length<=128);
 assert.deepEqual(parseEvents(value.events),value.events);return value;
}
function assertDeviceClock(clock,previous){
 assert.deepEqual(Object.keys(clock).sort(),['date','timeZone','offsetSeconds','timestamp'].sort());
 assert.ok(Number.isSafeInteger(clock.timestamp)&&clock.timestamp>=0&&clock.timestamp<=8640000000000000);
 assert.ok(typeof clock.timeZone==='string'&&clock.timeZone.length>0&&clock.timeZone.length<=128);
 assert.ok(Number.isInteger(clock.offsetSeconds)&&Math.abs(clock.offsetSeconds)<=86400);
 assert.equal(clock.date,new Date(clock.timestamp+clock.offsetSeconds*1000).toISOString().slice(0,10));
 if(previous){for(const key of ['date','timeZone','offsetSeconds'])assert.equal(clock[key],previous[key],'The actual device-local day and time zone must remain unchanged.');assert.ok(clock.timestamp>=previous.timestamp,'The device clock must not move backwards.');}
 return clock;
}
function assertOldDaily(before,clock){
 assertDeviceClock(clock);assert.equal(before.tables.puppies.length,1);const puppy=before.tables.puppies[0];
 assert.deepEqual(before.tables.metadata.filter(row=>row.key==='active_pet_id').map(row=>row.value),[puppy.id]);
 assert.equal(before.tables.events.length,12);assert.ok(before.tables.events.every(row=>row.pet_id===puppy.id));
 assert.deepEqual(before.tables.metadata.filter(row=>row.key==='backup_app_version').map(row=>row.value),['1.12.0/1']);
 assert.deepEqual(Object.keys(before.backups).sort(),Object.keys(before.files).filter(name=>name.startsWith('activity-backups/')).sort());
 const daily=[];
 for(const [name,raw] of Object.entries(before.backups)){
  assert.match(name,backupPath);assert.equal(before.files[name],digestBytes(raw));const backup=strictBackup(raw);
  assert.equal(backup.petId,puppy.id);assert.equal(backup.appVersion,'1.12.0/1');assert.ok(backup.events.length>0);
  assert.ok(backup.createdAt<=clock.timestamp,'An old backup cannot come from the future.');
  if(backup.reason==='daily'&&new Date(backup.createdAt+clock.offsetSeconds*1000).toISOString().slice(0,10)===clock.date)daily.push(backup);
 }
 assert.equal(daily.length,1,'Establish one genuine old-runtime daily backup on this device-local date.');
}
function assertNumericUpgrade(before,after,{started,finished}){
 assertDeviceClock(finished,started);assertOldDaily(before,started);
 const added=Object.keys(after.files).filter(name=>!Object.hasOwn(before.files,name));assert.equal(added.length,1,'Only the before-update backup file may be added.');
 const name=added[0];assert.match(name,backupPath);assert.equal(after.files[name],digestBytes(after.backups[name]));const backup=strictBackup(after.backups[name]);
 const puppy=before.tables.puppies[0];assert.equal(backup.reason,'before-update');assert.equal(backup.appVersion,'1.12.6/2');assert.equal(backup.petId,puppy.id);assert.equal(backup.puppyName,puppy.name);
 assert.ok(backup.createdAt>=started.timestamp&&backup.createdAt<=finished.timestamp,'The safety backup must be created inside the actual first-launch interval.');
 const events=[...before.tables.events].sort((left,right)=>right.at-left.at||Buffer.compare(Buffer.from(right.id),Buffer.from(left.id))).map(({id,...row})=>({id,...eventDataFromSql(row)}));
 assert.deepEqual(backup.events,events,'Preserve all original events in the production backup order.');
 assert.deepEqual(after.tables.metadata.filter(row=>row.key==='backup_app_version').map(row=>row.value),['1.12.6/2']);
 const files={...after.files},backups={...after.backups};delete files[name];delete backups[name];
 const normalized={...after,files,backups,tables:{...after.tables,metadata:after.tables.metadata.map(row=>row.key==='backup_app_version'?{...row,value:'1.12.0/1'}:row)}};
 assertPreserved(before,normalized,{paletteChange:true});return name;
}
function prepareDeviceClock(directory,device){
 const source=join(directory,'device-clock.swift'),binary=join(directory,'device-clock');
 writeFileSync(source,`import Foundation
let now = Date()
let zone = TimeZone.current
var calendar = Calendar(identifier: .gregorian)
calendar.timeZone = zone
let parts = calendar.dateComponents([.year, .month, .day], from: now)
let value: [String: Any] = ["date": String(format: "%04d-%02d-%02d", parts.year!, parts.month!, parts.day!), "timeZone": zone.identifier, "offsetSeconds": zone.secondsFromGMT(for: now), "timestamp": Int64(floor(now.timeIntervalSince1970 * 1000))]
FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]))
`,{mode:0o600,flag:'wx'});
 const sdk=command('xcrun',['--sdk','iphonesimulator','--show-sdk-path']);
 command('xcrun',['--sdk','iphonesimulator','swiftc','-sdk',sdk,'-target','arm64-apple-ios17.0-simulator',source,'-o',binary]);
 command('codesign',['--force','--sign','-',binary]);
 const sourceSHA256=hash(source),binarySHA256=hash(binary);
 return {sourceSHA256,binarySHA256,read(){assert.equal(hash(source),sourceSHA256);assert.equal(hash(binary),binarySHA256);return assertDeviceClock(JSON.parse(simctl('spawn',device,binary)));}};
}
function numericSelfCheck(){
 const timestamp=Date.UTC(2026,10,19,12),clock={date:'2026-11-19',timeZone:'Etc/UTC',offsetSeconds:0,timestamp},finished={...clock,timestamp:timestamp+1000};
 const db=new DatabaseSync(':memory:');let rows,events;
 try{
  db.exec(`CREATE TABLE events(id TEXT PRIMARY KEY,pet_id TEXT NOT NULL,${eventSqlDefinition})`);
  const insert=db.prepare(`INSERT INTO events(id,pet_id,${eventSqlColumns.join(',')}) VALUES (${Array(eventSqlColumns.length+2).fill('?').join(',')})`);
  for(let index=0;index<12;index++)insert.run(`evt_numeric_${String(index).padStart(2,'0')}`,'pet_numeric','pee',timestamp-10000-(index%3)*1000,0,null,null,index===0?'Saved before and after sign-in':null,'app',null);
  rows=db.prepare('SELECT * FROM events ORDER BY rowid').all().map(row=>({...row}));
  events=db.prepare('SELECT * FROM events ORDER BY at DESC,id DESC').all().map(({id,...row})=>({id,...eventDataFromSql(row)}));
 }finally{db.close();}
 const dailyName='activity-backups/bkp_'+'a'.repeat(32)+'.json',newName='activity-backups/bkp_'+'b'.repeat(32)+'.json';
 const daily=JSON.stringify({format:'puptime-activity',version:1,createdAt:timestamp-5000,petId:'pet_numeric',puppyName:'Earlier puppy name',reason:'daily',appVersion:'1.12.0/1',events:[events[0]]});
 const before={tables:Object.fromEntries(nativeTables.map(table=>[table,[]])),files:{'dog-photos/img_test.jpg':'original-photo',[dailyName]:digestBytes(daily)},backups:{[dailyName]:daily},pendingWidgetFiles:{},photo:{id:'img_test',jpegSHA256:'original-photo',width:512,height:512},widgetTimelines:{quick:[{pending:[],lastEventAt:{pee:123},appearance:{light:{background:'old',surface:'old',controlRadius:12},dark:{background:'dark',surface:'dark',controlRadius:12}}}]}};
 before.tables.puppies=[{id:'pet_numeric',name:'Runtime QA Maple'}];before.tables.events=rows;before.tables.metadata=[{key:'active_pet_id',value:'pet_numeric'},{key:'backup_app_version',value:'1.12.0/1'}];
 assertOldDaily(before,clock);
 const after=structuredClone(before),backup={format:'puptime-activity',version:1,createdAt:timestamp+500,petId:'pet_numeric',puppyName:'Runtime QA Maple',reason:'before-update',appVersion:'1.12.6/2',events};
 const writeBackup=(value,content)=>{value.backups[newName]=content;value.files[newName]=digestBytes(content);};
 after.tables.metadata[1].value='1.12.6/2';writeBackup(after,JSON.stringify(backup));after.widgetTimelines.quick[0].appearance.light.background='new';
 assert.equal(assertNumericUpgrade(before,after,{started:clock,finished}),newName);assertPreserved(after,structuredClone(after),{paletteChange:true});
 let negatives=0;
 const rejects=mutate=>{const changed=structuredClone(after);mutate(changed);assert.throws(()=>assertNumericUpgrade(before,changed,{started:clock,finished}));negatives++;};
 rejects(value=>{delete value.files[newName];delete value.backups[newName];});
 for(const content of ['{',JSON.stringify(backup)+' ',JSON.stringify(backup).replace('"reason":"before-update"','"reason":"daily","reason":"before-update"')])rejects(value=>writeBackup(value,content));
 rejects(value=>{const name='activity-backups/bkp_'+'c'.repeat(32)+'.json';value.files[name]=value.files[newName];value.backups[name]=value.backups[newName];});
 for(const mutate of [value=>value.reason='daily',value=>value.appVersion='1.12.5/2',value=>value.petId='pet_other',value=>value.puppyName='Other puppy',value=>value.format='unknown',value=>value.version=2,value=>value.createdAt=timestamp-1,value=>value.createdAt=finished.timestamp+1,value=>value.createdAt=NaN,value=>value.extra=true,value=>value.events.pop(),value=>value.events.reverse(),value=>value.events.push(value.events[0]),value=>value.events[0].note='changed',value=>value.events[0].id='evt_other'])rejects(value=>{const data=structuredClone(backup);mutate(data);writeBackup(value,JSON.stringify(data));});
 for(const table of nativeTables)rejects(value=>value.tables[table].push({unrelated:'row'}));
 for(const mutate of [value=>value.files[dailyName]='changed',value=>value.backups[dailyName]='{}',value=>delete value.files[dailyName],value=>value.files['activity-backups/unrelated.tmp']='extra',value=>value.files['SQLite/extra.data']='extra',value=>value.files['dog-photos/img_test.jpg']='changed',value=>value.photo.id='img_other',value=>value.pendingWidgetFiles.extra='changed',value=>value.widgetTimelines.quick[0].pending.push({id:'extra'}),value=>value.widgetTimelines.quick[0].appearance.dark.controlRadius=20,value=>value.tables.metadata[1].value='wrong'])rejects(mutate);
 const extraCold=structuredClone(after);extraCold.files['activity-backups/bkp_'+'d'.repeat(32)+'.json']='extra';assert.throws(()=>assertPreserved(after,extraCold,{paletteChange:true}));negatives++;
 const noDaily=structuredClone(before);delete noDaily.files[dailyName];delete noDaily.backups[dailyName];assert.throws(()=>assertOldDaily(noDaily,clock));negatives++;
 for(const value of [{...finished,date:'2026-11-20',timestamp:timestamp+86400000},{...finished,timeZone:'Asia/Shanghai'},{...finished,offsetSeconds:1},{...clock,timestamp:timestamp-1}]){assert.throws(()=>assertDeviceClock(value,clock));negatives++;}
 const numericCuts=[{...originalCuts[1],attempt:1,bytes:67784040},numericTarget];assertNumericPins(numericCuts);
 for(const field of ['artifact','bytes','checkout','tree','digest']){assert.throws(()=>assertNumericPins([numericCuts[0],{...numericTarget,[field]:null}]));negatives++;}
 // Artificial metadata exercises admission only, never claims this run passed.
 const run={id:numericTarget.run,run_attempt:1,status:'completed',conclusion:'success',head_sha:numericTarget.source,event:numericTarget.event,head_branch:numericTarget.branch,path:'.github/workflows/ios-simulator.yml',head_repository:{full_name:repository}};
 const artifact={id:numericTarget.artifact,name:'puptime-ios-simulator',size_in_bytes:numericTarget.bytes,digest:'sha256:'+numericTarget.digest,expired:false,expires_at:'2026-11-26T05:31:31Z',workflow_run:{id:numericTarget.run,head_sha:numericTarget.source,head_branch:numericTarget.branch}};
 assertNumericMetadata(numericTarget,run,artifact,timestamp);assert.throws(()=>assertNumericMetadata(numericTarget,run,artifact,Date.parse(numericTarget.expiresAt)));negatives++;
 for(const mutate of [value=>value.run.status='in_progress',value=>value.run.conclusion='failure',value=>value.run.run_attempt=2,value=>value.run.head_sha='0'.repeat(40),value=>value.artifact.id++,value=>value.artifact.size_in_bytes++,value=>value.artifact.digest='sha256:'+'0'.repeat(64),value=>value.artifact.expired=true,value=>value.artifact.expires_at='2026-11-18T00:00:00Z']){
  const value=structuredClone({run,artifact});mutate(value);assert.throws(()=>assertNumericMetadata(numericTarget,value.run,value.artifact,timestamp));negatives++;
 }
 const root=mkdtempSync(join(tmpdir(),'puptime-numeric-files-'));
 try{
  mkdirSync(join(root,'SQLite'));writeFileSync(join(root,'SQLite/puptime-v2.db'),'physical database');writeFileSync(join(root,'SQLite/extra.data'),'protected');
  assert.deepEqual(protectedDocumentFiles(root),{'SQLite/extra.data':digestBytes('protected')});symlinkSync(join(root,'SQLite/extra.data'),join(root,'linked-data'));assert.throws(()=>protectedDocumentFiles(root));negatives++;
 }finally{rmSync(root,{recursive:true,force:true});}
 console.log(`PASS numeric-upgrade guards: exact first-launch checkpoint, SQL event order, unchanged daily/cold state; ${negatives} negative mutations rejected. No native runtime or archive inspection.`);
}
function prepareEnrolled(cuts,output,source){
 const lockSHA256=hash('package-lock.json'),packageSHA256=hash('package.json');
 for(const cut of cuts){
  const directory=dirname(dirname(cut.host)),sourceRoot=join(directory,'source'),archive=join(directory,'source.tar');
  mkdirSync(sourceRoot,{mode:0o700});
  const fd=openSync(archive,'wx',0o600);
  try{execFileSync('git',['archive','--format=tar',cut.source],{timeout:120000,stdio:['ignore',fd,'pipe']});}finally{closeSync(fd);}
  command('tar',['-xf',archive,'-C',sourceRoot]);rmSync(archive);chmodSync(sourceRoot,0o700);
  const sourceFiles=Object.fromEntries(command('git',['ls-tree','-rz',cut.source]).split('\0').filter(Boolean).map(entry=>{
   const match=entry.match(/^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/s);assert.ok(match,'Reject unsupported historical source entry modes.');
   return [match[3],{mode:match[1],blobSHA1:match[2]}];
  }));
  assertArchivedSource(sourceRoot,sourceFiles);
  assert.equal(hash(join(sourceRoot,'package-lock.json')),lockSHA256,'Share dependencies only across the exact historical and driver lock.');
  assert.equal(hash(join(sourceRoot,'package.json')),packageSHA256,'Preserve the exact historical package contract.');
  const nativeCode=nativeCodeFingerprint(cut.host,directory);
  assert.ok(Object.hasOwn(nativeCode,cut.provenance.executable),'Attest the main executable as well as embedded native code.');
  cut.preparation={name:cut.name,host:cut.host,sourceRoot,sourceFiles,source:cut.source,tree:cut.tree,packageSHA256,lockSHA256,appGroup:cut.group,infoPlistSHA256:hash(join(cut.host,'Info.plist')),signature:{deepStrictVerified:true,codeResourcesSHA256:hash(join(cut.host,'_CodeSignature/CodeResources'))},nativeCode,original:cut.provenance};
 }
 const manifest={schemaVersion:1,status:'prepared',stage:'controlled-origin-enrolled-preparation',upgradeExecuted:false,appsInstalled:false,javaScriptModified:false,driverSource:source,driverScriptSHA256:hash(new URL(import.meta.url)),packageSHA256,lockSHA256,runtimes:cuts.map(cut=>cut.preparation),scope:'Private inputs only. A later case must independently verify these files before exact-source controlled-origin exports and installation; this is not an original-byte, enrolled-runtime, numeric/store, current-candidate or provider-authentication pass.'};
 writeFileSync(join(output,'enrolled-inputs.json'),JSON.stringify(manifest,null,2)+'\n',{mode:0o600,flag:'wx'});
 console.log('PASS controlled-origin enrolled preparation only; no runtime replacement executed.');
}
function assertPreserved(before,after,{paletteChange=false}={}){
 const protectedState=value=>({...value,widgetTimelines:Object.fromEntries(Object.entries(value.widgetTimelines).map(([key,entries])=>[key,entries.map(props=>{
  if(!paletteChange)return props;
  const {appearance}=props;assert.ok(appearance?.light&&appearance?.dark,'Retain both widget appearances.');
  const colours=value=>{const {background,surface,...layout}=value;assert.equal(typeof background,'string');assert.equal(typeof surface,'string');return layout;};
  return {...props,appearance:{...appearance,light:colours(appearance.light),dark:colours(appearance.dark)}};
 })]))});
 assert.deepEqual(protectedState(after),protectedState(before),'Preserve every table/row/sequence counter, saved file, photo and widget activity field.');
}
function assertPreferences(settings){
 const value=key=>{const row=settings.find(row=>row.key===key);assert.ok(row,'The older UI must persist each nondefault preference.');return row.value;};
 assert.equal(value('puptime.theme.v1'),'dark');assert.equal(value('puptime.language.v1'),'es');
 assert.ok(JSON.parse(value('puptime.widgetActions.v1')).includes('walk'));assert.equal(JSON.parse(value('puptime.notificationPreferences.v1')).reminderLeadMinutes,15);
}
function selfCheck(){
 numericSelfCheck();
 const before={tables:Object.fromEntries(nativeTables.map(table=>[table,[]])),files:{'dog-photos/img_test.jpg':'original-bytes'},widgetTimelines:{quick:[{pending:[],lastEventAt:{pee:123},appearance:{light:{background:'old',surface:'old',controlRadius:12},dark:{background:'dark',surface:'dark',controlRadius:12}}}]}};
 const after=structuredClone(before);after.widgetTimelines.quick[0].appearance.light.background='new';after.widgetTimelines.quick[0].appearance.dark.surface='new';
 assertPreserved(before,after,{paletteChange:true});assert.throws(()=>assertPreserved(before,after));
 for(const mutate of [value=>value.tables.events.push({id:'changed'}),value=>value.files['dog-photos/img_test.jpg']='changed',value=>value.widgetTimelines.quick[0].pending.push({id:'unexpected'}),value=>value.widgetTimelines.quick[0].lastEventAt.pee=999,value=>value.widgetTimelines.quick[0].appearance.light.controlRadius=99,value=>value.widgetTimelines.quick[0].appearance.dark.unknown='unexpected']){
  const changed=structuredClone(after);mutate(changed);assert.throws(()=>assertPreserved(before,changed,{paletteChange:true}));
 }
 const settings=[['puptime.theme.v1','dark'],['puptime.language.v1','es'],['puptime.widgetActions.v1','["pee","poop","meal","walk"]'],['puptime.notificationPreferences.v1','{"reminderLeadMinutes":15}']].map(([key,value])=>({key,value}));
 assertPreferences(settings);assert.throws(()=>assertPreferences(settings.filter(row=>row.key!=='puptime.language.v1')));assert.throws(()=>assertPreferences(settings.map(row=>row.key==='puptime.theme.v1'?{...row,value:'"dark"'}:row)));
 const root=mkdtempSync(join(tmpdir(),'puptime-source-guard-'));
 try{
  const file=join(root,'index.ts'),bytes=Buffer.from('synthetic historical source\n');writeFileSync(file,bytes,{mode:0o600});
  const expected={'index.ts':{mode:'100644',blobSHA1:createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')}};
  assertArchivedSource(root,expected);writeFileSync(file,'changed');assert.throws(()=>assertArchivedSource(root,expected));writeFileSync(file,bytes);
  writeFileSync(join(root,'unexpected'),'extra');assert.throws(()=>assertArchivedSource(root,expected));rmSync(join(root,'unexpected'));
  chmodSync(file,0o700);assert.throws(()=>assertArchivedSource(root,expected));
  assert.ok(inside(root,join(root,'child'))&&!inside(root,root+'-sibling')&&!inside(root,dirname(root)));
 }finally{rmSync(root,{recursive:true,force:true});}
 // Actual retained older ExpoWidgetsTarget __preview.dylib: 34800 bytes.
 const stub='Section\n  sectname __text\n   segname __TEXT\n      addr 0x0000000000000338\n      size 0x0000000000000000\n    offset 824\n     align 2^0 (1)\n    reloff 0\n    nreloc 0\n     flags 0x80000400\n reserved1 0\n reserved2 0\n';
 const preview='PlugIns/ExpoWidgetsTarget.appex/__preview.dylib';
 assert.deepEqual(nativeTextSection(stub,34800,preview),{size:0,offset:824});
 assert.deepEqual(nativeTextSection(stub,34800,'PlugIns/PuptimeQuickLogNotification.appex/__preview.dylib'),{size:0,offset:824});
 assert.deepEqual(nativeTextSection(stub.replace('size 0x0000000000000000','size 0x10'),34800,'Puptime'),{size:16,offset:824});
 for(const [text,length,name] of [[stub,34800,'Puptime'],[stub,34800,'__preview.dylib'],[stub,823,preview],[stub.replace('size 0x0000000000000000','size 0xffff'),34800,preview],[stub.replace('offset 824','offset -1'),34800,preview],[stub.replace('offset 824','absent 824'),34800,preview],[stub.replace('segname __TEXT','segname __DATA'),34800,preview]])assert.throws(()=>nativeTextSection(text,length,name));
 console.log('PASS runtime/source/native-text guards: palette-only change, exact source blobs/modes and bounded named-preview exception.');
}
async function verify(){
 if(numeric)assertNumericPins();
 assert.equal(process.env.GITHUB_REPOSITORY??repository,repository);
 let output=resolve(destination);
 if(preparing){
  assert.ok(process.argv[3]&&isAbsolute(destination),'Preparation needs an explicit absolute private destination.');
  output=join(realpathSync(dirname(output)),basename(output));
  for(const root of [command('git',['rev-parse','--show-toplevel']),process.env.GITHUB_WORKSPACE].filter(Boolean))assert.ok(!inside(realpathSync(root),output),'Private inputs must stay outside checkout and uploaded build receipt roots.');
  assert.ok(!existsSync(output),'Preparation owns a fresh destination, never supplied existing hosts or source roots.');
  assert.ok(process.env.PUPTIME_RUNTIME_ARTIFACT_CACHE,'Preparation requires the existing verified archive cache; do not download another copy.');
  assert.equal(command('git',['status','--porcelain','--untracked-files=all']),'','Commit the exact preparation driver before creating reusable inputs.');
  mkdirSync(output,{mode:0o700});
 }else mkdirSync(output,{recursive:true});
 assert.ok(!existsSync(join(output,'verification.json'))&&!existsSync(join(output,'inspection.json')),'Use a fresh receipt directory; never mix inspection with an earlier runtime result.');
 const privateDir=preparing?join(output,'inputs'):mkdtempSync(join(tmpdir(),'puptime-runtime-upgrade-'));
 if(preparing)mkdirSync(privateDir,{mode:0o700});
 const cache=process.env.PUPTIME_RUNTIME_ARTIFACT_CACHE?resolve(process.env.PUPTIME_RUNTIME_ARTIFACT_CACHE):privateDir;
 mkdirSync(cache,{recursive:true});
 const api=path=>JSON.parse(command('gh',['api',`repos/${repository}/${path}`]));
 const rawFlags=command('gh',['api','--help']).includes('--allow-escape-sequences')?['--allow-escape-sequences']:[];
 const source=command('git',['rev-parse','HEAD']);
 for(const cut of cuts){
  const run=api(`actions/runs/${cut.run}`);assert.equal(run.status,'completed');assert.equal(run.conclusion,'success');
  if(numeric)assert.equal(run.run_attempt,cut.attempt);
  assert.equal(run.head_sha,cut.source);assert.equal(run.head_repository?.full_name,repository);assert.equal(run.path,'.github/workflows/ios-simulator.yml');
  assert.equal(run.event,cut.event);assert.equal(run.head_branch,cut.branch);
  try{command('git',['cat-file','-e',cut.source+'^{commit}']);}catch{assert.ok(!preparing,'Preparation requires the existing historical commits; do not fetch new sources.');command('git',['fetch','--no-tags','origin',cut.source]);}
  // Checkout SHAs are pinned from each original build's actual checkout log.
  // The PR merge checkout is distinct from its head, but has the same full tree.
  const checkout=api('git/commits/'+cut.checkout);assert.equal(checkout.sha,cut.checkout);assert.equal(checkout.tree.sha,cut.tree);
  assert.equal(command('git',['rev-parse',cut.source+'^{tree}']),cut.tree,'Attest actual compiled checkout tree, not just workflow head metadata.');
  const artifact=api(`actions/artifacts/${cut.artifact}`);
  assert.equal(artifact.name,'puptime-ios-simulator');assert.equal(artifact.expired,false);assert.equal(artifact.workflow_run.id,cut.run);
  assert.equal(artifact.digest,'sha256:'+cut.digest);
  if(numeric)assertNumericMetadata(cut,run,artifact);
  const archive=join(cache,cut.name+'-artifact.zip');
  if(!existsSync(archive)){
   assert.ok(!preparing,'Preparation requires both completed cached archives.');
   const partial=archive+'.part',fd=openSync(partial,'wx',0o600);
   try{execFileSync('gh',['api',`repos/${repository}/actions/artifacts/${cut.artifact}/zip`,...rawFlags],{timeout:600000,stdio:['ignore',fd,'pipe']});}finally{closeSync(fd);}
   assert.equal(hash(partial),cut.digest,'Verify the complete download before adding it to the artifact cache.');renameSync(partial,archive);
  }
  assert.equal(hash(archive),cut.digest,'Verify exact original GitHub archive bytes, including cached files.');
  if(numeric)assert.equal(statSync(archive).size,cut.bytes);
  const directory=join(privateDir,cut.name);mkdirSync(directory);
  command('unzip',['-q',archive,'-d',directory]);
  const inner=join(directory,'Puptime-iOS-Simulator.zip');assert.ok(existsSync(inner));
  command('ditto',['-x','-k',inner,join(directory,'host')]);cut.host=join(directory,'host/Puptime.app');
  command('codesign',['--verify','--deep','--strict',cut.host]);
  const info=jsonPlist(join(cut.host,'Info.plist')),binary=join(cut.host,info.CFBundleExecutable);
  assert.equal(info.CFBundleIdentifier,app);assert.equal(info.CFBundleShortVersionString,numeric?cut.version:'1.12.0');assert.equal(info.CFBundleVersion,numeric?cut.build:'1');
  const architecture=command('lipo',['-archs',binary]);assert.match(architecture,/\barm64\b/);
  const platform=command('xcrun',['vtool','-show-build',binary]);assert.match(platform,/platform\s+IOSSIMULATOR/);
  const parseEntitlements=(text,name)=>{assert.ok(text.includes('<plist'),'Inspect actual entitlement metadata.');const path=join(directory,name+'.plist');writeFileSync(path,text,{mode:0o600});return jsonPlist(path);};
  const signedEntitlements=parseEntitlements(command('codesign',['-d','--entitlements',':-',cut.host]),'signed-entitlements');
  // Ad-hoc simulator signatures can have an empty entitlement dictionary; the
  // actual simulator capabilities live in Mach-O's __TEXT,__entitlements.
  const words=command('otool',['-arch','arm64','-s','__TEXT','__entitlements',binary]).split('\n').filter(line=>/^[a-f0-9]{8,16}\s/i.test(line)).flatMap(line=>line.trim().split(/\s+/).slice(1));
  const candidates=[Buffer.from(words.join(''),'hex'),Buffer.concat(words.map(word=>Buffer.from(word,'hex').reverse()))].map(bytes=>bytes.toString('utf8').replace(/\0+$/,''));
  const embeddedEntitlements=parseEntitlements(candidates.find(value=>value.startsWith('<?xml')||value.startsWith('<plist'))??'','embedded-entitlements');
  cut.entitlements={signed:signedEntitlements,embedded:embeddedEntitlements};cut.group=info.ExpoWidgetsAppGroupIdentifier;
  assert.ok(cut.group&&embeddedEntitlements['com.apple.security.application-groups']?.includes(cut.group));
  assert.ok(embeddedEntitlements['application-identifier']?.endsWith(app));
  for(const key of Object.keys(signedEntitlements))if(key in embeddedEntitlements)assert.deepEqual(signedEntitlements[key],embeddedEntitlements[key]);
  cut.provenance={runHeadSource:cut.source,runEvent:cut.event,runBranch:cut.branch,actualCheckoutSource:cut.checkout,actualCheckoutTree:cut.tree,run:cut.run,artifact:cut.artifact,outerSHA256:cut.digest,innerSHA256:hash(inner),version:info.CFBundleShortVersionString,build:info.CFBundleVersion,bundleIdentifier:info.CFBundleIdentifier,executable:info.CFBundleExecutable,architecture,platform,nativeExecutableSHA256:hash(binary),javaScriptSHA256:hash(join(cut.host,'main.jsbundle')),entitlements:cut.entitlements};
  if(numeric){
   Object.assign(cut.provenance,{runAttempt:cut.attempt,outerBytes:cut.bytes,expiresAt:cut.expiresAt});
   const extensions=readdirSync(join(cut.host,'PlugIns'),{withFileTypes:true});
   assert.ok(extensions.every(entry=>entry.isDirectory()&&!entry.isSymbolicLink()));
   assert.deepEqual(extensions.map(entry=>entry.name).sort(),['ExpoWidgetsTarget.appex','PuptimeQuickLogNotification.appex']);
   cut.provenance.extensionInfoSHA256=Object.fromEntries(extensions.map(entry=>{
    const path=join(cut.host,'PlugIns',entry.name),plist=join(path,'Info.plist'),value=jsonPlist(plist);
    assert.equal(value.CFBundleShortVersionString,cut.version);assert.equal(value.CFBundleVersion,cut.build);assert.ok(value.CFBundleIdentifier.startsWith(app+'.'));
    command('codesign',['--verify','--deep','--strict',path]);return [entry.name,hash(plist)];
   }));
   cut.provenance.nativeCode=nativeCodeFingerprint(cut.host,directory);cut.provenance.infoPlistSHA256=hash(join(cut.host,'Info.plist'));
  }
 }
 if(numeric)assert.equal(command('git',['diff','--name-only',cuts[1].source,'--','src']),'','Use the exact target production sources for the imported backup validators.');
 assert.equal(command('git',['diff','--name-only',cuts[1].source,'--',...nativeInputs]),'','Driver checkout native/assets/config changed: require a newly qualified matching target; do not bypass audio/config changes.');
 assert.equal(command('git',['ls-files','--others','--exclude-standard','--',...nativeInputs]),'','Review untracked native inputs before reusing a frozen artifact.');
 assert.equal(cuts[0].group,cuts[1].group);assert.deepEqual(cuts[0].entitlements,cuts[1].entitlements,'Preserve the actual storage/keychain/AppGroup signing boundary.');
 assert.notEqual(cuts[0].provenance.javaScriptSHA256,cuts[1].provenance.javaScriptSHA256,'Use two genuinely different original app runtimes.');
 if(preparing){prepareEnrolled(cuts,output,source);return;}
 const provenance={stage:'archive-inspection',upgradeExecuted:false,driverSource:source,driverScriptSHA256:hash(new URL(import.meta.url)),runtimes:cuts.map(cut=>cut.provenance),originalArchivesUnmodified:true,exercisePreferenceContract:{theme:'dark',language:'es',reminderLeadMinutes:15,widgetActionAdded:'walk',creation:'Original older Settings UI only'},scope:numeric?'Original AACD1.12.0/build1 to ordinary candidate1.12.6/build2; numeric guest update only, no store/provider or enrolled-account qualification.':'Original older full app to original newer full app, same native1.12.0/build1; not numeric/store upgrade, old-JS injection, production-account or prior-aa4 legacy-format qualification.'};
 writeFileSync(join(output,'native-provenance.json'),JSON.stringify(provenance,null,2)+'\n');
 writeFileSync(join(output,'inspection.json'),JSON.stringify({status:'passed',...provenance},null,2)+'\n');
 if(mode==='--inspect-only'){console.log('PASS original-runtime archive inspection: '+output);return;}

 assert.equal(command('git',['status','--porcelain','--','scripts/verify-ios-runtime-upgrade.mjs','scripts/native-account-evidence.mjs','.maestro']),'','Commit the exact test driver/fixtures/flows before native execution.');
 const fixture=resolve('.maestro/fixtures/profile-test.jpg'),selectPhoto=resolve('.maestro/account-preservation/choose-photo.yaml'),preferenceFlow=resolve('.maestro/runtime-upgrade/preferences.yaml');
 assert.equal(hash(fixture),'41a3b20216a5ac7400ef8f64eb2b0dd869ef0504c97ab27f31dd32782e40b308');
 assert.ok(existsSync(selectPhoto),'Use the committed, verified real UIKit selection flow.');
 function decode(path,label){
  const png=join(privateDir,label+'.png');command('sips',['-s','format','png',path,'--out',png]);
  const bytes=readFileSync(png);assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  return {width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)};
 }
 const input=decode(fixture,'input-photo');assert.equal(input.width,32);assert.equal(input.height,32);
 const runtimes=JSON.parse(simctl('list','runtimes','-j')).runtimes;
 const runtime=runtimes.filter(value=>value.isAvailable&&value.identifier.includes('iOS-26')).at(-1);assert.ok(runtime);
 const device=simctl('create',(numeric?'Puptime Numeric Upgrade 1.12.6 ':'Puptime Runtime Replacement ')+Date.now(),'com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro',runtime.identifier);
 provenance.device={udid:device,runtime:runtime.identifier};provenance.photoFixtureSHA256=hash(fixture);provenance.photoSelectionFlowSHA256=hash(selectPhoto);provenance.preferenceFlowSHA256=hash(preferenceFlow);
 const activeStops=new Set();
 const numericMetadata=()=>{if(numeric)for(const cut of cuts)assertNumericMetadata(cut,api(`actions/runs/${cut.run}`),api(`actions/artifacts/${cut.artifact}`));};
 const runCommand=async(binary,args,timeout=120000,env=process.env)=>{
  assert.equal(task.signal,null);const child=spawn(binary,args,{detached:true,stdio:'inherit',env}),stop=ownProcess(child);activeStops.add(stop);let timedOut=false;
  const timer=setTimeout(()=>{timedOut=true;void stop();},timeout);
  try{await new Promise((resolveRun,reject)=>{child.once('error',reject);child.once('close',async status=>{const stopped=await stop();status===0&&stopped&&!timedOut&&!task.signal?resolveRun():reject(new Error('Owned native command interrupted or failed.'));});});}
  finally{clearTimeout(timer);activeStops.delete(stop);}
 };
 const flow=async(name,body)=>{
  const path=join(privateDir,name+'.yaml'),artifacts=join(privateDir,'maestro-'+name),receipt=join(output,name);let passed=false;
  writeFileSync(path,`appId: ${app}\nname: ${name}\n---\n${body}`);
  try{
   await runCommand(process.env.MAESTRO_BIN??'maestro',['--device',device,'test',path,'--test-output-dir',artifacts],600000,{...process.env,MAESTRO_CLI_NO_ANALYTICS:'1',MAESTRO_DRIVER_STARTUP_TIMEOUT:process.env.MAESTRO_DRIVER_STARTUP_TIMEOUT??'300000'});passed=true;
  }finally{
   // This guest-only exercise has no auth secrets. Keep raw driver logs private;
   // the three-day CI receipt needs only bounded synthetic visual evidence.
   mkdirSync(receipt,{recursive:true});const paths=existsSync(artifacts)?readdirSync(artifacts,{recursive:true}).map(String):[];
   let bytes=0,count=0;
   for(const file of paths.filter(file=>/(?:^|\/)(?:profile-photo|original-older-photo|native-photo-saved)\.png$/.test(file))){
    const source=join(artifacts,file),size=statSync(source).size;if(count>=4||bytes+size>4194304)continue;
    cpSync(source,join(receipt,'capture-'+count+'.png'));count++;bytes+=size;
   }
   if(!passed){
    const failure=join(receipt,'failure.png');try{simctl('io',device,'screenshot',failure);if(statSync(failure).size>4194304)rmSync(failure);}catch{/* The original driver failure remains authoritative. */}
    const hierarchy=paths.filter(file=>file.includes('hierarchy')&&/\.(json|xml)$/.test(file)).sort().at(-1);
    if(hierarchy)writeFileSync(join(receipt,'failure-hierarchy.txt'),readFileSync(join(artifacts,hierarchy)).subarray(0,262144));
   }
   writeFileSync(join(receipt,'flow.json'),JSON.stringify({name,status:passed?'passed':'failed',rawDriverLogsUploaded:false,syntheticGuestOnly:true},null,2)+'\n');
  }
 };
 const preferences=action=>`- runFlow:\n    file: ${JSON.stringify(preferenceFlow)}\n    env:\n      PREF_ACTION: ${action}\n`;
 const openProfile=`- runFlow: ${JSON.stringify(resolve('.maestro/helpers/open-account.yaml'))}\n- scrollUntilVisible:\n    element:\n      id: account.back\n    direction: UP\n    visibilityPercentage: 100\n- tapOn:\n    id: account.back\n    retryTapIfNoChange: true\n- extendedWaitUntil:\n    visible:\n      id: screen.today\n    timeout: 30000\n- tapOn:\n    id: header.puppy\n    retryTapIfNoChange: true\n- extendedWaitUntil:\n    visible:\n      id: screen.pets\n    timeout: 30000\n`;
 const showPhoto=`${openProfile}- assertVisible:\n    id: settings.puppy.photo.remove\n- assertNotVisible:\n    id: settings.puppy.photo.error\n- assertVisible:\n    id: settings.puppy.name\n    text: ^.*Runtime QA Maple$\n- takeScreenshot: profile-photo\n- stopApp\n`;
 let clockProbe,previousClock;
 const deviceClock=()=>{const clock=clockProbe.read();assertDeviceClock(clock,previousClock);previousClock=clock;return clock;};
 function snapshot(){
  if(numeric)deviceClock();
  const data=simctl('get_app_container',device,app,'data'),documents=join(data,'Documents'),shared=simctl('get_app_container',device,app,cuts[0].group);
  const db=new DatabaseSync(join(documents,'SQLite/puptime-v2.db'),{readOnly:true});let tables;
  try{assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);tables=nativeSnapshot(db);}finally{db.close();}
  assert.deepEqual(tables.local_sync_owner,[]);assert.deepEqual(tables.local_sync_outbox,[]);assert.equal(tables.events.length,12);
  assertPreferences(tables.settings);
  const photo=tables.pet_settings.find(row=>row.key==='puptime.puppyPhoto.v1');assert.ok(photo&&/^img_[a-f0-9]{32}$/.test(photo.value));
  const image=join(documents,'dog-photos',photo.value+'.jpg'),jpeg=readFileSync(image),decoded=decode(image,'saved-photo');assert.equal(jpeg.subarray(0,3).toString('hex'),'ffd8ff');assert.equal(jpeg.subarray(-2).toString('hex'),'ffd9');assert.equal(decoded.width,512);assert.equal(decoded.height,512);
  const preferences=join(shared,'Library/Preferences',cuts[0].group+'.plist');assert.ok(existsSync(preferences),'Inspect actual shared widget state.');
  const defaults=jsonPlist(preferences),widgetTimelines={};
  for(const [key,entries] of Object.entries(defaults).filter(([key])=>/^__expo_widgets_.*_timeline$/.test(key))){assert.ok(Array.isArray(entries)&&entries.length);widgetTimelines[key]=entries.map(entry=>{assert.ok(entry.props);return entry.props;});}
  assert.ok(Object.keys(widgetTimelines).length,'A real native widget snapshot must exist.');
  const files=protectedDocumentFiles(documents);
  const backups=numeric?{backups:Object.fromEntries(Object.keys(files).filter(name=>name.startsWith('activity-backups/')).map(name=>[name,readFileSync(join(documents,name),'utf8')]))}:{};
  return {tables,files,...backups,pendingWidgetFiles:documentFiles(join(shared,'ExpoWidgets/PuptimePending')),photo:{id:photo.value,jpegSHA256:hash(image),...decoded},widgetTimelines};
 }
 function installed(cut){const path=simctl('get_app_container',device,app,'app');assert.equal(hash(join(path,'main.jsbundle')),cut.provenance.javaScriptSHA256,'Run the original embedded JS, never a substituted bundle.');assert.equal(hash(join(path,cut.provenance.executable)),cut.provenance.nativeExecutableSHA256,'Run the original native executable.');if(numeric){command('codesign',['--verify','--deep','--strict',path]);assert.equal(hash(join(path,'Info.plist')),cut.provenance.infoPlistSHA256);for(const [name,digest] of Object.entries(cut.provenance.extensionInfoSHA256))assert.equal(hash(join(path,'PlugIns',name,'Info.plist')),digest);assert.deepEqual(nativeCodeFingerprint(path,mkdtempSync(join(privateDir,'installed-native-'))),cut.provenance.nativeCode);}}
 let completed=false;
 const task=installTaskCleanup(async()=>{
  const processesStopped=(await Promise.all([...activeStops].map(stop=>stop()))).every(Boolean);
  const simulator=deleteOwnedSimulator({device,privateDirectory:privateDir,preserve:!completed});
  writeFileSync(join(output,'task-cleanup.json'),JSON.stringify({status:processesStopped&&simulator.deleted?'passed':'failed',processesStopped,...simulator},null,2)+'\n');
  if(!processesStopped||!simulator.deleted)process.exitCode=1;
 });
 try{
  writeFileSync(join(output,'native-provenance.json'),JSON.stringify(provenance,null,2)+'\n');
  simctl('boot',device);await runCommand('xcrun',['simctl','bootstatus',device,'-b'],300000);simctl('ui',device,'appearance','light');
  if(numeric){clockProbe=prepareDeviceClock(privateDir,device);deviceClock();}
  numericMetadata();
  simctl('install',device,cuts[0].host);installed(cuts[0]);await runCommand('xcrun',['simctl','addmedia',device,fixture]);
  await flow('older-created-history',`- runFlow: ${JSON.stringify(resolve('.maestro/account-preservation/prepare.yaml'))}\n- runFlow:\n    file: ${JSON.stringify(resolve('.maestro/account-preservation/add-logs.yaml'))}\n    env:\n      BATCHES: '4'\n      EXPECTED_COUNT: '12'\n`);
  await flow('older-created-photo',`- runFlow: ${JSON.stringify(selectPhoto)}\n`);
  await flow('older-created-profile',`${openProfile}- tapOn:\n    id: settings.puppy.name\n    retryTapIfNoChange: true\n- tapOn:\n    id: settings.puppy.name.input\n    retryTapIfNoChange: true\n- eraseText\n- inputText: Runtime QA Maple\n- tapOn:\n    text: ^Puppy’s name$\n    childOf:\n      id: settings.puppy.name.editor\n- waitForAnimationToEnd\n- tapOn:\n    id: settings.puppy.name.save\n    enabled: true\n    retryTapIfNoChange: true\n- extendedWaitUntil:\n    notVisible:\n      id: settings.puppy.name.editor\n    timeout: 30000\n- assertNotVisible:\n    id: settings.puppy.name.error\n- assertVisible:\n    id: settings.puppy.photo.remove\n- assertNotVisible:\n    id: settings.puppy.photo.error\n- takeScreenshot: original-older-photo\n- stopApp\n`);
  await flow('older-created-preferences',preferences('seed'));
  await flow('older-cold-restart',`${numeric?'- stopApp\n':''}- launchApp:\n    permissions: {}\n${showPhoto}`);
  await flow('older-verifies-preferences',preferences('verify'));
  const before=snapshot();assert.ok(before.tables.events.some(row=>row.note==='Saved before and after sign-in'));assert.equal(before.tables.puppies[0].name,'Runtime QA Maple');
  if(numeric)assertOldDaily(before,deviceClock());
  numericMetadata();
  simctl('install',device,cuts[1].host);installed(cuts[1]);assertPreserved(before,snapshot());
  const started=numeric?deviceClock():undefined;
  await flow('newer-preserves-photo',`- launchApp:\n    permissions: {}\n${showPhoto}`);
  let firstLaunch;
  if(numeric){firstLaunch=snapshot();assertNumericUpgrade(before,firstLaunch,{started,finished:deviceClock()});}
  await flow('newer-preserves-preferences',preferences('verify'));assertPreserved(numeric?firstLaunch:before,snapshot(),{paletteChange:true});
  await flow('newer-cold-restart',`${numeric?'- stopApp\n':''}- launchApp:\n    permissions: {}\n${showPhoto}`);await flow('newer-cold-preferences',preferences('verify'));const after=snapshot();assertPreserved(numeric?firstLaunch:before,after,{paletteChange:true});
  if(numeric){deviceClock();provenance.numericUpgrade={from:'1.12.0/1',to:'1.12.6/2',deviceLocalDateAndZoneStable:true,clockProbeSourceSHA256:clockProbe.sourceSHA256,clockProbeBinarySHA256:clockProbe.binarySHA256,exactlyOneBeforeUpdateBackup:true,coldRestartAddedNoBackup:true};}
  numericMetadata();
  assert.equal(task.signal,null);
  writeFileSync(join(output,'verification.json'),JSON.stringify({status:'passed',...provenance,stage:numeric?'numeric-runtime-upgrade':'runtime-replacement',upgradeExecuted:true,checks:['Older original app UI created12 logs, note, profile name and a genuine UIKit-selected decoded512px JPEG.','Older original Settings UI persisted dark appearance, Spanish,15-minute reminder lead and walk widget action; each was verified after old/new cold restarts.','Installing the original newer app without uninstall preserved all14 tables, file bytes, photo ID/decoded bytes and widget activity state before launch.',numeric?'First launch allowed only backup_app_version, one exact before-update snapshot and the documented widget background/surface palette changes; prior backups and every other protected field survived explicit cold restart without another backup.':'Newer launch and cold restart preserved every protected field; only widget background/surface colours are explicitly allowed palette changes.'],photoInput:{sha256:hash(fixture),...input},photoSaved:after.photo,protectedStateSHA256:createHash('sha256').update(JSON.stringify(before)).digest('hex'),productionAccountsUsed:false},null,2)+'\n');
  completed=true;
  console.log('PASS original iOS runtime replacement: '+output);
 }finally{await task.run();task.dispose();}
}
if(mode==='--self-check')selfCheck();else await verify();

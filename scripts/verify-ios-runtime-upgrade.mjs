// Frozen original iOS app -> original app runtime replacement, not a store upgrade.
// --inspect-only downloads/attests only. --replace-synthetic owns a fresh simulator.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {closeSync,existsSync,mkdirSync,mkdtempSync,openSync,readFileSync,readdirSync,renameSync,writeFileSync} from 'node:fs';
import {homedir,tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {nativeSnapshot,nativeTables} from './native-account-evidence.mjs';

const repository='patrickchin/puptime',app='com.patrickchin.puptime';
const cuts=[
 {name:'older',source:'008b4a0b7f4d8a77cc8c13d95f39001534d8fd70',event:'pull_request',branch:'codex/themed-puppy-confirmation',checkout:'4de8d80dd6f31f5b3fee7da09928cd24a0bdfe4e',tree:'7e3886c23141b4cb9843782a81566cd2aa714a84',run:43263326680,artifact:13982701381,digest:'eb3e73181cc0b8e816e5414afe613be5667a4a019a206e9f103268b24a066a09'},
 {name:'newer',source:'aacd58fd0a7102a629b92dbf8813496870aec21c',event:'push',branch:'main',checkout:'aacd58fd0a7102a629b92dbf8813496870aec21c',tree:'abb69c7d347964ad7a6cd9bcce80a8472544ab2e',run:43383649287,artifact:14029395865,digest:'2e889cd3b6eea1b0ce5b878665a8d259af002a68f54e1f77a3bdf7cf13003865'},
];
const nativeInputs=['package.json','package-lock.json','app.json','app.config.*','eas.json','.npmrc','.env','plugins','patches','assets','ios'];
const [mode='--inspect-only',destination=process.env.GITHUB_ACTIONS==='true'?'build/native-runtime-replacement':join(homedir(),'Pictures/Screenshots/Codex/puptime-runtime-replacement')]=process.argv.slice(2);
assert.ok(['--inspect-only','--replace-synthetic','--self-check'].includes(mode));
const command=(binary,args,options={})=>execFileSync(binary,args,{encoding:'utf8',timeout:120000,stdio:['ignore','pipe','pipe'],...options}).trim();
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const simctl=(...args)=>command('xcrun',['simctl',...args]);
const jsonPlist=path=>JSON.parse(command('plutil',['-convert','json','-o','-',path]));
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
 const before={tables:Object.fromEntries(nativeTables.map(table=>[table,[]])),files:{'dog-photos/img_test.jpg':'original-bytes'},widgetTimelines:{quick:[{pending:[],lastEventAt:{pee:123},appearance:{light:{background:'old',surface:'old',controlRadius:12},dark:{background:'dark',surface:'dark',controlRadius:12}}}]}};
 const after=structuredClone(before);after.widgetTimelines.quick[0].appearance.light.background='new';after.widgetTimelines.quick[0].appearance.dark.surface='new';
 assertPreserved(before,after,{paletteChange:true});assert.throws(()=>assertPreserved(before,after));
 for(const mutate of [value=>value.tables.events.push({id:'changed'}),value=>value.files['dog-photos/img_test.jpg']='changed',value=>value.widgetTimelines.quick[0].pending.push({id:'unexpected'}),value=>value.widgetTimelines.quick[0].lastEventAt.pee=999,value=>value.widgetTimelines.quick[0].appearance.light.controlRadius=99,value=>value.widgetTimelines.quick[0].appearance.dark.unknown='unexpected']){
  const changed=structuredClone(after);mutate(changed);assert.throws(()=>assertPreserved(before,changed,{paletteChange:true}));
 }
 const settings=[['puptime.theme.v1','dark'],['puptime.language.v1','es'],['puptime.widgetActions.v1','["pee","poop","meal","walk"]'],['puptime.notificationPreferences.v1','{"reminderLeadMinutes":15}']].map(([key,value])=>({key,value}));
 assertPreferences(settings);assert.throws(()=>assertPreferences(settings.filter(row=>row.key!=='puptime.language.v1')));assert.throws(()=>assertPreferences(settings.map(row=>row.key==='puptime.theme.v1'?{...row,value:'"dark"'}:row)));
 console.log('PASS runtime preservation guard: only the explicit widget palette change is allowed.');
}
async function verify(){
 assert.equal(process.env.GITHUB_REPOSITORY??repository,repository);
 const output=resolve(destination);mkdirSync(output,{recursive:true});
 assert.ok(!existsSync(join(output,'verification.json'))&&!existsSync(join(output,'inspection.json')),'Use a fresh receipt directory; never mix inspection with an earlier runtime result.');
 const privateDir=mkdtempSync(join(tmpdir(),'puptime-runtime-upgrade-'));
 const cache=process.env.PUPTIME_RUNTIME_ARTIFACT_CACHE?resolve(process.env.PUPTIME_RUNTIME_ARTIFACT_CACHE):privateDir;
 mkdirSync(cache,{recursive:true});
 const api=path=>JSON.parse(command('gh',['api',`repos/${repository}/${path}`]));
 const rawFlags=command('gh',['api','--help']).includes('--allow-escape-sequences')?['--allow-escape-sequences']:[];
 const source=command('git',['rev-parse','HEAD']);
 for(const cut of cuts){
  const run=api(`actions/runs/${cut.run}`);assert.equal(run.status,'completed');assert.equal(run.conclusion,'success');
  assert.equal(run.head_sha,cut.source);assert.equal(run.head_repository?.full_name,repository);assert.equal(run.path,'.github/workflows/ios-simulator.yml');
  assert.equal(run.event,cut.event);assert.equal(run.head_branch,cut.branch);
  try{command('git',['cat-file','-e',cut.source+'^{commit}']);}catch{command('git',['fetch','--no-tags','origin',cut.source]);}
  // Checkout SHAs are pinned from each original build's actual checkout log.
  // The PR merge checkout is distinct from its head, but has the same full tree.
  const checkout=api('git/commits/'+cut.checkout);assert.equal(checkout.sha,cut.checkout);assert.equal(checkout.tree.sha,cut.tree);
  assert.equal(command('git',['rev-parse',cut.source+'^{tree}']),cut.tree,'Attest actual compiled checkout tree, not just workflow head metadata.');
  const artifact=api(`actions/artifacts/${cut.artifact}`);
  assert.equal(artifact.name,'puptime-ios-simulator');assert.equal(artifact.expired,false);assert.equal(artifact.workflow_run.id,cut.run);
  assert.equal(artifact.digest,'sha256:'+cut.digest);
  const archive=join(cache,cut.name+'-artifact.zip');
  if(!existsSync(archive)){
   const partial=archive+'.part',fd=openSync(partial,'wx',0o600);
   try{execFileSync('gh',['api',`repos/${repository}/actions/artifacts/${cut.artifact}/zip`,...rawFlags],{timeout:600000,stdio:['ignore',fd,'pipe']});}finally{closeSync(fd);}
   assert.equal(hash(partial),cut.digest,'Verify the complete download before adding it to the artifact cache.');renameSync(partial,archive);
  }
  assert.equal(hash(archive),cut.digest,'Verify exact original GitHub archive bytes, including cached files.');
  const directory=join(privateDir,cut.name);mkdirSync(directory);
  command('unzip',['-q',archive,'-d',directory]);
  const inner=join(directory,'Puptime-iOS-Simulator.zip');assert.ok(existsSync(inner));
  command('ditto',['-x','-k',inner,join(directory,'host')]);cut.host=join(directory,'host/Puptime.app');
  command('codesign',['--verify','--deep','--strict',cut.host]);
  const info=jsonPlist(join(cut.host,'Info.plist')),binary=join(cut.host,info.CFBundleExecutable);
  assert.equal(info.CFBundleIdentifier,app);assert.equal(info.CFBundleShortVersionString,'1.12.0');assert.equal(info.CFBundleVersion,'1');
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
 }
 assert.equal(command('git',['diff','--name-only',cuts[1].source,'--',...nativeInputs]),'','Driver checkout native/assets/config changed: require a newly qualified matching target; do not bypass audio/config changes.');
 assert.equal(command('git',['ls-files','--others','--exclude-standard','--',...nativeInputs]),'','Review untracked native inputs before reusing a frozen artifact.');
 assert.equal(cuts[0].group,cuts[1].group);assert.deepEqual(cuts[0].entitlements,cuts[1].entitlements,'Preserve the actual storage/keychain/AppGroup signing boundary.');
 assert.notEqual(cuts[0].provenance.javaScriptSHA256,cuts[1].provenance.javaScriptSHA256,'Use two genuinely different original app runtimes.');
 const provenance={stage:'archive-inspection',upgradeExecuted:false,driverSource:source,driverScriptSHA256:hash(new URL(import.meta.url)),runtimes:cuts.map(cut=>cut.provenance),originalArchivesUnmodified:true,exercisePreferenceContract:{theme:'dark',language:'es',reminderLeadMinutes:15,widgetActionAdded:'walk',creation:'Original older Settings UI only'},scope:'Original older full app to original newer full app, same native1.12.0/build1; not numeric/store upgrade, old-JS injection, production-account or prior-aa4 legacy-format qualification.'};
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
 const device=simctl('create','Puptime Runtime Replacement '+Date.now(),'com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro',runtime.identifier);
 provenance.device={udid:device,runtime:runtime.identifier};provenance.photoFixtureSHA256=hash(fixture);provenance.photoSelectionFlowSHA256=hash(selectPhoto);provenance.preferenceFlowSHA256=hash(preferenceFlow);
 writeFileSync(join(output,'native-provenance.json'),JSON.stringify(provenance,null,2)+'\n');
 const flow=(name,body)=>{
  const path=join(privateDir,name+'.yaml');writeFileSync(path,`appId: ${app}\nname: ${name}\n---\n${body}`);
  execFileSync(process.env.MAESTRO_BIN??'maestro',['--device',device,'test',path,'--test-output-dir',join(output,name)],{timeout:600000,stdio:'inherit',env:{...process.env,MAESTRO_CLI_NO_ANALYTICS:'1',MAESTRO_DRIVER_STARTUP_TIMEOUT:'180000'}});
 };
 const preferences=action=>`- runFlow:\n    file: ${JSON.stringify(preferenceFlow)}\n    env:\n      PREF_ACTION: ${action}\n`;
 const openProfile=`- runFlow: ${JSON.stringify(resolve('.maestro/helpers/open-account.yaml'))}\n- scrollUntilVisible:\n    element:\n      id: account.back\n    direction: UP\n    visibilityPercentage: 100\n- tapOn:\n    id: account.back\n    retryTapIfNoChange: true\n- extendedWaitUntil:\n    visible:\n      id: screen.today\n    timeout: 30000\n- tapOn:\n    id: header.puppy\n    retryTapIfNoChange: true\n- extendedWaitUntil:\n    visible:\n      id: screen.pets\n    timeout: 30000\n`;
 const showPhoto=`${openProfile}- assertVisible:\n    id: settings.puppy.photo.remove\n- assertNotVisible:\n    id: settings.puppy.photo.error\n- assertVisible: Runtime QA Maple\n- takeScreenshot: profile-photo\n- stopApp\n`;
 const files=directory=>Object.fromEntries((existsSync(directory)?readdirSync(directory,{recursive:true,withFileTypes:true}):[]).filter(entry=>entry.isFile()).map(entry=>{
  const parent=entry.parentPath??entry.path,path=join(parent,entry.name);return [path.slice(directory.length+1),hash(path)];
 }).sort(([left],[right])=>left.localeCompare(right)));
 function snapshot(){
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
  return {tables,files:Object.fromEntries(Object.entries(files(documents)).filter(([name])=>!name.startsWith('SQLite/'))),pendingWidgetFiles:files(join(shared,'ExpoWidgets/PuptimePending')),photo:{id:photo.value,jpegSHA256:hash(image),...decoded},widgetTimelines};
 }
 function installed(cut){const path=simctl('get_app_container',device,app,'app');assert.equal(hash(join(path,'main.jsbundle')),cut.provenance.javaScriptSHA256,'Run the original embedded JS, never a substituted bundle.');assert.equal(hash(join(path,cut.provenance.executable)),cut.provenance.nativeExecutableSHA256,'Run the original native executable.');}
 try{
  simctl('boot',device);command('xcrun',['simctl','bootstatus',device,'-b'],{timeout:300000});simctl('ui',device,'appearance','light');
  simctl('install',device,cuts[0].host);installed(cuts[0]);simctl('addmedia',device,fixture);
  flow('older-created-history',`- runFlow: ${JSON.stringify(resolve('.maestro/account-preservation/prepare.yaml'))}\n- runFlow:\n    file: ${JSON.stringify(resolve('.maestro/account-preservation/add-logs.yaml'))}\n    env:\n      BATCHES: '4'\n      EXPECTED_COUNT: '12'\n`);
  flow('older-created-photo',`- runFlow: ${JSON.stringify(selectPhoto)}\n`);
  flow('older-created-profile',`${openProfile}- tapOn:\n    id: settings.puppy.name\n    retryTapIfNoChange: true\n- tapOn:\n    id: settings.puppy.name.input\n    retryTapIfNoChange: true\n- eraseText\n- inputText: Runtime QA Maple\n- tapOn:\n    id: settings.puppy.name.save\n    retryTapIfNoChange: true\n- assertNotVisible:\n    id: settings.puppy.name.editor\n- assertVisible:\n    id: settings.puppy.photo.remove\n- assertNotVisible:\n    id: settings.puppy.photo.error\n- takeScreenshot: original-older-photo\n- stopApp\n`);
  flow('older-created-preferences',preferences('seed'));
  flow('older-cold-restart',`- launchApp:\n    permissions: {}\n${showPhoto}`);
  flow('older-verifies-preferences',preferences('verify'));
  const before=snapshot();assert.ok(before.tables.events.some(row=>row.note==='Saved before and after sign-in'));assert.equal(before.tables.puppies[0].name,'Runtime QA Maple');
  simctl('install',device,cuts[1].host);installed(cuts[1]);assertPreserved(before,snapshot());
  flow('newer-preserves-photo',`- launchApp:\n    permissions: {}\n${showPhoto}`);flow('newer-preserves-preferences',preferences('verify'));assertPreserved(before,snapshot(),{paletteChange:true});
  flow('newer-cold-restart',`- launchApp:\n    permissions: {}\n${showPhoto}`);flow('newer-cold-preferences',preferences('verify'));const after=snapshot();assertPreserved(before,after,{paletteChange:true});
  writeFileSync(join(output,'verification.json'),JSON.stringify({status:'passed',...provenance,stage:'runtime-replacement',upgradeExecuted:true,checks:['Older original app UI created12 logs, note, profile name and a genuine UIKit-selected decoded512px JPEG.','Older original Settings UI persisted dark appearance, Spanish,15-minute reminder lead and walk widget action; each was verified after old/new cold restarts.','Installing the original newer app without uninstall preserved all14 tables, file bytes, photo ID/decoded bytes and widget activity state before launch.','Newer launch and cold restart preserved every protected field; only widget background/surface colours are explicitly allowed palette changes.'],photoInput:{sha256:hash(fixture),...input},photoSaved:after.photo,protectedStateSHA256:createHash('sha256').update(JSON.stringify(before)).digest('hex'),productionAccountsUsed:false},null,2)+'\n');
  console.log('PASS original iOS runtime replacement: '+output);
 }finally{try{simctl('delete',device);}catch{/* Only the owned fresh simulator. */}}
}
if(mode==='--self-check')selfCheck();else await verify();

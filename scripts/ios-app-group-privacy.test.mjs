import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';

const require=createRequire(import.meta.url),xcode=require('xcode');
const plugin=require('../plugins/withIosAppGroupPrivacy.js');
const template=execFileSync('tar',['-xOf',require.resolve('expo/template.tgz'),'package/ios/HelloWorld.xcodeproj/project.pbxproj'],{maxBuffer:1024*1024});
const unquote=value=>value.replace(/^"|"$/g,'');
const resources=(project,id)=>project.pbxNativeTargetSection()[id].buildPhases.flatMap(({value})=>{
 const phase=project.hash.project.objects.PBXResourcesBuildPhase?.[value];
 return (phase?.files??[]).map(file=>unquote(project.pbxFileReferenceSection()[project.pbxBuildFileSection()[file.value].fileRef].path));
});

test('both extension manifests belong to their own resource phases without changing app resources or duplicating entries',async()=>{
 const root=mkdtempSync(join(tmpdir(),'puptime-ios-privacy-'));
 try{
  const path=join(root,'project.pbxproj');writeFileSync(path,template);
  const project=xcode.project(path);project.parseSync();
  const app=project.getFirstTarget().uuid,before=resources(project,app);
  const widget=project.addTarget('ExpoWidgetsTarget','app_extension','ExpoWidgetsTarget','example.widget');
  // Expo's target helper stores this name unquoted; xcode.addTarget quotes it.
  widget.pbxNativeTarget.name='ExpoWidgetsTarget';
  const notification=project.addTarget('PuptimeQuickLogNotification','app_extension','PuptimeQuickLogNotification','example.notification');
  project.addBuildPhase(['existing.plist'],'PBXResourcesBuildPhase','Resources',notification.uuid);
  for(const name of ['ExpoWidgetsTarget','PuptimeQuickLogNotification'])mkdirSync(join(root,name));
  const config=plugin({name:'Synthetic',slug:'synthetic'}),run=()=>config.mods.ios.xcodeproj({modRequest:{platformProjectRoot:root},modResults:project});
  await run();
  assert.deepEqual(resources(project,app),before);
  assert.deepEqual(resources(project,widget.uuid),['ExpoWidgetsTarget/PrivacyInfo.xcprivacy']);
  assert.deepEqual(resources(project,notification.uuid),['existing.plist','PuptimeQuickLogNotification/PrivacyInfo.xcprivacy']);
  const bytes=readFileSync(new URL('../plugins/ios-widget/PrivacyInfo.xcprivacy',import.meta.url));
  const manifest=JSON.parse(JSON.stringify(require('@expo/plist').default.parse(bytes.toString())));
  assert.deepEqual(manifest,JSON.parse(readFileSync(new URL('../app.json',import.meta.url))).expo.ios.privacyManifests);
  assert.deepEqual(manifest.NSPrivacyAccessedAPITypes,[{NSPrivacyAccessedAPIType:'NSPrivacyAccessedAPICategoryUserDefaults',NSPrivacyAccessedAPITypeReasons:['1C8F.1']}]);
  for(const name of ['ExpoWidgetsTarget','PuptimeQuickLogNotification'])assert.deepEqual(readFileSync(join(root,name,'PrivacyInfo.xcprivacy')),bytes);
  const once=project.writeSync();await run();assert.equal(project.writeSync(),once);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('a missing extension target fails instead of assigning its declaration to the app',async()=>{
 const root=mkdtempSync(join(tmpdir(),'puptime-ios-privacy-'));
 try{
  const path=join(root,'project.pbxproj');writeFileSync(path,template);
  const project=xcode.project(path);project.parseSync();const before=project.writeSync();
  const config=plugin({name:'Synthetic',slug:'synthetic'});
  await assert.rejects(config.mods.ios.xcodeproj({modRequest:{platformProjectRoot:root},modResults:project}),/require both extension targets/);
  assert.equal(project.writeSync(),before);
 }finally{rmSync(root,{recursive:true,force:true});}
});

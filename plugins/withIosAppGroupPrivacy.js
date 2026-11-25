const {withXcodeProject}=require('expo/config-plugins');
const {copyFileSync}=require('node:fs');
const {join}=require('node:path');

// Both extensions use WidgetsStorage's same-App-Group UserDefaults. The app's
// matching reason is configured through Expo's ios.privacyManifests field.
module.exports=config=>withXcodeProject(config,mod=>{
 const project=mod.modResults;
 for(const name of ['ExpoWidgetsTarget','PuptimeQuickLogNotification']){
  const target=project.findTargetKey(name)??project.findTargetKey(JSON.stringify(name));
  if(!target)throw new Error('Puptime privacy declarations require both extension targets. Keep this plugin before their plugins.');
  const resource=`${name}/PrivacyInfo.xcprivacy`;
  copyFileSync(join(__dirname,'ios-widget/PrivacyInfo.xcprivacy'),join(mod.modRequest.platformProjectRoot,resource));
  if(!project.buildPhase('Resources',target))project.addBuildPhase([],'PBXResourcesBuildPhase','Resources',target);
  const file=project.addFile(resource,project.getFirstProject().firstProject.mainGroup);
  if(file){
   file.uuid=project.generateUuid();file.target=target;
   project.addToPbxBuildFileSection(file);project.addToPbxResourcesBuildPhase(file);
  }
 }
 return mod;
});

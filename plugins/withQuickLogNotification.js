const {withDangerousMod,withXcodeProject}=require('expo/config-plugins');
const fs=require('fs'),path=require('path');
const name='PuptimeQuickLogNotification',group='group.com.patrickchin.puptime';
module.exports=function withQuickLogNotification(config){
  const bundle=`${config.ios.bundleIdentifier}.quicklog-notification`;
  const eas=require('expo-widgets/plugin/build/ios/withEasConfig').default;
  config=eas(config,{targetName:name,bundleIdentifier:bundle,groupIdentifier:group});
  config=withDangerousMod(config,['ios',async mod=>{
    const folder=path.join(mod.modRequest.platformProjectRoot,name);fs.mkdirSync(folder,{recursive:true});
    const plist=require('@expo/plist').default;
    fs.writeFileSync(path.join(folder,'Info.plist'),plist.build({CFBundleDisplayName:'Puptime',CFBundleIdentifier:'$(PRODUCT_BUNDLE_IDENTIFIER)',CFBundleExecutable:'$(EXECUTABLE_NAME)',CFBundleName:'$(PRODUCT_NAME)',CFBundlePackageType:'XPC!',CFBundleShortVersionString:'$(MARKETING_VERSION)',CFBundleVersion:'$(CURRENT_PROJECT_VERSION)',ExpoWidgetsAppGroupIdentifier:group,NSExtension:{NSExtensionPointIdentifier:'com.apple.usernotifications.content-extension',NSExtensionPrincipalClass:'$(PRODUCT_MODULE_NAME).QuickLogNotificationController',NSExtensionAttributes:{UNNotificationExtensionCategory:'puptimeQuickLog',UNNotificationExtensionInitialContentSizeRatio:0.45,UNNotificationExtensionDefaultContentHidden:true,UNNotificationExtensionUserInteractionEnabled:true,UNNotificationExtensionOverridesDefaultTitle:true}}}));
    fs.writeFileSync(path.join(folder,`${name}.entitlements`),plist.build({'com.apple.security.application-groups':[group]}));
    fs.copyFileSync(path.join(__dirname,'ios-widget/PuptimeQuickLogNotification.swift'),path.join(folder,'QuickLogNotification.swift'));
    const library=path.dirname(require.resolve('expo-widgets/package.json'));
    // Foundation-only shared storage, journal and reminder bridge; this target
    // needs no React Native runtime or JS engine to save a notification tap.
    fs.copyFileSync(path.join(library,'ios/WidgetsStorage.swift'),path.join(folder,'SharedWidgetStorage.swift'));
    return mod;
  }]);
  return withXcodeProject(config,mod=>{
    const project=mod.modResults;
    if(project.pbxTargetByName(name))return mod;
    const target=project.addTarget(name,'app_extension',name,bundle);
    const sources=[`${name}/QuickLogNotification.swift`,`${name}/SharedWidgetStorage.swift`];
    project.addBuildPhase(sources,'PBXSourcesBuildPhase','Sources',target.uuid);
    project.addBuildPhase([],'PBXFrameworksBuildPhase','Frameworks',target.uuid);
    project.addBuildPhase([],'PBXResourcesBuildPhase','Resources',target.uuid);
    project.addTargetDependency(project.getFirstTarget().uuid,[target.uuid]);
    const list=project.pbxXCConfigurationList()[target.pbxNativeTarget.buildConfigurationList];
    for(const {value} of list.buildConfigurations){Object.assign(project.pbxXCBuildConfigurationSection()[value].buildSettings,{
      // The protocol alone does not retain this framework. Its runtime context
      // class must be loaded before ExtensionKit starts the content extension.
      OTHER_LDFLAGS:'"$(inherited) -Wl,-needed_framework,UserNotificationsUI"',
      INFOPLIST_FILE:`${name}/Info.plist`,CODE_SIGN_ENTITLEMENTS:`${name}/${name}.entitlements`,SWIFT_VERSION:'5.0',IPHONEOS_DEPLOYMENT_TARGET:'16.4',TARGETED_DEVICE_FAMILY:'"1,2"',APPLICATION_EXTENSION_API_ONLY:'YES',MARKETING_VERSION:config.version,CURRENT_PROJECT_VERSION:config.ios.buildNumber??'1',GENERATE_INFOPLIST_FILE:'NO',CLANG_ENABLE_MODULES:'YES',SWIFT_OPTIMIZATION_LEVEL:'"-Onone"',DEVELOPMENT_TEAM:config.ios.appleTeamId??'""',
    });}
    return mod;
  });
};

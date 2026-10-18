const {getDefaultConfig}=require('expo/metro-config');
const path=require('node:path');
const root=path.resolve(__dirname,'../..'),config=getDefaultConfig(root),previous=config.resolver.resolveRequest;
config.resolver.resolveRequest=(context,moduleName,platform)=>{
 if(context.originModulePath===path.join(root,'src/reminders.ts')&&moduleName==='expo-notifications')return {type:'sourceFile',filePath:path.join(__dirname,'notifications.js')};
 return (previous||context.resolveRequest)(context,moduleName,platform);
};
config.cacheVersion='puptime-notification-delivery-qualification-v1';
module.exports=config;

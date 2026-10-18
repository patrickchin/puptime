const {getDefaultConfig}=require('expo/metro-config');
const path=require('node:path');
const root=path.resolve(__dirname,'../..'),config=getDefaultConfig(root),previous=config.resolver.resolveRequest;
config.resolver.resolveRequest=(context,moduleName,platform)=>{
 if(context.originModulePath===path.join(root,'src/local/runtime.ios.ts')&&moduleName==='./open.native')return {type:'sourceFile',filePath:path.join(__dirname,'open-probe.js')};
 if(context.originModulePath===path.join(root,'src/local/open.native.ts')&&moduleName==='expo-sqlite')return {type:'sourceFile',filePath:path.join(__dirname,'sqlite-sdk-probe.js')};
 return (previous||context.resolveRequest)(context,moduleName,platform);
};
config.transformer.babelTransformerPath=path.join(__dirname,'transformer.cjs');
config.cacheVersion='puptime-native-activity-qualification-v1';
module.exports=config;

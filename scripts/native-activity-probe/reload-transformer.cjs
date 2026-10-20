const path=require('node:path'),root=path.resolve(__dirname,'../..');
const upstream=require(root+'/node_modules/@expo/metro-config/build/babel-transformer.js');
const observer=path.join(__dirname,'reload-probe');
function replaceOnce(source,marker,replacement){
 if(source.split(marker).length!==2)throw new Error('History Reload diagnostic target changed.');
 return source.replace(marker,replacement);
}
module.exports={...upstream,transform(args){
 const file=path.resolve(root,args.filename);let source=args.src;
 if(file===root+'/src/components/EventHistoryPanel.tsx'){
  source=replaceOnce(source,' const reload=()=>{\n  if(savingRef.current)return;'," const reload=()=>{\n  recordReload('handler',{savingRef:savingRef.current,selected:!!selectedRef.current});\n  if(savingRef.current)return;");
  source=replaceOnce(source,' const previousIdentity=useRef(identityKey),previousRefresh=useRef(refreshToken);'," useEffect(()=>{recordReload('state',{selected:!!selected,confirm,changed,saving});},[selected,confirm,changed,saving]);\n const previousIdentity=useRef(identityKey),previousRefresh=useRef(refreshToken);");
  source=replaceOnce(source,"testID={confirm?'history.confirm':'history.detail'} contentContainerStyle", "testID={confirm?'history.confirm':'history.detail'} onTouchStart={event=>recordReload('touch-start',{x:event.nativeEvent.pageX,y:event.nativeEvent.pageY})} onTouchEnd={event=>recordReload('touch-end',{x:event.nativeEvent.pageX,y:event.nativeEvent.pageY})} contentContainerStyle");
 }else if(file===root+'/src/components/AccountSignIn.tsx'){
  source=replaceOnce(source,'disabled={disabled} onPress={onPress} style=',"disabled={disabled} onPressIn={()=>{if(testID==='history.reload')recordReload('press-in',{disabled});}} onPressOut={()=>{if(testID==='history.reload')recordReload('press-out',{disabled});}} onPress={()=>{if(testID==='history.reload')recordReload('press',{disabled});onPress();}} style=");
 }
 if(source!==args.src)source='import {recordReload} from '+JSON.stringify(observer)+';\n'+source;
 return upstream.transform({...args,src:source});
}};

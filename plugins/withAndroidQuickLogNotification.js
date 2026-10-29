const {withDangerousMod}=require('expo/config-plugins');
const fs=require('fs'),path=require('path');
module.exports=config=>withDangerousMod(config,['android',async mod=>{
  const root=path.dirname(require.resolve('react-native-android-widget/package.json'));
  const java=path.join(root,'android/src/main/java/com/reactnativeandroidwidget');
  const modulePath=path.join(java,'AndroidWidgetModule.java');
  let source=fs.readFileSync(modulePath,'utf8').replace(/\r\n/g,'\n');
  if(!source.includes('void drawQuickLogNotification(')){
    const anchor='    @ReactMethod\n    public void drawWidget(';
    if(!source.includes(anchor))throw Error('Android widget module changed; review notification renderer.');
    source=source.replace(anchor,`    @ReactMethod
    public void drawQuickLogNotification(ReadableMap config, String title, Promise promise) {
        com.facebook.react.bridge.UiThreadUtil.runOnUiThread(() -> {
            try { PuptimeQuickLogNotification.show(getReactApplicationContext(), config, title); promise.resolve(null); }
            catch (Exception error) { promise.reject("E_QUICK_LOG_NOTIFICATION", error); }
        });
    }

${anchor}`);
    fs.writeFileSync(modulePath,source);
  }
  const specPath=path.join(root,'src/NativeAndroidWidget.ts');
  source=fs.readFileSync(specPath,'utf8');
  if(!source.includes('drawQuickLogNotification(')){
    const anchor='export interface Spec extends TurboModule {';
    if(!source.includes(anchor))throw Error('Android widget spec changed.');
    fs.writeFileSync(specPath,source.replace(anchor,anchor+'\n  drawQuickLogNotification(config: Object, title: string): Promise<void>;'));
  }
  const facadePath=path.join(root,'src/AndroidWidget.ts');
  let facade=fs.readFileSync(facadePath,'utf8');
  if(!facade.includes('drawQuickLogNotification:'))fs.writeFileSync(facadePath,facade.replace('const noopModule: Spec = {','const noopModule: Spec = {\n  drawQuickLogNotification: () => Promise.resolve(),'));
  const widgetPath=path.join(java,'RNWidget.java');
  source=fs.readFileSync(widgetPath,'utf8');
  const anchor='    public void drawWidgets()';
  const renderer=fs.readFileSync(path.join(__dirname,'android-notification/notification-views.java'),'utf8')+'\n';
  const previous=source.indexOf('    public RemoteViews notificationViews(');
  const end=source.indexOf(anchor,previous<0?0:previous);
  if(end<0)throw Error('Android widget renderer changed.');
  source=previous<0?source.replace(anchor,renderer+anchor):source.slice(0,previous)+renderer+source.slice(end);
  // Only the click overlay has a rootWidget parameter. Collection layouts keep
  // their launcher sizing; notifications use the bitmap's measured bounds.
  const width='RNWidgetUtil.dpToPx(appContext, RNWidgetUtil.getWidgetWidth(appContext, widgetId))';
  const notificationWidth=`(widgetId < 0 ? rootWidget.getWidth() : ${width})`;
  source=source.replaceAll(notificationWidth,width);
  const start=source.indexOf('    private void addClickableArea(');
  const finish=source.indexOf('    private void registerClickTask(',start);
  if(start<0||finish<0)throw Error('Android widget click overlay changed.');
  let clicks=source.slice(start,finish).replace(width+' - offsetViewBounds.right,',notificationWidth+' - offsetViewBounds.right,');
  const bounds='        rootWidget.offsetDescendantRectToMyCoords(clickableWidget, offsetViewBounds);';
  if(!clicks.includes('widgetId < 0 && rootWidget.getHeight()'))clicks=clicks.replace(bounds,bounds+`
        if (widgetId < 0 && rootWidget.getHeight() <= RNWidgetUtil.dpToPx(appContext, 48)) {
            offsetViewBounds.top = 0;
            offsetViewBounds.bottom = rootWidget.getHeight();
        }`);
  source=source.slice(0,start)+clicks+source.slice(finish);
  fs.writeFileSync(widgetPath,source);
  fs.copyFileSync(path.join(__dirname,'android-notification/PuptimeQuickLogNotification.java'),path.join(java,'PuptimeQuickLogNotification.java'));
  return mod;
}]);

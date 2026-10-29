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
  if(!source.includes('RemoteViews notificationViews('))source=source.replace('    public void drawWidgets()',fs.readFileSync(path.join(__dirname,'android-notification/notification-views.java'),'utf8')+'\n    public void drawWidgets()');
  // Notification surfaces have no AppWidgetManager size. Use the rendered
  // bounds for their overlay geometry; launcher widgets retain their sizing.
  source=source.replace('RNWidgetUtil.dpToPx(appContext, RNWidgetUtil.getWidgetWidth(appContext, widgetId)) - offsetViewBounds.right,',
    '(widgetId < 0 ? rootWidget.getWidth() : RNWidgetUtil.dpToPx(appContext, RNWidgetUtil.getWidgetWidth(appContext, widgetId))) - offsetViewBounds.right,');
  fs.writeFileSync(widgetPath,source);
  fs.copyFileSync(path.join(__dirname,'android-notification/PuptimeQuickLogNotification.java'),path.join(java,'PuptimeQuickLogNotification.java'));
  return mod;
}]);

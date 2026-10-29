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
  // Remove old absolute notification coordinates when re-running prebuild.
  const width='RNWidgetUtil.dpToPx(appContext, RNWidgetUtil.getWidgetWidth(appContext, widgetId))';
  source=source.replaceAll(`(widgetId < 0 ? rootWidget.getWidth() : ${width})`,width);
  fs.writeFileSync(widgetPath,source);
  fs.copyFileSync(path.join(__dirname,'android-notification/PuptimeQuickLogNotification.java'),path.join(java,'PuptimeQuickLogNotification.java'));
  const resources=path.join(root,'android/src/main/res');
  for(const compact of [true,false]){
    const variant=compact?'compact':'expanded',gap=compact?4:7,height=compact?48:112;
    fs.mkdirSync(path.join(resources,'drawable'),{recursive:true});
    fs.writeFileSync(path.join(resources,'drawable',`puptime_notification_gap_${variant}.xml`),`<shape xmlns:android="http://schemas.android.com/apk/res/android"><size android:width="${gap}dp"/><solid android:color="@android:color/transparent"/></shape>`);
    for(const night of [false,true]){
      const folder=path.join(resources,night?'layout-night':'layout');fs.mkdirSync(folder,{recursive:true});
      const visibility=dark=>dark===night?'visible':'gone';
      const cells=Array.from({length:4},(_,slot)=>`<FrameLayout android:id="@+id/puptime_notification_cell_${slot}" android:layout_width="0dp" android:layout_weight="1" android:layout_height="match_parent" android:foreground="?android:attr/selectableItemBackground">
        ${[false,true].map(dark=>`<ImageView android:id="@+id/puptime_notification_${dark?'dark':'light'}_${slot}" android:layout_width="match_parent" android:layout_height="match_parent" android:layout_marginTop="${compact?4:0}dp" android:layout_marginBottom="${compact?4:0}dp" android:scaleType="fitXY" android:visibility="${visibility(dark)}" android:importantForAccessibility="no"/>`).join('')}
        <FrameLayout android:id="@+id/puptime_notification_timer_${slot}" android:layout_width="match_parent" android:layout_height="match_parent" android:importantForAccessibility="noHideDescendants">
          ${[false,true].map(dark=>`<Chronometer android:id="@+id/puptime_notification_${dark?'dark_clock':'clock'}_${slot}" android:layout_width="match_parent" android:layout_height="wrap_content" android:gravity="center_horizontal" android:singleLine="true" android:ellipsize="end" android:textStyle="bold" android:autoSizeTextType="uniform" android:autoSizeMinTextSize="7sp" android:autoSizeMaxTextSize="${compact?9:11}sp" android:autoSizeStepGranularity="1sp" android:visibility="${visibility(dark)}"/>`).join('')}
        </FrameLayout>
      </FrameLayout>`).join('');
      fs.writeFileSync(path.join(folder,`puptime_notification_${variant}.xml`),`<FrameLayout xmlns:android="http://schemas.android.com/apk/res/android" android:layout_width="match_parent" android:layout_height="${height}dp">
        ${[false,true].map(dark=>`<ImageView android:id="@+id/rn_widget_image_${dark?'dark':'light'}" android:layout_width="match_parent" android:layout_height="match_parent" android:scaleType="fitXY" android:visibility="${visibility(dark)}" android:importantForAccessibility="no"/>`).join('')}
        <LinearLayout android:layout_width="match_parent" android:layout_height="match_parent" android:orientation="horizontal" android:paddingStart="${gap}dp" android:paddingEnd="${gap}dp" android:paddingTop="${compact?0:gap}dp" android:paddingBottom="${compact?0:gap}dp" android:divider="@drawable/puptime_notification_gap_${variant}" android:showDividers="middle">${cells}</LinearLayout>
      </FrameLayout>`);
    }
  }
  return mod;
}]);

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
  fs.mkdirSync(path.join(resources,'drawable'),{recursive:true});
  // Monochrome native symbols match the quieter treatment of the iOS notification.
  for(const [name,data] of Object.entries(require('./android-notification/icons.json'))){
    fs.writeFileSync(path.join(resources,'drawable',`puptime_notification_icon_${name.toLowerCase()}.xml`),`<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="24dp" android:height="24dp" android:viewportWidth="24" android:viewportHeight="24"><path android:pathData="${data}" android:fillColor="@android:color/transparent" android:strokeColor="#000000" android:strokeWidth="1.8" android:strokeLineCap="round" android:strokeLineJoin="round"/></vector>`);
  }
  fs.writeFileSync(path.join(resources,'drawable','puptime_notification_tile.xml'),`<shape xmlns:android="http://schemas.android.com/apk/res/android"><solid android:color="#EAEEF0"/><corners android:radius="14dp"/></shape>`);
  fs.writeFileSync(path.join(resources,'drawable','puptime_notification_expanded_tile.xml'),`<shape xmlns:android="http://schemas.android.com/apk/res/android"><solid android:color="#EAEEF0"/><corners android:radius="16dp"/></shape>`);
  for(const compact of [true,false]){
    const variant=compact?'compact':'expanded';
    for(const night of [false,true]){
      const background=compact?'puptime_notification_tile':'puptime_notification_expanded_tile';
      const panel=(slot,dark)=>{
        const mode=dark?'dark':'light';
        const icon=`<ImageView android:id="@+id/puptime_notification_${mode}_icon_${slot}" android:layout_width="${compact?12:14}dp" android:layout_height="${compact?12:14}dp" android:scaleType="fitCenter" ${compact?'android:layout_marginEnd="4dp"':'android:layout_marginStart="8dp"'}/>`;
        const label=`<TextView android:id="@+id/puptime_notification_${mode}_label_${slot}" android:layout_width="${compact?'wrap_content':'0dp'}" ${compact?'':'android:layout_weight="1"'} android:layout_height="wrap_content" android:textSize="${compact?14:16}sp" android:fontFamily="sans-serif-medium" android:maxLines="${compact?1:2}" android:ellipsize="end" android:includeFontPadding="false"/>`;
        return `<LinearLayout android:id="@+id/puptime_notification_${mode}_panel_${slot}" android:layout_width="match_parent" android:layout_height="match_parent" android:visibility="${dark===night?'visible':'gone'}" android:orientation="vertical" android:gravity="${compact?'center':'center_vertical'}" android:paddingHorizontal="${compact?4:16}dp" android:background="@drawable/${background}" android:importantForAccessibility="noHideDescendants">
          <LinearLayout android:layout_width="match_parent" android:layout_height="wrap_content" android:orientation="horizontal" android:gravity="${compact?'center':'center_vertical'}">
            ${compact?icon+label:label+icon}
          </LinearLayout>
          <TextView android:id="@+id/puptime_notification_${mode}_empty_${slot}" android:layout_width="match_parent" android:layout_height="wrap_content" android:layout_marginTop="8dp" android:text="Never" android:textSize="12sp" android:singleLine="true" android:visibility="${compact?'gone':'visible'}"/>
          <Chronometer android:id="@+id/puptime_notification_${mode}_clock_${slot}" android:layout_width="match_parent" android:layout_height="wrap_content" android:layout_marginTop="8dp" android:textSize="12sp" android:singleLine="true" android:ellipsize="end" android:visibility="gone"/>
        </LinearLayout>`;
      };
      const cell=slot=>`<FrameLayout android:id="@+id/puptime_notification_cell_${slot}" android:layout_width="0dp" android:layout_weight="1" android:layout_height="match_parent" android:background="@drawable/${background}" android:foreground="?android:attr/selectableItemBackground" android:clipToOutline="true" android:focusable="true" android:importantForAccessibility="yes">${panel(slot,false)}${panel(slot,true)}</FrameLayout>`;
      const row=(slots,second=false)=>{
        const spacer=`<TextView ${second?'android:id="@+id/puptime_notification_second_gap"':''} android:layout_width="8dp" android:layout_height="1dp" android:importantForAccessibility="no"/>`;
        return `<LinearLayout android:id="@+id/puptime_notification_${second?'second':'first'}_row" android:layout_width="match_parent" android:layout_height="${compact?'48dp':'wrap_content'}" android:minHeight="${compact?48:64}dp" android:orientation="horizontal" ${second?'android:layout_marginTop="8dp" android:visibility="gone"':''}>${slots.map(cell).join(spacer)}</LinearLayout>`;
      };
      const folder=path.join(resources,night?'layout-night':'layout');fs.mkdirSync(folder,{recursive:true});
      fs.writeFileSync(path.join(folder,`puptime_notification_${variant}.xml`),`<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android" android:layout_width="match_parent" android:layout_height="wrap_content" android:orientation="vertical" android:paddingHorizontal="${compact?0:8}dp" android:paddingBottom="${compact?0:16}dp">
        ${row(compact?[0,1,2]:[0,1])}${row(compact?[3]:[2,3],true)}
      </LinearLayout>`);
    }
  }
  return mod;
}]);

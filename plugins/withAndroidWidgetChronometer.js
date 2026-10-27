const { withAndroidManifest, withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

function insertOnce(source, anchor, replacement) {
  if (source.includes(replacement)) return source;
  if (!source.includes(anchor)) {
    throw new Error('The Android widget library changed; check the Puptime widget integration.');
  }
  return source.replace(anchor, replacement);
}

module.exports = function withAndroidWidgetChronometer(config) {
  config = withAndroidManifest(config, (modConfig) => {
    const receiver = modConfig.modResults.manifest.application?.[0]?.receiver
      ?.find(item => item.$['android:name'].endsWith('.widget.PuptimeQuickLog'));
    if (!receiver) throw new Error('Puptime could not find its Android widget receiver.');
    const actions = receiver['intent-filter'][0].action;
    for (const name of ['android.intent.action.TIME_SET', 'android.intent.action.TIMEZONE_CHANGED']) {
      if (!actions.some(action => action.$['android:name'] === name)) actions.push({ $: { 'android:name': name } });
    }
    return modConfig;
  });
  return withDangerousMod(config, ['android', async (modConfig) => {
    const library = path.dirname(require.resolve('react-native-android-widget/package.json', {
      paths: [modConfig.modRequest.projectRoot],
    }));
    const nativeRoot = path.join(library, 'android/src/main');
    const javaRoot = path.join(nativeRoot, 'java/com/reactnativeandroidwidget');

    // Keep the bitmap layout and click targets; only elapsed labels run in the launcher.
    const widgetPath = path.join(javaRoot, 'RNWidget.java');
    let source = fs.readFileSync(widgetPath, 'utf8').replace(/\r\n/g, '\n');
    source = insertOnce(source, '        if (dark != null) {', '        View darkRoot = null;\n        if (dark != null) {');
    source = insertOnce(source, '            Bitmap darkBitmap =', '            darkRoot = darkWidgetWithViews.getRootView();\n            Bitmap darkBitmap =');
    if (!source.includes('PuptimeWidgetChronometers.add(appContext,')) {
      source = insertOnce(source, '        AppWidgetManager.getInstance(appContext)',
        '        PuptimeWidgetChronometers.add(appContext, remoteWidgetView, widgetWithViews.getRootView(), darkRoot);\n\n        AppWidgetManager.getInstance(appContext)');
    }
    // Extras do not distinguish PendingIntents. Millisecond request codes can
    // collide between buttons, and CANCEL_CURRENT invalidates launcher targets.
    source = insertOnce(source, '        PendingIntent pendingIntent = PendingIntent.getBroadcast(',
      `        intent.setData(new android.net.Uri.Builder()
            .scheme("puptime-widget").authority(widgetName)
            .appendPath(String.valueOf(id)).appendPath(clickableView.getId()).build());
        intent.addFlags(Intent.FLAG_RECEIVER_FOREGROUND);
        PendingIntent pendingIntent = PendingIntent.getBroadcast(`);
    source = source.replace('(int) System.currentTimeMillis(),', 'id,')
      .replace('PendingIntent.FLAG_CANCEL_CURRENT\n                | PendingIntent.FLAG_MUTABLE',
        'PendingIntent.FLAG_UPDATE_CURRENT\n                | PendingIntent.FLAG_IMMUTABLE');
    // Puptime has at most four buttons. Keep them in the XML hierarchy so a
    // refresh never removes the View receiving a DOWN/UP gesture.
    source = source.replace('R.layout.rn_widget);', 'R.layout.puptime_widget);')
      .replace('        remoteWidgetView.removeAllViews(R.id.rn_widget_clickable_container);',
        '        PuptimeWidgetClicks.showSlots(remoteWidgetView, widgetWithViews.getClickableViews().size());');
    source = source.replace('addClickableArea(remoteWidgetView, rootView, clickableView, widgetId);',
      'addClickableArea(remoteWidgetView, rootView, clickableView, widgetId, i);')
      .replace('ClickableView clickableView, int widgetId) {', 'ClickableView clickableView, int widgetId, int slot) {');
    const areaStart = source.indexOf('    private void addClickableArea(');
    const areaEnd = source.indexOf('    private void registerClickTask(', areaStart);
    if (areaStart < 0 || areaEnd < 0) throw new Error('The Android widget click builder changed.');
    source = source.slice(0, areaStart) + source.slice(areaStart, areaEnd)
      .replace('new RemoteViews(appContext.getPackageName(), R.layout.rn_widget_clickable)', 'widgetView')
      .replaceAll('R.id.rn_widget_clickable_positioner', 'PuptimeWidgetClicks.positioner(slot)')
      .replaceAll('R.id.rn_widget_clickable_area', 'PuptimeWidgetClicks.area(slot)')
      .replace('        widgetView.addView(R.id.rn_widget_clickable_container, clickableRemoteView);', '') + source.slice(areaEnd);
    fs.writeFileSync(widgetPath, source);
    fs.copyFileSync(path.join(__dirname, 'android-widget/PuptimeWidgetClicks.java'),
      path.join(javaRoot, 'PuptimeWidgetClicks.java'));
    const clickableLayout = fs.readFileSync(path.join(nativeRoot, 'res/layout/rn_widget_clickable.xml'), 'utf8');
    for (let slot = 0; slot < 4; slot++) {
      fs.writeFileSync(path.join(nativeRoot, `res/layout/puptime_widget_clickable_${slot}.xml`),
        clickableLayout.replaceAll('rn_widget_clickable_area', `puptime_widget_clickable_${slot}`)
          .replaceAll('rn_widget_clickable_positioner', `puptime_widget_positioner_${slot}`));
    }

    const providerPath = path.join(javaRoot, 'RNWidgetProvider.java');
    source = fs.readFileSync(providerPath, 'utf8').replace(/\r\n/g, '\n');
    source = insertOnce(source, '            additionalData = new Data.Builder()',
      '            clickActionData.putDouble("tapAt", System.currentTimeMillis());\n            additionalData = new Data.Builder()');
    source = insertOnce(source, '        super.onReceive(context, incomingIntent);',
      `        super.onReceive(context, incomingIntent);
        if (Intent.ACTION_TIME_CHANGED.equals(incomingIntent.getAction())
                || Intent.ACTION_TIMEZONE_CHANGED.equals(incomingIntent.getAction())) {
            AppWidgetManager manager = AppWidgetManager.getInstance(context);
            onUpdate(context, manager, manager.getAppWidgetIds(new android.content.ComponentName(context, getClass())));
            return;
        }`);
    fs.writeFileSync(providerPath, source);

    const workerPath = path.join(javaRoot, 'oss/HeadlessJsTaskWorker.java');
    source = fs.readFileSync(workerPath, 'utf8').replace(/\r\n/g, '\n');
    source = insertOnce(source, '        if (reactContext == null) {',
      '        if (reactContext == null || !reactContext.hasActiveReactInstance()) {');
    fs.writeFileSync(workerPath, source);

    const textPath = path.join(javaRoot, 'builder/widget/TextWidget.java');
    source = fs.readFileSync(textPath, 'utf8').replace(/\r\n/g, '\n');
    const colorAnchor = '        view.setTextColor(Color.parseColor(getString("color", "#000000")));';
    source = insertOnce(source, colorAnchor,
      `${colorAnchor}\n        com.reactnativeandroidwidget.PuptimeWidgetChronometers.prepare(view, props);`);
    fs.writeFileSync(textPath, source);
    fs.copyFileSync(path.join(__dirname, 'android-widget/PuptimeWidgetChronometers.java'),
      path.join(javaRoot, 'PuptimeWidgetChronometers.java'));

    for (const qualifier of ['layout', 'layout-night']) {
      const layoutRoot = path.join(nativeRoot, 'res', qualifier);
      fs.mkdirSync(layoutRoot, { recursive: true });
      const rootPath = path.join(layoutRoot, 'rn_widget.xml');
      source = fs.readFileSync(rootPath, 'utf8').replace(/\r\n/g, '\n');
      const anchor = '    <FrameLayout\n        android:id="@+id/rn_widget_clickable_container"';
      source = insertOnce(source, anchor,
        '    <FrameLayout\n        android:id="@+id/puptime_chronometers"\n        android:layout_width="match_parent"\n        android:layout_height="match_parent" />\n\n' + anchor);
      fs.writeFileSync(rootPath, source);
      const clickableContainer = `${anchor}\n        android:layout_width="match_parent"\n        android:layout_height="match_parent" />`;
      const staticButtons = `${anchor}\n        android:layout_width="match_parent"\n        android:layout_height="match_parent">\n${Array.from({ length: 4 }, (_, slot) => `        <include layout="@layout/puptime_widget_clickable_${slot}" />`).join('\n')}\n    </FrameLayout>`;
      fs.writeFileSync(path.join(layoutRoot, 'puptime_widget.xml'), insertOnce(source, clickableContainer, staticButtons));
      const isDark = qualifier === 'layout-night';
      fs.writeFileSync(path.join(layoutRoot, 'puptime_chronometer.xml'), `
<FrameLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:id="@+id/puptime_chronometer_positioner"
    android:layout_width="match_parent" android:layout_height="match_parent">
    <FrameLayout android:id="@+id/puptime_chronometer_bounds"
        android:layout_width="match_parent" android:layout_height="wrap_content">
        <Chronometer android:id="@+id/puptime_chronometer_light"
            android:layout_width="match_parent" android:layout_height="match_parent"
            android:gravity="center" android:maxLines="1" android:textStyle="bold"
            android:visibility="${isDark ? 'gone' : 'visible'}" />
        <Chronometer android:id="@+id/puptime_chronometer_dark"
            android:layout_width="match_parent" android:layout_height="match_parent"
            android:gravity="center" android:maxLines="1" android:textStyle="bold"
            android:visibility="${isDark ? 'visible' : 'gone'}" />
    </FrameLayout>
</FrameLayout>
`);
    }
    return modConfig;
  }]);
};

const { withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

function insertOnce(source, anchor, replacement) {
  if (source.includes(replacement)) return source;
  if (!source.includes(anchor)) {
    throw new Error('The Android widget library changed; check the Puptime chronometer integration.');
  }
  return source.replace(anchor, replacement);
}

module.exports = function withAndroidWidgetChronometer(config) {
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
    source = insertOnce(source, '        AppWidgetManager.getInstance(appContext)',
      '        PuptimeWidgetChronometers.add(appContext, remoteWidgetView, widgetWithViews.getRootView(), darkRoot);\n\n        AppWidgetManager.getInstance(appContext)');
    fs.writeFileSync(widgetPath, source);

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

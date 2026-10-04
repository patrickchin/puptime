const fs = require('fs');
const path = require('path');
const { withDangerousMod, withMainApplication } = require('expo/config-plugins');

module.exports = function withAndroidWidgetAgoRefresh(config) {
  const appPackage = config.android?.package;
  if (!appPackage) throw new Error('Android package is required for widget refresh.');

  config = withMainApplication(config, (mod) => {
    const marker = '// add(MyReactNativePackage())';
    if (!mod.modResults.contents.includes('WidgetAgoRefreshPackage()')) {
      if (!mod.modResults.contents.includes(marker)) throw new Error('Cannot register widget refresh package.');
      mod.modResults.contents = mod.modResults.contents
        .replace('import com.facebook.react.PackageList', `import ${appPackage}.widget.WidgetAgoRefreshPackage\nimport com.facebook.react.PackageList`)
        .replace(marker, 'add(WidgetAgoRefreshPackage())');
    }
    return mod;
  });

  return withDangerousMod(config, ['android', (mod) => {
    const dir = path.join(mod.modRequest.platformProjectRoot, 'app/src/main/java', ...appPackage.split('.'), 'widget');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'PuptimeQuickLog.java'), `package ${appPackage}.widget;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.os.SystemClock;

import com.reactnativeandroidwidget.RNWidgetJsCommunication;
import com.reactnativeandroidwidget.RNWidgetProvider;

public class PuptimeQuickLog extends RNWidgetProvider {
    private static final String REFRESH = "${appPackage}.WIDGET_AGO_REFRESH";

    private static PendingIntent refreshIntent(Context context) {
        return PendingIntent.getBroadcast(context, 0,
            new Intent(context, PuptimeQuickLog.class).setAction(REFRESH),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static void schedule(Context context, long at) {
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarms == null) return;
        alarms.cancel(refreshIntent(context));
        if (at <= 0 || !hasWidgets(context)) return;
        alarms.set(AlarmManager.ELAPSED_REALTIME,
            SystemClock.elapsedRealtime() + Math.max(1L, at - System.currentTimeMillis()),
            refreshIntent(context));
    }

    private static boolean hasWidgets(Context context) {
        return AppWidgetManager.getInstance(context)
            .getAppWidgetIds(new ComponentName(context, PuptimeQuickLog.class)).length > 0;
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        if (REFRESH.equals(intent.getAction())) {
            if (hasWidgets(context)) RNWidgetJsCommunication.requestWidgetUpdate(context, "PuptimeQuickLog");
            return;
        }
        super.onReceive(context, intent);
    }

    @Override
    public void onDeleted(Context context, int[] ids) {
        super.onDeleted(context, ids);
        if (!hasWidgets(context)) schedule(context, 0);
    }

    @Override
    public void onDisabled(Context context) {
        super.onDisabled(context);
        schedule(context, 0);
    }
}
`);
    fs.writeFileSync(path.join(dir, 'WidgetAgoRefreshModule.java'), `package ${appPackage}.widget;

import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;

public class WidgetAgoRefreshModule extends ReactContextBaseJavaModule {
    WidgetAgoRefreshModule(ReactApplicationContext context) { super(context); }

    @Override public String getName() { return "WidgetAgoRefresh"; }

    @ReactMethod public void schedule(double at) {
        PuptimeQuickLog.schedule(getReactApplicationContext(), (long) at);
    }
}
`);
    fs.writeFileSync(path.join(dir, 'WidgetAgoRefreshPackage.java'), `package ${appPackage}.widget;

import com.facebook.react.ReactPackage;
import com.facebook.react.bridge.NativeModule;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.uimanager.ViewManager;
import java.util.Collections;
import java.util.List;

public class WidgetAgoRefreshPackage implements ReactPackage {
    @Override public List<NativeModule> createNativeModules(ReactApplicationContext context) {
        return Collections.singletonList(new WidgetAgoRefreshModule(context));
    }

    @Override public List<ViewManager> createViewManagers(ReactApplicationContext context) {
        return Collections.emptyList();
    }
}
`);
    return mod;
  }]);
};

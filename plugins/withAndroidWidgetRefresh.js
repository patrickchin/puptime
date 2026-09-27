const { withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

module.exports = function withAndroidWidgetRefresh(config) {
  return withDangerousMod(config, [
    'android',
    (modConfig) => {
      const packageName = modConfig.android.package;
      const receiverPackage = `${packageName}.widget`;
      const providerPath = path.join(
        modConfig.modRequest.platformProjectRoot,
        'app/src/main/java',
        ...receiverPackage.split('.'),
        'PuptimeQuickLog.java',
      );
      if (!fs.existsSync(providerPath)) {
        throw new Error('Puptime could not find the generated Android widget provider.');
      }
      fs.writeFileSync(providerPath, `package ${receiverPackage};

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
    private static final String REFRESH = "${packageName}.PUPTIME_WIDGET_REFRESH";
    private static final long REFRESH_INTERVAL_MS = 2 * 60 * 1000L;

    private static PendingIntent refreshIntent(Context context) {
        Intent intent = new Intent(context, PuptimeQuickLog.class).setAction(REFRESH);
        return PendingIntent.getBroadcast(context, 0, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static void scheduleRefresh(Context context) {
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarms != null) {
            // Inexact alarms can be delayed by Android, especially while the device is idle.
            alarms.set(AlarmManager.ELAPSED_REALTIME,
                SystemClock.elapsedRealtime() + REFRESH_INTERVAL_MS, refreshIntent(context));
        }
    }

    private static void cancelRefresh(Context context) {
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarms != null) alarms.cancel(refreshIntent(context));
    }

    private static boolean hasWidgets(Context context) {
        return AppWidgetManager.getInstance(context)
            .getAppWidgetIds(new ComponentName(context, PuptimeQuickLog.class)).length > 0;
    }

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        super.onUpdate(context, manager, ids);
        if (ids.length > 0) scheduleRefresh(context);
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        if (REFRESH.equals(intent.getAction())) {
            if (hasWidgets(context)) {
                RNWidgetJsCommunication.requestWidgetUpdate(context, "PuptimeQuickLog");
                scheduleRefresh(context);
            } else {
                cancelRefresh(context);
            }
            return;
        }
        super.onReceive(context, intent);
    }

    @Override
    public void onDeleted(Context context, int[] ids) {
        super.onDeleted(context, ids);
        if (!hasWidgets(context)) cancelRefresh(context);
    }

    @Override
    public void onDisabled(Context context) {
        super.onDisabled(context);
        cancelRefresh(context);
    }
}
`);
      return modConfig;
    },
  ]);
};

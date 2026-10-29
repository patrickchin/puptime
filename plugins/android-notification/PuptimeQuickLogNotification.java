package com.reactnativeandroidwidget;

import android.app.Notification;
import android.app.NotificationManager;
import android.content.Context;
import android.content.pm.PackageManager;
import android.widget.RemoteViews;
import androidx.core.app.NotificationCompat;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReadableMap;

/** Uses the actual Home Screen widget renderer, click targets and live timers. */
public final class PuptimeQuickLogNotification {
    public static void show(ReactApplicationContext context, ReadableMap config, String title) throws Exception {
        int width = (int) config.getDouble("width");
        RemoteViews compact = new RNWidget(context, config.getMap("compact"), "PuptimeQuickLog")
            .notificationViews(-7001, width, 48);
        RemoteViews expanded = new RNWidget(context, config.getMap("expanded"), "PuptimeQuickLog")
            .notificationViews(-7002, width, 112);
        int icon = context.getPackageManager().getApplicationInfo(context.getPackageName(), PackageManager.GET_META_DATA)
            .metaData.getInt("expo.modules.notifications.default_notification_icon", context.getApplicationInfo().icon);
        Notification notification = new NotificationCompat.Builder(context, "puptime-status")
            .setSmallIcon(icon).setContentTitle(title).setShowWhen(false)
            .setStyle(new NotificationCompat.DecoratedCustomViewStyle())
            .setCustomContentView(compact).setCustomBigContentView(expanded)
            .setOngoing(true).setAutoCancel(false).setOnlyAlertOnce(true).setSilent(true)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE).build();
        ((NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE)).notify("puptime-status", 0, notification);
    }
}

package com.reactnativeandroidwidget;

import android.app.Notification;
import android.app.NotificationManager;
import android.content.Context;
import android.content.pm.PackageManager;
import android.widget.RemoteViews;
import androidx.core.app.NotificationCompat;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReadableMap;

/** Native notification layouts reuse the widget's background logging receiver. */
public final class PuptimeQuickLogNotification {
    public static void show(ReactApplicationContext context, ReadableMap config, String title) throws Exception {
        RNWidget renderer = new RNWidget(context, config, "PuptimeQuickLog");
        RemoteViews compact = renderer.notificationViews(-7001, 0, 48);
        RemoteViews expanded = renderer.notificationViews(-7002, 0, 184);
        int icon = context.getPackageManager().getApplicationInfo(context.getPackageName(), PackageManager.GET_META_DATA)
            .metaData.getInt("expo.modules.notifications.default_notification_icon", context.getApplicationInfo().icon);
        Notification notification = new NotificationCompat.Builder(context, "puptime-status")
            .setSmallIcon(icon).setContentTitle(title).setSubText(title).setShowWhen(false)
            .setStyle(new NotificationCompat.DecoratedCustomViewStyle())
            .setCustomContentView(compact).setCustomBigContentView(expanded)
            .setOngoing(true).setAutoCancel(false).setOnlyAlertOnce(true).setSilent(true)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE).build();
        ((NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE)).notify("puptime-status", 0, notification);
    }
}

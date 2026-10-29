package com.reactnativeandroidwidget;

import android.content.Context;
import android.graphics.Color;
import android.graphics.Rect;
import android.os.SystemClock;
import android.util.TypedValue;
import android.view.View;
import android.view.ViewGroup;
import android.widget.RemoteViews;
import android.widget.TextView;

import com.facebook.react.bridge.ReadableMap;

import java.util.ArrayList;
import java.util.List;

/** Adds launcher-owned timers over the measured labels in the bitmap widget. */
public final class PuptimeWidgetChronometers {
    private static final class Timer {
        final long at;
        final int color;

        Timer(long at, int color) {
            this.at = at;
            this.color = color;
        }
    }

    public static void prepare(TextView view, ReadableMap props) {
        if (props.hasKey("elapsedAt")) {
            view.setTag(new Timer((long) props.getDouble("elapsedAt"), view.getCurrentTextColor()));
            view.setTextColor(Color.TRANSPARENT);
        }
    }

    public static void add(Context context, RemoteViews widget, View lightRoot, View darkRoot) {
        List<TextView> light = new ArrayList<>();
        List<TextView> dark = new ArrayList<>();
        collect(lightRoot, light);
        collect(darkRoot == null ? lightRoot : darkRoot, dark);
        widget.removeAllViews(R.id.puptime_chronometers);

        long now = System.currentTimeMillis();
        long elapsed = SystemClock.elapsedRealtime();
        for (int i = 0; i < light.size(); i++) {
            TextView label = light.get(i);
            Timer timer = (Timer) label.getTag();
            TextView darkLabel = dark.get(i);
            Rect bounds = new Rect();
            label.getDrawingRect(bounds);
            ((ViewGroup) lightRoot).offsetDescendantRectToMyCoords(label, bounds);

            RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.puptime_chronometer);
            views.setViewPadding(R.id.puptime_chronometer_positioner,
                bounds.left, bounds.top, lightRoot.getWidth() - bounds.right, 0);
            views.setInt(R.id.puptime_chronometer_bounds, "setMinimumHeight", bounds.height());
            // Convert the saved wall-clock event time to the timer's monotonic clock.
            // Rebuilding after reboot computes a fresh base, even for events before boot.
            long base = elapsed - Math.max(0, now - timer.at);
            configure(views, R.id.puptime_chronometer_light, label, base);
            configure(views, R.id.puptime_chronometer_dark, darkLabel, base);
            widget.addView(R.id.puptime_chronometers, views);
        }
    }

    /** Uses native cell widths instead of absolute launcher coordinates. */
    public static void notification(Context context, RemoteViews views, View lightRoot, View darkRoot,
            int positioner, int lightId, int darkId, boolean compact) {
        List<TextView> light = new ArrayList<>(), dark = new ArrayList<>();
        collect(lightRoot, light);
        collect(darkRoot, dark);
        views.setViewVisibility(positioner, light.isEmpty() ? View.GONE : View.VISIBLE);
        if (light.isEmpty()) return;
        TextView label = light.get(0);
        Rect bounds = new Rect();
        label.getDrawingRect(bounds);
        ((ViewGroup) lightRoot).offsetDescendantRectToMyCoords(label, bounds);
        float density = context.getResources().getDisplayMetrics().density;
        views.setViewPadding(positioner, compact ? Math.round(28 * density) : 0,
            bounds.top + (compact ? Math.round(4 * density) : 0), compact ? Math.round(4 * density) : 0, 0);
        long base = SystemClock.elapsedRealtime() - Math.max(0, System.currentTimeMillis() - ((Timer) label.getTag()).at);
        configure(views, lightId, label, base);
        configure(views, darkId, dark.get(0), base);
    }

    private static void configure(RemoteViews views, int id, TextView label, long base) {
        views.setTextColor(id, ((Timer) label.getTag()).color);
        views.setTextViewTextSize(id, TypedValue.COMPLEX_UNIT_PX, label.getTextSize());
        views.setChronometer(id, base, "%s ago", true);
    }

    private static void collect(View view, List<TextView> result) {
        if (view instanceof TextView && view.getTag() instanceof Timer) {
            result.add((TextView) view);
        } else if (view instanceof ViewGroup) {
            ViewGroup group = (ViewGroup) view;
            for (int i = 0; i < group.getChildCount(); i++) collect(group.getChildAt(i), result);
        }
    }
}

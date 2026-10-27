package com.reactnativeandroidwidget;

import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.graphics.Rect;
import android.view.ViewGroup;
import android.widget.RemoteViews;

import com.reactnativeandroidwidget.builder.ClickableView;
import com.reactnativeandroidwidget.builder.WidgetWithViews;

import org.json.JSONObject;

/** Refresh activity state without removing a button underneath an in-progress tap. */
public final class PuptimeWidgetUpdates {
    private static final String PREFERENCES = "puptime_widget_click_layouts_v1";
    private static final int[] LAYOUTS = {R.layout.puptime_widget_clickable_0,
        R.layout.puptime_widget_clickable_1, R.layout.puptime_widget_clickable_2, R.layout.puptime_widget_clickable_3};
    private static final int[] AREAS = {R.id.puptime_widget_clickable_0,
        R.id.puptime_widget_clickable_1, R.id.puptime_widget_clickable_2, R.id.puptime_widget_clickable_3};

    public static int layout(int slot) {
        return slot < LAYOUTS.length ? LAYOUTS[slot] : R.layout.rn_widget_clickable;
    }

    public static int area(int slot) {
        return slot < AREAS.length ? AREAS[slot] : R.id.rn_widget_clickable_area;
    }

    private static String signature(WidgetWithViews views) {
        ViewGroup root = (ViewGroup) views.getRootView();
        StringBuilder value = new StringBuilder(root.getWidth() + "x" + root.getHeight());
        for (ClickableView click : views.getClickableViews()) {
            Rect bounds = new Rect();
            click.getView().getDrawingRect(bounds);
            root.offsetDescendantRectToMyCoords(click.getView(), bounds);
            value.append('|').append(click.getId()).append(':').append(bounds.toShortString())
                .append(':').append(click.getBorderRadius()).append(':').append(click.getClickAction())
                .append(':').append(new JSONObject(click.getClickActionData().toHashMap()));
        }
        return value.toString();
    }

    public static void invalidate(Context context, int widgetId) {
        // Android requests a full update after reboot/resize; partial updates
        // require an existing full RemoteViews in the system's widget cache.
        context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).edit()
            .remove(String.valueOf(widgetId)).apply();
    }

    public static boolean canReuse(Context context, int widgetId, WidgetWithViews views) {
        return views.getClickableViews().size() <= AREAS.length && views.getCollectionViews().isEmpty()
            && signature(views).equals(context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
                .getString(String.valueOf(widgetId), null));
    }

    public static void update(Context context, int widgetId, RemoteViews widget, WidgetWithViews views, boolean reuse) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        if (reuse) {
            // Unique resource IDs let accessibility descriptions stay current
            // while the existing click targets and touch gestures remain intact.
            for (int slot = 0; slot < views.getClickableViews().size(); slot++) {
                widget.setContentDescription(area(slot), views.getClickableViews().get(slot).getAccessibilityLabel());
            }
            manager.partiallyUpdateAppWidget(widgetId, widget);
        } else {
            manager.updateAppWidget(widgetId, widget);
            context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).edit()
                .putString(String.valueOf(widgetId), signature(views)).apply();
        }
    }
}

package com.reactnativeandroidwidget;

import android.view.View;
import android.widget.RemoteViews;

/** Puptime's action targets stay attached throughout launcher refreshes. */
public final class PuptimeWidgetClicks {
    private static final int[] AREAS = {R.id.puptime_widget_clickable_0,
        R.id.puptime_widget_clickable_1, R.id.puptime_widget_clickable_2, R.id.puptime_widget_clickable_3,
        R.id.puptime_widget_clickable_4, R.id.puptime_widget_clickable_5};
    private static final int[] POSITIONERS = {R.id.puptime_widget_positioner_0,
        R.id.puptime_widget_positioner_1, R.id.puptime_widget_positioner_2, R.id.puptime_widget_positioner_3,
        R.id.puptime_widget_positioner_4, R.id.puptime_widget_positioner_5};

    public static int area(int slot) { return AREAS[slot]; }
    public static int positioner(int slot) { return POSITIONERS[slot]; }

    public static void showSlots(RemoteViews widget, int count) {
        if (count > AREAS.length) throw new IllegalArgumentException("Puptime supports at most six widget actions.");
        for (int slot = 0; slot < POSITIONERS.length; slot++) {
            widget.setViewVisibility(POSITIONERS[slot], slot < count ? View.VISIBLE : View.GONE);
        }
    }
}

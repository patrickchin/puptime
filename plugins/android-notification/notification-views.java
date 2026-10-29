    public RemoteViews notificationViews(int id, int width, int height) throws Exception {
        boolean compact = height == 48;
        String preference = config.getString("themePreference");
        com.facebook.react.bridge.ReadableArray actions = config.getArray("actions");
        RemoteViews views = new RemoteViews(appContext.getPackageName(), compact ? R.layout.puptime_notification_compact : R.layout.puptime_notification_expanded);
        int[] cells = {R.id.puptime_notification_cell_0, R.id.puptime_notification_cell_1, R.id.puptime_notification_cell_2, R.id.puptime_notification_cell_3};
        boolean largeText = appContext.getResources().getConfiguration().fontScale > 1.4f;
        if (!compact && largeText) {
            int minimum = RNWidgetUtil.dpToPx(appContext, 116);
            views.setInt(R.id.puptime_notification_first_row, "setMinimumHeight", minimum);
            views.setInt(R.id.puptime_notification_second_row, "setMinimumHeight", minimum);
        }
        int count = Math.min(actions.size(), compact ? 3 : 4);
        views.setViewVisibility(R.id.puptime_notification_second_row, !compact && count > 2 ? View.VISIBLE : View.GONE);
        if (!compact) views.setViewVisibility(R.id.puptime_notification_second_gap, count == 4 ? View.VISIBLE : View.GONE);
        for (int slot = 0; slot < cells.length; slot++) {
            views.setViewVisibility(cells[slot], slot < count ? View.VISIBLE : View.GONE);
            if (slot >= count) continue;
            ReadableMap action = actions.getMap(slot);
            String accessibility = action.getString("accessibilityLabel");
            if (!compact) accessibility += action.isNull("lastAt") ? ", never logged"
                : ", last logged " + java.text.DateFormat.getDateTimeInstance().format(new java.util.Date((long) action.getDouble("lastAt")));
            // Separate native panels let SystemUI switch palettes while the app is asleep.
            for (String mode : new String[]{"light", "dark"}) {
                ReadableMap colors = action.getMap(mode);
                int ink = android.graphics.Color.parseColor(colors.getString("ink"));
                int background = android.graphics.Color.parseColor(colors.getString("background"));
                int panel = notificationPart(mode, "panel", slot);
                if (!"system".equals(preference)) views.setViewVisibility(panel, mode.equals(preference) ? View.VISIBLE : View.GONE);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    views.setColorStateList(panel, "setBackgroundTintList", android.content.res.ColorStateList.valueOf(background));
                } else views.setInt(panel, "setBackgroundColor", background);
                int label = notificationPart(mode, "label", slot);
                views.setTextColor(label, ink);
                views.setTextViewText(label, action.getString("label"));
                int icon = notificationPart(mode, "icon", slot);
                views.setImageViewResource(icon, notificationIcon(action.getString("icon")));
                views.setInt(icon, "setColorFilter", ink);
                if (compact && largeText) views.setViewVisibility(icon, View.GONE);
                if (!compact) {
                    boolean hasTime = !action.isNull("lastAt");
                    int clock = notificationPart(mode, "clock", slot), empty = notificationPart(mode, "empty", slot);
                    views.setViewVisibility(clock, hasTime ? View.VISIBLE : View.GONE);
                    views.setViewVisibility(empty, hasTime ? View.GONE : View.VISIBLE);
                    views.setTextColor(empty, ink);
                    views.setTextColor(clock, ink);
                    if (hasTime) {
                        long base = android.os.SystemClock.elapsedRealtime() - Math.max(0, System.currentTimeMillis() - (long) action.getDouble("lastAt"));
                        views.setChronometer(clock, base, largeText ? "%s" : "%s ago", true);
                    }
                }
            }
            views.setContentDescription(cells[slot], accessibility);
            ClickableView button = new ClickableView(action.getString("type"), new View(appContext), "LOG_EVENT", action.getMap("clickActionData"));
            registerClickTask(id, button, views, cells[slot]);
        }
        return views;
    }

    private int notificationPart(String mode, String part, int slot) {
        return appContext.getResources().getIdentifier("puptime_notification_" + mode + "_" + part + "_" + slot, "id", appContext.getPackageName());
    }

    private int notificationIcon(String name) {
        switch (name) {
            case "pee": return R.drawable.puptime_notification_icon_pee;
            case "poop": return R.drawable.puptime_notification_icon_poop;
            case "meal": return R.drawable.puptime_notification_icon_meal;
            case "pottyTrip": return R.drawable.puptime_notification_icon_pottytrip;
            case "walk": return R.drawable.puptime_notification_icon_walk;
            case "nap": return R.drawable.puptime_notification_icon_nap;
            case "stop": return R.drawable.puptime_notification_icon_stop;
            default: return R.drawable.puptime_notification_icon_custom;
        }
    }

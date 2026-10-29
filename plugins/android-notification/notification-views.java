    public RemoteViews notificationViews(int id, int width, int height) throws Exception {
        WidgetWithViews light = WidgetFactory.buildWidgetFromRoot(appContext, Arguments.makeNativeMap(config.getMap("light").toHashMap()), width, height);
        WidgetWithViews dark = WidgetFactory.buildWidgetFromRoot(appContext, Arguments.makeNativeMap(config.getMap("dark").toHashMap()), width, height);
        boolean compact = height < 90;
        RemoteViews views = new RemoteViews(appContext.getPackageName(), compact ? R.layout.puptime_notification_compact : R.layout.puptime_notification_expanded);
        int[] cells = {R.id.puptime_notification_cell_0, R.id.puptime_notification_cell_1, R.id.puptime_notification_cell_2, R.id.puptime_notification_cell_3};
        int[] images = {R.id.puptime_notification_light_0, R.id.puptime_notification_light_1, R.id.puptime_notification_light_2, R.id.puptime_notification_light_3};
        int[] darkImages = {R.id.puptime_notification_dark_0, R.id.puptime_notification_dark_1, R.id.puptime_notification_dark_2, R.id.puptime_notification_dark_3};
        int[] timers = {R.id.puptime_notification_timer_0, R.id.puptime_notification_timer_1, R.id.puptime_notification_timer_2, R.id.puptime_notification_timer_3};
        int[] clocks = {R.id.puptime_notification_clock_0, R.id.puptime_notification_clock_1, R.id.puptime_notification_clock_2, R.id.puptime_notification_clock_3};
        int[] darkClocks = {R.id.puptime_notification_dark_clock_0, R.id.puptime_notification_dark_clock_1, R.id.puptime_notification_dark_clock_2, R.id.puptime_notification_dark_clock_3};
        // SystemUI supplies the available width. Native layout weights keep
        // every button and its click target aligned across notification sizes.
        List<ClickableView> buttons = light.getClickableViews();
        for (int slot = 0; slot < cells.length; slot++) {
            views.setViewVisibility(cells[slot], slot < buttons.size() ? View.VISIBLE : View.GONE);
            if (slot >= buttons.size()) continue;
            ClickableView button = buttons.get(slot);
            View darkButton = dark.getClickableViews().get(slot).getView();
            views.setImageViewUri(images[slot], saveBitmapToDisk(id * 10 + slot, "light", drawViewToBitmap(button.getView())));
            views.setImageViewUri(darkImages[slot], saveBitmapToDisk(id * 10 + slot, "dark", drawViewToBitmap(darkButton)));
            views.setContentDescription(cells[slot], button.getAccessibilityLabel());
            registerClickTask(id, button, views, cells[slot]);
            PuptimeWidgetChronometers.notification(appContext, views, button.getView(), darkButton,
                timers[slot], clocks[slot], darkClocks[slot], compact);
        }
        View[] roots = {light.getRootView(), dark.getRootView()};
        int[] backgrounds = {R.id.rn_widget_image_light, R.id.rn_widget_image_dark};
        for (int mode = 0; mode < roots.length; mode++) {
            View root = roots[mode];
            Bitmap bitmap = Bitmap.createBitmap(root.getWidth(), root.getHeight(), Bitmap.Config.ARGB_8888);
            if (root.getBackground() != null) root.getBackground().draw(new Canvas(bitmap));
            views.setImageViewUri(backgrounds[mode], saveBitmapToDisk(id, mode == 0 ? "light" : "dark", bitmap));
        }
        return views;
    }

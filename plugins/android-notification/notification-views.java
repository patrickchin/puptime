    public RemoteViews notificationViews(int id, int width, int height) throws Exception {
        WidgetWithViews light = WidgetFactory.buildWidgetFromRoot(appContext, Arguments.makeNativeMap(config.getMap("light").toHashMap()), width, height);
        WidgetWithViews dark = WidgetFactory.buildWidgetFromRoot(appContext, Arguments.makeNativeMap(config.getMap("dark").toHashMap()), width, height);
        RemoteViews views = new RemoteViews(appContext.getPackageName(), R.layout.puptime_widget);
        views.setImageViewUri(R.id.rn_widget_image_light, saveBitmapToDisk(id, "light", drawViewToBitmap(light.getRootView())));
        views.setImageViewUri(R.id.rn_widget_image_dark, saveBitmapToDisk(id, "dark", drawViewToBitmap(dark.getRootView())));
        views.setInt(android.R.id.background, "setMinimumHeight", Math.round(height * appContext.getResources().getDisplayMetrics().density));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) views.setViewLayoutHeight(android.R.id.background, height, TypedValue.COMPLEX_UNIT_DIP);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) addClickableAreas(id, views, light);
        PuptimeWidgetChronometers.add(appContext, views, light.getRootView(), dark.getRootView());
        return views;
    }

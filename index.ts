import { registerRootComponent } from 'expo';
import { registerWidgetTaskHandler } from 'react-native-android-widget';
import { Platform } from 'react-native';
import { createElement } from 'react';

import { widgetTaskHandler } from './src/widget-task-handler';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
// A cold widget tap needs storage and the handler, not the app's screens.
registerRootComponent(function Root() {
  const App = require('./App').default;
  return createElement(App);
});
if (Platform.OS !== 'web') registerWidgetTaskHandler(widgetTaskHandler);

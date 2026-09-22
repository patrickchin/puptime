import { registerRootComponent } from 'expo';
import { registerWidgetTaskHandler } from 'react-native-android-widget';
import { Platform } from 'react-native';

import App from './App';
import { widgetTaskHandler } from './src/widget-task-handler';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
if (Platform.OS !== 'web') registerWidgetTaskHandler(widgetTaskHandler);

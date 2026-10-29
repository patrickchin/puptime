'use no memo';
import {AndroidWidget} from 'react-native-android-widget/src/AndroidWidget';
import {notificationActions} from './quiet-status-actions';
import type {NotificationWidgetProps} from './quiet-status-config';

export async function renderQuickLogNotification(props:NotificationWidgetProps):Promise<void>{
  const config={actions:notificationActions(props),themePreference:props.themePreference};
  const native=AndroidWidget as typeof AndroidWidget&{drawQuickLogNotification:(config:object,title:string)=>Promise<void>};
  await native.drawQuickLogNotification(config,props.title);
}

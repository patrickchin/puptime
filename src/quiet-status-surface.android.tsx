'use no memo';
import {Dimensions} from 'react-native';
import {AndroidWidget} from 'react-native-android-widget/src/AndroidWidget';
import {buildWidgetTree} from 'react-native-android-widget/src/api/build-widget-tree';
import {isOpenNap,latestQuickEventTimes} from './domain';
import {QuickLogWidget} from './widgets/QuickLogWidget.android';
import type {NotificationWidgetProps} from './quiet-status-surface.ts';

export async function renderQuickLogNotification({events,actions,customActivities,themePreference,petId,scope,title}:NotificationWidgetProps):Promise<void>{
  const props={scope,canLog:true,activeNap:events.some(isOpenNap),lastEventAt:latestQuickEventTimes(events),actions,customActivities,themePreference,notificationPetId:petId};
  const config={width:Math.max(240,Math.min(Dimensions.get('window').width-64,480)),
    compact:{light:buildWidgetTree(<QuickLogWidget {...props} compact/>),dark:buildWidgetTree(<QuickLogWidget {...props} compact dark/>)},
    expanded:{light:buildWidgetTree(<QuickLogWidget {...props}/>),dark:buildWidgetTree(<QuickLogWidget {...props} dark/>)},
  };
  const native=AndroidWidget as typeof AndroidWidget&{drawQuickLogNotification:(config:object,title:string)=>Promise<void>};
  await native.drawQuickLogNotification(config,title);
}

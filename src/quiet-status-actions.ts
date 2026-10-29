import {EVENT_META,customActivityKey,isOpenNap,latestQuickEventTimes,widgetActionsForState,type QuickEventType} from './domain.ts';
import type {NotificationWidgetProps} from './quiet-status-config';

// Match the approved notification preview while keeping the widget's activity hues.
const notificationColors={
  pee:{color:'#006E99',softColor:'#DFF1F8',darkColor:'#A9DCF5',darkSoftColor:'#163B4A'},
  poop:{color:'#A84B00',softColor:'#FFF0DE',darkColor:'#FFCC9D',darkSoftColor:'#49301C'},
  meal:{color:'#376523',softColor:'#E8F1DF',darkColor:'#BEE2A9',darkSoftColor:'#293F24'},
  nap:{color:'#65508F',softColor:'#EEE7F7',darkColor:'#DFC9FF',darkSoftColor:'#392C4D'},
};

export function notificationActions({events,actions,customActivities,petId,scope}:NotificationWidgetProps){
  const sleeping=events.some(isOpenNap),last=latestQuickEventTimes(events);
  return widgetActionsForState(actions,sleeping,customActivities).map(type=>{
    const kind=type.startsWith('custom:')?'custom':type as QuickEventType;
    const meta=EVENT_META[kind],endingNap=type==='nap'&&sleeping;
    const colors=kind in notificationColors?notificationColors[kind as keyof typeof notificationColors]:meta;
    const label=kind==='custom'?customActivities.find(name=>customActivityKey(name)===type)??type.slice(7)
      :endingNap?'End nap':type==='nap'?'Start nap':type==='pottyTrip'?'Out':meta.label;
    return {type,label,icon:endingNap?'stop':kind,lastAt:last[type]??null,
      accessibilityLabel:endingNap?'End nap':`Log ${label.toLowerCase()}`,
      light:{ink:colors.color,background:colors.softColor},dark:{ink:colors.darkColor,background:colors.darkSoftColor},
      clickActionData:{type,scope,source:'notification',petId}};
  });
}

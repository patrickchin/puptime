import {EVENT_META,customActivityKey,isOpenNap,latestQuickEventTimes,widgetActionsForState,type QuickEventType} from './domain.ts';
import type {NotificationWidgetProps} from './quiet-status-config';

const emoji:Record<QuickEventType|'custom',string>={pee:'💧',poop:'💩',meal:'🍽️',pottyTrip:'🚪',walk:'🐾',nap:'💤',custom:'🏷️'};

export function notificationActions({events,actions,customActivities,petId,scope}:NotificationWidgetProps){
  const sleeping=events.some(isOpenNap),last=latestQuickEventTimes(events);
  return widgetActionsForState(actions,sleeping,customActivities).map(type=>{
    const kind=type.startsWith('custom:')?'custom':type as QuickEventType;
    const meta=EVENT_META[kind],endingNap=type==='nap'&&sleeping;
    const label=kind==='custom'?customActivities.find(name=>customActivityKey(name)===type)??type.slice(7)
      :endingNap?'End nap':type==='nap'?'Start nap':type==='pottyTrip'?'Out':meta.label;
    return {type,label,emoji:endingNap?'☀️':emoji[kind],lastAt:last[type]??null,
      accessibilityLabel:endingNap?'End nap':`Log ${label.toLowerCase()}`,
      light:{ink:meta.color,background:meta.softColor},dark:{ink:meta.darkColor,background:meta.darkSoftColor},
      clickActionData:{type,scope,source:'notification',petId}};
  });
}

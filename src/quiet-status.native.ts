import * as Notifications from 'expo-notifications';
import {getCareAccess} from './care-access';
import { Platform } from 'react-native';
import { getLocalRuntime } from './local/runtime.native';
import { resolveLanguage } from './localization';
import { getNotificationPermissionState } from './reminders';
import {renderQuickLogNotification} from './quiet-status-surface';
import { QUIET_STATUS_CHANNEL, QUIET_STATUS_IDENTIFIER, QUIET_STATUS_KIND, QUIET_STATUS_CATEGORY, quietStatusCopy } from './quiet-status-config';

export const getQuietStatusEnabled = async () => (await getLocalRuntime()).storage.loadQuietStatusEnabled();

let writes: Promise<unknown> = Promise.resolve();
export function syncQuietStatus(): Promise<void> {
  // Read committed state inside the queue: a later disable/pet switch wins over
  // an update already being delivered, without adding any activity-list state.
  const next = writes.then(async () => {
    const runtime = await getLocalRuntime();
    const { storage, activity, petId } = runtime;
    const [enabled, delivery, permission, access] = await Promise.all([
      storage.loadQuietStatusEnabled(), storage.loadNotificationDelivery(), getNotificationPermissionState(), getCareAccess(),
    ]);
    if (!enabled || !delivery || permission !== 'granted' || !access.canLog) {
      await Notifications.cancelScheduledNotificationAsync(QUIET_STATUS_IDENTIFIER);
      await Notifications.dismissNotificationAsync(QUIET_STATUS_IDENTIFIER);
      return;
    }
    if(access.petId && access.petId!==petId)return;
    const [languagePreference,name]=await Promise.all([storage.loadLanguagePreference(),storage.loadPuppyName()]);
    const copy=quietStatusCopy(name,resolveLanguage(languagePreference));
    if(Platform.OS==='android'){
      await Notifications.setNotificationChannelAsync(QUIET_STATUS_CHANNEL,{
        name:'Quiet puppy status',importance:Notifications.AndroidImportance.LOW,
        sound:null,enableVibrate:false,showBadge:false,
      });
      const events=await activity.latestEvents();
      const customActivities=await storage.loadCustomActivities(events);
      const [actions,themePreference]=await Promise.all([storage.loadWidgetActions(customActivities),storage.loadThemePreference()]);
      await renderQuickLogNotification({events,actions,customActivities,themePreference,petId,scope:access.scope,title:copy.title});
      return;
    }
    const delivered=await Notifications.getPresentedNotificationsAsync();
    const existing=delivered.find(item=>item.request.identifier===QUIET_STATUS_IDENTIFIER)?.request.content;
    if(existing?.title===copy.title&&existing.body===copy.body&&existing.data?.petId===petId&&existing.categoryIdentifier===QUIET_STATUS_CATEGORY)return;
    await Notifications.setNotificationCategoryAsync(QUIET_STATUS_CATEGORY,[]);
    await Notifications.scheduleNotificationAsync({
      identifier: QUIET_STATUS_IDENTIFIER,
      content: {
        ...copy, sound: false, interruptionLevel: 'passive', sticky: true, autoDismiss: false, categoryIdentifier: QUIET_STATUS_CATEGORY,
        data: { kind: QUIET_STATUS_KIND, petId },
      },
      trigger: null,
    });
  });
  writes = next.catch(() => undefined);
  return next;
}

export async function setQuietStatusEnabled(enabled: boolean): Promise<void> {
  await (await getLocalRuntime()).storage.saveQuietStatusEnabled(enabled);
  await syncQuietStatus();
}

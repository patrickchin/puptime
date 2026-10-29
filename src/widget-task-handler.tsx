'use no memo';

import {getCareAccess} from './care-access';
import type { WidgetTaskHandlerProps } from 'react-native-android-widget';

import {
  createEvent,
  createNapEvent,
  activityFromKey,
  customActivityKey,
  isOpenNap,
  isQuickEventType,
  latestQuickEventTimes,
  type PuppyEvent,
  type ActivityKey,
} from './domain';
import { resolveLanguage, type AppLanguage } from './localization';
import type { NotificationPreferences } from './notification-config';
import { getLocalRuntime,getCareSelection,getRuntimeForCare } from './local/runtime.native';
import { configureReminderHandling, showWidgetLogConfirmation, syncPottyReminders } from './reminders';
import {
  loadCustomActivities,
  loadLanguagePreference,
  loadNotificationPreferences,
  loadThemePreference,
  loadWidgetActions,
} from './storage';
import { QuickLogWidget } from './widgets/QuickLogWidget.android';
import { updateHomeWidget } from './widgets/sync';
import { syncQuietStatus } from './quiet-status';

// Headless launches no longer import App, which also installs this handler.
configureReminderHandling();

// The launcher only needs the latest activity candidates and any open nap.
const latestEvents = async () => (await getLocalRuntime()).activity.latestEvents();

// Serialize nap's read/change pair without holding later taps behind reminders.
let logWrites: Promise<unknown> = Promise.resolve();
function saveLog(key: ActivityKey, at: number, customActivities: string[],expectedScope:string,notificationPetId?:string) {
  const result = logWrites.then(async () => {
    const selection=getCareSelection(),runtime=await getRuntimeForCare(selection);
    if((selection?runtime.petId:'owner')!==expectedScope)return null;
    if(notificationPetId&&(runtime.petId!==notificationPetId||!await runtime.storage.loadQuietStatusEnabled()||!await runtime.storage.loadNotificationDelivery()))return null;
    const activity = activityFromKey(key, customActivities);
    const openNap = key === 'nap' ? (await runtime.activity.latestEvents()).find(isOpenNap) : undefined;
    const event = openNap
      ? { ...openNap, endedAt: Math.max(openNap.at, at) }
      : key === 'nap'
        ? createNapEvent('widget', at)
        : createEvent(activity.type, 'widget', at, activity.customLabel);
    if (openNap) await runtime.storage.updateEvent(openNap.id, { endedAt: event.endedAt });
    else await runtime.storage.appendEvents([event]);
    return { event, activity };
  });
  logWrites = result.catch(() => undefined);
  return result;
}

let refreshTimer: ReturnType<typeof setTimeout> | undefined;
let refreshWaiters: { resolve: () => void; reject: (error: unknown) => void }[] = [];
function refreshAfterTaps(preferences: NotificationPreferences, language: AppLanguage): Promise<void> {
  // Logging and confirmations are immediate. Refresh once after a tap burst so
  // launcher reapplication cannot interrupt the next press/release gesture.
  if (refreshTimer) clearTimeout(refreshTimer);
  const result = new Promise<void>((resolve, reject) => { refreshWaiters.push({ resolve, reject }); });
  refreshTimer = setTimeout(async () => {
    const waiters = refreshWaiters;
    refreshWaiters = [];
    refreshTimer = undefined;
    try {
      const events = await latestEvents();
      await Promise.all([
        updateHomeWidget(events).catch(() => undefined),
        syncPottyReminders(events, preferences, language).catch(() => false),
      ]);
      await syncQuietStatus().catch(() => undefined);
      waiters.forEach(({ resolve }) => resolve());
    } catch (error) { waiters.forEach(({ reject }) => reject(error)); }
  }, 200);
  return result;
}

async function render(props: WidgetTaskHandlerProps, events: PuppyEvent[]) {
  const access=await getCareAccess();
  const compact = props.widgetInfo.height < 90;
  const activeNap = events.some(isOpenNap);
  const customActivities = await loadCustomActivities(events);
  const actions = await loadWidgetActions(customActivities);
  const themePreference = await loadThemePreference();
  const lastEventAt = latestQuickEventTimes(events);
  props.renderWidget({
    light: <QuickLogWidget scope={access.scope} canLog={access.canLog} compact={compact} activeNap={activeNap} lastEventAt={lastEventAt} actions={actions} customActivities={customActivities} themePreference={themePreference} />,
    dark: <QuickLogWidget scope={access.scope} canLog={access.canLog} compact={compact} activeNap={activeNap} lastEventAt={lastEventAt} actions={actions} customActivities={customActivities} themePreference={themePreference} dark />,
  });
}

export async function widgetTaskHandler(props: WidgetTaskHandlerProps) {
  if (props.widgetAction === 'WIDGET_CLICK' && props.clickAction === 'LOG_EVENT') {
    if (props.clickActionData?.source === 'notification') {
      const runtime = await getLocalRuntime();
      const [enabled, delivery] = await Promise.all([runtime.storage.loadQuietStatusEnabled(),runtime.storage.loadNotificationDelivery()]);
      if (!enabled || !delivery || props.clickActionData.petId !== runtime.petId) return;
    }
    // Keep the tap time even when Android has to start the JavaScript runtime.
    const access=await getCareAccess();
    if(!access.canLog||(props.clickActionData?.scope??'owner')!==access.scope){
      if(props.clickActionData?.source==='notification')await syncQuietStatus();
      else await render(props,await latestEvents());
      return;
    }
    const tapAt = props.clickActionData?.tapAt;
    const at = typeof tapAt === 'number' && Number.isSafeInteger(tapAt) && tapAt > 0 ? tapAt : Date.now();
    const type = props.clickActionData?.type;
    const customActivities = isQuickEventType(type) ? [] : await loadCustomActivities();
    const custom = typeof type === 'string' && customActivities.some((label) => customActivityKey(label) === type);
    if (isQuickEventType(type) || custom) {
      const key = type as ActivityKey;
      const saved=await saveLog(key,at,customActivities,access.scope,props.clickActionData?.source==='notification'&&typeof props.clickActionData.petId==='string'?props.clickActionData.petId:undefined);
      if(!saved){
        if(props.clickActionData?.source==='notification')await syncQuietStatus();
        else await render(props,await latestEvents());
        return;
      }
      const {event,activity}=saved;
      const [preferences, languagePreference] = await Promise.all([
        loadNotificationPreferences(),
        loadLanguagePreference(),
      ]);
      const language = resolveLanguage(languagePreference);
      const confirmation = preferences.widgetConfirmations
        ? showWidgetLogConfirmation(
            { eventId: event.id, type: key, at, customLabel: activity.customLabel },
            language,
          ).catch(() => false)
        : Promise.resolve(false);
      await Promise.all([
        confirmation,
        refreshAfterTaps(preferences, language),
      ]);
      return;
    }
  }

  if (['WIDGET_ADDED', 'WIDGET_UPDATE', 'WIDGET_RESIZED'].includes(props.widgetAction)) {
    const events = await latestEvents();
    await render(props, events);
  }
}

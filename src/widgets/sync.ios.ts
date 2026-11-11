import {getCareAccess} from '../care-access';
import { EVENT_META, customActivityKey, resolveNapState, latestQuickEventTimes, type PuppyEvent } from '../domain';
import { resolveLanguage } from '../localization';
import { resolveTheme } from '../theme';
import {
  loadLanguagePreference,
  loadCustomActivities,
  loadNotificationPreferences,
  loadThemePreference,
  loadWidgetActions,
} from '../storage';
import PuptimeWidget, { type PuptimeWidgetProps } from './PuptimeWidget.ios';
import { widgetsDirectory } from 'expo-widgets';
import { Directory, File } from 'expo-file-system';
import { parseEvents } from '../storage-validation';
import { getLocalRuntime } from '../local/runtime.native';
import { requireNativeModule } from 'expo-modules-core';
import { updateNotifications } from '../notification-write-queue';

const nativeReminders = requireNativeModule<{ syncPuptimePottyReminders(source:string):Promise<void> }>('ExpoWidgets');

const importedOperations = new WeakMap<PuppyEvent[], File[]>();

export async function readPendingWidgetEvents(): Promise<PuppyEvent[]> {
  const access=await getCareAccess();
  if(!access.canLog)return [];
  const directory = widgetsDirectory ? new Directory(widgetsDirectory, 'PuptimePending') : null;
  const files = directory?.exists ? directory.list().filter((entry): entry is File => entry instanceof File && /^wop_[a-f0-9]+\.json$/.test(entry.name)) : [];
  const operations = (await Promise.all(files.map(async file => {
    try { const event=JSON.parse(await file.text());return {...event,__file:file}; }
    catch (error) { if (!file.exists) return undefined; throw error; }
  }))).filter(event => event !== undefined);
  let legacy: PuptimeWidgetProps['pending'] = [];
  try {
    const timeline = await PuptimeWidget.getTimeline();
    legacy = timeline.flatMap((entry) => (entry.props as PuptimeWidgetProps).pending ?? []);
  } catch { /* Journaled operations remain importable if a presentation is unavailable. */ }
  const belongs=(event:{scope?:string})=>(event.scope??'owner')===access.scope;
  const pending = [...legacy, ...operations].filter(belongs).flatMap(({scope:_scope,__file:_file,...event}) => parseEvents([{
      ...event,
      ...(event.type === 'nap' && event.endedAt === undefined ? { endedAt: null } : {}),
      source: 'widget' as const,
  }]));
  const latest = new Map<string, PuppyEvent>();
  for (const event of pending) {
    const previous = latest.get(event.id);
    const time = event.endedAt ?? event.at, previousTime = previous?.endedAt ?? previous?.at ?? -Infinity;
    if (!previous || time > previousTime || (time === previousTime && typeof event.endedAt === 'number')) latest.set(event.id, event);
  }
  const events = [...latest.values()];
  importedOperations.set(events,operations.filter(belongs).map(event=>event.__file));
  return events;
}

export async function acknowledgePendingWidgetEvents(events: PuppyEvent[]): Promise<void> {
  // Delete only the immutable operations this read imported, after SQLite saved
  // them. A concurrently created nap-end operation has a different filename.
  for (const file of importedOperations.get(events) ?? []) if (file.exists) file.delete();
  importedOperations.delete(events);
}

let snapshotWrites:Promise<unknown>=Promise.resolve();
export function updateHomeWidget(events: PuppyEvent[],expectedPetId?:string): Promise<void> {
  // Read delivery/access inside the queue so an earlier refresh cannot publish
  // an enabled snapshot after a later opt-out or puppy switch.
  const next=snapshotWrites.then(()=>publishHomeWidget(events,expectedPetId));
  snapshotWrites=next.catch(()=>undefined);return next;
}

async function publishHomeWidget(events: PuppyEvent[],expectedPetId?:string): Promise<void> {
  const access=await getCareAccess();if(expectedPetId&&access.petId!==expectedPetId)return;
  const { storage, activity, petId } = await getLocalRuntime();
  // Callers can retain an older render's events while a log commits. Read the
  // bounded current rows here; native reconciliation adds unimported taps.
  events=await activity.latestEvents();
  const [quietEnabled, delivery, name] = await Promise.all([
    storage.loadQuietStatusEnabled(), storage.loadNotificationDelivery(), storage.loadPuppyName(),
  ]);
  const napState = resolveNapState(events);
  const openNap = napState.kind==='running'?napState.event:undefined;
  const customActivities = await loadCustomActivities(events);
  const [actions, themePreference, notificationPreferences, languagePreference] = await Promise.all([
    loadWidgetActions(customActivities),
    loadThemePreference(),
    loadNotificationPreferences(),
    loadLanguagePreference(),
  ]);
  const lightTheme = resolveTheme(themePreference, 'light');
  const darkTheme = resolveTheme(themePreference, 'dark');
  const actionDetails = Object.fromEntries([...new Set([...actions, 'nap' as const])].map((type) => {
    const meta = EVENT_META[type.startsWith('custom:') ? 'custom' : type as keyof typeof EVENT_META];
    const label = type.startsWith('custom:')
      ? customActivities.find((value) => customActivityKey(value) === type) ?? type.slice(7)
      : meta.label;
    return [type, {
      label,
      lightColor: lightTheme.isDark ? meta.darkColor : meta.color,
      darkColor: darkTheme.isDark ? meta.darkColor : meta.color,
    }];
  }));
  const currentAccess=await getCareAccess();
  if(currentAccess.scope!==access.scope||currentAccess.petId!==petId)return;
  await PuptimeWidget.updateSnapshot({
    scope:access.scope,
    expiresAt:currentAccess.expiresAt??0,
    canLog:currentAccess.canLog,
    canNotify:!currentAccess.ended,
    pending: [],
    openNap: openNap ? { scope:access.scope, id: openNap.id, type: 'nap', at: openNap.at } : false,
    napConflict: napState.kind==='conflict',
    lastEventAt: latestQuickEventTimes(events),
    actions:napState.kind==='conflict'?actions.filter(action=>action!=='nap'):actions,
    actionDetails,
    appearance: {
      light: {
        background: lightTheme.background,
        surface: lightTheme.surface,
        controlRadius: lightTheme.presentation.controlRadius,
      },
      dark: {
        background: darkTheme.background,
        surface: darkTheme.surface,
        controlRadius: darkTheme.presentation.controlRadius,
      },
    },
    notificationConfirmations: notificationPreferences.widgetConfirmations,
    notificationDelivery: delivery,
    quietStatus: { enabled: quietEnabled && delivery && currentAccess.canLog, name, petId },
    pottyAfterPeeMinutes: delivery && !currentAccess.ended && notificationPreferences.pottyAfterPee.enabled
      ? notificationPreferences.pottyAfterPee.delayMinutes
      : 0,
    pottyAfterMealMinutes: delivery && !currentAccess.ended && notificationPreferences.pottyAfterMeal.enabled
      ? notificationPreferences.pottyAfterMeal.delayMinutes
      : 0,
    language: resolveLanguage(languagePreference),
  });
  await updateNotifications(()=>nativeReminders.syncPuptimePottyReminders('PuptimeQuickLog'));
}

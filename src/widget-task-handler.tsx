'use no memo';

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
import { resolveLanguage } from './localization';
import { getLocalRuntime } from './local/runtime.native';
import { configureReminderHandling, showWidgetLogConfirmation, syncPottyReminders } from './reminders';
import {
  appendEvents,
  loadCustomActivities,
  loadLanguagePreference,
  loadNotificationPreferences,
  loadThemePreference,
  loadWidgetActions,
  updateEvent,
} from './storage';
import { QuickLogWidget } from './widgets/QuickLogWidget.android';
import { updateHomeWidget } from './widgets/sync';

// Headless launches no longer import App, which also installs this handler.
configureReminderHandling();

// The launcher only needs the latest activity candidates and any open nap.
const latestEvents = async () => (await getLocalRuntime()).activity.latestEvents();

// Serialize nap's read/change pair without holding later taps behind reminders.
let logWrites: Promise<unknown> = Promise.resolve();
function saveLog(key: ActivityKey, at: number, customActivities: string[]) {
  const result = logWrites.then(async () => {
    const activity = activityFromKey(key, customActivities);
    const openNap = key === 'nap' ? (await latestEvents()).find(isOpenNap) : undefined;
    const event = openNap
      ? { ...openNap, endedAt: Math.max(openNap.at, at) }
      : key === 'nap'
        ? createNapEvent('widget', at)
        : createEvent(activity.type, 'widget', at, activity.customLabel);
    if (openNap) await updateEvent(openNap.id, { endedAt: event.endedAt });
    else await appendEvents([event]);
    return { event, activity };
  });
  logWrites = result.catch(() => undefined);
  return result;
}

async function render(props: WidgetTaskHandlerProps, events: PuppyEvent[]) {
  const compact = props.widgetInfo.height < 90;
  const activeNap = events.some(isOpenNap);
  const customActivities = await loadCustomActivities(events);
  const actions = await loadWidgetActions(customActivities);
  const themePreference = await loadThemePreference();
  const lastEventAt = latestQuickEventTimes(events);
  props.renderWidget({
    light: <QuickLogWidget compact={compact} activeNap={activeNap} lastEventAt={lastEventAt} actions={actions} customActivities={customActivities} themePreference={themePreference} />,
    dark: <QuickLogWidget compact={compact} activeNap={activeNap} lastEventAt={lastEventAt} actions={actions} customActivities={customActivities} themePreference={themePreference} dark />,
  });
}

export async function widgetTaskHandler(props: WidgetTaskHandlerProps) {
  if (props.widgetAction === 'WIDGET_CLICK' && props.clickAction === 'LOG_EVENT') {
    // Keep the tap time even when Android has to start the JavaScript runtime.
    const tapAt = props.clickActionData?.tapAt;
    const at = typeof tapAt === 'number' && Number.isSafeInteger(tapAt) && tapAt > 0 ? tapAt : Date.now();
    const type = props.clickActionData?.type;
    const customActivities = isQuickEventType(type) ? [] : await loadCustomActivities();
    const custom = typeof type === 'string' && customActivities.some((label) => customActivityKey(label) === type);
    if (isQuickEventType(type) || custom) {
      const key = type as ActivityKey;
      const { event, activity } = await saveLog(key, at, customActivities);
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
      const nextEvents = await latestEvents();
      await Promise.all([
        confirmation,
        updateHomeWidget(nextEvents).catch(() => undefined),
        syncPottyReminders(nextEvents, preferences, language).catch(() => false),
      ]);
      return;
    }
  }

  if (['WIDGET_ADDED', 'WIDGET_UPDATE', 'WIDGET_RESIZED'].includes(props.widgetAction)) {
    const events = await latestEvents();
    await render(props, events);
  }
}

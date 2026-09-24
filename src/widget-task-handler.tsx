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
import { showWidgetLogConfirmation, syncPottyReminders } from './reminders';
import {
  appendEvents,
  loadEvents,
  loadCustomActivities,
  loadLanguagePreference,
  loadNotificationPreferences,
  loadThemePreference,
  loadWidgetActions,
  updateEvent,
} from './storage';
import { QuickLogWidget } from './widgets/QuickLogWidget.android';

async function render(props: WidgetTaskHandlerProps, events: PuppyEvent[], confirmedAction?: ActivityKey) {
  const compact = props.widgetInfo.height < 90;
  const activeNap = events.some(isOpenNap);
  const customActivities = await loadCustomActivities(events);
  const actions = await loadWidgetActions(customActivities);
  const themePreference = await loadThemePreference();
  const lastEventAt = latestQuickEventTimes(events);
  props.renderWidget({
    light: <QuickLogWidget compact={compact} activeNap={activeNap} lastEventAt={lastEventAt} actions={actions} customActivities={customActivities} confirmedAction={confirmedAction} themePreference={themePreference} />,
    dark: <QuickLogWidget compact={compact} activeNap={activeNap} lastEventAt={lastEventAt} actions={actions} customActivities={customActivities} confirmedAction={confirmedAction} themePreference={themePreference} dark />,
  });
}

export async function widgetTaskHandler(props: WidgetTaskHandlerProps) {
  if (props.widgetAction === 'WIDGET_CLICK' && props.clickAction === 'LOG_EVENT') {
    const type = props.clickActionData?.type;
    const customActivities = await loadCustomActivities();
    const custom = typeof type === 'string' && customActivities.some((label) => customActivityKey(label) === type);
    if (isQuickEventType(type) || custom) {
      const key = type as ActivityKey;
      const activity = activityFromKey(key, customActivities);
      const at = Date.now();
      const current = await loadEvents();
      const openNap = type === 'nap' ? current.find(isOpenNap) : undefined;
      const event = openNap
        ? { ...openNap, endedAt: Math.max(openNap.at, at) }
        : type === 'nap'
          ? createNapEvent('widget', at)
          : createEvent(activity.type, 'widget', at, activity.customLabel);
      const nextEvents = openNap
        ? await updateEvent(openNap.id, { endedAt: event.endedAt })
        : await appendEvents([event]);
      const [preferences, languagePreference] = await Promise.all([
        loadNotificationPreferences(),
        loadLanguagePreference(),
      ]);
      const language = resolveLanguage(languagePreference);
      await Promise.all([
        render(props, nextEvents, key),
        syncPottyReminders(nextEvents, preferences, language).catch(() => false),
        preferences.widgetConfirmations
          ? showWidgetLogConfirmation(
              { eventId: event.id, type: key, at, customLabel: activity.customLabel },
              language,
            ).catch(() => false)
          : Promise.resolve(false),
      ]);
      return;
    }
  }

  if (['WIDGET_ADDED', 'WIDGET_UPDATE', 'WIDGET_RESIZED'].includes(props.widgetAction)) {
    const events = await loadEvents();
    await render(props, events);
  }
}

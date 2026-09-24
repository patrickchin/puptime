'use no memo';

import type { WidgetTaskHandlerProps } from 'react-native-android-widget';

import {
  createEvent,
  createNapEvent,
  isOpenNap,
  isQuickEventType,
  latestQuickEventTimes,
  type PuppyEvent,
  type QuickEventType,
} from './domain';
import { resolveLanguage } from './localization';
import { showWidgetLogConfirmation, syncPottyReminders } from './reminders';
import {
  appendEvents,
  loadEvents,
  loadLanguagePreference,
  loadNotificationPreferences,
  loadThemePreference,
  loadWidgetActions,
  updateEvent,
} from './storage';
import { QuickLogWidget } from './widgets/QuickLogWidget.android';

async function render(props: WidgetTaskHandlerProps, events: PuppyEvent[], confirmedAction?: QuickEventType) {
  const compact = props.widgetInfo.height < 90;
  const activeNap = events.some(isOpenNap);
  const actions = await loadWidgetActions();
  const themePreference = await loadThemePreference();
  const lastEventAt = latestQuickEventTimes(events);
  props.renderWidget({
    light: <QuickLogWidget compact={compact} activeNap={activeNap} lastEventAt={lastEventAt} actions={actions} confirmedAction={confirmedAction} themePreference={themePreference} />,
    dark: <QuickLogWidget compact={compact} activeNap={activeNap} lastEventAt={lastEventAt} actions={actions} confirmedAction={confirmedAction} themePreference={themePreference} dark />,
  });
}

export async function widgetTaskHandler(props: WidgetTaskHandlerProps) {
  if (props.widgetAction === 'WIDGET_CLICK' && props.clickAction === 'LOG_EVENT') {
    const type = props.clickActionData?.type;
    if (isQuickEventType(type)) {
      const at = Date.now();
      const current = await loadEvents();
      const openNap = type === 'nap' ? current.find(isOpenNap) : undefined;
      const event = openNap
        ? { ...openNap, endedAt: Math.max(openNap.at, at) }
        : type === 'nap'
          ? createNapEvent('widget', at)
          : createEvent(type, 'widget', at);
      const nextEvents = openNap
        ? await updateEvent(openNap.id, { endedAt: event.endedAt })
        : await appendEvents([event]);
      const [preferences, languagePreference] = await Promise.all([
        loadNotificationPreferences(),
        loadLanguagePreference(),
      ]);
      const language = resolveLanguage(languagePreference);
      await Promise.all([
        render(props, nextEvents, type),
        syncPottyReminders(nextEvents, preferences, language).catch(() => false),
        preferences.widgetConfirmations
          ? showWidgetLogConfirmation(
              { eventId: event.id, type, at },
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

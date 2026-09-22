'use no memo';

import type { WidgetTaskHandlerProps } from 'react-native-android-widget';

import {
  createEvent,
  createNapEvent,
  isOpenNap,
  isQuickEventType,
  type PuppyEvent,
  type QuickEventType,
} from './domain';
import { resolveLanguage } from './localization';
import { showWidgetLogConfirmation } from './reminders';
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
  props.renderWidget({
    light: <QuickLogWidget compact={compact} activeNap={activeNap} actions={actions} confirmedAction={confirmedAction} themePreference={themePreference} />,
    dark: <QuickLogWidget compact={compact} activeNap={activeNap} actions={actions} confirmedAction={confirmedAction} themePreference={themePreference} dark />,
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
      await Promise.all([
        render(props, nextEvents, type),
        preferences.widgetConfirmations
          ? showWidgetLogConfirmation(
              { eventId: event.id, type, at },
              resolveLanguage(languagePreference),
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

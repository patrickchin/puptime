import { requestWidgetUpdate } from 'react-native-android-widget';

import { isOpenNap, latestQuickEventTimes, type PuppyEvent } from '../domain';
import { loadCustomActivities, loadThemePreference, loadWidgetActions, loadNotificationPreferences } from '../storage';
import { QuickLogWidget } from './QuickLogWidget.android';
import { ANDROID_WIDGET_LAYOUTS } from './widget-layouts';
import { pottyReminderPlans } from '../reminder-config';

export async function readPendingWidgetEvents(): Promise<PuppyEvent[]> {
  return [];
}

export async function acknowledgePendingWidgetEvents(_events: PuppyEvent[]): Promise<void> {}

export async function updateHomeWidget(events: PuppyEvent[]): Promise<void> {
  const activeNap = events.some(isOpenNap);
  const lastEventAt = latestQuickEventTimes(events);
  const customActivities = await loadCustomActivities(events);
  const [actions, themePreference, preferences] = await Promise.all([
    loadWidgetActions(customActivities), loadThemePreference(), loadNotificationPreferences(),
  ]);
  const nextPottyAt = pottyReminderPlans(events, preferences).sort((a, b) => a.at - b.at)[0]?.at;
  const openNapAt = events.find(isOpenNap)?.at;
  await Promise.all(Object.entries(ANDROID_WIDGET_LAYOUTS).map(([widgetName, layout]) => requestWidgetUpdate({
    widgetName,
    renderWidget: ({ height }) => ({
      light: <QuickLogWidget layout={layout} nextPottyAt={nextPottyAt} openNapAt={openNapAt} compact={height < 90} activeNap={activeNap} lastEventAt={lastEventAt} actions={actions} customActivities={customActivities} themePreference={themePreference} />,
      dark: <QuickLogWidget layout={layout} nextPottyAt={nextPottyAt} openNapAt={openNapAt} compact={height < 90} activeNap={activeNap} lastEventAt={lastEventAt} actions={actions} customActivities={customActivities} themePreference={themePreference} dark />,
    }),
  })));
}

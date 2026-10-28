import { requestWidgetUpdate } from 'react-native-android-widget';

import { isOpenNap, latestQuickEventTimes, type PuppyEvent } from '../domain';
import { loadCustomActivities, loadThemePreference, loadWidgetActions } from '../storage';
import { QuickLogWidget } from './QuickLogWidget.android';

export async function readPendingWidgetEvents(): Promise<PuppyEvent[]> {
  return [];
}

export async function acknowledgePendingWidgetEvents(_events: PuppyEvent[]): Promise<void> {}

export async function updateHomeWidget(events: PuppyEvent[]): Promise<void> {
  const activeNap = events.some(isOpenNap);
  const lastEventAt = latestQuickEventTimes(events);
  const customActivities = await loadCustomActivities(events);
  const [actions, themePreference] = await Promise.all([
    loadWidgetActions(customActivities), loadThemePreference(),
  ]);
  await requestWidgetUpdate({
    widgetName: 'PuptimeQuickLog',
    renderWidget: ({ height }) => ({
      light: <QuickLogWidget compact={height < 90} activeNap={activeNap} lastEventAt={lastEventAt} actions={actions} customActivities={customActivities} themePreference={themePreference} />,
      dark: <QuickLogWidget compact={height < 90} activeNap={activeNap} lastEventAt={lastEventAt} actions={actions} customActivities={customActivities} themePreference={themePreference} dark />,
    }),
  });
}

import {getCareAccess} from '../care-access';
import { requestWidgetUpdate } from 'react-native-android-widget';

import { isOpenNap, latestQuickEventTimes, type PuppyEvent } from '../domain';
import { loadCustomActivities, loadThemePreference, loadWidgetActions } from '../storage';
import { QuickLogWidget } from './QuickLogWidget.android';

export async function readPendingWidgetEvents(): Promise<PuppyEvent[]> {
  return [];
}

export async function acknowledgePendingWidgetEvents(_events: PuppyEvent[]): Promise<void> {}

export async function updateHomeWidget(events: PuppyEvent[],expectedPetId?:string): Promise<void> {
  const access=await getCareAccess();if(expectedPetId&&access.petId!==expectedPetId)return;
  const activeNap = events.some(isOpenNap);
  const lastEventAt = latestQuickEventTimes(events);
  const customActivities = await loadCustomActivities(events);
  const [actions, themePreference] = await Promise.all([
    loadWidgetActions(customActivities), loadThemePreference(),
  ]);
  await requestWidgetUpdate({
    widgetName: 'PuptimeQuickLog',
    renderWidget: ({ height }) => ({
      light: <QuickLogWidget scope={access.scope} canLog={access.canLog} compact={height < 90} activeNap={activeNap} lastEventAt={lastEventAt} actions={actions} customActivities={customActivities} themePreference={themePreference} />,
      dark: <QuickLogWidget scope={access.scope} canLog={access.canLog} compact={height < 90} activeNap={activeNap} lastEventAt={lastEventAt} actions={actions} customActivities={customActivities} themePreference={themePreference} dark />,
    }),
  });
}

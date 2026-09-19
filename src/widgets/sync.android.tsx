import { requestWidgetUpdate } from 'react-native-android-widget';

import { isOpenNap, type PuppyEvent } from '../domain';
import { loadWidgetActions } from '../storage';
import { QuickLogWidget } from './QuickLogWidget.android';

export async function readPendingWidgetEvents(): Promise<PuppyEvent[]> {
  return [];
}

export async function updateHomeWidget(events: PuppyEvent[]): Promise<void> {
  const activeNap = events.some(isOpenNap);
  const actions = await loadWidgetActions();
  await requestWidgetUpdate({
    widgetName: 'PuptimeQuickLog',
    renderWidget: ({ height }) => ({
      light: <QuickLogWidget compact={height < 90} activeNap={activeNap} actions={actions} />,
      dark: <QuickLogWidget compact={height < 90} activeNap={activeNap} actions={actions} dark />,
    }),
  });
}

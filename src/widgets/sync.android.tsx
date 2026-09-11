import { requestWidgetUpdate } from 'react-native-android-widget';

import { eventLabel, isOpenNap, relativeTime, type PuppyEvent } from '../domain';
import { QuickLogWidget } from './QuickLogWidget.android';

export async function readPendingWidgetEvents(): Promise<PuppyEvent[]> {
  return [];
}

export async function updateHomeWidget(events: PuppyEvent[]): Promise<void> {
  const latest = events[0];
  const latestLabel = latest ? `${eventLabel(latest)} · ${relativeTime(latest.endedAt ?? latest.at)}` : 'Tap to log';
  const activeNap = events.some(isOpenNap);
  await requestWidgetUpdate({
    widgetName: 'PuptimeQuickLog',
    renderWidget: ({ height }) => ({
      light: <QuickLogWidget latestLabel={latestLabel} compact={height < 90} activeNap={activeNap} />,
      dark: <QuickLogWidget latestLabel={latestLabel} compact={height < 90} activeNap={activeNap} dark />,
    }),
  });
}

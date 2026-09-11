import { requestWidgetUpdate } from 'react-native-android-widget';

import { EVENT_META, relativeTime, type PuppyEvent } from '../domain';
import { QuickLogWidget } from './QuickLogWidget.android';

export async function readPendingWidgetEvents(): Promise<PuppyEvent[]> {
  return [];
}

export async function updateHomeWidget(events: PuppyEvent[]): Promise<void> {
  const latest = events[0];
  const latestLabel = latest ? `${EVENT_META[latest.type].label} · ${relativeTime(latest.at)}` : 'Tap to log';
  await requestWidgetUpdate({
    widgetName: 'PuptimeQuickLog',
    renderWidget: ({ height }) => ({
      light: <QuickLogWidget latestLabel={latestLabel} compact={height < 90} />,
      dark: <QuickLogWidget latestLabel={latestLabel} compact={height < 90} dark />,
    }),
  });
}

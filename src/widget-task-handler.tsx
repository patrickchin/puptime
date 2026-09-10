'use no memo';

import type { WidgetTaskHandlerProps } from 'react-native-android-widget';

import { EVENT_META, createEvent, isEventType, relativeTime } from './domain';
import { appendEvents, loadEvents } from './storage';
import { QuickLogWidget } from './widgets/QuickLogWidget.android';

function render(props: WidgetTaskHandlerProps, latestLabel: string) {
  props.renderWidget({
    light: <QuickLogWidget latestLabel={latestLabel} />,
    dark: <QuickLogWidget latestLabel={latestLabel} dark />,
  });
}

export async function widgetTaskHandler(props: WidgetTaskHandlerProps) {
  if (props.widgetAction === 'WIDGET_CLICK' && props.clickAction === 'LOG_EVENT') {
    const type = props.clickActionData?.type;
    if (isEventType(type)) {
      const events = await appendEvents([createEvent(type, 'widget')]);
      render(props, `${EVENT_META[type].label} · just now`);
      return;
    }
  }

  if (['WIDGET_ADDED', 'WIDGET_UPDATE', 'WIDGET_RESIZED'].includes(props.widgetAction)) {
    const latest = (await loadEvents())[0];
    render(props, latest ? `${EVENT_META[latest.type].label} · ${relativeTime(latest.at)}` : 'Tap to log');
  }
}

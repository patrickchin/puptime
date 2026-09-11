'use no memo';

import type { WidgetTaskHandlerProps } from 'react-native-android-widget';

import { EVENT_META, createEvent, isEventType, normalizeBackdateMinutes, relativeTime } from './domain';
import { appendEvents, loadEvents } from './storage';
import { QuickLogWidget } from './widgets/QuickLogWidget.android';

function render(props: WidgetTaskHandlerProps, latestLabel: string, backdateMinutes = 0) {
  const compact = props.widgetInfo.height < 90;
  props.renderWidget({
    light: <QuickLogWidget latestLabel={latestLabel} compact={compact} backdateMinutes={backdateMinutes} />,
    dark: <QuickLogWidget latestLabel={latestLabel} compact={compact} backdateMinutes={backdateMinutes} dark />,
  });
}

export async function widgetTaskHandler(props: WidgetTaskHandlerProps) {
  if (props.widgetAction === 'WIDGET_CLICK' && props.clickAction === 'LOG_EVENT') {
    const type = props.clickActionData?.type;
    if (isEventType(type)) {
      const minutesAgo = normalizeBackdateMinutes(props.clickActionData?.minutesAgo);
      const at = Date.now() - minutesAgo * 60_000;
      await appendEvents([createEvent(type, 'widget', at)]);
      render(props, `${EVENT_META[type].label} · ${minutesAgo ? `${minutesAgo}m ago` : 'just now'}`);
      return;
    }
  }

  if (props.widgetAction === 'WIDGET_CLICK' && props.clickAction === 'ADJUST_TIME') {
    const minutesAgo = normalizeBackdateMinutes(props.clickActionData?.minutesAgo);
    const latest = (await loadEvents())[0];
    render(props, latest ? `${EVENT_META[latest.type].label} · ${relativeTime(latest.at)}` : 'Tap to log', minutesAgo);
    return;
  }

  if (['WIDGET_ADDED', 'WIDGET_UPDATE', 'WIDGET_RESIZED'].includes(props.widgetAction)) {
    const latest = (await loadEvents())[0];
    render(props, latest ? `${EVENT_META[latest.type].label} · ${relativeTime(latest.at)}` : 'Tap to log');
  }
}

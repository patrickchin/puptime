'use no memo';

import type { WidgetTaskHandlerProps } from 'react-native-android-widget';

import {
  EVENT_META,
  createEvent,
  createNapEvent,
  eventLabel,
  isOpenNap,
  isQuickEventType,
  normalizeBackdateMinutes,
  relativeTime,
  type PuppyEvent,
} from './domain';
import { appendEvents, loadEvents, updateEvent } from './storage';
import { QuickLogWidget } from './widgets/QuickLogWidget.android';

function latestLabel(events: PuppyEvent[]): string {
  const latest = events[0];
  return latest ? `${eventLabel(latest)} · ${relativeTime(latest.endedAt ?? latest.at)}` : 'Tap to log';
}

function render(props: WidgetTaskHandlerProps, events: PuppyEvent[], label = latestLabel(events), backdateMinutes = 0) {
  const compact = props.widgetInfo.height < 90;
  const activeNap = events.some(isOpenNap);
  props.renderWidget({
    light: <QuickLogWidget latestLabel={label} compact={compact} backdateMinutes={backdateMinutes} activeNap={activeNap} />,
    dark: <QuickLogWidget latestLabel={label} compact={compact} backdateMinutes={backdateMinutes} activeNap={activeNap} dark />,
  });
}

export async function widgetTaskHandler(props: WidgetTaskHandlerProps) {
  if (props.widgetAction === 'WIDGET_CLICK' && props.clickAction === 'LOG_EVENT') {
    const type = props.clickActionData?.type;
    if (isQuickEventType(type)) {
      const minutesAgo = normalizeBackdateMinutes(props.clickActionData?.minutesAgo);
      const at = Date.now() - minutesAgo * 60_000;
      const current = await loadEvents();
      const openNap = type === 'nap' ? current.find(isOpenNap) : undefined;
      const nextEvents = openNap
        ? await updateEvent(openNap.id, { endedAt: Math.max(openNap.at, at) })
        : await appendEvents([type === 'nap' ? createNapEvent('widget', at) : createEvent(type, 'widget', at)]);
      const action = openNap ? 'Nap ended' : type === 'nap' ? 'Nap started' : EVENT_META[type].label;
      render(props, nextEvents, `${action} · ${minutesAgo ? `${minutesAgo}m ago` : 'just now'}`);
      return;
    }
  }

  if (props.widgetAction === 'WIDGET_CLICK' && props.clickAction === 'ADJUST_TIME') {
    const minutesAgo = normalizeBackdateMinutes(props.clickActionData?.minutesAgo);
    const events = await loadEvents();
    render(props, events, latestLabel(events), minutesAgo);
    return;
  }

  if (['WIDGET_ADDED', 'WIDGET_UPDATE', 'WIDGET_RESIZED'].includes(props.widgetAction)) {
    const events = await loadEvents();
    render(props, events);
  }
}

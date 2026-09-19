'use no memo';

import type { WidgetTaskHandlerProps } from 'react-native-android-widget';

import {
  createEvent,
  createNapEvent,
  isOpenNap,
  isQuickEventType,
  normalizeBackdateMinutes,
  type PuppyEvent,
} from './domain';
import { appendEvents, loadEvents, loadWidgetActions, updateEvent } from './storage';
import { QuickLogWidget } from './widgets/QuickLogWidget.android';

async function render(props: WidgetTaskHandlerProps, events: PuppyEvent[], backdateMinutes = 0) {
  const compact = props.widgetInfo.height < 90;
  const activeNap = events.some(isOpenNap);
  const actions = await loadWidgetActions();
  props.renderWidget({
    light: <QuickLogWidget compact={compact} backdateMinutes={backdateMinutes} activeNap={activeNap} actions={actions} />,
    dark: <QuickLogWidget compact={compact} backdateMinutes={backdateMinutes} activeNap={activeNap} actions={actions} dark />,
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
      await render(props, nextEvents);
      return;
    }
  }

  if (props.widgetAction === 'WIDGET_CLICK' && props.clickAction === 'ADJUST_TIME') {
    const minutesAgo = normalizeBackdateMinutes(props.clickActionData?.minutesAgo);
    const events = await loadEvents();
    await render(props, events, minutesAgo);
    return;
  }

  if (['WIDGET_ADDED', 'WIDGET_UPDATE', 'WIDGET_RESIZED'].includes(props.widgetAction)) {
    const events = await loadEvents();
    await render(props, events);
  }
}

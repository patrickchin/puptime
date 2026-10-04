import { NativeModules } from 'react-native';

import { widgetActionsForState, type ActivityKey, type QuickEventTimes } from '../domain';
import { nextVisibleAgoChange } from './ago';

export function scheduleWidgetAgoRefresh(
  times: QuickEventTimes,
  actions: readonly ActivityKey[],
  activeNap: boolean,
  customActivities: readonly string[],
  now: number,
): void {
  const visible = widgetActionsForState(actions, activeNap, customActivities);
  const next = nextVisibleAgoChange(times, visible, now);
  NativeModules.WidgetAgoRefresh?.schedule(next ?? 0);
}

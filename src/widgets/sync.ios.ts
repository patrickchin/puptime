import { isOpenNap, type PuppyEvent } from '../domain';
import { loadWidgetActions } from '../storage';
import PuptimeWidget, { type PuptimeWidgetProps } from './PuptimeWidget.ios';

export async function readPendingWidgetEvents(): Promise<PuppyEvent[]> {
  try {
    const timeline = await PuptimeWidget.getTimeline();
    const pending = timeline.flatMap((entry) => (entry.props as PuptimeWidgetProps).pending ?? []);
    return [...new Map(pending.map((event) => [event.id, { ...event, source: 'widget' as const }])).values()];
  } catch {
    return [];
  }
}

export async function updateHomeWidget(events: PuppyEvent[]): Promise<void> {
  const openNap = events.find(isOpenNap);
  const actions = await loadWidgetActions();
  await PuptimeWidget.updateSnapshot({
    pending: [],
    backdateMinutes: 0,
    openNap: openNap ? { id: openNap.id, type: 'nap', at: openNap.at, endedAt: null } : null,
    actions,
  });
}

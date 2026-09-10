import type { PuppyEvent } from '../domain';
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
  const latest = events[0];
  await PuptimeWidget.updateSnapshot({
    pending: [],
    latestLabel: latest ? `${new Date(latest.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Tap to log',
  });
}

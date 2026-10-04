import type { ActivityKey, QuickEventTimes } from '../domain';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function widgetAgo(at: number, now = Date.now()): string {
  const age = Math.max(0, now - at);
  // Switch units when rounding would first show 60m or 24h.
  if (age < 57.5 * MINUTE) {
    const minutes = Math.round(age / (5 * MINUTE)) * 5;
    return minutes === 0 ? 'Just now' : `${minutes}m ago`;
  }
  if (age < 23.5 * HOUR) return `${Math.round(age / HOUR)}h ago`;
  return `${Math.round(age / DAY)}d ago`;
}

export function nextWidgetAgoChange(at: number, now = Date.now()): number {
  const age = Math.max(0, now - at);
  const step = age < 57.5 * MINUTE ? 5 * MINUTE : age < 23.5 * HOUR ? HOUR : DAY;
  return at + (Math.round(age / step) + 0.5) * step;
}

export function nextVisibleAgoChange(times: QuickEventTimes, actions: readonly ActivityKey[], now = Date.now()): number | undefined {
  const changes = actions
    .map((action) => times[action])
    .filter((at): at is number => at !== undefined)
    .map((at) => nextWidgetAgoChange(at, now));
  return changes.length ? Math.min(...changes) : undefined;
}

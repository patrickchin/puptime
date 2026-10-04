import { dateKey, type PuppyEvent } from './domain.ts';

export function groupLogHistory(events: readonly PuppyEvent[], now: number, loadedOlderDays: number) {
  const todayKey = dateKey(now);
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = dateKey(yesterday);
  const byDay = new Map<string, PuppyEvent[]>([[todayKey, []], [yesterdayKey, []]]);

  for (const event of events) {
    const key = dateKey(event.at);
    const day = byDay.get(key);
    if (day) day.push(event);
    else byDay.set(key, [event]);
  }

  const days = [...byDay.entries()]
    .sort(([left], [right]) => right.localeCompare(left))
    .map(([key, data]) => ({ key, data }));
  return { days: days.slice(0, 2 + loadedOlderDays), hasMoreDays: days.length > 2 + loadedOlderDays };
}

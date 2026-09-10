import { dateKey, eventTypes, type EventType, type PuppyEvent, type ScheduleEntry } from './domain.ts';

export type DaySummary = {
  key: string;
  date: Date;
  counts: Record<EventType, number>;
  total: number;
  adherence: number | null;
};

export function adherenceForDay(
  events: PuppyEvent[],
  schedule: ScheduleEntry[],
  day: Date,
  toleranceMinutes = 30,
): number | null {
  if (schedule.length === 0) return null;

  const key = dateKey(day);
  const candidates = events.filter((event) => dateKey(event.at) === key);
  const planned = [...schedule]
    .sort((a, b) => a.minutes - b.minutes)
    .map((entry) => {
      const target = new Date(day);
      target.setHours(Math.floor(entry.minutes / 60), entry.minutes % 60, 0, 0);
      return { ...entry, target: target.getTime() };
    });
  const matches = new Map<string, number>();
  let matched = 0;

  const tryMatch = (plannedIndex: number, seenEvents: Set<string>): boolean => {
    const item = planned[plannedIndex];
    const options = candidates
      .filter(
        (event) =>
          event.type === item.type && Math.abs(event.at - item.target) <= toleranceMinutes * 60_000,
      )
      .sort((a, b) => Math.abs(a.at - item.target) - Math.abs(b.at - item.target));

    for (const event of options) {
      if (seenEvents.has(event.id)) continue;
      seenEvents.add(event.id);
      const previousPlan = matches.get(event.id);
      if (previousPlan === undefined || tryMatch(previousPlan, seenEvents)) {
        matches.set(event.id, plannedIndex);
        return true;
      }
    }

    return false;
  };

  for (let index = 0; index < planned.length; index += 1) {
    if (tryMatch(index, new Set())) matched += 1;
  }

  return Math.round((matched / schedule.length) * 100);
}

export function summarizeDays(
  events: PuppyEvent[],
  schedule: ScheduleEntry[],
  days = 7,
  now = new Date(),
): DaySummary[] {
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(now);
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - (days - index - 1));
    const key = dateKey(date);
    const dayEvents = events.filter((event) => dateKey(event.at) === key);
    const counts = Object.fromEntries(
      eventTypes.map((type) => [type, dayEvents.filter((event) => event.type === type).length]),
    ) as Record<EventType, number>;

    return {
      key,
      date,
      counts,
      total: dayEvents.length,
      adherence: adherenceForDay(events, schedule, date),
    };
  });
}

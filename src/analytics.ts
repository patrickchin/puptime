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
  const used = new Set<string>();
  let matched = 0;

  for (const planned of [...schedule].sort((a, b) => a.minutes - b.minutes)) {
    const target = new Date(day);
    target.setHours(Math.floor(planned.minutes / 60), planned.minutes % 60, 0, 0);

    let nearest: PuppyEvent | undefined;
    let nearestDistance = Number.POSITIVE_INFINITY;

    for (const event of candidates) {
      if (event.type !== planned.type || used.has(event.id)) continue;
      const distance = Math.abs(event.at - target.getTime());
      if (distance <= toleranceMinutes * 60_000 && distance < nearestDistance) {
        nearest = event;
        nearestDistance = distance;
      }
    }

    if (nearest) {
      used.add(nearest.id);
      matched += 1;
    }
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

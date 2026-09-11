import { dateKey, eventTypes, type EventType, type PuppyEvent, type ScheduleEntry } from './domain.ts';

export type DaySummary = {
  key: string;
  date: Date;
  counts: Record<EventType, number>;
  total: number;
  napMinutes: number;
  adherence: number | null;
};

export type ScheduleStatus = 'done' | 'due' | 'upcoming' | 'missed';

export type ScheduleStatusItem = {
  entry: ScheduleEntry;
  target: number;
  status: ScheduleStatus;
  event?: PuppyEvent;
};

export function napMinutesForDay(events: PuppyEvent[], day: Date, now = Date.now()): number {
  const dayStart = new Date(day);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  const milliseconds = events
    .filter((event) => event.type === 'nap' && event.endedAt !== undefined)
    .reduce((sum, event) => {
      const end = event.endedAt ?? now;
      return sum + Math.max(0, Math.min(end, dayEnd.getTime(), now) - Math.max(event.at, dayStart.getTime()));
    }, 0);
  return Math.round(milliseconds / 60_000);
}

export function adherenceForDay(
  events: PuppyEvent[],
  schedule: ScheduleEntry[],
  day: Date,
  toleranceMinutes = 30,
  now = Date.now(),
): number | null {
  if (schedule.length === 0) return null;

  const completedWindows = scheduleStatusesForDay(events, schedule, day, toleranceMinutes, now)
    .filter((item) => item.target + toleranceMinutes * 60_000 <= now);
  if (completedWindows.length === 0) return null;
  const matched = completedWindows.filter((item) => item.status === 'done').length;
  return Math.round((matched / completedWindows.length) * 100);
}

export function scheduleStatusesForDay(
  events: PuppyEvent[],
  schedule: ScheduleEntry[],
  day: Date,
  toleranceMinutes = 30,
  now = Date.now(),
): ScheduleStatusItem[] {
  const tolerance = toleranceMinutes * 60_000;

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

  const tryMatch = (plannedIndex: number, seenEvents: Set<string>): boolean => {
    const item = planned[plannedIndex];
    const options = candidates
      .filter(
        (event) =>
          event.type === item.type && Math.abs(event.at - item.target) <= tolerance,
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
    tryMatch(index, new Set());
  }

  const eventsByPlan = new Map<number, PuppyEvent>();
  matches.forEach((plannedIndex, eventId) => {
    const event = candidates.find((candidate) => candidate.id === eventId);
    if (event) eventsByPlan.set(plannedIndex, event);
  });

  return planned.map((item, index) => {
    const event = eventsByPlan.get(index);
    let status: ScheduleStatus;
    if (event) status = 'done';
    else if (now < item.target - tolerance) status = 'upcoming';
    else if (now <= item.target + tolerance) status = 'due';
    else status = 'missed';

    const { target, ...entry } = item;
    return { entry, target, status, ...(event ? { event } : {}) };
  });
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
      napMinutes: napMinutesForDay(events, date, now.getTime()),
      adherence: adherenceForDay(events, schedule, date, 30, now.getTime()),
    };
  });
}

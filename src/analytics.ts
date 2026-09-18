import { dateKey, eventLabel, type EventType, type PuppyEvent, type ScheduleEntry } from './domain.ts';

export const TIMELINE_BUCKET_MINUTES = 15;
export const TIMELINE_BUCKETS = (24 * 60) / TIMELINE_BUCKET_MINUTES;

export type TimelineMark = {
  id: string;
  type: EventType;
  label: string;
  startBucket: number;
  endBucket?: number;
};

export type TimelineDay = {
  key: string;
  date: Date;
  marks: TimelineMark[];
};

export type ScheduleStatus = 'done' | 'due' | 'upcoming' | 'missed';

export type ScheduleStatusItem = {
  entry: ScheduleEntry;
  target: number;
  status: ScheduleStatus;
  event?: PuppyEvent;
};

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

function minutesIntoDay(value: number): number {
  const date = new Date(value);
  return date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60 + date.getMilliseconds() / 60_000;
}

export function timelineBucket(value: number): number {
  return Math.min(TIMELINE_BUCKETS - 1, Math.floor(minutesIntoDay(value) / TIMELINE_BUCKET_MINUTES));
}

export function buildTimelineDays(
  events: PuppyEvent[],
  days = 14,
  now = new Date(),
): TimelineDay[] {
  const dayCount = Math.max(0, Math.floor(days));
  const nowTime = now.getTime();

  return Array.from({ length: dayCount }, (_, index) => {
    const date = new Date(now);
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - (dayCount - index - 1));
    const key = dateKey(date);
    const dayStart = date.getTime();
    const dayEndDate = new Date(date);
    dayEndDate.setDate(dayEndDate.getDate() + 1);
    const dayEnd = dayEndDate.getTime();

    const marks = events.flatMap<TimelineMark>((event) => {
      if (event.type === 'nap' && event.endedAt !== undefined) {
        const napEnd = Math.max(event.at, Math.min(event.endedAt ?? nowTime, nowTime));
        const start = Math.max(event.at, dayStart);
        const end = Math.min(napEnd, dayEnd);
        if (end <= start) return [];

        const startBucket = start === dayStart ? 0 : timelineBucket(start);
        const endBucket = end === dayEnd
          ? TIMELINE_BUCKETS
          : Math.min(
              TIMELINE_BUCKETS,
              Math.max(startBucket + 1, Math.ceil(minutesIntoDay(end) / TIMELINE_BUCKET_MINUTES)),
            );
        return [{
          id: event.id,
          type: event.type,
          label: eventLabel(event),
          startBucket,
          endBucket,
        }];
      }

      if (dateKey(event.at) !== key) return [];
      return [{
        id: event.id,
        type: event.type,
        label: eventLabel(event),
        startBucket: timelineBucket(event.at),
      }];
    }).sort((a, b) =>
      a.startBucket - b.startBucket
      || Number(a.endBucket === undefined) - Number(b.endBucket === undefined),
    );

    return {
      key,
      date,
      marks,
    };
  });
}

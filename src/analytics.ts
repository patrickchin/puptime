import {
  dateKey,
  eventLabel,
  isQuickEventType,
  quickEventTypes,
  type EventType,
  type PuppyEvent,
  type ScheduleEntry,
} from './domain.ts';

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

export type ActivityFrequencyStat = {
  type: EventType;
  total: number;
  recordedDays: number;
  averagePerRecordedDay: number;
  minimumPerRecordedDay: number;
  maximumPerRecordedDay: number;
  intervalSamples: number;
  medianIntervalMinutes?: number;
  lowerIntervalMinutes?: number;
  upperIntervalMinutes?: number;
};

export type ActivityFrequencySnapshot = {
  periodDays: number;
  recordedDays: number;
  stats: ActivityFrequencyStat[];
};

export type ScheduleSuggestion = {
  entries: ScheduleEntry[];
  daysAnalyzed: number;
  periodDays: number;
  sourceEvents: number;
};

export type ScheduleStatus = 'done' | 'due' | 'upcoming' | 'missed';

export type ScheduleStatusItem = {
  entry: ScheduleEntry;
  target: number;
  status: ScheduleStatus;
  event?: PuppyEvent;
};

function windowedEvents(events: PuppyEvent[], days: number, now: Date): PuppyEvent[] {
  const periodDays = Math.max(1, Math.floor(days));
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (periodDays - 1));
  const end = now.getTime();
  return events.filter((event) => event.at >= start.getTime() && event.at <= end);
}

function percentile(values: number[], amount: number): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * Math.min(1, Math.max(0, amount));
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

export function activityFrequencyStats(
  events: PuppyEvent[],
  types: readonly EventType[] = ['pee', 'poop'],
  days = 14,
  now = new Date(),
): ActivityFrequencySnapshot {
  const periodDays = Math.max(1, Math.floor(days));
  const recent = windowedEvents(events, periodDays, now);
  const recordedDayKeys = [...new Set(recent.map((event) => dateKey(event.at)))].sort();

  return {
    periodDays,
    recordedDays: recordedDayKeys.length,
    stats: types.map((type) => {
      const matching = recent.filter((event) => event.type === type).sort((a, b) => a.at - b.at);
      const countByDay = new Map<string, number>();
      matching.forEach((event) => {
        const key = dateKey(event.at);
        countByDay.set(key, (countByDay.get(key) ?? 0) + 1);
      });
      const dailyCounts = recordedDayKeys.map((key) => countByDay.get(key) ?? 0);
      const intervals = matching
        .slice(1)
        .map((event, index) => (event.at - matching[index].at) / 60_000)
        .filter((minutes) => minutes > 0);

      return {
        type,
        total: matching.length,
        recordedDays: recordedDayKeys.length,
        averagePerRecordedDay: recordedDayKeys.length ? matching.length / recordedDayKeys.length : 0,
        minimumPerRecordedDay: dailyCounts.length ? Math.min(...dailyCounts) : 0,
        maximumPerRecordedDay: dailyCounts.length ? Math.max(...dailyCounts) : 0,
        intervalSamples: intervals.length,
        ...(intervals.length
          ? {
              medianIntervalMinutes: percentile(intervals, 0.5),
              lowerIntervalMinutes: percentile(intervals, 0.25),
              upperIntervalMinutes: percentile(intervals, 0.75),
            }
          : {}),
      };
    }),
  };
}

export function suggestScheduleFromEvents(
  events: PuppyEvent[],
  days = 14,
  now = new Date(),
): ScheduleSuggestion {
  const periodDays = Math.max(1, Math.floor(days));
  const recent = windowedEvents(events, periodDays, now);
  const recordedDayKeys = [...new Set(recent.map((event) => dateKey(event.at)))].sort();
  if (recordedDayKeys.length < 3) {
    return { entries: [], daysAnalyzed: recordedDayKeys.length, periodDays, sourceEvents: recent.length };
  }

  const byTypeAndDay = new Map<EventType, Map<string, number[]>>();
  quickEventTypes.forEach((type) => byTypeAndDay.set(type, new Map()));
  recent.forEach((event) => {
    if (!isQuickEventType(event.type)) return;
    const day = dateKey(event.at);
    const date = new Date(event.at);
    const minutes = date.getHours() * 60 + date.getMinutes();
    const byDay = byTypeAndDay.get(event.type);
    const times = byDay?.get(day) ?? [];
    times.push(minutes);
    times.sort((a, b) => a - b);
    byDay?.set(day, times);
  });

  const requiredDays = Math.max(3, Math.ceil(recordedDayKeys.length / 2));
  const entries: ScheduleEntry[] = [];
  const seen = new Set<string>();

  quickEventTypes.forEach((type) => {
    const byDay = byTypeAndDay.get(type) ?? new Map<string, number[]>();
    const dailyCounts = recordedDayKeys.map((key) => byDay.get(key)?.length ?? 0);
    const typicalCount = Math.min(8, Math.max(0, Math.round(percentile(dailyCounts, 0.5) ?? 0)));

    for (let index = 0; index < typicalCount; index += 1) {
      const samples = recordedDayKeys.flatMap((key) => {
        const value = byDay.get(key)?.[index];
        return value === undefined ? [] : [value];
      });
      if (samples.length < requiredDays) continue;
      const medianMinutes = percentile(samples, 0.5);
      if (medianMinutes === undefined) continue;
      const minutes = Math.round(medianMinutes / TIMELINE_BUCKET_MINUTES) * TIMELINE_BUCKET_MINUTES % (24 * 60);
      const identity = `${type}-${minutes}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      entries.push({
        id: `learned-${type}-${minutes}-${index}`,
        type,
        minutes,
        reminder: false,
      });
    }
  });

  return {
    entries: entries.sort((a, b) => a.minutes - b.minutes || a.type.localeCompare(b.type)),
    daysAnalyzed: recordedDayKeys.length,
    periodDays,
    sourceEvents: recent.length,
  };
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
  endDate = new Date(),
  now = endDate,
): TimelineDay[] {
  const dayCount = Math.max(0, Math.floor(days));
  const nowTime = now.getTime();

  return Array.from({ length: dayCount }, (_, index) => {
    const date = new Date(endDate);
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

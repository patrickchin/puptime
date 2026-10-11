import {
  dateKey,
  activityKey,
  eventLabel,
  quickEventTypes,
  sameActivity,
  type EventType,
  type Activity,
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
  estimated?: boolean;
};

export type TimelineDay = {
  key: string;
  date: Date;
  marks: TimelineMark[];
};

export type TimelinePointCluster = {
  startBucket: number;
  ids: string[];
  types: EventType[];
  hasDuration: boolean;
};

export type TimelineDurationRun = Pick<TimelineMark, 'type' | 'startBucket'> & { endBucket: number };

export type ActivityFrequencyStat = {
  type: EventType;
  customLabel?: string;
  total: number;
  estimatedTotal: number;
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

export type MonthlyActivityStat = {
  key: string;
  date: Date;
  total: number;
  estimatedTotal: number;
  recordedDays: number;
  averagePerRecordedDay: number;
};

export type ScheduleSuggestion = {
  entries: ScheduleEntry[];
  daysAnalyzed: number;
  periodDays: number;
  sourceEvents: number;
  observedDaysByEntry: Record<string, number>;
};

export type MissingLogEstimate = {
  id: string;
  type: EventType;
  customLabel?: string;
  at: number;
  endedAt?: number;
  observedDays: number;
  comparedDays: number;
};

export type MissingLogSnapshot = {
  estimates: MissingLogEstimate[];
  daysAnalyzed: number;
  periodDays: number;
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
  types: readonly (EventType | Activity)[] = ['pee', 'poop'],
  days = 14,
  now = new Date(),
): ActivityFrequencySnapshot {
  const periodDays = Math.max(1, Math.floor(days));
  const inWindow = windowedEvents(events, periodDays, now);
  const recent = inWindow.filter((event) => !event.estimated);
  const recordedDayKeys = [...new Set(recent.map((event) => dateKey(event.at)))].sort();

  return {
    periodDays,
    recordedDays: recordedDayKeys.length,
    stats: types.map((item) => {
      const activity = typeof item === 'string' ? { type: item } : item;
      const { type, customLabel } = activity;
      const matching = recent.filter((event) => sameActivity(event, activity)).sort((a, b) => a.at - b.at);
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
        ...(customLabel ? { customLabel } : {}),
        total: matching.length,
        estimatedTotal: inWindow.filter((event) => event.estimated && sameActivity(event, activity)).length,
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

export function monthlyActivityStats(
  events: PuppyEvent[],
  types?: readonly EventType[],
): MonthlyActivityStat[] {
  const selectedTypes = types ? new Set(types) : null;
  const months = new Map<string, {
    date: Date;
    total: number;
    estimatedTotal: number;
    recordedDays: Set<string>;
  }>();

  events.forEach((event) => {
    const date = new Date(event.at);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    const month = months.get(key) ?? {
      date: new Date(date.getFullYear(), date.getMonth(), 1, 12),
      total: 0,
      estimatedTotal: 0,
      recordedDays: new Set<string>(),
    };
    if (!event.estimated) month.recordedDays.add(dateKey(event.at));
    if (!selectedTypes || selectedTypes.has(event.type)) {
      if (event.estimated) month.estimatedTotal += 1;
      else month.total += 1;
    }
    months.set(key, month);
  });

  return [...months.entries()]
    .sort(([left], [right]) => right.localeCompare(left))
    .map(([key, month]) => ({
      key,
      date: month.date,
      total: month.total,
      estimatedTotal: month.estimatedTotal,
      recordedDays: month.recordedDays.size,
      averagePerRecordedDay: month.recordedDays.size ? month.total / month.recordedDays.size : 0,
    }));
}

export function suggestScheduleFromEvents(
  events: PuppyEvent[],
  days = 14,
  now = new Date(),
): ScheduleSuggestion {
  const periodDays = Math.max(1, Math.floor(days));
  // An unfinished day is not evidence that later activities were skipped.
  const completedThrough = new Date(now);
  completedThrough.setHours(0, 0, 0, 0);
  const recent = windowedEvents(events, periodDays, new Date(completedThrough.getTime() - 1))
    .filter((event) => !event.estimated);
  const recordedDayKeys = [...new Set(recent.map((event) => dateKey(event.at)))].sort();
  const observedDaysByEntry: Record<string, number> = {};
  if (recordedDayKeys.length < 3) {
    return { entries: [], daysAnalyzed: recordedDayKeys.length, periodDays, sourceEvents: recent.length, observedDaysByEntry };
  }

  const byTypeAndDay = new Map<string, { type: EventType; customLabel?: string; days: Map<string, number[]> }>();
  quickEventTypes.forEach((type) => byTypeAndDay.set(type, { type, days: new Map() }));
  recent.forEach((event) => {
    if (event.type === 'custom' && !event.customLabel?.trim()) return;
    const day = dateKey(event.at);
    const date = new Date(event.at);
    const minutes = date.getHours() * 60 + date.getMinutes();
    const key = activityKey(event);
    const activity = byTypeAndDay.get(key) ?? { type: event.type, customLabel: event.customLabel, days: new Map<string, number[]>() };
    byTypeAndDay.set(key, activity);
    const times = activity.days.get(day) ?? [];
    times.push(minutes);
    times.sort((a, b) => a - b);
    activity.days.set(day, times);
  });

  const requiredDays = Math.max(3, Math.floor(recordedDayKeys.length / 2) + 1);

  const entries: ScheduleEntry[] = [];
  const clockOffset = (minutes: number, center: number) => (minutes - center + 2160) % 1440 - 720;

  byTypeAndDay.forEach(({ type, customLabel, days: byDay }, key) => {
    let remaining = [...byDay.entries()].flatMap(([day, minutes]) => minutes.map((value) => ({ day, minutes: value })))
      .sort((a, b) => a.minutes - b.minutes || a.day.localeCompare(b.day));

    // ponytail: nearby occurrences share a clock-time window; use sequence alignment if distinct routines within three hours need separating.
    for (let index = 0; index < 8 && remaining.length; index += 1) {
      let best: number[] = [];
      let bestCenter = 0;
      let bestSpread = Infinity;
      for (const candidate of remaining) {
        const byDay = new Map<string, number>();
        for (const sample of remaining) {
          const offset = clockOffset(sample.minutes, candidate.minutes);
          const previous = byDay.get(sample.day);
          if (Math.abs(offset) <= 90 && (previous === undefined || Math.abs(offset) < Math.abs(previous))) {
            byDay.set(sample.day, offset);
          }
        }
        const offsets = [...byDay.values()];
        const spread = offsets.reduce((sum, value) => sum + Math.abs(value), 0) / offsets.length;
        if (offsets.length > best.length || (offsets.length === best.length && spread < bestSpread)) {
          best = offsets;
          bestCenter = candidate.minutes;
          bestSpread = spread;
        }
      }
      if (best.length < requiredDays) break;
      const samples = best.map((offset) => bestCenter + offset);
      const center = Math.round(percentile(samples, 0.5)! / TIMELINE_BUCKET_MINUTES) * TIMELINE_BUCKET_MINUTES;
      const minutes = (center + 1440) % 1440;
      const toleranceMinutes = Math.max(30, Math.ceil(Math.max(
        center - percentile(samples, 0.1)!,
        percentile(samples, 0.9)! - center,
      ) / TIMELINE_BUCKET_MINUTES) * TIMELINE_BUCKET_MINUTES);
      const id = `learned-${key}-${minutes}`;
      entries.push({
        id,
        type,
        ...(customLabel ? { customLabel } : {}),
        minutes,
        reminder: false,
        toleranceMinutes,
      });
      observedDaysByEntry[id] = best.length;
      // One day gets one vote, and extra taps in this window cannot create extra slots.
      remaining = remaining.filter((sample) => Math.abs(clockOffset(sample.minutes, bestCenter)) > 90);
    }
  });

  return {
    entries: entries.sort((a, b) => a.minutes - b.minutes || a.type.localeCompare(b.type)),
    daysAnalyzed: recordedDayKeys.length,
    periodDays,
    sourceEvents: recent.length,
    observedDaysByEntry,
  };
}

export function scheduleStatusesForDay(
  events: PuppyEvent[],
  schedule: ScheduleEntry[],
  day: Date,
  toleranceMinutes = 30,
  now = Date.now(),
): ScheduleStatusItem[] {
  const key = dateKey(day);
  const candidates = events.filter((event) => !event.estimated && event.at <= now);
  const planned = [...schedule]
    .sort((a, b) => a.minutes - b.minutes)
    .map((entry) => {
      const target = new Date(day);
      target.setHours(Math.floor(entry.minutes / 60), entry.minutes % 60, 0, 0);
      const tolerance = Math.max(toleranceMinutes, entry.toleranceMinutes ?? 0) * 60_000;
      return { ...entry, target: target.getTime(), tolerance };
    });
  const matches = new Map<string, number>();

  const tryMatch = (plannedIndex: number, seenEvents: Set<string>): boolean => {
    const item = planned[plannedIndex];
    const options = candidates
      .filter(
        (event) =>
          sameActivity(event, item) && Math.abs(event.at - item.target) <= item.tolerance
          && (item.toleranceMinutes !== undefined || dateKey(event.at) === key),
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
    else if (now < item.target - item.tolerance) status = 'upcoming';
    else if (now <= item.target + item.tolerance) status = 'due';
    else status = 'missed';

    const { target, tolerance: _tolerance, ...entry } = item;
    return { entry, target, status, ...(event ? { event } : {}) };
  });
}

export function estimateMissingLogs(
  events: PuppyEvent[],
  days = 14,
  now = new Date(),
): MissingLogSnapshot {
  const suggestion = suggestScheduleFromEvents(events, days, now);
  const recent = windowedEvents(events, suggestion.periodDays, now).filter((event) => !event.estimated);
  const eventsByDay = new Map<string, PuppyEvent[]>();
  recent.forEach((event) => {
    const key = dateKey(event.at);
    eventsByDay.set(key, [...(eventsByDay.get(key) ?? []), event]);
  });
  const activeDays = [...eventsByDay.keys()].sort();
  if (activeDays.length < 4 || suggestion.entries.length === 0) {
    return { estimates: [], daysAnalyzed: activeDays.length, periodDays: suggestion.periodDays };
  }

  // ponytail: use a transparent routine heuristic; calibrate a statistical model only if real usage outgrows it.
  const toleranceMinutes = 90;
  const statusesByDay = new Map<string, ScheduleStatusItem[]>();
  activeDays.forEach((key) => {
    const day = new Date(`${key}T12:00:00`);
    const endOfDay = new Date(day);
    endOfDay.setHours(23, 59, 59, 999);
    statusesByDay.set(
      key,
      scheduleStatusesForDay(recent, suggestion.entries, day, toleranceMinutes, Math.min(now.getTime(), endOfDay.getTime())),
    );
  });

  const estimates = activeDays.flatMap<MissingLogEstimate>((key) => {
    const dayEvents = eventsByDay.get(key) ?? [];
    const statuses = statusesByDay.get(key) ?? [];

    return statuses.flatMap<MissingLogEstimate>((status) => {
      if (status.status !== 'missed' || (status.entry.type === 'custom' && !status.entry.customLabel)) return [];
      if (events.some((event) => event.estimated && sameActivity(event, status.entry)
        && Math.abs(event.at - status.target) <= toleranceMinutes * 60_000)) return [];
      if (!dayEvents.some((event) => event.at > status.target)) return [];
      // An unmatched log of this type may be a shifted occurrence, not a gap.
      if (dayEvents.some((event) => sameActivity(event, status.entry)
        && !statuses.some((item) => item.event?.id === event.id))) return [];

      const comparison = activeDays
        .filter((otherKey) => otherKey !== key)
        .map((otherKey) => statusesByDay.get(otherKey)?.find((item) => item.entry.id === status.entry.id))
        .filter((item): item is ScheduleStatusItem => Boolean(item && (item.status === 'done' || item.status === 'missed')));
      const observed = comparison.filter((item) => item.status === 'done' && item.event);
      if (comparison.length < 3 || observed.length < 3 || observed.length / comparison.length < 0.75) return [];

      let endedAt: number | undefined;
      if (status.entry.type === 'nap') {
        const durations = observed.flatMap((item) => {
          const event = item.event;
          if (!event || typeof event.endedAt !== 'number') return [];
          const duration = event.endedAt - event.at;
          return duration >= 10 * 60_000 && duration <= 6 * 60 * 60_000 ? [duration] : [];
        });
        const duration = percentile(durations, 0.5);
        if (durations.length < 3 || duration === undefined) return [];
        const estimatedEnd = Math.round(status.target + duration);
        if (estimatedEnd > now.getTime()) return [];
        if (dayEvents.some((event) => event.at > status.target && event.at < estimatedEnd)) return [];
        if (!dayEvents.some((event) => event.at >= estimatedEnd)) return [];
        endedAt = estimatedEnd;
      }

      return [{
        id: `estimate-${key}-${status.entry.id}`,
        type: status.entry.type,
        ...(status.entry.customLabel ? { customLabel: status.entry.customLabel } : {}),
        at: status.target,
        ...(endedAt === undefined ? {} : { endedAt }),
        observedDays: observed.length,
        comparedDays: comparison.length,
      }];
    });
  });

  return {
    estimates: estimates.sort((left, right) => right.at - left.at),
    daysAnalyzed: activeDays.length,
    periodDays: suggestion.periodDays,
  };
}

function minutesIntoDay(value: number): number {
  const date = new Date(value);
  return date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60 + date.getMilliseconds() / 60_000;
}

export function timelineBucket(value: number): number {
  return Math.min(TIMELINE_BUCKETS - 1, Math.floor(minutesIntoDay(value) / TIMELINE_BUCKET_MINUTES));
}

export function timelineDurationRuns(marks: TimelineMark[]): TimelineDurationRun[] {
  const runs: TimelineDurationRun[] = [];
  for (const mark of [...marks].sort((a, b) => a.startBucket - b.startBucket)) {
    if (mark.endBucket === undefined) continue;
    const run = runs.find((item) => item.type === mark.type && item.endBucket >= mark.startBucket);
    if (run) run.endBucket = Math.max(run.endBucket, mark.endBucket);
    else runs.push({ type: mark.type, startBucket: mark.startBucket, endBucket: mark.endBucket });
  }
  return runs;
}

export function timelinePointClusters(marks: TimelineMark[]): TimelinePointCluster[] {
  const byBucket = new Map<number, TimelineMark[]>();
  marks.forEach((mark) => {
    if (mark.endBucket !== undefined) return;
    byBucket.set(mark.startBucket, [...(byBucket.get(mark.startBucket) ?? []), mark]);
  });

  return [...byBucket.entries()].map(([startBucket, points]) => {
    const durations = marks.filter((mark) => mark.endBucket !== undefined
      && mark.startBucket <= startBucket
      && mark.endBucket > startBucket);

    return {
      startBucket,
      ids: points.map((mark) => mark.id),
      types: durations.concat(points).map((mark) => mark.type),
      hasDuration: durations.length > 0,
    };
  });
}

export function timelineMarksForPointHit(marks: TimelineMark[], bucket: number, savedEstimateIds?: ReadonlySet<string>): TimelineMark[] {
  return marks.filter((mark) => (!mark.estimated || savedEstimateIds?.has(mark.id)) && (mark.endBucket === undefined
    ? mark.startBucket === bucket
    : mark.startBucket <= bucket && mark.endBucket > bucket));
}

export function buildTimelineDays(
  events: PuppyEvent[],
  days = 14,
  endDate = new Date(),
  now = endDate,
  estimates: MissingLogEstimate[] = [],
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

    const marks = [...events, ...estimates].flatMap<TimelineMark>((event) => {
      const inferred = 'observedDays' in event;
      const estimated = inferred || event.estimated;
      const label = eventLabel(inferred ? { ...event, source: 'app' } : event);
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
          label,
          startBucket,
          endBucket,
          ...(estimated ? { estimated: true } : {}),
        }];
      }

      if (dateKey(event.at) !== key) return [];
      return [{
        id: event.id,
        type: event.type,
        label,
        startBucket: timelineBucket(event.at),
        ...(estimated ? { estimated: true } : {}),
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

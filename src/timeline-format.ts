import type { AppLanguage } from './localization.ts';
import type { TimelineDay } from './analytics.ts';
import { dateKey, type ActivityKey, type PuppyEvent, type ScheduleEntry } from './domain.ts';

export type TimelineGap = { key: string; start: Date; end: Date; emptyDays: number };

export type ExpectedWindow = { id: string; type: 'meal' | 'poop'; start: number; end: number };

// Daily wall-clock minutes, split at midnight so the same bands repeat on every date.
export function timelineExpectedWindows(schedule: readonly ScheduleEntry[], selectedTypes: readonly ActivityKey[]): ExpectedWindow[] {
  return schedule.flatMap((entry): ExpectedWindow[] => {
    if ((entry.type !== 'meal' && entry.type !== 'poop') || !selectedTypes.includes(entry.type) || !entry.toleranceMinutes) return [];
    const window = { id: entry.id, type: entry.type };
    if (entry.toleranceMinutes >= 720) return [{ ...window, start: 0, end: 1440 }];
    const start = entry.minutes - entry.toleranceMinutes;
    const end = entry.minutes + entry.toleranceMinutes;
    if (start < 0) return [{ ...window, start: 0, end }, { ...window, start: start + 1440, end: 1440 }];
    if (end > 1440) return [{ ...window, start, end: 1440 }, { ...window, start: 0, end: end - 1440 }];
    return [{ ...window, start, end }];
  });
}

// Group only truly empty days, independent of filters. Keep today available as a time reference.
export function collapseEmptyTimelineDays(days: readonly TimelineDay[], todayKey: string): (TimelineDay | TimelineGap)[] {
  const rows: (TimelineDay | TimelineGap)[] = [];
  for (let index = 0; index < days.length;) {
    const day = days[index];
    if (day.key === todayKey || day.marks.length) {
      rows.push(day);
      index += 1;
      continue;
    }
    let end = index + 1;
    while (end < days.length && days[end].key !== todayKey && !days[end].marks.length) end += 1;
    rows.push(end - index === 1 ? day : {
      key: `gap-${day.key}`,
      start: day.date,
      end: days[end - 1].date,
      emptyDays: end - index,
    });
    index = end;
  }
  return rows;
}

export function timelineDayEvents(events: readonly PuppyEvent[], day: number, now: number): PuppyEvent[] {
  const start = new Date(day);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return events.filter((event) => event.at < end.getTime() && (
    event.at >= start.getTime()
    || (event.type === 'nap' && event.endedAt !== undefined && (event.endedAt ?? now) > start.getTime())
  )).sort((a, b) => a.at - b.at);
}

function createTimelineFormatters(language: AppLanguage) {
  return {
    hour: new Intl.DateTimeFormat(language, { hour: 'numeric' }),
    time: new Intl.DateTimeFormat(language, { hour: 'numeric', minute: '2-digit' }),
    fullDate: new Intl.DateTimeFormat(language, { weekday: 'long', month: 'long', day: 'numeric' }),
    weekday: new Intl.DateTimeFormat(language, { weekday: 'short' }),
    shortDate: new Intl.DateTimeFormat(language, { month: 'short', day: 'numeric' }),
    rangeDate: new Intl.DateTimeFormat(language, { month: 'short', day: 'numeric', year: 'numeric' }),
  };
}

// Include the date when a selection spans days, or a duration ends after midnight.
export function timelineDetailTime(at: number, language: AppLanguage, sharedDay?: number) {
  const { time, rangeDate } = timelineFormatters(language);
  return sharedDay !== undefined && dateKey(new Date(at)) === dateKey(new Date(sharedDay))
    ? time.format(at)
    : `${rangeDate.format(at)} · ${time.format(at)}`;
}

const formatters = new Map<AppLanguage, ReturnType<typeof createTimelineFormatters>>();

// Reuse across rows and tab mounts; the app supports three languages.
export function timelineFormatters(language: AppLanguage) {
  let cached = formatters.get(language);
  if (!cached) {
    cached = createTimelineFormatters(language);
    formatters.set(language, cached);
  }
  return cached;
}

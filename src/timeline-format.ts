import type { AppLanguage } from './localization.ts';
import { dateKey, type PuppyEvent } from './domain.ts';

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

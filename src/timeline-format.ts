import type { AppLanguage } from './localization.ts';
import { dateKey } from './domain.ts';

function createTimelineFormatters(language: AppLanguage) {
  return {
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

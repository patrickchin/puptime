import type { AppLanguage } from './localization.ts';

function createTimelineFormatters(language: AppLanguage) {
  return {
    time: new Intl.DateTimeFormat(language, { hour: 'numeric', minute: '2-digit' }),
    hour: new Intl.DateTimeFormat(language, { hour: 'numeric' }),
    fullDate: new Intl.DateTimeFormat(language, { weekday: 'long', month: 'long', day: 'numeric' }),
    weekday: new Intl.DateTimeFormat(language, { weekday: 'short' }),
    shortDate: new Intl.DateTimeFormat(language, { month: 'short', day: 'numeric' }),
    rangeDate: new Intl.DateTimeFormat(language, { month: 'short', day: 'numeric', year: 'numeric' }),
  };
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

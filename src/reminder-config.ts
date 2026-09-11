import { EVENT_META, formatMinutes, type ScheduleEntry } from './domain.ts';

export const REMINDER_IDENTIFIER_PREFIX = 'puptime-routine-';

export function reminderIdentifier(entry: ScheduleEntry): string {
  return `${REMINDER_IDENTIFIER_PREFIX}${entry.id}`;
}

export function reminderCopy(entry: ScheduleEntry): { title: string; body: string } {
  return {
    title: `${EVENT_META[entry.type].label} time`,
    body: `Planned for ${formatMinutes(entry.minutes)}. Tap to log it in Puptime.`,
  };
}

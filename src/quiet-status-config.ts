import { latestQuickEventTimes, type PuppyEvent, type ScheduleEntry } from './domain.ts';
import { localizedEventLabel, translate, type AppLanguage } from './localization.ts';
import { reminderTriggerMinutes, scheduleReminderLead, type NotificationPreferences } from './notification-config.ts';
import { pottyReminderCopy, pottyReminderPlans } from './reminder-config.ts';

export const QUIET_STATUS_IDENTIFIER = 'puptime-status';
export const QUIET_STATUS_KIND = 'quietStatus';
export const QUIET_STATUS_CHANNEL = 'puptime-status';

export type StatusReminder = { label: string; at: number };
export type QuietStatusSnapshot = {
  name: string;
  language: AppLanguage;
  times: Partial<Record<'pee' | 'poop' | 'meal', number>>;
  reminder?: StatusReminder;
};

export function quietStatusSnapshot(
  events: readonly PuppyEvent[], schedule: readonly ScheduleEntry[], preferences: NotificationPreferences,
  timed: readonly StatusReminder[], name: string, language: AppLanguage, now = Date.now(),
): QuietStatusSnapshot {
  const past = events.filter(event => event.at <= now);
  const latest = latestQuickEventTimes(past);
  const reminders = [...timed, ...pottyReminderPlans(past, preferences, now).map(plan => ({
    label: pottyReminderCopy(plan.kind, plan.delayMinutes, language).title, at: plan.at,
  }))];
  for (const entry of schedule) {
    if (!entry.reminder) continue;
    const minutes = reminderTriggerMinutes(entry.minutes, scheduleReminderLead(entry.type, preferences));
    const at = new Date(now);
    at.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
    if (at.getTime() <= now) at.setDate(at.getDate() + 1);
    reminders.push({ label: entry.customLabel ?? localizedEventLabel(language, entry.type), at: at.getTime() });
  }
  return {
    name, language,
    times: { pee: latest.pee, poop: latest.poop, meal: latest.meal },
    reminder: reminders.filter(item => item.at > now).sort((a, b) => a.at - b.at)[0],
  };
}

export function quietStatusCopy(snapshot: QuietStatusSnapshot): { title: string; body: string } {
  const { language, times, reminder } = snapshot;
  const formatter = new Intl.DateTimeFormat(language, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const lines = (['pee', 'poop', 'meal'] as const).flatMap(type => times[type] === undefined ? [] : [
    `${localizedEventLabel(language, type)} · ${formatter.format(times[type])}`,
  ]);
  if (!lines.length) lines.push(translate(language, 'notifications.statusEmpty'));
  if (reminder) lines.push(translate(language, 'notifications.statusReminder', {
    activity: reminder.label, time: formatter.format(reminder.at),
  }));
  return { title: translate(language, 'notifications.statusTitle', { name: snapshot.name }), body: lines.join('\n') };
}

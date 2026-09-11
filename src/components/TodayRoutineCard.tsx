import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { scheduleStatusesForDay } from '../analytics';
import { EVENT_META, formatMinutes, type PuppyEvent, type ScheduleEntry } from '../domain';
import { spacing, type Theme } from '../theme';

function untilLabel(target: number, now: number): string {
  const minutes = Math.max(0, Math.ceil((target - now) / 60_000));
  if (minutes < 1) return 'now';
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `in ${hours}h ${remainder}m` : `in ${hours}h`;
}

export function TodayRoutineCard({
  events,
  schedule,
  now,
  onOpenSchedule,
  theme,
}: {
  events: PuppyEvent[];
  schedule: ScheduleEntry[];
  now: number;
  onOpenSchedule: () => void;
  theme: Theme;
}) {
  const statuses = scheduleStatusesForDay(events, schedule, new Date(now), 30, now);
  const completed = statuses.filter((item) => item.status === 'done').length;
  const missed = statuses.filter((item) => item.status === 'missed').length;
  const next = statuses.find((item) => item.status === 'due')
    ?? statuses.find((item) => item.status === 'upcoming');
  const progress: `${number}%` = statuses.length
    ? `${Math.round((completed / statuses.length) * 100)}%`
    : '0%';
  const nextMeta = next ? EVENT_META[next.entry.type] : null;

  const title = schedule.length === 0
    ? 'Build a daily rhythm'
    : next
      ? `${nextMeta?.label}${next.status === 'due' ? ' is due' : ` at ${formatMinutes(next.entry.minutes)}`}`
      : missed
        ? `${missed} routine ${missed === 1 ? 'window needs' : 'windows need'} attention`
        : 'Today’s routine is complete';
  const detail = schedule.length === 0
    ? 'Add the times you want to repeat each day.'
    : next
      ? `${next.status === 'due' ? `Planned for ${formatMinutes(next.entry.minutes)}` : untilLabel(next.target, now)} · ${completed} of ${schedule.length} done`
      : `${completed} of ${schedule.length} planned activities logged`;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${detail}`}
      accessibilityHint="Opens the daily schedule"
      onPress={onOpenSchedule}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: pressed ? theme.primarySoft : theme.surfaceRaised,
          borderColor: pressed ? theme.primary : theme.border,
        },
      ]}
    >
      <View style={styles.headingRow}>
        <Text style={[styles.eyebrow, { color: theme.primary }]}>TODAY’S RHYTHM</Text>
        {schedule.length ? (
          <Text style={[styles.progressLabel, { color: theme.textMuted }]}>{completed}/{schedule.length}</Text>
        ) : null}
      </View>

      <View style={styles.bodyRow}>
        <View
          style={[
            styles.icon,
            { backgroundColor: nextMeta?.softColor ?? theme.primarySoft },
          ]}
        >
          <MaterialCommunityIcons
            name={(nextMeta?.icon ?? 'calendar-clock-outline') as keyof typeof MaterialCommunityIcons.glyphMap}
            color={nextMeta?.color ?? theme.primary}
            size={23}
          />
        </View>
        <View style={styles.copy}>
          <Text numberOfLines={2} style={[styles.title, { color: theme.text }]}>{title}</Text>
          <Text numberOfLines={2} style={[styles.detail, { color: theme.textMuted }]}>{detail}</Text>
        </View>
        <MaterialCommunityIcons name="chevron-right" color={theme.textMuted} size={23} />
      </View>

      {schedule.length ? (
        <View style={[styles.track, { backgroundColor: theme.primarySoft }]}>
          <View style={[styles.fill, { backgroundColor: theme.primary, width: progress }]} />
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    minHeight: 126,
    borderWidth: 1,
    borderRadius: 22,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  headingRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  eyebrow: { flex: 1, fontSize: 11, lineHeight: 15, fontWeight: '800', letterSpacing: 1.2 },
  progressLabel: { fontSize: 12, lineHeight: 16, fontWeight: '700', fontVariant: ['tabular-nums'] },
  bodyRow: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  icon: { width: 44, height: 44, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1, minWidth: 0 },
  title: { fontSize: 16, lineHeight: 21, fontWeight: '700' },
  detail: { fontSize: 12, lineHeight: 17, marginTop: 2 },
  track: { height: 7, borderRadius: 4, overflow: 'hidden', marginTop: 13 },
  fill: { height: 7, borderRadius: 4 },
});

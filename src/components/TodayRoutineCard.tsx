import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { scheduleStatusesForDay } from '../analytics';
import { EVENT_META, formatMinutes, type PuppyEvent, type ScheduleEntry } from '../domain';
import { useLocalization } from '../localization-context';
import { eventIcon, spacing, supportingIcon, surfaceTreatment, type Theme } from '../theme';

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
  const { eventLabel, t } = useLocalization();
  const statuses = scheduleStatusesForDay(events, schedule, new Date(now), 30, now);
  const completed = statuses.filter((item) => item.status === 'done').length;
  const missed = statuses.filter((item) => item.status === 'missed').length;
  const next = statuses.find((item) => item.status === 'due')
    ?? statuses.find((item) => item.status === 'upcoming');
  const progress: `${number}%` = statuses.length
    ? `${Math.round((completed / statuses.length) * 100)}%`
    : '0%';
  const nextMeta = next ? EVENT_META[next.entry.type] : null;
  const nextLabel = next ? next.entry.customLabel ?? eventLabel(next.entry.type) : '';
  const until = next ? (() => {
    const minutes = Math.max(0, Math.ceil((next.target - now) / 60_000));
    if (minutes < 1) return t('routine.now');
    if (minutes < 60) return t('routine.inMinutes', { count: minutes });
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    return remainder
      ? t('routine.inHoursMinutes', { hours, minutes: remainder })
      : t('routine.inHours', { count: hours });
  })() : '';

  const title = schedule.length === 0
    ? t('routine.build')
    : next
      ? next.status === 'due'
        ? t('routine.due', { activity: nextLabel })
        : t('routine.at', { activity: nextLabel, time: formatMinutes(next.entry.minutes) })
      : missed
        ? t(missed === 1 ? 'routine.missedOne' : 'routine.missedMany', { count: missed })
        : t('routine.complete');
  const detail = schedule.length === 0
    ? t('routine.buildDetail')
    : next
      ? `${next.status === 'due'
        ? t('routine.plannedFor', { time: formatMinutes(next.entry.minutes) })
        : until} · ${t('routine.progress', { completed, total: schedule.length })}`
      : t('routine.logged', { completed, total: schedule.length });

  return (
    <Pressable
      testID="routine.card"
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${detail}`}
      accessibilityHint={t('routine.openHint')}
      onPress={onOpenSchedule}
      style={({ pressed }) => [
        styles.card,
        surfaceTreatment(theme),
        {
          backgroundColor: pressed ? theme.primarySoft : theme.surfaceRaised,
          borderColor: pressed ? theme.primary : theme.border,
          padding: theme.presentation.cardPadding,
        },
      ]}
    >
      <View style={styles.bodyRow}>
        <View
          style={[
            styles.icon,
            {
              backgroundColor: nextMeta?.softColor ?? theme.primarySoft,
              borderRadius: theme.presentation.iconRadius,
            },
          ]}
        >
          <MaterialCommunityIcons
            name={(next ? eventIcon(theme, next.entry.type) : supportingIcon(theme, 'routine')) as keyof typeof MaterialCommunityIcons.glyphMap}
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
        <View
          style={[
            styles.track,
            { backgroundColor: theme.primarySoft, borderRadius: theme.presentation.controlRadius },
          ]}
        >
          <View
            style={[
              styles.fill,
              { backgroundColor: theme.primary, borderRadius: theme.presentation.controlRadius, width: progress },
            ]}
          />
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    minHeight: 126,
    marginTop: spacing.md,
  },
  bodyRow: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  icon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1, minWidth: 0 },
  title: { fontSize: 16, lineHeight: 21, fontWeight: '700' },
  detail: { fontSize: 12, lineHeight: 17, marginTop: 2 },
  track: { height: 7, overflow: 'hidden', marginTop: 13 },
  fill: { height: 7 },
});

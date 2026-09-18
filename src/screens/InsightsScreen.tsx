import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  activityFrequencyStats,
  buildTimelineDays,
  TIMELINE_BUCKET_MINUTES,
  TIMELINE_BUCKETS,
  type ActivityFrequencyStat,
  type TimelineDay,
  type TimelineMark,
} from '../analytics';
import { dateKey, EVENT_META, eventTypes, formatDuration, type EventType, type PuppyEvent } from '../domain';
import { shareEventsCsv } from '../share-export';
import { spacing, type Theme } from '../theme';

type ActivityFilter = EventType | 'all';

const activityFilters: ActivityFilter[] = ['all', ...eventTypes];
const shortDay = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
const shortDate = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const fullDate = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
const bucketTime = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

function formatBucket(bucket: number): string {
  return bucketTime.format(new Date(2000, 0, 1, 0, bucket * TIMELINE_BUCKET_MINUTES));
}

function describeMark(mark: TimelineMark): string {
  return mark.endBucket === undefined
    ? `${mark.label} in the ${formatBucket(mark.startBucket)} to ${formatBucket(mark.startBucket + 1)} window`
    : `${mark.label} from about ${formatBucket(mark.startBucket)} to ${formatBucket(mark.endBucket)}`;
}

function filterName(filter: ActivityFilter): string {
  return filter === 'all' ? 'activity' : EVENT_META[filter].label.toLowerCase();
}

function eventColor(type: EventType, theme: Theme): string {
  return theme.isDark ? EVENT_META[type].darkColor : EVENT_META[type].color;
}

function durationFromMinutes(minutes?: number): string {
  return minutes === undefined ? '—' : formatDuration(minutes * 60_000);
}

function FrequencyRow({ stat, theme }: { stat: ActivityFrequencyStat; theme: Theme }) {
  const meta = EVENT_META[stat.type];
  const color = eventColor(stat.type, theme);
  const dailyValue = stat.total ? `${stat.averagePerRecordedDay.toFixed(1)}/day` : '—';
  const dailyDetail = stat.total
    ? stat.minimumPerRecordedDay === stat.maximumPerRecordedDay
      ? `${stat.minimumPerRecordedDay} on each recorded day`
      : `${stat.minimumPerRecordedDay}–${stat.maximumPerRecordedDay} per recorded day`
    : `No ${meta.label.toLowerCase()} logs yet`;
  const intervalValue = durationFromMinutes(stat.medianIntervalMinutes);
  const intervalDetail = stat.medianIntervalMinutes === undefined
    ? 'Need another log'
    : stat.intervalSamples >= 4
      ? `Middle half: ${durationFromMinutes(stat.lowerIntervalMinutes)}–${durationFromMinutes(stat.upperIntervalMinutes)}`
      : `${stat.intervalSamples} ${stat.intervalSamples === 1 ? 'gap' : 'gaps'} observed`;

  return (
    <View
      accessible
      accessibilityLabel={`${meta.label}. ${dailyValue}, ${dailyDetail}. Typical gap ${intervalValue}. ${intervalDetail}.`}
      style={[styles.frequencyRow, { borderColor: theme.border }]}
    >
      <View style={styles.activityHeading}>
        <View style={[styles.activityIcon, { backgroundColor: theme.isDark ? meta.darkSoftColor : meta.softColor }]}>
          <MaterialCommunityIcons
            accessibilityElementsHidden
            importantForAccessibility="no"
            name={meta.icon as keyof typeof MaterialCommunityIcons.glyphMap}
            size={20}
            color={color}
          />
        </View>
        <Text style={[styles.activityName, { color: theme.text }]}>{meta.label}</Text>
        <Text style={[styles.logCount, { color: theme.textMuted }]}>{stat.total} logs</Text>
      </View>
      <View style={styles.metrics}>
        <View style={styles.metric}>
          <Text style={[styles.metricValue, { color: theme.text }]}>{dailyValue}</Text>
          <Text style={[styles.metricLabel, { color: theme.textMuted }]}>AVERAGE FREQUENCY</Text>
          <Text style={[styles.metricDetail, { color: theme.textMuted }]}>{dailyDetail}</Text>
        </View>
        <View style={[styles.metricDivider, { backgroundColor: theme.border }]} />
        <View style={styles.metric}>
          <Text style={[styles.metricValue, { color: theme.text }]}>{intervalValue}</Text>
          <Text style={[styles.metricLabel, { color: theme.textMuted }]}>TYPICAL GAP</Text>
          <Text style={[styles.metricDetail, { color: theme.textMuted }]}>{intervalDetail}</Text>
        </View>
      </View>
    </View>
  );
}

function TimelineRow({
  day,
  filter,
  isToday,
  theme,
}: {
  day: TimelineDay;
  filter: ActivityFilter;
  isToday: boolean;
  theme: Theme;
}) {
  const marks = filter === 'all' ? day.marks : day.marks.filter((mark) => mark.type === filter);
  const description = marks.length
    ? marks.map(describeMark).join('. ')
    : `No ${filterName(filter)} logged`;

  return (
    <View
      accessible
      accessibilityLabel={`${fullDate.format(day.date)}. ${description}.`}
      style={styles.timelineRow}
    >
      <View style={styles.dateLabel}>
        <Text maxFontSizeMultiplier={1.5} style={[styles.weekday, { color: isToday ? theme.primary : theme.text }]}>
          {isToday ? 'TODAY' : shortDay.format(day.date).toUpperCase()}
        </Text>
        <Text maxFontSizeMultiplier={1.5} style={[styles.calendarDate, { color: theme.textMuted }]}>
          {shortDate.format(day.date)}
        </Text>
      </View>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[
          styles.timelineTrack,
          {
            backgroundColor: isToday ? theme.primarySoft : theme.surface,
            borderColor: isToday ? theme.primary : theme.border,
          },
        ]}
      >
        {[0.25, 0.5, 0.75].map((position) => (
          <View
            key={position}
            style={[styles.gridLine, { backgroundColor: theme.border, left: `${position * 100}%` }]}
          />
        ))}
        {marks.map((mark) => {
          const color = eventColor(mark.type, theme);
          if (mark.endBucket !== undefined) {
            return (
              <View
                key={mark.id}
                style={[
                  styles.durationMark,
                  {
                    backgroundColor: color,
                    left: `${(mark.startBucket / TIMELINE_BUCKETS) * 100}%`,
                    width: `${((mark.endBucket - mark.startBucket) / TIMELINE_BUCKETS) * 100}%`,
                  },
                ]}
              />
            );
          }
          return (
            <View
              key={mark.id}
              style={[
                styles.pointMark,
                {
                  backgroundColor: color,
                  left: `${((mark.startBucket + 0.5) / TIMELINE_BUCKETS) * 100}%`,
                },
              ]}
            />
          );
        })}
      </View>
    </View>
  );
}

export function InsightsScreen({
  events,
  theme,
}: {
  events: PuppyEvent[];
  theme: Theme;
}) {
  const [filter, setFilter] = useState<ActivityFilter>('all');
  const [exporting, setExporting] = useState(false);
  const now = new Date();
  const days = buildTimelineDays(events, 14, now);
  const frequency = activityFrequencyStats(events, ['pee', 'poop'], 14, now);
  const todayKey = dateKey(now);
  const visibleEventCount = days.reduce(
    (sum, day) => sum + day.marks.filter((mark) => filter === 'all' || mark.type === filter).length,
    0,
  );
  const exportDisabled = exporting || events.length === 0;

  async function exportActivity() {
    if (exportDisabled) return;
    setExporting(true);
    try {
      await shareEventsCsv(events);
    } catch {
      Alert.alert('Couldn’t export activity', 'Please try again. Your Puptime data is unchanged.');
    } finally {
      setExporting(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={[styles.eyebrow, { color: theme.primary }]}>DAILY RHYTHM · 15 MINUTE WINDOWS</Text>
      <Text style={[styles.title, { color: theme.text }]}>When things happen</Text>
      <Text style={[styles.subtitle, { color: theme.textMuted }]}>
        Compare timing across days—not totals or targets.
      </Text>

      <View style={[styles.frequencyCard, { backgroundColor: theme.surfaceRaised, borderColor: theme.border }]}>
        <View style={styles.frequencyHeading}>
          <View style={[styles.smallIcon, { backgroundColor: theme.primarySoft }]}>
            <MaterialCommunityIcons
              accessibilityElementsHidden
              importantForAccessibility="no"
              name="timer-sand"
              size={21}
              color={theme.primary}
            />
          </View>
          <View style={styles.panelHeadingCopy}>
            <Text style={[styles.panelTitle, { color: theme.text }]}>Frequency from your logs</Text>
            <Text style={[styles.panelCaption, { color: theme.textMuted }]}>
              Last {frequency.periodDays} days · {frequency.recordedDays} {frequency.recordedDays === 1 ? 'day' : 'days'} with activity · observations, not goals
            </Text>
          </View>
        </View>
        <Text style={[styles.frequencyNote, { color: theme.textMuted, backgroundColor: theme.surface }]}>
          Daily averages include zeroes on days where you logged something else. Completely blank days are excluded because they may be unlogged.
        </Text>
        <View>
          {frequency.stats.map((stat) => <FrequencyRow key={stat.type} stat={stat} theme={theme} />)}
        </View>
      </View>

      <View style={styles.filters} accessibilityRole="radiogroup">
        {activityFilters.map((type) => {
          const selected = type === filter;
          const meta = type === 'all'
            ? { label: 'All', icon: 'layers-outline' }
            : EVENT_META[type];
          const color = type === 'all' ? theme.primary : eventColor(type, theme);
          const softColor = type === 'all'
            ? theme.primarySoft
            : theme.isDark ? EVENT_META[type].darkSoftColor : EVENT_META[type].softColor;
          return (
            <Pressable
              key={type}
              accessibilityRole="radio"
              accessibilityLabel={`Show ${meta.label} timing`}
              accessibilityState={{ selected }}
              onPress={() => setFilter(type)}
              style={({ pressed }) => [
                styles.filterChip,
                {
                  backgroundColor: selected ? softColor : theme.surfaceRaised,
                  borderColor: selected ? color : theme.border,
                  opacity: pressed ? 0.72 : 1,
                },
              ]}
            >
              <MaterialCommunityIcons
                accessibilityElementsHidden
                importantForAccessibility="no"
                name={meta.icon as keyof typeof MaterialCommunityIcons.glyphMap}
                size={18}
                color={color}
              />
              <Text style={[styles.filterLabel, { color: selected ? color : theme.textMuted }]}>
                {meta.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={[styles.panel, { backgroundColor: theme.surfaceRaised, borderColor: theme.border }]}>
        <View style={styles.panelHeading}>
          <View style={[styles.smallIcon, { backgroundColor: theme.primarySoft }]}>
            <MaterialCommunityIcons
              accessibilityElementsHidden
              importantForAccessibility="no"
              name="chart-timeline-variant"
              size={21}
              color={theme.primary}
            />
          </View>
          <View style={styles.panelHeadingCopy}>
            <Text style={[styles.panelTitle, { color: theme.text }]}>
              {filter === 'all' ? 'All activity' : `${EVENT_META[filter].label} timing`}
            </Text>
            <Text style={[styles.panelCaption, { color: theme.textMuted }]}>
              14 calendar days · oldest at top · today at bottom
            </Text>
          </View>
        </View>

        <View style={styles.axisRow} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <View style={styles.axisSpacer} />
          <View style={styles.axisTrack}>
            <Text maxFontSizeMultiplier={1.5} style={[styles.axisLabel, styles.axisStart, { color: theme.textMuted }]}>12a</Text>
            <Text maxFontSizeMultiplier={1.5} style={[styles.axisLabel, styles.axisQuarter, { color: theme.textMuted }]}>6a</Text>
            <Text maxFontSizeMultiplier={1.5} style={[styles.axisLabel, styles.axisHalf, { color: theme.textMuted }]}>12p</Text>
            <Text maxFontSizeMultiplier={1.5} style={[styles.axisLabel, styles.axisThreeQuarter, { color: theme.textMuted }]}>6p</Text>
            <Text maxFontSizeMultiplier={1.5} style={[styles.axisLabel, styles.axisEnd, { color: theme.textMuted }]}>12a</Text>
          </View>
        </View>

        <View style={styles.timeline}>
          {days.map((day) => (
            <TimelineRow
              key={day.key}
              day={day}
              filter={filter}
              isToday={day.key === todayKey}
              theme={theme}
            />
          ))}
        </View>

        {visibleEventCount === 0 ? (
          <View style={[styles.emptyNote, { backgroundColor: theme.surface }]}>
            <MaterialCommunityIcons
              accessibilityElementsHidden
              importantForAccessibility="no"
              name="clock-outline"
              size={19}
              color={theme.textMuted}
            />
            <Text style={[styles.emptyText, { color: theme.textMuted }]}>
              No {filterName(filter)} logged in these 14 days yet.
            </Text>
          </View>
        ) : null}
      </View>

      <View style={[styles.exportCard, { backgroundColor: theme.surfaceRaised, borderColor: theme.border }]}>
        <View style={styles.exportHeading}>
          <View style={[styles.smallIcon, { backgroundColor: theme.primarySoft }]}>
            <MaterialCommunityIcons
              accessibilityElementsHidden
              importantForAccessibility="no"
              name="file-delimited-outline"
              size={20}
              color={theme.primary}
            />
          </View>
          <View style={styles.exportCopy}>
            <Text style={[styles.panelTitle, { color: theme.text }]}>Your data</Text>
            <Text style={[styles.panelCaption, { color: theme.textMuted }]}>
              Share every log as a spreadsheet-ready CSV. Nothing leaves this device until you choose where to send it.
            </Text>
          </View>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={events.length ? 'Export all activity as CSV' : 'No activity to export'}
          accessibilityHint={events.length ? 'Opens the system share sheet' : undefined}
          accessibilityState={{ busy: exporting, disabled: exportDisabled }}
          disabled={exportDisabled}
          onPress={exportActivity}
          style={({ pressed }) => [
            styles.exportButton,
            { backgroundColor: theme.primary, opacity: exportDisabled ? 0.45 : pressed ? 0.82 : 1 },
          ]}
        >
          {exporting ? (
            <ActivityIndicator color={theme.onPrimary} size="small" />
          ) : (
            <MaterialCommunityIcons
              accessibilityElementsHidden
              importantForAccessibility="no"
              name="share-variant-outline"
              size={20}
              color={theme.onPrimary}
            />
          )}
          <Text style={[styles.exportButtonText, { color: theme.onPrimary }]}>
            {exporting ? 'Preparing export…' : events.length ? 'Export activity CSV' : 'No activity to export'}
          </Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
    padding: spacing.md,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  eyebrow: { fontSize: 11, fontWeight: '800', letterSpacing: 1.5, marginTop: 4 },
  title: { fontSize: 30, lineHeight: 36, fontWeight: '800', letterSpacing: -0.6, marginTop: -8 },
  subtitle: { fontSize: 15, lineHeight: 22, marginTop: -10 },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  filterChip: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 15,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  filterLabel: { fontSize: 13, lineHeight: 18, fontWeight: '700' },
  frequencyCard: { borderWidth: 1, borderRadius: 22, padding: 12 },
  frequencyHeading: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 4 },
  frequencyNote: { fontSize: 11, lineHeight: 16, borderRadius: 12, paddingHorizontal: 11, paddingVertical: 9, marginTop: 10 },
  frequencyRow: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 4, paddingTop: 13, paddingBottom: 11, marginTop: 12 },
  activityHeading: { flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 11 },
  activityIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  activityName: { flex: 1, fontSize: 16, lineHeight: 21, fontWeight: '800' },
  logCount: { fontSize: 12, lineHeight: 17, fontWeight: '600' },
  metrics: { flexDirection: 'row', alignItems: 'stretch' },
  metric: { flex: 1, minWidth: 0, paddingHorizontal: 6 },
  metricDivider: { width: StyleSheet.hairlineWidth, marginHorizontal: 6 },
  metricValue: { fontSize: 21, lineHeight: 27, fontWeight: '800', fontVariant: ['tabular-nums'] },
  metricLabel: { fontSize: 9, lineHeight: 13, fontWeight: '800', letterSpacing: 0.8, marginTop: 2 },
  metricDetail: { fontSize: 11, lineHeight: 16, marginTop: 4 },
  panel: { borderWidth: 1, borderRadius: 22, padding: 12 },
  panelHeading: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 4, marginBottom: spacing.sm },
  panelHeadingCopy: { flex: 1, minWidth: 0 },
  smallIcon: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  panelTitle: { fontSize: 18, lineHeight: 23, fontWeight: '700' },
  panelCaption: { fontSize: 12, lineHeight: 17, marginTop: 1 },
  axisRow: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: 5 },
  axisSpacer: { width: 58 },
  axisTrack: { flex: 1, height: 16, position: 'relative' },
  axisLabel: { position: 'absolute', width: 34, fontSize: 10, lineHeight: 14, fontWeight: '600', fontVariant: ['tabular-nums'] },
  axisStart: { left: 0, textAlign: 'left' },
  axisQuarter: { left: '25%', marginLeft: -17, textAlign: 'center' },
  axisHalf: { left: '50%', marginLeft: -17, textAlign: 'center' },
  axisThreeQuarter: { left: '75%', marginLeft: -17, textAlign: 'center' },
  axisEnd: { right: 0, textAlign: 'right' },
  timeline: { gap: 5 },
  timelineRow: { minHeight: 38, flexDirection: 'row', alignItems: 'center' },
  dateLabel: { width: 58, paddingRight: 7 },
  weekday: { fontSize: 10, lineHeight: 13, fontWeight: '800', letterSpacing: 0.35 },
  calendarDate: { fontSize: 10, lineHeight: 13, fontWeight: '600', marginTop: 1 },
  timelineTrack: {
    flex: 1,
    height: 32,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    position: 'relative',
    overflow: 'hidden',
  },
  gridLine: { position: 'absolute', top: 0, bottom: 0, width: StyleSheet.hairlineWidth },
  pointMark: {
    position: 'absolute',
    top: 6,
    width: 5,
    height: 20,
    marginLeft: -2.5,
    borderRadius: 3,
  },
  durationMark: {
    position: 'absolute',
    top: 11,
    minWidth: 3,
    height: 10,
    borderRadius: 5,
  },
  emptyNote: {
    minHeight: 44,
    marginTop: spacing.sm,
    borderRadius: 14,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  emptyText: { flex: 1, fontSize: 12, lineHeight: 17 },
  exportCard: { borderWidth: 1, borderRadius: 22, padding: spacing.md, gap: spacing.md },
  exportHeading: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  exportCopy: { flex: 1, minWidth: 0 },
  exportButton: {
    minHeight: 52,
    borderRadius: 16,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  exportButtonText: { fontSize: 15, lineHeight: 20, fontWeight: '700', textAlign: 'center' },
});

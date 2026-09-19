import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import {
  activityFrequencyStats,
  buildTimelineDays,
  estimateMissingLogs,
  monthlyActivityStats,
  TIMELINE_BUCKET_MINUTES,
  TIMELINE_BUCKETS,
  type ActivityFrequencyStat,
  type MissingLogEstimate,
  type MonthlyActivityStat,
  type TimelineDay,
  type TimelineMark,
} from '../analytics';
import { dateKey, EVENT_META, eventTypes, formatDuration, formatTime, type EventType, type PuppyEvent } from '../domain';
import { shareEventsCsv } from '../share-export';
import { spacing, type Theme } from '../theme';

const TIMELINE_DAYS = 10;
const MISSING_LOG_DAYS = 14;
const activityFilters = ['all', ...eventTypes] as const;
const horizontalZoomLevels = [1, 1.5, 2] as const;
const verticalZoomLevels = [38, 52, 68] as const;
const verticalZoomLabels = ['75%', '100%', '130%'] as const;
const shortDay = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
const shortDate = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const fullDate = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
const rangeDate = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const longMonth = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });
const estimateDate = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const bucketTime = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const MONTH_PREVIEW_COUNT = 6;

function formatBucket(bucket: number): string {
  return bucketTime.format(new Date(2000, 0, 1, 0, bucket * TIMELINE_BUCKET_MINUTES));
}

function describeMark(mark: TimelineMark): string {
  return mark.endBucket === undefined
    ? `${mark.label} in the ${formatBucket(mark.startBucket)} to ${formatBucket(mark.startBucket + 1)} window`
    : `${mark.label} from about ${formatBucket(mark.startBucket)} to ${formatBucket(mark.endBucket)}`;
}

function filterName(types: readonly EventType[]): string {
  if (types.length === eventTypes.length) return 'activity';
  if (types.length === 1) return EVENT_META[types[0]].label.toLowerCase();
  return 'selected activity';
}

function selectionTitle(types: readonly EventType[]): string {
  if (types.length === 0) return 'No activities selected';
  if (types.length === eventTypes.length) return 'All activity';
  if (types.length <= 2) return `${types.map((type) => EVENT_META[type].label).join(' + ')} timing`;
  return `${types.length} activities`;
}

function calendarDayDistance(older: Date, newer: Date): number {
  const utc = (date: Date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.max(0, Math.round((utc(newer) - utc(older)) / 86_400_000));
}

function formatHour(hour: number): string {
  if (hour === 0 || hour === 24) return '12a';
  if (hour < 12) return `${hour}a`;
  if (hour === 12) return '12p';
  return `${hour - 12}p`;
}

function formatDateRange(start: Date, end: Date): string {
  return start.getFullYear() === end.getFullYear()
    ? `${shortDate.format(start)} – ${rangeDate.format(end)}`
    : `${rangeDate.format(start)} – ${rangeDate.format(end)}`;
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

function TimelineDateLabel({
  day,
  selectedTypes,
  isToday,
  rowHeight,
  theme,
}: {
  day: TimelineDay;
  selectedTypes: readonly EventType[];
  isToday: boolean;
  rowHeight: number;
  theme: Theme;
}) {
  const marks = day.marks.filter((mark) => selectedTypes.includes(mark.type));
  const description = marks.length
    ? marks.map(describeMark).join('. ')
    : selectedTypes.length
      ? `No ${filterName(selectedTypes)} logged`
      : 'No activity selected';

  return (
    <View
      accessible
      accessibilityLabel={`${fullDate.format(day.date)}. ${description}.`}
      style={[styles.dateCell, { height: rowHeight }]}
    >
      <Text maxFontSizeMultiplier={1.5} style={[styles.weekday, { color: isToday ? theme.primary : theme.text }]}>
        {isToday ? 'TODAY' : shortDay.format(day.date).toUpperCase()}
      </Text>
      <Text maxFontSizeMultiplier={1.5} style={[styles.calendarDate, { color: theme.textMuted }]}>
        {shortDate.format(day.date)}
      </Text>
    </View>
  );
}

function TimelineTrack({
  day,
  selectedTypes,
  isToday,
  rowHeight,
  gridHours,
  theme,
}: {
  day: TimelineDay;
  selectedTypes: readonly EventType[];
  isToday: boolean;
  rowHeight: number;
  gridHours: readonly number[];
  theme: Theme;
}) {
  const marks = day.marks.filter((mark) => selectedTypes.includes(mark.type));
  const trackHeight = rowHeight - 6;
  const laneCount = Math.max(1, selectedTypes.length);
  const laneHeight = trackHeight / laneCount;

  return (
    <View style={[styles.trackRow, { height: rowHeight }]}>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[
          styles.timelineTrack,
          {
            height: trackHeight,
            backgroundColor: isToday ? theme.primarySoft : theme.surface,
            borderColor: isToday ? theme.primary : theme.border,
          },
        ]}
      >
        {gridHours.map((hour) => (
          <View
            key={hour}
            style={[styles.gridLine, { backgroundColor: theme.border, left: `${(hour / 24) * 100}%` }]}
          />
        ))}
        {marks.map((mark) => {
          const color = eventColor(mark.type, theme);
          const laneIndex = Math.max(0, selectedTypes.indexOf(mark.type));
          const markHeight = selectedTypes.length === 1
            ? Math.min(22, trackHeight - 8)
            : Math.max(4, Math.min(9, laneHeight - 1.5));
          const top = laneIndex * laneHeight + (laneHeight - markHeight) / 2;
          if (mark.endBucket !== undefined) {
            return (
              <View
                key={mark.id}
                style={[
                  styles.durationMark,
                  {
                    backgroundColor: color,
                    height: markHeight,
                    left: `${(mark.startBucket / TIMELINE_BUCKETS) * 100}%`,
                    top,
                    width: `${((mark.endBucket - mark.startBucket) / TIMELINE_BUCKETS) * 100}%`,
                  },
                ]}
              />
            );
          }
          const pointWidth = selectedTypes.length === 1 ? 6 : markHeight;
          return (
            <View
              key={mark.id}
              style={[
                styles.pointMark,
                {
                  backgroundColor: color,
                  borderRadius: pointWidth / 2,
                  height: markHeight,
                  left: `${((mark.startBucket + 0.5) / TIMELINE_BUCKETS) * 100}%`,
                  marginLeft: -pointWidth / 2,
                  top,
                  width: pointWidth,
                },
              ]}
            />
          );
        })}
      </View>
    </View>
  );
}

function TimelineAxis({ hours, theme }: { hours: readonly number[]; theme: Theme }) {
  return (
    <View style={styles.axisTrack} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {hours.map((hour) => (
        <Text
          key={hour}
          maxFontSizeMultiplier={1.5}
          style={[
            styles.axisLabel,
            hour === 0
              ? styles.axisStart
              : hour === 24
                ? styles.axisEnd
                : { left: `${(hour / 24) * 100}%`, marginLeft: -17, textAlign: 'center' },
            { color: theme.textMuted },
          ]}
        >
          {formatHour(hour)}
        </Text>
      ))}
    </View>
  );
}

function ZoomControl({
  label,
  value,
  canDecrease,
  canIncrease,
  onDecrease,
  onIncrease,
  theme,
}: {
  label: string;
  value: string;
  canDecrease: boolean;
  canIncrease: boolean;
  onDecrease: () => void;
  onIncrease: () => void;
  theme: Theme;
}) {
  const buttonStyle = (pressed: boolean, enabled: boolean) => [
    styles.zoomButton,
    {
      backgroundColor: theme.surfaceRaised,
      borderColor: theme.border,
      opacity: enabled ? (pressed ? 0.7 : 1) : 0.35,
    },
  ];

  return (
    <View style={[styles.zoomControl, { borderColor: theme.border }]}>
      <Text style={[styles.controlLabel, { color: theme.textMuted }]}>{label.toUpperCase()}</Text>
      <View style={styles.stepper}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Decrease ${label.toLowerCase()}`}
          accessibilityState={{ disabled: !canDecrease }}
          disabled={!canDecrease}
          onPress={onDecrease}
          style={({ pressed }) => buttonStyle(pressed, canDecrease)}
        >
          <MaterialCommunityIcons
            accessibilityElementsHidden
            importantForAccessibility="no"
            name="minus"
            size={19}
            color={theme.text}
          />
        </Pressable>
        <Text
          adjustsFontSizeToFit
          minimumFontScale={0.8}
          numberOfLines={1}
          style={[styles.zoomValue, { color: theme.text }]}
        >
          {value}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Increase ${label.toLowerCase()}`}
          accessibilityState={{ disabled: !canIncrease }}
          disabled={!canIncrease}
          onPress={onIncrease}
          style={({ pressed }) => buttonStyle(pressed, canIncrease)}
        >
          <MaterialCommunityIcons
            accessibilityElementsHidden
            importantForAccessibility="no"
            name="plus"
            size={19}
            color={theme.text}
          />
        </Pressable>
      </View>
    </View>
  );
}

function MonthlyRow({
  stat,
  maxAverage,
  activityLabel,
  isCurrent,
  color,
  theme,
}: {
  stat: MonthlyActivityStat;
  maxAverage: number;
  activityLabel: string;
  isCurrent: boolean;
  color: string;
  theme: Theme;
}) {
  const average = stat.averagePerRecordedDay.toFixed(1);
  const month = longMonth.format(stat.date);
  const barWidth = (stat.total ? `${Math.max(4, (stat.averagePerRecordedDay / maxAverage) * 100)}%` : '0%') as `${number}%`;

  return (
    <View
      accessible
      accessibilityLabel={`${month}. ${average} ${activityLabel} logs per recorded day. ${stat.total} logs across ${stat.recordedDays} recorded ${stat.recordedDays === 1 ? 'day' : 'days'}.`}
      style={[styles.monthRow, { borderColor: theme.border }, isCurrent && { backgroundColor: theme.primarySoft }]}
    >
      <View style={styles.monthHeading}>
        <Text style={[styles.monthName, { color: isCurrent ? theme.primary : theme.text }]}>
          {isCurrent ? 'This month' : month}
        </Text>
        <Text style={[styles.monthAverage, { color: isCurrent ? theme.primary : theme.text }]}>{average}/day</Text>
      </View>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no"
        style={[styles.monthTrack, { backgroundColor: theme.surface }]}
      >
        <View style={[styles.monthBar, { backgroundColor: color, width: barWidth }]} />
      </View>
      <Text style={[styles.monthDetail, { color: theme.textMuted }]}>
        {isCurrent ? `${month} · ` : ''}{stat.total} {stat.total === 1 ? 'log' : 'logs'} · {stat.recordedDays} {stat.recordedDays === 1 ? 'day' : 'days'} with activity
      </Text>
    </View>
  );
}

export function InsightsScreen({
  events,
  onAddEstimate,
  theme,
}: {
  events: PuppyEvent[];
  onAddEstimate: (estimate: MissingLogEstimate) => Promise<void>;
  theme: Theme;
}) {
  const { width } = useWindowDimensions();
  const [selectedTypes, setSelectedTypes] = useState<EventType[]>([...eventTypes]);
  const [horizontalZoom, setHorizontalZoom] = useState(0);
  const [verticalZoom, setVerticalZoom] = useState(1);
  const [historyPage, setHistoryPage] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [showAllMonths, setShowAllMonths] = useState(false);
  const [addingEstimateId, setAddingEstimateId] = useState<string | null>(null);
  const [nowTime, setNowTime] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNowTime(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const now = new Date(nowTime);
  const earliestEventAt = events.reduce((earliest, event) => Math.min(earliest, event.at), now.getTime());
  const historyDays = events.length ? calendarDayDistance(new Date(earliestEventAt), now) : 0;
  const maxHistoryOffset = Math.max(0, historyDays - (TIMELINE_DAYS - 1));
  const maxHistoryPage = Math.ceil(maxHistoryOffset / TIMELINE_DAYS);
  const currentHistoryPage = Math.min(historyPage, maxHistoryPage);
  const historyOffset = Math.min(currentHistoryPage * TIMELINE_DAYS, maxHistoryOffset);
  const rangeEnd = new Date(now);
  rangeEnd.setDate(rangeEnd.getDate() - historyOffset);
  const days = buildTimelineDays(events, TIMELINE_DAYS, rangeEnd, now);
  const frequency = activityFrequencyStats(events, ['pee', 'poop'], TIMELINE_DAYS, now);
  const missingLogs = estimateMissingLogs(events, MISSING_LOG_DAYS, now);
  const todayKey = dateKey(now);
  const visibleEventCount = new Set(
    days.flatMap((day) => day.marks.filter((mark) => selectedTypes.includes(mark.type)).map((mark) => mark.id)),
  ).size;
  const allSelected = selectedTypes.length === eventTypes.length;
  const rowHeight = verticalZoomLevels[verticalZoom];
  const baseTrackWidth = Math.max(220, Math.min(width, 960) - 122);
  const trackWidth = Math.round(baseTrackWidth * horizontalZoomLevels[horizontalZoom]);
  const tickStep = trackWidth >= 480 ? 3 : 6;
  const tickHours = Array.from({ length: 24 / tickStep + 1 }, (_, index) => index * tickStep);
  const gridHours = tickHours.slice(1, -1);
  const rangeLabel = days.length
    ? formatDateRange(days[0].date, days[days.length - 1].date)
    : '';
  const monthly = useMemo(
    () => monthlyActivityStats(
      events,
      selectedTypes.length === eventTypes.length ? undefined : selectedTypes,
    ),
    [events, selectedTypes],
  );
  const visibleMonths = showAllMonths ? monthly : monthly.slice(0, MONTH_PREVIEW_COUNT);
  const maxMonthlyAverage = Math.max(1, ...monthly.map((stat) => stat.averagePerRecordedDay));
  const currentMonthKey = todayKey.slice(0, 7);
  const historyColor = selectedTypes.length === 1 ? eventColor(selectedTypes[0], theme) : theme.primary;
  const exportDisabled = exporting || events.length === 0;

  function toggleActivity(type: EventType) {
    setSelectedTypes((current) => current.includes(type)
      ? current.filter((candidate) => candidate !== type)
      : eventTypes.filter((candidate) => current.includes(candidate) || candidate === type));
  }

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

  async function addEstimate(estimate: MissingLogEstimate) {
    if (addingEstimateId) return;
    setAddingEstimateId(estimate.id);
    try {
      await onAddEstimate(estimate);
    } catch {
      Alert.alert('Couldn’t add this estimate', 'Your activity history is unchanged. Please try again.');
    } finally {
      setAddingEstimateId(null);
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

      <View style={[styles.missingCard, { backgroundColor: theme.surfaceRaised, borderColor: theme.border }]}>
        <View style={styles.frequencyHeading}>
          <View style={[styles.smallIcon, { backgroundColor: theme.primarySoft }]}>
            <MaterialCommunityIcons
              accessibilityElementsHidden
              importantForAccessibility="no"
              name="magnify"
              size={21}
              color={theme.primary}
            />
          </View>
          <View style={styles.panelHeadingCopy}>
            <Text style={[styles.panelTitle, { color: theme.text }]}>Possible gaps</Text>
            <Text style={[styles.panelCaption, { color: theme.textMuted }]}>
              Repeated times from {missingLogs.daysAnalyzed} active {missingLogs.daysAnalyzed === 1 ? 'day' : 'days'}
            </Text>
          </View>
        </View>
        <Text style={[styles.missingNote, { color: theme.textMuted, backgroundColor: theme.surface }]}>
          A suggestion appears only when the same activity was logged near that time on at least 3 other days and logging continued afterward. Nothing is added automatically.
        </Text>
        {missingLogs.estimates.length ? (
          <View style={styles.estimateList}>
            {missingLogs.estimates.map((estimate) => {
              const meta = EVENT_META[estimate.type];
              const activityName = estimate.type === 'meal' ? 'Meal' : meta.label;
              const color = eventColor(estimate.type, theme);
              const softColor = theme.isDark ? meta.darkSoftColor : meta.softColor;
              const adding = addingEstimateId === estimate.id;
              const time = estimate.endedAt === undefined
                ? `around ${formatTime(estimate.at)}`
                : `about ${formatTime(estimate.at)}–${formatTime(estimate.endedAt)}`;
              const title = estimate.type === 'nap' ? 'Possible unlogged nap' : `${activityName} may be unlogged`;
              return (
                <View
                  key={estimate.id}
                  style={[styles.estimateRow, { borderColor: theme.border }]}
                >
                  <View
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                    style={[styles.estimateIcon, { backgroundColor: softColor }]}
                  >
                    <MaterialCommunityIcons
                      accessibilityElementsHidden
                      importantForAccessibility="no"
                      name={meta.icon as keyof typeof MaterialCommunityIcons.glyphMap}
                      size={20}
                      color={color}
                    />
                    <View style={[styles.questionBadge, { backgroundColor: theme.surfaceRaised, borderColor: color }]}>
                      <Text style={[styles.questionMark, { color }]}>?</Text>
                    </View>
                  </View>
                  <View
                    accessible
                    accessibilityLabel={`${title}. ${estimateDate.format(estimate.at)}, ${time}. Seen on ${estimate.observedDays} of ${estimate.comparedDays} other active days.`}
                    style={styles.estimateCopy}
                  >
                    <Text style={[styles.estimateTitle, { color: theme.text }]}>{title}</Text>
                    <Text style={[styles.estimateTime, { color }]}>{estimateDate.format(estimate.at)} · {time}</Text>
                    <Text style={[styles.estimateEvidence, { color: theme.textMuted }]}>
                      Seen near this time on {estimate.observedDays} of {estimate.comparedDays} other active days.
                    </Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Add ${activityName.toLowerCase()} at the estimated time`}
                    accessibilityState={{ busy: adding, disabled: addingEstimateId !== null }}
                    disabled={addingEstimateId !== null}
                    onPress={() => void addEstimate(estimate)}
                    style={({ pressed }) => [
                      styles.addEstimateButton,
                      { backgroundColor: pressed ? theme.primaryPressed : theme.primary, opacity: addingEstimateId && !adding ? 0.45 : 1 },
                    ]}
                  >
                    {adding ? (
                      <ActivityIndicator
                        accessibilityElementsHidden
                        importantForAccessibility="no"
                        color={theme.onPrimary}
                        size="small"
                      />
                    ) : (
                      <MaterialCommunityIcons
                        accessibilityElementsHidden
                        importantForAccessibility="no"
                        name="plus"
                        size={19}
                        color={theme.onPrimary}
                      />
                    )}
                    <Text style={[styles.addEstimateText, { color: theme.onPrimary }]}>{adding ? 'Adding…' : 'Add log'}</Text>
                  </Pressable>
                </View>
              );
            })}
          </View>
        ) : (
          <View style={[styles.noEstimate, { borderColor: theme.border }]}>
            <MaterialCommunityIcons
              accessibilityElementsHidden
              importantForAccessibility="no"
              name={missingLogs.daysAnalyzed < 4 ? 'chart-timeline-variant' : 'check-circle-outline'}
              size={19}
              color={theme.textMuted}
            />
            <Text style={[styles.noEstimateText, { color: theme.textMuted }]}>
              {missingLogs.daysAnalyzed < 4
                ? `Log activity on ${4 - missingLogs.daysAnalyzed} more ${4 - missingLogs.daysAnalyzed === 1 ? 'day' : 'days'} to check for gaps.`
                : `No strong gaps found in the last ${missingLogs.periodDays} days.`}
            </Text>
          </View>
        )}
      </View>

      <View style={styles.filterHeading}>
        <Text style={[styles.filterTitle, { color: theme.text }]}>Timeline activities</Text>
        <Text style={[styles.filterHint, { color: theme.textMuted }]}>Select any combination</Text>
      </View>
      <View style={styles.filters}>
        {activityFilters.map((type) => {
          const isAll = type === 'all';
          const checked: boolean | 'mixed' = isAll
            ? allSelected
              ? true
              : selectedTypes.length
                ? 'mixed'
                : false
            : selectedTypes.includes(type);
          const active = checked !== false;
          const selected = checked === true;
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
              accessibilityRole="checkbox"
              accessibilityLabel={isAll
                ? allSelected ? 'Clear all activity filters' : 'Select all activity filters'
                : `${selected ? 'Hide' : 'Show'} ${meta.label} timing`}
              accessibilityState={{ checked }}
              onPress={() => isAll
                ? setSelectedTypes(allSelected ? [] : [...eventTypes])
                : toggleActivity(type)}
              style={({ pressed }) => [
                styles.filterChip,
                {
                  backgroundColor: selected ? softColor : theme.surfaceRaised,
                  borderColor: active ? color : theme.border,
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
              <Text style={[styles.filterLabel, { color: active ? color : theme.textMuted }]}>
                {meta.label}
              </Text>
              {active ? (
                <MaterialCommunityIcons
                  accessibilityElementsHidden
                  importantForAccessibility="no"
                  name={checked === 'mixed' ? 'minus' : 'check'}
                  size={15}
                  color={color}
                />
              ) : null}
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
              {selectionTitle(selectedTypes)}
            </Text>
            <Text style={[styles.panelCaption, { color: theme.textMuted }]}>
              {rangeLabel} · {visibleEventCount} {visibleEventCount === 1 ? 'log' : 'logs'} · oldest at top
            </Text>
          </View>
        </View>

        <View style={[styles.zoomPanel, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <View style={styles.zoomControls}>
            <ZoomControl
              label="Time width"
              value={`${Math.round(horizontalZoomLevels[horizontalZoom] * 100)}%`}
              canDecrease={horizontalZoom > 0}
              canIncrease={horizontalZoom < horizontalZoomLevels.length - 1}
              onDecrease={() => setHorizontalZoom((value) => Math.max(0, value - 1))}
              onIncrease={() => setHorizontalZoom((value) => Math.min(horizontalZoomLevels.length - 1, value + 1))}
              theme={theme}
            />
            <ZoomControl
              label="Day height"
              value={verticalZoomLabels[verticalZoom]}
              canDecrease={verticalZoom > 0}
              canIncrease={verticalZoom < verticalZoomLevels.length - 1}
              onDecrease={() => setVerticalZoom((value) => Math.max(0, value - 1))}
              onIncrease={() => setVerticalZoom((value) => Math.min(verticalZoomLevels.length - 1, value + 1))}
              theme={theme}
            />
          </View>
          <Text style={[styles.zoomHint, { color: theme.textMuted }]}>
            Enlarge the time width, then swipe the chart sideways to inspect busy periods.
          </Text>
        </View>

        <View style={styles.rangeNavigator}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Show earlier dates"
            accessibilityState={{ disabled: currentHistoryPage >= maxHistoryPage }}
            disabled={currentHistoryPage >= maxHistoryPage}
            onPress={() => setHistoryPage(Math.min(maxHistoryPage, currentHistoryPage + 1))}
            style={({ pressed }) => [
              styles.rangeButton,
              {
                borderColor: theme.border,
                opacity: currentHistoryPage >= maxHistoryPage ? 0.35 : pressed ? 0.7 : 1,
              },
            ]}
          >
            <MaterialCommunityIcons
              accessibilityElementsHidden
              importantForAccessibility="no"
              name="chevron-left"
              size={19}
              color={theme.text}
            />
            <Text style={[styles.rangeButtonText, { color: theme.text }]}>Earlier</Text>
          </Pressable>
          <View style={styles.rangeCopy}>
            <Text style={[styles.rangeLabel, { color: theme.text }]}>{rangeLabel}</Text>
            <Text style={[styles.rangeStatus, { color: theme.textMuted }]}>
              {currentHistoryPage === 0 ? `Latest ${TIMELINE_DAYS} days` : `Older ${TIMELINE_DAYS}-day window`}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Show newer dates"
            accessibilityState={{ disabled: currentHistoryPage === 0 }}
            disabled={currentHistoryPage === 0}
            onPress={() => setHistoryPage(Math.max(0, currentHistoryPage - 1))}
            style={({ pressed }) => [
              styles.rangeButton,
              {
                borderColor: theme.border,
                opacity: currentHistoryPage === 0 ? 0.35 : pressed ? 0.7 : 1,
              },
            ]}
          >
            <Text style={[styles.rangeButtonText, { color: theme.text }]}>Newer</Text>
            <MaterialCommunityIcons
              accessibilityElementsHidden
              importantForAccessibility="no"
              name="chevron-right"
              size={19}
              color={theme.text}
            />
          </Pressable>
        </View>

        <View style={styles.chart}>
          <View style={styles.dateColumn}>
            <View style={styles.axisSpacer} />
            {days.map((day) => (
              <TimelineDateLabel
                key={day.key}
                day={day}
                selectedTypes={selectedTypes}
                isToday={day.key === todayKey}
                rowHeight={rowHeight}
                theme={theme}
              />
            ))}
          </View>
          <ScrollView
            directionalLockEnabled
            horizontal
            nestedScrollEnabled
            showsHorizontalScrollIndicator
            style={styles.trackScroller}
            contentContainerStyle={{ width: trackWidth }}
          >
            <View style={{ width: trackWidth }}>
              <TimelineAxis hours={tickHours} theme={theme} />
              {days.map((day) => (
                <TimelineTrack
                  key={day.key}
                  day={day}
                  selectedTypes={selectedTypes}
                  isToday={day.key === todayKey}
                  rowHeight={rowHeight}
                  gridHours={gridHours}
                  theme={theme}
                />
              ))}
            </View>
          </ScrollView>
        </View>

        {selectedTypes.length === 0 || visibleEventCount === 0 ? (
          <View style={[styles.emptyNote, { backgroundColor: theme.surface }]}>
            <MaterialCommunityIcons
              accessibilityElementsHidden
              importantForAccessibility="no"
              name="clock-outline"
              size={19}
              color={theme.textMuted}
            />
            <Text style={[styles.emptyText, { color: theme.textMuted }]}>
              {selectedTypes.length === 0
                ? 'Choose at least one activity above to show it on the timeline.'
                : `No ${filterName(selectedTypes)} logged in this date range.`}
            </Text>
          </View>
        ) : null}
      </View>

      {selectedTypes.length > 0 && monthly.length > 1 ? (
        <View style={[styles.historyCard, { backgroundColor: theme.surfaceRaised, borderColor: theme.border }]}>
          <View style={styles.panelHeading}>
            <View style={[styles.smallIcon, { backgroundColor: theme.primarySoft }]}>
              <MaterialCommunityIcons
                accessibilityElementsHidden
                importantForAccessibility="no"
                name="calendar-range-outline"
                size={21}
                color={theme.primary}
              />
            </View>
            <View style={styles.panelHeadingCopy}>
              <Text style={[styles.panelTitle, { color: theme.text }]}>Month-by-month context</Text>
              <Text style={[styles.panelCaption, { color: theme.textMuted }]}>
                {selectionTitle(selectedTypes)} · newest first · recent {TIMELINE_DAYS}-day detail stays above
              </Text>
            </View>
          </View>
          <Text style={[styles.historyNote, { color: theme.textMuted, backgroundColor: theme.surface }]}>
            Monthly pace uses days where you recorded any activity, so incomplete or missed months are not treated as zeroes.
          </Text>
          <View style={styles.months}>
            {visibleMonths.map((stat) => (
              <MonthlyRow
                key={stat.key}
                stat={stat}
                maxAverage={maxMonthlyAverage}
                activityLabel={filterName(selectedTypes)}
                isCurrent={stat.key === currentMonthKey}
                color={historyColor}
                theme={theme}
              />
            ))}
          </View>
          {monthly.length > MONTH_PREVIEW_COUNT ? (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: showAllMonths }}
              onPress={() => setShowAllMonths((shown) => !shown)}
              style={({ pressed }) => [
                styles.historyToggle,
                { borderColor: theme.border, backgroundColor: pressed ? theme.primarySoft : theme.surface },
              ]}
            >
              <Text style={[styles.historyToggleText, { color: theme.primary }]}>
                {showAllMonths ? 'Show recent months' : `Show all ${monthly.length} months`}
              </Text>
              <MaterialCommunityIcons
                accessibilityElementsHidden
                importantForAccessibility="no"
                name={showAllMonths ? 'chevron-up' : 'chevron-down'}
                size={21}
                color={theme.primary}
              />
            </Pressable>
          ) : null}
        </View>
      ) : null}

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
    maxWidth: 960,
    alignSelf: 'center',
    padding: spacing.md,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  eyebrow: { fontSize: 11, fontWeight: '800', letterSpacing: 1.5, marginTop: 4 },
  title: { fontSize: 30, lineHeight: 36, fontWeight: '800', letterSpacing: -0.6, marginTop: -8 },
  subtitle: { fontSize: 15, lineHeight: 22, marginTop: -10 },
  filterHeading: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: spacing.sm, marginBottom: -8 },
  filterTitle: { fontSize: 15, lineHeight: 20, fontWeight: '800' },
  filterHint: { fontSize: 12, lineHeight: 17, textAlign: 'right' },
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
  missingCard: { borderWidth: 1, borderRadius: 22, padding: 12 },
  frequencyHeading: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 4 },
  frequencyNote: { fontSize: 11, lineHeight: 16, borderRadius: 12, paddingHorizontal: 11, paddingVertical: 9, marginTop: 10 },
  missingNote: { fontSize: 11, lineHeight: 16, borderRadius: 12, paddingHorizontal: 11, paddingVertical: 9, marginTop: 10 },
  estimateList: { marginTop: 12 },
  estimateRow: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 4, paddingTop: 13, paddingBottom: 11, flexDirection: 'row', alignItems: 'center', gap: 10 },
  estimateIcon: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  questionBadge: { position: 'absolute', right: -3, bottom: -3, width: 17, height: 17, borderRadius: 9, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  questionMark: { fontSize: 10, lineHeight: 12, fontWeight: '900' },
  estimateCopy: { flex: 1, minWidth: 0 },
  estimateTitle: { fontSize: 14, lineHeight: 19, fontWeight: '800' },
  estimateTime: { fontSize: 12, lineHeight: 17, fontWeight: '700', marginTop: 1 },
  estimateEvidence: { fontSize: 11, lineHeight: 16, marginTop: 2 },
  addEstimateButton: { minWidth: 86, minHeight: 48, borderRadius: 14, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  addEstimateText: { fontSize: 12, lineHeight: 16, fontWeight: '800' },
  noEstimate: { minHeight: 48, borderTopWidth: StyleSheet.hairlineWidth, marginTop: 12, paddingHorizontal: 4, paddingTop: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  noEstimateText: { flex: 1, fontSize: 12, lineHeight: 17 },
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
  zoomPanel: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, padding: 8, gap: 7 },
  zoomControls: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  zoomControl: { flex: 1, minWidth: 145, borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 7 },
  controlLabel: { fontSize: 9, lineHeight: 13, fontWeight: '800', letterSpacing: 0.7, marginBottom: 4 },
  stepper: { flexDirection: 'row', alignItems: 'center' },
  zoomButton: {
    width: 48,
    height: 48,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoomValue: { flex: 1, minWidth: 42, fontSize: 12, lineHeight: 17, fontWeight: '800', textAlign: 'center', fontVariant: ['tabular-nums'] },
  zoomHint: { fontSize: 11, lineHeight: 16, paddingHorizontal: 3 },
  rangeNavigator: { flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 12 },
  rangeButton: {
    minHeight: 48,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 7,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rangeButtonText: { fontSize: 12, lineHeight: 17, fontWeight: '700' },
  rangeCopy: { flex: 1, minWidth: 0, alignItems: 'center' },
  rangeLabel: { fontSize: 11, lineHeight: 15, fontWeight: '700', textAlign: 'center', fontVariant: ['tabular-nums'] },
  rangeStatus: { fontSize: 10, lineHeight: 14, textAlign: 'center', marginTop: 1 },
  chart: { flexDirection: 'row', alignItems: 'flex-start' },
  dateColumn: { width: 64, flexShrink: 0 },
  axisSpacer: { height: 22 },
  dateCell: { justifyContent: 'center', paddingRight: 8 },
  trackScroller: { flex: 1, minWidth: 0 },
  axisTrack: { height: 22, position: 'relative' },
  axisLabel: { position: 'absolute', width: 34, fontSize: 10, lineHeight: 14, fontWeight: '600', fontVariant: ['tabular-nums'] },
  axisStart: { left: 0, textAlign: 'left' },
  axisEnd: { right: 0, textAlign: 'right' },
  trackRow: { justifyContent: 'center' },
  weekday: { fontSize: 10, lineHeight: 13, fontWeight: '800', letterSpacing: 0.35 },
  calendarDate: { fontSize: 10, lineHeight: 13, fontWeight: '600', marginTop: 1 },
  timelineTrack: {
    width: '100%',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    position: 'relative',
    overflow: 'hidden',
  },
  gridLine: { position: 'absolute', top: 0, bottom: 0, width: StyleSheet.hairlineWidth },
  pointMark: {
    position: 'absolute',
  },
  durationMark: {
    position: 'absolute',
    minWidth: 3,
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
  historyCard: { borderWidth: 1, borderRadius: 22, padding: 12 },
  historyNote: { fontSize: 11, lineHeight: 16, borderRadius: 12, paddingHorizontal: 11, paddingVertical: 9 },
  months: { marginTop: 4 },
  monthRow: { borderTopWidth: StyleSheet.hairlineWidth, borderRadius: 12, paddingHorizontal: 8, paddingVertical: 11 },
  monthHeading: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  monthName: { flex: 1, fontSize: 14, lineHeight: 19, fontWeight: '700' },
  monthAverage: { fontSize: 15, lineHeight: 20, fontWeight: '800', fontVariant: ['tabular-nums'] },
  monthTrack: { height: 7, borderRadius: 4, overflow: 'hidden', marginTop: 7 },
  monthBar: { height: 7, borderRadius: 4 },
  monthDetail: { fontSize: 11, lineHeight: 16, marginTop: 5 },
  historyToggle: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 15,
    paddingHorizontal: 14,
    marginTop: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  historyToggleText: { fontSize: 14, lineHeight: 19, fontWeight: '700' },
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

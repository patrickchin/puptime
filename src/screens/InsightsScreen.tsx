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
import { useLocalization } from '../localization-context';
import { localizedEventLabel, translate, type AppLanguage } from '../localization';
import { shareEventsCsv } from '../share-export';
import { eventIcon, spacing, type Theme } from '../theme';

const FREQUENCY_DAYS = 10;
const MISSING_LOG_DAYS = 14;
const activityFilters = ['all', ...eventTypes] as const;
const horizontalZoomLevels = [1, 1.5, 2] as const;
const verticalZoomLevels = [
  { days: 10, rowHeight: 48 },
  { days: 20, rowHeight: 38 },
  { days: 30, rowHeight: 32 },
] as const;
const DATE_COLUMN_WIDTH = 64;
const MONTH_PREVIEW_COUNT = 6;

function formatBucket(bucket: number, language: AppLanguage): string {
  return new Intl.DateTimeFormat(language, { hour: 'numeric', minute: '2-digit' })
    .format(new Date(2000, 0, 1, 0, bucket * TIMELINE_BUCKET_MINUTES));
}

function describeMark(mark: TimelineMark, language: AppLanguage): string {
  const activity = localizedEventLabel(language, mark.type);
  return mark.endBucket === undefined
    ? translate(language, 'insights.pointWindow', {
      activity,
      start: formatBucket(mark.startBucket, language),
      end: formatBucket(mark.startBucket + 1, language),
    })
    : translate(language, 'insights.durationWindow', {
      activity,
      start: formatBucket(mark.startBucket, language),
      end: formatBucket(mark.endBucket, language),
    });
}

function filterName(types: readonly EventType[], language: AppLanguage): string {
  if (types.length === eventTypes.length) return translate(language, 'insights.activity');
  if (types.length === 1) return localizedEventLabel(language, types[0]).toLocaleLowerCase(language);
  return translate(language, 'insights.selectedActivity');
}

function selectionTitle(types: readonly EventType[], language: AppLanguage): string {
  if (types.length === 0) return translate(language, 'insights.noSelected');
  if (types.length === eventTypes.length) return translate(language, 'insights.allActivity');
  if (types.length <= 2) {
    return translate(language, 'insights.timing', {
      activities: types.map((type) => localizedEventLabel(language, type)).join(' + '),
    });
  }
  return translate(language, 'insights.activityCount', { count: types.length });
}

function calendarDayDistance(older: Date, newer: Date): number {
  const utc = (date: Date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.max(0, Math.round((utc(newer) - utc(older)) / 86_400_000));
}

function formatHour(hour: number, language: AppLanguage): string {
  return new Intl.DateTimeFormat(language, { hour: 'numeric' })
    .format(new Date(2000, 0, 1, hour % 24));
}

function formatDateRange(start: Date, end: Date, language: AppLanguage): string {
  const shortDate = new Intl.DateTimeFormat(language, { month: 'short', day: 'numeric' });
  const rangeDate = new Intl.DateTimeFormat(language, { month: 'short', day: 'numeric', year: 'numeric' });
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
  const { eventLabel, t } = useLocalization();
  const meta = EVENT_META[stat.type];
  const label = eventLabel(stat.type);
  const color = eventColor(stat.type, theme);
  const dailyValue = stat.total ? t('insights.perDay', { value: stat.averagePerRecordedDay.toFixed(1) }) : '—';
  const dailyDetail = stat.total
    ? stat.minimumPerRecordedDay === stat.maximumPerRecordedDay
      ? t('insights.eachRecordedDay', { count: stat.minimumPerRecordedDay })
      : t('insights.rangePerDay', {
        minimum: stat.minimumPerRecordedDay,
        maximum: stat.maximumPerRecordedDay,
      })
    : t('insights.noLogsYet', { activity: label.toLocaleLowerCase() });
  const intervalValue = durationFromMinutes(stat.medianIntervalMinutes);
  const intervalDetail = stat.medianIntervalMinutes === undefined
    ? t('insights.needAnotherLog')
    : stat.intervalSamples >= 4
      ? t('insights.middleHalf', {
        lower: durationFromMinutes(stat.lowerIntervalMinutes),
        upper: durationFromMinutes(stat.upperIntervalMinutes),
      })
      : t('insights.gapsObserved', { count: stat.intervalSamples });

  return (
    <View
      accessible
      accessibilityLabel={`${label}. ${dailyValue}, ${dailyDetail}. ${t('insights.typicalGap')} ${intervalValue}. ${intervalDetail}.`}
      style={[styles.frequencyRow, { borderColor: theme.border }]}
    >
      <View style={styles.activityHeading}>
        <View
          style={[
            styles.activityIcon,
            {
              backgroundColor: theme.isDark ? meta.darkSoftColor : meta.softColor,
              borderRadius: theme.presentation.iconRadius,
            },
          ]}
        >
          <MaterialCommunityIcons
            accessibilityElementsHidden
            importantForAccessibility="no"
            name={eventIcon(theme, stat.type) as keyof typeof MaterialCommunityIcons.glyphMap}
            size={20}
            color={color}
          />
        </View>
        <Text style={[styles.activityName, { color: theme.text }]}>{label}</Text>
        <Text style={[styles.logCount, { color: theme.textMuted }]}>{t('insights.logCount', { count: stat.total })}</Text>
      </View>
      <View style={styles.metrics}>
        <View style={styles.metric}>
          <Text style={[styles.metricValue, { color: theme.text }]}>{dailyValue}</Text>
          <Text style={[styles.metricDetail, { color: theme.textMuted }]}>{dailyDetail}</Text>
        </View>
        <View style={[styles.metricDivider, { backgroundColor: theme.border }]} />
        <View style={styles.metric}>
          <Text style={[styles.metricValue, { color: theme.text }]}>{intervalValue}</Text>
          <Text style={[styles.metricLabel, { color: theme.textMuted }]}>{t('insights.typicalGap')}</Text>
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
  currentTime,
  rowHeight,
  theme,
}: {
  day: TimelineDay;
  selectedTypes: readonly EventType[];
  isToday: boolean;
  currentTime?: Date;
  rowHeight: number;
  theme: Theme;
}) {
  const { language, t } = useLocalization();
  const marks = day.marks.filter((mark) => selectedTypes.includes(mark.type));
  const description = marks.length
    ? marks.map((mark) => describeMark(mark, language)).join('. ')
    : selectedTypes.length
      ? t('insights.noLogged', { activity: filterName(selectedTypes, language) })
      : t('insights.noActivitySelected');
  const fullDate = new Intl.DateTimeFormat(language, { weekday: 'long', month: 'long', day: 'numeric' });
  const shortDay = new Intl.DateTimeFormat(language, { weekday: 'short' });
  const shortDate = new Intl.DateTimeFormat(language, { month: 'short', day: 'numeric' });
  const currentTimeDescription = currentTime
    ? t('insights.currentTime', {
      time: new Intl.DateTimeFormat(language, { hour: 'numeric', minute: '2-digit' }).format(currentTime),
    })
    : undefined;

  return (
    <View
      accessible
      accessibilityLabel={`${[fullDate.format(day.date), currentTimeDescription, description].filter(Boolean).join('. ')}.`}
      style={[styles.dateCell, { borderBottomColor: theme.border, height: rowHeight }]}
    >
      <Text maxFontSizeMultiplier={1.5} style={[styles.weekday, { color: isToday ? theme.primary : theme.text }]}>
        {isToday ? t('insights.today') : shortDay.format(day.date).toUpperCase()}
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
  currentTime,
  rowHeight,
  gridHours,
  theme,
}: {
  day: TimelineDay;
  selectedTypes: readonly EventType[];
  isToday: boolean;
  currentTime?: Date;
  rowHeight: number;
  gridHours: readonly number[];
  theme: Theme;
}) {
  const marks = day.marks.filter((mark) => selectedTypes.includes(mark.type));
  const currentTimePosition = currentTime
    ? ((currentTime.getHours() * 60 + currentTime.getMinutes()) / (24 * 60)) * 100
    : undefined;

  return (
    <View style={[styles.trackRow, { height: rowHeight }]}>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[
          styles.timelineTrack,
          {
            height: rowHeight,
            backgroundColor: isToday ? theme.primarySoft : theme.surface,
            borderBottomColor: theme.border,
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
        {currentTimePosition !== undefined ? (
          <View
            style={[
              styles.currentTimeMarker,
              {
                backgroundColor: theme.text,
                borderColor: theme.surfaceRaised,
                left: `${currentTimePosition}%`,
              },
            ]}
          >
            <View
              style={[
                styles.currentTimeMarkerHead,
                { backgroundColor: theme.text, borderColor: theme.surfaceRaised },
              ]}
            />
          </View>
        ) : null}
      </View>
    </View>
  );
}

function TimelineAxis({ hours, theme }: { hours: readonly number[]; theme: Theme }) {
  const { language } = useLocalization();
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
          {formatHour(hour, language)}
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
  const { t } = useLocalization();
  const buttonStyle = (pressed: boolean, enabled: boolean) => [
    styles.zoomButton,
    {
      backgroundColor: pressed && enabled ? theme.primarySoft : 'transparent',
      opacity: enabled ? (pressed ? 0.7 : 1) : 0.35,
    },
  ];

  return (
    <View style={styles.zoomControl}>
      <Text style={[styles.controlLabel, { color: theme.textMuted }]}>{label.toUpperCase()}</Text>
      <View style={styles.stepper}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('insights.decrease', { control: label.toLocaleLowerCase() })}
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
          accessibilityLabel={t('insights.increase', { control: label.toLocaleLowerCase() })}
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
  const { language, t } = useLocalization();
  const average = stat.averagePerRecordedDay.toFixed(1);
  const month = new Intl.DateTimeFormat(language, { month: 'long', year: 'numeric' }).format(stat.date);
  const barWidth = (stat.total ? `${Math.max(4, (stat.averagePerRecordedDay / maxAverage) * 100)}%` : '0%') as `${number}%`;

  return (
    <View
      accessible
      accessibilityLabel={t('insights.monthA11y', {
        month,
        average,
        activity: activityLabel,
        logs: stat.total,
        days: stat.recordedDays,
      })}
      style={[styles.monthRow, { borderColor: theme.border }, isCurrent && { backgroundColor: theme.primarySoft }]}
    >
      <View style={styles.monthHeading}>
        <Text style={[styles.monthName, { color: isCurrent ? theme.primary : theme.text }]}>
          {isCurrent ? t('insights.thisMonth') : month}
        </Text>
        <Text style={[styles.monthAverage, { color: isCurrent ? theme.primary : theme.text }]}>
          {t('insights.perDay', { value: average })}
        </Text>
      </View>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no"
        style={[styles.monthTrack, { backgroundColor: theme.surface }]}
      >
        <View style={[styles.monthBar, { backgroundColor: color, width: barWidth }]} />
      </View>
      <Text style={[styles.monthDetail, { color: theme.textMuted }]}>
        {isCurrent ? `${month} · ` : ''}{t('insights.monthDetail', { logs: stat.total, days: stat.recordedDays })}
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
  const { eventLabel, language, t } = useLocalization();
  const { fontScale, width } = useWindowDimensions();
  const [selectedTypes, setSelectedTypes] = useState<EventType[]>([...eventTypes]);
  const [horizontalZoom, setHorizontalZoom] = useState(0);
  const [verticalZoom, setVerticalZoom] = useState(0);
  const [historyOffset, setHistoryOffset] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [showAllMonths, setShowAllMonths] = useState(false);
  const [addingEstimateId, setAddingEstimateId] = useState<string | null>(null);
  const [nowTime, setNowTime] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNowTime(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const now = new Date(nowTime);
  const { days: timelineDays, rowHeight: baseRowHeight } = verticalZoomLevels[verticalZoom];
  const rowHeight = Math.round(baseRowHeight * Math.min(fontScale, 1.5));
  const earliestEventAt = events.reduce((earliest, event) => Math.min(earliest, event.at), now.getTime());
  const historyDays = events.length ? calendarDayDistance(new Date(earliestEventAt), now) : 0;
  const maxHistoryOffset = Math.max(0, historyDays - (timelineDays - 1));
  const currentHistoryOffset = Math.min(historyOffset, maxHistoryOffset);
  const rangeEnd = new Date(now);
  rangeEnd.setDate(rangeEnd.getDate() - currentHistoryOffset);
  const days = buildTimelineDays(events, timelineDays, rangeEnd, now);
  const frequency = activityFrequencyStats(events, ['pee', 'poop'], FREQUENCY_DAYS, now);
  const missingLogs = estimateMissingLogs(events, MISSING_LOG_DAYS, now);
  const todayKey = dateKey(now);
  const visibleEventCount = new Set(
    days.flatMap((day) => day.marks.filter((mark) => selectedTypes.includes(mark.type)).map((mark) => mark.id)),
  ).size;
  const allSelected = selectedTypes.length === eventTypes.length;
  const baseTrackWidth = Math.max(
    220,
    Math.min(width, 960)
      - spacing.md * 2
      - DATE_COLUMN_WIDTH,
  );
  const trackWidth = Math.round(baseTrackWidth * horizontalZoomLevels[horizontalZoom]);
  const tickStep = trackWidth >= 480 ? 3 : 6;
  const tickHours = Array.from({ length: 24 / tickStep + 1 }, (_, index) => index * tickStep);
  const gridHours = tickHours.slice(1, -1);
  const rangeLabel = days.length
    ? formatDateRange(days[0].date, days[days.length - 1].date, language)
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
      Alert.alert(t('insights.exportErrorTitle'), t('insights.exportErrorBody'));
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
      Alert.alert(t('insights.estimateErrorTitle'), t('insights.estimateErrorBody'));
    } finally {
      setAddingEstimateId(null);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text
        style={[
          styles.title,
          {
            color: theme.text,
            fontSize: theme.presentation.titleSize,
            lineHeight: theme.presentation.titleLineHeight,
            fontWeight: theme.presentation.titleWeight,
            letterSpacing: theme.presentation.titleTracking,
          },
        ]}
      >
        {t('insights.title')}
      </Text>

      <View style={[styles.section, { borderColor: theme.border }]}>
        <View style={styles.frequencyHeading}>
          <View style={styles.smallIcon}>
            <MaterialCommunityIcons
              accessibilityElementsHidden
              importantForAccessibility="no"
              name="timer-sand"
              size={21}
              color={theme.primary}
            />
          </View>
          <View style={styles.panelHeadingCopy}>
            <Text style={[styles.panelTitle, { color: theme.text }]}>{t('insights.frequencyTitle')}</Text>
            <Text style={[styles.panelCaption, { color: theme.textMuted }]}>
              {t('insights.frequencyCaption', {
                period: frequency.periodDays,
                recorded: frequency.recordedDays,
              })}
            </Text>
          </View>
        </View>
        <View>
          {frequency.stats.map((stat) => <FrequencyRow key={stat.type} stat={stat} theme={theme} />)}
        </View>
      </View>

      <View style={[styles.section, { borderColor: theme.border }]}>
        <View style={styles.frequencyHeading}>
          <View style={styles.smallIcon}>
            <MaterialCommunityIcons
              accessibilityElementsHidden
              importantForAccessibility="no"
              name="magnify"
              size={21}
              color={theme.primary}
            />
          </View>
          <View style={styles.panelHeadingCopy}>
            <Text style={[styles.panelTitle, { color: theme.text }]}>{t('insights.gapsTitle')}</Text>
            <Text style={[styles.panelCaption, { color: theme.textMuted }]}>
              {t('insights.gapsCaption', { count: missingLogs.daysAnalyzed })}
            </Text>
          </View>
        </View>
        {missingLogs.estimates.length ? (
          <View style={styles.estimateList}>
            {missingLogs.estimates.map((estimate) => {
              const meta = EVENT_META[estimate.type];
              const activityName = estimate.type === 'meal' ? t('insights.mealName') : eventLabel(estimate.type);
              const color = eventColor(estimate.type, theme);
              const softColor = theme.isDark ? meta.darkSoftColor : meta.softColor;
              const adding = addingEstimateId === estimate.id;
              const time = estimate.endedAt === undefined
                ? t('insights.around', { time: formatTime(estimate.at) })
                : t('insights.aboutRange', {
                  start: formatTime(estimate.at),
                  end: formatTime(estimate.endedAt),
                });
              const title = estimate.type === 'nap'
                ? t('insights.possibleNap')
                : t('insights.mayBeUnlogged', { activity: activityName });
              const estimateDate = new Intl.DateTimeFormat(language, {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
              });
              const evidence = t('insights.seenEvidence', {
                observed: estimate.observedDays,
                compared: estimate.comparedDays,
              });
              return (
                <View
                  key={estimate.id}
                  style={[styles.estimateRow, { borderColor: theme.border }]}
                >
                  <View
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                    style={[
                      styles.estimateIcon,
                      { backgroundColor: softColor, borderRadius: theme.presentation.iconRadius },
                    ]}
                  >
                    <MaterialCommunityIcons
                      accessibilityElementsHidden
                      importantForAccessibility="no"
                      name={eventIcon(theme, estimate.type) as keyof typeof MaterialCommunityIcons.glyphMap}
                      size={20}
                      color={color}
                    />
                    <View
                      style={[
                        styles.questionBadge,
                        {
                          backgroundColor: theme.surfaceRaised,
                          borderColor: color,
                          borderRadius: theme.presentation.iconRadius,
                        },
                      ]}
                    >
                      <Text style={[styles.questionMark, { color }]}>?</Text>
                    </View>
                  </View>
                  <View
                    accessible
                    accessibilityLabel={`${title}. ${estimateDate.format(estimate.at)}, ${time}. ${evidence}`}
                    style={styles.estimateCopy}
                  >
                    <Text style={[styles.estimateTitle, { color: theme.text }]}>{title}</Text>
                    <Text style={[styles.estimateTime, { color }]}>{estimateDate.format(estimate.at)} · {time}</Text>
                    <Text style={[styles.estimateEvidence, { color: theme.textMuted }]}>
                      {evidence}
                    </Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('insights.addEstimateA11y', { activity: activityName })}
                    accessibilityState={{ busy: adding, disabled: addingEstimateId !== null }}
                    disabled={addingEstimateId !== null}
                    onPress={() => void addEstimate(estimate)}
                    style={({ pressed }) => [
                      styles.addEstimateButton,
                      {
                        backgroundColor: pressed ? theme.primaryPressed : theme.primary,
                        borderRadius: theme.presentation.controlRadius,
                        opacity: addingEstimateId && !adding ? 0.45 : 1,
                      },
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
                    <Text style={[styles.addEstimateText, { color: theme.onPrimary }]}>
                      {t(adding ? 'insights.adding' : 'insights.addLog')}
                    </Text>
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
                ? t('insights.needGapDays', { count: 4 - missingLogs.daysAnalyzed })
                : t('insights.noGaps', { count: missingLogs.periodDays })}
            </Text>
          </View>
        )}
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
          const label = isAll ? t('insights.all') : eventLabel(type);
          const icon = isAll ? 'layers-outline' : eventIcon(theme, type);
          const color = type === 'all' ? theme.primary : eventColor(type, theme);
          return (
            <Pressable
              key={type}
              accessibilityRole="checkbox"
              accessibilityLabel={isAll
                ? t(allSelected ? 'insights.clearFilters' : 'insights.selectFilters')
                : t(selected ? 'insights.hideTiming' : 'insights.showTiming', { activity: label })}
              accessibilityState={{ checked }}
              onPress={() => isAll
                ? setSelectedTypes(allSelected ? [] : [...eventTypes])
                : toggleActivity(type)}
              style={({ pressed }) => [
                styles.filterChip,
                {
                  borderBottomColor: active ? color : theme.border,
                  borderBottomWidth: active ? 2 : StyleSheet.hairlineWidth,
                  opacity: pressed ? 0.72 : 1,
                },
              ]}
            >
              <MaterialCommunityIcons
                accessibilityElementsHidden
                importantForAccessibility="no"
                name={icon as keyof typeof MaterialCommunityIcons.glyphMap}
                size={18}
                color={color}
              />
              <Text style={[styles.filterLabel, { color: active ? color : theme.textMuted }]}>
                {label}
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

      <View style={[styles.section, { borderColor: theme.border }]}>
        <View style={styles.panelHeading}>
          <View style={styles.smallIcon}>
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
              {selectionTitle(selectedTypes, language)}
            </Text>
            <Text style={[styles.panelCaption, { color: theme.textMuted }]}>
              {t('insights.panelCaption', { range: rangeLabel, count: visibleEventCount })}
            </Text>
          </View>
        </View>

        <View
          style={[
            styles.zoomPanel,
            { borderColor: theme.border },
          ]}
        >
          <View style={styles.zoomControls}>
            <ZoomControl
              label={t('insights.timeWidth')}
              value={`${Math.round(horizontalZoomLevels[horizontalZoom] * 100)}%`}
              canDecrease={horizontalZoom > 0}
              canIncrease={horizontalZoom < horizontalZoomLevels.length - 1}
              onDecrease={() => setHorizontalZoom((value) => Math.max(0, value - 1))}
              onIncrease={() => setHorizontalZoom((value) => Math.min(horizontalZoomLevels.length - 1, value + 1))}
              theme={theme}
            />
            <ZoomControl
              label={t('insights.dayHeight')}
              value={t('time.days', { count: timelineDays })}
              canDecrease={verticalZoom > 0}
              canIncrease={verticalZoom < verticalZoomLevels.length - 1}
              onDecrease={() => setVerticalZoom((value) => Math.max(0, value - 1))}
              onIncrease={() => setVerticalZoom((value) => Math.min(verticalZoomLevels.length - 1, value + 1))}
              theme={theme}
            />
          </View>
        </View>

        <View style={styles.rangeNavigator}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('insights.showEarlier')}
            accessibilityState={{ disabled: currentHistoryOffset >= maxHistoryOffset }}
            disabled={currentHistoryOffset >= maxHistoryOffset}
            onPress={() => setHistoryOffset(Math.min(maxHistoryOffset, currentHistoryOffset + timelineDays))}
            style={({ pressed }) => [
              styles.rangeButton,
              {
                backgroundColor: pressed ? theme.primarySoft : 'transparent',
                opacity: currentHistoryOffset >= maxHistoryOffset ? 0.35 : pressed ? 0.7 : 1,
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
            <Text style={[styles.rangeButtonText, { color: theme.text }]}>{t('insights.earlier')}</Text>
          </Pressable>
          <View style={styles.rangeCopy}>
            <Text style={[styles.rangeLabel, { color: theme.text }]}>{rangeLabel}</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('insights.showNewer')}
            accessibilityState={{ disabled: currentHistoryOffset === 0 }}
            disabled={currentHistoryOffset === 0}
            onPress={() => setHistoryOffset(Math.max(0, currentHistoryOffset - timelineDays))}
            style={({ pressed }) => [
              styles.rangeButton,
              {
                backgroundColor: pressed ? theme.primarySoft : 'transparent',
                opacity: currentHistoryOffset === 0 ? 0.35 : pressed ? 0.7 : 1,
              },
            ]}
          >
            <Text style={[styles.rangeButtonText, { color: theme.text }]}>{t('insights.newer')}</Text>
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
                currentTime={day.key === todayKey ? now : undefined}
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
                  currentTime={day.key === todayKey ? now : undefined}
                  rowHeight={rowHeight}
                  gridHours={gridHours}
                  theme={theme}
                />
              ))}
            </View>
          </ScrollView>
        </View>

        {selectedTypes.length === 0 || visibleEventCount === 0 ? (
          <View
            style={[
              styles.emptyNote,
              { backgroundColor: theme.surface, borderRadius: theme.presentation.controlRadius },
            ]}
          >
            <MaterialCommunityIcons
              accessibilityElementsHidden
              importantForAccessibility="no"
              name="clock-outline"
              size={19}
              color={theme.textMuted}
            />
            <Text style={[styles.emptyText, { color: theme.textMuted }]}>
              {selectedTypes.length === 0
                ? t('insights.chooseActivity')
                : t('insights.noRangeLogs', { activity: filterName(selectedTypes, language) })}
            </Text>
          </View>
        ) : null}
      </View>

      {selectedTypes.length > 0 && monthly.length > 1 ? (
        <View style={[styles.section, { borderColor: theme.border }]}>
          <View style={styles.panelHeading}>
            <View style={styles.smallIcon}>
              <MaterialCommunityIcons
                accessibilityElementsHidden
                importantForAccessibility="no"
                name="calendar-range-outline"
                size={21}
                color={theme.primary}
              />
            </View>
            <View style={styles.panelHeadingCopy}>
              <Text style={[styles.panelTitle, { color: theme.text }]}>{t('insights.historyTitle')}</Text>
              <Text style={[styles.panelCaption, { color: theme.textMuted }]}>
                {t('insights.historyCaption', {
                  selection: selectionTitle(selectedTypes, language),
                  count: timelineDays,
                })}
              </Text>
            </View>
          </View>
          <View style={styles.months}>
            {visibleMonths.map((stat) => (
              <MonthlyRow
                key={stat.key}
                stat={stat}
                maxAverage={maxMonthlyAverage}
                activityLabel={filterName(selectedTypes, language)}
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
                {
                  backgroundColor: pressed ? theme.primarySoft : 'transparent',
                },
              ]}
            >
              <Text style={[styles.historyToggleText, { color: theme.primary }]}>
                {showAllMonths
                  ? t('insights.showRecentMonths')
                  : t('insights.showAllMonths', { count: monthly.length })}
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

      <View style={[styles.section, styles.exportSection, { borderColor: theme.border }]}>
        <Text style={[styles.exportNote, { color: theme.textMuted }]}>
          {t('insights.dataBody')}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t(events.length ? 'insights.exportA11y' : 'insights.noExport')}
          accessibilityHint={events.length ? t('insights.exportHint') : undefined}
          accessibilityState={{ busy: exporting, disabled: exportDisabled }}
          disabled={exportDisabled}
          onPress={exportActivity}
          style={({ pressed }) => [
            styles.exportButton,
            {
              backgroundColor: theme.primary,
              borderRadius: theme.presentation.controlRadius,
              opacity: exportDisabled ? 0.45 : pressed ? 0.82 : 1,
            },
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
            {t(exporting
              ? 'insights.preparingExport'
              : events.length
                ? 'insights.exportButton'
                : 'insights.noExport')}
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
  title: { fontSize: 30, lineHeight: 36, fontWeight: '800', letterSpacing: -0.6, marginTop: 4 },
  section: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: spacing.md },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  filterChip: {
    minHeight: 48,
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  filterLabel: { fontSize: 13, lineHeight: 18, fontWeight: '700' },
  frequencyHeading: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 4 },
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
  panelHeading: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 4, marginBottom: spacing.sm },
  panelHeadingCopy: { flex: 1, minWidth: 0 },
  smallIcon: { width: 28, height: 40, alignItems: 'center', justifyContent: 'center' },
  panelTitle: { fontSize: 18, lineHeight: 23, fontWeight: '700' },
  panelCaption: { fontSize: 12, lineHeight: 17, marginTop: 1 },
  zoomPanel: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 8,
    gap: 7,
  },
  zoomControls: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  zoomControl: { flex: 1, minWidth: 145, paddingHorizontal: 4, paddingVertical: 2 },
  controlLabel: { fontSize: 9, lineHeight: 13, fontWeight: '800', letterSpacing: 0.7, marginBottom: 4 },
  stepper: { flexDirection: 'row', alignItems: 'center' },
  zoomButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoomValue: { flex: 1, minWidth: 42, fontSize: 12, lineHeight: 17, fontWeight: '800', textAlign: 'center', fontVariant: ['tabular-nums'] },
  rangeNavigator: { flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 12 },
  rangeButton: {
    minHeight: 48,
    borderRadius: 24,
    paddingHorizontal: 7,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rangeButtonText: { fontSize: 12, lineHeight: 17, fontWeight: '700' },
  rangeCopy: { flex: 1, minWidth: 0, alignItems: 'center' },
  rangeLabel: { fontSize: 11, lineHeight: 15, fontWeight: '700', textAlign: 'center', fontVariant: ['tabular-nums'] },
  chart: { flexDirection: 'row', alignItems: 'flex-start' },
  dateColumn: { width: DATE_COLUMN_WIDTH, flexShrink: 0 },
  axisSpacer: { height: 22 },
  dateCell: {
    justifyContent: 'center',
    paddingRight: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
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
    borderBottomWidth: StyleSheet.hairlineWidth,
    position: 'relative',
    overflow: 'hidden',
  },
  gridLine: { position: 'absolute', top: 0, bottom: 0, width: StyleSheet.hairlineWidth },
  pointMark: {
    position: 'absolute',
    top: 2,
    bottom: 2,
    width: 6,
    marginLeft: -3,
    borderRadius: 3,
    zIndex: 2,
  },
  durationMark: {
    position: 'absolute',
    top: 2,
    bottom: 2,
    minWidth: 3,
    borderRadius: 3,
    zIndex: 1,
  },
  currentTimeMarker: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 4,
    marginLeft: -2,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    zIndex: 3,
  },
  currentTimeMarkerHead: {
    position: 'absolute',
    top: 3,
    left: -2,
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 2,
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
  months: { marginTop: 4 },
  monthRow: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 8, paddingVertical: 11 },
  monthHeading: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  monthName: { flex: 1, fontSize: 14, lineHeight: 19, fontWeight: '700' },
  monthAverage: { fontSize: 15, lineHeight: 20, fontWeight: '800', fontVariant: ['tabular-nums'] },
  monthTrack: { height: 7, borderRadius: 4, overflow: 'hidden', marginTop: 7 },
  monthBar: { height: 7, borderRadius: 4 },
  monthDetail: { fontSize: 11, lineHeight: 16, marginTop: 5 },
  historyToggle: {
    minHeight: 48,
    borderRadius: 24,
    paddingHorizontal: 14,
    marginTop: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  historyToggleText: { fontSize: 14, lineHeight: 19, fontWeight: '700' },
  exportSection: { gap: spacing.md },
  exportNote: { fontSize: 12, lineHeight: 17 },
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

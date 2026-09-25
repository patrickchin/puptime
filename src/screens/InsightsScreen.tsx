import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  activityFrequencyStats,
  estimateMissingLogs,
  monthlyActivityStats,
  type ActivityFrequencyStat,
  type MissingLogEstimate,
  type MonthlyActivityStat,
} from '../analytics';
import {
  dateKey,
  formatDuration,
  formatTime,
  type PuppyEvent,
} from '../domain';
import { ActivityIcon } from '../components/ActivityIcon';
import { useLocalization } from '../localization-context';
import { shareEventsCsv } from '../share-export';
import { spacing, type Theme } from '../theme';

const FREQUENCY_DAYS = 10;
const MISSING_LOG_DAYS = 14;
const MONTH_PREVIEW_COUNT = 6;

function durationFromMinutes(minutes?: number): string {
  return minutes === undefined ? '—' : formatDuration(minutes * 60_000);
}

function FrequencyRow({ stat, theme }: { stat: ActivityFrequencyStat; theme: Theme }) {
  const { activityColors, activityLabel, t } = useLocalization();
  const activity = { type: stat.type, customLabel: stat.customLabel };
  const label = activityLabel(activity);
  const { color, softColor } = activityColors(theme, activity);
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
      testID={`insights.frequency.${stat.customLabel ?? stat.type}`}
      accessible
      accessibilityLabel={`${label}. ${dailyValue}, ${dailyDetail}. ${t('insights.typicalGap')} ${intervalValue}. ${intervalDetail}.`}
      style={[styles.frequencyRow, { borderColor: theme.border }]}
    >
      <View style={styles.activityHeading}>
        <View
          style={[
            styles.activityIcon,
            {
              backgroundColor: softColor,
              borderRadius: theme.presentation.iconRadius,
            },
          ]}
        >
          <ActivityIcon activity={activity} theme={theme} color={color} size={20} />
        </View>
        <Text style={[styles.activityName, { color: theme.text }]}>{label}</Text>
        <Text testID={`insights.frequency.${stat.customLabel ?? stat.type}.count`} style={[styles.logCount, { color: theme.textMuted }]}>
          {t('insights.logCount', { count: stat.total })}
        </Text>
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

function MonthlyRow({
  stat,
  maxAverage,
  isCurrent,
  color,
  theme,
}: {
  stat: MonthlyActivityStat;
  maxAverage: number;
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
        activity: t('insights.activity'),
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
  customActivities,
  onAddEstimate,
  theme,
}: {
  events: PuppyEvent[];
  customActivities: string[];
  onAddEstimate: (estimate: MissingLogEstimate) => Promise<void>;
  theme: Theme;
}) {
  const { activityColors, activityLabel, language, t } = useLocalization();
  const [exporting, setExporting] = useState(false);
  const [showAllMonths, setShowAllMonths] = useState(false);
  const [addingEstimateId, setAddingEstimateId] = useState<string | null>(null);
  const now = new Date();
  const frequency = activityFrequencyStats(events, ['pee', 'poop', ...customActivities.map((customLabel) => ({ type: 'custom' as const, customLabel }))], FREQUENCY_DAYS, now);
  const missingLogs = estimateMissingLogs(events, MISSING_LOG_DAYS, now);
  const monthly = useMemo(() => monthlyActivityStats(events), [events]);
  const visibleMonths = showAllMonths ? monthly : monthly.slice(0, MONTH_PREVIEW_COUNT);
  const maxMonthlyAverage = Math.max(1, ...monthly.map((stat) => stat.averagePerRecordedDay));
  const currentMonthKey = dateKey(now).slice(0, 7);
  const exportDisabled = exporting || events.length === 0;

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
    <ScrollView testID="screen.insights" contentContainerStyle={styles.content}>
      <Text
        numberOfLines={1}
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
        <View style={styles.sectionHeading}>
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
            <Text
              adjustsFontSizeToFit
              minimumFontScale={0.85}
              numberOfLines={1}
              style={[styles.panelCaption, { color: theme.textMuted }]}
            >
              {t('insights.frequencyCaption', {
                period: frequency.periodDays,
                recorded: frequency.recordedDays,
              })}
            </Text>
          </View>
        </View>
        <View>
          {frequency.stats.map((stat) => <FrequencyRow key={stat.customLabel ?? stat.type} stat={stat} theme={theme} />)}
        </View>
      </View>

      <View style={[styles.section, { borderColor: theme.border }]}>
        <View style={styles.sectionHeading}>
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
          </View>
        </View>
        {missingLogs.estimates.length ? (
          <View style={styles.estimateList}>
            {missingLogs.estimates.map((estimate) => {
              const activityName = activityLabel(estimate);
              const { color, softColor } = activityColors(theme, estimate);
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
                <View key={estimate.id} style={[styles.estimateRow, { borderColor: theme.border }]}>
                  <View
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                    style={[
                      styles.estimateIcon,
                      { backgroundColor: softColor, borderRadius: theme.presentation.iconRadius },
                    ]}
                  >
                    <ActivityIcon activity={estimate} theme={theme} color={color} size={20} />
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
                    <Text style={[styles.estimateEvidence, { color: theme.textMuted }]}>{evidence}</Text>
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
                    <View style={styles.addEstimateIcon}>
                      {adding ? (
                        <ActivityIndicator color={theme.onPrimary} size="small" />
                      ) : (
                        <MaterialCommunityIcons name="plus" size={19} color={theme.onPrimary} />
                      )}
                    </View>
                    <Text style={[styles.addEstimateText, { color: theme.onPrimary }]}>
                      {t('insights.addLog')}
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

      {monthly.length > 1 ? (
        <View style={[styles.section, { borderColor: theme.border }]}>
          <View style={styles.sectionHeading}>
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
            </View>
          </View>
          <View style={styles.months}>
            {visibleMonths.map((stat) => (
              <MonthlyRow
                key={stat.key}
                stat={stat}
                maxAverage={maxMonthlyAverage}
                isCurrent={stat.key === currentMonthKey}
                color={theme.primary}
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
                { backgroundColor: pressed ? theme.primarySoft : 'transparent' },
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

      <View style={[styles.section, { borderColor: theme.border }]}>
        <Pressable
          testID="insights.export"
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
            <MaterialCommunityIcons name="share-variant-outline" size={20} color={theme.onPrimary} />
          )}
          <Text style={[styles.exportButtonText, { color: theme.onPrimary }]}>
            {t(events.length ? 'insights.exportButton' : 'insights.noExport')}
          </Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    width: '100%',
    maxWidth: 760,
    alignSelf: 'center',
    padding: spacing.md,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  title: { fontSize: 30, lineHeight: 36, fontWeight: '800', letterSpacing: -0.6, marginTop: -8 },
  section: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: spacing.md },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 4 },
  panelHeadingCopy: { flex: 1, minWidth: 0 },
  smallIcon: { width: 28, height: 40, alignItems: 'center', justifyContent: 'center' },
  panelTitle: { fontSize: 18, lineHeight: 23, fontWeight: '700' },
  panelCaption: { fontSize: 12, lineHeight: 17, marginTop: 1 },
  frequencyRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 4,
    paddingTop: 13,
    paddingBottom: 11,
    marginTop: 12,
  },
  activityHeading: { flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 11 },
  activityIcon: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  activityName: { flex: 1, fontSize: 16, lineHeight: 21, fontWeight: '800' },
  logCount: { fontSize: 12, lineHeight: 17, fontWeight: '600' },
  metrics: { flexDirection: 'row', alignItems: 'stretch' },
  metric: { flex: 1, minWidth: 0, paddingHorizontal: 6 },
  metricDivider: { width: StyleSheet.hairlineWidth, marginHorizontal: 6 },
  metricValue: { fontSize: 21, lineHeight: 27, fontWeight: '800', fontVariant: ['tabular-nums'] },
  metricLabel: { fontSize: 9, lineHeight: 13, fontWeight: '800', letterSpacing: 0.8, marginTop: 2 },
  metricDetail: { fontSize: 11, lineHeight: 16, marginTop: 4 },
  estimateList: { marginTop: 12 },
  estimateRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 4,
    paddingTop: 13,
    paddingBottom: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  estimateIcon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  questionBadge: {
    position: 'absolute',
    right: -3,
    bottom: -3,
    width: 17,
    height: 17,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  questionMark: { fontSize: 10, lineHeight: 12, fontWeight: '900' },
  estimateCopy: { flex: 1, minWidth: 0 },
  estimateTitle: { fontSize: 14, lineHeight: 19, fontWeight: '800' },
  estimateTime: { fontSize: 12, lineHeight: 17, fontWeight: '700', marginTop: 1 },
  estimateEvidence: { fontSize: 11, lineHeight: 16, marginTop: 2 },
  addEstimateButton: {
    minWidth: 86,
    minHeight: 48,
    paddingHorizontal: 11,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  addEstimateIcon: { width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
  addEstimateText: { fontSize: 12, lineHeight: 16, fontWeight: '800' },
  noEstimate: {
    minHeight: 48,
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: 12,
    paddingHorizontal: 4,
    paddingTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  noEstimateText: { flex: 1, fontSize: 12, lineHeight: 17 },
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
  exportButton: {
    minHeight: 52,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  exportButtonText: { fontSize: 15, lineHeight: 20, fontWeight: '700', textAlign: 'center' },
});

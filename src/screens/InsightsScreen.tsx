import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useEffect,useMemo, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Pressable } from '../components/TelemetryPressable';

import {
  activityFrequencyStats,
  monthlyActivityStats,
  type ActivityFrequencyStat,
  type MonthlyActivityStat,
} from '../analytics';
import {
  dateKey,
  formatDuration,
  type PuppyEvent,
} from '../domain';
import { ActivityIcon } from '../components/ActivityIcon';
import {ActivityLoadState} from '../components/ActivityLoadState';
import {activityWindowBounds,useActivityWindow,type ActivityViewProps} from '../activity-view';
import { useLocalization } from '../localization-context';
import { surfaceTreatment, spacing, type Theme } from '../theme';

const FREQUENCY_DAYS = 10;
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
      accessibilityLabel={`${label}. ${dailyValue}, ${dailyDetail}. ${t('insights.typicalGap')} ${intervalValue}. ${intervalDetail}.${stat.estimatedTotal ? ` ${t('insights.estimatedCount', { count: stat.estimatedTotal })}.` : ''}`}
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
          {stat.estimatedTotal
            ? `${t('insights.recordedCount', { count: stat.total })}\n${t('insights.estimatedCount', { count: stat.estimatedTotal })}`
            : t('insights.logCount', { count: stat.total })}
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
      }) + (stat.estimatedTotal ? ` ${t('insights.estimatedCount', { count: stat.estimatedTotal })}.` : '')}
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
        {stat.estimatedTotal ? ` · ${t('insights.estimatedCount', { count: stat.estimatedTotal })}` : ''}
      </Text>
    </View>
  );
}

export function InsightsScreen({
  events:projectedEvents,
  activity,
  refreshToken,
  customActivities,
  showHeader=true,
  theme,
}: {
  events: PuppyEvent[];
  customActivities: string[];
  showHeader?: boolean;
  theme: Theme;
}&ActivityViewProps) {
  const { activityColors, activityLabel, language, t } = useLocalization();
  const [showAllMonths, setShowAllMonths] = useState(false);
  const now = new Date();
  const bounds=activityWindowBounds(now.getTime(),FREQUENCY_DAYS-1);
  const window=useActivityWindow(activity,projectedEvents,bounds.from,bounds.until,refreshToken);
  const events=window.events;
  const [savedMonths,setSavedMonths]=useState<MonthlyActivityStat[]>([]);
  const [monthError,setMonthError]=useState(false),[monthLoading,setMonthLoading]=useState(!!activity),[monthAttempt,setMonthAttempt]=useState(0);
  useEffect(()=>{
    if(!activity)return;let current=true;setMonthError(false);setMonthLoading(true);
    void activity.monthlyStats().then(value=>{if(current){setSavedMonths(value);setMonthLoading(false);}}).catch(()=>{if(current){setMonthError(true);setMonthLoading(false);}});
    return()=>{current=false;};
  },[activity,refreshToken,monthAttempt]);
  const frequency = activityFrequencyStats(events, ['pee', 'poop', ...customActivities.map((customLabel) => ({ type: 'custom' as const, customLabel }))], FREQUENCY_DAYS, now);
  const monthly = useMemo(() => activity?savedMonths:monthlyActivityStats(events), [activity,savedMonths,events]);
  const visibleMonths = showAllMonths ? monthly : monthly.slice(0, MONTH_PREVIEW_COUNT);
  const maxMonthlyAverage = Math.max(1, ...monthly.map((stat) => stat.averagePerRecordedDay));
  const currentMonthKey = dateKey(now).slice(0, 7);
  return (
    <ScrollView testID="screen.insights" contentContainerStyle={styles.content}>
      <ActivityLoadState loading={window.loading||monthLoading} error={window.error||monthError} onRetry={()=>{window.retry();setMonthAttempt(value=>value+1);}} theme={theme}/>
      {showHeader?<Text
        accessibilityRole="header"
        numberOfLines={1}
        style={[
          styles.title,
          {
            color: theme.onCanvas,
            fontSize: theme.presentation.titleSize,
            lineHeight: theme.presentation.titleLineHeight,
            fontWeight: theme.presentation.titleWeight,
            fontFamily: theme.presentation.headingFont,
            letterSpacing: theme.presentation.titleTracking,
          },
        ]}
      >
        {t('insights.title')}
      </Text>:null}

      <View style={[styles.section, surfaceTreatment(theme), { backgroundColor: theme.surfaceRaised, borderColor: theme.border, padding: theme.presentation.cardPadding }]}>
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

      {monthly.length > 1 ? (
        <View style={[styles.section, surfaceTreatment(theme), { backgroundColor: theme.surfaceRaised, borderColor: theme.border, padding: theme.presentation.cardPadding }]}>
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
  logCount: { fontSize: 12, lineHeight: 17, fontWeight: '600', textAlign: 'right' },
  metrics: { flexDirection: 'row', alignItems: 'stretch' },
  metric: { flex: 1, minWidth: 0, paddingHorizontal: 6 },
  metricDivider: { width: StyleSheet.hairlineWidth, marginHorizontal: 6 },
  metricValue: { fontSize: 21, lineHeight: 27, fontWeight: '800', fontVariant: ['tabular-nums'] },
  metricLabel: { fontSize: 9, lineHeight: 13, fontWeight: '800', letterSpacing: 0.8, marginTop: 2 },
  metricDetail: { fontSize: 11, lineHeight: 16, marginTop: 4 },
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
});

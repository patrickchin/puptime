import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { summarizeDays } from '../analytics';
import { dateKey, EVENT_META, eventTypes, formatDuration, type PuppyEvent, type ScheduleEntry } from '../domain';
import { shareEventsCsv } from '../share-export';
import { spacing, type Theme } from '../theme';

export function InsightsScreen({
  events,
  schedule,
  theme,
}: {
  events: PuppyEvent[];
  schedule: ScheduleEntry[];
  theme: Theme;
}) {
  const [exporting, setExporting] = useState(false);
  const days = summarizeDays(events, schedule);
  const maxTotal = Math.max(1, ...days.map((day) => day.total));
  const maxNapMinutes = Math.max(1, ...days.map((day) => day.napMinutes));
  const weekEvents = days.reduce((sum, day) => sum + day.total, 0);
  const scoredDays = days.filter((day) => day.adherence !== null);
  const averageScore = scoredDays.length
    ? Math.round(scoredDays.reduce((sum, day) => sum + (day.adherence ?? 0), 0) / scoredDays.length)
    : null;
  const pottyResults = days.reduce((sum, day) => sum + day.counts.pee + day.counts.poop, 0);
  const napTime = days.reduce((sum, day) => sum + day.napMinutes, 0);
  const todayKey = dateKey(Date.now());
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
      <Text style={[styles.eyebrow, { color: theme.primary }]}>LAST 7 DAYS</Text>
      <Text style={[styles.title, { color: theme.text }]}>Your puppy’s rhythm</Text>
      <Text style={[styles.subtitle, { color: theme.textMuted }]}>Patterns get clearer as you keep logging.</Text>

      <View style={styles.summaryRow}>
        <View style={[styles.summaryCard, { backgroundColor: theme.surfaceRaised, borderColor: theme.border }]}>
          <Text style={[styles.summaryNumber, { color: theme.text }]}>{weekEvents}</Text>
          <Text style={[styles.summaryLabel, { color: theme.textMuted }]}>events logged</Text>
        </View>
        <View style={[styles.summaryCard, { backgroundColor: theme.surfaceRaised, borderColor: theme.border }]}>
          <Text style={[styles.summaryNumber, { color: theme.text }]}>{averageScore === null ? '—' : `${averageScore}%`}</Text>
          <Text style={[styles.summaryLabel, { color: theme.textMuted }]}>on schedule</Text>
        </View>
      </View>

      <View style={[styles.insightCard, { backgroundColor: theme.primarySoft }]}>
        <View style={[styles.insightIcon, { backgroundColor: theme.surfaceRaised }]}>
          <MaterialCommunityIcons name="lightbulb-on-outline" size={21} color={theme.primary} />
        </View>
        <View style={styles.insightCopy}>
          <Text style={[styles.insightTitle, { color: theme.text }]}>
            {weekEvents ? 'This week is taking shape' : 'Your first pattern starts with one tap'}
          </Text>
          <Text style={[styles.insightBody, { color: theme.textMuted }]}>
            {weekEvents
              ? `${pottyResults} potty ${pottyResults === 1 ? 'result' : 'results'} and ${formatDuration(napTime * 60_000)} of nap time logged. Routine scores use only schedule windows that have finished.`
              : 'Log a few activities and Puptime will turn them into daily comparisons here.'}
          </Text>
        </View>
      </View>

      <View style={[styles.panel, { backgroundColor: theme.surfaceRaised, borderColor: theme.border }]}>
        <View style={styles.panelHeading}>
          <View style={[styles.smallIcon, { backgroundColor: EVENT_META.nap.softColor }]}>
            <MaterialCommunityIcons name="sleep" size={20} color={EVENT_META.nap.color} />
          </View>
          <View>
            <Text style={[styles.panelTitle, { color: theme.text }]}>Nap time</Text>
            <Text style={[styles.panelCaption, { color: theme.textMuted }]}>Completed and currently running naps</Text>
          </View>
        </View>
        <View style={styles.napChart}>
          {days.map((day) => (
            <View
              key={day.key}
              accessible
              accessibilityLabel={`${new Intl.DateTimeFormat(undefined, { weekday: 'long' }).format(day.date)}: ${formatDuration(day.napMinutes * 60_000)} of nap time`}
              style={styles.napBarColumn}
            >
              <Text style={[styles.barValue, { color: theme.textMuted }]}>
                {day.napMinutes ? formatDuration(day.napMinutes * 60_000) : ''}
              </Text>
              <View style={[styles.napBarTrack, { backgroundColor: EVENT_META.nap.softColor }]}>
                <View
                  style={{
                    height: day.napMinutes ? Math.max(4, (day.napMinutes / maxNapMinutes) * 88) : 0,
                    backgroundColor: EVENT_META.nap.color,
                  }}
                />
              </View>
              <Text style={[styles.dayLabel, { color: day.key === todayKey ? theme.primary : theme.textMuted }]}>
                {new Intl.DateTimeFormat(undefined, { weekday: 'narrow' }).format(day.date)}
              </Text>
            </View>
          ))}
        </View>
      </View>

      <View style={[styles.panel, { backgroundColor: theme.surfaceRaised, borderColor: theme.border }]}>
        <View style={styles.panelHeading}>
          <View style={[styles.smallIcon, { backgroundColor: theme.primarySoft }]}>
            <MaterialCommunityIcons name="chart-timeline-variant" size={20} color={theme.primary} />
          </View>
          <View>
            <Text style={[styles.panelTitle, { color: theme.text }]}>Daily activity</Text>
            <Text style={[styles.panelCaption, { color: theme.textMuted }]}>All logged events</Text>
          </View>
        </View>
        <View style={styles.chart}>
          {days.map((day) => (
            <View
              key={day.key}
              accessible
              accessibilityLabel={`${new Intl.DateTimeFormat(undefined, { weekday: 'long' }).format(day.date)}: ${day.total} activities logged`}
              style={styles.barColumn}
            >
              <Text style={[styles.barValue, { color: theme.textMuted }]}>{day.total || ''}</Text>
              <View style={[styles.barTrack, { backgroundColor: theme.primarySoft }]}>
                <View style={styles.barStack}>
                  {[...eventTypes].reverse().map((type) => {
                    const count = day.counts[type];
                    return count > 0 ? (
                      <View
                        key={type}
                        style={{ height: Math.max(4, (count / maxTotal) * 112), backgroundColor: EVENT_META[type].color }}
                      />
                    ) : null;
                  })}
                </View>
              </View>
              <Text style={[styles.dayLabel, { color: day.key === todayKey ? theme.primary : theme.textMuted }]}>
                {new Intl.DateTimeFormat(undefined, { weekday: 'narrow' }).format(day.date)}
              </Text>
            </View>
          ))}
        </View>
        <View style={styles.legend}>
          {eventTypes.map((type) => (
            <View key={type} style={styles.legendItem}>
              <View style={[styles.dot, { backgroundColor: EVENT_META[type].color }]} />
              <Text style={[styles.legendLabel, { color: theme.textMuted }]}>{EVENT_META[type].label}</Text>
            </View>
          ))}
        </View>
      </View>

      <View style={[styles.panel, { backgroundColor: theme.surfaceRaised, borderColor: theme.border }]}>
        <Text style={[styles.panelTitle, { color: theme.text }]}>Schedule consistency</Text>
        <Text style={[styles.panelCaption, { color: theme.textMuted }]}>Completed windows, within 30 minutes of each planned time</Text>
        <View style={styles.scoreList}>
          {days.map((day) => (
            <View
              key={day.key}
              accessible
              accessibilityLabel={`${new Intl.DateTimeFormat(undefined, { weekday: 'long' }).format(day.date)}: ${day.adherence === null ? 'no finished schedule windows' : `${day.adherence} percent on schedule`}`}
              style={styles.scoreRow}
            >
              <Text style={[styles.scoreDay, { color: theme.textMuted }]}>
                {new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(day.date)}
              </Text>
              <View style={[styles.scoreTrack, { backgroundColor: theme.primarySoft }]}>
                <View
                  style={[
                    styles.scoreFill,
                    { backgroundColor: theme.primary, width: `${day.adherence ?? 0}%` },
                  ]}
                />
              </View>
              <Text style={[styles.scoreValue, { color: theme.text }]}>
                {day.adherence === null ? '—' : `${day.adherence}%`}
              </Text>
            </View>
          ))}
        </View>
      </View>

      <View style={styles.typeGrid}>
        {eventTypes.map((type) => {
          const total = days.reduce((sum, day) => sum + day.counts[type], 0);
          const meta = EVENT_META[type];
          const value = type === 'nap'
            ? formatDuration(days.reduce((sum, day) => sum + day.napMinutes, 0) * 60_000)
            : total;
          return (
            <View key={type} style={[styles.typeCard, { backgroundColor: meta.softColor }]}>
              <MaterialCommunityIcons
                name={meta.icon as keyof typeof MaterialCommunityIcons.glyphMap}
                size={22}
                color={meta.color}
              />
              <Text style={[styles.typeNumber, { color: meta.color }]}>{value}</Text>
              <Text style={[styles.typeLabel, { color: meta.color }]}>{type === 'nap' ? 'nap time this week' : `${meta.label} this week`}</Text>
            </View>
          );
        })}
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
            <Text style={[styles.panelCaption, { color: theme.textMuted }]}>Share every log as a spreadsheet-ready CSV. Nothing leaves this device until you choose where to send it.</Text>
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
  eyebrow: { fontSize: 11, fontWeight: '800', letterSpacing: 1.6, marginTop: 4 },
  title: { fontSize: 30, lineHeight: 36, fontWeight: '800', letterSpacing: -0.6, marginTop: -8 },
  subtitle: { fontSize: 15, lineHeight: 22, marginTop: -10 },
  summaryRow: { flexDirection: 'row', gap: spacing.sm },
  summaryCard: { flex: 1, minHeight: 104, borderWidth: 1, borderRadius: 20, padding: spacing.md, justifyContent: 'center' },
  summaryNumber: { fontSize: 28, lineHeight: 34, fontWeight: '800', fontVariant: ['tabular-nums'] },
  summaryLabel: { fontSize: 13, marginTop: 2 },
  insightCard: { borderRadius: 20, padding: spacing.md, flexDirection: 'row', alignItems: 'flex-start', gap: 11 },
  insightIcon: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  insightCopy: { flex: 1, minWidth: 0 },
  insightTitle: { fontSize: 15, lineHeight: 20, fontWeight: '700' },
  insightBody: { fontSize: 12, lineHeight: 18, marginTop: 2 },
  panel: { borderWidth: 1, borderRadius: 22, padding: spacing.md },
  panelHeading: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: spacing.sm },
  smallIcon: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  panelTitle: { fontSize: 18, fontWeight: '700' },
  panelCaption: { fontSize: 12, lineHeight: 17, marginTop: 1 },
  chart: { height: 158, flexDirection: 'row', alignItems: 'flex-end', gap: 7, marginTop: 10 },
  napChart: { height: 134, flexDirection: 'row', alignItems: 'flex-end', gap: 7, marginTop: 10 },
  barColumn: { flex: 1, height: 158, alignItems: 'center', justifyContent: 'flex-end' },
  napBarColumn: { flex: 1, height: 134, alignItems: 'center', justifyContent: 'flex-end' },
  barValue: { height: 20, fontSize: 11, fontWeight: '600', fontVariant: ['tabular-nums'] },
  barTrack: { width: '72%', height: 112, borderRadius: 7, overflow: 'hidden', justifyContent: 'flex-end' },
  napBarTrack: { width: '72%', height: 88, borderRadius: 7, overflow: 'hidden', justifyContent: 'flex-end' },
  barStack: { width: '100%', justifyContent: 'flex-end' },
  dayLabel: { height: 22, fontSize: 12, fontWeight: '700', marginTop: 4 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'center', marginTop: 8 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  legendLabel: { fontSize: 12, fontWeight: '600' },
  scoreList: { gap: 12, marginTop: spacing.md },
  scoreRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  scoreDay: { width: 34, fontSize: 12, fontWeight: '700' },
  scoreTrack: { flex: 1, height: 10, borderRadius: 5, overflow: 'hidden' },
  scoreFill: { height: 10, borderRadius: 5 },
  scoreValue: { width: 40, textAlign: 'right', fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },
  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  typeCard: { minWidth: 148, flexBasis: '48%', flexGrow: 1, borderRadius: 18, padding: spacing.md },
  typeNumber: { fontSize: 24, fontWeight: '800', marginTop: 7 },
  typeLabel: { fontSize: 12, fontWeight: '600', marginTop: 1 },
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

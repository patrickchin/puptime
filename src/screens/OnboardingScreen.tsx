import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { EVENT_META } from '../domain';
import { useLocalization } from '../localization-context';
import type { NotificationPermissionState } from '../reminders';
import { spacing, type Theme } from '../theme';

type IconName = keyof typeof MaterialCommunityIcons.glyphMap;

export function OnboardingScreen({
  theme,
  notificationPermission,
  onAllowNotifications,
  onOpenSystemSettings,
  onFinish,
}: {
  theme: Theme;
  notificationPermission: NotificationPermissionState;
  onAllowNotifications: () => Promise<boolean>;
  onOpenSystemSettings: () => void;
  onFinish: () => Promise<void>;
}) {
  const { t } = useLocalization();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);

  const finish = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onFinish();
    } finally {
      setBusy(false);
    }
  };

  const primaryAction = async () => {
    if (step < 3) {
      setStep(step + 1);
      return;
    }
    if (notificationPermission === 'blocked') {
      onOpenSystemSettings();
      return;
    }
    if (notificationPermission !== 'granted') {
      setBusy(true);
      try {
        await onAllowNotifications();
      } catch {
        // The guide can finish even if the native request fails.
      } finally {
        setBusy(false);
      }
    }
    await finish();
  };

  const headings = [
    ['onboarding.logTitle', 'onboarding.logBody'],
    ['onboarding.timelineTitle', 'onboarding.timelineBody'],
    ['onboarding.routineTitle', 'onboarding.routineBody'],
    ['onboarding.nudgeTitle', 'onboarding.nudgeBody'],
  ] as const;

  const featureRow = (icon: IconName, title: string, detail: string) => (
    <View style={[styles.featureRow, { borderColor: theme.border }]}>
      <View style={[styles.featureIcon, { backgroundColor: theme.primarySoft }]}>
        <MaterialCommunityIcons name={icon} size={21} color={theme.primary} />
      </View>
      <View style={styles.featureCopy}>
        <Text style={[styles.featureTitle, { color: theme.text }]}>{title}</Text>
        <Text style={[styles.featureDetail, { color: theme.textMuted }]}>{detail}</Text>
      </View>
    </View>
  );

  return (
    <View testID="screen.onboarding" style={[styles.root, { backgroundColor: theme.background }]}>
      <View style={styles.topBar}>
        <View style={styles.brand}>
          <MaterialCommunityIcons name="paw" size={19} color={theme.primary} />
          <Text style={[styles.brandText, { color: theme.text }]}>Puptime</Text>
        </View>
        <Pressable
          testID="onboarding.skip"
          accessibilityRole="button"
          disabled={busy}
          onPress={() => void finish()}
          style={styles.skipButton}
        >
          <Text style={[styles.skipText, { color: theme.textMuted }]}>{t('onboarding.skip')}</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View accessible accessibilityRole="text" style={styles.progress} accessibilityLabel={t('onboarding.progress', { step: step + 1 })}>
          {[0, 1, 2, 3].map((index) => (
            <View
              key={index}
              style={[styles.progressBar, { backgroundColor: index <= step ? theme.primary : theme.border }]}
            />
          ))}
        </View>
        <Text testID={`onboarding.step.${step}`} style={[styles.title, { color: theme.text }]}>{t(headings[step][0])}</Text>
        <Text style={[styles.body, { color: theme.textMuted }]}>{t(headings[step][1])}</Text>

        {step === 0 ? (
          <View style={[styles.previewCard, { backgroundColor: theme.surfaceRaised, borderColor: theme.border }]}>
            <Text style={[styles.previewLabel, { color: theme.primary }]}>{t('onboarding.preview')}</Text>
            <Text style={[styles.previewHeading, { color: theme.text }]}>{t('onboarding.todayPreview')}</Text>
            <View style={[styles.timelineLine, { backgroundColor: theme.border }]} />
            {([
              ['food-apple-outline', 'onboarding.mealPreview', '8:00'],
              ['water-outline', 'onboarding.peePreview', '9:35'],
              ['walk', 'onboarding.walkPreview', '11:10'],
            ] as const).map(([icon, label, time]) => (
              <View key={label} style={styles.timelineRow}>
                <View style={[styles.timelineIcon, { backgroundColor: theme.primarySoft, borderColor: theme.surfaceRaised }]}>
                  <MaterialCommunityIcons name={icon} size={21} color={theme.primary} />
                </View>
                <Text style={[styles.timelineText, { color: theme.text }]}>{t(label)}</Text>
                <Text style={[styles.timelineTime, { color: theme.textMuted }]}>{time}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {step === 1 ? (
          <View style={[styles.previewCard, { backgroundColor: theme.surfaceRaised, borderColor: theme.border }]}>
            <Text style={[styles.previewLabel, { color: theme.primary }]}>{t('onboarding.preview')}</Text>
            <Text style={[styles.previewHeading, { color: theme.text }]}>{t('timeline.title')}</Text>
            <View style={styles.clockHeader}>
              <View style={styles.dayLabel} />
              <View style={styles.clockTrack}>
                {['00', '06', '12', '18'].map((hour) => (
                  <Text key={hour} style={[styles.clockHour, { color: theme.textMuted }]}>{hour}</Text>
                ))}
              </View>
            </View>
            {([
              ['onboarding.todayPreview', [['pee', 28], ['meal', 38], ['walk', 69]]],
              ['onboarding.timelineYesterday', [['pee', 25], ['meal', 39], ['nap', 62]]],
              ['onboarding.timelineEarlier', [['pee', 29], ['walk', 70], ['meal', 77]]],
            ] as const).map(([day, marks]) => (
              <View key={day} style={[styles.clockRow, { borderColor: theme.border }]}>
                <Text style={[styles.dayLabel, styles.dayText, { color: theme.text }]} numberOfLines={1}>{t(day)}</Text>
                <View style={[styles.clockTrack, styles.clockGrid, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                  {[25, 50, 75].map((position) => (
                    <View key={position} style={[styles.gridLine, { left: `${position}%`, backgroundColor: theme.border }]} />
                  ))}
                  {marks.map(([type, position]) => (
                    <View
                      key={`${type}-${position}`}
                      style={[styles.clockMark, type === 'nap' && styles.clockDuration, {
                        left: `${position}%`,
                        backgroundColor: theme.isDark ? EVENT_META[type].darkColor : EVENT_META[type].color,
                      }]}
                    />
                  ))}
                </View>
              </View>
            ))}
          </View>
        ) : null}

        {step === 2 ? (
          <View style={[styles.previewCard, { backgroundColor: theme.surfaceRaised, borderColor: theme.border }]}>
            <Text style={[styles.previewLabel, { color: theme.primary }]}>{t('onboarding.preview')}</Text>
            <Text style={[styles.previewHeading, { color: theme.text }]}>{t('onboarding.routinePreview')}</Text>
            {([
              ['8:00', 'onboarding.mealPreview', 'food-apple-outline'],
              ['12:00', 'onboarding.walkPreview', 'walk'],
              ['18:00', 'onboarding.mealPreview', 'food-apple-outline'],
            ] as const).map(([time, label, icon]) => (
              <View key={time} style={[styles.scheduleRow, { borderColor: theme.border }]}>
                <Text style={[styles.scheduleTime, { color: theme.primary }]}>{time}</Text>
                <MaterialCommunityIcons name={icon} size={20} color={theme.primary} />
                <Text style={[styles.scheduleLabel, { color: theme.text }]}>{t(label)}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {step === 3 ? (
          <View style={styles.notificationStack}>
            <View style={[styles.notificationPreview, { backgroundColor: theme.primarySoft }]}>
              <View style={[styles.notificationBadge, { backgroundColor: theme.primary }]}>
                <MaterialCommunityIcons name="bell-outline" size={20} color={theme.onPrimary} />
              </View>
              <View style={styles.featureCopy}>
                <Text style={[styles.featureTitle, { color: theme.text }]}>{t('onboarding.notificationExampleTitle')}</Text>
                <Text style={[styles.featureDetail, { color: theme.textMuted }]}>{t('onboarding.notificationExampleBody')}</Text>
              </View>
            </View>
            {featureRow('calendar-clock-outline', t('settings.routineReminders'), t('onboarding.routineDetail'))}
            {featureRow('widgets-outline', t('settings.widgetConfirmations'), t('onboarding.widgetDetail'))}
            <Text style={[styles.changeLater, { color: theme.textMuted }]}>{t('onboarding.changeLater')}</Text>
          </View>
        ) : null}
      </ScrollView>

      <View style={[styles.footer, { borderColor: theme.border, backgroundColor: theme.background }]}>
        <Pressable
          testID="onboarding.primary"
          accessibilityRole="button"
          disabled={busy}
          onPress={() => void primaryAction()}
          style={({ pressed }) => [
            styles.primaryButton,
            { backgroundColor: pressed ? theme.primaryPressed : theme.primary, opacity: busy ? 0.6 : 1 },
          ]}
        >
          <Text style={[styles.primaryText, { color: theme.onPrimary }]}>
            {step < 3
              ? t('onboarding.continue')
              : notificationPermission === 'granted'
                ? t('onboarding.start')
                : notificationPermission === 'blocked'
                  ? t('schedule.openSettings')
                  : t('onboarding.allow')}
          </Text>
          <MaterialCommunityIcons name="arrow-right" size={20} color={theme.onPrimary} />
        </Pressable>
        {step === 3 && notificationPermission !== 'granted' ? (
          <Pressable
            testID="onboarding.later"
            accessibilityRole="button"
            disabled={busy}
            onPress={() => void finish()}
            style={styles.secondaryButton}
          >
            <Text style={[styles.secondaryText, { color: theme.text }]}>
              {t('onboarding.later')}
            </Text>
          </Pressable>
        ) : step > 0 ? (
          <Pressable
            testID="onboarding.back"
            accessibilityRole="button"
            onPress={() => setStep(step - 1)}
            style={styles.secondaryButton}
          >
            <Text style={[styles.secondaryText, { color: theme.text }]}>{t('onboarding.back')}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  topBar: { minHeight: 62, paddingHorizontal: spacing.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  brandText: { fontSize: 17, fontWeight: '800', letterSpacing: -0.3 },
  skipButton: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  skipText: { fontSize: 14, fontWeight: '700' },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.lg },
  progress: { flexDirection: 'row', gap: 6, marginBottom: spacing.lg },
  progressBar: { flex: 1, height: 4, borderRadius: 4 },
  title: { fontSize: 33, lineHeight: 38, fontWeight: '800', letterSpacing: -1.2, maxWidth: 330 },
  body: { fontSize: 16, lineHeight: 23, marginTop: 12, maxWidth: 380 },
  previewCard: { marginTop: 28, borderRadius: 24, borderWidth: 1, padding: 22, overflow: 'hidden' },
  previewLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 1.4 },
  previewHeading: { fontSize: 21, fontWeight: '800', letterSpacing: -0.5, marginTop: 8, marginBottom: 16 },
  timelineLine: { position: 'absolute', top: 103, bottom: 31, left: 44, width: 2 },
  timelineRow: { minHeight: 67, flexDirection: 'row', alignItems: 'center', gap: 13 },
  timelineIcon: { width: 43, height: 43, borderRadius: 16, borderWidth: 4, alignItems: 'center', justifyContent: 'center' },
  timelineText: { fontSize: 16, fontWeight: '700', flex: 1 },
  timelineTime: { fontSize: 14, fontWeight: '600' },
  clockHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  dayLabel: { width: 72 },
  dayText: { fontSize: 12, fontWeight: '700' },
  clockTrack: { flex: 1, flexDirection: 'row', justifyContent: 'space-between' },
  clockHour: { fontSize: 10, fontWeight: '700', fontVariant: ['tabular-nums'] },
  clockRow: { flexDirection: 'row', alignItems: 'center', height: 58, borderTopWidth: 1 },
  clockGrid: { height: 29, borderRadius: 8, borderWidth: 1, overflow: 'hidden' },
  gridLine: { position: 'absolute', top: 0, bottom: 0, width: 1 },
  clockMark: { position: 'absolute', top: 5, height: 18, width: 6, marginLeft: -3, borderRadius: 3 },
  clockDuration: { top: 10, height: 8, width: 28, marginLeft: 0, borderRadius: 4 },
  scheduleRow: { flexDirection: 'row', alignItems: 'center', minHeight: 58, borderTopWidth: 1, gap: 14 },
  scheduleTime: { width: 55, fontSize: 14, fontWeight: '800' },
  scheduleLabel: { fontSize: 16, fontWeight: '700' },
  notificationStack: { marginTop: 24 },
  notificationPreview: { minHeight: 76, borderRadius: 20, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 },
  notificationBadge: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  featureRow: { minHeight: 66, borderBottomWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  featureIcon: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  featureCopy: { flex: 1 },
  featureTitle: { fontSize: 15, lineHeight: 20, fontWeight: '800' },
  featureDetail: { fontSize: 13, lineHeight: 18, marginTop: 2 },
  changeLater: { fontSize: 13, lineHeight: 19, marginTop: 12 },
  footer: { borderTopWidth: 1, paddingHorizontal: spacing.lg, paddingTop: 12, paddingBottom: 10 },
  primaryButton: { minHeight: 56, borderRadius: 17, paddingHorizontal: 19, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  primaryText: { fontSize: 16, fontWeight: '800' },
  secondaryButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { fontSize: 14, fontWeight: '700' },
});

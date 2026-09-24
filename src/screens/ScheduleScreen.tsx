import { MaterialCommunityIcons } from '@expo/vector-icons';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useEffect, useState } from 'react';
import {
  Alert,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';

import { scheduleStatusesForDay, suggestScheduleFromEvents, type ScheduleStatus } from '../analytics';
import { customActivityKey, EVENT_META, formatMinutes, quickEventTypes, type EventType, type ScheduleEntry } from '../domain';
import type { PuppyEvent } from '../domain';
import { useLocalization } from '../localization-context';
import { eventIcon, spacing, surfaceTreatment, type Theme } from '../theme';

type Draft = { id?: string; type: EventType; customLabel?: string; minutes: number; reminder: boolean };

export function ScheduleScreen({
  events,
  schedule,
  customActivities,
  onChange,
  onRequestReminderPermission,
  theme,
}: {
  events: PuppyEvent[];
  schedule: ScheduleEntry[];
  customActivities: string[];
  onChange: (schedule: ScheduleEntry[]) => Promise<void>;
  onRequestReminderPermission: () => Promise<boolean>;
  theme: Theme;
}) {
  const { eventLabel, t } = useLocalization();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [showAndroidPicker, setShowAndroidPicker] = useState(false);
  const [requestingPermission, setRequestingPermission] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reviewingSuggestion, setReviewingSuggestion] = useState(false);
  const [applyingSuggestion, setApplyingSuggestion] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const statuses = scheduleStatusesForDay(events, schedule, new Date(now), 30, now);
  const suggestion = suggestScheduleFromEvents(events, 14, new Date(now));
  const canSuggest = suggestion.entries.length > 0;
  const completed = statuses.filter((item) => item.status === 'done').length;
  const due = statuses.filter((item) => item.status === 'due').length;
  const missed = statuses.filter((item) => item.status === 'missed').length;
  const progress: `${number}%` = schedule.length
    ? `${Math.round((completed / schedule.length) * 100)}%`
    : '0%';

  const statusPresentation = (status: ScheduleStatus, type: EventType) => {
    if (status === 'done') return { label: t('schedule.status.logged'), color: theme.primary, background: theme.primarySoft };
    if (status === 'due') return { label: t('schedule.status.due'), color: EVENT_META[type].color, background: EVENT_META[type].softColor };
    if (status === 'missed') return { label: t('schedule.status.missed'), color: theme.danger, background: theme.dangerSoft };
    return { label: t('schedule.status.upcoming'), color: theme.textMuted, background: theme.surface };
  };

  const openNew = () => {
    const now = new Date();
    const rounded = Math.round((now.getHours() * 60 + now.getMinutes()) / 15) * 15;
    setDraft({ type: 'pee', minutes: rounded % (24 * 60), reminder: false });
  };

  const save = async () => {
    if (!draft || saving) return;
    const entry: ScheduleEntry = {
      id: draft.id ?? `${Date.now()}-${draft.type}`,
      type: draft.type,
      ...(draft.type === 'custom' ? { customLabel: draft.customLabel } : {}),
      minutes: draft.minutes,
      reminder: draft.reminder,
    };
    setSaving(true);
    try {
      await onChange([...schedule.filter((item) => item.id !== entry.id), entry].sort((a, b) => a.minutes - b.minutes));
      setDraft(null);
    } catch {
      Alert.alert(t('schedule.saveErrorTitle'), t('schedule.saveErrorBody'));
    } finally {
      setSaving(false);
    }
  };

  const toggleReminder = async (enabled: boolean) => {
    if (!draft || requestingPermission) return;
    if (!enabled) {
      setDraft({ ...draft, reminder: false });
      return;
    }

    setRequestingPermission(true);
    try {
      if (await onRequestReminderPermission()) {
        setDraft((current) => current ? { ...current, reminder: true } : null);
      } else {
        Alert.alert(
          t('schedule.notificationsOff'),
          t('schedule.notificationsBody'),
          [
            { text: t('schedule.notNow'), style: 'cancel' },
            { text: t('schedule.openSettings'), onPress: () => Linking.openSettings() },
          ],
        );
      }
    } catch {
      Alert.alert(t('schedule.reminderErrorTitle'), t('schedule.reminderErrorBody'));
    } finally {
      setRequestingPermission(false);
    }
  };

  const remove = (entry: ScheduleEntry) => {
    Alert.alert(t('schedule.removeTitle'), t('schedule.entryAt', {
      activity: entry.customLabel ?? eventLabel(entry.type),
      time: formatMinutes(entry.minutes),
    }), [
      { text: t('app.cancel'), style: 'cancel' },
      {
        text: t('schedule.remove'),
        style: 'destructive',
        onPress: async () => {
          try {
            await onChange(schedule.filter((item) => item.id !== entry.id));
          } catch {
            Alert.alert(t('schedule.removeErrorTitle'), t('schedule.removeErrorBody'));
          }
        },
      },
    ]);
  };

  const pickerDate = new Date(2000, 0, 1, Math.floor((draft?.minutes ?? 0) / 60), (draft?.minutes ?? 0) % 60);
  const onPick = (event: DateTimePickerEvent, date?: Date) => {
    if (Platform.OS === 'android') setShowAndroidPicker(false);
    if (event.type === 'dismissed' || !date || !draft) return;
    setDraft({ ...draft, minutes: date.getHours() * 60 + date.getMinutes() });
  };

  const applySuggestion = async () => {
    if (!canSuggest || applyingSuggestion) return;
    setApplyingSuggestion(true);
    try {
      await onChange(suggestion.entries);
      setReviewingSuggestion(false);
    } catch {
      Alert.alert(t('schedule.suggestionErrorTitle'), t('schedule.suggestionErrorBody'));
    } finally {
      setApplyingSuggestion(false);
    }
  };

  return (
    <>
      <ScrollView testID="screen.schedule" contentContainerStyle={styles.content}>
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
          {t('schedule.title')}
        </Text>

        <View
          style={[
            styles.learnCard,
            surfaceTreatment(theme),
            {
              backgroundColor: theme.surfaceRaised,
              borderColor: theme.border,
              padding: theme.presentation.cardPadding,
            },
          ]}
        >
          <View
            testID="schedule.empty"
            style={[
              styles.learnStatus,
              { backgroundColor: theme.surface, borderRadius: theme.presentation.controlRadius },
            ]}
          >
            <MaterialCommunityIcons
              accessibilityElementsHidden
              importantForAccessibility="no"
              name={canSuggest ? 'check-circle-outline' : 'information-outline'}
              color={canSuggest ? theme.primary : theme.textMuted}
              size={18}
            />
            <Text
              adjustsFontSizeToFit
              minimumFontScale={0.85}
              numberOfLines={1}
              style={[styles.learnStatusText, { color: theme.textMuted }]}
            >
              {canSuggest
                ? t('schedule.suggestedTimes', { count: suggestion.entries.length, days: suggestion.daysAnalyzed })
                : suggestion.daysAnalyzed < 3
                  ? t('schedule.needDays', { count: 3 - suggestion.daysAnalyzed })
                  : t('schedule.noPattern')}
            </Text>
          </View>
          {canSuggest ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('schedule.previewA11y', { count: suggestion.entries.length })}
              onPress={() => setReviewingSuggestion(true)}
              style={({ pressed }) => [
                styles.learnButton,
                {
                  backgroundColor: theme.primary,
                  borderColor: theme.primary,
                  borderRadius: theme.presentation.controlRadius,
                  borderWidth: theme.presentation.borderWidth,
                  opacity: pressed ? 0.8 : 1,
                },
              ]}
            >
              <MaterialCommunityIcons
                accessibilityElementsHidden
                importantForAccessibility="no"
                name="eye-outline"
                color={theme.onPrimary}
                size={20}
              />
              <Text style={[styles.learnButtonText, { color: theme.onPrimary }]}>
                {t('schedule.previewButton')}
              </Text>
            </Pressable>
          ) : null}
        </View>

        {schedule.length ? (
          <View
            style={[
              styles.progressCard,
              surfaceTreatment(theme),
              {
                backgroundColor: theme.surfaceRaised,
                borderColor: theme.border,
                padding: theme.presentation.cardPadding,
              },
            ]}
          >
            <View style={styles.progressHeading}>
              <Text style={[styles.progressTitle, { color: theme.text }]}>
                {t('schedule.loggedProgress', { completed, total: schedule.length })}
              </Text>
              <View
                style={[
                  styles.progressIcon,
                  { backgroundColor: theme.primarySoft, borderRadius: theme.presentation.iconRadius },
                ]}
              >
                <MaterialCommunityIcons name="calendar-check-outline" color={theme.primary} size={23} />
              </View>
            </View>
            <Text style={[styles.progressDetail, { color: theme.textMuted }]}>
              {due
                ? t(due === 1 ? 'schedule.dueOne' : 'schedule.dueMany', { count: due })
                : missed
                  ? t(missed === 1 ? 'schedule.missedOne' : 'schedule.missedMany', { count: missed })
                  : t(completed === schedule.length ? 'schedule.everythingLogged' : 'schedule.nextAhead')}
            </Text>
            <View
              style={[
                styles.progressTrack,
                { backgroundColor: theme.primarySoft, borderRadius: theme.presentation.controlRadius },
              ]}
            >
              <View
                style={[
                  styles.progressFill,
                  { backgroundColor: theme.primary, borderRadius: theme.presentation.controlRadius, width: progress },
                ]}
              />
            </View>
          </View>
        ) : null}

        {schedule.length ? (
          <View style={styles.headingRow}>
            <Text style={[styles.sectionTitle, { color: theme.text }]}>{t('schedule.todayPlan')}</Text>
          </View>
        ) : null}

        {schedule.length === 0 ? (
          <View
            style={[
              styles.empty,
              {
                borderColor: theme.border,
                backgroundColor: theme.surface,
                borderRadius: theme.presentation.cardRadius,
                borderWidth: theme.presentation.borderWidth,
              },
            ]}
          >
            <Text style={[styles.emptyTitle, { color: theme.text }]}>{t('schedule.emptyTitle')}</Text>
          </View>
        ) : (
          schedule.map((entry, index) => {
            const meta = EVENT_META[entry.type];
            const label = entry.customLabel ?? eventLabel(entry.type);
            const status = statuses.find((item) => item.entry.id === entry.id)?.status ?? 'upcoming';
            const presentation = statusPresentation(status, entry.type);
            return (
              <Pressable
                key={entry.id}
                testID={`schedule.entry.${entry.type}`}
                accessibilityRole="button"
                accessibilityLabel={t('schedule.editA11y', {
                  activity: label,
                  time: formatMinutes(entry.minutes),
                  status: presentation.label,
                  reminder: entry.reminder ? t('schedule.reminderOn') : '',
                })}
                onPress={() => setDraft({ ...entry, reminder: Boolean(entry.reminder) })}
                style={({ pressed }) => [
                  styles.scheduleRow,
                  surfaceTreatment(theme),
                  {
                    backgroundColor: theme.surfaceRaised,
                    borderColor: pressed ? theme.primary : theme.border,
                  },
                ]}
              >
                <View style={styles.timelineRail}>
                  <View style={[styles.timelineDot, { backgroundColor: meta.color }]} />
                  {index < schedule.length - 1 ? <View style={[styles.timelineLine, { backgroundColor: theme.border }]} /> : null}
                </View>
                <Text style={[styles.time, { color: theme.text }]}>{formatMinutes(entry.minutes)}</Text>
                <View style={styles.rowCopy}>
                  <Text style={[styles.rowTitle, { color: theme.text }]}>{label}</Text>
                  <View
                    style={[
                      styles.statusPill,
                      {
                        backgroundColor: presentation.background,
                        borderRadius: theme.presentation.controlRadius,
                      },
                    ]}
                  >
                    <View style={[styles.statusDot, { backgroundColor: presentation.color }]} />
                    <Text style={[styles.statusText, { color: presentation.color }]}>{presentation.label}</Text>
                  </View>
                </View>
                {entry.reminder ? (
                  <View
                    accessible={false}
                    style={[
                      styles.reminderIndicator,
                      {
                        backgroundColor: theme.primarySoft,
                        borderRadius: theme.presentation.iconRadius,
                      },
                    ]}
                  >
                    <MaterialCommunityIcons name="bell-ring-outline" size={17} color={theme.primary} />
                  </View>
                ) : null}
                <Pressable
                  testID={`schedule.entry.${entry.type}.remove`}
                  accessibilityRole="button"
                  accessibilityLabel={t('schedule.removeA11y', { activity: label, time: formatMinutes(entry.minutes) })}
                  hitSlop={8}
                  onPress={(event) => {
                    event.stopPropagation();
                    remove(entry);
                  }}
                  style={({ pressed }) => [
                    styles.removeButton,
                    { borderRadius: theme.presentation.controlRadius },
                    pressed && { backgroundColor: theme.primarySoft },
                  ]}
                >
                  <MaterialCommunityIcons name="close" size={20} color={theme.textMuted} />
                </Pressable>
              </Pressable>
            );
          })
        )}

        <Pressable
          testID="schedule.add"
          accessibilityRole="button"
          accessibilityLabel={t('schedule.addA11y')}
          onPress={openNew}
          style={({ pressed }) => [
            styles.addButton,
            {
              backgroundColor: pressed ? theme.primaryPressed : theme.primary,
              borderRadius: theme.presentation.controlRadius,
            },
          ]}
        >
          <MaterialCommunityIcons name="plus" color={theme.onPrimary} size={22} />
          <Text style={[styles.addButtonText, { color: theme.onPrimary }]}>{t('schedule.addTime')}</Text>
        </Pressable>
      </ScrollView>

      <Modal
        visible={reviewingSuggestion}
        transparent
        animationType="none"
        onRequestClose={() => setReviewingSuggestion(false)}
      >
        <View testID="schedule.suggestion" accessibilityViewIsModal style={styles.scrim}>
          <ScrollView
            bounces={false}
            style={[styles.sheet, { backgroundColor: theme.surfaceRaised }]}
            contentContainerStyle={styles.sheetContent}
          >
            <View style={styles.sheetHeading}>
              <View style={styles.learnCopy}>
                <Text style={[styles.sheetTitle, { color: theme.text }]}>{t('schedule.suggestionTitle')}</Text>
                <Text style={[styles.previewSubtitle, { color: theme.textMuted }]}>
                  {t('schedule.suggestionSubtitle', {
                    days: suggestion.daysAnalyzed,
                    period: suggestion.periodDays,
                  })}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('schedule.closeSuggestion')}
                onPress={() => setReviewingSuggestion(false)}
                style={({ pressed }) => [styles.closeButton, pressed && { backgroundColor: theme.primarySoft }]}
              >
                <MaterialCommunityIcons name="close" size={22} color={theme.text} />
              </Pressable>
            </View>

            <View style={[styles.previewList, { borderColor: theme.border }]}>
              {suggestion.entries.map((entry, index) => {
                const meta = EVENT_META[entry.type];
                const label = entry.customLabel ?? eventLabel(entry.type);
                const color = theme.isDark ? meta.darkColor : meta.color;
                const background = theme.isDark ? meta.darkSoftColor : meta.softColor;
                return (
                  <View
                    key={entry.id}
                    accessible
                    accessibilityLabel={t('schedule.entryAt', { activity: label, time: formatMinutes(entry.minutes) })}
                    style={[
                      styles.previewRow,
                      index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border },
                    ]}
                  >
                    <View style={[styles.previewIcon, { backgroundColor: background }]}>
                      <MaterialCommunityIcons
                        accessibilityElementsHidden
                        importantForAccessibility="no"
                        name={eventIcon(theme, entry.type) as keyof typeof MaterialCommunityIcons.glyphMap}
                        size={19}
                        color={color}
                      />
                    </View>
                    <Text style={[styles.previewActivity, { color: theme.text }]}>{label}</Text>
                    <Text style={[styles.previewTime, { color: theme.text }]}>{formatMinutes(entry.minutes)}</Text>
                  </View>
                );
              })}
            </View>

            <View style={[styles.replaceNote, { backgroundColor: theme.surface }]}>
              <MaterialCommunityIcons
                accessibilityElementsHidden
                importantForAccessibility="no"
                name="information-outline"
                size={19}
                color={theme.textMuted}
              />
              <Text style={[styles.replaceNoteText, { color: theme.textMuted }]}>
                {schedule.length
                  ? t('schedule.replaceCurrent', { count: schedule.length })
                  : t('schedule.createRoutine')}
                {t('schedule.remindersStayOff')}
              </Text>
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityState={{ busy: applyingSuggestion, disabled: applyingSuggestion }}
              disabled={applyingSuggestion}
              onPress={applySuggestion}
              style={({ pressed }) => [
                styles.saveButton,
                { backgroundColor: pressed ? theme.primaryPressed : theme.primary, opacity: applyingSuggestion ? 0.55 : 1 },
              ]}
            >
              <Text style={[styles.saveText, { color: theme.onPrimary }]}>
                {t(applyingSuggestion ? 'schedule.usingRoutine' : 'schedule.useRoutine')}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={applyingSuggestion}
              onPress={() => setReviewingSuggestion(false)}
              style={({ pressed }) => [styles.cancelButton, pressed && { backgroundColor: theme.surface }]}
            >
              <Text style={[styles.cancelText, { color: theme.textMuted }]}>{t('schedule.keepRoutine')}</Text>
            </Pressable>
          </ScrollView>
        </View>
      </Modal>

      <Modal visible={draft !== null} transparent animationType="none" onRequestClose={() => setDraft(null)}>
        <View testID="schedule.editor" accessibilityViewIsModal style={styles.scrim}>
          <ScrollView
            bounces={false}
            style={[styles.sheet, { backgroundColor: theme.surfaceRaised }]}
            contentContainerStyle={styles.sheetContent}
          >
            <View style={styles.sheetHeading}>
              <Text style={[styles.sheetTitle, { color: theme.text }]}>
                {t(draft?.id ? 'schedule.editTime' : 'schedule.addTime')}
              </Text>
              <Pressable
                testID="schedule.editor.close"
                accessibilityLabel={t('schedule.close')}
                onPress={() => setDraft(null)}
                style={({ pressed }) => [styles.closeButton, pressed && { backgroundColor: theme.primarySoft }]}
              >
                <MaterialCommunityIcons name="close" size={22} color={theme.text} />
              </Pressable>
            </View>

            <Text style={[styles.fieldLabel, { color: theme.textMuted }]}>{t('schedule.activity')}</Text>
            <View style={styles.typePicker}>
              {[...quickEventTypes.map((type) => ({ type, customLabel: undefined as string | undefined })),
                ...customActivities.map((customLabel) => ({ type: 'custom' as EventType, customLabel }))].map(({ type, customLabel }) => {
                const selected = draft?.type === type && (type !== 'custom' || customActivityKey(draft.customLabel ?? '') === customActivityKey(customLabel ?? ''));
                const meta = EVENT_META[type];
                const label = customLabel ?? eventLabel(type);
                return (
                  <Pressable
                    key={customLabel ? customActivityKey(customLabel) : type}
                    testID={`schedule.editor.type.${type}`}
                    accessibilityState={{ selected }}
                    onPress={() => draft && setDraft({ ...draft, type, customLabel })}
                    style={({ pressed }) => [
                      styles.typeChoice,
                      {
                        backgroundColor: selected ? meta.softColor : theme.surface,
                        borderColor: selected ? meta.color : theme.border,
                        opacity: pressed ? 0.7 : 1,
                      },
                    ]}
                  >
                    <MaterialCommunityIcons
                      name={eventIcon(theme, type) as keyof typeof MaterialCommunityIcons.glyphMap}
                      color={selected ? meta.color : theme.textMuted}
                      size={21}
                    />
                    <Text style={[styles.typeChoiceText, { color: selected ? meta.color : theme.text }]}>{label}</Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={[styles.fieldLabel, { color: theme.textMuted }]}>{t('schedule.time')}</Text>
            {Platform.OS === 'ios' ? (
              <DateTimePicker value={pickerDate} mode="time" display="spinner" onChange={onPick} />
            ) : (
              <>
                <Pressable
                  onPress={() => setShowAndroidPicker(true)}
                  style={({ pressed }) => [
                    styles.timeButton,
                    { backgroundColor: theme.surface, borderColor: pressed ? theme.primary : theme.border },
                  ]}
                >
                  <MaterialCommunityIcons name="clock-outline" size={22} color={theme.primary} />
                  <Text style={[styles.timeButtonText, { color: theme.text }]}>{formatMinutes(draft?.minutes ?? 0)}</Text>
                </Pressable>
                {showAndroidPicker ? <DateTimePicker value={pickerDate} mode="time" onChange={onPick} /> : null}
              </>
            )}

            <View style={[styles.reminderRow, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <View style={[styles.reminderIcon, { backgroundColor: theme.primarySoft }]}>
                <MaterialCommunityIcons name="bell-outline" size={21} color={theme.primary} />
              </View>
              <View style={styles.reminderCopy}>
                <Text style={[styles.reminderTitle, { color: theme.text }]}>{t('schedule.dailyReminder')}</Text>
              </View>
              <Switch
                testID="schedule.editor.reminder"
                accessibilityLabel={t('schedule.reminderA11y')}
                disabled={requestingPermission}
                ios_backgroundColor={theme.border}
                onValueChange={toggleReminder}
                trackColor={{ false: theme.border, true: theme.primary }}
                value={Boolean(draft?.reminder)}
              />
            </View>

            <Pressable
              testID="schedule.editor.save"
              accessibilityRole="button"
              accessibilityState={{ busy: saving, disabled: saving }}
              disabled={saving}
              onPress={save}
              style={({ pressed }) => [
                styles.saveButton,
                { backgroundColor: pressed ? theme.primaryPressed : theme.primary, opacity: saving ? 0.55 : 1 },
              ]}
            >
              <Text style={[styles.saveText, { color: theme.onPrimary }]}>
                {t(saving ? 'common.saving' : 'schedule.saveTime')}
              </Text>
            </Pressable>
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  content: {
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
    padding: spacing.md,
    paddingBottom: spacing.xl,
  },
  title: { fontSize: 30, lineHeight: 36, fontWeight: '800', letterSpacing: -0.6, marginTop: 4 },
  learnCard: { borderWidth: 1, borderRadius: 22, padding: spacing.md, marginTop: spacing.lg },
  learnCopy: { flex: 1, minWidth: 0 },
  learnStatus: { minHeight: 43, borderRadius: 13, paddingHorizontal: 11, paddingVertical: 9, flexDirection: 'row', alignItems: 'center', gap: 8 },
  learnStatusText: { flex: 1, fontSize: 12, lineHeight: 17, fontWeight: '600' },
  learnButton: { minHeight: 50, borderRadius: 16, borderWidth: 1, marginTop: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 14 },
  learnButtonText: { fontSize: 15, lineHeight: 20, fontWeight: '800', textAlign: 'center' },
  progressCard: { borderWidth: 1, borderRadius: 22, padding: spacing.md, marginTop: spacing.lg },
  progressHeading: { flexDirection: 'row', alignItems: 'center' },
  progressTitle: { flex: 1, fontSize: 20, lineHeight: 26, fontWeight: '800' },
  progressIcon: { marginLeft: 'auto', width: 44, height: 44, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  progressDetail: { fontSize: 13, lineHeight: 18, marginTop: 7 },
  progressTrack: { height: 8, borderRadius: 4, overflow: 'hidden', marginTop: 13 },
  progressFill: { height: 8, borderRadius: 4 },
  headingRow: { flexDirection: 'row', alignItems: 'baseline', marginTop: spacing.xl, marginBottom: 12 },
  sectionTitle: { flex: 1, fontSize: 21, fontWeight: '800' },
  scheduleRow: { minHeight: 68, borderWidth: 1, borderRadius: 18, marginBottom: 8, flexDirection: 'row', alignItems: 'center', paddingRight: 10 },
  timelineRail: { alignSelf: 'stretch', width: 32, alignItems: 'center' },
  timelineDot: { width: 10, height: 10, borderRadius: 5, marginTop: 28 },
  timelineLine: { position: 'absolute', width: 2, top: 38, bottom: -18 },
  time: { width: 78, fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] },
  rowCopy: { flex: 1 },
  rowTitle: { fontSize: 15, fontWeight: '700' },
  statusPill: { alignSelf: 'flex-start', minHeight: 22, borderRadius: 11, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 11, lineHeight: 15, fontWeight: '700' },
  reminderIndicator: { width: 34, height: 34, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginRight: 2 },
  removeButton: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  addButton: { minHeight: 54, borderRadius: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: spacing.md },
  addButtonText: { fontSize: 16, fontWeight: '700' },
  empty: { borderWidth: 1, borderStyle: 'dashed', borderRadius: 20, padding: spacing.lg, marginTop: spacing.xl, alignItems: 'center' },
  emptyTitle: { fontSize: 17, fontWeight: '700' },
  scrim: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.56)', justifyContent: 'flex-end' },
  sheet: {
    width: '100%',
    maxWidth: 640,
    maxHeight: '92%',
    alignSelf: 'center',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
  },
  sheetContent: { padding: spacing.lg, paddingBottom: 34 },
  sheetHeading: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.lg },
  sheetTitle: { flex: 1, fontSize: 23, fontWeight: '800' },
  previewSubtitle: { fontSize: 13, lineHeight: 19, marginTop: 4 },
  previewList: { borderWidth: 1, borderRadius: 17, paddingHorizontal: 12, overflow: 'hidden' },
  previewRow: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: 10 },
  previewIcon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  previewActivity: { flex: 1, fontSize: 15, lineHeight: 20, fontWeight: '700' },
  previewTime: { fontSize: 15, lineHeight: 20, fontWeight: '800', fontVariant: ['tabular-nums'] },
  replaceNote: { borderRadius: 14, padding: 12, flexDirection: 'row', alignItems: 'flex-start', gap: 9, marginTop: spacing.md },
  replaceNoteText: { flex: 1, fontSize: 12, lineHeight: 18 },
  cancelButton: { minHeight: 48, borderRadius: 15, alignItems: 'center', justifyContent: 'center', marginTop: spacing.sm },
  cancelText: { fontSize: 15, lineHeight: 20, fontWeight: '700' },
  closeButton: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  fieldLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 1.2, marginBottom: 8 },
  typePicker: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: spacing.lg },
  typeChoice: { flexBasis: '47%', flexGrow: 1, minHeight: 50, borderRadius: 15, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  typeChoiceText: { fontSize: 14, fontWeight: '700' },
  timeButton: { minHeight: 58, borderWidth: 1, borderRadius: 16, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, gap: 10 },
  timeButtonText: { flex: 1, fontSize: 18, fontWeight: '700', fontVariant: ['tabular-nums'] },
  reminderRow: { minHeight: 60, borderWidth: 1, borderRadius: 17, padding: 12, marginTop: spacing.lg, flexDirection: 'row', alignItems: 'center', gap: 11 },
  reminderIcon: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  reminderCopy: { flex: 1, minWidth: 0 },
  reminderTitle: { fontSize: 15, lineHeight: 20, fontWeight: '700' },
  saveButton: { minHeight: 56, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginTop: spacing.lg },
  saveText: { fontSize: 16, fontWeight: '800' },
});

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

import { scheduleStatusesForDay, type ScheduleStatus } from '../analytics';
import { EVENT_META, formatMinutes, quickEventTypes, type EventType, type ScheduleEntry } from '../domain';
import type { PuppyEvent } from '../domain';
import { spacing, type Theme } from '../theme';

type Draft = { id?: string; type: EventType; minutes: number; reminder: boolean };

export function ScheduleScreen({
  events,
  schedule,
  onChange,
  onRequestReminderPermission,
  theme,
}: {
  events: PuppyEvent[];
  schedule: ScheduleEntry[];
  onChange: (schedule: ScheduleEntry[]) => Promise<void>;
  onRequestReminderPermission: () => Promise<boolean>;
  theme: Theme;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [showAndroidPicker, setShowAndroidPicker] = useState(false);
  const [requestingPermission, setRequestingPermission] = useState(false);
  const [saving, setSaving] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const statuses = scheduleStatusesForDay(events, schedule, new Date(now), 30, now);
  const completed = statuses.filter((item) => item.status === 'done').length;
  const due = statuses.filter((item) => item.status === 'due').length;
  const missed = statuses.filter((item) => item.status === 'missed').length;
  const progress: `${number}%` = schedule.length
    ? `${Math.round((completed / schedule.length) * 100)}%`
    : '0%';

  const statusPresentation = (status: ScheduleStatus, type: EventType) => {
    if (status === 'done') return { label: 'Logged', color: theme.primary, background: theme.primarySoft };
    if (status === 'due') return { label: 'Due now', color: EVENT_META[type].color, background: EVENT_META[type].softColor };
    if (status === 'missed') return { label: 'Missed', color: theme.danger, background: theme.dangerSoft };
    return { label: 'Upcoming', color: theme.textMuted, background: theme.surface };
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
      minutes: draft.minutes,
      reminder: draft.reminder,
    };
    setSaving(true);
    try {
      await onChange([...schedule.filter((item) => item.id !== entry.id), entry].sort((a, b) => a.minutes - b.minutes));
      setDraft(null);
    } catch {
      Alert.alert('Couldn’t save the routine', 'Your previous routine is still available. Please try again.');
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
          'Notifications are off',
          'Allow Puptime notifications in system settings to use daily routine reminders.',
          [
            { text: 'Not now', style: 'cancel' },
            { text: 'Open settings', onPress: () => Linking.openSettings() },
          ],
        );
      }
    } catch {
      Alert.alert('Couldn’t enable reminders', 'Please try again from this routine entry.');
    } finally {
      setRequestingPermission(false);
    }
  };

  const remove = (entry: ScheduleEntry) => {
    Alert.alert('Remove this time?', `${EVENT_META[entry.type].label} at ${formatMinutes(entry.minutes)}`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await onChange(schedule.filter((item) => item.id !== entry.id));
          } catch {
            Alert.alert('Couldn’t remove the time', 'Your routine has not changed. Please try again.');
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

  return (
    <>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.eyebrow, { color: theme.primary }]}>DAILY ROUTINE</Text>
        <Text style={[styles.title, { color: theme.text }]}>Make the day predictable</Text>
        <Text style={[styles.subtitle, { color: theme.textMuted }]}>
          This is an editable example routine, not veterinary guidance. Adjust it to your puppy’s needs.
        </Text>

        {schedule.length ? (
          <View style={[styles.progressCard, { backgroundColor: theme.surfaceRaised, borderColor: theme.border }]}>
            <View style={styles.progressHeading}>
              <View>
                <Text style={[styles.progressEyebrow, { color: theme.primary }]}>TODAY SO FAR</Text>
                <Text style={[styles.progressTitle, { color: theme.text }]}>{completed} of {schedule.length} logged</Text>
              </View>
              <View style={[styles.progressIcon, { backgroundColor: theme.primarySoft }]}>
                <MaterialCommunityIcons name="calendar-check-outline" color={theme.primary} size={23} />
              </View>
            </View>
            <Text style={[styles.progressDetail, { color: theme.textMuted }]}>
              {due ? `${due} ${due === 1 ? 'activity is' : 'activities are'} due now` : missed ? `${missed} missed ${missed === 1 ? 'window' : 'windows'}` : completed === schedule.length ? 'Everything planned has been logged' : 'The next activity is still ahead'}
            </Text>
            <View style={[styles.progressTrack, { backgroundColor: theme.primarySoft }]}>
              <View style={[styles.progressFill, { backgroundColor: theme.primary, width: progress }]} />
            </View>
            <Text style={[styles.windowHint, { color: theme.textMuted }]}>A log counts on time within 30 minutes of its planned time.</Text>
          </View>
        ) : null}

        <View style={styles.headingRow}>
          <Text style={[styles.sectionTitle, { color: theme.text }]}>Today’s plan</Text>
          <Text style={[styles.count, { color: theme.textMuted }]}>{schedule.length} times</Text>
        </View>

        {schedule.length === 0 ? (
          <View style={[styles.empty, { borderColor: theme.border, backgroundColor: theme.surface }]}>
            <Text style={[styles.emptyTitle, { color: theme.text }]}>No planned times</Text>
            <Text style={[styles.emptyBody, { color: theme.textMuted }]}>Add the moments you want to repeat each day.</Text>
          </View>
        ) : (
          schedule.map((entry, index) => {
            const meta = EVENT_META[entry.type];
            const status = statuses.find((item) => item.entry.id === entry.id)?.status ?? 'upcoming';
            const presentation = statusPresentation(status, entry.type);
            return (
              <Pressable
                key={entry.id}
                accessibilityRole="button"
                accessibilityLabel={`Edit ${meta.label} at ${formatMinutes(entry.minutes)}, ${presentation.label.toLowerCase()}${entry.reminder ? ', daily reminder on' : ''}`}
                onPress={() => setDraft({ ...entry, reminder: Boolean(entry.reminder) })}
                style={({ pressed }) => [
                  styles.scheduleRow,
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
                  <Text style={[styles.rowTitle, { color: theme.text }]}>{meta.label}</Text>
                  <View style={[styles.statusPill, { backgroundColor: presentation.background }]}>
                    <View style={[styles.statusDot, { backgroundColor: presentation.color }]} />
                    <Text style={[styles.statusText, { color: presentation.color }]}>{presentation.label}</Text>
                  </View>
                </View>
                {entry.reminder ? (
                  <View accessible={false} style={[styles.reminderIndicator, { backgroundColor: theme.primarySoft }]}>
                    <MaterialCommunityIcons name="bell-ring-outline" size={17} color={theme.primary} />
                  </View>
                ) : null}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${meta.label} at ${formatMinutes(entry.minutes)}`}
                  hitSlop={8}
                  onPress={(event) => {
                    event.stopPropagation();
                    remove(entry);
                  }}
                  style={({ pressed }) => [styles.removeButton, pressed && { backgroundColor: theme.primarySoft }]}
                >
                  <MaterialCommunityIcons name="close" size={20} color={theme.textMuted} />
                </Pressable>
              </Pressable>
            );
          })
        )}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add a routine time"
          onPress={openNew}
          style={({ pressed }) => [
            styles.addButton,
            { backgroundColor: pressed ? theme.primaryPressed : theme.primary },
          ]}
        >
          <MaterialCommunityIcons name="plus" color={theme.onPrimary} size={22} />
          <Text style={[styles.addButtonText, { color: theme.onPrimary }]}>Add a time</Text>
        </Pressable>
      </ScrollView>

      <Modal visible={draft !== null} transparent animationType="none" onRequestClose={() => setDraft(null)}>
        <View style={styles.scrim}>
          <ScrollView
            bounces={false}
            style={[styles.sheet, { backgroundColor: theme.surfaceRaised }]}
            contentContainerStyle={styles.sheetContent}
          >
            <View style={styles.sheetHeading}>
              <Text style={[styles.sheetTitle, { color: theme.text }]}>{draft?.id ? 'Edit time' : 'Add time'}</Text>
              <Pressable
                accessibilityLabel="Close"
                onPress={() => setDraft(null)}
                style={({ pressed }) => [styles.closeButton, pressed && { backgroundColor: theme.primarySoft }]}
              >
                <MaterialCommunityIcons name="close" size={22} color={theme.text} />
              </Pressable>
            </View>

            <Text style={[styles.fieldLabel, { color: theme.textMuted }]}>ACTIVITY</Text>
            <View style={styles.typePicker}>
              {quickEventTypes.map((type) => {
                const selected = draft?.type === type;
                const meta = EVENT_META[type];
                return (
                  <Pressable
                    key={type}
                    accessibilityState={{ selected }}
                    onPress={() => draft && setDraft({ ...draft, type })}
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
                      name={meta.icon as keyof typeof MaterialCommunityIcons.glyphMap}
                      color={selected ? meta.color : theme.textMuted}
                      size={21}
                    />
                    <Text style={[styles.typeChoiceText, { color: selected ? meta.color : theme.text }]}>{meta.label}</Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={[styles.fieldLabel, { color: theme.textMuted }]}>TIME</Text>
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
                  <Text style={[styles.changeText, { color: theme.primary }]}>Change</Text>
                </Pressable>
                {showAndroidPicker ? <DateTimePicker value={pickerDate} mode="time" onChange={onPick} /> : null}
              </>
            )}

            <Text style={[styles.fieldLabel, styles.reminderLabel, { color: theme.textMuted }]}>REMINDER</Text>
            <View style={[styles.reminderRow, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <View style={[styles.reminderIcon, { backgroundColor: theme.primarySoft }]}>
                <MaterialCommunityIcons name="bell-outline" size={21} color={theme.primary} />
              </View>
              <View style={styles.reminderCopy}>
                <Text style={[styles.reminderTitle, { color: theme.text }]}>Daily reminder</Text>
                <Text style={[styles.reminderHint, { color: theme.textMuted }]}>Alerts at this planned time on this device.</Text>
              </View>
              <Switch
                accessibilityLabel="Daily reminder for this routine entry"
                disabled={requestingPermission}
                ios_backgroundColor={theme.border}
                onValueChange={toggleReminder}
                trackColor={{ false: theme.border, true: theme.primary }}
                value={Boolean(draft?.reminder)}
              />
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityState={{ busy: saving, disabled: saving }}
              disabled={saving}
              onPress={save}
              style={({ pressed }) => [
                styles.saveButton,
                { backgroundColor: pressed ? theme.primaryPressed : theme.primary, opacity: saving ? 0.55 : 1 },
              ]}
            >
              <Text style={[styles.saveText, { color: theme.onPrimary }]}>{saving ? 'Saving…' : 'Save time'}</Text>
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
  eyebrow: { fontSize: 11, fontWeight: '800', letterSpacing: 1.6, marginTop: 4 },
  title: { fontSize: 30, lineHeight: 36, fontWeight: '800', letterSpacing: -0.6, marginTop: 4 },
  subtitle: { fontSize: 14, lineHeight: 21, marginTop: 6 },
  progressCard: { borderWidth: 1, borderRadius: 22, padding: spacing.md, marginTop: spacing.lg },
  progressHeading: { flexDirection: 'row', alignItems: 'center' },
  progressEyebrow: { fontSize: 10, lineHeight: 14, fontWeight: '800', letterSpacing: 1.2 },
  progressTitle: { fontSize: 20, lineHeight: 26, fontWeight: '800', marginTop: 2 },
  progressIcon: { marginLeft: 'auto', width: 44, height: 44, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  progressDetail: { fontSize: 13, lineHeight: 18, marginTop: 7 },
  progressTrack: { height: 8, borderRadius: 4, overflow: 'hidden', marginTop: 13 },
  progressFill: { height: 8, borderRadius: 4 },
  windowHint: { fontSize: 11, lineHeight: 16, marginTop: 8 },
  headingRow: { flexDirection: 'row', alignItems: 'baseline', marginTop: spacing.xl, marginBottom: 12 },
  sectionTitle: { flex: 1, fontSize: 21, fontWeight: '800' },
  count: { fontSize: 13, fontWeight: '600' },
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
  empty: { borderWidth: 1, borderStyle: 'dashed', borderRadius: 20, padding: spacing.lg, alignItems: 'center' },
  emptyTitle: { fontSize: 17, fontWeight: '700' },
  emptyBody: { fontSize: 14, lineHeight: 21, marginTop: 4, textAlign: 'center' },
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
  closeButton: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  fieldLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 1.2, marginBottom: 8 },
  typePicker: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: spacing.lg },
  typeChoice: { flexBasis: '47%', flexGrow: 1, minHeight: 50, borderRadius: 15, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  typeChoiceText: { fontSize: 14, fontWeight: '700' },
  timeButton: { minHeight: 58, borderWidth: 1, borderRadius: 16, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, gap: 10 },
  timeButtonText: { flex: 1, fontSize: 18, fontWeight: '700', fontVariant: ['tabular-nums'] },
  changeText: { fontSize: 14, fontWeight: '700' },
  reminderLabel: { marginTop: spacing.lg },
  reminderRow: { minHeight: 72, borderWidth: 1, borderRadius: 17, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 11 },
  reminderIcon: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  reminderCopy: { flex: 1, minWidth: 0 },
  reminderTitle: { fontSize: 15, lineHeight: 20, fontWeight: '700' },
  reminderHint: { fontSize: 12, lineHeight: 17, marginTop: 1 },
  saveButton: { minHeight: 56, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginTop: spacing.lg },
  saveText: { fontSize: 16, fontWeight: '800' },
});

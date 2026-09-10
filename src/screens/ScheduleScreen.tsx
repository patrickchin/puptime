import { MaterialCommunityIcons } from '@expo/vector-icons';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useState } from 'react';
import {
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { EVENT_META, eventTypes, formatMinutes, type EventType, type ScheduleEntry } from '../domain';
import { spacing, type Theme } from '../theme';

type Draft = { id?: string; type: EventType; minutes: number };

export function ScheduleScreen({
  schedule,
  onChange,
  theme,
}: {
  schedule: ScheduleEntry[];
  onChange: (schedule: ScheduleEntry[]) => void;
  theme: Theme;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [showAndroidPicker, setShowAndroidPicker] = useState(false);

  const openNew = () => {
    const now = new Date();
    const rounded = Math.round((now.getHours() * 60 + now.getMinutes()) / 15) * 15;
    setDraft({ type: 'pee', minutes: rounded % (24 * 60) });
  };

  const save = () => {
    if (!draft) return;
    const entry: ScheduleEntry = {
      id: draft.id ?? `${Date.now()}-${draft.type}`,
      type: draft.type,
      minutes: draft.minutes,
    };
    onChange([...schedule.filter((item) => item.id !== entry.id), entry].sort((a, b) => a.minutes - b.minutes));
    setDraft(null);
  };

  const remove = (entry: ScheduleEntry) => {
    Alert.alert('Remove this time?', `${EVENT_META[entry.type].label} at ${formatMinutes(entry.minutes)}`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => onChange(schedule.filter((item) => item.id !== entry.id)) },
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

        <View style={[styles.infoCard, { backgroundColor: theme.primarySoft }]}>
          <MaterialCommunityIcons name="clock-check-outline" color={theme.primary} size={24} />
          <Text style={[styles.infoText, { color: theme.text }]}>
            Insights count a log as on time when it lands within 30 minutes of a planned activity.
          </Text>
        </View>

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
            return (
              <Pressable
                key={entry.id}
                accessibilityLabel={`Edit ${meta.label} at ${formatMinutes(entry.minutes)}`}
                onPress={() => setDraft(entry)}
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
                  <Text style={[styles.rowHint, { color: theme.textMuted }]}>Tap to edit</Text>
                </View>
                <Pressable
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
              {eventTypes.map((type) => {
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

            <Pressable
              onPress={save}
              style={({ pressed }) => [styles.saveButton, { backgroundColor: pressed ? theme.primaryPressed : theme.primary }]}
            >
              <Text style={[styles.saveText, { color: theme.onPrimary }]}>Save time</Text>
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
  infoCard: { borderRadius: 18, padding: spacing.md, flexDirection: 'row', gap: 12, marginTop: spacing.lg },
  infoText: { flex: 1, fontSize: 14, lineHeight: 21, fontWeight: '500' },
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
  rowHint: { fontSize: 12, marginTop: 2 },
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
  saveButton: { minHeight: 56, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginTop: spacing.lg },
  saveText: { fontSize: 16, fontWeight: '800' },
});

import { MaterialCommunityIcons } from '@expo/vector-icons';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Keyboard, Modal, Platform, Pressable, ScrollView, SectionList, StyleSheet, Text, TextInput, View } from 'react-native';

import { QuickActions } from '../components/QuickActions';
import { EventRow } from '../components/EventRow';
import { NoteInput } from '../components/NoteInput';
import { TodayRoutineCard } from '../components/TodayRoutineCard';
import {
  dateKey,
  EVENT_META,
  eventTypes,
  formatDuration,
  formatTime,
  normalizeCustomLabel,
  relativeTime,
  replaceCalendarDate,
  replaceClockTime,
  type EventType,
  type PuppyEvent,
  type PuppyEventChanges,
  type ScheduleEntry,
} from '../domain';
import { spacing, type Theme } from '../theme';

const quickBackdates = [0, 5, 15, 30, 60] as const;
const editableEventTypes = eventTypes.filter((type) => type !== 'nap');

const activityFilters = [
  { id: 'all', label: 'All', icon: 'format-list-bulleted', types: [] },
  { id: 'potty', label: 'Potty', icon: 'water-outline', types: ['pee', 'poop', 'pottyTrip'] },
  { id: 'meals', label: 'Meals', icon: 'food-apple-outline', types: ['meal'] },
  { id: 'walks', label: 'Walks', icon: 'walk', types: ['walk'] },
  { id: 'naps', label: 'Naps', icon: 'sleep', types: ['nap'] },
  { id: 'other', label: 'Other', icon: 'tag-outline', types: ['custom'] },
] as const;

type ActivityFilter = (typeof activityFilters)[number]['id'];

type Draft = {
  event: PuppyEvent;
  type: EventType;
  customLabel: string;
  at: number;
  endedAt?: number | null;
  note: string;
  field: 'start' | 'end';
};

function dateLabel(value: number): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(value);
}

function sectionTitle(key: string): string {
  const date = new Date(`${key}T12:00:00`);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (key === dateKey(today)) return 'Today';
  if (key === dateKey(yesterday)) return 'Yesterday';
  return new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'short', day: 'numeric' }).format(date);
}

export function LogScreen({
  events,
  schedule,
  editEventId,
  onEditRequestHandled,
  onLog,
  onSave,
  onDelete,
  onOpenSchedule,
  theme,
}: {
  events: PuppyEvent[];
  schedule: ScheduleEntry[];
  editEventId?: string | null;
  onEditRequestHandled?: () => void;
  onLog: (type: EventType, customLabel?: string) => void;
  onSave: (event: PuppyEvent, changes: PuppyEventChanges) => Promise<void>;
  onDelete: (event: PuppyEvent) => void;
  onOpenSchedule: () => void;
  theme: Theme;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pickerMode, setPickerMode] = useState<'date' | 'time' | null>(null);
  const [customTouched, setCustomTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>('all');
  const editorScrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!editEventId) return;
    const event = events.find((candidate) => candidate.id === editEventId);
    if (event) {
      setDraft({
        event,
        type: event.type,
        customLabel: event.customLabel ?? '',
        at: event.at,
        endedAt: event.endedAt,
        note: event.note ?? '',
        field: 'start',
      });
    }
    onEditRequestHandled?.();
  }, [editEventId, events, onEditRequestHandled]);
  const visibleEvents = useMemo(() => {
    const selected = activityFilters.find((item) => item.id === activityFilter);
    if (!selected || selected.types.length === 0) return events;
    return events.filter((event) => (selected.types as readonly EventType[]).includes(event.type));
  }, [activityFilter, events]);
  const byDay = new Map<string, PuppyEvent[]>();
  visibleEvents.forEach((event) => {
    const key = dateKey(event.at);
    byDay.set(key, [...(byDay.get(key) ?? []), event]);
  });
  const sections = [...byDay.entries()].map(([key, data]) => ({ key, title: sectionTitle(key), data }));
  const timedNap = draft?.event.type === 'nap' && draft.event.endedAt !== undefined;
  const activeValue = draft?.field === 'end' ? draft.endedAt ?? Date.now() : draft?.at ?? Date.now();
  const pickerDate = new Date(activeValue);
  const draftMeta = draft ? EVENT_META[draft.type] : EVENT_META.pee;
  const customInvalid = draft?.type === 'custom' && !normalizeCustomLabel(draft.customLabel);
  const draftLabel = draft?.type === 'custom'
    ? normalizeCustomLabel(draft.customLabel) ?? 'Other activity'
    : draftMeta.pastLabel;
  const selectedFilter = activityFilters.find((item) => item.id === activityFilter) ?? activityFilters[0];
  const draftHasChanges = Boolean(draft && (
    draft.type !== draft.event.type
    || draft.customLabel !== (draft.event.customLabel ?? '')
    || draft.at !== draft.event.at
    || draft.endedAt !== draft.event.endedAt
    || draft.note !== (draft.event.note ?? '')
  ));
  const todayLabel = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
    .format(now)
    .toUpperCase();

  const setDraftTime = (value: number) => {
    setDraft((current) => {
      if (!current) return null;
      if (current.field === 'end') {
        return { ...current, endedAt: Math.max(current.at, Math.min(value, Date.now())) };
      }
      const latestStart = typeof current.endedAt === 'number' ? current.endedAt : Date.now();
      return { ...current, at: Math.min(value, latestStart) };
    });
  };

  const closeEditor = () => {
    Keyboard.dismiss();
    setPickerMode(null);
    setCustomTouched(false);
    setDraft(null);
  };

  const requestCloseEditor = () => {
    if (saving) return;
    if (!draftHasChanges) {
      closeEditor();
      return;
    }
    Alert.alert('Discard changes?', 'Your edits to this log have not been saved.', [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: closeEditor },
    ]);
  };

  const handleSystemClose = () => {
    if (Keyboard.isVisible()) {
      Keyboard.dismiss();
      return;
    }
    requestCloseEditor();
  };

  const pickDateTime = (event: DateTimePickerEvent, date?: Date) => {
    if (Platform.OS === 'android') setPickerMode(null);
    if (event.type === 'dismissed' || !date || !draft) return;
    setDraftTime(
      pickerMode === 'date'
        ? replaceCalendarDate(activeValue, date)
        : replaceClockTime(activeValue, date.getHours(), date.getMinutes()),
    );
  };

  const saveChanges = async () => {
    if (!draft || saving) return;
    const customLabel = normalizeCustomLabel(draft.customLabel);
    if (draft.type === 'custom' && !customLabel) {
      setCustomTouched(true);
      return;
    }
    setSaving(true);
    try {
      await onSave(draft.event, {
        type: draft.type,
        customLabel,
        at: Math.min(draft.at, Date.now()),
        endedAt: draft.endedAt,
        note: draft.note,
      });
      closeEditor();
    } catch {
      Alert.alert('Couldn’t save changes', 'Your log is unchanged. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.content}
        stickySectionHeadersEnabled={false}
        ListHeaderComponent={
          <>
            <View style={styles.titleBlock}>
              <View style={[styles.mark, { backgroundColor: theme.primary }]}>
                <MaterialCommunityIcons name="paw" size={23} color={theme.onPrimary} />
              </View>
              <View style={styles.titleCopy}>
                <Text style={[styles.eyebrow, { color: theme.primary }]}>PUPTIME · {todayLabel}</Text>
                <Text style={[styles.title, { color: theme.text }]}>What just happened?</Text>
              </View>
            </View>
            <Text style={[styles.subtitle, { color: theme.textMuted }]}>One tap saves the time. Nap toggles between start and end.</Text>
            <QuickActions events={events} onLog={onLog} now={now} theme={theme} />
            <TodayRoutineCard
              events={events}
              schedule={schedule}
              now={now}
              onOpenSchedule={onOpenSchedule}
              theme={theme}
            />
            <View style={styles.activityHeading}>
              <Text style={[styles.sectionTitle, { color: theme.text }]}>Activity</Text>
              <Text style={[styles.count, { color: theme.textMuted }]}>
                {activityFilter === 'all' ? `${events.length} total` : `${visibleEvents.length} shown`}
              </Text>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.filters}
            >
              {activityFilters.map((item) => {
                const selected = activityFilter === item.id;
                return (
                  <Pressable
                    key={item.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    accessibilityLabel={`Show ${item.label.toLowerCase()} activity`}
                    onPress={() => setActivityFilter(item.id)}
                    style={({ pressed }) => [
                      styles.filter,
                      {
                        backgroundColor: selected || pressed ? theme.primarySoft : theme.surfaceRaised,
                        borderColor: selected ? theme.primary : theme.border,
                      },
                    ]}
                  >
                    <MaterialCommunityIcons
                      name={item.icon as keyof typeof MaterialCommunityIcons.glyphMap}
                      size={17}
                      color={selected ? theme.primary : theme.textMuted}
                    />
                    <Text style={[styles.filterText, { color: selected ? theme.primary : theme.textMuted }]}>
                      {item.label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </>
        }
        renderSectionHeader={({ section }) => (
          <Text style={[styles.dayHeading, { color: theme.textMuted }]}>{section.title.toUpperCase()}</Text>
        )}
        renderItem={({ item }) => (
          <EventRow
            event={item}
            now={now}
            onEdit={() => setDraft({
              event: item,
              type: item.type,
              customLabel: item.customLabel ?? '',
              at: item.at,
              endedAt: item.endedAt,
              note: item.note ?? '',
              field: 'start',
            })}
            onDelete={() => onDelete(item)}
            theme={theme}
          />
        )}
        ListEmptyComponent={
          <View style={[styles.empty, { borderColor: theme.border, backgroundColor: theme.surface }]}>
            <MaterialCommunityIcons name={selectedFilter.icon as keyof typeof MaterialCommunityIcons.glyphMap} size={28} color={theme.textMuted} />
            <Text style={[styles.emptyTitle, { color: theme.text }]}>
              {activityFilter === 'all' ? 'Your log starts here' : `No ${selectedFilter.label.toLowerCase()} logged`}
            </Text>
            <Text style={[styles.emptyBody, { color: theme.textMuted }]}>
              {activityFilter === 'all' ? 'Tap an action above when it happens.' : 'Choose another filter or log an activity above.'}
            </Text>
          </View>
        }
      />

      <Modal visible={draft !== null} transparent animationType="none" onRequestClose={handleSystemClose}>
        <View accessibilityViewIsModal style={styles.scrim}>
          <ScrollView
            ref={editorScrollRef}
            bounces={false}
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
            keyboardShouldPersistTaps="handled"
            style={[styles.sheet, { backgroundColor: theme.surfaceRaised }]}
            contentContainerStyle={styles.sheetContent}
          >
            <View style={styles.sheetHeading}>
              <View style={[styles.editorIcon, { backgroundColor: draftMeta.softColor }]}>
                <MaterialCommunityIcons
                  name={draftMeta.icon as keyof typeof MaterialCommunityIcons.glyphMap}
                  color={draftMeta.color}
                  size={23}
                />
              </View>
              <View style={styles.editorHeadingCopy}>
                <Text style={[styles.sheetTitle, { color: theme.text }]}>{timedNap ? 'Edit nap' : 'Edit log'}</Text>
                <Text
                  style={[styles.sheetSubtitle, { color: theme.textMuted }]}
                >
                  {draft?.event.type === 'nap'
                    ? `${draftLabel} · Correct the timing or note.`
                    : `${draftLabel} · Correct the activity, timing, or note.`}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close log editor"
                onPress={requestCloseEditor}
                style={({ pressed }) => [styles.closeButton, pressed && { backgroundColor: theme.primarySoft }]}
              >
                <MaterialCommunityIcons name="close" size={22} color={theme.text} />
              </Pressable>
            </View>

            {draft && draft.event.type !== 'nap' ? (
              <>
                <Text style={[styles.fieldLabel, { color: theme.textMuted }]}>ACTIVITY</Text>
                <View style={styles.typePicker}>
                  {editableEventTypes.map((type) => {
                    const meta = EVENT_META[type];
                    const selected = draft.type === type;
                    return (
                      <Pressable
                        key={type}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        accessibilityLabel={`Change activity to ${meta.label}`}
                        onPress={() => {
                          setCustomTouched(false);
                          setDraft((current) => current && ({ ...current, type }));
                        }}
                        style={({ pressed }) => [
                          styles.typeChoice,
                          {
                            backgroundColor: selected ? meta.softColor : theme.surface,
                            borderColor: selected || pressed ? meta.color : theme.border,
                          },
                        ]}
                      >
                        <MaterialCommunityIcons
                          name={meta.icon as keyof typeof MaterialCommunityIcons.glyphMap}
                          color={selected ? meta.color : theme.textMuted}
                          size={20}
                        />
                        <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.typeChoiceText, { color: selected ? meta.color : theme.text }]}>
                          {meta.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                {draft.type === 'custom' ? (
                  <View style={styles.customField}>
                    <Text style={[styles.fieldLabel, { color: theme.textMuted }]}>CUSTOM NAME</Text>
                    <TextInput
                      accessibilityLabel="Custom activity name"
                      accessibilityHint="Required before saving"
                      autoCapitalize="sentences"
                      maxLength={40}
                      onBlur={() => setCustomTouched(true)}
                      onChangeText={(customLabel) => setDraft((current) => current && ({ ...current, customLabel }))}
                      onSubmitEditing={saveChanges}
                      placeholder="e.g. Grooming"
                      placeholderTextColor={theme.textMuted}
                      returnKeyType="done"
                      value={draft.customLabel}
                      style={[
                        styles.customInput,
                        {
                          backgroundColor: theme.surface,
                          borderColor: customTouched && customInvalid ? theme.danger : theme.border,
                          color: theme.text,
                        },
                      ]}
                    />
                    <Text
                      accessibilityLiveRegion="polite"
                      style={[styles.customHint, { color: customTouched && customInvalid ? theme.danger : theme.textMuted }]}
                    >
                      {customTouched && customInvalid ? 'Enter an activity name.' : 'Use a short name you’ll recognize in the log.'}
                    </Text>
                  </View>
                ) : null}
              </>
            ) : null}

            <View style={[styles.timePreview, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <Text style={[styles.previewTime, { color: theme.text }]}>
                {timedNap
                  ? `${formatTime(draft?.at ?? Date.now())}–${typeof draft?.endedAt === 'number' ? formatTime(draft.endedAt) : 'now'}`
                  : formatTime(draft?.at ?? Date.now())}
              </Text>
              <Text style={[styles.previewDate, { color: theme.textMuted }]}>
                {timedNap
                  ? `${formatDuration((draft?.endedAt ?? Date.now()) - (draft?.at ?? Date.now()))}${draft?.endedAt === null ? ' · in progress' : ''}`
                  : `${dateLabel(draft?.at ?? Date.now())} · ${relativeTime(draft?.at ?? Date.now())}`}
              </Text>
            </View>

            {timedNap ? (
              <View style={styles.timeFields}>
                {(['start', 'end'] as const).map((field) => {
                  const selected = draft?.field === field;
                  const value = field === 'start' ? draft?.at : draft?.endedAt;
                  return (
                    <Pressable
                      key={field}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      accessibilityLabel={`Edit nap ${field} time`}
                      onPress={() => setDraft((current) => current && ({ ...current, field }))}
                      style={({ pressed }) => [
                        styles.timeField,
                        {
                          backgroundColor: selected ? draftMeta.softColor : theme.surface,
                          borderColor: selected || pressed ? draftMeta.color : theme.border,
                        },
                      ]}
                    >
                      <Text style={[styles.timeFieldLabel, { color: theme.textMuted }]}>{field.toUpperCase()}</Text>
                      <Text style={[styles.timeFieldValue, { color: theme.text }]}>
                        {typeof value === 'number' ? formatTime(value) : 'In progress'}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}

            <Text style={[styles.fieldLabel, { color: theme.textMuted }]}>
              {timedNap ? `SET ${draft?.field?.toUpperCase() ?? 'START'}` : 'QUICK BACKDATE'}
            </Text>
            <View style={styles.quickTimes}>
              {quickBackdates.map((minutes) => (
                <Pressable
                  key={minutes}
                  accessibilityRole="button"
                  accessibilityLabel={minutes ? `Set time to ${minutes} minutes ago` : 'Set time to now'}
                  onPress={() => setDraftTime(Date.now() - minutes * 60_000)}
                  style={({ pressed }) => [
                    styles.quickTime,
                    {
                      backgroundColor: pressed ? theme.primarySoft : theme.surface,
                      borderColor: theme.border,
                    },
                  ]}
                >
                  <Text style={[styles.quickTimeText, { color: theme.text }]}>{minutes ? `${minutes}m ago` : 'Now'}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={[styles.fieldLabel, { color: theme.textMuted }]}>DATE & TIME</Text>
            <View style={styles.exactFields}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: pickerMode === 'date' }}
                accessibilityLabel={`Choose ${draft?.field ?? 'log'} date, currently ${dateLabel(activeValue)}`}
                onPress={() => setPickerMode('date')}
                style={({ pressed }) => [
                  styles.exactField,
                  {
                    backgroundColor: pickerMode === 'date' ? theme.primarySoft : theme.surface,
                    borderColor: pickerMode === 'date' || pressed ? theme.primary : theme.border,
                  },
                ]}
              >
                <MaterialCommunityIcons name="calendar-outline" size={21} color={theme.primary} />
                <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.exactFieldText, { color: theme.text }]}>
                  {dateLabel(activeValue)}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: pickerMode === 'time' }}
                accessibilityLabel={`Choose exact ${draft?.field ?? 'log'} time, currently ${formatTime(activeValue)}`}
                onPress={() => setPickerMode('time')}
                style={({ pressed }) => [
                  styles.exactField,
                  {
                    backgroundColor: pickerMode === 'time' ? theme.primarySoft : theme.surface,
                    borderColor: pickerMode === 'time' || pressed ? theme.primary : theme.border,
                  },
                ]}
              >
                <MaterialCommunityIcons name="clock-outline" size={21} color={theme.primary} />
                <Text numberOfLines={1} style={[styles.exactFieldText, { color: theme.text }]}>{formatTime(activeValue)}</Text>
              </Pressable>
            </View>
            {pickerMode ? (
              <>
                <DateTimePicker
                  value={pickerDate}
                  mode={pickerMode}
                  display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                  maximumDate={pickerMode === 'date' ? new Date() : undefined}
                  onChange={pickDateTime}
                />
                {Platform.OS === 'ios' ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Finish choosing ${pickerMode}`}
                    onPress={() => setPickerMode(null)}
                    style={({ pressed }) => [styles.pickerDone, pressed && { backgroundColor: theme.primarySoft }]}
                  >
                    <Text style={[styles.pickerDoneText, { color: theme.primary }]}>Done</Text>
                  </Pressable>
                ) : null}
              </>
            ) : null}

            <Text style={[styles.fieldLabel, styles.noteLabel, { color: theme.textMuted }]}>NOTE</Text>
            {draft ? (
              <NoteInput
                key={draft.event.id}
                value={draft.note}
                onChangeText={(note) => setDraft((current) => current && ({ ...current, note }))}
                onFocus={() => editorScrollRef.current?.scrollToEnd({ animated: true })}
                theme={theme}
              />
            ) : null}

            <Pressable
              accessibilityRole="button"
              accessibilityState={{ busy: saving, disabled: saving || customInvalid }}
              accessibilityHint={customInvalid ? 'Enter a custom activity name before saving' : undefined}
              disabled={saving || customInvalid}
              onPress={saveChanges}
              style={({ pressed }) => [
                styles.saveButton,
                { backgroundColor: pressed ? theme.primaryPressed : theme.primary, opacity: saving || customInvalid ? 0.45 : 1 },
              ]}
            >
              <Text style={[styles.saveText, { color: theme.onPrimary }]}>{saving ? 'Saving…' : 'Save changes'}</Text>
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
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
  },
  titleBlock: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  mark: { width: 44, height: 44, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  titleCopy: { flex: 1 },
  eyebrow: { fontSize: 11, fontWeight: '800', letterSpacing: 1.6 },
  title: { fontSize: 27, lineHeight: 33, fontWeight: '800', letterSpacing: -0.5 },
  subtitle: { fontSize: 15, lineHeight: 22, marginTop: 8, marginBottom: spacing.md },
  activityHeading: { marginTop: spacing.xl, marginBottom: 12, flexDirection: 'row', alignItems: 'baseline' },
  sectionTitle: { flex: 1, fontSize: 21, fontWeight: '800' },
  count: { fontSize: 13, fontWeight: '600' },
  filters: { gap: 8, paddingBottom: 8 },
  filter: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 13,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  filterText: { fontSize: 13, lineHeight: 18, fontWeight: '700' },
  dayHeading: { fontSize: 11, fontWeight: '800', letterSpacing: 1.2, marginTop: 8, marginBottom: 8 },
  empty: { borderWidth: 1, borderStyle: 'dashed', borderRadius: 20, padding: spacing.lg, alignItems: 'center' },
  emptyTitle: { fontSize: 17, fontWeight: '700', marginTop: 8 },
  emptyBody: { fontSize: 14, textAlign: 'center', lineHeight: 21, marginTop: 4 },
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
  sheetHeading: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: spacing.md },
  editorIcon: { width: 46, height: 46, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  editorHeadingCopy: { flex: 1, minWidth: 0 },
  sheetTitle: { fontSize: 20, lineHeight: 25, fontWeight: '800' },
  sheetSubtitle: { fontSize: 13, lineHeight: 18, marginTop: 2 },
  closeButton: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  timePreview: { borderWidth: 1, borderRadius: 18, padding: spacing.md, alignItems: 'center', marginBottom: spacing.lg },
  typePicker: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: spacing.md },
  typeChoice: { flexBasis: '30%', flexGrow: 1, minWidth: 88, minHeight: 48, borderWidth: 1, borderRadius: 14, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  typeChoiceText: { minWidth: 0, flexShrink: 1, fontSize: 13, lineHeight: 18, fontWeight: '700' },
  customField: { marginBottom: spacing.lg },
  customInput: { minHeight: 52, borderWidth: 1, borderRadius: 15, paddingHorizontal: 14, fontSize: 16 },
  customHint: { minHeight: 18, fontSize: 12, lineHeight: 18, marginTop: 5 },
  previewTime: { fontSize: 34, lineHeight: 40, fontWeight: '800', fontVariant: ['tabular-nums'] },
  previewDate: { fontSize: 13, lineHeight: 18, marginTop: 2 },
  timeFields: { flexDirection: 'row', gap: 8, marginBottom: spacing.lg },
  timeField: { flex: 1, minHeight: 64, borderWidth: 1, borderRadius: 16, paddingHorizontal: 14, justifyContent: 'center' },
  timeFieldLabel: { fontSize: 10, lineHeight: 14, fontWeight: '800', letterSpacing: 1.1 },
  timeFieldValue: { fontSize: 17, lineHeight: 23, fontWeight: '700', fontVariant: ['tabular-nums'] },
  fieldLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 1.2, marginBottom: 8 },
  noteLabel: { marginTop: spacing.lg },
  quickTimes: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: spacing.lg },
  quickTime: { flexGrow: 1, minWidth: 88, minHeight: 48, borderWidth: 1, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  quickTimeText: { fontSize: 14, fontWeight: '700' },
  exactFields: { flexDirection: 'row', gap: 8 },
  exactField: { flex: 1, minWidth: 0, minHeight: 58, borderWidth: 1, borderRadius: 16, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, gap: 8 },
  exactFieldText: { flex: 1, minWidth: 0, fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] },
  pickerDone: { minHeight: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  pickerDoneText: { fontSize: 15, fontWeight: '800' },
  saveButton: { minHeight: 56, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginTop: spacing.lg },
  saveText: { fontSize: 16, fontWeight: '800' },
});

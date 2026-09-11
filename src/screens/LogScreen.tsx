import { MaterialCommunityIcons } from '@expo/vector-icons';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useEffect, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, SectionList, StyleSheet, Text, View } from 'react-native';

import { QuickActions } from '../components/QuickActions';
import { EventRow } from '../components/EventRow';
import { NoteInput } from '../components/NoteInput';
import {
  dateKey,
  EVENT_META,
  eventPastLabel,
  formatDuration,
  formatTime,
  relativeTime,
  replaceClockTime,
  type EventType,
  type PuppyEvent,
} from '../domain';
import { spacing, type Theme } from '../theme';

const quickBackdates = [0, 5, 15, 30, 60] as const;

type Draft = {
  event: PuppyEvent;
  at: number;
  endedAt?: number | null;
  note: string;
  field: 'start' | 'end';
};

function dateLabel(value: number): string {
  return new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).format(value);
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
  editEventId,
  onEditRequestHandled,
  onLog,
  onSave,
  onDelete,
  theme,
}: {
  events: PuppyEvent[];
  editEventId?: string | null;
  onEditRequestHandled?: () => void;
  onLog: (type: EventType, customLabel?: string) => void;
  onSave: (event: PuppyEvent, at: number, endedAt: number | null | undefined, note: string) => Promise<void>;
  onDelete: (event: PuppyEvent) => void;
  theme: Theme;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [showAndroidPicker, setShowAndroidPicker] = useState(false);
  const [saving, setSaving] = useState(false);
  const [now, setNow] = useState(Date.now());

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
        at: event.at,
        endedAt: event.endedAt,
        note: event.note ?? '',
        field: 'start',
      });
    }
    onEditRequestHandled?.();
  }, [editEventId, events, onEditRequestHandled]);
  const byDay = new Map<string, PuppyEvent[]>();
  events.forEach((event) => {
    const key = dateKey(event.at);
    byDay.set(key, [...(byDay.get(key) ?? []), event]);
  });
  const sections = [...byDay.entries()].map(([key, data]) => ({ key, title: sectionTitle(key), data }));
  const timedNap = draft?.event.type === 'nap' && draft.event.endedAt !== undefined;
  const activeValue = draft?.field === 'end' ? draft.endedAt ?? Date.now() : draft?.at ?? Date.now();
  const pickerDate = new Date(activeValue);
  const draftMeta = draft ? EVENT_META[draft.event.type] : EVENT_META.pee;

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

  const pickTime = (event: DateTimePickerEvent, date?: Date) => {
    if (Platform.OS === 'android') setShowAndroidPicker(false);
    if (event.type === 'dismissed' || !date || !draft) return;
    setDraftTime(replaceClockTime(activeValue, date.getHours(), date.getMinutes()));
  };

  const saveTime = async () => {
    if (!draft || saving) return;
    setSaving(true);
    try {
      await onSave(draft.event, Math.min(draft.at, Date.now()), draft.endedAt, draft.note.trim());
      setDraft(null);
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
                <Text style={[styles.eyebrow, { color: theme.primary }]}>PUPTIME</Text>
                <Text style={[styles.title, { color: theme.text }]}>What just happened?</Text>
              </View>
            </View>
            <Text style={[styles.subtitle, { color: theme.textMuted }]}>One tap saves the time. Nap toggles between start and end.</Text>
            <QuickActions events={events} onLog={onLog} now={now} theme={theme} />
            <View style={styles.activityHeading}>
              <Text style={[styles.sectionTitle, { color: theme.text }]}>Activity</Text>
              <Text style={[styles.count, { color: theme.textMuted }]}>{events.length} total</Text>
            </View>
          </>
        }
        renderSectionHeader={({ section }) => (
          <Text style={[styles.dayHeading, { color: theme.textMuted }]}>{section.title.toUpperCase()}</Text>
        )}
        renderItem={({ item }) => (
          <EventRow
            event={item}
            now={now}
            onEditTime={() => setDraft({ event: item, at: item.at, endedAt: item.endedAt, note: item.note ?? '', field: 'start' })}
            onDelete={() => onDelete(item)}
            theme={theme}
          />
        )}
        ListEmptyComponent={
          <View style={[styles.empty, { borderColor: theme.border, backgroundColor: theme.surface }]}>
            <MaterialCommunityIcons name="paw-outline" size={28} color={theme.textMuted} />
            <Text style={[styles.emptyTitle, { color: theme.text }]}>Your log starts here</Text>
            <Text style={[styles.emptyBody, { color: theme.textMuted }]}>Tap an action above when it happens.</Text>
          </View>
        }
      />

      <Modal visible={draft !== null} transparent animationType="none" onRequestClose={() => setDraft(null)}>
        <View accessibilityViewIsModal style={styles.scrim}>
          <ScrollView
            bounces={false}
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
                  {draft ? eventPastLabel(draft.event) : draftMeta.pastLabel} · Adjust the time or add a note.
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close log editor"
                onPress={() => setDraft(null)}
                style={({ pressed }) => [styles.closeButton, pressed && { backgroundColor: theme.primarySoft }]}
              >
                <MaterialCommunityIcons name="close" size={22} color={theme.text} />
              </Pressable>
            </View>

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

            <Text style={[styles.fieldLabel, { color: theme.textMuted }]}>EXACT TIME</Text>
            {Platform.OS === 'ios' ? (
              <DateTimePicker value={pickerDate} mode="time" display="spinner" onChange={pickTime} />
            ) : (
              <>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Choose exact ${draft?.field ?? 'log'} time, currently ${formatTime(activeValue)}`}
                  onPress={() => setShowAndroidPicker(true)}
                  style={({ pressed }) => [
                    styles.exactTime,
                    { backgroundColor: theme.surface, borderColor: pressed ? theme.primary : theme.border },
                  ]}
                >
                  <MaterialCommunityIcons name="clock-outline" size={22} color={theme.primary} />
                  <Text style={[styles.exactTimeText, { color: theme.text }]}>{formatTime(activeValue)}</Text>
                  <Text style={[styles.changeText, { color: theme.primary }]}>Change</Text>
                </Pressable>
                {showAndroidPicker ? <DateTimePicker value={pickerDate} mode="time" onChange={pickTime} /> : null}
              </>
            )}

            <Text style={[styles.fieldLabel, styles.noteLabel, { color: theme.textMuted }]}>NOTE</Text>
            {draft ? (
              <NoteInput
                key={draft.event.id}
                value={draft.note}
                onChangeText={(note) => setDraft((current) => current && ({ ...current, note }))}
                theme={theme}
              />
            ) : null}

            <Pressable
              accessibilityRole="button"
              accessibilityState={{ busy: saving, disabled: saving }}
              disabled={saving}
              onPress={saveTime}
              style={({ pressed }) => [
                styles.saveButton,
                { backgroundColor: pressed ? theme.primaryPressed : theme.primary, opacity: saving ? 0.55 : 1 },
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
  exactTime: { minHeight: 58, borderWidth: 1, borderRadius: 16, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, gap: 10 },
  exactTimeText: { flex: 1, fontSize: 18, fontWeight: '700', fontVariant: ['tabular-nums'] },
  changeText: { fontSize: 14, fontWeight: '700' },
  saveButton: { minHeight: 56, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginTop: spacing.lg },
  saveText: { fontSize: 16, fontWeight: '800' },
});

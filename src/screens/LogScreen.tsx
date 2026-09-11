import { MaterialCommunityIcons } from '@expo/vector-icons';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, SectionList, StyleSheet, Text, View } from 'react-native';

import { QuickActions } from '../components/QuickActions';
import { EventRow } from '../components/EventRow';
import {
  dateKey,
  EVENT_META,
  formatTime,
  relativeTime,
  replaceClockTime,
  type EventType,
  type PuppyEvent,
} from '../domain';
import { spacing, type Theme } from '../theme';

const quickBackdates = [0, 5, 15, 30, 60] as const;

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
  onLog,
  onChangeTime,
  onDelete,
  theme,
}: {
  events: PuppyEvent[];
  onLog: (type: EventType) => void;
  onChangeTime: (event: PuppyEvent, at: number) => Promise<void>;
  onDelete: (event: PuppyEvent) => void;
  theme: Theme;
}) {
  const [draft, setDraft] = useState<{ event: PuppyEvent; at: number } | null>(null);
  const [showAndroidPicker, setShowAndroidPicker] = useState(false);
  const byDay = new Map<string, PuppyEvent[]>();
  events.forEach((event) => {
    const key = dateKey(event.at);
    byDay.set(key, [...(byDay.get(key) ?? []), event]);
  });
  const sections = [...byDay.entries()].map(([key, data]) => ({ key, title: sectionTitle(key), data }));
  const pickerDate = new Date(draft?.at ?? Date.now());
  const draftMeta = draft ? EVENT_META[draft.event.type] : EVENT_META.pee;

  const pickTime = (event: DateTimePickerEvent, date?: Date) => {
    if (Platform.OS === 'android') setShowAndroidPicker(false);
    if (event.type === 'dismissed' || !date || !draft) return;
    setDraft({
      ...draft,
      at: replaceClockTime(draft.at, date.getHours(), date.getMinutes()),
    });
  };

  const saveTime = async () => {
    if (!draft) return;
    await onChangeTime(draft.event, Math.min(draft.at, Date.now()));
    setDraft(null);
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
            <Text style={[styles.subtitle, { color: theme.textMuted }]}>One tap saves the current time.</Text>
            <QuickActions events={events} onLog={onLog} theme={theme} />
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
            onEditTime={() => setDraft({ event: item, at: item.at })}
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

      <Modal visible={draft !== null} transparent animationType="fade" onRequestClose={() => setDraft(null)}>
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
                <Text style={[styles.sheetTitle, { color: theme.text }]}>Edit log time</Text>
                <Text style={[styles.sheetSubtitle, { color: theme.textMuted }]}>
                  {draftMeta.pastLabel} · Choose a shortcut or exact time.
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close time editor"
                onPress={() => setDraft(null)}
                style={({ pressed }) => [styles.closeButton, pressed && { backgroundColor: theme.primarySoft }]}
              >
                <MaterialCommunityIcons name="close" size={22} color={theme.text} />
              </Pressable>
            </View>

            <View style={[styles.timePreview, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <Text style={[styles.previewTime, { color: theme.text }]}>{formatTime(draft?.at ?? Date.now())}</Text>
              <Text style={[styles.previewDate, { color: theme.textMuted }]}>
                {dateLabel(draft?.at ?? Date.now())} · {relativeTime(draft?.at ?? Date.now())}
              </Text>
            </View>

            <Text style={[styles.fieldLabel, { color: theme.textMuted }]}>QUICK BACKDATE</Text>
            <View style={styles.quickTimes}>
              {quickBackdates.map((minutes) => (
                <Pressable
                  key={minutes}
                  accessibilityRole="button"
                  accessibilityLabel={minutes ? `Set time to ${minutes} minutes ago` : 'Set time to now'}
                  onPress={() => setDraft((current) => current && ({ ...current, at: Date.now() - minutes * 60_000 }))}
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
                  accessibilityLabel={`Choose exact time, currently ${formatTime(draft?.at ?? Date.now())}`}
                  onPress={() => setShowAndroidPicker(true)}
                  style={({ pressed }) => [
                    styles.exactTime,
                    { backgroundColor: theme.surface, borderColor: pressed ? theme.primary : theme.border },
                  ]}
                >
                  <MaterialCommunityIcons name="clock-outline" size={22} color={theme.primary} />
                  <Text style={[styles.exactTimeText, { color: theme.text }]}>{formatTime(draft?.at ?? Date.now())}</Text>
                  <Text style={[styles.changeText, { color: theme.primary }]}>Change</Text>
                </Pressable>
                {showAndroidPicker ? <DateTimePicker value={pickerDate} mode="time" onChange={pickTime} /> : null}
              </>
            )}

            <Pressable
              accessibilityRole="button"
              onPress={saveTime}
              style={({ pressed }) => [
                styles.saveButton,
                { backgroundColor: pressed ? theme.primaryPressed : theme.primary },
              ]}
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
  fieldLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 1.2, marginBottom: 8 },
  quickTimes: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: spacing.lg },
  quickTime: { flexGrow: 1, minWidth: 88, minHeight: 48, borderWidth: 1, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  quickTimeText: { fontSize: 14, fontWeight: '700' },
  exactTime: { minHeight: 58, borderWidth: 1, borderRadius: 16, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, gap: 10 },
  exactTimeText: { flex: 1, fontSize: 18, fontWeight: '700', fontVariant: ['tabular-nums'] },
  changeText: { fontSize: 14, fontWeight: '700' },
  saveButton: { minHeight: 56, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginTop: spacing.lg },
  saveText: { fontSize: 16, fontWeight: '800' },
});

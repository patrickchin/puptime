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
  quickEventTypes,
  relativeTime,
  replaceCalendarDate,
  replaceClockTime,
  type EventType,
  type QuickEventType,
  type PuppyEvent,
  type PuppyEventChanges,
  type ScheduleEntry,
} from '../domain';
import { spacing, type Theme } from '../theme';

const quickBackdates = [0, 5, 15, 30, 60] as const;
const editableEventTypes = eventTypes.filter((type) => type !== 'nap');
const autoSaveDelayMs = 450;
const recentHistoryDays = 10;
const sectionDate = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
const sectionDateWithYear = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});
const archiveMonth = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });

const activityFilters = [
  { id: 'all', label: 'All', icon: 'format-list-bulleted', types: [] },
  { id: 'potty', label: 'Potty', icon: 'water-outline', types: ['pee', 'poop', 'pottyTrip'] },
  { id: 'meals', label: 'Meals', icon: 'food-apple-outline', types: ['meal'] },
  { id: 'walks', label: 'Walks', icon: 'walk', types: ['walk'] },
  { id: 'naps', label: 'Naps', icon: 'sleep', types: ['nap'] },
  { id: 'other', label: 'Other', icon: 'tag-outline', types: ['custom'] },
] as const;

type ActivityFilter = (typeof activityFilters)[number]['id'];
type HistoryScope = 'recent' | 'all';

type Draft = {
  event: PuppyEvent;
  type: EventType;
  customLabel: string;
  at: number;
  endedAt?: number | null;
  note: string;
  field: 'start' | 'end';
};

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

function createDraft(event: PuppyEvent): Draft {
  return {
    event,
    type: event.type,
    customLabel: event.customLabel ?? '',
    at: event.at,
    endedAt: event.endedAt,
    note: event.note ?? '',
    field: 'start',
  };
}

function samePersistedDraft(left: Draft, right: Draft): boolean {
  return left.type === right.type
    && left.customLabel === right.customLabel
    && left.at === right.at
    && left.endedAt === right.endedAt
    && left.note === right.note;
}

function draftChanges(draft: Draft): PuppyEventChanges {
  return {
    type: draft.type,
    customLabel: normalizeCustomLabel(draft.customLabel),
    at: Math.min(draft.at, Date.now()),
    endedAt: draft.endedAt,
    note: draft.note,
  };
}

function dateLabel(value: number): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(value);
}

function sectionTitle(key: string, todayKey: string, yesterdayKey: string, currentYear: number): string {
  const date = new Date(`${key}T12:00:00`);
  if (key === todayKey) return 'Today';
  if (key === yesterdayKey) return 'Yesterday';
  return (date.getFullYear() === currentYear ? sectionDate : sectionDateWithYear).format(date);
}

function monthTitle(key: string): string {
  return archiveMonth.format(new Date(`${key}-01T12:00:00`));
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
  onOpenThemePicker,
  widgetActions,
  onWidgetActionsChange,
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
  onOpenThemePicker: () => void;
  widgetActions: QuickEventType[];
  onWidgetActionsChange: (actions: QuickEventType[]) => Promise<void>;
  theme: Theme;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pickerMode, setPickerMode] = useState<'date' | 'time' | null>(null);
  const [customTouched, setCustomTouched] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [closing, setClosing] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>('all');
  const [showWidgetSettings, setShowWidgetSettings] = useState(false);
  const [widgetDraft, setWidgetDraft] = useState<QuickEventType[]>(widgetActions);
  const [savingWidgetSettings, setSavingWidgetSettings] = useState(false);
  const [historyScope, setHistoryScope] = useState<HistoryScope>('recent');
  const editorScrollRef = useRef<ScrollView>(null);
  const draftRef = useRef<Draft | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const revisionRef = useRef(0);
  const savedRevisionRef = useRef(0);
  const inFlightRevisionRef = useRef(-1);
  const sessionRef = useRef(0);
  const latestSaveRef = useRef<Promise<boolean>>(Promise.resolve(true));
  const closingRef = useRef(false);

  const clearSaveTimer = () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
  };

  const startEditing = (event: PuppyEvent) => {
    clearSaveTimer();
    sessionRef.current += 1;
    revisionRef.current = 0;
    savedRevisionRef.current = 0;
    inFlightRevisionRef.current = -1;
    latestSaveRef.current = Promise.resolve(true);
    closingRef.current = false;
    setSaveStatus('idle');
    setClosing(false);
    setCustomTouched(false);
    const next = createDraft(event);
    draftRef.current = next;
    setDraft(next);
  };

  const persistDraft = (next: Draft, revision: number, session: number): Promise<boolean> => {
    setSaveStatus('saving');
    inFlightRevisionRef.current = revision;
    const save = onSave(next.event, draftChanges(next))
      .then(() => {
        if (sessionRef.current === session) {
          savedRevisionRef.current = Math.max(savedRevisionRef.current, revision);
          if (revisionRef.current === revision) setSaveStatus('saved');
        }
        return true;
      })
      .catch(() => {
        if (sessionRef.current === session && revisionRef.current === revision) {
          setSaveStatus('error');
        }
        return false;
      })
      .finally(() => {
        if (sessionRef.current === session && inFlightRevisionRef.current === revision) {
          inFlightRevisionRef.current = -1;
        }
      });
    latestSaveRef.current = save;
    return save;
  };

  const scheduleSave = (next: Draft) => {
    clearSaveTimer();
    revisionRef.current += 1;
    const revision = revisionRef.current;
    const session = sessionRef.current;
    if (next.type === 'custom' && !normalizeCustomLabel(next.customLabel)) {
      setSaveStatus('idle');
      return;
    }
    setSaveStatus('saving');
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      void persistDraft(next, revision, session);
    }, autoSaveDelayMs);
  };

  const updateDraft = (updater: (current: Draft) => Draft, shouldSave = true) => {
    const current = draftRef.current;
    if (!current) return;
    const next = updater(current);
    draftRef.current = next;
    setDraft(next);
    if (shouldSave && !samePersistedDraft(current, next)) scheduleSave(next);
  };

  const flushAutoSave = async (forceRetry = false): Promise<boolean> => {
    const current = draftRef.current;
    if (!current) return true;
    if (current.type === 'custom' && !normalizeCustomLabel(current.customLabel)) {
      setCustomTouched(true);
      return false;
    }
    const revision = revisionRef.current;
    const session = sessionRef.current;
    const hadTimer = saveTimerRef.current !== null;
    clearSaveTimer();
    if (!forceRetry && savedRevisionRef.current >= revision) return true;
    if (!forceRetry && !hadTimer && inFlightRevisionRef.current === revision) {
      return latestSaveRef.current;
    }
    return persistDraft(current, revision, session);
  };

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => () => clearSaveTimer(), []);
  useEffect(() => {
    if (!editEventId) return;
    const event = events.find((candidate) => candidate.id === editEventId);
    if (event) startEditing(event);
    onEditRequestHandled?.();
  }, [editEventId, events, onEditRequestHandled]);
  const filteredEvents = useMemo(() => {
    const selected = activityFilters.find((item) => item.id === activityFilter);
    if (!selected || selected.types.length === 0) return events;
    return events.filter((event) => (selected.types as readonly EventType[]).includes(event.type));
  }, [activityFilter, events]);
  const todayKey = dateKey(now);
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = dateKey(yesterday);
  const currentYear = new Date(now).getFullYear();
  const recentStartDate = new Date(now);
  recentStartDate.setHours(0, 0, 0, 0);
  recentStartDate.setDate(recentStartDate.getDate() - (recentHistoryDays - 1));
  const recentStart = recentStartDate.getTime();
  const recentEvents = useMemo(
    () => filteredEvents.filter((event) => event.at >= recentStart),
    [filteredEvents, recentStart],
  );
  const visibleEvents = historyScope === 'all' ? filteredEvents : recentEvents;
  const olderEventCount = filteredEvents.length - recentEvents.length;
  const sections = useMemo(() => {
    const byDay = new Map<string, PuppyEvent[]>();
    visibleEvents.forEach((event) => {
      const key = dateKey(event.at);
      const day = byDay.get(key);
      if (day) day.push(event);
      else byDay.set(key, [event]);
    });
    let previousMonth = '';
    return [...byDay.entries()].map(([key, data]) => {
      const monthKey = key.slice(0, 7);
      const startsMonth = historyScope === 'all' && monthKey !== previousMonth;
      previousMonth = monthKey;
      return {
        key,
        title: sectionTitle(key, todayKey, yesterdayKey, currentYear),
        data,
        monthTitle: startsMonth ? monthTitle(monthKey) : undefined,
      };
    });
  }, [currentYear, historyScope, todayKey, visibleEvents, yesterdayKey]);
  const timedNap = draft?.event.type === 'nap' && draft.event.endedAt !== undefined;
  const activeValue = draft?.field === 'end' ? draft.endedAt ?? Date.now() : draft?.at ?? Date.now();
  const pickerDate = new Date(activeValue);
  const draftMeta = draft ? EVENT_META[draft.type] : EVENT_META.pee;
  const customInvalid = draft?.type === 'custom' && !normalizeCustomLabel(draft.customLabel);
  const draftLabel = draft?.type === 'custom'
    ? normalizeCustomLabel(draft.customLabel) ?? 'Other activity'
    : draftMeta.pastLabel;
  const selectedFilter = activityFilters.find((item) => item.id === activityFilter) ?? activityFilters[0];
  const todayLabel = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
    .format(now)
    .toUpperCase();

  const statusPresentation = customInvalid
    ? { icon: 'alert-circle-outline', text: 'Add a custom name to save this activity.', color: theme.danger }
    : saveStatus === 'saving'
      ? { icon: 'cloud-upload-outline', text: 'Saving changes…', color: theme.primary }
      : saveStatus === 'saved'
        ? { icon: 'check-circle-outline', text: 'Saved automatically', color: theme.primary }
        : saveStatus === 'error'
          ? { icon: 'alert-circle-outline', text: 'Couldn’t save. Tap to retry.', color: theme.danger }
          : { icon: 'cloud-check-outline', text: 'Changes save automatically', color: theme.textMuted };

  const setDraftTime = (value: number) => {
    updateDraft((current) => {
      if (current.field === 'end') {
        return { ...current, endedAt: Math.max(current.at, Math.min(value, Date.now())) };
      }
      const latestStart = typeof current.endedAt === 'number' ? current.endedAt : Date.now();
      return { ...current, at: Math.min(value, latestStart) };
    });
  };

  const closeEditor = () => {
    clearSaveTimer();
    sessionRef.current += 1;
    draftRef.current = null;
    Keyboard.dismiss();
    setPickerMode(null);
    setCustomTouched(false);
    setSaveStatus('idle');
    closingRef.current = false;
    setClosing(false);
    setDraft(null);
  };

  const requestCloseEditor = async () => {
    if (closingRef.current) return;
    if (customInvalid) {
      setCustomTouched(true);
      return;
    }
    closingRef.current = true;
    setClosing(true);
    const saved = await flushAutoSave();
    if (saved) {
      closeEditor();
      return;
    }
    closingRef.current = false;
    setClosing(false);
    Alert.alert('Couldn’t save changes', 'Keep the editor open and tap the save status to try again.');
  };

  const handleSystemClose = () => {
    if (Keyboard.isVisible()) {
      Keyboard.dismiss();
      return;
    }
    void requestCloseEditor();
  };

  const openWidgetSettings = () => {
    setWidgetDraft(widgetActions);
    setShowWidgetSettings(true);
  };

  const toggleWidgetAction = (type: QuickEventType) => {
    setWidgetDraft((current) => {
      if (current.includes(type)) {
        return current.length > 2 ? current.filter((item) => item !== type) : current;
      }
      return current.length < 4 ? [...current, type] : current;
    });
  };

  const saveWidgetSettings = async () => {
    setSavingWidgetSettings(true);
    try {
      await onWidgetActionsChange(widgetDraft);
      setShowWidgetSettings(false);
    } catch {
      Alert.alert('Couldn’t save widget settings', 'Try again.');
    } finally {
      setSavingWidgetSettings(false);
    }
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
              <View style={styles.headerActions}>
                <Pressable
                  accessibilityLabel="Customize home-screen widget"
                  accessibilityRole="button"
                  onPress={openWidgetSettings}
                  style={({ pressed }) => [
                    styles.headerButton,
                    {
                      backgroundColor: pressed ? theme.primarySoft : theme.surfaceRaised,
                      borderColor: pressed ? theme.primary : theme.border,
                    },
                  ]}
                >
                  <MaterialCommunityIcons
                    accessibilityElementsHidden
                    importantForAccessibility="no"
                    name="widgets-outline"
                    size={21}
                    color={theme.primary}
                  />
                </Pressable>
                <Pressable
                  accessibilityLabel="Change color theme"
                  accessibilityRole="button"
                  onPress={onOpenThemePicker}
                  style={({ pressed }) => [
                    styles.headerButton,
                    {
                      backgroundColor: pressed ? theme.primarySoft : theme.surfaceRaised,
                      borderColor: pressed ? theme.primary : theme.border,
                    },
                  ]}
                >
                  <MaterialCommunityIcons
                    accessibilityElementsHidden
                    importantForAccessibility="no"
                    name="palette-outline"
                    size={21}
                    color={theme.primary}
                  />
                </Pressable>
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
                {historyScope === 'all' ? `${visibleEvents.length} total` : `${visibleEvents.length} recent`}
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
            {olderEventCount > 0 || historyScope === 'all' ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={historyScope === 'all'
                  ? `Show activity from the last ${recentHistoryDays} days`
                  : `View all activity history, including ${olderEventCount} older ${olderEventCount === 1 ? 'log' : 'logs'}`}
                onPress={() => setHistoryScope((scope) => scope === 'recent' ? 'all' : 'recent')}
                style={({ pressed }) => [
                  styles.historyScope,
                  {
                    backgroundColor: pressed ? theme.primarySoft : theme.surfaceRaised,
                    borderColor: theme.border,
                  },
                ]}
              >
                <View style={[styles.historyScopeIcon, { backgroundColor: theme.primarySoft }]}>
                  <MaterialCommunityIcons
                    accessibilityElementsHidden
                    importantForAccessibility="no"
                    name={historyScope === 'all' ? 'calendar-today-outline' : 'history'}
                    size={20}
                    color={theme.primary}
                  />
                </View>
                <View style={styles.historyScopeCopy}>
                  <Text style={[styles.historyScopeTitle, { color: theme.text }]}>
                    {historyScope === 'all' ? `Show recent ${recentHistoryDays} days` : 'View all history'}
                  </Text>
                  <Text style={[styles.historyScopeDetail, { color: theme.textMuted }]}>
                    {historyScope === 'all'
                      ? 'Return to the activity that matters most now'
                      : `${olderEventCount} older ${olderEventCount === 1 ? 'log' : 'logs'} grouped by month`}
                  </Text>
                </View>
                <MaterialCommunityIcons
                  accessibilityElementsHidden
                  importantForAccessibility="no"
                  name="chevron-right"
                  size={22}
                  color={theme.textMuted}
                />
              </Pressable>
            ) : null}
          </>
        }
        renderSectionHeader={({ section }) => (
          <View>
            {section.monthTitle ? (
              <View style={styles.archiveMonthHeading}>
                <Text style={[styles.archiveMonthText, { color: theme.primary }]}>{section.monthTitle.toUpperCase()}</Text>
                <View style={[styles.archiveMonthLine, { backgroundColor: theme.border }]} />
              </View>
            ) : null}
            <Text style={[styles.dayHeading, { color: theme.textMuted }]}>{section.title.toUpperCase()}</Text>
          </View>
        )}
        renderItem={({ item }) => (
          <EventRow
            event={item}
            now={now}
            onEdit={() => startEditing(item)}
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
                accessibilityState={{ busy: closing, disabled: closing }}
                disabled={closing}
                onPress={() => void requestCloseEditor()}
                style={({ pressed }) => [styles.closeButton, { opacity: closing ? 0.55 : 1 }, pressed && { backgroundColor: theme.primarySoft }]}
              >
                <MaterialCommunityIcons name="close" size={22} color={theme.text} />
              </Pressable>
            </View>

            {saveStatus === 'error' ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Couldn’t save changes. Retry now"
                onPress={() => void flushAutoSave(true)}
                style={({ pressed }) => [
                  styles.saveStatus,
                  { backgroundColor: theme.surface, borderColor: theme.danger, opacity: pressed ? 0.72 : 1 },
                ]}
              >
                <MaterialCommunityIcons name="alert-circle-outline" color={theme.danger} size={18} />
                <Text style={[styles.saveStatusText, { color: theme.danger }]}>Couldn’t save. Tap to retry.</Text>
              </Pressable>
            ) : (
              <View
                accessible
                accessibilityLiveRegion="polite"
                accessibilityLabel={statusPresentation.text}
                style={[styles.saveStatus, { backgroundColor: theme.surface, borderColor: theme.border }]}
              >
                <MaterialCommunityIcons
                  name={statusPresentation.icon as keyof typeof MaterialCommunityIcons.glyphMap}
                  color={statusPresentation.color}
                  size={18}
                />
                <Text style={[styles.saveStatusText, { color: statusPresentation.color }]}>{statusPresentation.text}</Text>
              </View>
            )}

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
                          updateDraft((current) => ({ ...current, type }));
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
                      accessibilityHint="Required. Changes save automatically after you type."
                      autoCapitalize="sentences"
                      maxLength={40}
                      onBlur={() => {
                        setCustomTouched(true);
                        void flushAutoSave();
                      }}
                      onChangeText={(customLabel) => updateDraft((current) => ({ ...current, customLabel }))}
                      onSubmitEditing={() => {
                        Keyboard.dismiss();
                        void flushAutoSave();
                      }}
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
                      onPress={() => updateDraft((current) => ({ ...current, field }), false)}
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
                    onPress={() => {
                      setPickerMode(null);
                      void flushAutoSave();
                    }}
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
                onBlur={() => void flushAutoSave()}
                onChangeText={(note) => updateDraft((current) => ({ ...current, note }))}
                onFocus={() => editorScrollRef.current?.scrollToEnd({ animated: true })}
                theme={theme}
              />
            ) : null}
          </ScrollView>
        </View>
      </Modal>

      <Modal visible={showWidgetSettings} transparent animationType="none" onRequestClose={() => setShowWidgetSettings(false)}>
        <View accessibilityViewIsModal style={styles.scrim}>
          <ScrollView
            bounces={false}
            style={[styles.sheet, { backgroundColor: theme.surfaceRaised }]}
            contentContainerStyle={styles.sheetContent}
          >
            <View style={styles.sheetHeading}>
              <View style={[styles.editorIcon, { backgroundColor: theme.primarySoft }]}>
                <MaterialCommunityIcons name="widgets-outline" color={theme.primary} size={23} />
              </View>
              <View style={styles.editorHeadingCopy}>
                <Text style={[styles.sheetTitle, { color: theme.text }]}>Customize widget</Text>
                <Text style={[styles.sheetSubtitle, { color: theme.textMuted }]}>Choose 2–4 actions. Small widgets show them in one row.</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close widget settings"
                onPress={() => setShowWidgetSettings(false)}
                style={({ pressed }) => [styles.closeButton, pressed && { backgroundColor: theme.primarySoft }]}
              >
                <MaterialCommunityIcons name="close" size={22} color={theme.text} />
              </Pressable>
            </View>

            <Text style={[styles.fieldLabel, { color: theme.textMuted }]}>WIDGET ACTIONS · {widgetDraft.length} OF 4</Text>
            <View style={styles.widgetActionList}>
              {quickEventTypes.map((type) => {
                const meta = EVENT_META[type];
                const selected = widgetDraft.includes(type);
                const locked = (selected && widgetDraft.length === 2) || (!selected && widgetDraft.length === 4);
                const actionColor = theme.isDark ? meta.darkColor : meta.color;
                const actionSoftColor = theme.isDark ? meta.darkSoftColor : meta.softColor;
                return (
                  <Pressable
                    key={type}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: selected, disabled: locked }}
                    accessibilityLabel={`${selected ? 'Remove' : 'Add'} ${meta.label.toLowerCase()} ${selected ? 'from' : 'to'} the widget`}
                    accessibilityHint={locked ? (selected ? 'Keep at least two widget actions.' : 'Remove another action first.') : undefined}
                    disabled={locked}
                    onPress={() => toggleWidgetAction(type)}
                    style={({ pressed }) => [
                      styles.widgetAction,
                      {
                        backgroundColor: selected ? actionSoftColor : theme.surface,
                        borderColor: selected || pressed ? actionColor : theme.border,
                        opacity: locked ? 0.5 : 1,
                      },
                    ]}
                  >
                    <View style={[styles.widgetActionIcon, { backgroundColor: actionSoftColor }]}>
                      <MaterialCommunityIcons name={meta.icon as keyof typeof MaterialCommunityIcons.glyphMap} size={21} color={actionColor} />
                    </View>
                    <Text style={[styles.widgetActionText, { color: theme.text }]}>{meta.label}</Text>
                    <MaterialCommunityIcons name={selected ? 'check-circle' : 'circle-outline'} size={22} color={selected ? actionColor : theme.textMuted} />
                  </Pressable>
                );
              })}
            </View>
            <Text style={[styles.widgetHint, { color: theme.textMuted }]}>Nap stays available while a nap is running, even if you hide it from the default set.</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Save widget settings"
              accessibilityState={{ busy: savingWidgetSettings, disabled: savingWidgetSettings }}
              disabled={savingWidgetSettings}
              onPress={() => void saveWidgetSettings()}
              style={({ pressed }) => [styles.widgetSaveButton, { backgroundColor: pressed ? theme.primaryPressed : theme.primary, opacity: savingWidgetSettings ? 0.55 : 1 }]}
            >
              <Text style={[styles.widgetSaveButtonText, { color: theme.onPrimary }]}>{savingWidgetSettings ? 'Saving…' : 'Done'}</Text>
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
  headerActions: { flexDirection: 'row', gap: 8 },
  headerButton: {
    width: 44,
    height: 44,
    borderWidth: 1,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
  historyScope: {
    minHeight: 64,
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 12,
    marginTop: 4,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  historyScopeIcon: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  historyScopeCopy: { flex: 1, minWidth: 0 },
  historyScopeTitle: { fontSize: 14, lineHeight: 19, fontWeight: '700' },
  historyScopeDetail: { fontSize: 11, lineHeight: 16, marginTop: 1 },
  archiveMonthHeading: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 18, marginBottom: 2 },
  archiveMonthText: { fontSize: 12, lineHeight: 17, fontWeight: '800', letterSpacing: 1.2 },
  archiveMonthLine: { flex: 1, height: StyleSheet.hairlineWidth },
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
  saveStatus: { minHeight: 48, borderWidth: 1, borderRadius: 14, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: spacing.md },
  saveStatusText: { flex: 1, fontSize: 13, lineHeight: 18, fontWeight: '700' },
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
  widgetActionList: { gap: 8, marginBottom: spacing.md },
  widgetAction: { minHeight: 56, borderWidth: 1, borderRadius: 16, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 10 },
  widgetActionIcon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  widgetActionText: { flex: 1, fontSize: 15, fontWeight: '700' },
  widgetHint: { fontSize: 12, lineHeight: 18, marginBottom: spacing.lg },
  widgetSaveButton: { minHeight: 50, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  widgetSaveButtonText: { fontSize: 15, fontWeight: '800' },
});

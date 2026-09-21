import { MaterialCommunityIcons } from '@expo/vector-icons';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, SectionList, StyleSheet, Text, TextInput, View } from 'react-native';

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
  replaceCalendarDate,
  replaceClockTime,
  type EventType,
  type QuickEventType,
  type PuppyEvent,
  type PuppyEventChanges,
  type ScheduleEntry,
} from '../domain';
import { useLocalization } from '../localization-context';
import type { MessageKey } from '../localization';
import { eventIcon, spacing, surfaceTreatment, type Theme } from '../theme';

const quickBackdates = [0, 5, 15, 30, 60] as const;
const editableEventTypes = eventTypes.filter((type) => type !== 'nap');
const autoSaveDelayMs = 450;
const recentHistoryDays = 10;
const activityFilters: readonly {
  id: string;
  labelKey: MessageKey;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  types: readonly EventType[];
}[] = [
  { id: 'all', labelKey: 'log.filter.all', icon: 'format-list-bulleted', types: [] },
  { id: 'potty', labelKey: 'log.filter.potty', icon: 'water-outline', types: ['pee', 'poop', 'pottyTrip'] },
  { id: 'meals', labelKey: 'log.filter.meals', icon: 'food-apple-outline', types: ['meal'] },
  { id: 'walks', labelKey: 'log.filter.walks', icon: 'walk', types: ['walk'] },
  { id: 'naps', labelKey: 'log.filter.naps', icon: 'sleep', types: ['nap'] },
  { id: 'other', labelKey: 'log.filter.other', icon: 'tag-outline', types: ['custom'] },
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

function dateLabel(value: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(value);
}

function sectionTitle(
  key: string,
  todayKey: string,
  yesterdayKey: string,
  currentYear: number,
  locale: string,
  today: string,
  yesterday: string,
): string {
  const date = new Date(`${key}T12:00:00`);
  if (key === todayKey) return today;
  if (key === yesterdayKey) return yesterday;
  const options: Intl.DateTimeFormatOptions = { weekday: 'long', month: 'short', day: 'numeric' };
  if (date.getFullYear() !== currentYear) options.year = 'numeric';
  return new Intl.DateTimeFormat(locale, options).format(date);
}

function monthTitle(key: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' })
    .format(new Date(`${key}-01T12:00:00`));
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
  const { eventLabel, locale, relativeTime, t, voiceCopy } = useLocalization();
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
        title: sectionTitle(
          key,
          todayKey,
          yesterdayKey,
          currentYear,
          locale,
          t('log.today'),
          t('log.yesterday'),
        ),
        data,
        monthTitle: startsMonth ? monthTitle(monthKey, locale) : undefined,
      };
    });
  }, [currentYear, historyScope, locale, t, todayKey, visibleEvents, yesterdayKey]);
  const timedNap = draft?.event.type === 'nap' && draft.event.endedAt !== undefined;
  const activeValue = draft?.field === 'end' ? draft.endedAt ?? Date.now() : draft?.at ?? Date.now();
  const pickerDate = new Date(activeValue);
  const draftMeta = draft ? EVENT_META[draft.type] : EVENT_META.pee;
  const customInvalid = draft?.type === 'custom' && !normalizeCustomLabel(draft.customLabel);
  const selectedFilter = activityFilters.find((item) => item.id === activityFilter) ?? activityFilters[0];
  const todayLabel = new Intl.DateTimeFormat(locale, { weekday: 'short', month: 'short', day: 'numeric' })
    .format(now)
    .toUpperCase();
  const homeCopy = voiceCopy(todayLabel);

  const statusPresentation = customInvalid
    ? { icon: 'alert-circle-outline', text: t('editor.customNameStatus'), color: theme.danger }
    : saveStatus === 'saving'
      ? { icon: 'cloud-upload-outline', text: t('editor.saving'), color: theme.primary }
      : null;

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
    Alert.alert(t('log.saveErrorTitle'), t('log.saveErrorBody'));
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
      Alert.alert(t('log.widgetErrorTitle'), t('log.tryAgain'));
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
              <View
                style={[
                  styles.mark,
                  { backgroundColor: theme.primary, borderRadius: theme.presentation.iconRadius },
                ]}
              >
                <MaterialCommunityIcons
                  name={theme.presentation.markIcon as keyof typeof MaterialCommunityIcons.glyphMap}
                  size={23}
                  color={theme.onPrimary}
                />
              </View>
              <View style={styles.titleCopy}>
                <Text
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
                  {homeCopy.title}
                </Text>
              </View>
              <View style={styles.headerActions}>
                <Pressable
                  accessibilityLabel={t('log.customizeWidgetA11y')}
                  accessibilityRole="button"
                  onPress={openWidgetSettings}
                  style={({ pressed }) => [
                    styles.headerButton,
                    {
                      backgroundColor: pressed ? theme.primarySoft : theme.surfaceRaised,
                      borderColor: pressed ? theme.primary : theme.border,
                      borderRadius: theme.presentation.controlRadius,
                      borderWidth: theme.presentation.borderWidth,
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
                  accessibilityLabel={t('log.changeAppearanceA11y')}
                  accessibilityRole="button"
                  onPress={onOpenThemePicker}
                  style={({ pressed }) => [
                    styles.headerButton,
                    {
                      backgroundColor: pressed ? theme.primarySoft : theme.surfaceRaised,
                      borderColor: pressed ? theme.primary : theme.border,
                      borderRadius: theme.presentation.controlRadius,
                      borderWidth: theme.presentation.borderWidth,
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
            <QuickActions events={events} onLog={onLog} now={now} theme={theme} />
            <TodayRoutineCard
              events={events}
              schedule={schedule}
              now={now}
              onOpenSchedule={onOpenSchedule}
              theme={theme}
            />
            <View style={styles.activityHeading}>
              <Text style={[styles.sectionTitle, { color: theme.text }]}>{t('log.activity')}</Text>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.filters}
            >
              {activityFilters.map((item) => {
                const selected = activityFilter === item.id;
                const label = t(item.labelKey);
                return (
                  <Pressable
                    key={item.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    accessibilityLabel={t('log.showFilter', { filter: label })}
                    onPress={() => setActivityFilter(item.id)}
                    style={({ pressed }) => [
                      styles.filter,
                      {
                        backgroundColor: selected || pressed ? theme.primarySoft : theme.surfaceRaised,
                        borderColor: selected ? theme.primary : theme.border,
                        borderRadius: theme.presentation.controlRadius,
                        borderWidth: theme.presentation.borderWidth,
                      },
                    ]}
                  >
                    <MaterialCommunityIcons
                      name={item.icon as keyof typeof MaterialCommunityIcons.glyphMap}
                      size={17}
                      color={selected ? theme.primary : theme.textMuted}
                    />
                    <Text style={[styles.filterText, { color: selected ? theme.primary : theme.textMuted }]}>
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            {olderEventCount > 0 || historyScope === 'all' ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={historyScope === 'all'
                  ? t('log.showRecentA11y', { count: recentHistoryDays })
                  : t('log.viewAllA11y', { count: olderEventCount })}
                onPress={() => setHistoryScope((scope) => scope === 'recent' ? 'all' : 'recent')}
                style={({ pressed }) => [
                  styles.historyScope,
                  {
                    backgroundColor: pressed ? theme.primarySoft : theme.surfaceRaised,
                    borderColor: theme.border,
                    borderRadius: theme.presentation.cardRadius,
                    borderWidth: theme.presentation.borderWidth,
                  },
                ]}
              >
                <View
                  style={[
                    styles.historyScopeIcon,
                    { backgroundColor: theme.primarySoft, borderRadius: theme.presentation.iconRadius },
                  ]}
                >
                  <MaterialCommunityIcons
                    accessibilityElementsHidden
                    importantForAccessibility="no"
                    name={historyScope === 'all' ? 'calendar-today-outline' : 'history'}
                    size={20}
                    color={theme.primary}
                  />
                </View>
                <Text style={[styles.historyScopeTitle, { color: theme.text }]}>
                  {historyScope === 'all'
                    ? t('log.showRecent', { count: recentHistoryDays })
                    : t('log.viewAll', { count: olderEventCount })}
                </Text>
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
                <Text
                  style={[
                    styles.archiveMonthText,
                    { color: theme.primary, letterSpacing: theme.presentation.eyebrowTracking },
                  ]}
                >
                  {section.monthTitle.toUpperCase()}
                </Text>
                <View style={[styles.archiveMonthLine, { backgroundColor: theme.border }]} />
              </View>
            ) : null}
            <Text
              style={[
                styles.dayHeading,
                { color: theme.textMuted, letterSpacing: theme.presentation.eyebrowTracking },
              ]}
            >
              {section.title.toUpperCase()}
            </Text>
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
            <MaterialCommunityIcons name={selectedFilter.icon as keyof typeof MaterialCommunityIcons.glyphMap} size={28} color={theme.textMuted} />
            <Text style={[styles.emptyTitle, { color: theme.text }]}>
              {activityFilter === 'all'
                ? t('log.emptyTitle')
                : t('log.emptyFilteredTitle', { filter: t(selectedFilter.labelKey).toLocaleLowerCase(locale) })}
            </Text>
          </View>
        }
      />

      <Modal visible={draft !== null} transparent animationType="none" onRequestClose={handleSystemClose}>
        <KeyboardAvoidingView
          accessibilityViewIsModal
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.scrim}
        >
          <ScrollView
            ref={editorScrollRef}
            bounces={false}
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
            keyboardShouldPersistTaps="handled"
            style={[
              styles.sheet,
              {
                backgroundColor: theme.surfaceRaised,
                borderTopLeftRadius: theme.presentation.cardRadius + 6,
                borderTopRightRadius: theme.presentation.cardRadius + 6,
              },
            ]}
            contentContainerStyle={styles.sheetContent}
          >
            <View style={styles.sheetHeading}>
              <View
                style={[
                  styles.editorIcon,
                  { backgroundColor: draftMeta.softColor, borderRadius: theme.presentation.iconRadius },
                ]}
              >
                <MaterialCommunityIcons
                  name={eventIcon(theme, draft?.type ?? 'pee') as keyof typeof MaterialCommunityIcons.glyphMap}
                  color={draftMeta.color}
                  size={23}
                />
              </View>
              <View style={styles.editorHeadingCopy}>
                <Text
                  style={[
                    styles.sheetTitle,
                    {
                      color: theme.text,
                      fontWeight: theme.presentation.titleWeight,
                      letterSpacing: theme.presentation.titleTracking,
                    },
                  ]}
                >
                  {t(timedNap ? 'editor.editNap' : 'editor.editLog')}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('editor.close')}
                accessibilityState={{ busy: closing, disabled: closing }}
                disabled={closing}
                onPress={() => void requestCloseEditor()}
                style={({ pressed }) => [
                  styles.closeButton,
                  { borderRadius: theme.presentation.controlRadius, opacity: closing ? 0.55 : 1 },
                  pressed && { backgroundColor: theme.primarySoft },
                ]}
              >
                <MaterialCommunityIcons name="close" size={22} color={theme.text} />
              </Pressable>
            </View>

            {saveStatus === 'error' ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('editor.retryA11y')}
                onPress={() => void flushAutoSave(true)}
                style={({ pressed }) => [
                  styles.saveStatus,
                  {
                    backgroundColor: theme.surface,
                    borderColor: theme.danger,
                    borderRadius: theme.presentation.controlRadius,
                    borderWidth: theme.presentation.borderWidth,
                    opacity: pressed ? 0.72 : 1,
                  },
                ]}
              >
                <MaterialCommunityIcons name="alert-circle-outline" color={theme.danger} size={18} />
                <Text style={[styles.saveStatusText, { color: theme.danger }]}>{t('editor.retry')}</Text>
              </Pressable>
            ) : statusPresentation ? (
              <View
                accessible
                accessibilityLiveRegion="polite"
                accessibilityLabel={statusPresentation.text}
                style={[
                  styles.saveStatus,
                  {
                    backgroundColor: theme.surface,
                    borderColor: theme.border,
                    borderRadius: theme.presentation.controlRadius,
                    borderWidth: theme.presentation.borderWidth,
                  },
                ]}
              >
                <MaterialCommunityIcons
                  name={statusPresentation.icon as keyof typeof MaterialCommunityIcons.glyphMap}
                  color={statusPresentation.color}
                  size={18}
                />
                <Text style={[styles.saveStatusText, { color: statusPresentation.color }]}>{statusPresentation.text}</Text>
              </View>
            ) : null}

            {draft && draft.event.type !== 'nap' ? (
              <>
                <Text style={[styles.fieldLabel, { color: theme.textMuted }]}>{t('editor.activity')}</Text>
                <View style={styles.typePicker}>
                  {editableEventTypes.map((type) => {
                    const meta = EVENT_META[type];
                    const selected = draft.type === type;
                    const label = eventLabel(type);
                    return (
                      <Pressable
                        key={type}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        accessibilityLabel={t('editor.changeActivity', { activity: label })}
                        onPress={() => {
                          setCustomTouched(false);
                          updateDraft((current) => ({ ...current, type }));
                        }}
                        style={({ pressed }) => [
                          styles.typeChoice,
                          {
                            backgroundColor: selected ? meta.softColor : theme.surface,
                            borderColor: selected || pressed ? meta.color : theme.border,
                            borderRadius: theme.presentation.controlRadius,
                            borderWidth: theme.presentation.borderWidth,
                          },
                        ]}
                      >
                        <MaterialCommunityIcons
                          name={eventIcon(theme, type) as keyof typeof MaterialCommunityIcons.glyphMap}
                          color={selected ? meta.color : theme.textMuted}
                          size={20}
                        />
                        <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.typeChoiceText, { color: selected ? meta.color : theme.text }]}>
                          {label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                {draft.type === 'custom' ? (
                  <View style={styles.customField}>
                    <Text style={[styles.fieldLabel, { color: theme.textMuted }]}>{t('editor.customName')}</Text>
                    <TextInput
                      accessibilityLabel={t('editor.customNameA11y')}
                      accessibilityHint={t('editor.customNameHint')}
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
                      placeholder={t('editor.customPlaceholder')}
                      placeholderTextColor={theme.textMuted}
                      returnKeyType="done"
                      value={draft.customLabel}
                      style={[
                        styles.customInput,
                        {
                          backgroundColor: theme.surface,
                          borderColor: customTouched && customInvalid ? theme.danger : theme.border,
                          borderRadius: theme.presentation.controlRadius,
                          borderWidth: theme.presentation.borderWidth,
                          color: theme.text,
                        },
                      ]}
                    />
                    {customTouched && customInvalid ? (
                      <Text
                        accessibilityLiveRegion="polite"
                        style={[styles.customHint, { color: theme.danger }]}
                      >
                        {t('editor.customInvalid')}
                      </Text>
                    ) : null}
                  </View>
                ) : null}
              </>
            ) : null}

            <View
              style={[
                styles.timePreview,
                surfaceTreatment(theme),
                { backgroundColor: theme.surface, borderColor: theme.border },
              ]}
            >
              <Text style={[styles.previewTime, { color: theme.text }]}>
                {timedNap
                  ? `${formatTime(draft?.at ?? Date.now())}–${typeof draft?.endedAt === 'number' ? formatTime(draft.endedAt) : t('editor.now')}`
                  : formatTime(draft?.at ?? Date.now())}
              </Text>
              <Text style={[styles.previewDate, { color: theme.textMuted }]}>
                {timedNap
                  ? `${formatDuration((draft?.endedAt ?? Date.now()) - (draft?.at ?? Date.now()))}${draft?.endedAt === null ? ` · ${t('editor.inProgress')}` : ''}`
                  : `${dateLabel(draft?.at ?? Date.now(), locale)} · ${relativeTime(draft?.at ?? Date.now())}`}
              </Text>
            </View>

            {timedNap ? (
              <View style={styles.timeFields}>
                {(['start', 'end'] as const).map((field) => {
                  const selected = draft?.field === field;
                  const value = field === 'start' ? draft?.at : draft?.endedAt;
                  const fieldLabel = t(field === 'start' ? 'editor.start' : 'editor.end');
                  return (
                    <Pressable
                      key={field}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      accessibilityLabel={t('editor.editNapTime', { field: fieldLabel })}
                      onPress={() => updateDraft((current) => ({ ...current, field }), false)}
                      style={({ pressed }) => [
                        styles.timeField,
                        {
                          backgroundColor: selected ? draftMeta.softColor : theme.surface,
                          borderColor: selected || pressed ? draftMeta.color : theme.border,
                          borderRadius: theme.presentation.controlRadius,
                          borderWidth: theme.presentation.borderWidth,
                        },
                      ]}
                    >
                      <Text style={[styles.timeFieldLabel, { color: theme.textMuted }]}>{fieldLabel}</Text>
                      <Text style={[styles.timeFieldValue, { color: theme.text }]}>
                        {typeof value === 'number' ? formatTime(value) : t('editor.inProgress')}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}

            <Text style={[styles.fieldLabel, { color: theme.textMuted }]}>
              {timedNap
                ? t('editor.setField', { field: t(draft?.field === 'end' ? 'editor.end' : 'editor.start') })
                : t('editor.quickBackdate')}
            </Text>
            <View style={styles.quickTimes}>
              {quickBackdates.map((minutes) => (
                <Pressable
                  key={minutes}
                  accessibilityRole="button"
                  accessibilityLabel={minutes
                    ? t('editor.backdate', { count: minutes })
                    : t('editor.setNow')}
                  onPress={() => setDraftTime(Date.now() - minutes * 60_000)}
                  style={({ pressed }) => [
                    styles.quickTime,
                    {
                      backgroundColor: pressed ? theme.primarySoft : theme.surface,
                      borderColor: theme.border,
                      borderRadius: theme.presentation.controlRadius,
                      borderWidth: theme.presentation.borderWidth,
                    },
                  ]}
                >
                  <Text style={[styles.quickTimeText, { color: theme.text }]}>
                    {minutes ? t('editor.minutesAgo', { count: minutes }) : t('editor.now')}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Text style={[styles.fieldLabel, { color: theme.textMuted }]}>{t('editor.dateTime')}</Text>
            <View style={styles.exactFields}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: pickerMode === 'date' }}
                accessibilityLabel={t('editor.chooseDate', {
                  field: t(draft?.field === 'end' ? 'editor.end' : 'editor.start'),
                  date: dateLabel(activeValue, locale),
                })}
                onPress={() => setPickerMode('date')}
                style={({ pressed }) => [
                  styles.exactField,
                  {
                    backgroundColor: pickerMode === 'date' ? theme.primarySoft : theme.surface,
                    borderColor: pickerMode === 'date' || pressed ? theme.primary : theme.border,
                    borderRadius: theme.presentation.controlRadius,
                    borderWidth: theme.presentation.borderWidth,
                  },
                ]}
              >
                <MaterialCommunityIcons name="calendar-outline" size={21} color={theme.primary} />
                <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.exactFieldText, { color: theme.text }]}>
                  {dateLabel(activeValue, locale)}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: pickerMode === 'time' }}
                accessibilityLabel={t('editor.chooseTime', {
                  field: t(draft?.field === 'end' ? 'editor.end' : 'editor.start'),
                  time: formatTime(activeValue),
                })}
                onPress={() => setPickerMode('time')}
                style={({ pressed }) => [
                  styles.exactField,
                  {
                    backgroundColor: pickerMode === 'time' ? theme.primarySoft : theme.surface,
                    borderColor: pickerMode === 'time' || pressed ? theme.primary : theme.border,
                    borderRadius: theme.presentation.controlRadius,
                    borderWidth: theme.presentation.borderWidth,
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
                    accessibilityLabel={t('editor.finishPicker', {
                      picker: t(pickerMode === 'date' ? 'editor.date' : 'editor.time'),
                    })}
                    onPress={() => {
                      setPickerMode(null);
                      void flushAutoSave();
                    }}
                    style={({ pressed }) => [styles.pickerDone, pressed && { backgroundColor: theme.primarySoft }]}
                  >
                    <Text style={[styles.pickerDoneText, { color: theme.primary }]}>{t('common.done')}</Text>
                  </Pressable>
                ) : null}
              </>
            ) : null}

            <Text style={[styles.fieldLabel, styles.noteLabel, { color: theme.textMuted }]}>{t('editor.note')}</Text>
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
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={showWidgetSettings} transparent animationType="none" onRequestClose={() => setShowWidgetSettings(false)}>
        <View accessibilityViewIsModal style={styles.scrim}>
          <ScrollView
            bounces={false}
            style={[
              styles.sheet,
              {
                backgroundColor: theme.surfaceRaised,
                borderTopLeftRadius: theme.presentation.cardRadius + 6,
                borderTopRightRadius: theme.presentation.cardRadius + 6,
              },
            ]}
            contentContainerStyle={styles.sheetContent}
          >
            <View style={styles.sheetHeading}>
              <View
                style={[
                  styles.editorIcon,
                  { backgroundColor: theme.primarySoft, borderRadius: theme.presentation.iconRadius },
                ]}
              >
                <MaterialCommunityIcons name="widgets-outline" color={theme.primary} size={23} />
              </View>
              <View style={styles.editorHeadingCopy}>
                <Text
                  style={[
                    styles.sheetTitle,
                    {
                      color: theme.text,
                      fontWeight: theme.presentation.titleWeight,
                      letterSpacing: theme.presentation.titleTracking,
                    },
                  ]}
                >
                  {t('widget.title')}
                </Text>
                <Text style={[styles.sheetSubtitle, { color: theme.textMuted }]}>{t('widget.subtitle')}</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('widget.close')}
                onPress={() => setShowWidgetSettings(false)}
                style={({ pressed }) => [
                  styles.closeButton,
                  { borderRadius: theme.presentation.controlRadius },
                  pressed && { backgroundColor: theme.primarySoft },
                ]}
              >
                <MaterialCommunityIcons name="close" size={22} color={theme.text} />
              </Pressable>
            </View>

            <View style={styles.widgetActionList}>
              {quickEventTypes.map((type) => {
                const meta = EVENT_META[type];
                const selected = widgetDraft.includes(type);
                const locked = (selected && widgetDraft.length === 2) || (!selected && widgetDraft.length === 4);
                const actionColor = theme.isDark ? meta.darkColor : meta.color;
                const actionSoftColor = theme.isDark ? meta.darkSoftColor : meta.softColor;
                const label = eventLabel(type);
                return (
                  <Pressable
                    key={type}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: selected, disabled: locked }}
                    accessibilityLabel={t(selected ? 'widget.removeAction' : 'widget.addAction', { activity: label })}
                    accessibilityHint={locked ? t(selected ? 'widget.keepTwo' : 'widget.removeFirst') : undefined}
                    disabled={locked}
                    onPress={() => toggleWidgetAction(type)}
                    style={({ pressed }) => [
                      styles.widgetAction,
                      {
                        backgroundColor: selected ? actionSoftColor : theme.surface,
                        borderColor: selected || pressed ? actionColor : theme.border,
                        borderRadius: theme.presentation.controlRadius,
                        borderWidth: theme.presentation.borderWidth,
                        opacity: locked ? 0.5 : 1,
                      },
                    ]}
                  >
                    <View
                      style={[
                        styles.widgetActionIcon,
                        { backgroundColor: actionSoftColor, borderRadius: theme.presentation.iconRadius },
                      ]}
                    >
                      <MaterialCommunityIcons
                        name={eventIcon(theme, type) as keyof typeof MaterialCommunityIcons.glyphMap}
                        size={21}
                        color={actionColor}
                      />
                    </View>
                    <Text style={[styles.widgetActionText, { color: theme.text }]}>{label}</Text>
                    <MaterialCommunityIcons name={selected ? 'check-circle' : 'circle-outline'} size={22} color={selected ? actionColor : theme.textMuted} />
                  </Pressable>
                );
              })}
            </View>
            {!widgetDraft.includes('nap') ? (
              <Text style={[styles.widgetHint, { color: theme.textMuted }]}>{t('widget.napHint')}</Text>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('widget.save')}
              accessibilityState={{ busy: savingWidgetSettings, disabled: savingWidgetSettings }}
              disabled={savingWidgetSettings}
              onPress={() => void saveWidgetSettings()}
              style={({ pressed }) => [
                styles.widgetSaveButton,
                {
                  backgroundColor: pressed ? theme.primaryPressed : theme.primary,
                  borderRadius: theme.presentation.controlRadius,
                  opacity: savingWidgetSettings ? 0.55 : 1,
                },
              ]}
            >
              <Text style={[styles.widgetSaveButtonText, { color: theme.onPrimary }]}>
                {t(savingWidgetSettings ? 'common.saving' : 'common.done')}
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
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
  },
  titleBlock: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  mark: { width: 44, height: 44, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  titleCopy: { flex: 1 },
  headerActions: { flexDirection: 'row', gap: 8 },
  headerButton: {
    width: 48,
    height: 48,
    borderWidth: 1,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 27, lineHeight: 33, fontWeight: '800', letterSpacing: -0.5 },
  activityHeading: { marginTop: spacing.xl, marginBottom: 12, flexDirection: 'row', alignItems: 'baseline' },
  sectionTitle: { flex: 1, fontSize: 21, fontWeight: '800' },
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
  historyScopeTitle: { flex: 1, fontSize: 14, lineHeight: 19, fontWeight: '700' },
  archiveMonthHeading: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 18, marginBottom: 2 },
  archiveMonthText: { fontSize: 12, lineHeight: 17, fontWeight: '800', letterSpacing: 1.2 },
  archiveMonthLine: { flex: 1, height: StyleSheet.hairlineWidth },
  dayHeading: { fontSize: 11, fontWeight: '800', letterSpacing: 1.2, marginTop: 8, marginBottom: 8 },
  empty: { borderWidth: 1, borderStyle: 'dashed', borderRadius: 20, padding: spacing.lg, alignItems: 'center' },
  emptyTitle: { fontSize: 17, fontWeight: '700', marginTop: 8 },
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
  widgetHint: { fontSize: 12, lineHeight: 18, marginBottom: spacing.md },
  widgetSaveButton: { minHeight: 50, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  widgetSaveButtonText: { fontSize: 15, fontWeight: '800' },
});

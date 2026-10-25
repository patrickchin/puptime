import DateTimePicker from '@expo/ui/community/datetime-picker';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';

import type {SpotlightRect} from '../components/OnboardingSpotlight';
import { QuickActions } from '../components/QuickActions';
import { ActivityIcon } from '../components/ActivityIcon';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { EventRow } from '../components/EventRow';
import {ActivityLoadState} from '../components/ActivityLoadState';
import {EventHistoryPanel} from '../components/EventHistoryPanel';
import type {EventHistoryData} from '../event-history';
import type {CloudHandle} from '../cloud/handle';
import {useActivityPages,type ActivityViewProps} from '../activity-view';
import { NoteInput } from '../components/NoteInput';
import {
  dateKey,
  customActivityKey,
  eventTypes,
  formatDuration,
  formatTime,
  isOpenNap,
  normalizeCustomLabel,
  type EventType,
  type PuppyEvent,
  type PuppyEventChanges,
} from '../domain';
import { useLocalization } from '../localization-context';
import { createEventEditor,eventEditValues,type EventEditValues } from '../event-editor';
import { EventDeletedError } from '../storage-validation';
import { groupLogHistory } from '../log-history';
import { spacing, surfaceTreatment, type Theme } from '../theme';

const timeAdjustments = [-60, -15, 15, 60] as const;
const editableEventTypes = eventTypes.filter((type) => type !== 'nap');
const autoSaveDelayMs = 450;
const olderDaysPerPage = 7;

type Draft = EventEditValues & {
  event: PuppyEvent;
  field: 'start' | 'end';
};

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error' | 'deleted';

export type LogEditRequest = { eventId: string; focusNote?: boolean };

function createDraft(event: PuppyEvent): Draft {
  return {
    event,
    ...eventEditValues(event),
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

export function LogScreen({
  events:projectedEvents,
  activity,
  history,
  cloud,
  onHistoryRestored,
  refreshToken,
  customActivities,
  editRequest,
  onEditRequestHandled,
  editorOnly=false,
  onEditorClosed,
  onLog,
  onSave,
  onDelete,
  onOpenSettings,
  showHeader=true,
  onQuickActionsLayout,
  theme,
}: {
  events: PuppyEvent[];
  history?:EventHistoryData;
  cloud?:CloudHandle;
  onHistoryRestored?:(event:PuppyEvent)=>void;
  customActivities: string[];
  editRequest?: LogEditRequest | null;
  onEditRequestHandled?: () => void;
  editorOnly?: boolean;
  onEditorClosed?: () => void;
  onLog: (type: EventType, customLabel?: string) => Promise<void>;
  onSave: (event: PuppyEvent, changes: PuppyEventChanges) => Promise<void>;
  onDelete: (event: PuppyEvent) => Promise<void>;
  onOpenSettings: () => void;
  showHeader?:boolean;
  onQuickActionsLayout?:(rect:SpotlightRect)=>void;
  theme: Theme;
}&ActivityViewProps) {
  const { activityColors, activityLabel, eventPastLabel, locale, relativeTime, t } = useLocalization();
  const page=useActivityPages(activity,projectedEvents,refreshToken);
  const events=page.events;
  const requestHandled=useRef(onEditRequestHandled);requestHandled.current=onEditRequestHandled;
  const [requestAttempt,setRequestAttempt]=useState(0);
  const [nativePicker,setNativePicker]=useState<'date'|'time'|null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PuppyEvent | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteFailed, setDeleteFailed] = useState(false);
  const [customTouched, setCustomTouched] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [closing, setClosing] = useState(false);
  const [historyOpen,setHistoryOpen]=useState(false);
  const historyBusy=useRef(false);
  const onHistoryRestoredRef=useRef(onHistoryRestored);onHistoryRestoredRef.current=onHistoryRestored;
  const [now, setNow] = useState(Date.now());
  const [focusNote, setFocusNote] = useState(false);
  const [loadedOlderDays, setLoadedOlderDays] = useState(olderDaysPerPage);
  const [expandedDays, setExpandedDays] = useState<Record<string, boolean>>({});
  const draftRef = useRef<Draft | null>(null);
  const draftSaverRef=useRef<ReturnType<typeof createEventEditor>|null>(null);
  const onSaveRef=useRef(onSave);onSaveRef.current=onSave;
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const revisionRef = useRef(0);
  const savedRevisionRef = useRef(0);
  const inFlightRevisionRef = useRef(-1);
  const sessionRef = useRef(0);
  const latestSaveRef = useRef<Promise<boolean>>(Promise.resolve(true));
  const closingRef = useRef(false);

  const clearSaveTimer = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
  }, []);

  const startEditing = useCallback((event: PuppyEvent, shouldFocusNote = false) => {

    clearSaveTimer();
    sessionRef.current += 1;
    revisionRef.current = 0;
    savedRevisionRef.current = 0;
    inFlightRevisionRef.current = -1;
    latestSaveRef.current = Promise.resolve(true);
    closingRef.current = false;
    setSaveStatus('idle');
    setClosing(false);
    setHistoryOpen(false);
    setFocusNote(shouldFocusNote);
    setCustomTouched(false);
    setNativePicker(null);
    const next = createDraft(event);
    draftSaverRef.current=createEventEditor(event,changes=>onSaveRef.current(event,changes));
    draftRef.current = next;
    setDraft(next);
  }, [clearSaveTimer]);
  const queueDelete = useCallback((event: PuppyEvent) => {
    setDeleteFailed(false);
    setPendingDelete(event);
  }, []);

  const persistDraft = (next: Draft, revision: number, session: number): Promise<boolean> => {
    setSaveStatus('saving');
    inFlightRevisionRef.current = revision;
    const saver=draftSaverRef.current;
    if(!saver){setSaveStatus('error');return Promise.resolve(false);}
    const save = saver.save(next)
      .then(() => {
        if (sessionRef.current === session) {
          savedRevisionRef.current = Math.max(savedRevisionRef.current, revision);
          if (revisionRef.current === revision) setSaveStatus('saved');
        }
        return true;
      })
      .catch((error:unknown) => {
        if (sessionRef.current === session && revisionRef.current === revision) {
          setSaveStatus(error instanceof EventDeletedError?'deleted':'error');
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
    if (!editRequest) return;
    let current=true;
    if(activity){
      void activity.getEvent(editRequest.eventId).then(event=>{
        if(!current)return;
        if(event)startEditing(event,Boolean(editRequest.focusNote));
        else Alert.alert(t('editor.deletedTitle'),t('editor.deletedBody'));
        requestHandled.current?.();
      }).catch(()=>{if(current)Alert.alert(t('app.loadErrorTitle'),t('app.loadErrorBody'),[{text:t('activity.retry'),onPress:()=>setRequestAttempt(value=>value+1)},{text:t('app.cancel'),onPress:()=>requestHandled.current?.()}]);});
    }else{
      const event=events.find(candidate=>candidate.id===editRequest.eventId);
      if(event)startEditing(event,Boolean(editRequest.focusNote));requestHandled.current?.();
    }
    return()=>{current=false;};
  }, [activity,editRequest,activity?undefined:events,startEditing,requestAttempt,t]);
  const todayKey = dateKey(now);
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = dateKey(yesterday);
  const currentYear = new Date(now).getFullYear();
  const { sections, hasMoreDays } = useMemo(() => {
    const { days, hasMoreDays } = groupLogHistory(events, now, loadedOlderDays);
    return { hasMoreDays, sections: days.map(({ key, data }) => {
      const expanded = expandedDays[key] ?? (key === todayKey || key === yesterdayKey);
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
        count: data.length,
        expanded,
        data: expanded ? data : [],
      };
    }) };
  }, [currentYear, expandedDays, events, loadedOlderDays, locale, now, t, todayKey, yesterdayKey]);
  const timedNap = draft?.event.type === 'nap' && draft.event.endedAt !== undefined;
  const activeValue = draft?.field === 'end' ? draft.endedAt ?? Date.now() : draft?.at ?? Date.now();
  const adjustmentField = t(timedNap ? (draft?.field === 'end' ? 'editor.end' : 'editor.start') : 'editor.time');
  const draftColors = activityColors(theme, draft ?? { type: 'pee' });
  const customInvalid = draft?.type === 'custom' && !normalizeCustomLabel(draft.customLabel);
  const setDraftTime = (value: number) => {
    updateDraft((current) => {
      if (current.field === 'end') {
        return { ...current, endedAt: Math.max(current.at, Math.min(value, Date.now())) };
      }
      const latestStart = typeof current.endedAt === 'number' ? current.endedAt : Date.now();
      return { ...current, at: Math.min(value, latestStart) };
    });
  };
  const adjustDraftTime = (minutes: number) => {
    const current = draftRef.current;
    if (!current) return;
    Keyboard.dismiss();
    const value = current.field === 'end' ? current.endedAt ?? Date.now() : current.at;
    setDraftTime(value + minutes * 60_000);
  };
  const adjustDraftDay = (days: number) => {
    const current = draftRef.current;
    if (!current) return;
    Keyboard.dismiss();
    const value = current.field === 'end' ? current.endedAt ?? Date.now() : current.at;
    const next = new Date(value);
    next.setDate(next.getDate() + days);
    setDraftTime(next.getTime());
  };

  const closeEditor = () => {
    clearSaveTimer();
    sessionRef.current += 1;
    draftRef.current = null;
    draftSaverRef.current=null;
    Keyboard.dismiss();
    setCustomTouched(false);
    setSaveStatus('idle');
    setFocusNote(false);
    closingRef.current = false;
    setClosing(false);
    setDraft(null);
    setHistoryOpen(false);
    onEditorClosed?.();
  };

  const requestHistory = async () => {
    if(!history||!draftRef.current||closingRef.current)return;
    closingRef.current=true;setClosing(true);setFocusNote(false);Keyboard.dismiss();
    const session=sessionRef.current,revision=revisionRef.current;
    try{
      if(await flushAutoSave()&&sessionRef.current===session&&revisionRef.current===revision){
        clearSaveTimer();setHistoryOpen(true);
      }
    }finally{closingRef.current=false;setClosing(false);}
  };

  const returnFromHistory = async () => {
    if(!history||!draftRef.current||closingRef.current||historyBusy.current)return;
    closingRef.current=true;setClosing(true);
    const eventId=draftRef.current.event.id,session=sessionRef.current;
    try{
      const {head}=await history.eventPage(eventId,{limit:1});
      if(sessionRef.current!==session)return;
      if(head.event)startEditing(head.event);
      else {setSaveStatus('deleted');setHistoryOpen(false);}
    }catch{
      if(sessionRef.current===session){setHistoryOpen(false);Alert.alert(t('app.loadErrorTitle'),t('app.loadErrorBody'));}
    }finally{closingRef.current=false;setClosing(false);}
  };

  const restoredHistory = (event:PuppyEvent) => {
    startEditing(event);setHistoryOpen(true);
    onHistoryRestoredRef.current?.(event);
  };

  const requestCloseEditor = async () => {
    if (closingRef.current) return;
    if (saveStatus === 'deleted') {
      Alert.alert(t('editor.deletedTitle'),t('editor.deletedBody'),[
        {text:t('editor.keepDraft'),style:'cancel'},
        {text:t('editor.discardDraft'),style:'destructive',onPress:closeEditor},
      ]);
      return;
    }
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
    if(historyOpen){void returnFromHistory();return;}
    if(closingRef.current)return;
    const focusedInput = TextInput.State.currentlyFocusedInput();
    if (focusedInput) {
      focusedInput.blur();
      Keyboard.dismiss();
      return;
    }
    if (Keyboard.isVisible()) {
      Keyboard.dismiss();
      return;
    }
    void requestCloseEditor();
  };

  const confirmDelete = async () => {
    if (!pendingDelete || deleting) return;
    setDeleting(true);
    setDeleteFailed(false);
    try {
      await onDelete(pendingDelete);
      setPendingDelete(null);
    } catch {
      setDeleteFailed(true);
    } finally {
      setDeleting(false);
    }
  };


  return (
    <>
      {!editorOnly ? <FlatList
        testID="screen.today"
        data={sections}
        keyExtractor={(section) => section.key}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <>
            {showHeader?<View style={styles.titleBlock}>
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
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  style={[
                    styles.title,
                    {
                      color: theme.text,
                      fontSize: theme.presentation.titleSize,
                      lineHeight: theme.presentation.titleLineHeight,
                      fontWeight: theme.presentation.titleWeight,
                      fontFamily: theme.presentation.headingFont,
                      letterSpacing: theme.presentation.titleTracking,
                    },
                  ]}
                >
                  {t('nav.log')}
                </Text>
              </View>
              <View style={styles.headerActions}>
                <Pressable
                  testID="settings.open"
                  accessibilityLabel={t('log.openSettingsA11y')}
                  accessibilityRole="button"
                  onPress={onOpenSettings}
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
                    name="cog-outline"
                    size={21}
                    color={theme.primary}
                  />
                </Pressable>
              </View>
            </View>:null}
            <QuickActions events={activity?projectedEvents:events} onLog={onLog} now={now} theme={theme} onLayout={onQuickActionsLayout} />
            <View style={styles.activityHeading}>
              <Text style={[styles.sectionTitle, { color: theme.text }]}>{t('log.activity')}</Text>
            </View>
          </>
        }
        renderItem={({ item: section }) => (
          <View style={[styles.dayCard, surfaceTreatment(theme), { backgroundColor: theme.surfaceRaised, borderColor: theme.border }]}>
            <Pressable
              testID={`history.day.${section.key === todayKey ? 'today' : section.key === yesterdayKey ? 'yesterday' : section.key}`}
              accessibilityRole="button"
              accessibilityState={{ expanded: section.expanded }}
              accessibilityLabel={activity?t('activity.dayA11y',{day:section.title,count:section.count}):t('log.toggleDayA11y', { day: section.title, count: section.count })}
              onPress={() => setExpandedDays((current) => ({
                ...current,
                [section.key]: !(current[section.key] ?? (section.key === todayKey || section.key === yesterdayKey)),
              }))}
              style={({ pressed }) => [
                styles.dayHeading,
                {
                  backgroundColor: pressed ? theme.primarySoft : 'transparent',
                  borderBottomColor: theme.border,
                  borderBottomWidth: section.expanded ? StyleSheet.hairlineWidth : 0,
                  borderRadius: section.expanded ? 0 : theme.presentation.cardRadius,
                  borderTopLeftRadius: theme.presentation.cardRadius,
                  borderTopRightRadius: theme.presentation.cardRadius,
                },
              ]}
            >
              <Text style={[styles.dayHeadingText, { color: section.key === todayKey || section.key === yesterdayKey ? theme.primary : theme.text }]}>{section.title}</Text>
              <Text style={[styles.dayCount, { color: theme.textMuted }]}>{activity?t('activity.loaded',{count:section.count}):section.count}</Text>
              <MaterialCommunityIcons
                accessibilityElementsHidden
                importantForAccessibility="no"
                name={section.expanded ? 'chevron-up' : 'chevron-down'}
                size={22}
                color={theme.textMuted}
              />
            </Pressable>
            {section.data.map((event, index) => (
              <View key={event.id} style={styles.dayRow}>
                <EventRow
                  event={event}
                  now={isOpenNap(event) ? now : 0}
                  onEdit={startEditing}
                  onDelete={queueDelete}
                  showDivider={index < section.data.length - 1}
                  theme={theme}
                />
              </View>
            ))}
            {section.expanded && section.count === 0 && !page.loading && !page.error && (section.key === todayKey || section.key === yesterdayKey) ? (
              <Text testID={section.key === todayKey ? 'history.empty' : undefined} style={[styles.emptyDay, { color: theme.textMuted }]}>
                {t(section.key === todayKey ? 'log.emptyTitle' : 'log.emptyDay')}
              </Text>
            ) : null}
          </View>
        )}
        ListFooterComponent={<>
          <ActivityLoadState loading={page.loading} error={page.error} onRetry={page.retry} theme={theme}/>
          {!page.loading&&!page.error&&(hasMoreDays||!!activity&&page.next) ? (
          <Pressable
            testID="history.loadMore"
            accessibilityRole="button"
            onPress={() => {if(activity&&!hasMoreDays)void page.loadMore();setLoadedOlderDays((count) => count + olderDaysPerPage);}}
            style={({ pressed }) => [styles.loadMore, { backgroundColor: pressed ? theme.primarySoft : 'transparent' }]}
          >
            <Text style={[styles.loadMoreText, { color: theme.primary }]}>{t('log.loadMore')}</Text>
          </Pressable>
        ) : null}</>}
      /> : null}

      <Modal visible={draft !== null} transparent animationType="none" onRequestClose={handleSystemClose}>
        <KeyboardAvoidingView
          testID="editor"
          accessibilityViewIsModal
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          enabled={Platform.OS !== 'ios'}
          style={styles.scrim}
        >
          <ScrollView
            automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
            accessibilityElementsHidden={historyOpen}
            importantForAccessibility={historyOpen?'no-hide-descendants':'auto'}
            pointerEvents={closing||historyOpen?'none':'auto'}
            bounces={false}
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
            keyboardShouldPersistTaps="handled"
            style={[
              styles.sheet,
              historyOpen&&styles.hiddenEditor,
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
                  { backgroundColor: draftColors.softColor, borderRadius: theme.presentation.iconRadius },
                ]}
              >
                <ActivityIcon activity={draft ?? { type: 'pee' }} theme={theme} color={draftColors.color} size={23} />
              </View>
              <View style={styles.editorHeadingCopy}>
                <Text
                  style={[
                    styles.sheetTitle,
                    {
                      color: theme.text,
                      fontWeight: theme.presentation.titleWeight,
                      fontFamily: theme.presentation.headingFont,
                      letterSpacing: theme.presentation.titleTracking,
                    },
                  ]}
                >
                  {t(timedNap ? 'editor.editNap' : 'editor.editLog')}
                </Text>
              </View>
              <Pressable
                testID="editor.close"
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

            {saveStatus === 'deleted' ? (
              <Pressable
                testID="editor.shareDeletedDraft"
                accessibilityRole="button"
                onPress={() => {const current=draftRef.current;if(current)void Share.share({message:[activityLabel({type:current.type,customLabel:current.customLabel}),new Date(current.at).toISOString(),current.note].filter(Boolean).join('\n')}).catch(()=>Alert.alert(t('editor.shareError')));}}
                style={[styles.saveStatus,{backgroundColor:theme.surface,borderColor:theme.danger}]}
              >
                <MaterialCommunityIcons name="share-variant-outline" color={theme.danger} size={18}/>
                <Text style={[styles.saveStatusText,{color:theme.danger}]}>{t('editor.deletedBody')} {t('editor.shareDraft')}</Text>
              </Pressable>
            ) : null}

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
            ) : null}

            {draft && draft.event.type !== 'nap' ? (
              <>
                <Text style={[styles.fieldLabel, { color: theme.textMuted }]}>{t('editor.activity')}</Text>
                <View style={styles.typePicker}>
                  {[...editableEventTypes.map((type) => ({ type, customLabel: undefined as string | undefined })),
                    ...customActivities.map((customLabel) => ({ type: 'custom' as EventType, customLabel }))].map(({ type, customLabel }) => {
                    const activity = { type, customLabel };
                    const colors = activityColors(theme, activity);
                    const matchingCustom = customActivities.some((item) => customActivityKey(item) === customActivityKey(draft.customLabel));
                    const selected = draft.type === type && (type !== 'custom'
                      || (customLabel ? customActivityKey(draft.customLabel) === customActivityKey(customLabel) : !matchingCustom));
                    const label = activityLabel(activity);
                    return (
                      <Pressable
                        key={customLabel ? customActivityKey(customLabel) : type}
                        testID={`editor.type.${type}`}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        accessibilityLabel={t('editor.changeActivity', { activity: label })}
                        onPress={() => {
                          setCustomTouched(false);
                          updateDraft((current) => ({ ...current, type, customLabel: customLabel ?? (type === 'custom' ? current.customLabel : '') }));
                        }}
                        style={({ pressed }) => [
                          styles.typeChoice,
                          {
                            backgroundColor: selected ? colors.softColor : theme.surface,
                            borderColor: selected || pressed ? colors.color : theme.border,
                            borderRadius: theme.presentation.controlRadius,
                            borderWidth: theme.presentation.borderWidth,
                          },
                        ]}
                      >
                        <ActivityIcon activity={activity} theme={theme} color={selected ? colors.color : theme.textMuted} size={20} />
                        <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.typeChoiceText, { color: selected ? colors.color : theme.text }]}>
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
                      testID="editor.custom.input"
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
                          backgroundColor: selected ? draftColors.softColor : theme.surface,
                          borderColor: selected || pressed ? draftColors.color : theme.border,
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

            {draft&&Platform.OS!=='web'?<View testID="editor.datetime" style={{minHeight:48,width:'100%'}}>
              {Platform.OS==='ios'?<DateTimePicker value={new Date(activeValue)} mode="datetime" display="compact" locale={locale} style={{width:'100%',minHeight:48}} themeVariant={theme.isDark?'dark':'light'} accentColor={theme.primary} disabled={closing} minimumDate={draft.field==='end'?new Date(draft.at):undefined} maximumDate={new Date(draft.field==='end'?Date.now():typeof draft.endedAt==='number'?draft.endedAt:Date.now())} onValueChange={(_event,date)=>{if(!closing&&date.getTime()!==activeValue)setDraftTime(date.getTime());}}/>
                :<View style={{flexDirection:'row',gap:8}}>{(['date','time'] as const).map(mode=><Pressable key={mode} testID={`editor.datetime.${mode}`} accessibilityRole="button" accessibilityLabel={`${t(mode==='date'?'editor.date':'editor.time')}: ${mode==='date'?dateLabel(activeValue,locale):formatTime(activeValue)}`} disabled={closing} onPress={()=>{Keyboard.dismiss();setNativePicker(mode);}} style={({pressed})=>({flex:1,minHeight:48,padding:12,alignItems:'center',justifyContent:'center',borderRadius:theme.presentation.controlRadius,backgroundColor:pressed?theme.primarySoft:theme.surface})}><Text style={{fontSize:15,color:theme.primary}}>{mode==='date'?new Intl.DateTimeFormat(locale,{dateStyle:'medium'}).format(activeValue):formatTime(activeValue)}</Text></Pressable>)}</View>}
              {Platform.OS==='android'&&nativePicker?<DateTimePicker value={new Date(activeValue)} mode={nativePicker} presentation="dialog" style={{width:1,height:1}} minimumDate={draft.field==='end'?new Date(draft.at):undefined} maximumDate={new Date(draft.field==='end'?Date.now():typeof draft.endedAt==='number'?draft.endedAt:Date.now())} onDismiss={()=>setNativePicker(null)} onValueChange={(_event,date)=>{setNativePicker(null);if(!closing&&date.getTime()!==activeValue)setDraftTime(date.getTime());}}/>:null}
            </View>:null}

            <Text style={[styles.fieldLabel, { color: theme.textMuted }]}>
              {timedNap
                ? t('editor.adjustField', { field: t(draft?.field === 'end' ? 'editor.end' : 'editor.start') })
                : t('editor.adjustTime')}
            </Text>
            <View style={styles.quickTimes}>
              <View style={styles.adjustmentHeaders}>
                <Text style={[styles.adjustmentHeaderText, styles.adjustmentHeaderEarlier, { color: theme.primary }]}>{t('editor.earlier')}</Text>
                <Text style={[styles.adjustmentHeaderText, styles.adjustmentHeaderLater, { color: theme.textMuted }]}>{t('editor.later')}</Text>
              </View>
              <View style={styles.adjustmentQuartet}>
                {timeAdjustments.map((minutes) => {
                  const direction = minutes < 0 ? -1 : 1;
                  const duration = Math.abs(minutes);
                  const latestValue = draft?.field === 'end' ? Date.now() : typeof draft?.endedAt === 'number' ? draft.endedAt : Date.now();
                  const nextValue = activeValue + minutes * 60_000;
                  const disabled = direction < 0
                    ? draft?.field === 'end' && nextValue < (draft?.at ?? 0)
                    : (draft?.field === 'end' && draft.endedAt == null) || nextValue > latestValue;
                  return (
                    <Pressable
                      key={minutes}
                      testID={`editor.adjust.${direction < 0 ? 'back' : 'forward'}.${duration}`}
                      accessibilityRole="button"
                      accessibilityState={{ disabled }}
                      accessibilityLabel={t(direction < 0 ? 'editor.moveEarlier' : 'editor.moveLater', {
                        field: adjustmentField,
                        count: duration,
                      })}
                      disabled={disabled}
                      onPress={() => adjustDraftTime(minutes)}
                      style={({ pressed }) => [
                        styles.quickTime,
                        direction < 0 ? styles.quickTimeTallBack : styles.quickTimeTallForward,
                        {
                          backgroundColor: direction < 0 ? theme.primary : theme.surface,
                          borderColor: direction < 0 ? theme.primary : theme.border,
                          borderRadius: theme.presentation.controlRadius,
                          borderWidth: theme.presentation.borderWidth,
                          opacity: disabled ? 0.45 : pressed ? 0.7 : 1,
                        },
                      ]}
                    >
                      <Text
                        numberOfLines={1}
                        adjustsFontSizeToFit
                        minimumFontScale={0.75}
                        style={[styles.quickTimeText, { color: direction < 0 ? theme.onPrimary : theme.text }]}
                      >
                        {`${direction < 0 ? '−' : '+'}${t(duration === 60 ? 'time.hours' : 'time.minutes', { count: duration === 60 ? 1 : duration })}`}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <View style={styles.dayAdjustment}>
                {([-1, 1] as const).map((direction) => {
                  const candidate = new Date(activeValue);
                  candidate.setDate(candidate.getDate() + direction);
                  const latestValue = draft?.field === 'end' ? Date.now() : typeof draft?.endedAt === 'number' ? draft.endedAt : Date.now();
                  const disabled = direction < 0
                    ? draft?.field === 'end' && candidate.getTime() < (draft?.at ?? 0)
                    : candidate.getTime() > latestValue;
                  return (
                    <Pressable
                      key={direction}
                      testID={`editor.adjust.${direction < 0 ? 'back' : 'forward'}.day`}
                      accessibilityRole="button"
                      accessibilityState={{ disabled }}
                      accessibilityLabel={t(direction < 0 ? 'editor.moveDayEarlier' : 'editor.moveDayLater', { field: adjustmentField })}
                      disabled={disabled}
                      onPress={() => adjustDraftDay(direction)}
                      style={({ pressed }) => [
                        styles.quickTime,
                        direction < 0 ? styles.quickDayPrimary : styles.quickDaySecondary,
                        {
                          backgroundColor: direction < 0 ? theme.primarySoft : theme.surface,
                          borderColor: direction < 0 ? theme.primary : theme.border,
                          borderRadius: theme.presentation.controlRadius,
                          borderWidth: theme.presentation.borderWidth,
                          opacity: disabled ? 0.45 : pressed ? 0.7 : 1,
                        },
                      ]}
                    >
                      <Text style={[styles.quickTimeText, { color: direction < 0 ? theme.primary : theme.text }]}>
                        {`${direction < 0 ? '−' : '+'}${t('time.days', { count: 1 })}`}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <Text style={[styles.fieldLabel, styles.noteLabel, { color: theme.textMuted }]}>{t('editor.note')}</Text>
            {draft ? (
              <NoteInput
                key={draft.event.id}
                autoFocus={focusNote}
                active={!historyOpen&&!closing}
                value={draft.note}
                onBlur={() => void flushAutoSave()}
                onChangeText={(note) => updateDraft((current) => ({ ...current, note }))}
                theme={theme}
              />
            ) : null}
            {history?<Pressable testID="editor.history" accessibilityRole="button" disabled={closing} accessibilityState={{disabled:closing,busy:closing}} onPress={()=>{void requestHistory();}} style={({pressed})=>[styles.historyAction,{borderColor:theme.border,backgroundColor:pressed?theme.primarySoft:theme.surface,borderRadius:theme.presentation.controlRadius,opacity:closing?0.5:1}]}><MaterialCommunityIcons accessible={false} name="history" size={21} color={theme.primary}/><Text style={[styles.historyLabel,{color:theme.primary}]}>{t('history.open')}</Text><MaterialCommunityIcons accessible={false} name="chevron-right" size={20} color={theme.textMuted}/></Pressable>:null}
          </ScrollView>
          {historyOpen&&history&&draft?<View style={[styles.sheet,styles.historySheet,{backgroundColor:theme.surfaceRaised,borderTopLeftRadius:theme.presentation.cardRadius+6,borderTopRightRadius:theme.presentation.cardRadius+6}]}><EventHistoryPanel data={history} eventId={draft.event.id} cloud={cloud} theme={theme} refreshToken={refreshToken} onBack={()=>{void returnFromHistory();}} onRestored={restoredHistory} onBusyChange={value=>{historyBusy.current=value;}}/></View>:null}
        </KeyboardAvoidingView>
      </Modal>

      <ConfirmDialog
        visible={pendingDelete !== null}
        title={t('app.deleteTitle')}
        message={pendingDelete ? t('app.deleteMessage', {
          activity: eventPastLabel(pendingDelete),
          time: new Date(pendingDelete.at).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' }),
        }) : ''}
        confirmLabel={t('app.delete')}
        error={deleteFailed ? t('app.deleteErrorBody') : undefined}
        busy={deleting}
        theme={theme}
        onCancel={() => { setPendingDelete(null); setDeleteFailed(false); }}
        onConfirm={() => void confirmDelete()}
      />
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
  titleBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: spacing.lg,
  },
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
  dayCard: { marginBottom: spacing.sm },
  dayHeading: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14 },
  dayHeadingText: { flex: 1, fontSize: 15, lineHeight: 20, fontWeight: '700' },
  dayCount: { fontSize: 13, lineHeight: 18, fontWeight: '700', fontVariant: ['tabular-nums'] },
  dayRow: { paddingHorizontal: 14 },
  emptyDay: { fontSize: 14, lineHeight: 20, paddingHorizontal: 14, paddingVertical: spacing.md },
  loadMore: { minHeight: 48, alignItems: 'center', justifyContent: 'center', marginTop: spacing.md },
  loadMoreText: { fontSize: 14, fontWeight: '700' },
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
  hiddenEditor:{display:'none'},historySheet:{height:'92%',overflow:'hidden'},historyAction:{minHeight:50,marginTop:20,borderWidth:1,paddingHorizontal:14,flexDirection:'row',alignItems:'center',gap:10},historyLabel:{flex:1,fontSize:16,lineHeight:22,fontWeight:'600'},
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
  adjustmentHeaders: { flexDirection: 'row', gap: 8 },
  adjustmentHeaderText: { textAlign: 'center', fontSize: 11, lineHeight: 16, fontWeight: '800', letterSpacing: 1.1 },
  adjustmentHeaderEarlier: { flex: 3 },
  adjustmentHeaderLater: { flex: 2 },
  quickTimes: { gap: 8, marginBottom: spacing.lg },
  adjustmentQuartet: { flexDirection: 'row', gap: 8 },
  dayAdjustment: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  quickTime: { flex: 1, borderWidth: 1, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  quickTimeTallBack: { flex: 3, minHeight: 112 },
  quickTimeTallForward: { flex: 2, minHeight: 112 },
  quickDayPrimary: { minHeight: 58 },
  quickDaySecondary: { minHeight: 58 },
  quickTimeText: { fontSize: 18, fontWeight: '800', fontVariant: ['tabular-nums'] },
});

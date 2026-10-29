import { useTelemetryOverlay } from '../telemetry';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Alert,
  Keyboard,
  Linking,
  Modal,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Pressable } from '../components/TelemetryPressable';

import { scheduleStatusesForDay, suggestScheduleFromEvents } from '../analytics';
import {activityWindowBounds,useActivityWindow,type ActivityViewProps} from '../activity-view';
import {ActivityLoadState} from '../components/ActivityLoadState';
import {RoutineDayPreview,RoutineTimeline} from '../components/RoutineTimeline';
import { ActivityIcon } from '../components/ActivityIcon';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { DateTimeSelector } from '../components/DateTimeSelector';
import { customActivityKey, formatMinutes, formatScheduleWindow, quickEventTypes, type EventType, type ScheduleEntry } from '../domain';
import type { PuppyEvent } from '../domain';
import { useLocalization } from '../localization-context';
import { spacing, surfaceTreatment, type Theme } from '../theme';
import { ScheduleEntryDeletedError } from '../schedule-editor';
import { entityId } from '../entity-id';

type Draft = { id: string; type: EventType; customLabel?: string; minutes: number; reminder: boolean; toleranceMinutes?: number };

export function ScheduleScreen({
  events:projectedEvents,
  activity,
  refreshToken,
  schedule,
  customActivities,
  onChange,
  onSaveEntry,
  onRemoveEntry,
  onRequestReminderPermission,
  theme,
  setupHeader,
  showHeader=true,
}: {
  events: PuppyEvent[];
  schedule: ScheduleEntry[];
  customActivities: string[];
  onChange: (schedule: ScheduleEntry[]) => Promise<void>;
  onSaveEntry:(entry:ScheduleEntry,original?:ScheduleEntry)=>Promise<void>;
  onRemoveEntry:(id:string)=>Promise<void>;
  onRequestReminderPermission: () => Promise<boolean>;
  theme: Theme;
  setupHeader?: ReactNode;
  showHeader?: boolean;
}&ActivityViewProps) {
  const { activityColors, activityLabel, locale, t } = useLocalization();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [previewIds,setPreviewIds]=useState<string[]|null>(null);
  const previewEntries=previewIds===null?null:schedule.filter(entry=>previewIds.includes(entry.id)).sort((a,b)=>a.minutes-b.minutes);
  useTelemetryOverlay('routine_editor', draft !== null);
  const originalDraft=useRef<ScheduleEntry|undefined>(undefined);
  const acceptedSuggestion=useRef<{entries:ScheduleEntry[];preview:ReturnType<typeof suggestScheduleFromEvents>}|null>(null);
  const [showTimeSelector, setShowTimeSelector] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<ScheduleEntry | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removeFailed, setRemoveFailed] = useState(false);
  const [requestingPermission, setRequestingPermission] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reviewingSuggestion, setReviewingSuggestion] = useState(false);
  const [applyingSuggestion, setApplyingSuggestion] = useState(false);
  const [now, setNow] = useState(Date.now());
  const bounds=activityWindowBounds(now,14);
  const window=useActivityWindow(activity,projectedEvents,bounds.from,bounds.until,refreshToken);
  const events=window.events;

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const statuses = useMemo(()=>scheduleStatusesForDay(events, schedule, new Date(now), 30, now),[events,schedule,now]);
  const suggestion = suggestScheduleFromEvents(events, 14, new Date(now));
  const previewSuggestion = acceptedSuggestion.current?.preview ?? suggestion;
  const canSuggest = suggestion.entries.length > 0&&!window.loading&&!window.error;

  const editEntry=useCallback((entry:ScheduleEntry)=>{
    originalDraft.current={...entry,reminder:Boolean(entry.reminder)};
    setDraft({...originalDraft.current,reminder:Boolean(entry.reminder)});
    setShowTimeSelector(false);
  },[]);
  const selectPreview=useCallback((entries:ScheduleEntry[])=>{
    setShowTimeSelector(false);
    if(entries.length===1)editEntry(entries[0]);
    else setPreviewIds(entries.map(entry=>entry.id));
  },[editEntry]);
  const requestRemove=useCallback((entry:ScheduleEntry)=>{setRemoveFailed(false);setPendingRemove(entry);},[]);

  const openNew = () => {
    const now = new Date();
    const rounded = Math.round((now.getHours() * 60 + now.getMinutes()) / 15) * 15;
    originalDraft.current=undefined;setDraft({ id: entityId('rtn'), type: 'pee', minutes: rounded % (24 * 60), reminder: false });
    setShowTimeSelector(false);
  };

  const save = async () => {
    if (!draft || saving) return;
    const entry: ScheduleEntry = {
      id: draft.id,
      type: draft.type,
      ...(draft.type === 'custom' ? { customLabel: draft.customLabel } : {}),
      minutes: draft.minutes,
      reminder: draft.reminder,
      ...(draft.toleranceMinutes === undefined ? {} : { toleranceMinutes: draft.toleranceMinutes }),
    };
    setSaving(true);
    try {
      await onSaveEntry(entry,originalDraft.current);
      setDraft(null);
    } catch(error) {
      Alert.alert(t(error instanceof ScheduleEntryDeletedError?'schedule.removedErrorTitle':'schedule.saveErrorTitle'), t(error instanceof ScheduleEntryDeletedError?'schedule.removedErrorBody':'schedule.saveErrorBody'));
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

  const confirmRemove = async () => {
    if (!pendingRemove || removing) return;
    setRemoving(true);
    setRemoveFailed(false);
    try {
      await onRemoveEntry(pendingRemove.id);
      setPendingRemove(null);
    } catch {
      setRemoveFailed(true);
    } finally {
      setRemoving(false);
    }
  };

  const pickerDate = new Date(2000, 0, 1, Math.floor((draft?.minutes ?? 0) / 60), (draft?.minutes ?? 0) % 60);
  const onPick = (date: Date) => {
    if (!draft) return;
    setDraft({ ...draft, minutes: date.getHours() * 60 + date.getMinutes() });
    setShowTimeSelector(false);
  };

  const applySuggestion = async () => {
    if (!previewSuggestion.entries.length || applyingSuggestion || (!acceptedSuggestion.current && !canSuggest)) return;
    setApplyingSuggestion(true);
    try {
      acceptedSuggestion.current ??= {preview:previewSuggestion,entries:previewSuggestion.entries.map(entry=>({...entry,id:entityId('rtn')}))};
      await onChange(acceptedSuggestion.current.entries);
      setReviewingSuggestion(false);
    } catch {
      Alert.alert(t('schedule.suggestionErrorTitle'), t('schedule.suggestionErrorBody'));
    } finally {
      setApplyingSuggestion(false);
    }
  };

  const suggestionCard=<View testID="schedule.suggestions"
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
              onPress={() => { acceptedSuggestion.current=null;setReviewingSuggestion(true); }}
              style={({ pressed }) => [
                styles.learnButton,
                {
                  backgroundColor: schedule.length ? theme.primarySoft : theme.primary,
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
                color={schedule.length?theme.primary:theme.onPrimary}
                size={20}
              />
              <Text style={[styles.learnButtonText, { color: schedule.length?theme.primary:theme.onPrimary }]}>
                {t('schedule.previewButton')}
              </Text>
            </Pressable>
          ) : null}
        </View>;

  return (
    <>
      <ScrollView testID="screen.schedule" contentContainerStyle={styles.content}>
        <ActivityLoadState loading={window.loading} error={window.error} onRetry={window.retry} theme={theme}/>
        {setupHeader ?? <>
        {showHeader?<Text
          accessibilityRole="header"
          numberOfLines={1}
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
          {t('schedule.title')}
        </Text>:null}

        {!schedule.length?suggestionCard:null}

        </>}
        {!setupHeader && schedule.length ? (
          <RoutineDayPreview statuses={statuses} now={now} theme={theme} onSelect={selectPreview}/>
        ) : null}

        {!setupHeader && schedule.length ? (
          <View testID="schedule.plan" style={styles.headingRow}>
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
          <RoutineTimeline statuses={statuses} now={now} theme={theme} setup={Boolean(setupHeader)} onEdit={editEntry} onRemove={requestRemove}/>
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
        {!setupHeader&&schedule.length?suggestionCard:null}
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
                    days: previewSuggestion.daysAnalyzed,
                    period: previewSuggestion.periodDays,
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
              {previewSuggestion.entries.map((entry, index) => {
                const { color, softColor: background } = activityColors(theme, entry);
                const label = activityLabel(entry);
                return (
                  <View
                    key={entry.id}
                    accessible
                    accessibilityLabel={`${label}. ${t('schedule.usualWindow', { range: formatScheduleWindow(entry, locale) })}. ${t('schedule.patternDays', { count: previewSuggestion.observedDaysByEntry[entry.id], days: previewSuggestion.daysAnalyzed })}`}
                    style={[
                      styles.previewRow,
                      index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border },
                    ]}
                  >
                    <View style={[styles.previewIcon, { backgroundColor: background }]}>
                      <ActivityIcon activity={entry} theme={theme} color={color} size={19} />
                    </View>
                    <View style={styles.previewCopy}>
                      <Text style={[styles.previewActivity, { color: theme.text }]}>{label}</Text>
                      <Text style={[styles.windowDetail, { color: theme.textMuted }]}>
                        {t('schedule.usualWindow', { range: formatScheduleWindow(entry, locale) })}
                      </Text>
                      <Text style={[styles.windowDetail, { color: theme.textMuted }]}>
                        {t('schedule.patternDays', { count: previewSuggestion.observedDaysByEntry[entry.id], days: previewSuggestion.daysAnalyzed })}
                      </Text>
                    </View>
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

      <Modal visible={draft !== null||previewIds!==null} transparent animationType="none" onRequestClose={() => {
        if(previewIds!==null){setPreviewIds(null);return;}
        const focusedInput = TextInput.State.currentlyFocusedInput();
        if (focusedInput) {
          focusedInput.blur();
          Keyboard.dismiss();
        } else if (showTimeSelector) setShowTimeSelector(false);
        else setDraft(null);
      }}>
        <View testID="schedule.editor" accessibilityViewIsModal style={styles.scrim}>
          <ScrollView
            key={previewIds!==null?'choices':draft?.id}
            bounces={false}
            style={[styles.sheet, { backgroundColor: theme.surfaceRaised }]}
            contentContainerStyle={styles.sheetContent}
          >
            <View style={styles.sheetHeading}>
              <Text style={[styles.sheetTitle, { color: theme.text }]}>
                {t(previewIds!==null||originalDraft.current ? 'schedule.editTime' : 'schedule.addTime')}
              </Text>
              <Pressable
                testID="schedule.editor.close"
                accessibilityLabel={t('schedule.close')}
                onPress={() => {setDraft(null);setPreviewIds(null);}}
                style={({ pressed }) => [styles.closeButton, pressed && { backgroundColor: theme.primarySoft }]}
              >
                <MaterialCommunityIcons name="close" size={22} color={theme.text} />
              </Pressable>
            </View>

            {previewEntries?<View testID="schedule.timelineChoices">
              {previewEntries.length?previewEntries.map(entry=><Pressable key={entry.id} testID={`schedule.previewChoice.${entry.id}`} accessibilityRole="button"
                accessibilityLabel={`${t('common.edit')}: ${t('schedule.entryAt',{activity:activityLabel(entry),time:formatMinutes(entry.minutes,locale)})}`}
                onPress={()=>{setPreviewIds(null);editEntry(entry);}} style={({pressed})=>[styles.previewChoice,{borderColor:theme.border,backgroundColor:pressed?theme.primarySoft:undefined}]}>
                <ActivityIcon activity={entry} theme={theme} color={activityColors(theme,entry).color} size={21}/>
                <View style={styles.previewCopy}><Text style={[styles.previewActivity,{color:theme.text}]}>{activityLabel(entry)}</Text><Text style={[styles.windowDetail,{color:theme.textMuted}]}>{entry.toleranceMinutes===undefined?formatMinutes(entry.minutes,locale):formatScheduleWindow(entry,locale)}</Text></View>
                <MaterialCommunityIcons accessible={false} name="chevron-right" size={20} color={theme.textMuted}/>
              </Pressable>):<Text style={[styles.previewSubtitle,{color:theme.textMuted}]}>{t('schedule.removedErrorBody')}</Text>}
            </View>:<>
            <Text style={[styles.fieldLabel, { color: theme.textMuted }]}>{t('schedule.activity')}</Text>
            <View style={styles.typePicker}>
              {[...quickEventTypes.map((type) => ({ type, customLabel: undefined as string | undefined })),
                ...customActivities.map((customLabel) => ({ type: 'custom' as EventType, customLabel }))].map(({ type, customLabel }) => {
                const selected = draft?.type === type && (type !== 'custom' || customActivityKey(draft.customLabel ?? '') === customActivityKey(customLabel ?? ''));
                const activity = { type, customLabel };
                const colors = activityColors(theme, activity);
                const label = activityLabel(activity);
                return (
                  <Pressable
                    key={customLabel ? customActivityKey(customLabel) : type}
                    testID={`schedule.editor.type.${type}`}
                    accessibilityState={{ selected }}
                    onPress={() => draft && setDraft({ ...draft, type, customLabel, toleranceMinutes: selected ? draft.toleranceMinutes : undefined })}
                    style={({ pressed }) => [
                      styles.typeChoice,
                      {
                        backgroundColor: selected ? colors.softColor : theme.surface,
                        borderColor: selected ? colors.color : theme.border,
                        opacity: pressed ? 0.7 : 1,
                      },
                    ]}
                  >
                    <ActivityIcon activity={activity} theme={theme} color={selected ? colors.color : theme.textMuted} size={21} />
                    <Text style={[styles.typeChoiceText, { color: selected ? colors.color : theme.text }]}>{label}</Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={[styles.fieldLabel, { color: theme.textMuted }]}>{t('schedule.time')}</Text>
            <Pressable
              testID="schedule.editor.time"
              accessibilityRole="button"
              accessibilityState={{ expanded: showTimeSelector }}
              onPress={() => setShowTimeSelector(true)}
              style={({ pressed }) => [styles.timeButton, { backgroundColor: showTimeSelector || pressed ? theme.primarySoft : theme.surface, borderColor: showTimeSelector ? theme.primary : theme.border, borderRadius: theme.presentation.controlRadius, borderWidth: theme.presentation.borderWidth }]}
            >
              <MaterialCommunityIcons name="clock-outline" size={22} color={theme.primary} />
              <Text style={[styles.timeButtonText, { color: theme.text }]}>{formatMinutes(draft?.minutes ?? 0, locale)}</Text>
              <MaterialCommunityIcons name="chevron-right" size={22} color={theme.textMuted} />
            </Pressable>

            {draft && (draft.type === 'meal' || draft.type === 'poop') ? (
              <>
                <View style={[styles.reminderRow, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                  <View style={[styles.reminderIcon, { backgroundColor: theme.primarySoft }]}>
                    <MaterialCommunityIcons accessibilityElementsHidden importantForAccessibility="no" name="calendar-clock-outline" size={21} color={theme.primary} />
                  </View>
                  <Text style={[styles.reminderCopy, styles.reminderTitle, { color: theme.text }]}>{t('schedule.expectedWindow')}</Text>
                  <Switch
                    testID="schedule.editor.window"
                    accessibilityLabel={t('schedule.expectedWindow')}
                    ios_backgroundColor={theme.border}
                    trackColor={{ false: theme.border, true: theme.primary }}
                    value={Boolean(draft.toleranceMinutes)}
                    onValueChange={enabled => setDraft({ ...draft, toleranceMinutes: enabled ? 30 : undefined })}
                  />
                </View>
                {draft.toleranceMinutes ? (
                  <>
                    <View accessibilityRole="radiogroup" style={styles.windowChoices}>
                      {[...new Set([15, 30, 60, 90, draft.toleranceMinutes])].sort((a,b)=>a-b).map(minutes => (
                        <Pressable
                          key={minutes}
                          testID={`schedule.editor.window.${minutes}`}
                          accessibilityRole="radio"
                          accessibilityLabel={t('schedule.windowSizeA11y', { minutes })}
                          accessibilityState={{ checked: draft.toleranceMinutes === minutes }}
                          onPress={() => setDraft({ ...draft, toleranceMinutes: minutes })}
                          style={({ pressed }) => [styles.windowChoice, {
                            backgroundColor: draft.toleranceMinutes === minutes ? theme.primarySoft : theme.surface,
                            borderColor: draft.toleranceMinutes === minutes ? theme.primary : theme.border,
                            opacity: pressed ? 0.7 : 1,
                          }]}
                        >
                          <Text style={[styles.typeChoiceText, { color: draft.toleranceMinutes === minutes ? theme.primary : theme.text }]}>{t('schedule.windowSize', { minutes })}</Text>
                        </Pressable>
                      ))}
                    </View>
                    <Text testID="schedule.editor.window.range" style={[styles.previewSubtitle, { color: theme.text }]}>{formatScheduleWindow(draft, locale)}</Text>
                  </>
                ) : null}
                <Text style={[styles.previewSubtitle, { color: theme.textMuted }]}>{t('schedule.windowHelp')}</Text>
              </>
            ) : draft?.toleranceMinutes !== undefined ? (
              <Text style={[styles.previewSubtitle, { color: theme.textMuted }]}>
                {t('schedule.windowReminder', { range: formatScheduleWindow(draft, locale) })}
              </Text>
            ) : null}
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
            </>}
          </ScrollView>
          {showTimeSelector ? (
            <DateTimeSelector
              value={pickerDate}
              mode="time"
              locale={locale}
              theme={theme}
              onChange={onPick}
              onCancel={() => setShowTimeSelector(false)}
            />
          ) : null}
        </View>
      </Modal>
      <ConfirmDialog
        visible={pendingRemove !== null}
        title={t('schedule.removeTitle')}
        message={pendingRemove ? t('schedule.entryAt', {
          activity: activityLabel(pendingRemove),
          time: formatMinutes(pendingRemove.minutes, locale),
        }) : ''}
        confirmLabel={t('schedule.remove')}
        error={removeFailed ? t('schedule.removeErrorBody') : undefined}
        busy={removing}
        theme={theme}
        onCancel={() => { setPendingRemove(null); setRemoveFailed(false); }}
        onConfirm={() => void confirmRemove()}
      />
    </>
  );
}

const styles = StyleSheet.create({
  windowChoices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  windowChoice: { minHeight: 48, minWidth: 72, borderWidth: 1, borderRadius: 14, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
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
  headingRow: { flexDirection: 'row', alignItems: 'baseline', marginTop: spacing.md, marginBottom: 8 },
  sectionTitle: { flex: 1, fontSize: 21, fontWeight: '800' },
  windowDetail: { fontSize: 12, lineHeight: 18, marginTop: 2 },
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
  previewChoice:{minHeight:56,paddingVertical:8,flexDirection:'row',alignItems:'center',gap:12,borderBottomWidth:StyleSheet.hairlineWidth},
  previewRow: { minHeight: 86, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 10 },
  previewIcon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  previewCopy: { flex: 1, minWidth: 0 },
  previewActivity: { fontSize: 15, lineHeight: 20, fontWeight: '700' },
  replaceNote: { borderRadius: 14, padding: 12, flexDirection: 'row', alignItems: 'flex-start', gap: 9, marginTop: spacing.md },
  replaceNoteText: { flex: 1, fontSize: 12, lineHeight: 18 },
  cancelButton: { minHeight: 48, borderRadius: 15, alignItems: 'center', justifyContent: 'center', marginTop: spacing.sm },
  cancelText: { fontSize: 15, lineHeight: 20, fontWeight: '700' },
  closeButton: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  fieldLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 1.2, marginBottom: 8 },
  typePicker: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: spacing.lg },
  typeChoice: { flexBasis: '47%', flexGrow: 1, minHeight: 50, borderRadius: 15, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  typeChoiceText: { fontSize: 14, fontWeight: '700' },
  timeButton: { minHeight: 58, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, gap: 10 },
  timeButtonText: { flex: 1, fontSize: 18, fontWeight: '700', fontVariant: ['tabular-nums'] },
  reminderRow: { minHeight: 60, borderWidth: 1, borderRadius: 17, padding: 12, marginTop: spacing.lg, flexDirection: 'row', alignItems: 'center', gap: 11 },
  reminderIcon: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  reminderCopy: { flex: 1, minWidth: 0 },
  reminderTitle: { fontSize: 15, lineHeight: 20, fontWeight: '700' },
  saveButton: { minHeight: 56, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginTop: spacing.lg },
  saveText: { fontSize: 16, fontWeight: '800' },
});

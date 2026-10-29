import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import DateTimePicker from '@expo/ui/community/datetime-picker';
import * as Notifications from 'expo-notifications';
import { ActivityIndicator, Alert, AppState, Modal, Platform, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { Pressable } from '../components/TelemetryPressable';

import { useLocalization } from '../localization-context';
import {
  reminderLeadOptions,
  type NotificationPreferences,
} from '../notification-config';
import { cancelCustomTimedReminder, cancelCustomTimedRemindersIfDeliveryOff, countCustomTimedReminders, createCustomTimedReminder, CustomTimedReminderLimitError, ExactReminderAccessError, CUSTOM_TIMED_REMINDER_NOTIFICATION_KIND, listCustomTimedReminders, type CustomTimedReminder, type NotificationPermissionState } from '../reminders';
import { spacing, surfaceTreatment, type Theme } from '../theme';
import {NotificationTimingControls} from '../components/NotificationTimingControls';
import type {ScheduleEntry} from '../domain';
import {PuppyIdentity} from '../components/PuppyIdentity';
import { entityId } from '../entity-id';
import { openExactReminderSettings, refreshExactReminderScheduling } from '../exact-reminders';

const needsExactAlarmAccess = Platform.OS === 'android' && Number(Platform.Version) >= 31;

export function NotificationsScreen({
  theme,
  petId,
  notificationPreferences,
  notificationPermission,
  notificationDelivery,
  quietStatusEnabled = false,
  onQuietStatusChange,
  onTimedRemindersChange,
  onRequestQuietStatusPermission,
  routineReminderCount,
  onNotificationPreferencesChange,
  onRequestNotificationPermission,
  onNotificationDeliveryChange,
  onOpenSystemSettings,
  onOpenSchedule,onOpenPet,
  schedule=[],onScheduleChange,
}: {
  theme: Theme;
  schedule?:ScheduleEntry[];onScheduleChange?:(schedule:ScheduleEntry[])=>Promise<void>;
  petId?: string;
  notificationPreferences: NotificationPreferences;
  notificationPermission: NotificationPermissionState;
  notificationDelivery?: boolean;
  quietStatusEnabled?: boolean;
  onQuietStatusChange?: (enabled: boolean) => Promise<void>;
  onTimedRemindersChange?: () => Promise<void>;
  onRequestQuietStatusPermission?: () => Promise<boolean>;
  routineReminderCount: number;
  onNotificationPreferencesChange: (preferences: NotificationPreferences) => Promise<void>;
  onRequestNotificationPermission: () => Promise<boolean>;
  onNotificationDeliveryChange?: (enabled: boolean) => Promise<void>;
  onOpenSystemSettings: () => void;
  onOpenSchedule: () => void;
  onOpenPet?:()=>void;
}) {
  const { t, language, locale } = useLocalization();
  const [timed, setTimed] = useState<CustomTimedReminder[]>([]);
  const [timedLoading, setTimedLoading] = useState(true);
  const [timedLoadFailed, setTimedLoadFailed] = useState(false);
  const [exactAccess, setExactAccess] = useState<boolean | null>(null);
  const [exactChecking, setExactChecking] = useState(needsExactAlarmAccess);
  const [exactFailed, setExactFailed] = useState(false);
  const [draft, setDraft] = useState<{ id: string; label: string; at: Date } | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const loadGeneration = useRef(0);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const cardStyle = [styles.card, surfaceTreatment(theme), {
    backgroundColor: theme.surfaceRaised,
    borderColor: theme.border,
    borderRadius: theme.presentation.cardRadius,
  }];

  const reloadExactAccess = useCallback(async () => {
    if (!needsExactAlarmAccess) return;
    setExactChecking(true);
    try {
      const allowed = await refreshExactReminderScheduling();
      setExactAccess(allowed); setExactFailed(false);
      if (allowed) setDraftError(current => current === t('notifications.exactRequired') ? null : current);
    }
    catch { setExactAccess(null); setExactFailed(true); }
    finally { setExactChecking(false); }
  }, [t]);

  useEffect(() => {
    void reloadExactAccess();
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') void reloadExactAccess(); });
    return () => subscription.remove();
  }, [reloadExactAccess]);

  const reloadTimed = useCallback(async () => {
    const generation = ++loadGeneration.current;
    if (!petId) { setTimed([]); setTimedLoading(true); return; }
    setTimedLoading(true);
    try {
      await cancelCustomTimedRemindersIfDeliveryOff();
      const next = await listCustomTimedReminders(petId);
      if (generation === loadGeneration.current) { setTimed(next); setTimedLoadFailed(false); }
    } catch {
      if (generation === loadGeneration.current) setTimedLoadFailed(true);
    } finally {
      if (generation === loadGeneration.current) setTimedLoading(false);
    }
  }, [petId]);

  useEffect(() => {
    setDraft(null);
    void reloadTimed();
    const appState = AppState.addEventListener('change', (state) => { if (state === 'active') void reloadTimed(); });
    const received = Notifications.addNotificationReceivedListener((notification) => {
      if (notification.request.content.data?.kind === CUSTOM_TIMED_REMINDER_NOTIFICATION_KIND) void reloadTimed();
    });
    return () => { ++loadGeneration.current; appState.remove(); received.remove(); };
  }, [reloadTimed]);

  const save = async (action: () => Promise<void>) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      await action();
    } catch {
      Alert.alert(t('settings.saveErrorTitle'), t('settings.saveErrorBody'));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const requestNotifications = async (request = onRequestNotificationPermission) => {
    // The shared request also records device opt-in when OS access is blocked.
    const granted = await request();
    if (granted) return true;
    if (notificationPermission === 'blocked') {
      onOpenSystemSettings();
    } else {
      Alert.alert(t('schedule.notificationsOff'), t('schedule.notificationsBody'), [
        { text: t('schedule.notNow'), style: 'cancel' },
        { text: t('schedule.openSettings'), onPress: onOpenSystemSettings },
      ]);
    }
    return false;
  };

  const requestExactAccess = () => {
    if (exactFailed) { void reloadExactAccess(); return; }
    void save(openExactReminderSettings);
  };

  const exactAccessAction = (inEditor = false) => (
    <Pressable testID={inEditor ? 'notifications.timed.exactTiming' : 'settings.notifications.exactTiming'}
      accessibilityRole="button" accessibilityState={{ disabled: saving || exactChecking, busy: exactChecking }}
      disabled={saving || exactChecking} onPress={requestExactAccess}
      style={({ pressed }) => [styles.row, { backgroundColor: pressed ? theme.primarySoft : undefined, borderRadius: theme.presentation.controlRadius }]}>
      <MaterialCommunityIcons accessible={false} name={exactAccess ? 'alarm-check' : 'alarm'} size={24} color={theme.primary} accessibilityElementsHidden importantForAccessibility="no" />
      <View style={styles.copy}>
        <Text style={[styles.label, { color: theme.text }]}>{t('notifications.exactTitle')}</Text>
        <Text testID={inEditor ? 'notifications.timed.exactStatus' : 'settings.notifications.exactStatus'} style={[styles.detail, { color: theme.textMuted }]}>
          {t(exactChecking ? 'notifications.exactChecking' : exactFailed ? 'notifications.exactError' : exactAccess ? 'notifications.exactAllowed' : 'notifications.exactNeeded')}
        </Text>
      </View>
      <MaterialCommunityIcons accessible={false} name="chevron-right" size={23} color={theme.textMuted} accessibilityElementsHidden importantForAccessibility="no" />
    </Pressable>
  );

  const disableDelivery = async () => {
    await onNotificationDeliveryChange?.(false);
    await cancelCustomTimedRemindersIfDeliveryOff();
    await reloadTimed();
  };

  const changeDelivery = (enabled: boolean) => {
    void save(async () => {
      if (enabled) { await requestNotifications(); return; }
      const count = await countCustomTimedReminders();
      if (count === 0) { await disableDelivery(); return; }
      Alert.alert(t('notifications.turnOffTimedTitle'), t('notifications.turnOffTimedBody', { count }), [
        { text: t('app.cancel'), style: 'cancel' },
        { text: t('notifications.turnOffTimedConfirm'), style: 'destructive', onPress: () => { void save(disableDelivery); } },
      ]);
    });
  };

  const addTimed = () => {
    const at = new Date(Date.now() + 3600000);
    at.setSeconds(0, 0);
    setDraftError(null);
    setDraft({ id: entityId('rem'), label: '', at });
  };

  const saveTimed = () => {
    void save(async () => {
      if (!draft || !petId) return;
      const label = draft.label.trim();
      if (!label || label.length > 80 || /[\u0000-\u001f\u007f]/.test(label) || !Number.isFinite(draft.at.getTime()) || draft.at.getTime() <= Date.now()) {
        setDraftError(t('notifications.timedInvalid')); return;
      }
      setDraftError(null);
      try {
        if ((notificationPermission !== 'granted' || notificationDelivery === false) && !(await requestNotifications())) return;
        if (needsExactAlarmAccess && !(await refreshExactReminderScheduling())) {
          setExactAccess(false);
          setDraftError(t('notifications.exactRequired'));
          return;
        }
        const created = await createCustomTimedReminder({ id: draft.id, petId, label, at: draft.at.getTime() });
        if (!created) { setDraftError(t('notifications.timedEnable')); return; }
        setDraft(null);
        await reloadTimed();
        await onTimedRemindersChange?.().catch(() => undefined);
      } catch (error) {
        setDraftError(t(error instanceof CustomTimedReminderLimitError ? 'notifications.timedLimit' : error instanceof ExactReminderAccessError ? 'notifications.exactRequired' : 'settings.saveErrorBody'));
      }
    });
  };

  const removeTimed = (reminder: CustomTimedReminder) => {
    void save(async () => {
      await cancelCustomTimedReminder(reminder.petId, reminder.id);
      setTimed((current) => current.filter((item) => item.id !== reminder.id));
      await reloadTimed();
      await onTimedRemindersChange?.().catch(() => undefined);
    });
  };

  return (
    <>
    <ScrollView testID="screen.notifications" contentContainerStyle={styles.content}>
      <View style={cardStyle}>
        {notificationDelivery !== undefined && onNotificationDeliveryChange ? (
          <View style={styles.row}>
            <MaterialCommunityIcons accessible={false} name="bell-outline" size={24} color={theme.primary}
              accessibilityElementsHidden importantForAccessibility="no" />
            <View style={styles.copy}>
              <Text style={[styles.label, { color: theme.text }]}>{t('settings.deviceDelivery')}</Text>
              {notificationPermission === 'blocked' ? (
                <Text style={[styles.detail, { color: theme.textMuted }]}>{t('settings.permissionBlocked')}</Text>
              ) : null}
            </View>
            <Switch
              testID="settings.notifications.deviceDelivery"
              accessibilityLabel={t('settings.deviceDelivery')}
              disabled={saving}
              hitSlop={8}
              ios_backgroundColor={theme.border}
              thumbColor={theme.surfaceRaised}
              trackColor={{ false: theme.border, true: theme.primary }}
              value={notificationDelivery && notificationPermission === 'granted'}
              onValueChange={changeDelivery}
            />
          </View>
        ) : null}
        {notificationPermission !== 'granted' || notificationDelivery === undefined ? (
          <Pressable
            testID="settings.notifications.permission"
            accessibilityRole="button"
            accessibilityState={{ disabled: saving }}
            disabled={saving}
            onPress={() => {
              if (notificationPermission === 'granted') onOpenSystemSettings();
              else void save(async () => { await requestNotifications(); });
            }}
            style={({ pressed }) => [styles.permissionAction, {
              backgroundColor: pressed ? theme.primarySoft : theme.surface,
              borderRadius: theme.presentation.controlRadius,
              opacity: saving ? 0.55 : 1,
            }]}
          >
            <Text style={[styles.actionLabel, { color: theme.primary }]}>
              {t(notificationPermission === 'requestable' ? 'settings.allowNotifications' : 'schedule.openSettings')}
            </Text>
            <MaterialCommunityIcons accessible={false} name="chevron-right" size={21} color={theme.primary}
              accessibilityElementsHidden importantForAccessibility="no" />
          </Pressable>
        ) : null}
        {needsExactAlarmAccess ? <>
          <View style={[styles.divider, { backgroundColor: theme.border }]} />
          {exactAccessAction()}
        </> : null}
      </View>
      {onQuietStatusChange ? <View style={cardStyle}>
        <View style={styles.row}>
          <MaterialCommunityIcons accessible={false} name="bell-sleep-outline" size={24} color={theme.primary}
            accessibilityElementsHidden importantForAccessibility="no" />
          <View style={styles.copy}>
            <Text style={[styles.label, { color: theme.text }]}>{t('notifications.statusSwitch')}</Text>
            <Text style={[styles.detail, { color: theme.textMuted }]}>{t('notifications.statusDetail')}</Text>
          </View>
          <Switch testID="notifications.quietStatus" accessibilityLabel={t('notifications.statusSwitch')}
            accessibilityHint={t('notifications.statusDetail')} disabled={saving} hitSlop={8}
            ios_backgroundColor={theme.border} thumbColor={theme.surfaceRaised}
            trackColor={{ false: theme.border, true: theme.primary }}
            value={quietStatusEnabled && notificationDelivery !== false && notificationPermission === 'granted'}
            onValueChange={enabled => void save(async () => {
              if (enabled && (notificationPermission !== 'granted' || notificationDelivery === false) && !await requestNotifications(onRequestQuietStatusPermission)) return;
              await onQuietStatusChange(enabled);
            })} />
        </View>
        <Text style={[styles.detail, { color: theme.textMuted }]}>{t(Platform.OS === 'ios' ? 'notifications.statusIos' : 'notifications.statusAndroid')}</Text>
      </View> : null}
      <Text accessibilityRole="header" style={[styles.label,{color:theme.text}]}>{t('notifications.petReminders')}</Text>
      {onOpenPet?<PuppyIdentity showName theme={theme} onPress={onOpenPet}/>:null}
      <View style={cardStyle}>
        <Pressable
          testID="settings.notifications.routines"
          accessibilityRole="button"
          accessibilityLabel={`${t('settings.routineReminders')}. ${t('settings.routineRemindersDetail', { count: routineReminderCount })}`}
          onPress={onOpenSchedule}
          style={({ pressed }) => [styles.row, {
            backgroundColor: pressed ? theme.primarySoft : undefined,
            borderRadius: theme.presentation.controlRadius,
          }]}
        >
          <MaterialCommunityIcons accessible={false} name="calendar-clock-outline" size={24} color={theme.primary}
            accessibilityElementsHidden importantForAccessibility="no" />
          <View style={styles.copy}>
            <Text style={[styles.label, { color: theme.text }]}>{t('settings.routineReminders')}</Text>
            <Text style={[styles.detail, { color: theme.textMuted }]}>
              {t('settings.routineRemindersDetail', { count: routineReminderCount })}
            </Text>
          </View>
          <MaterialCommunityIcons accessible={false} name="chevron-right" size={23} color={theme.textMuted}
            accessibilityElementsHidden importantForAccessibility="no" />
        </Pressable>
        <View style={[styles.divider, { backgroundColor: theme.border }]} />
        <View style={styles.leadBlock}>
          <Text style={[styles.detail, { color: theme.textMuted }]}>{t('notifications.remindMe')}</Text>
          <View style={styles.choices} accessibilityRole="radiogroup">
            {reminderLeadOptions.map((lead) => {
              const selected = notificationPreferences.reminderLeadMinutes === lead;
              const label = lead === 0 ? t('settings.atTime') : t('settings.minutesBefore', { count: lead });
              return (
                <Pressable
                  key={lead}
                  testID={`settings.notifications.lead.${lead}`}
                  accessibilityRole="radio"
                  accessibilityLabel={label}
                  accessibilityState={{ checked: selected, disabled: saving }}
                  disabled={saving}
                  onPress={() => void save(() => onNotificationPreferencesChange({
                    ...notificationPreferences,
                    reminderLeadMinutes: lead,
                  }))}
                  style={({ pressed }) => [styles.choice, {
                    backgroundColor: selected || pressed ? theme.primarySoft : theme.surface,
                    borderColor: selected ? theme.primary : theme.border,
                    borderRadius: theme.presentation.controlRadius,
                    opacity: saving ? 0.55 : 1,
                  }]}
                >
                  {selected ? <MaterialCommunityIcons accessible={false} name="check" size={16} color={theme.primary}
                    accessibilityElementsHidden importantForAccessibility="no" /> : null}
                  <Text style={[styles.choiceLabel, { color: selected ? theme.primary : theme.text }]}>{label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>
      {onScheduleChange?<View style={cardStyle}>
        <Text accessibilityRole="header" style={[styles.label,{color:theme.text}]}>{t('notifications.timing')}</Text>
        <NotificationTimingControls theme={theme} preferences={notificationPreferences} schedule={schedule} disabled={saving}
          onChange={next=>save(()=>onNotificationPreferencesChange(next))} onScheduleChange={next=>save(()=>onScheduleChange(next))}/>
      </View>:null}

      <View style={cardStyle}>
        <Pressable testID="notifications.timed.add" accessibilityRole="button" accessibilityState={{ disabled: saving || !petId }}
          disabled={saving || !petId} onPress={addTimed}
          style={({ pressed }) => [styles.row, { backgroundColor: pressed ? theme.primarySoft : undefined, borderRadius: theme.presentation.controlRadius, opacity: saving || !petId ? 0.55 : 1 }]}>
          <MaterialCommunityIcons accessible={false} name="plus" size={24} color={theme.primary} accessibilityElementsHidden importantForAccessibility="no" />
          <Text style={[styles.actionLabel, { color: theme.primary }]}>{t('notifications.addTimed')}</Text>
        </Pressable>
        {timedLoading ? <View style={styles.loadingRow}><ActivityIndicator color={theme.primary} /><Text style={[styles.detail, { color: theme.textMuted }]}>{t('notifications.timedLoading')}</Text></View> : null}
        {timedLoadFailed ? <View style={styles.loadError}>
          <Text accessibilityRole="alert" style={[styles.detail, { color: theme.danger }]}>{t('notifications.timedLoadError')}</Text>
          <Pressable testID="notifications.timed.retry" accessibilityRole="button" onPress={() => { void reloadTimed(); }} style={styles.retryButton}>
            <Text style={[styles.actionLabel, { color: theme.primary }]}>{t('notifications.timedRetry')}</Text>
          </Pressable>
        </View> : null}
        {timed.map((reminder) => <View key={reminder.id} testID={`notifications.timed.item.${reminder.id}`} style={[styles.timedRow, { borderTopColor: theme.border }]}>
          <View style={styles.copy}>
            <Text style={[styles.label, { color: theme.text }]}>{reminder.label}</Text>
            <Text testID={`notifications.timed.at.${reminder.id}`} style={[styles.detail, { color: theme.textMuted }]}>{new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(reminder.at)}</Text>
          </View>
          <Pressable testID={`notifications.timed.remove.${reminder.id}`} accessibilityRole="button" accessibilityLabel={t('notifications.timedRemove', { label: reminder.label })}
            disabled={saving} accessibilityState={{ disabled: saving }} onPress={() => removeTimed(reminder)}
            style={({ pressed }) => [styles.removeButton, { backgroundColor: pressed ? theme.dangerSoft : undefined, opacity: saving ? 0.55 : 1, borderRadius: theme.presentation.controlRadius }]}>
            <MaterialCommunityIcons accessible={false} name="close" size={22} color={theme.textMuted} accessibilityElementsHidden importantForAccessibility="no" />
          </Pressable>
        </View>)}
      </View>

    </ScrollView>
    <Modal visible={draft !== null} presentationStyle="pageSheet" animationType="none" onRequestClose={() => { if (!saving) setDraft(null); }}>
      <View testID="notifications.timed.editor" style={[styles.editorRoot, { backgroundColor: theme.background }]}>
        <ScrollView automaticallyAdjustKeyboardInsets keyboardShouldPersistTaps="handled" contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.editorContent}>
          <View style={styles.editorHeading}>
            <Text style={[styles.editorTitle, { color: theme.text, fontFamily: theme.presentation.headingFont }]}>{t('notifications.timedPrompt')}</Text>
            <Pressable testID="notifications.timed.close" accessibilityRole="button" accessibilityLabel={t('app.cancel')}
              disabled={saving} onPress={() => setDraft(null)} style={styles.removeButton}>
              <MaterialCommunityIcons accessible={false} name="close" size={24} color={theme.text} accessibilityElementsHidden importantForAccessibility="no" />
            </Pressable>
          </View>
          <TextInput testID="notifications.timed.label" accessibilityLabel={t('notifications.timedPrompt')} maxLength={80}
            value={draft?.label ?? ''} editable={!saving} onChangeText={(label) => setDraft((current) => current ? { ...current, label } : null)}
            returnKeyType="done" style={[styles.labelInput, { color: theme.text, backgroundColor: theme.surfaceRaised, borderColor: theme.border, borderRadius: theme.presentation.controlRadius }]} />
          {draft ? <View style={[styles.pickerCard, { backgroundColor: theme.surfaceRaised, borderRadius: theme.presentation.cardRadius }]}>
            <Text style={[styles.label, { color: theme.text }]}>{t('notifications.timedWhen')}</Text>
            {(Platform.OS==='android'?['date','time'] as const:['datetime'] as const).map(mode=><DateTimePicker key={mode}
              testID={mode==='datetime'?'notifications.timed.when':`notifications.timed.${mode}`} value={draft.at} mode={mode}
              display={Platform.OS==='android'?'default':'compact'} presentation="inline" minimumDate={mode==='time'?undefined:new Date()}
              locale={language} themeVariant={theme.isDark ? 'dark' : 'light'} accentColor={theme.primary} disabled={saving}
              onValueChange={(_event, at) => {if(!saving)setDraft(current => current&&current.at.getTime()!==at.getTime()?{...current,at}:current);}} style={styles.nativePicker} />)}
          </View> : null}
          <Text style={[styles.detail, { color: theme.textMuted }]}>{t('notifications.timedDeviceOnly')}</Text>
          {needsExactAlarmAccess && exactAccess !== true ? exactAccessAction(true) : null}
          {draftError ? <Text testID="notifications.timed.error" accessibilityRole="alert" style={[styles.detail, { color: theme.danger }]}>{draftError}</Text> : null}
          <Pressable testID="notifications.timed.save" accessibilityRole="button" accessibilityState={{ disabled: saving || !draft?.label.trim(), busy: saving }}
            disabled={saving || !draft?.label.trim()} onPress={saveTimed}
            style={({ pressed }) => [styles.saveButton, { backgroundColor: pressed ? theme.primaryPressed : theme.primary, opacity: saving || !draft?.label.trim() ? 0.55 : 1, borderRadius: theme.presentation.controlRadius }]}>
            <Text style={[styles.actionLabel, { color: theme.onPrimary }]}>{t(saving ? 'common.saving' : 'notifications.timedSave')}</Text>
          </Pressable>
        </ScrollView>
      </View>
    </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  content: { width: '100%', maxWidth: 720, alignSelf: 'center', paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.xl, gap: spacing.md },
  card: { borderWidth: 1, padding: 12 },
  loadingRow: { padding: 8, gap: 12, flexDirection: 'row', alignItems: 'center' },
  loadError: { paddingHorizontal: 8 },
  retryButton: { minHeight: 48, paddingVertical: 12, alignSelf: 'flex-start' },
  timedRow: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: 4, paddingTop: 12, paddingBottom: 8, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 12 },
  removeButton: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  editorRoot: { flex: 1 },
  editorContent: { padding: 24, gap: 20 },
  editorHeading: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  editorTitle: { flex: 1, fontSize: 26, lineHeight: 34, fontWeight: '700' },
  labelInput: { fontSize: 20, lineHeight: 28, minHeight: 60, paddingHorizontal: 16, paddingVertical: 14, borderWidth: 1 },
  pickerCard: { padding: 16, gap: 12 },
  nativePicker: { minHeight: 48 },
  saveButton: { minHeight: 56, paddingHorizontal: 16, paddingVertical: 16, alignItems: 'center', justifyContent: 'center' },
  row: { minHeight: 64, paddingHorizontal: 8, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 12 },
  copy: { flex: 1, minWidth: 0 },
  label: { fontSize: 17, lineHeight: 23, fontWeight: '700' },
  detail: { fontSize: 14, lineHeight: 20, marginTop: 2 },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: 8, marginVertical: 4 },
  permissionAction: { minHeight: 48, marginTop: 4, paddingHorizontal: 12, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  actionLabel: { fontSize: 15, lineHeight: 21, fontWeight: '700', flexShrink: 1 },
  leadBlock: { paddingHorizontal: 8, paddingTop: 4, paddingBottom: 8 },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 4, paddingBottom: 4, marginTop: 8 },
  choice: { minWidth: 64, minHeight: 48, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  choiceLabel: { fontSize: 14, lineHeight: 20, fontWeight: '700', flexShrink: 1 },
});

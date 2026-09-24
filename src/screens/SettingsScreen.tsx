import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { EVENT_META, quickEventTypes, type QuickEventType } from '../domain';
import { useLocalization } from '../localization-context';
import type { LanguagePreference } from '../localization';
import {
  pottyReminderDelayOptions,
  reminderLeadOptions,
  type NotificationPreferences,
  type PottyReminderDelayMinutes,
  type PottyReminderPreference,
  type ReminderLeadMinutes,
} from '../notification-config';
import type { NotificationPermissionState } from '../reminders';
import {
  eventIcon,
  spacing,
  surfaceTreatment,
  type Theme,
  type ThemePreference,
} from '../theme';

const themeLabels: Record<Exclude<ThemePreference, 'system'>, string> = {
  meadow: 'Meadow',
  sunrise: 'Sunrise',
  midnight: 'Midnight',
  paper: 'Paper',
  bubblegum: 'Bubblegum',
  blueprint: 'Blueprint',
  trail: 'Trail',
  tide: 'Tide',
  plum: 'Plum',
  contrast: 'Contrast',
};

const languageLabels: Record<Exclude<LanguagePreference, 'system'>, string> = {
  en: 'English',
  'zh-Hans': '简体中文',
  es: 'Español',
};

export function SettingsScreen({
  theme,
  themePreference,
  languagePreference,
  widgetActions,
  notificationPreferences,
  notificationPermission,
  routineReminderCount,
  onBack,
  onOpenPicker,
  onWidgetActionsChange,
  onNotificationPreferencesChange,
  onRequestNotificationPermission,
  onOpenSystemSettings,
  onOpenSchedule,
  onOpenGuide,
}: {
  theme: Theme;
  themePreference: ThemePreference;
  languagePreference: LanguagePreference;
  widgetActions: QuickEventType[];
  notificationPreferences: NotificationPreferences;
  notificationPermission: NotificationPermissionState;
  routineReminderCount: number;
  onBack: () => void;
  onOpenPicker: (mode: 'theme' | 'language') => void;
  onWidgetActionsChange: (actions: QuickEventType[]) => Promise<void>;
  onNotificationPreferencesChange: (preferences: NotificationPreferences) => Promise<void>;
  onRequestNotificationPermission: () => Promise<boolean>;
  onOpenSystemSettings: () => void;
  onOpenSchedule: () => void;
  onOpenGuide: () => void;
}) {
  const { eventLabel, t } = useLocalization();
  const [savingWidget, setSavingWidget] = useState(false);
  const [savingNotifications, setSavingNotifications] = useState(false);

  const themeLabel = themePreference === 'system' ? t('language.system') : themeLabels[themePreference];
  const languageLabel = languagePreference === 'system' ? t('language.system') : languageLabels[languagePreference];
  const permissionDetail = t(
    notificationPermission === 'granted'
      ? 'settings.permissionGranted'
      : notificationPermission === 'blocked'
        ? 'settings.permissionBlocked'
        : 'settings.permissionRequestable',
  );

  const showSaveError = () => Alert.alert(t('settings.saveErrorTitle'), t('settings.saveErrorBody'));

  const changeWidgetAction = async (type: QuickEventType) => {
    if (savingWidget) return;
    const selected = widgetActions.includes(type);
    if ((selected && widgetActions.length === 2) || (!selected && widgetActions.length === 4)) return;
    const next = selected ? widgetActions.filter((item) => item !== type) : [...widgetActions, type];
    setSavingWidget(true);
    try {
      await onWidgetActionsChange(next);
    } catch {
      showSaveError();
    } finally {
      setSavingWidget(false);
    }
  };

  const saveNotifications = async (next: NotificationPreferences) => {
    if (savingNotifications) return;
    setSavingNotifications(true);
    try {
      await onNotificationPreferencesChange(next);
    } catch {
      showSaveError();
    } finally {
      setSavingNotifications(false);
    }
  };

  const requestNotifications = async (): Promise<boolean> => {
    if (notificationPermission === 'blocked') {
      onOpenSystemSettings();
      return false;
    }
    try {
      const granted = await onRequestNotificationPermission();
      if (granted) return true;
    } catch {
      // The same recovery path applies to a denied prompt and a native request failure.
    }
    Alert.alert(t('schedule.notificationsOff'), t('schedule.notificationsBody'), [
      { text: t('schedule.notNow'), style: 'cancel' },
      { text: t('schedule.openSettings'), onPress: onOpenSystemSettings },
    ]);
    return false;
  };

  const toggleWidgetConfirmations = async (enabled: boolean) => {
    if (enabled && notificationPermission !== 'granted' && !(await requestNotifications())) return;
    await saveNotifications({ ...notificationPreferences, widgetConfirmations: enabled });
  };

  const togglePottyReminder = async (
    key: 'pottyAfterPee' | 'pottyAfterMeal',
    enabled: boolean,
  ) => {
    if (enabled && notificationPermission !== 'granted' && !(await requestNotifications())) return;
    await saveNotifications({
      ...notificationPreferences,
      [key]: { ...notificationPreferences[key], enabled },
    });
  };

  const choosePottyDelay = (
    key: 'pottyAfterPee' | 'pottyAfterMeal',
    delayMinutes: PottyReminderDelayMinutes,
  ) => {
    void saveNotifications({
      ...notificationPreferences,
      [key]: { ...notificationPreferences[key], delayMinutes },
    });
  };

  const chooseLeadTime = (lead: ReminderLeadMinutes) => {
    void saveNotifications({ ...notificationPreferences, reminderLeadMinutes: lead });
  };

  return (
    <ScrollView testID="screen.settings" contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Pressable
          testID="settings.back"
          accessibilityRole="button"
          accessibilityLabel={t('settings.back')}
          onPress={onBack}
          style={({ pressed }) => [
            styles.backButton,
            {
              backgroundColor: pressed ? theme.primarySoft : theme.surfaceRaised,
              borderColor: theme.border,
              borderRadius: theme.presentation.controlRadius,
              borderWidth: theme.presentation.borderWidth,
            },
          ]}
        >
          <MaterialCommunityIcons
            accessibilityElementsHidden
            importantForAccessibility="no"
            name="arrow-left"
            size={22}
            color={theme.primary}
          />
        </Pressable>
        <View style={[styles.headerIcon, { backgroundColor: theme.primary, borderRadius: theme.presentation.iconRadius }]}>
          <MaterialCommunityIcons
            accessibilityElementsHidden
            importantForAccessibility="no"
            name="cog-outline"
            size={23}
            color={theme.onPrimary}
          />
        </View>
        <Text
          adjustsFontSizeToFit
          minimumFontScale={0.85}
          numberOfLines={1}
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
          {t('settings.title')}
        </Text>
      </View>

      <SectionLabel label={t('settings.personalization')} theme={theme} />
      <View style={[styles.card, surfaceTreatment(theme), { backgroundColor: theme.surfaceRaised, borderColor: theme.border }]}>
        <SettingsRow
          testID="settings.theme.open"
          icon="palette-outline"
          label={t('settings.theme')}
          detail={themeLabel}
          hint={t('settings.themeDetail')}
          onPress={() => onOpenPicker('theme')}
          theme={theme}
        />
        <View style={[styles.divider, { backgroundColor: theme.border }]} />
        <SettingsRow
          testID="settings.language.open"
          icon="translate"
          label={t('settings.language')}
          detail={languageLabel}
          onPress={() => onOpenPicker('language')}
          theme={theme}
        />
        <View style={[styles.divider, { backgroundColor: theme.border }]} />
        <SettingsRow
          testID="settings.guide.open"
          icon="compass-outline"
          label={t('settings.guide')}
          detail={t('settings.guideDetail')}
          onPress={onOpenGuide}
          theme={theme}
        />
      </View>

      <SectionLabel label={t('settings.widget')} theme={theme} />
      <View style={[styles.card, surfaceTreatment(theme), { backgroundColor: theme.surfaceRaised, borderColor: theme.border }]}>
        <Text
          adjustsFontSizeToFit
          minimumFontScale={0.85}
          numberOfLines={1}
          style={[styles.cardDetail, { color: theme.textMuted }]}
        >
          {t('settings.widgetDetail')}
        </Text>
        <View style={styles.widgetGrid}>
          {quickEventTypes.map((type) => {
            const selected = widgetActions.includes(type);
            const locked = (selected && widgetActions.length === 2) || (!selected && widgetActions.length === 4);
            const meta = EVENT_META[type];
            const color = theme.isDark ? meta.darkColor : meta.color;
            const softColor = theme.isDark ? meta.darkSoftColor : meta.softColor;
            const label = eventLabel(type);
            return (
              <Pressable
                key={type}
                testID={`settings.widget.action.${type}`}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: selected, disabled: locked || savingWidget }}
                accessibilityLabel={t(selected ? 'widget.removeAction' : 'widget.addAction', { activity: label })}
                accessibilityHint={locked ? t(selected ? 'widget.keepTwo' : 'widget.removeFirst') : undefined}
                disabled={locked || savingWidget}
                onPress={() => void changeWidgetAction(type)}
                style={({ pressed }) => [
                  styles.widgetAction,
                  {
                    backgroundColor: selected ? softColor : theme.surface,
                    borderColor: selected || pressed ? color : theme.border,
                    borderRadius: theme.presentation.controlRadius,
                    borderWidth: theme.presentation.borderWidth,
                    opacity: locked ? 0.55 : 1,
                  },
                ]}
              >
                <MaterialCommunityIcons
                  accessibilityElementsHidden
                  importantForAccessibility="no"
                  name={eventIcon(theme, type) as keyof typeof MaterialCommunityIcons.glyphMap}
                  size={20}
                  color={color}
                />
                <Text numberOfLines={1} style={[styles.widgetActionText, { color: theme.text }]}>{label}</Text>
                <MaterialCommunityIcons
                  accessibilityElementsHidden
                  importantForAccessibility="no"
                  name={selected ? 'check-circle' : 'circle-outline'}
                  size={20}
                  color={selected ? color : theme.textMuted}
                />
              </Pressable>
            );
          })}
        </View>
        {!widgetActions.includes('nap') ? (
          <Text
            adjustsFontSizeToFit
            minimumFontScale={0.85}
            numberOfLines={1}
            style={[styles.widgetHint, { color: theme.textMuted }]}
          >
            {t('widget.napHint')}
          </Text>
        ) : null}
      </View>

      <SectionLabel label={t('settings.notifications')} theme={theme} />
      <View style={[styles.card, surfaceTreatment(theme), { backgroundColor: theme.surfaceRaised, borderColor: theme.border }]}>
        <Pressable
          testID="settings.notifications.permission"
          accessibilityRole="button"
          accessibilityLabel={`${t('settings.notificationPermission')}. ${permissionDetail}`}
          onPress={() => {
            if (notificationPermission === 'requestable') void requestNotifications();
            else onOpenSystemSettings();
          }}
          style={({ pressed }) => [styles.permissionRow, pressed && { backgroundColor: theme.primarySoft }]}
        >
          <View style={[styles.rowIcon, { backgroundColor: theme.primarySoft, borderRadius: theme.presentation.iconRadius }]}>
            <MaterialCommunityIcons
              accessibilityElementsHidden
              importantForAccessibility="no"
              name={notificationPermission === 'granted' ? 'bell-check-outline' : 'bell-outline'}
              size={21}
              color={theme.primary}
            />
          </View>
          <View style={styles.rowCopy}>
            <Text style={[styles.rowLabel, { color: theme.text }]}>{t('settings.notificationPermission')}</Text>
            <Text style={[styles.rowHint, { color: theme.textMuted }]}>{permissionDetail}</Text>
            {notificationPermission !== 'granted' ? (
              <Text style={[styles.permissionAction, { color: theme.primary }]}>
                {t(notificationPermission === 'blocked' ? 'schedule.openSettings' : 'settings.allowNotifications')}
              </Text>
            ) : null}
          </View>
          {notificationPermission === 'granted' ? (
            <MaterialCommunityIcons
              accessibilityElementsHidden
              importantForAccessibility="no"
              name="check-circle"
              size={22}
              color={theme.primary}
            />
          ) : null}
        </Pressable>

        <View style={[styles.divider, { backgroundColor: theme.border }]} />
        <View style={styles.pottyBlock}>
          <View style={styles.pottyHeader}>
            <View style={[styles.rowIcon, { backgroundColor: theme.primarySoft, borderRadius: theme.presentation.iconRadius }]}>
              <MaterialCommunityIcons
                accessibilityElementsHidden
                importantForAccessibility="no"
                name="timer-outline"
                size={21}
                color={theme.primary}
              />
            </View>
            <View style={styles.rowCopy}>
              <Text style={[styles.rowLabel, { color: theme.text }]}>{t('settings.pottyNudges')}</Text>
              <Text style={[styles.rowHint, { color: theme.textMuted }]}>{t('settings.pottyNudgesDetail')}</Text>
            </View>
          </View>
          <PottyReminderRule
            testID="settings.notifications.pottyAfterPee"
            label={t('settings.afterPeeReminder')}
            detail={t('settings.afterPeeReminderDetail')}
            rule={notificationPreferences.pottyAfterPee}
            disabled={savingNotifications}
            onToggle={(enabled) => void togglePottyReminder('pottyAfterPee', enabled)}
            onDelayChange={(delay) => choosePottyDelay('pottyAfterPee', delay)}
            theme={theme}
          />
          <PottyReminderRule
            testID="settings.notifications.pottyAfterMeal"
            label={t('settings.afterMealReminder')}
            detail={t('settings.afterMealReminderDetail')}
            rule={notificationPreferences.pottyAfterMeal}
            disabled={savingNotifications}
            onToggle={(enabled) => void togglePottyReminder('pottyAfterMeal', enabled)}
            onDelayChange={(delay) => choosePottyDelay('pottyAfterMeal', delay)}
            theme={theme}
          />
        </View>

        <View style={[styles.divider, { backgroundColor: theme.border }]} />
        <View style={styles.toggleRow}>
          <View style={[styles.rowIcon, { backgroundColor: theme.primarySoft, borderRadius: theme.presentation.iconRadius }]}>
            <MaterialCommunityIcons
              accessibilityElementsHidden
              importantForAccessibility="no"
              name="widgets-outline"
              size={21}
              color={theme.primary}
            />
          </View>
          <View style={styles.rowCopy}>
            <Text style={[styles.rowLabel, { color: theme.text }]}>{t('settings.widgetConfirmations')}</Text>
            <Text style={[styles.rowHint, { color: theme.textMuted }]}>{t('settings.widgetConfirmationsDetail')}</Text>
          </View>
          <Switch
            testID="settings.notifications.widgetConfirmations"
            accessibilityLabel={t('settings.widgetConfirmations')}
            disabled={savingNotifications}
            ios_backgroundColor={theme.border}
            onValueChange={(enabled) => void toggleWidgetConfirmations(enabled)}
            thumbColor={theme.surfaceRaised}
            trackColor={{ false: theme.border, true: theme.primary }}
            value={notificationPreferences.widgetConfirmations}
          />
        </View>

        <View style={[styles.divider, { backgroundColor: theme.border }]} />
        <Pressable
          testID="settings.notifications.routines"
          accessibilityRole="button"
          accessibilityLabel={`${t('settings.routineReminders')}. ${t('settings.routineRemindersDetail', { count: routineReminderCount })}`}
          accessibilityHint={t('settings.manageSchedule')}
          onPress={onOpenSchedule}
          style={({ pressed }) => [styles.permissionRow, pressed && { backgroundColor: theme.primarySoft }]}
        >
          <View style={[styles.rowIcon, { backgroundColor: theme.primarySoft, borderRadius: theme.presentation.iconRadius }]}>
            <MaterialCommunityIcons
              accessibilityElementsHidden
              importantForAccessibility="no"
              name="calendar-clock-outline"
              size={21}
              color={theme.primary}
            />
          </View>
          <View style={styles.rowCopy}>
            <Text style={[styles.rowLabel, { color: theme.text }]}>{t('settings.routineReminders')}</Text>
            <Text style={[styles.rowHint, { color: theme.textMuted }]}>
              {t('settings.routineRemindersDetail', { count: routineReminderCount })}
            </Text>
          </View>
          <MaterialCommunityIcons
            accessibilityElementsHidden
            importantForAccessibility="no"
            name="chevron-right"
            size={23}
            color={theme.textMuted}
          />
        </Pressable>

        <View style={[styles.timingBlock, { borderColor: theme.border, backgroundColor: theme.surface }]}>
          <Text style={[styles.rowLabel, { color: theme.text }]}>{t('settings.reminderTiming')}</Text>
          <Text style={[styles.rowHint, { color: theme.textMuted }]}>{t('settings.reminderTimingDetail')}</Text>
          <View style={styles.timingChoices}>
            {reminderLeadOptions.map((lead) => {
              const selected = notificationPreferences.reminderLeadMinutes === lead;
              const label = lead === 0 ? t('settings.atTime') : t('settings.minutesBefore', { count: lead });
              return (
                <Pressable
                  key={lead}
                  testID={`settings.notifications.lead.${lead}`}
                  accessibilityRole="radio"
                  accessibilityLabel={label}
                  accessibilityState={{ checked: selected, disabled: savingNotifications }}
                  disabled={savingNotifications}
                  onPress={() => chooseLeadTime(lead)}
                  style={({ pressed }) => [
                    styles.timingChoice,
                    {
                      backgroundColor: selected || pressed ? theme.primarySoft : theme.surfaceRaised,
                      borderColor: selected ? theme.primary : theme.border,
                      borderRadius: theme.presentation.controlRadius,
                      borderWidth: theme.presentation.borderWidth,
                    },
                  ]}
                >
                  <Text maxFontSizeMultiplier={1.5} numberOfLines={1} style={[styles.timingChoiceText, { color: selected ? theme.primary : theme.text }]}>{label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>
    </ScrollView>
  );
}

function SectionLabel({ label, theme }: { label: string; theme: Theme }) {
  return (
    <Text numberOfLines={1} style={[styles.sectionLabel, { color: theme.primary, letterSpacing: theme.presentation.eyebrowTracking }]}>
      {label}
    </Text>
  );
}

function SettingsRow({
  testID,
  icon,
  label,
  detail,
  hint,
  onPress,
  theme,
}: {
  testID: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  label: string;
  detail: string;
  hint?: string;
  onPress: () => void;
  theme: Theme;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`${label}. ${detail}`}
      accessibilityHint={hint}
      onPress={onPress}
      style={({ pressed }) => [styles.settingsRow, pressed && { backgroundColor: theme.primarySoft }]}
    >
      <View style={[styles.rowIcon, { backgroundColor: theme.primarySoft, borderRadius: theme.presentation.iconRadius }]}>
        <MaterialCommunityIcons
          accessibilityElementsHidden
          importantForAccessibility="no"
          name={icon}
          size={21}
          color={theme.primary}
        />
      </View>
      <View style={styles.rowCopy}>
        <Text numberOfLines={1} style={[styles.rowLabel, { color: theme.text }]}>{label}</Text>
        <Text adjustsFontSizeToFit minimumFontScale={0.85} numberOfLines={1} style={[styles.rowHint, { color: theme.textMuted }]}>{detail}</Text>
      </View>
      <MaterialCommunityIcons
        accessibilityElementsHidden
        importantForAccessibility="no"
        name="chevron-right"
        size={23}
        color={theme.textMuted}
      />
    </Pressable>
  );
}

function PottyReminderRule({
  testID,
  label,
  detail,
  rule,
  disabled,
  onToggle,
  onDelayChange,
  theme,
}: {
  testID: string;
  label: string;
  detail: string;
  rule: PottyReminderPreference;
  disabled: boolean;
  onToggle: (enabled: boolean) => void;
  onDelayChange: (delay: PottyReminderDelayMinutes) => void;
  theme: Theme;
}) {
  const { t } = useLocalization();
  return (
    <View style={[styles.pottyRule, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <View style={styles.pottyRuleRow}>
        <View style={styles.rowCopy}>
          <Text style={[styles.pottyRuleLabel, { color: theme.text }]}>{label}</Text>
          <Text style={[styles.rowHint, { color: theme.textMuted }]}>{detail}</Text>
        </View>
        <Switch
          testID={`${testID}.enabled`}
          accessibilityLabel={label}
          accessibilityHint={detail}
          disabled={disabled}
          hitSlop={8}
          ios_backgroundColor={theme.border}
          onValueChange={onToggle}
          thumbColor={theme.surfaceRaised}
          trackColor={{ false: theme.border, true: theme.primary }}
          value={rule.enabled}
        />
      </View>
      {rule.enabled ? (
        <View style={styles.pottyTimingChoices} accessibilityRole="radiogroup">
          {pottyReminderDelayOptions.map((delay) => {
            const selected = delay === rule.delayMinutes;
            const labelText = delay < 60
              ? t('time.minutes', { count: delay })
              : t('time.hours', { count: delay / 60 });
            return (
              <Pressable
                key={delay}
                testID={`${testID}.delay.${delay}`}
                accessibilityRole="radio"
                accessibilityLabel={`${label}, ${labelText}`}
                accessibilityState={{ checked: selected, disabled }}
                disabled={disabled}
                onPress={() => onDelayChange(delay)}
                style={({ pressed }) => [
                  styles.pottyTimingChoice,
                  {
                    backgroundColor: selected || pressed ? theme.primarySoft : theme.surfaceRaised,
                    borderColor: selected ? theme.primary : theme.border,
                    borderRadius: theme.presentation.controlRadius,
                    borderWidth: theme.presentation.borderWidth,
                    opacity: disabled ? 0.55 : 1,
                  },
                ]}
              >
                {selected ? (
                  <MaterialCommunityIcons
                    accessibilityElementsHidden
                    importantForAccessibility="no"
                    name="check"
                    size={14}
                    color={theme.primary}
                  />
                ) : null}
                <Text maxFontSizeMultiplier={1.5} style={[styles.timingChoiceText, { color: selected ? theme.primary : theme.text }]}>
                  {labelText}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
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
  header: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: spacing.lg },
  backButton: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  headerIcon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, fontSize: 27, lineHeight: 33, fontWeight: '800' },
  sectionLabel: { fontSize: 11, lineHeight: 15, fontWeight: '800', marginTop: spacing.md, marginBottom: 8 },
  card: { borderWidth: 1, borderRadius: 22, padding: 8, marginBottom: spacing.sm },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: 8 },
  settingsRow: { minHeight: 68, paddingHorizontal: 8, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 11 },
  permissionRow: { minHeight: 72, paddingHorizontal: 8, paddingVertical: 9, flexDirection: 'row', alignItems: 'center', gap: 11, borderRadius: 14 },
  toggleRow: { minHeight: 86, paddingHorizontal: 8, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 11 },
  rowIcon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  rowCopy: { flex: 1, minWidth: 0 },
  rowLabel: { fontSize: 16, lineHeight: 21, fontWeight: '800' },
  rowHint: { fontSize: 12, lineHeight: 17, marginTop: 2 },
  permissionAction: { fontSize: 12, lineHeight: 17, fontWeight: '800', marginTop: 5 },
  cardDetail: { fontSize: 13, lineHeight: 19, paddingHorizontal: 8, paddingTop: 6, paddingBottom: 10 },
  widgetGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  widgetAction: { flexBasis: '47%', flexGrow: 1, minWidth: 130, minHeight: 56, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 8 },
  widgetActionText: { flex: 1, minWidth: 0, fontSize: 14, lineHeight: 19, fontWeight: '700' },
  widgetHint: { fontSize: 12, lineHeight: 18, paddingHorizontal: 8, paddingTop: 10, paddingBottom: 4 },
  pottyBlock: { paddingHorizontal: 8, paddingVertical: 12, gap: 9 },
  pottyHeader: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 11, marginBottom: 2 },
  pottyRule: { borderWidth: 1, borderRadius: 17, padding: 12 },
  pottyRuleRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10 },
  pottyRuleLabel: { fontSize: 15, lineHeight: 20, fontWeight: '800' },
  pottyTimingChoices: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 10 },
  pottyTimingChoice: { minWidth: 56, minHeight: 48, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  timingBlock: { borderWidth: 1, borderRadius: 17, padding: 13, marginTop: 8 },
  timingChoices: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 12 },
  timingChoice: { minHeight: 44, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  timingChoiceText: { fontSize: 12, lineHeight: 17, fontWeight: '800' },
});

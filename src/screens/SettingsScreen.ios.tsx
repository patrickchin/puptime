import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { customActivityKey, quickEventTypes, type ActivityKey, type EventType } from '../domain';
import { ActivityIcon } from '../components/ActivityIcon';
import { SettingsRow } from '../components/SettingsRow';
import { PuppyNameSetting } from '../components/PuppyNameSetting';
import type { CloudHandle } from '../cloud/use-cloud';
import { useAccountSnapshot } from '../cloud/use-account-snapshot';
import { accountStatus } from '../cloud/account-status';
import { useLocalization } from '../localization-context';
import type { LanguagePreference } from '../localization';
import type { NotificationPreferences } from '../notification-config';
import type { NotificationPermissionState } from '../reminders';
import {
  spacing,
  surfaceTreatment,
  type Theme,
  type ThemePreference,
} from '../theme';

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
  customActivities,
  notificationPreferences,
  notificationPermission,
  onBack,
  onOpenPicker,
  onWidgetActionsChange,
  onNotificationPreferencesChange,
  onRequestNotificationPermission,
  onOpenSystemSettings,
  onOpenGuide,
  cloudHandle,
  onOpenAccount,
  onOpenHistory,
  showHeader=true,
}: {
  theme: Theme;
  themePreference: ThemePreference;
  languagePreference: LanguagePreference;
  widgetActions: ActivityKey[];
  customActivities: string[];
  notificationPreferences: NotificationPreferences;
  notificationPermission: NotificationPermissionState;
  onBack: () => void;
  onOpenPicker: (mode: 'theme' | 'language') => void;
  onWidgetActionsChange: (actions: ActivityKey[]) => Promise<void>;
  onNotificationPreferencesChange: (preferences: NotificationPreferences) => Promise<void>;
  onRequestNotificationPermission: () => Promise<boolean>;
  onOpenSystemSettings: () => void;
  onOpenGuide: () => void;
  cloudHandle?: CloudHandle;
  onOpenAccount?: () => void;
  onOpenHistory?: () => void;
  showHeader?:boolean;
}) {
  const { activityColors, activityLabel, t } = useLocalization();
  const [savingWidget, setSavingWidget] = useState(false);
  const [savingNotifications, setSavingNotifications] = useState(false);

  const themeLabel = t(`theme.${themePreference}.name`);
  const languageLabel = languagePreference === 'system' ? t('language.system') : languageLabels[languagePreference];

  const showSaveError = () => Alert.alert(t('settings.saveErrorTitle'), t('settings.saveErrorBody'));

  const changeWidgetAction = async (type: ActivityKey) => {
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
    try {
      const granted = await onRequestNotificationPermission();
      if (granted) return true;
    } catch {
      // The same recovery path applies to a denied prompt and a native request failure.
    }
    if (notificationPermission === 'blocked') {
      onOpenSystemSettings();
      return false;
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

  return (
    <ScrollView testID="screen.settings" contentContainerStyle={styles.content}>
      {showHeader?<View style={styles.header}>
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
              fontFamily: theme.presentation.headingFont,
              letterSpacing: theme.presentation.titleTracking,
            },
          ]}
        >
          {t('settings.title')}
        </Text>
      </View>:null}

      {cloudHandle?.available&&onOpenAccount?<AccountSettingsRow cloud={cloudHandle} theme={theme} onOpen={onOpenAccount}/>:null}
      <PuppyNameSetting theme={theme} cloud={cloudHandle}/>
      {onOpenHistory?<View style={[styles.card,surfaceTreatment(theme),{backgroundColor:theme.surfaceRaised,borderColor:theme.border}]}><SettingsRow testID="settings.history.open" icon="history" label={t('history.recentTitle')} detail={t('history.recentDetail')} onPress={onOpenHistory} theme={theme} wrap/></View>:null}
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
          {([...quickEventTypes, ...customActivities.map(customActivityKey)] as ActivityKey[]).map((type) => {
            const selected = widgetActions.includes(type);
            const locked = (selected && widgetActions.length === 2) || (!selected && widgetActions.length === 4);
            const activity = type.startsWith('custom:')
              ? { type: 'custom' as const, customLabel: customActivities.find((item) => customActivityKey(item) === type) ?? type.slice(7) }
              : { type: type as EventType };
            const { color, softColor } = activityColors(theme, activity);
            const label = activityLabel(activity);
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
                <ActivityIcon activity={activity} theme={theme} color={color} size={20} />
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

function AccountSettingsRow({cloud,theme,onOpen}:{cloud:CloudHandle;theme:Theme;onOpen:()=>void}) {
  const {t}=useLocalization(),state=useAccountSnapshot(cloud.controller);
  return <View style={[styles.card,surfaceTreatment(theme),{backgroundColor:theme.surfaceRaised,borderColor:theme.border}]}>
    <SettingsRow testID="settings.account.open" wrap icon="cloud-outline" label={t('account.title')} detail={t(`account.status.${accountStatus(state)}`)} onPress={onOpen} theme={theme}/>
  </View>;
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
  toggleRow: { minHeight: 86, paddingHorizontal: 8, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 11 },
  rowIcon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  rowCopy: { flex: 1, minWidth: 0 },
  rowLabel: { fontSize: 16, lineHeight: 21, fontWeight: '800' },
  rowHint: { fontSize: 12, lineHeight: 17, marginTop: 2 },
  cardDetail: { fontSize: 13, lineHeight: 19, paddingHorizontal: 8, paddingTop: 6, paddingBottom: 10 },
  widgetGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  widgetAction: { flexBasis: '47%', flexGrow: 1, minWidth: 130, minHeight: 56, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 8 },
  widgetActionText: { flex: 1, minWidth: 0, fontSize: 14, lineHeight: 19, fontWeight: '700' },
  widgetHint: { fontSize: 12, lineHeight: 18, paddingHorizontal: 8, paddingTop: 10, paddingBottom: 4 },
});

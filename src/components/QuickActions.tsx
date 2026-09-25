import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { Alert, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { activityColors, activityEmojis, type ActivityCustomization } from '../activity-customization';
import {
  activityKey,
  customActivityKey,
  isOpenNap,
  quickEventTypes,
  type EventType,
  type Activity,
  type PuppyEvent,
} from '../domain';
import { ActivityIcon } from './ActivityIcon';
import { useLocalization } from '../localization-context';
import { localizedEventLabel } from '../localization';
import { eventColors, eventIcon, spacing, supportingIcon, surfaceTreatment, type Theme } from '../theme';

type Props = {
  events: PuppyEvent[];
  customActivities: string[];
  onLog: (type: EventType, customLabel?: string) => Promise<void>;
  onChangeAppearance: (activity: Activity, customization: ActivityCustomization) => Promise<void>;
  onDeleteCustomActivity: (label: string) => Promise<void>;
  now: number;
  theme: Theme;
};

type Editor = { activity: Activity; isNew: boolean; name: string; emoji?: string; color?: number };

export function QuickActions({ events, customActivities, onLog, onChangeAppearance, onDeleteCustomActivity, now, theme }: Props) {
  const { activityAppearance, activityColors: colorsFor, activityLabel, elapsedTime, language, relativeTime, t } = useLocalization();
  const [showMore, setShowMore] = useState(false);
  const [customLabel, setCustomLabel] = useState('');
  const [editor, setEditor] = useState<Editor | null>(null);
  const [saving, setSaving] = useState(false);
  const openNap = events.find(isOpenNap);
  const suggestions = useMemo(() => [
    t('quick.water'),
    t('quick.accident'),
    t('quick.play'),
    t('quick.training'),
    t('quick.crate'),
    t('quick.medicine'),
  ], [t]);
  const otherActivities = useMemo(() => suggestions.filter((label) =>
    !customActivities.some((saved) => customActivityKey(saved) === customActivityKey(label))), [customActivities, suggestions]);

  const openEditor = (activity: Activity, isNew = false) => {
    const appearance = activityAppearance(activity);
    setEditor({ activity, isNew, name: isNew ? activity.customLabel ?? '' : activityLabel(activity), emoji: appearance?.emoji ?? (isNew ? '🐾' : undefined), color: appearance?.color });
    setShowMore(false);
  };

  const openNew = (label: string) => {
    const clean = label.trim();
    if (!clean) return;
    Keyboard.dismiss();
    openEditor({ type: 'custom', customLabel: clean }, true);
  };

  const saveEditor = async () => {
    if (!editor || !editor.name.trim() || saving) return;
    setSaving(true);
    try {
      const name = editor.name.trim();
      const activity = editor.isNew ? { type: 'custom' as const, customLabel: name } : editor.activity;
      const defaultName = activity.type === 'custom' ? activity.customLabel : localizedEventLabel(language, activity.type);
      await onChangeAppearance(activity, {
        ...(name !== defaultName ? { name } : {}),
        ...(editor.emoji ? { emoji: editor.emoji } : {}),
        ...(editor.color !== undefined ? { color: editor.color } : {}),
      });
      if (editor.isNew) await onLog('custom', name);
      setEditor(null);
      setCustomLabel('');
    } catch {
      Alert.alert(t('settings.saveErrorTitle'), t('settings.saveErrorBody'));
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = () => {
    if (!editor?.activity.customLabel || saving) return;
    const label = editor.activity.customLabel;
    Alert.alert(t('quick.deleteTitle'), t('quick.deleteMessage', { activity: activityLabel(editor.activity) }), [
      { text: t('app.cancel'), style: 'cancel' },
      { text: t('app.delete'), style: 'destructive', onPress: async () => {
        try {
          await onDeleteCustomActivity(label);
          setEditor(null);
        } catch {
          Alert.alert(t('settings.saveErrorTitle'), t('settings.saveErrorBody'));
        }
      } },
    ]);
  };

  return (
    <>
      <View style={[styles.grid, { gap: theme.presentation.gridGap }]}>
        {[
          ...quickEventTypes.map((type) => ({ type, customLabel: undefined as string | undefined })),
          ...customActivities.map((customLabel) => ({ type: 'custom' as EventType, customLabel })),
        ].map(({ type, customLabel }) => {
          const key = activityKey({ type, customLabel });
          const activity = { type, customLabel };
          const colors = colorsFor(theme, activity);
          const latest = type === 'nap' && openNap
            ? openNap
            : events.find((event) => activityKey(event) === key);
          const isEndingNap = type === 'nap' && Boolean(openNap);
          const label = isEndingNap ? t('quick.endNap') : activityLabel(activity);
          return (
            <Pressable
              key={key}
              testID={`quick.${key}`}
              accessibilityRole="button"
              accessibilityLabel={isEndingNap ? t('quick.endNapA11y') : t('quick.logAction', { activity: label })}
              accessibilityHint={isEndingNap ? t('quick.endNapHint') : t('quick.logAndCustomizeHint')}
              accessibilityActions={[{ name: 'customize', label: t('quick.customizeActivity') }]}
              onAccessibilityAction={(event) => { if (event.nativeEvent.actionName === 'customize') openEditor(activity); }}
              onPress={() => onLog(type, customLabel)}
              onLongPress={() => openEditor(activity)}
              delayLongPress={450}
              style={({ pressed }) => [
                styles.action,
                surfaceTreatment(theme),
                {
                  backgroundColor: isEndingNap ? colors.softColor : theme.surfaceRaised,
                  borderColor: pressed || isEndingNap ? colors.color : theme.border,
                  minHeight: theme.presentation.actionHeight,
                  padding: theme.presentation.cardPadding - 4,
                  opacity: pressed ? 0.76 : 1,
                },
              ]}
            >
              <View
                style={[
                  styles.iconCircle,
                  { backgroundColor: colors.softColor, borderRadius: theme.presentation.iconRadius },
                ]}
              >
                {isEndingNap
                  ? <MaterialCommunityIcons name="stop" color={colors.color} size={25} />
                  : <ActivityIcon activity={activity} theme={theme} color={colors.color} size={25} />}
              </View>
              <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.actionLabel, { color: theme.text }]}>
                {label}
              </Text>
              {latest ? (
                <Text numberOfLines={1} style={[styles.actionTime, { color: theme.textMuted }]}>
                  {isEndingNap
                    ? t('quick.running', { time: elapsedTime(latest.at, now) })
                    : relativeTime(latest.endedAt ?? latest.at, now)}
                </Text>
              ) : null}
            </Pressable>
          );
        })}

        <Pressable
          testID="quick.another"
          accessibilityRole="button"
          accessibilityLabel={t('quick.logAnother')}
          accessibilityHint={t('quick.anotherHint')}
          onPress={() => setShowMore(true)}
          style={({ pressed }) => [
            styles.moreAction,
            surfaceTreatment(theme),
            {
              backgroundColor: pressed ? theme.primarySoft : theme.surfaceRaised,
              borderColor: pressed ? theme.primary : theme.border,
            },
          ]}
        >
          <MaterialCommunityIcons
            name={supportingIcon(theme, 'more') as keyof typeof MaterialCommunityIcons.glyphMap}
            color={theme.primary}
            size={23}
          />
          <Text style={[styles.moreLabel, { color: theme.text }]}>{t('quick.another')}</Text>
          <MaterialCommunityIcons name="chevron-right" color={theme.textMuted} size={22} />
        </Pressable>
      </View>

      <Text style={[styles.customizeHint, { color: theme.textMuted }]}>{t('quick.holdToCustomize')}</Text>

      <Modal visible={showMore || editor !== null} transparent animationType="none" onRequestClose={() => { setShowMore(false); setEditor(null); }}>
        <KeyboardAvoidingView
          accessibilityViewIsModal
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.scrim}
        >
          <ScrollView
            key={editor ? 'editor' : 'more'}
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
              <View style={styles.sheetHeadingCopy}>
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
                  {t(editor ? 'quick.customizeActivity' : 'quick.logAnother')}
                </Text>
              </View>
              <Pressable
                testID="quick.another.close"
                accessibilityRole="button"
                accessibilityLabel={t('quick.close')}
                onPress={() => { setShowMore(false); setEditor(null); }}
                style={({ pressed }) => [
                  styles.closeButton,
                  { borderRadius: theme.presentation.controlRadius },
                  pressed && { backgroundColor: theme.primarySoft },
                ]}
              >
                <MaterialCommunityIcons name="close" size={22} color={theme.text} />
              </Pressable>
            </View>

            {editor ? <>
              <Text style={[styles.fieldLabel, { color: theme.textMuted }]}>{t('quick.name')}</Text>
              <TextInput
                testID="quick.editor.name"
                accessibilityLabel={t('quick.name')}
                autoCapitalize="sentences"
                maxLength={40}
                onChangeText={(name) => setEditor((current) => current && { ...current, name })}
                value={editor.name}
                style={[styles.input, styles.editorInput, { backgroundColor: theme.surface, borderColor: theme.border, borderRadius: theme.presentation.controlRadius, borderWidth: theme.presentation.borderWidth, color: theme.text }]}
              />
              <Text style={[styles.fieldLabel, { color: theme.textMuted }]}>{t('quick.emoji')}</Text>
              <View style={styles.emojiGrid}>
                <Pressable accessibilityRole="radio" accessibilityState={{ selected: !editor.emoji }} accessibilityLabel={t('quick.defaultIcon')} onPress={() => setEditor({ ...editor, emoji: undefined })} style={[styles.emojiChoice, { borderColor: !editor.emoji ? theme.primary : theme.border, backgroundColor: !editor.emoji ? theme.primarySoft : theme.surface }]}>
                  <MaterialCommunityIcons name={eventIcon(theme, editor.activity.type) as keyof typeof MaterialCommunityIcons.glyphMap} color={theme.primary} size={24} />
                </Pressable>
                {activityEmojis.map((emoji) => (
                  <Pressable key={emoji} accessibilityRole="radio" accessibilityState={{ selected: editor.emoji === emoji }} accessibilityLabel={t('quick.chooseEmoji', { emoji })} onPress={() => setEditor({ ...editor, emoji })} style={[styles.emojiChoice, { borderColor: editor.emoji === emoji ? theme.primary : theme.border, backgroundColor: editor.emoji === emoji ? theme.primarySoft : theme.surface }]}>
                    <Text style={styles.emojiText}>{emoji}</Text>
                  </Pressable>
                ))}
              </View>
              <Text style={[styles.fieldLabel, { color: theme.textMuted }]}>{t('quick.color')}</Text>
              <View style={styles.colorGrid}>
                <Pressable accessibilityRole="radio" accessibilityState={{ selected: editor.color === undefined }} accessibilityLabel={t('quick.defaultColor')} onPress={() => setEditor({ ...editor, color: undefined })} style={[styles.colorChoice, { backgroundColor: eventColors(theme, editor.activity.type).softColor, borderColor: editor.color === undefined ? theme.primary : theme.border }]}>
                  {editor.color === undefined ? <MaterialCommunityIcons name="check" color={theme.primary} size={24} /> : null}
                </Pressable>
                {activityColors.map((option, index) => (
                  <Pressable key={option.name} accessibilityRole="radio" accessibilityState={{ selected: editor.color === index }} accessibilityLabel={t('quick.chooseColor', { color: option.name })} onPress={() => setEditor({ ...editor, color: index })} style={[styles.colorChoice, { backgroundColor: theme.isDark ? option.dark : option.light, borderColor: editor.color === index ? theme.text : 'transparent' }]}>
                    {editor.color === index ? <MaterialCommunityIcons name="check" color={theme.isDark ? theme.background : '#FFFFFF'} size={24} /> : null}
                  </Pressable>
                ))}
              </View>
              <Pressable testID="quick.editor.save" accessibilityRole="button" accessibilityState={{ disabled: saving || !editor.name.trim() }} disabled={saving || !editor.name.trim()} onPress={() => void saveEditor()} style={({ pressed }) => [styles.editorSave, { backgroundColor: pressed ? theme.primaryPressed : theme.primary, borderRadius: theme.presentation.controlRadius, opacity: saving || !editor.name.trim() ? 0.5 : 1 }]}>
                <Text style={[styles.logButtonText, { color: theme.onPrimary }]}>{t(editor.isNew ? 'quick.logNow' : 'quick.saveActivity')}</Text>
              </Pressable>
              {!editor.isNew && editor.activity.type === 'custom' ? (
                <Pressable testID="quick.editor.delete" accessibilityRole="button" accessibilityLabel={t('quick.deleteActivity', { activity: activityLabel(editor.activity) })} accessibilityState={{ disabled: saving }} disabled={saving} onPress={confirmDelete} style={({ pressed }) => [styles.editorDelete, { backgroundColor: pressed ? theme.dangerSoft : 'transparent', opacity: saving ? 0.5 : 1 }]}>
                  <MaterialCommunityIcons name="trash-can-outline" color={theme.danger} size={20} />
                  <Text style={{ color: theme.danger, fontWeight: '700' }}>{t('quick.deleteActivity', { activity: activityLabel(editor.activity) })}</Text>
                </Pressable>
              ) : null}
            </> : <>
            <View style={styles.otherGrid}>
              {otherActivities.map((label) => (
                <Pressable
                  key={label.toLocaleLowerCase()}
                  accessibilityRole="button"
                  accessibilityLabel={t('quick.setUpAction', { activity: label })}
                  onPress={() => openNew(label)}
                  style={({ pressed }) => [
                    styles.otherChoice,
                    {
                      backgroundColor: pressed ? theme.primarySoft : theme.surface,
                      borderColor: pressed ? theme.primary : theme.border,
                      borderRadius: theme.presentation.controlRadius,
                      borderWidth: theme.presentation.borderWidth,
                    },
                  ]}
                >
                  <MaterialCommunityIcons
                    name={eventIcon(theme, 'custom') as keyof typeof MaterialCommunityIcons.glyphMap}
                    size={19}
                    color={theme.primary}
                  />
                  <Text numberOfLines={1} style={[styles.otherChoiceText, { color: theme.text }]}>{label}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={[styles.fieldLabel, { color: theme.textMuted }]}>{t('quick.customActivity')}</Text>
            <View style={styles.customRow}>
              <TextInput
                testID="quick.custom.input"
                accessibilityLabel={t('quick.customName')}
                autoCapitalize="sentences"
                maxLength={40}
                onChangeText={setCustomLabel}
                onSubmitEditing={() => openNew(customLabel)}
                placeholder={t('quick.customPlaceholder')}
                placeholderTextColor={theme.textMuted}
                returnKeyType="done"
                value={customLabel}
                style={[
                  styles.input,
                  {
                    backgroundColor: theme.surface,
                    borderColor: theme.border,
                    borderRadius: theme.presentation.controlRadius,
                    borderWidth: theme.presentation.borderWidth,
                    color: theme.text,
                  },
                ]}
              />
              <Pressable
                testID="quick.custom.submit"
                accessibilityRole="button"
                accessibilityLabel={t('quick.chooseDetails')}
                accessibilityState={{ disabled: !customLabel.trim() }}
                disabled={!customLabel.trim()}
                onPress={() => openNew(customLabel)}
                style={({ pressed }) => [
                  styles.logButton,
                  {
                    backgroundColor: pressed ? theme.primaryPressed : theme.primary,
                    borderRadius: theme.presentation.controlRadius,
                    opacity: customLabel.trim() ? 1 : 0.45,
                  },
                ]}
              >
                <Text style={[styles.logButtonText, { color: theme.onPrimary }]}>{t('quick.chooseDetails')}</Text>
              </Pressable>
            </View>
            </>}
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  action: {
    minWidth: 96,
    flexBasis: '30%',
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconCircle: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  actionLabel: { maxWidth: '100%', fontSize: 15, lineHeight: 20, fontWeight: '700', marginTop: 7 },
  actionTime: { maxWidth: '100%', fontSize: 11, lineHeight: 16, marginTop: 1 },
  moreAction: {
    width: '100%',
    minHeight: 56,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  moreLabel: { flex: 1, fontSize: 15, fontWeight: '700' },
  customizeHint: { fontSize: 12, lineHeight: 18, marginTop: 8, textAlign: 'center' },
  scrim: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.56)', justifyContent: 'flex-end' },
  sheet: {
    width: '100%',
    maxWidth: 640,
    maxHeight: '92%',
    alignSelf: 'center',
  },
  sheetContent: { padding: spacing.lg, paddingBottom: 34 },
  sheetHeading: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.lg },
  sheetHeadingCopy: { flex: 1, minWidth: 0 },
  sheetTitle: { fontSize: 22, lineHeight: 28, fontWeight: '800' },
  closeButton: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  otherGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: spacing.lg },
  otherChoice: {
    minHeight: 50,
    minWidth: 128,
    flexBasis: '47%',
    flexGrow: 1,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  otherChoiceText: { flex: 1, fontSize: 14, fontWeight: '700' },
  fieldLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 1.2, marginBottom: 8 },
  customRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: { flex: 1, minHeight: 54, paddingHorizontal: 14, fontSize: 16 },
  editorInput: { marginBottom: spacing.lg, flex: 0 },
  emojiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: spacing.lg },
  emojiChoice: { width: 48, height: 48, borderWidth: 2, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  emojiText: { fontSize: 24, lineHeight: 30 },
  colorGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: spacing.lg },
  colorChoice: { width: 48, height: 48, borderRadius: 24, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  editorSave: { minHeight: 54, alignItems: 'center', justifyContent: 'center' },
  editorDelete: { minHeight: 48, marginTop: 10, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
  logButton: { minHeight: 54, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  logButtonText: { fontSize: 14, fontWeight: '800' },
});

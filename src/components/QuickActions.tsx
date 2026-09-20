import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  EVENT_META,
  isOpenNap,
  quickEventTypes,
  type EventType,
  type PuppyEvent,
} from '../domain';
import { useLocalization } from '../localization-context';
import { eventIcon, spacing, supportingIcon, surfaceTreatment, type Theme } from '../theme';

type Props = {
  events: PuppyEvent[];
  onLog: (type: EventType, customLabel?: string) => void;
  now: number;
  theme: Theme;
};

export function QuickActions({ events, onLog, now, theme }: Props) {
  const { elapsedTime, eventLabel, relativeTime, t } = useLocalization();
  const [showMore, setShowMore] = useState(false);
  const [customLabel, setCustomLabel] = useState('');
  const openNap = events.find(isOpenNap);
  const suggestions = useMemo(() => [
    t('quick.water'),
    t('quick.accident'),
    t('quick.play'),
    t('quick.training'),
    t('quick.crate'),
    t('quick.medicine'),
  ], [t]);
  const otherActivities = useMemo(() => {
    const previous = events
      .filter((event) => event.type === 'custom')
      .map((event) => event.customLabel?.trim() || eventLabel('custom'));
    return [...new Set([...suggestions, ...previous])];
  }, [eventLabel, events, suggestions]);

  const logOther = (label: string) => {
    const clean = label.trim();
    if (!clean) return;
    onLog('custom', clean);
    setCustomLabel('');
    setShowMore(false);
  };

  return (
    <>
      <View style={[styles.grid, { gap: theme.presentation.gridGap }]}>
        {quickEventTypes.map((type) => {
          const meta = EVENT_META[type];
          const latest = type === 'nap' && openNap
            ? openNap
            : events.find((event) => event.type === type);
          const isEndingNap = type === 'nap' && Boolean(openNap);
          const label = isEndingNap ? t('quick.endNap') : eventLabel(type);
          return (
            <Pressable
              key={type}
              accessibilityRole="button"
              accessibilityLabel={isEndingNap ? t('quick.endNapA11y') : t('quick.logAction', { activity: label })}
              accessibilityHint={isEndingNap ? t('quick.endNapHint') : t('quick.logHint')}
              onPress={() => onLog(type)}
              style={({ pressed }) => [
                styles.action,
                surfaceTreatment(theme),
                {
                  backgroundColor: isEndingNap ? meta.softColor : theme.surfaceRaised,
                  borderColor: pressed || isEndingNap ? meta.color : theme.border,
                  minHeight: theme.presentation.actionHeight,
                  padding: theme.presentation.cardPadding - 4,
                  opacity: pressed ? 0.76 : 1,
                },
              ]}
            >
              <View
                style={[
                  styles.iconCircle,
                  { backgroundColor: meta.softColor, borderRadius: theme.presentation.iconRadius },
                ]}
              >
                <MaterialCommunityIcons
                  name={(isEndingNap ? 'stop' : eventIcon(theme, type)) as keyof typeof MaterialCommunityIcons.glyphMap}
                  color={meta.color}
                  size={25}
                />
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

      <Modal visible={showMore} transparent animationType="none" onRequestClose={() => setShowMore(false)}>
        <View accessibilityViewIsModal style={styles.scrim}>
          <ScrollView
            bounces={false}
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
                  {t('quick.logAnother')}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('quick.close')}
                onPress={() => setShowMore(false)}
                style={({ pressed }) => [
                  styles.closeButton,
                  { borderRadius: theme.presentation.controlRadius },
                  pressed && { backgroundColor: theme.primarySoft },
                ]}
              >
                <MaterialCommunityIcons name="close" size={22} color={theme.text} />
              </Pressable>
            </View>

            <View style={styles.otherGrid}>
              {otherActivities.map((label) => (
                <Pressable
                  key={label.toLocaleLowerCase()}
                  accessibilityRole="button"
                  accessibilityLabel={t('quick.logAction', { activity: label })}
                  onPress={() => logOther(label)}
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
                accessibilityLabel={t('quick.customName')}
                autoCapitalize="sentences"
                maxLength={40}
                onChangeText={setCustomLabel}
                onSubmitEditing={() => logOther(customLabel)}
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
                accessibilityRole="button"
                accessibilityLabel={t('quick.customLogA11y')}
                accessibilityState={{ disabled: !customLabel.trim() }}
                disabled={!customLabel.trim()}
                onPress={() => logOther(customLabel)}
                style={({ pressed }) => [
                  styles.logButton,
                  {
                    backgroundColor: pressed ? theme.primaryPressed : theme.primary,
                    borderRadius: theme.presentation.controlRadius,
                    opacity: customLabel.trim() ? 1 : 0.45,
                  },
                ]}
              >
                <Text style={[styles.logButtonText, { color: theme.onPrimary }]}>{t('quick.logNow')}</Text>
              </Pressable>
            </View>
          </ScrollView>
        </View>
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
  logButton: { minHeight: 54, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  logButtonText: { fontSize: 14, fontWeight: '800' },
});

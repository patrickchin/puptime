import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  EVENT_META,
  eventLabel,
  isOpenNap,
  quickEventTypes,
  relativeTime,
  type EventType,
  type PuppyEvent,
} from '../domain';
import { spacing, type Theme } from '../theme';

const suggestions = ['Water', 'Accident', 'Play', 'Training', 'Crate', 'Medicine'];

type Props = {
  events: PuppyEvent[];
  onLog: (type: EventType, customLabel?: string) => void;
  theme: Theme;
};

export function QuickActions({ events, onLog, theme }: Props) {
  const [showMore, setShowMore] = useState(false);
  const [customLabel, setCustomLabel] = useState('');
  const openNap = events.find(isOpenNap);
  const otherActivities = useMemo(() => {
    const previous = events.filter((event) => event.type === 'custom').map(eventLabel);
    return [...new Set([...suggestions, ...previous])];
  }, [events]);

  const logOther = (label: string) => {
    const clean = label.trim();
    if (!clean) return;
    onLog('custom', clean);
    setCustomLabel('');
    setShowMore(false);
  };

  return (
    <>
      <View style={styles.grid}>
        {quickEventTypes.map((type) => {
          const meta = EVENT_META[type];
          const latest = type === 'nap' && openNap
            ? openNap
            : events.find((event) => event.type === type);
          const isEndingNap = type === 'nap' && Boolean(openNap);
          const label = isEndingNap ? 'End nap' : meta.label;
          return (
            <Pressable
              key={type}
              accessibilityRole="button"
              accessibilityLabel={isEndingNap ? 'End the current nap' : `Log ${label.toLowerCase()}`}
              accessibilityHint={isEndingNap ? 'Saves the nap end time' : 'Adds the current time to the activity log'}
              onPress={() => onLog(type)}
              style={({ pressed }) => [
                styles.action,
                {
                  backgroundColor: isEndingNap ? meta.softColor : theme.surfaceRaised,
                  borderColor: pressed || isEndingNap ? meta.color : theme.border,
                  opacity: pressed ? 0.76 : 1,
                },
              ]}
            >
              <View style={[styles.iconCircle, { backgroundColor: meta.softColor }]}>
                <MaterialCommunityIcons
                  name={(isEndingNap ? 'stop' : meta.icon) as keyof typeof MaterialCommunityIcons.glyphMap}
                  color={meta.color}
                  size={25}
                />
              </View>
              <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.actionLabel, { color: theme.text }]}>
                {label}
              </Text>
              <Text numberOfLines={1} style={[styles.actionTime, { color: theme.textMuted }]}>
                {latest
                  ? isEndingNap
                    ? `${relativeTime(latest.at).replace(' ago', '')} running`
                    : relativeTime(latest.endedAt ?? latest.at)
                  : 'Not yet'}
              </Text>
            </Pressable>
          );
        })}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Log another type of activity"
          accessibilityHint="Opens common and custom activities"
          onPress={() => setShowMore(true)}
          style={({ pressed }) => [
            styles.moreAction,
            {
              backgroundColor: pressed ? theme.primarySoft : theme.surfaceRaised,
              borderColor: pressed ? theme.primary : theme.border,
            },
          ]}
        >
          <MaterialCommunityIcons name="plus-circle-outline" color={theme.primary} size={23} />
          <Text style={[styles.moreLabel, { color: theme.text }]}>Another activity</Text>
          <MaterialCommunityIcons name="chevron-right" color={theme.textMuted} size={22} />
        </Pressable>
      </View>

      <Modal visible={showMore} transparent animationType="none" onRequestClose={() => setShowMore(false)}>
        <View accessibilityViewIsModal style={styles.scrim}>
          <ScrollView
            bounces={false}
            keyboardShouldPersistTaps="handled"
            style={[styles.sheet, { backgroundColor: theme.surfaceRaised }]}
            contentContainerStyle={styles.sheetContent}
          >
            <View style={styles.sheetHeading}>
              <View style={styles.sheetHeadingCopy}>
                <Text style={[styles.sheetTitle, { color: theme.text }]}>Log another activity</Text>
                <Text style={[styles.sheetSubtitle, { color: theme.textMuted }]}>Common choices stay one tap away.</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close activity picker"
                onPress={() => setShowMore(false)}
                style={({ pressed }) => [styles.closeButton, pressed && { backgroundColor: theme.primarySoft }]}
              >
                <MaterialCommunityIcons name="close" size={22} color={theme.text} />
              </Pressable>
            </View>

            <View style={styles.otherGrid}>
              {otherActivities.map((label) => (
                <Pressable
                  key={label.toLocaleLowerCase()}
                  accessibilityRole="button"
                  accessibilityLabel={`Log ${label.toLowerCase()}`}
                  onPress={() => logOther(label)}
                  style={({ pressed }) => [
                    styles.otherChoice,
                    {
                      backgroundColor: pressed ? theme.primarySoft : theme.surface,
                      borderColor: pressed ? theme.primary : theme.border,
                    },
                  ]}
                >
                  <MaterialCommunityIcons name="tag-outline" size={19} color={theme.primary} />
                  <Text numberOfLines={1} style={[styles.otherChoiceText, { color: theme.text }]}>{label}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={[styles.fieldLabel, { color: theme.textMuted }]}>CUSTOM ACTIVITY</Text>
            <View style={styles.customRow}>
              <TextInput
                accessibilityLabel="Custom activity name"
                autoCapitalize="sentences"
                maxLength={40}
                onChangeText={setCustomLabel}
                onSubmitEditing={() => logOther(customLabel)}
                placeholder="e.g. Grooming"
                placeholderTextColor={theme.textMuted}
                returnKeyType="done"
                value={customLabel}
                style={[styles.input, { backgroundColor: theme.surface, borderColor: theme.border, color: theme.text }]}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Log custom activity now"
                accessibilityState={{ disabled: !customLabel.trim() }}
                disabled={!customLabel.trim()}
                onPress={() => logOther(customLabel)}
                style={({ pressed }) => [
                  styles.logButton,
                  {
                    backgroundColor: pressed ? theme.primaryPressed : theme.primary,
                    opacity: customLabel.trim() ? 1 : 0.45,
                  },
                ]}
              >
                <Text style={[styles.logButtonText, { color: theme.onPrimary }]}>Log now</Text>
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  action: {
    minHeight: 112,
    minWidth: 96,
    flexBasis: '30%',
    flexGrow: 1,
    borderRadius: 20,
    borderWidth: 1,
    padding: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconCircle: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  actionLabel: { maxWidth: '100%', fontSize: 15, lineHeight: 20, fontWeight: '700', marginTop: 7 },
  actionTime: { maxWidth: '100%', fontSize: 11, lineHeight: 16, marginTop: 1 },
  moreAction: {
    width: '100%',
    minHeight: 56,
    borderRadius: 18,
    borderWidth: 1,
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
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
  },
  sheetContent: { padding: spacing.lg, paddingBottom: 34 },
  sheetHeading: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.lg },
  sheetHeadingCopy: { flex: 1, minWidth: 0 },
  sheetTitle: { fontSize: 22, lineHeight: 28, fontWeight: '800' },
  sheetSubtitle: { fontSize: 13, lineHeight: 19, marginTop: 2 },
  closeButton: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  otherGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: spacing.lg },
  otherChoice: {
    minHeight: 50,
    minWidth: 128,
    flexBasis: '47%',
    flexGrow: 1,
    borderWidth: 1,
    borderRadius: 15,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  otherChoiceText: { flex: 1, fontSize: 14, fontWeight: '700' },
  fieldLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 1.2, marginBottom: 8 },
  customRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: { flex: 1, minHeight: 54, borderWidth: 1, borderRadius: 16, paddingHorizontal: 14, fontSize: 16 },
  logButton: { minHeight: 54, borderRadius: 16, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  logButtonText: { fontSize: 14, fontWeight: '800' },
});

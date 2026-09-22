import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  EVENT_META,
  formatDuration,
  formatTime,
  isOpenNap,
  type PuppyEvent,
} from '../domain';
import { useLocalization } from '../localization-context';
import { eventIcon, spacing, surfaceTreatment, type Theme } from '../theme';

export function EventRow({
  event,
  onEdit,
  onDelete,
  now,
  theme,
}: {
  event: PuppyEvent;
  onEdit: () => void;
  onDelete: () => void;
  now: number;
  theme: Theme;
}) {
  const { eventPastLabel, t } = useLocalization();
  const meta = EVENT_META[event.type];
  const note = event.note?.trim();
  const timedNap = event.type === 'nap' && event.endedAt !== undefined;
  const running = isOpenNap(event);
  const duration = timedNap ? formatDuration((event.endedAt ?? now) - event.at) : null;
  const timeSummary = timedNap
    ? `${formatTime(event.at)}–${running ? t('eventRow.now') : formatTime(event.endedAt as number)} · ${duration}${running ? ` ${t('eventRow.running')}` : ''}`
    : `${formatTime(event.at)} · ${t(event.source === 'widget' ? 'eventRow.widget' : 'eventRow.app')}`;
  const pastLabel = eventPastLabel(event);
  return (
    <View
      testID={`event.${event.type}`}
      style={[
        styles.row,
        surfaceTreatment(theme),
        { backgroundColor: theme.surfaceRaised, borderColor: theme.border },
      ]}
    >
      <View
        style={[
          styles.iconCircle,
          { backgroundColor: meta.softColor, borderRadius: theme.presentation.iconRadius },
        ]}
      >
        <MaterialCommunityIcons
          name={eventIcon(theme, event.type) as keyof typeof MaterialCommunityIcons.glyphMap}
          color={meta.color}
          size={22}
        />
      </View>
      <View style={styles.copy}>
        <Text testID={`event.${event.type}.label`} numberOfLines={1} style={[styles.label, { color: theme.text }]}>{pastLabel}</Text>
        <Text numberOfLines={1} style={[styles.source, { color: theme.textMuted }]}>{timeSummary}</Text>
        {note ? (
          <View style={styles.noteRow}>
            <MaterialCommunityIcons name="note-text-outline" size={14} color={theme.primary} />
            <Text testID={`event.${event.type}.note`} numberOfLines={2} style={[styles.note, { color: theme.text }]}>{note}</Text>
          </View>
        ) : null}
      </View>
      <Pressable
        testID={`event.${event.type}.edit`}
        accessibilityRole="button"
        accessibilityLabel={t('eventRow.edit', { activity: pastLabel })}
        accessibilityHint={event.type === 'nap'
          ? t('eventRow.editNapHint')
          : t('eventRow.editHint')}
        onPress={onEdit}
        style={({ pressed }) => [
          styles.editButton,
          { borderRadius: theme.presentation.controlRadius },
          pressed && { backgroundColor: theme.primarySoft },
        ]}
      >
        <MaterialCommunityIcons name="pencil-outline" size={20} color={theme.textMuted} />
      </Pressable>
      <Pressable
        testID={`event.${event.type}.delete`}
        accessibilityRole="button"
        accessibilityLabel={t('eventRow.delete', { activity: pastLabel, time: formatTime(event.at) })}
        hitSlop={8}
        onPress={onDelete}
        style={({ pressed }) => [
          styles.deleteButton,
          { borderRadius: theme.presentation.controlRadius },
          pressed && { backgroundColor: theme.primarySoft },
        ]}
      >
        <MaterialCommunityIcons name="trash-can-outline" size={20} color={theme.textMuted} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 72,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: spacing.sm,
  },
  iconCircle: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: { flex: 1, minWidth: 0 },
  label: { fontSize: 16, fontWeight: '600' },
  source: { fontSize: 12, lineHeight: 17, marginTop: 2 },
  noteRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 5, marginTop: 6 },
  note: { flex: 1, fontSize: 13, lineHeight: 18 },
  editButton: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  deleteButton: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

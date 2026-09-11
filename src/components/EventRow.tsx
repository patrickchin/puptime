import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  EVENT_META,
  eventPastLabel,
  formatDuration,
  formatTime,
  isOpenNap,
  type PuppyEvent,
} from '../domain';
import { spacing, type Theme } from '../theme';

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
  const meta = EVENT_META[event.type];
  const note = event.note?.trim();
  const timedNap = event.type === 'nap' && event.endedAt !== undefined;
  const running = isOpenNap(event);
  const duration = timedNap ? formatDuration((event.endedAt ?? now) - event.at) : null;
  const timeSummary = timedNap
    ? `${formatTime(event.at)}–${running ? 'now' : formatTime(event.endedAt as number)} · ${duration}${running ? ' running' : ''}`
    : `${formatTime(event.at)} · ${event.source === 'widget' ? 'Widget' : 'App'}`;
  return (
    <View style={[styles.row, { backgroundColor: theme.surfaceRaised, borderColor: theme.border }]}>
      <View style={[styles.iconCircle, { backgroundColor: meta.softColor }]}>
        <MaterialCommunityIcons
          name={meta.icon as keyof typeof MaterialCommunityIcons.glyphMap}
          color={meta.color}
          size={22}
        />
      </View>
      <View style={styles.copy}>
        <Text numberOfLines={1} style={[styles.label, { color: theme.text }]}>{eventPastLabel(event)}</Text>
        <Text numberOfLines={1} style={[styles.source, { color: theme.textMuted }]}>{timeSummary}</Text>
        {note ? (
          <View style={styles.noteRow}>
            <MaterialCommunityIcons name="note-text-outline" size={14} color={theme.primary} />
            <Text numberOfLines={2} style={[styles.note, { color: theme.text }]}>{note}</Text>
          </View>
        ) : null}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Edit ${eventPastLabel(event).toLowerCase()} log`}
        accessibilityHint={event.type === 'nap'
          ? 'Opens date, time, and note controls'
          : 'Opens activity, date, time, and note controls'}
        onPress={onEdit}
        style={({ pressed }) => [styles.editButton, pressed && { backgroundColor: theme.primarySoft }]}
      >
        <MaterialCommunityIcons name="pencil-outline" size={20} color={theme.textMuted} />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Delete ${eventPastLabel(event).toLowerCase()} at ${formatTime(event.at)}`}
        hitSlop={8}
        onPress={onDelete}
        style={({ pressed }) => [styles.deleteButton, pressed && { backgroundColor: theme.primarySoft }]}
      >
        <MaterialCommunityIcons name="trash-can-outline" size={20} color={theme.textMuted} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 72,
    borderWidth: 1,
    borderRadius: 18,
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
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: { flex: 1, minWidth: 0 },
  label: { fontSize: 16, fontWeight: '600' },
  source: { fontSize: 12, lineHeight: 17, marginTop: 2 },
  noteRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 5, marginTop: 6 },
  note: { flex: 1, fontSize: 13, lineHeight: 18 },
  editButton: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  deleteButton: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

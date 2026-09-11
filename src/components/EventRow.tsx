import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { EVENT_META, formatTime, type PuppyEvent } from '../domain';
import { spacing, type Theme } from '../theme';

export function EventRow({
  event,
  onEditTime,
  onDelete,
  theme,
}: {
  event: PuppyEvent;
  onEditTime: () => void;
  onDelete: () => void;
  theme: Theme;
}) {
  const meta = EVENT_META[event.type];
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
        <Text style={[styles.label, { color: theme.text }]}>{meta.pastLabel}</Text>
        <Text style={[styles.source, { color: theme.textMuted }]}>
          {event.source === 'widget' ? 'Home-screen widget' : 'In the app'}
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Change time for ${meta.pastLabel.toLowerCase()}, currently ${formatTime(event.at)}`}
        accessibilityHint="Opens quick backdating and an exact time picker"
        onPress={onEditTime}
        style={({ pressed }) => [
          styles.timeButton,
          { backgroundColor: pressed ? theme.primarySoft : theme.surface },
        ]}
      >
        <Text style={[styles.time, { color: theme.text }]}>{formatTime(event.at)}</Text>
        <MaterialCommunityIcons name="pencil-outline" size={14} color={theme.textMuted} />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Delete ${meta.pastLabel.toLowerCase()} at ${formatTime(event.at)}`}
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
  timeButton: {
    minHeight: 48,
    borderRadius: 13,
    paddingHorizontal: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  time: { fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },
  deleteButton: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

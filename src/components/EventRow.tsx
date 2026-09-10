import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { EVENT_META, formatTime, type PuppyEvent } from '../domain';
import { spacing, type Theme } from '../theme';

export function EventRow({ event, onDelete, theme }: { event: PuppyEvent; onDelete: () => void; theme: Theme }) {
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
      <Text style={[styles.time, { color: theme.text }]}>{formatTime(event.at)}</Text>
      <Pressable
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
  time: { fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'] },
  deleteButton: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

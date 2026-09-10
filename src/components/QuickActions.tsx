import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { EVENT_META, eventTypes, relativeTime, type EventType, type PuppyEvent } from '../domain';
import { spacing, type Theme } from '../theme';

type Props = {
  events: PuppyEvent[];
  onLog: (type: EventType) => void;
  theme: Theme;
};

export function QuickActions({ events, onLog, theme }: Props) {
  return (
    <View style={styles.grid}>
      {eventTypes.map((type) => {
        const meta = EVENT_META[type];
        const latest = events.find((event) => event.type === type);
        return (
          <Pressable
            key={type}
            accessibilityLabel={`Log ${meta.label.toLowerCase()}`}
            accessibilityHint="Adds the current time to the activity log"
            onPress={() => onLog(type)}
            style={({ pressed }) => [
              styles.action,
              {
                backgroundColor: theme.surfaceRaised,
                borderColor: pressed ? meta.color : theme.border,
                opacity: pressed ? 0.78 : 1,
              },
            ]}
          >
            <View style={[styles.iconCircle, { backgroundColor: meta.softColor }]}>
              <MaterialCommunityIcons
                name={meta.icon as keyof typeof MaterialCommunityIcons.glyphMap}
                color={meta.color}
                size={28}
              />
            </View>
            <View style={styles.actionCopy}>
              <Text style={[styles.actionLabel, { color: theme.text }]}>{meta.label}</Text>
              <Text style={[styles.actionTime, { color: theme.textMuted }]}>
                {latest ? relativeTime(latest.at) : 'Not yet'}
              </Text>
            </View>
            <MaterialCommunityIcons name="plus" color={theme.textMuted} size={22} />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  action: {
    minHeight: 104,
    minWidth: 148,
    flexBasis: '48%',
    flexGrow: 1,
    borderRadius: 20,
    borderWidth: 1,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconCircle: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionCopy: {
    flex: 1,
    minWidth: 0,
  },
  actionLabel: {
    fontSize: 18,
    fontWeight: '700',
  },
  actionTime: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: 2,
  },
});

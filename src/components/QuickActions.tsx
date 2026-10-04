import { Pressable, StyleSheet, Text, View } from 'react-native';

import { activityKey, type PuppyEvent } from '../domain';
import { ActivityIcon } from './ActivityIcon';
import { useLocalization } from '../localization-context';
import { surfaceTreatment, type Theme } from '../theme';

const actions = ['pee', 'poop', 'meal'] as const;

export function QuickActions({ events, onLog, now, theme }: {
  events: PuppyEvent[];
  onLog: (type: (typeof actions)[number]) => Promise<void>;
  now: number;
  theme: Theme;
}) {
  const { activityColors, activityLabel, relativeTime, t } = useLocalization();

  return (
    <View style={[styles.grid, { gap: theme.presentation.gridGap }]}>
      {actions.map((type) => {
        const activity = { type };
        const colors = activityColors(theme, activity);
        const latest = events.find((event) => activityKey(event) === type);
        return (
          <Pressable
            key={type}
            testID={`quick.${type}`}
            accessibilityRole="button"
            accessibilityLabel={t('quick.logAction', { activity: activityLabel(activity) })}
            accessibilityHint={t('quick.logHint')}
            onPress={() => void onLog(type)}
            style={({ pressed }) => [
              styles.action,
              surfaceTreatment(theme),
              {
                backgroundColor: theme.surfaceRaised,
                borderColor: pressed ? colors.color : theme.border,
                minHeight: theme.presentation.actionHeight,
                padding: theme.presentation.cardPadding - 4,
                opacity: pressed ? 0.76 : 1,
              },
            ]}
          >
            <View style={[styles.iconCircle, { backgroundColor: colors.softColor, borderRadius: theme.presentation.iconRadius }]}>
              <ActivityIcon activity={activity} theme={theme} color={colors.color} size={25} />
            </View>
            <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.actionLabel, { color: theme.text }]}>
              {activityLabel(activity)}
            </Text>
            {latest ? (
              <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.actionTime, { color: theme.textMuted }]}>
                {relativeTime(latest.at, now)}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row' },
  action: { minWidth: 0, flex: 1, alignItems: 'center', justifyContent: 'center' },
  iconCircle: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  actionLabel: { maxWidth: '100%', fontSize: 15, lineHeight: 20, fontWeight: '700', marginTop: 7 },
  actionTime: { maxWidth: '100%', fontSize: 11, lineHeight: 16, marginTop: 1 },
});

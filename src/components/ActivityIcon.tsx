import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Text } from 'react-native';

import type { Activity } from '../domain';
import { useLocalization } from '../localization-context';
import { eventIcon, type Theme } from '../theme';

export function ActivityIcon({ activity, theme, color, size = 22 }: {
  activity: Activity;
  theme: Theme;
  color: string;
  size?: number;
}) {
  const { activityAppearance } = useLocalization();
  const emoji = activityAppearance(activity)?.emoji;
  return emoji
    ? <Text accessibilityElementsHidden importantForAccessibility="no" style={{ fontSize: size, lineHeight: size + 5 }}>{emoji}</Text>
    : <MaterialCommunityIcons accessibilityElementsHidden importantForAccessibility="no" name={eventIcon(theme, activity.type) as keyof typeof MaterialCommunityIcons.glyphMap} color={color} size={size} />;
}

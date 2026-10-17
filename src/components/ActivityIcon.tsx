import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image, Text, View } from 'react-native';

import type { Activity } from '../domain';
import { useLocalization } from '../localization-context';
import { eventIcon, type Theme } from '../theme';

const artwork = {
  'puppy-journal': require('../../assets/appearance/journal-activities.png'),
  'soft-play': require('../../assets/appearance/soft-activities.png'),
  'day-trails': require('../../assets/appearance/trail-activities.png'),
};

const combinationArtwork = {
  'puppy-journal': require('../../assets/appearance/journal-combinations.png'),
  'soft-play': require('../../assets/appearance/soft-combinations.png'),
  'day-trails': require('../../assets/appearance/trail-combinations.png'),
};

function ActivityArtwork({ source, index, size, columns = 3, rows = 1, scale = 1.25 }: {
  source: number; index: number; size: number; columns?: number; rows?: number; scale?: number;
}) {
  // Clip square atlas cells at render time, preserving the original transparent artwork.
  const cell = size * scale;
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: size, height: size, overflow: 'hidden' }}>
      <Image source={source} accessible={false} resizeMode="stretch" style={{ position: 'absolute', width: cell * columns, height: cell * rows, left: -(index % columns) * cell - (cell - size) / 2, top: -Math.floor(index / columns) * cell - (cell - size) / 2 }} />
    </View>
  );
}

export function ActivityCombinationIcon({ index, theme, size }: { index: number; theme: Theme; size: number }) {
  const profile = theme.presentation.iconProfile;
  return profile === 'default' ? null : <ActivityArtwork source={combinationArtwork[profile]} index={index} size={size} columns={2} rows={2} scale={1} />;
}

export function ActivityIcon({ activity, theme, color, size = 22 }: {
  activity: Activity;
  theme: Theme;
  color: string;
  size?: number;
}) {
  const { activityAppearance } = useLocalization();
  const emoji = activityAppearance(activity)?.emoji;
  const profile = theme.presentation.iconProfile;
  const index = (['pee', 'poop', 'meal'] as const).findIndex((type) => type === activity.type);
  if (!emoji && profile !== 'default' && index >= 0) {
    return <ActivityArtwork source={artwork[profile]} index={index} size={size} />;
  }
  return emoji
    ? <Text accessibilityElementsHidden importantForAccessibility="no" style={{ fontSize: size, lineHeight: size + 5 }}>{emoji}</Text>
    : <MaterialCommunityIcons accessibilityElementsHidden importantForAccessibility="no" name={eventIcon(theme, activity.type) as keyof typeof MaterialCommunityIcons.glyphMap} color={color} size={size} />;
}

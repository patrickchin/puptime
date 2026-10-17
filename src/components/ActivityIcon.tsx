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

function ActivityArtwork({ source, index, size }: { source: number; index: number; size: number }) {
  const { width, height } = Image.resolveAssetSource(source);
  // Each transparent atlas contains three square cells; crop in the view, preserving the original artwork.
  const cell = size * 1.25;
  const imageHeight = cell * height / (width / 3);
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: size, height: size, overflow: 'hidden' }}>
      <Image source={source} accessible={false} resizeMode="stretch" style={{ position: 'absolute', width: cell * 3, height: imageHeight, left: -index * cell - (cell - size) / 2, top: (size - imageHeight) / 2 }} />
    </View>
  );
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

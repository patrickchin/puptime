import { Text } from 'react-native';

// A text arrow keeps the icon font and its glyph map out of the website bundle.
export function LearnBackIcon({ color }: { color: string }) {
  return <Text aria-hidden style={{ fontSize: 24, color }}>←</Text>;
}

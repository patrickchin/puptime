import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import type { Theme } from '../theme';

export function SettingsRow({
  testID,
  icon,
  label,
  detail,
  hint,
  onPress,
  theme,
  wrap=false,
  disabled=false,
}: {
  testID: string;
  wrap?: boolean;
  disabled?: boolean;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  label: string;
  detail: string;
  hint?: string;
  onPress: () => void;
  theme: Theme;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`${label}. ${detail}`}
      accessibilityHint={hint}
      disabled={disabled}
      accessibilityState={{disabled}}
      onPress={onPress}
      style={({ pressed }) => [styles.settingsRow, disabled && {opacity:0.45}, pressed && { backgroundColor: theme.primarySoft }]}
    >
      <View style={[styles.rowIcon, { backgroundColor: theme.primarySoft, borderRadius: theme.presentation.iconRadius }]}>
        <MaterialCommunityIcons
          accessibilityElementsHidden
          importantForAccessibility="no"
          name={icon}
          size={21}
          color={theme.primary}
        />
      </View>
      <View style={styles.rowCopy}>
        <Text numberOfLines={wrap?undefined:1} style={[styles.rowLabel, { color: theme.text }]}>{label}</Text>
        <Text numberOfLines={wrap?undefined:1} adjustsFontSizeToFit={!wrap&&Platform.OS!=='ios'} minimumFontScale={0.85} style={[styles.rowHint, { color: theme.textMuted }]}>{detail}</Text>
      </View>
      <MaterialCommunityIcons
        accessibilityElementsHidden
        importantForAccessibility="no"
        name="chevron-right"
        size={23}
        color={theme.textMuted}
      />
    </Pressable>
  );
}


const styles = StyleSheet.create({
  settingsRow: { minHeight: 68, paddingHorizontal: 8, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 11 },
  rowIcon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  rowCopy: { flex: 1, minWidth: 0 },
  rowLabel: { fontSize: 16, lineHeight: 21, fontWeight: '800' },
  rowHint: { fontSize: 12, lineHeight: 17, marginTop: 2 },
});

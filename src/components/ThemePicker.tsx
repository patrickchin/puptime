import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  darkTheme,
  lightTheme,
  resolveTheme,
  spacing,
  sunriseTheme,
  type Theme,
  type ThemePreference,
} from '../theme';

const choices: {
  id: ThemePreference;
  label: string;
  description: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
}[] = [
  { id: 'system', label: 'System', description: 'Match this device', icon: 'cellphone-cog' },
  { id: 'meadow', label: 'Meadow', description: 'Cream and leafy green', icon: 'sprout-outline' },
  { id: 'sunrise', label: 'Sunrise', description: 'Peach and warm clay', icon: 'weather-sunset-up' },
  { id: 'midnight', label: 'Midnight', description: 'Deep green after dark', icon: 'weather-night' },
];

function previewTheme(
  preference: ThemePreference,
  colorScheme: 'light' | 'dark' | 'unspecified' | null,
): Theme {
  if (preference === 'meadow') return lightTheme;
  if (preference === 'sunrise') return sunriseTheme;
  if (preference === 'midnight') return darkTheme;
  return resolveTheme('system', colorScheme);
}

export function ThemePicker({
  visible,
  selected,
  colorScheme,
  theme,
  onSelect,
  onClose,
}: {
  visible: boolean;
  selected: ThemePreference;
  colorScheme: 'light' | 'dark' | 'unspecified' | null;
  theme: Theme;
  onSelect: (preference: ThemePreference) => void;
  onClose: () => void;
}) {
  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
      transparent
      visible={visible}
    >
      <View style={styles.modal}>
        <Pressable
          accessibilityLabel="Close theme picker"
          onPress={onClose}
          style={[StyleSheet.absoluteFill, styles.backdrop]}
        />
        <SafeAreaView
          accessibilityViewIsModal
          edges={['bottom']}
          style={[styles.sheet, { backgroundColor: theme.surfaceRaised, borderColor: theme.border }]}
        >
          <View style={styles.heading}>
            <View style={styles.headingCopy}>
              <Text style={[styles.title, { color: theme.text }]}>Choose a theme</Text>
              <Text style={[styles.subtitle, { color: theme.textMuted }]}>Your choice stays on this device.</Text>
            </View>
            <Pressable
              accessibilityLabel="Close theme picker"
              accessibilityRole="button"
              onPress={onClose}
              style={({ pressed }) => [
                styles.closeButton,
                { backgroundColor: pressed ? theme.primarySoft : theme.surface },
              ]}
            >
              <MaterialCommunityIcons
                accessibilityElementsHidden
                importantForAccessibility="no"
                name="close"
                size={22}
                color={theme.text}
              />
            </Pressable>
          </View>

          <ScrollView
            contentContainerStyle={styles.choices}
            showsVerticalScrollIndicator={false}
            style={styles.choiceScroll}
          >
            {choices.map((choice) => {
              const active = selected === choice.id;
              const preview = previewTheme(choice.id, colorScheme);
              return (
                <Pressable
                  key={choice.id}
                  accessibilityLabel={`${choice.label}. ${choice.description}`}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: active }}
                  onPress={() => onSelect(choice.id)}
                  style={({ pressed }) => [
                    styles.choice,
                    {
                      backgroundColor: active || pressed ? theme.primarySoft : theme.surface,
                      borderColor: active ? theme.primary : theme.border,
                    },
                  ]}
                >
                  <View style={[styles.choiceIcon, { backgroundColor: theme.surfaceRaised }]}>
                    <MaterialCommunityIcons
                      accessibilityElementsHidden
                      importantForAccessibility="no"
                      name={choice.icon}
                      size={21}
                      color={active ? theme.primary : theme.textMuted}
                    />
                  </View>
                  <View style={styles.choiceCopy}>
                    <Text style={[styles.choiceLabel, { color: theme.text }]}>{choice.label}</Text>
                    <Text style={[styles.choiceDescription, { color: theme.textMuted }]}>{choice.description}</Text>
                  </View>
                  <View
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                    style={styles.swatches}
                  >
                    {[preview.background, preview.primarySoft, preview.primary].map((color) => (
                      <View key={color} style={[styles.swatch, { backgroundColor: color, borderColor: preview.border }]} />
                    ))}
                  </View>
                  <MaterialCommunityIcons
                    accessibilityElementsHidden
                    importantForAccessibility="no"
                    name={active ? 'check-circle' : 'circle-outline'}
                    size={22}
                    color={active ? theme.primary : theme.border}
                  />
                </Pressable>
              );
            })}
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modal: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { backgroundColor: 'rgba(0, 0, 0, 0.56)' },
  sheet: {
    width: '100%',
    maxWidth: 600,
    alignSelf: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: '92%',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
  },
  heading: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  headingCopy: { flex: 1, minWidth: 0 },
  title: { fontSize: 22, lineHeight: 28, fontWeight: '800', letterSpacing: -0.3 },
  subtitle: { fontSize: 14, lineHeight: 20, marginTop: 2 },
  closeButton: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  choiceScroll: { flexShrink: 1 },
  choices: { gap: spacing.sm, paddingTop: spacing.lg, paddingBottom: spacing.md },
  choice: {
    minHeight: 68,
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  choiceIcon: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  choiceCopy: { flex: 1, minWidth: 0 },
  choiceLabel: { fontSize: 16, lineHeight: 21, fontWeight: '800' },
  choiceDescription: { fontSize: 12, lineHeight: 17, marginTop: 1 },
  swatches: { flexDirection: 'row', paddingLeft: 8 },
  swatch: { width: 20, height: 20, borderRadius: 10, borderWidth: 1, marginLeft: -7 },
});

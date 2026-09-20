import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  namedThemes,
  resolveTheme,
  spacing,
  type Theme,
  type ThemePreference,
} from '../theme';

const choices: {
  id: ThemePreference;
  label: string;
  description: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
}[] = [
  { id: 'system', label: 'System', description: 'Follow this device', icon: 'cellphone-cog' },
  { id: 'meadow', label: 'Meadow', description: 'Soft journal · relaxed', icon: 'sprout-outline' },
  { id: 'sunrise', label: 'Sunrise', description: 'Crisp checklist · compact', icon: 'weather-sunset-up' },
  { id: 'midnight', label: 'Midnight', description: 'Floating cards · spacious', icon: 'weather-night' },
  { id: 'paper', label: 'Paper', description: 'Monochrome notebook · square', icon: 'book-open-page-variant-outline' },
  { id: 'bubblegum', label: 'Bubblegum', description: 'Playful bubbles · chunky', icon: 'heart-outline' },
  { id: 'blueprint', label: 'Blueprint', description: 'Technical grid · dense', icon: 'vector-square' },
  { id: 'trail', label: 'Trail', description: 'Rugged cards · sturdy', icon: 'pine-tree' },
  { id: 'tide', label: 'Tide', description: 'Airy capsules · calm', icon: 'waves' },
  { id: 'plum', label: 'Plum', description: 'Editorial blocks · dramatic', icon: 'flower-outline' },
  { id: 'contrast', label: 'Contrast', description: 'Bold outlines · maximum clarity', icon: 'contrast-circle' },
];

function previewTheme(
  preference: ThemePreference,
  colorScheme: 'light' | 'dark' | 'unspecified' | null,
): Theme {
  if (preference === 'system') return resolveTheme('system', colorScheme);
  return namedThemes[preference];
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
          style={[
            styles.sheet,
            {
              backgroundColor: theme.surfaceRaised,
              borderColor: theme.border,
              borderTopLeftRadius: theme.presentation.cardRadius + 6,
              borderTopRightRadius: theme.presentation.cardRadius + 6,
              borderTopWidth: theme.presentation.borderWidth,
            },
          ]}
        >
          <View style={styles.heading}>
            <View style={styles.headingCopy}>
              <Text
                style={[
                  styles.title,
                  {
                    color: theme.text,
                    fontWeight: theme.presentation.titleWeight,
                    letterSpacing: theme.presentation.titleTracking,
                  },
                ]}
              >
                Choose a theme
              </Text>
              <Text style={[styles.subtitle, { color: theme.textMuted }]}>10 styles to compare · saved on this device.</Text>
            </View>
            <Pressable
              accessibilityLabel="Close theme picker"
              accessibilityRole="button"
              onPress={onClose}
              style={({ pressed }) => [
                styles.closeButton,
                {
                  backgroundColor: pressed ? theme.primarySoft : theme.surface,
                  borderRadius: theme.presentation.controlRadius,
                },
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
                      borderRadius: theme.presentation.cardRadius,
                      borderWidth: theme.presentation.borderWidth,
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.choiceIcon,
                      {
                        backgroundColor: theme.surfaceRaised,
                        borderRadius: theme.presentation.iconRadius,
                      },
                    ]}
                  >
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
                    style={[
                      styles.preview,
                      {
                        backgroundColor: preview.background,
                        borderColor: preview.border,
                        borderRadius: Math.max(4, preview.presentation.cardRadius * 0.35),
                      },
                    ]}
                  >
                    <View
                      style={[
                        styles.previewCard,
                        {
                          backgroundColor: preview.surfaceRaised,
                          borderColor: preview.border,
                          borderRadius: Math.max(3, preview.presentation.cardRadius * 0.26),
                          borderWidth: preview.presentation.borderWidth ? 1 : 0,
                        },
                      ]}
                    >
                      <View
                        style={[
                          styles.previewMark,
                          {
                            backgroundColor: preview.primary,
                            borderRadius: preview.presentation.iconRadius > 20 ? 5 : 2,
                          },
                        ]}
                      />
                      <View style={[styles.previewLine, { backgroundColor: preview.textMuted }]} />
                    </View>
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
    maxHeight: '92%',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
  },
  heading: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  headingCopy: { flex: 1, minWidth: 0 },
  title: { fontSize: 22, lineHeight: 28, fontWeight: '800', letterSpacing: -0.3 },
  subtitle: { fontSize: 14, lineHeight: 20, marginTop: 2 },
  closeButton: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  choiceScroll: { flexShrink: 1 },
  choices: { gap: spacing.sm, paddingTop: spacing.lg, paddingBottom: spacing.md },
  choice: {
    minHeight: 68,
    paddingHorizontal: 12,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  choiceIcon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  choiceCopy: { flex: 1, minWidth: 0 },
  choiceLabel: { fontSize: 16, lineHeight: 21, fontWeight: '800' },
  choiceDescription: { fontSize: 12, lineHeight: 17, marginTop: 1 },
  preview: { width: 52, height: 34, borderWidth: 1, padding: 4 },
  previewCard: { flex: 1, paddingHorizontal: 5, flexDirection: 'row', alignItems: 'center', gap: 4 },
  previewMark: { width: 8, height: 8 },
  previewLine: { width: 17, height: 3, borderRadius: 2, opacity: 0.65 },
});

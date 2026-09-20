import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useLocalization } from '../localization-context';
import {
  languageChoices,
  type LanguagePreference,
  type MessageKey,
} from '../localization';
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
  descriptionKey: MessageKey;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
}[] = [
  { id: 'system', label: 'System', descriptionKey: 'language.systemDetail', icon: 'cellphone-cog' },
  { id: 'meadow', label: 'Meadow', descriptionKey: 'theme.meadow.detail', icon: 'sprout-outline' },
  { id: 'sunrise', label: 'Sunrise', descriptionKey: 'theme.sunrise.detail', icon: 'weather-sunset-up' },
  { id: 'midnight', label: 'Midnight', descriptionKey: 'theme.midnight.detail', icon: 'weather-night' },
  { id: 'paper', label: 'Paper', descriptionKey: 'theme.paper.detail', icon: 'book-open-page-variant-outline' },
  { id: 'bubblegum', label: 'Bubblegum', descriptionKey: 'theme.bubblegum.detail', icon: 'heart-outline' },
  { id: 'blueprint', label: 'Blueprint', descriptionKey: 'theme.blueprint.detail', icon: 'vector-square' },
  { id: 'trail', label: 'Trail', descriptionKey: 'theme.trail.detail', icon: 'pine-tree' },
  { id: 'tide', label: 'Tide', descriptionKey: 'theme.tide.detail', icon: 'waves' },
  { id: 'plum', label: 'Plum', descriptionKey: 'theme.plum.detail', icon: 'flower-outline' },
  { id: 'contrast', label: 'Contrast', descriptionKey: 'theme.contrast.detail', icon: 'contrast-circle' },
];

const languageLabels: Record<Exclude<LanguagePreference, 'system'>, string> = {
  en: 'English',
  'zh-Hans': '简体中文',
  es: 'Español',
};

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
  selectedLanguage,
  colorScheme,
  theme,
  onSelect,
  onSelectLanguage,
  onClose,
}: {
  visible: boolean;
  selected: ThemePreference;
  selectedLanguage: LanguagePreference;
  colorScheme: 'light' | 'dark' | 'unspecified' | null;
  theme: Theme;
  onSelect: (preference: ThemePreference) => void;
  onSelectLanguage: (preference: LanguagePreference) => void;
  onClose: () => void;
}) {
  const { t } = useLocalization();

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
          accessibilityLabel={t('appearance.close')}
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
                {t('appearance.title')}
              </Text>
            </View>
            <Pressable
              accessibilityLabel={t('appearance.close')}
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
            <Text
              style={[
                styles.sectionLabel,
                { color: theme.primary, letterSpacing: theme.presentation.eyebrowTracking },
              ]}
            >
              {t('appearance.themeHeading')}
            </Text>
            {choices.map((choice) => {
              const active = selected === choice.id;
              const preview = previewTheme(choice.id, colorScheme);
              const label = choice.id === 'system' ? t('language.system') : choice.label;
              const description = t(choice.descriptionKey);
              return (
                <Pressable
                  key={choice.id}
                  accessibilityLabel={`${label}. ${description}`}
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
                    <Text style={[styles.choiceLabel, { color: theme.text }]}>{label}</Text>
                    <Text style={[styles.choiceDescription, { color: theme.textMuted }]}>{description}</Text>
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

            <View style={styles.languageHeading}>
              <Text
                style={[
                  styles.sectionLabel,
                  { color: theme.primary, letterSpacing: theme.presentation.eyebrowTracking },
                ]}
              >
                {t('appearance.languageHeading')}
              </Text>
            </View>
            {languageChoices.map((preference) => {
              const active = selectedLanguage === preference;
              const label = preference === 'system' ? t('language.system') : languageLabels[preference];
              const detail = preference === 'system' ? t('language.systemDetail') : t(`language.${preference}`);
              return (
                <Pressable
                  key={preference}
                  accessibilityLabel={`${label}. ${detail}`}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: active }}
                  onPress={() => onSelectLanguage(preference)}
                  style={({ pressed }) => [
                    styles.languageChoice,
                    {
                      backgroundColor: active || pressed ? theme.primarySoft : theme.surface,
                      borderColor: active ? theme.primary : theme.border,
                      borderRadius: theme.presentation.controlRadius,
                      borderWidth: theme.presentation.borderWidth,
                    },
                  ]}
                >
                  <MaterialCommunityIcons
                    accessibilityElementsHidden
                    importantForAccessibility="no"
                    name={preference === 'system' ? 'cellphone-cog' : 'translate'}
                    size={21}
                    color={active ? theme.primary : theme.textMuted}
                  />
                  <View style={styles.choiceCopy}>
                    <Text style={[styles.choiceLabel, { color: theme.text }]}>{label}</Text>
                    {preference === 'system' ? (
                      <Text style={[styles.choiceDescription, { color: theme.textMuted }]}>{detail}</Text>
                    ) : null}
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
  closeButton: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  choiceScroll: { flexShrink: 1 },
  choices: { gap: spacing.sm, paddingTop: spacing.lg, paddingBottom: spacing.md },
  sectionLabel: { fontSize: 11, lineHeight: 15, fontWeight: '800', marginBottom: 2 },
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
  languageHeading: { marginTop: spacing.md },
  languageChoice: {
    minHeight: 58,
    paddingHorizontal: 14,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
});

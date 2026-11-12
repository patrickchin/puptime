import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRef } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { useLocalization } from '../localization-context';
import type { Theme } from '../theme';
import { Pressable } from './TelemetryPressable';

export function SettingsSearch({ theme, query, onChange, empty }: {
  theme: Theme;
  query: string;
  onChange: (value: string) => void;
  empty: boolean;
}) {
  const { t } = useLocalization();
  const input = useRef<TextInput>(null);
  return <>
    <View style={[styles.field, { backgroundColor: theme.surfaceRaised, borderColor: theme.border, borderRadius: theme.presentation.controlRadius }]}>
      <MaterialCommunityIcons name="magnify" size={22} color={theme.textMuted} accessible={false} />
      <TextInput ref={input} testID="settings.search" accessibilityLabel={t('settings.search')} accessibilityRole="search" placeholder={t('settings.search')}
        placeholderTextColor={theme.textMuted} value={query} onChangeText={onChange} autoCapitalize="none" autoCorrect={false}
        returnKeyType="search" keyboardAppearance={theme.isDark ? 'dark' : 'light'} onSubmitEditing={() => input.current?.blur()}
        style={[styles.input, { color: theme.text }]} />
      {query.length > 0 && <Pressable testID="settings.search.clear" accessibilityRole="button" accessibilityLabel={t('settings.searchClear')}
        onPress={() => { onChange(''); input.current?.focus(); }} style={({ pressed }) => [styles.clear, pressed && { opacity: 0.6 }]}>
        <MaterialCommunityIcons name="close-circle" size={20} color={theme.textMuted} accessible={false} />
      </Pressable>}
    </View>
    {empty && <View testID="settings.search.empty" style={styles.empty} accessibilityLiveRegion="polite">
      <Text style={[styles.emptyTitle, { color: theme.text }]}>{t('settings.searchEmpty')}</Text>
      <Text style={[styles.emptyDetail, { color: theme.textMuted }]}>{t('settings.searchTry')}</Text>
    </View>}
  </>;
}

const styles = StyleSheet.create({
  field: { minHeight: 48, borderWidth: 1, paddingLeft: 12, flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  input: { flex: 1, minWidth: 0, fontSize: 16, paddingVertical: 12, paddingRight: 8 },
  clear: { minWidth: 48, minHeight: 48, justifyContent: 'center', alignItems: 'center' },
  empty: { paddingVertical: 32, gap: 8 },
  emptyTitle: { fontSize: 18, fontWeight: '700' },
  emptyDetail: { fontSize: 15, lineHeight: 22 },
});

import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { useLocalization } from '../localization-context';
import { spacing, type Theme } from '../theme';

export function ConfirmDialog({ visible, title, message, confirmLabel, error, busy = false, inline = false, theme, onCancel, onConfirm }: {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  error?: string;
  busy?: boolean;
  inline?: boolean;
  theme: Theme;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useLocalization();
  const content = (
    <View testID="confirm.dialog" accessibilityViewIsModal style={[styles.scrim, inline && StyleSheet.absoluteFill, inline && styles.inline]}>
      <View style={[styles.card, { backgroundColor: theme.surfaceRaised, borderColor: theme.border, borderRadius: theme.presentation.cardRadius, borderWidth: theme.presentation.borderWidth }]}>
        <View style={[styles.icon, { backgroundColor: theme.dangerSoft, borderRadius: theme.presentation.iconRadius }]}>
          <MaterialCommunityIcons name="trash-can-outline" size={23} color={theme.danger} accessibilityElementsHidden importantForAccessibility="no" />
        </View>
        <Text style={[styles.title, { color: theme.text, fontWeight: theme.presentation.titleWeight }]}>{title}</Text>
        <Text style={[styles.message, { color: theme.textMuted }]}>{message}</Text>
        {error ? <Text accessibilityLiveRegion="polite" style={[styles.error, { color: theme.danger }]}>{error}</Text> : null}
        <View style={styles.actions}>
          <Pressable testID="confirm.cancel" accessibilityRole="button" disabled={busy} accessibilityState={{ disabled: busy }} onPress={onCancel} style={({ pressed }) => [styles.button, { backgroundColor: pressed ? theme.primarySoft : theme.surface, borderColor: theme.border, borderRadius: theme.presentation.controlRadius, borderWidth: theme.presentation.borderWidth }]}>
            <Text style={[styles.buttonText, { color: theme.text }]}>{t('app.cancel')}</Text>
          </Pressable>
          <Pressable testID="confirm.delete" accessibilityRole="button" disabled={busy} accessibilityState={{ disabled: busy, busy }} onPress={onConfirm} style={({ pressed }) => [styles.button, { backgroundColor: theme.danger, borderRadius: theme.presentation.controlRadius, opacity: busy ? 0.55 : pressed ? 0.8 : 1 }]}>
            <Text style={[styles.buttonText, { color: theme.surfaceRaised }]}>{confirmLabel}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
  if (inline) return visible ? content : null;
  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={() => { if (!busy) onCancel(); }}>
      {content}
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.56)', alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  inline: { zIndex: 1 },
  card: { width: '100%', maxWidth: 420, padding: spacing.lg },
  icon: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md },
  title: { fontSize: 21, lineHeight: 27 },
  message: { fontSize: 15, lineHeight: 22, marginTop: spacing.sm },
  error: { fontSize: 14, lineHeight: 20, fontWeight: '700', marginTop: spacing.md },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  button: { flex: 1, minHeight: 50, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.sm },
  buttonText: { fontSize: 15, fontWeight: '800', textAlign: 'center' },
});

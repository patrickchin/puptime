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
      <Pressable style={StyleSheet.absoluteFill} onPress={() => { if (!busy) onCancel(); }} />
      <View style={[styles.card, { backgroundColor: theme.surfaceRaised, borderRadius: theme.presentation.cardRadius }]}>
        <Text style={[styles.title, { color: theme.text }]}>{title}</Text>
        <Text style={[styles.message, { color: theme.textMuted }]}>{message}</Text>
        {error ? <Text accessibilityLiveRegion="polite" style={[styles.error, { color: theme.danger }]}>{error}</Text> : null}
        <View style={styles.actions}>
          <Pressable testID="confirm.cancel" accessibilityRole="button" disabled={busy} accessibilityState={{ disabled: busy }} onPress={onCancel} style={({ pressed }) => [styles.button, pressed && { backgroundColor: theme.primarySoft }]}>
            <Text style={[styles.buttonText, { color: theme.primary }]}>{t('app.cancel')}</Text>
          </Pressable>
          <Pressable testID="confirm.delete" accessibilityRole="button" disabled={busy} accessibilityState={{ disabled: busy, busy }} onPress={onConfirm} style={({ pressed }) => [styles.button, { opacity: busy ? 0.45 : 1 }, pressed && { backgroundColor: theme.dangerSoft }]}>
            <Text style={[styles.buttonText, { color: theme.danger }]}>{confirmLabel}</Text>
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
  scrim: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.4)', alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  inline: { zIndex: 1 },
  card: { width: '100%', maxWidth: 360, paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.sm },
  title: { fontSize: 20, lineHeight: 26, fontWeight: '700' },
  message: { fontSize: 15, lineHeight: 22, marginTop: 12 },
  error: { fontSize: 14, lineHeight: 20, fontWeight: '700', marginTop: spacing.md },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 4, marginTop: spacing.md },
  button: { minWidth: 76, minHeight: 48, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, borderRadius: 24 },
  buttonText: { fontSize: 15, fontWeight: '700', textAlign: 'center' },
});

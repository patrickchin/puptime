import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useLocalization } from '../localization-context';
import { type Theme } from '../theme';

export function Toast({
  message,
  onNote,
  onUndo,
  theme,
}: {
  message: string;
  onNote?: () => void;
  onUndo: () => void;
  theme: Theme;
}) {
  const { t } = useLocalization();

  return (
    <View
      testID="toast"
      accessibilityLiveRegion="polite"
      style={[
        styles.toast,
        { backgroundColor: theme.text, borderRadius: theme.presentation.controlRadius },
      ]}
    >
      <Text style={[styles.message, { color: theme.background }]}>{message}</Text>
      {onNote ? (
        <Pressable
          testID="toast.note"
          accessibilityRole="button"
          accessibilityLabel={t('common.addNoteA11y')}
          onPress={onNote}
          style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}
        >
          <Text style={[styles.actionText, { color: theme.primarySoft }]}>{t('common.addNote')}</Text>
        </Pressable>
      ) : null}
      <Pressable
        testID="toast.undo"
        accessibilityRole="button"
        onPress={onUndo}
        style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}
      >
        <Text style={[styles.actionText, { color: theme.primarySoft }]}>{t('common.undo')}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 12,
    zIndex: 20,
    minHeight: 56,
    borderRadius: 18,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000000',
    shadowOpacity: 0.22,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  message: { flex: 1, fontSize: 15, fontWeight: '600' },
  action: { minHeight: 48, paddingLeft: 16, alignItems: 'flex-end', justifyContent: 'center' },
  actionText: { fontSize: 14, fontWeight: '800' },
});

import { StyleSheet, Text, View } from 'react-native';
import { Pressable } from './TelemetryPressable';

import { useLocalization } from '../localization-context';
import { type Theme } from '../theme';

export function Toast({
  message,
  onEdit,
  onUndo,
  theme,
  bottom=12,
}: {
  message: string;
  onEdit?: () => void;
  onUndo: () => void;
  theme: Theme;
  bottom?:number;
}) {
  const { t } = useLocalization();

  return (
    <View
      testID="toast"
      accessibilityLiveRegion="polite"
      style={[
        styles.toast,
        { bottom, backgroundColor: theme.text, borderRadius: theme.presentation.controlRadius },
      ]}
    >
      <Text style={[styles.message, { color: theme.background }]}>{message}</Text>
      {onEdit ? (
        <Pressable
          testID="toast.edit"
          accessibilityRole="button"
          accessibilityLabel={t('common.editLogA11y')}
          onPress={onEdit}
          style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}
        >
          <Text style={[styles.actionText, { color: theme.primarySoft }]}>{t('common.edit')}</Text>
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

import { Pressable, StyleSheet, Text, View } from 'react-native';

import { type Theme } from '../theme';

export function Toast({ message, onUndo, theme }: { message: string; onUndo: () => void; theme: Theme }) {
  return (
    <View accessibilityLiveRegion="polite" style={[styles.toast, { backgroundColor: theme.text }]}>
      <Text style={[styles.message, { color: theme.background }]}>{message}</Text>
      <Pressable
        accessibilityRole="button"
        onPress={onUndo}
        style={({ pressed }) => [styles.undo, pressed && { opacity: 0.6 }]}
      >
        <Text style={[styles.undoText, { color: theme.primarySoft }]}>Undo</Text>
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
  undo: { minWidth: 56, minHeight: 48, alignItems: 'flex-end', justifyContent: 'center' },
  undoText: { fontSize: 15, fontWeight: '800' },
});

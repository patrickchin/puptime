import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { type Theme } from '../theme';

export type Tab = 'log' | 'insights' | 'schedule';

const tabs: { id: Tab; label: string; icon: keyof typeof MaterialCommunityIcons.glyphMap }[] = [
  { id: 'log', label: 'Log', icon: 'format-list-bulleted' },
  { id: 'insights', label: 'Insights', icon: 'chart-bar' },
  { id: 'schedule', label: 'Schedule', icon: 'calendar-clock-outline' },
];

export function BottomNav({ tab, onChange, theme }: { tab: Tab; onChange: (tab: Tab) => void; theme: Theme }) {
  return (
    <View style={[styles.container, { backgroundColor: theme.nav, borderColor: theme.border }]}>
      {tabs.map((item) => {
        const selected = item.id === tab;
        return (
          <Pressable
            key={item.id}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(item.id)}
            style={({ pressed }) => [styles.tab, pressed && { opacity: 0.62 }]}
          >
            <View style={[styles.iconWrap, selected && { backgroundColor: theme.primarySoft }]}>
              <MaterialCommunityIcons
                name={item.icon}
                size={23}
                color={selected ? theme.primary : theme.textMuted}
              />
            </View>
            <Text style={[styles.label, { color: selected ? theme.primary : theme.textMuted }]}>{item.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    minHeight: 72,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    paddingTop: 6,
  },
  tab: {
    flex: 1,
    minHeight: 58,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  iconWrap: {
    minWidth: 52,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
  },
});

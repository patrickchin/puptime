import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useLocalization } from '../localization-context';
import { navigationIcon, type Theme } from '../theme';

export type Tab = 'log' | 'timeline' | 'insights' | 'schedule';

const tabs: Tab[] = ['log', 'timeline', 'insights', 'schedule'];

export function BottomNav({ tab, onChange, theme }: { tab: Tab; onChange: (tab: Tab) => void; theme: Theme }) {
  const { t } = useLocalization();

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: theme.nav,
          borderColor: theme.border,
          borderTopWidth: theme.presentation.borderWidth,
        },
      ]}
    >
      {tabs.map((item) => {
        const selected = item === tab;
        const label = t(`nav.${item}`);
        return (
          <Pressable
            key={item}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={label}
            onPress={() => onChange(item)}
            style={({ pressed }) => [styles.tab, pressed && { opacity: 0.62 }]}
          >
            <View
              style={[
                styles.iconWrap,
                {
                  minWidth: theme.presentation.navIndicatorWidth,
                  borderRadius: theme.presentation.controlRadius,
                },
                selected && { backgroundColor: theme.primarySoft },
              ]}
            >
              <MaterialCommunityIcons
                name={navigationIcon(theme, item) as keyof typeof MaterialCommunityIcons.glyphMap}
                size={23}
                color={selected ? theme.primary : theme.textMuted}
              />
            </View>
            <Text style={[styles.label, { color: selected ? theme.primary : theme.textMuted }]}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    minHeight: 72,
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
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
  },
});

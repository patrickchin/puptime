import { useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';

import type { Theme } from '../theme';

export const wheelRowHeight = 48;
export const wheelHeight = 240;
const wheelPadding = (wheelHeight - wheelRowHeight) / 2;

export function TimeWheelColumn({ values, selected, label, format, onSelect, theme, testID, width }: {
  values: number[];
  selected: number;
  label: string;
  format: (value: number) => string;
  onSelect: (value: number) => void;
  theme: Theme;
  testID: string;
  width: number;
}) {
  const scroll = useRef<ScrollView>(null);
  const selectedIndex = values.indexOf(selected);
  const initialIndex = useRef(selectedIndex);
  const initialScrolled = useRef(false);
  const positioning = useRef(initialIndex.current > 0);

  const choose = (index: number, animated = false) => {
    const nextIndex = Math.max(0, Math.min(values.length - 1, index));
    if (animated) scroll.current?.scrollTo({ y: nextIndex * wheelRowHeight, animated: true });
    if (values[nextIndex] !== selected) onSelect(values[nextIndex]);
  };

  const chooseFromScroll = (offset: number) => {
    const index = Math.max(0, Math.min(values.length - 1, Math.round(offset / wheelRowHeight)));
    if (positioning.current) {
      if (index !== initialIndex.current) return;
      positioning.current = false;
    }
    choose(index);
  };

  return (
    <ScrollView
      ref={scroll}
      testID={testID}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ text: format(selected) }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(event) => choose(selectedIndex + (event.nativeEvent.actionName === 'increment' ? 1 : -1), true)}
      style={[styles.column, { width }]}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      snapToInterval={wheelRowHeight}
      decelerationRate="fast"
      scrollEventThrottle={16}
      onContentSizeChange={() => {
        if (initialScrolled.current) return;
        initialScrolled.current = true;
        scroll.current?.scrollTo({ y: initialIndex.current * wheelRowHeight, animated: false });
      }}
      onScroll={(event) => chooseFromScroll(event.nativeEvent.contentOffset.y)}
      onMomentumScrollEnd={(event) => chooseFromScroll(event.nativeEvent.contentOffset.y)}
    >
      {values.map((value, index) => {
        const distance = Math.abs(index - selectedIndex);
        return (
          <Pressable
            key={value}
            accessible={false}
            testID={`${testID}.${value}`}
            onPress={() => choose(index, true)}
            style={styles.row}
          >
            <Text style={[styles.value, {
              color: distance === 0 ? theme.primary : theme.textMuted,
              opacity: distance > 1 ? 0.55 : 1,
              fontSize: distance === 0 ? 27 : 21,
              fontWeight: distance === 0 ? '700' : '500',
            }]}>{format(value)}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  column: { height: wheelHeight, flexGrow: 0 },
  content: { paddingVertical: wheelPadding },
  row: { height: wheelRowHeight, alignItems: 'center', justifyContent: 'center' },
  value: { fontVariant: ['tabular-nums'] },
});

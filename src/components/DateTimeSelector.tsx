import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useLocalization } from '../localization-context';
import { spacing, type Theme } from '../theme';

const hours = Array.from({ length: 24 }, (_, hour) => hour);
const fiveMinuteMarks = Array.from({ length: 12 }, (_, index) => index * 5);

export function DateTimeSelector({ mode, value, locale, theme, onChange }: {
  mode: 'date' | 'time';
  value: Date;
  locale: string;
  theme: Theme;
  onChange: (date: Date) => void;
}) {
  const { t } = useLocalization();
  const [month, setMonth] = useState(() => new Date(value.getFullYear(), value.getMonth(), 1, 12));
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  const nextMonth = new Date(month.getFullYear(), month.getMonth() + 1, 1, 12);
  const canGoNext = nextMonth <= today;
  const firstWeekday = locale === 'en' ? 0 : 1;
  const offset = (new Date(month.getFullYear(), month.getMonth(), 1).getDay() - firstWeekday + 7) % 7;
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const days = Array.from({ length: Math.ceil((offset + daysInMonth) / 7) * 7 }, (_, index) => index - offset + 1);

  const chooseTime = (hour: number, minute: number) => {
    const next = new Date(value);
    next.setHours(hour, minute, 0, 0);
    onChange(next);
  };

  const option = (label: string, selected: boolean, onPress: () => void, testID: string) => (
    <Pressable
      key={testID}
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      hitSlop={2}
      onPress={onPress}
      style={({ pressed }) => [
        styles.option,
        {
          backgroundColor: selected || pressed ? theme.primarySoft : theme.surface,
          borderColor: selected ? theme.primary : theme.border,
          borderRadius: theme.presentation.controlRadius,
          borderWidth: theme.presentation.borderWidth,
        },
      ]}
    >
      <Text style={[styles.optionText, { color: selected ? theme.primary : theme.text }]}>{label}</Text>
    </Pressable>
  );

  if (mode === 'time') return (
    <View testID="time.selector" style={styles.container}>
      <Text style={[styles.label, { color: theme.textMuted }]}>{t('editor.hour')}</Text>
      <View style={styles.grid}>
        {hours.map((hour) => option(String(hour).padStart(2, '0'), hour === value.getHours(), () => chooseTime(hour, value.getMinutes()), `time.hour.${hour}`))}
      </View>
      <Text style={[styles.label, styles.minuteLabel, { color: theme.textMuted }]}>{t('editor.minute')}</Text>
      <View style={styles.grid}>
        {fiveMinuteMarks.map((minute) => option(String(minute).padStart(2, '0'), minute === value.getMinutes(), () => chooseTime(value.getHours(), minute), `time.minute.${minute}`))}
      </View>
      <View style={[styles.exactMinute, { backgroundColor: theme.surface, borderColor: theme.border, borderRadius: theme.presentation.controlRadius, borderWidth: theme.presentation.borderWidth }]}>
        <Pressable testID="time.minute.previous" accessibilityRole="button" accessibilityLabel={t('editor.previousMinute')} onPress={() => chooseTime(value.getHours(), value.getMinutes() - 1)} style={({ pressed }) => [styles.stepButton, pressed && { backgroundColor: theme.primarySoft }]}>
          <MaterialCommunityIcons name="minus" size={22} color={theme.primary} />
        </Pressable>
        <Text style={[styles.exactValue, { color: theme.text }]}>{String(value.getHours()).padStart(2, '0')}:{String(value.getMinutes()).padStart(2, '0')}</Text>
        <Pressable testID="time.minute.next" accessibilityRole="button" accessibilityLabel={t('editor.nextMinute')} onPress={() => chooseTime(value.getHours(), value.getMinutes() + 1)} style={({ pressed }) => [styles.stepButton, pressed && { backgroundColor: theme.primarySoft }]}>
          <MaterialCommunityIcons name="plus" size={22} color={theme.primary} />
        </Pressable>
      </View>
    </View>
  );

  return (
    <View testID="date.selector" style={styles.container}>
      <View style={styles.monthHeader}>
        <Pressable testID="date.previousMonth" accessibilityRole="button" accessibilityLabel={t('editor.previousMonth')} onPress={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1, 12))} style={({ pressed }) => [styles.monthButton, pressed && { backgroundColor: theme.primarySoft }]}>
          <MaterialCommunityIcons name="chevron-left" size={25} color={theme.primary} />
        </Pressable>
        <Text style={[styles.monthTitle, { color: theme.text }]}>{new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(month)}</Text>
        <Pressable testID="date.nextMonth" accessibilityRole="button" accessibilityLabel={t('editor.nextMonth')} accessibilityState={{ disabled: !canGoNext }} disabled={!canGoNext} onPress={() => setMonth(nextMonth)} style={({ pressed }) => [styles.monthButton, pressed && { backgroundColor: theme.primarySoft }, !canGoNext && { opacity: 0.35 }]}>
          <MaterialCommunityIcons name="chevron-right" size={25} color={theme.primary} />
        </Pressable>
      </View>
      <View style={styles.grid}>
        {Array.from({ length: 7 }, (_, index) => {
          const weekday = new Date(2023, 0, 1 + firstWeekday + index);
          return <Text key={index} style={[styles.weekday, { color: theme.textMuted }]}>{new Intl.DateTimeFormat(locale, { weekday: 'narrow' }).format(weekday)}</Text>;
        })}
        {days.map((day, index) => {
          if (day < 1 || day > daysInMonth) return <View key={`empty.${index}`} style={styles.dayCell} />;
          const date = new Date(month.getFullYear(), month.getMonth(), day, 12);
          const selected = day === value.getDate() && month.getMonth() === value.getMonth() && month.getFullYear() === value.getFullYear();
          const disabled = date > today;
          return (
            <View key={day} style={styles.dayCell}>
              <Pressable
                testID={`date.day.${day}`}
                accessibilityRole="button"
                accessibilityLabel={new Intl.DateTimeFormat(locale, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(date)}
                accessibilityState={{ selected, disabled }}
                hitSlop={3}
                disabled={disabled}
                onPress={() => onChange(new Date(date.getFullYear(), date.getMonth(), date.getDate(), value.getHours(), value.getMinutes(), value.getSeconds(), value.getMilliseconds()))}
                style={({ pressed }) => [styles.dayButton, { backgroundColor: selected ? theme.primary : pressed ? theme.primarySoft : 'transparent', borderRadius: theme.presentation.controlRadius, opacity: disabled ? 0.35 : 1 }]}
              >
                <Text style={[styles.dayText, { color: selected ? theme.onPrimary : theme.text }]}>{day}</Text>
              </Pressable>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginTop: spacing.md },
  label: { fontSize: 11, fontWeight: '800', letterSpacing: 1.2, marginBottom: 8 },
  minuteLabel: { marginTop: spacing.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  option: { width: '14.5%', minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  optionText: { fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },
  exactMinute: { minHeight: 56, marginTop: spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  exactValue: { fontSize: 22, fontWeight: '800', fontVariant: ['tabular-nums'] },
  stepButton: { width: 52, minHeight: 54, alignItems: 'center', justifyContent: 'center' },
  monthHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  monthButton: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  monthTitle: { fontSize: 17, fontWeight: '800' },
  weekday: { width: '12.5%', textAlign: 'center', fontSize: 12, fontWeight: '700', paddingVertical: 8 },
  dayCell: { width: '12.5%', minHeight: 46, alignItems: 'center', justifyContent: 'center' },
  dayButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  dayText: { fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] },
});

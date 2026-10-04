import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { useLocalization } from '../localization-context';
import { spacing, type Theme } from '../theme';

const dialSize = 256;
const center = dialSize / 2;
const outerRadius = 100;
const innerRadius = 58;
const twoDigits = (value: number) => String(value).padStart(2, '0');

export function DateTimeSelector({ mode, value, locale, theme, onChange, onCancel }: {
  mode: 'date' | 'time';
  value: Date;
  locale: string;
  theme: Theme;
  onChange: (date: Date) => void;
  onCancel: () => void;
}) {
  const { t } = useLocalization();
  const [selected, setSelected] = useState(value);
  const [month, setMonth] = useState(() => new Date(value.getFullYear(), value.getMonth(), 1, 12));
  const [clockField, setClockField] = useState<'hour' | 'minute'>('hour');
  const [inputMode, setInputMode] = useState(false);
  const [hourInput, setHourInput] = useState(twoDigits(value.getHours()));
  const [minuteInput, setMinuteInput] = useState(twoDigits(value.getMinutes()));
  const uses24Hour = new Intl.DateTimeFormat(locale, { hour: 'numeric' }).resolvedOptions().hour12 === false;
  const hour = selected.getHours();
  const minute = selected.getMinutes();
  const displayHour = uses24Hour ? hour : hour % 12 || 12;
  const validInput = /^\d{1,2}$/.test(hourInput) && /^\d{1,2}$/.test(minuteInput)
    && Number(hourInput) <= 23 && Number(minuteInput) <= 59;

  const selectTime = (nextHour: number, nextMinute: number) => {
    const next = new Date(selected);
    next.setHours(nextHour, nextMinute, 0, 0);
    setSelected(next);
    setHourInput(twoDigits(next.getHours()));
    setMinuteInput(twoDigits(next.getMinutes()));
  };

  const confirm = () => {
    if (inputMode && !validInput) return;
    if (inputMode) {
      const next = new Date(selected);
      next.setHours(Number(hourInput), Number(minuteInput), 0, 0);
      onChange(next);
    } else {
      onChange(selected);
    }
  };

  const today = new Date();
  today.setHours(23, 59, 59, 999);
  const nextMonth = new Date(month.getFullYear(), month.getMonth() + 1, 1, 12);
  const canGoNext = nextMonth <= today;
  const firstWeekday = locale === 'en' ? 0 : 1;
  const offset = (new Date(month.getFullYear(), month.getMonth(), 1).getDay() - firstWeekday + 7) % 7;
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const days = Array.from({ length: Math.ceil((offset + daysInMonth) / 7) * 7 }, (_, index) => index - offset + 1);

  const dialValues = clockField === 'minute'
    ? Array.from({ length: 12 }, (_, index) => ({ value: index * 5, label: twoDigits(index * 5), radius: outerRadius }))
    : uses24Hour
      ? [
        ...Array.from({ length: 12 }, (_, index) => ({ value: index || 12, label: twoDigits(index || 12), radius: outerRadius })),
        ...Array.from({ length: 12 }, (_, index) => ({ value: index ? index + 12 : 0, label: twoDigits(index ? index + 12 : 0), radius: innerRadius })),
      ]
      : Array.from({ length: 12 }, (_, index) => ({ value: index || 12, label: String(index || 12), radius: outerRadius }));
  const selectedValue = clockField === 'minute' ? minute : uses24Hour ? hour : displayHour;
  const selectedRadius = clockField === 'hour' && uses24Hour && (hour === 0 || hour >= 13) ? innerRadius : outerRadius;
  const selectedAngle = ((clockField === 'minute' ? minute / 5 : displayHour % 12) / 12) * Math.PI * 2 - Math.PI / 2;
  const handX = Math.cos(selectedAngle) * selectedRadius;
  const handY = Math.sin(selectedAngle) * selectedRadius;

  return (
    <View testID={mode === 'date' ? 'date.selector' : 'time.selector'} accessibilityViewIsModal style={styles.overlay}>
      <Pressable style={StyleSheet.absoluteFill} accessibilityLabel={t('app.cancel')} onPress={onCancel} />
      <View style={[styles.card, { backgroundColor: theme.surfaceRaised, borderRadius: theme.presentation.cardRadius }]}>
        <Text style={[styles.eyebrow, { color: theme.textMuted }]}>{t(mode === 'date' ? 'editor.date' : 'editor.time').toLocaleUpperCase(locale)}</Text>

        {mode === 'date' ? (
          <>
            <Text style={[styles.dateHeadline, { color: theme.text }]}>
              {new Intl.DateTimeFormat(locale, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).format(selected)}
            </Text>
            <View style={[styles.divider, { backgroundColor: theme.border }]} />
            <View style={styles.monthHeader}>
              <Text style={[styles.monthTitle, { color: theme.text }]}>{new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(month)}</Text>
              <View style={styles.monthActions}>
                <Pressable testID="date.previousMonth" accessibilityRole="button" accessibilityLabel={t('editor.previousMonth')} onPress={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1, 12))} style={({ pressed }) => [styles.iconButton, pressed && { backgroundColor: theme.primarySoft }]}>
                  <MaterialCommunityIcons name="chevron-left" size={24} color={theme.text} />
                </Pressable>
                <Pressable testID="date.nextMonth" accessibilityRole="button" accessibilityLabel={t('editor.nextMonth')} accessibilityState={{ disabled: !canGoNext }} disabled={!canGoNext} onPress={() => setMonth(nextMonth)} style={({ pressed }) => [styles.iconButton, pressed && { backgroundColor: theme.primarySoft }, !canGoNext && { opacity: 0.3 }]}>
                  <MaterialCommunityIcons name="chevron-right" size={24} color={theme.text} />
                </Pressable>
              </View>
            </View>
            <View style={styles.calendar}>
              {Array.from({ length: 7 }, (_, index) => {
                const weekday = new Date(2023, 0, 1 + firstWeekday + index);
                return <Text key={index} style={[styles.weekday, { color: theme.textMuted }]}>{new Intl.DateTimeFormat(locale, { weekday: 'narrow' }).format(weekday)}</Text>;
              })}
              {days.map((day, index) => {
                if (day < 1 || day > daysInMonth) return <View key={`empty.${index}`} style={styles.dayCell} />;
                const date = new Date(month.getFullYear(), month.getMonth(), day, 12);
                const active = day === selected.getDate() && month.getMonth() === selected.getMonth() && month.getFullYear() === selected.getFullYear();
                const disabled = date > today;
                return (
                  <View key={day} style={styles.dayCell}>
                    <Pressable
                      testID={`date.day.${day}`}
                      accessibilityRole="button"
                      accessibilityLabel={new Intl.DateTimeFormat(locale, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(date)}
                      accessibilityState={{ selected: active, disabled }}
                      disabled={disabled}
                      onPress={() => setSelected(new Date(date.getFullYear(), date.getMonth(), day, selected.getHours(), selected.getMinutes(), selected.getSeconds(), selected.getMilliseconds()))}
                      style={({ pressed }) => [styles.dayButton, { backgroundColor: active ? theme.primary : pressed ? theme.primarySoft : 'transparent', opacity: disabled ? 0.3 : 1 }]}
                    >
                      <Text style={[styles.dayText, { color: active ? theme.onPrimary : theme.text }]}>{day}</Text>
                    </Pressable>
                  </View>
                );
              })}
            </View>
          </>
        ) : (
          <>
            {!inputMode ? <View style={styles.clockHeader}>
              <Pressable testID="time.field.hour" accessibilityRole="button" accessibilityState={{ selected: clockField === 'hour' }} onPress={() => setClockField('hour')} style={[styles.timeField, { backgroundColor: clockField === 'hour' ? theme.primarySoft : theme.surface }]}>
                <Text style={[styles.timeDigits, { color: clockField === 'hour' ? theme.primary : theme.text }]}>{twoDigits(displayHour)}</Text>
              </Pressable>
              <Text style={[styles.colon, { color: theme.text }]}>{':'}</Text>
              <Pressable testID="time.field.minute" accessibilityRole="button" accessibilityState={{ selected: clockField === 'minute' }} onPress={() => setClockField('minute')} style={[styles.timeField, { backgroundColor: clockField === 'minute' ? theme.primarySoft : theme.surface }]}>
                <Text style={[styles.timeDigits, { color: clockField === 'minute' ? theme.primary : theme.text }]}>{twoDigits(minute)}</Text>
              </Pressable>
              {!uses24Hour ? (
                <View style={[styles.period, { borderColor: theme.border }]}>
                  {(['AM', 'PM'] as const).map((period) => {
                    const active = (hour < 12 ? 'AM' : 'PM') === period;
                    return <Pressable key={period} testID={`time.period.${period}`} accessibilityRole="button" accessibilityState={{ selected: active }} onPress={() => selectTime((hour % 12) + (period === 'PM' ? 12 : 0), minute)} style={[styles.periodButton, { backgroundColor: active ? theme.primarySoft : 'transparent' }]}><Text style={[styles.periodText, { color: active ? theme.primary : theme.textMuted }]}>{period}</Text></Pressable>;
                  })}
                </View>
              ) : null}
            </View> : null}
            {inputMode ? (
              <View style={styles.inputRow}>
                <View style={styles.inputColumn}>
                  <Text style={[styles.inputLabel, { color: theme.textMuted }]}>{t('editor.hour')}</Text>
                  <TextInput testID="time.input.hour" accessibilityLabel={t('editor.hour')} keyboardType="number-pad" maxLength={2} selectTextOnFocus value={hourInput} onChangeText={setHourInput} style={[styles.timeInput, { backgroundColor: theme.surface, borderColor: validInput ? theme.border : theme.danger, color: theme.text }]} />
                </View>
                <Text style={[styles.inputColon, { color: theme.text }]}>{':'}</Text>
                <View style={styles.inputColumn}>
                  <Text style={[styles.inputLabel, { color: theme.textMuted }]}>{t('editor.minute')}</Text>
                  <TextInput testID="time.input.minute" accessibilityLabel={t('editor.minute')} keyboardType="number-pad" maxLength={2} selectTextOnFocus value={minuteInput} onChangeText={setMinuteInput} style={[styles.timeInput, { backgroundColor: theme.surface, borderColor: validInput ? theme.border : theme.danger, color: theme.text }]} />
                </View>
              </View>
            ) : (
              <View style={[styles.dial, { backgroundColor: theme.surface }]}>
                <View style={[styles.hand, { width: selectedRadius, left: center + handX / 2 - selectedRadius / 2, top: center + handY / 2 - 1, backgroundColor: theme.primary, transform: [{ rotate: `${selectedAngle}rad` }] }]} />
                <View style={[styles.centerDot, { backgroundColor: theme.primary }]} />
                {dialValues.map(({ value: dialValue, label, radius }) => {
                  const angle = (dialValue % (clockField === 'minute' ? 60 : 12)) / (clockField === 'minute' ? 60 : 12) * Math.PI * 2 - Math.PI / 2;
                  const active = selectedValue === dialValue;
                  return (
                    <Pressable
                      key={`${radius}.${dialValue}`}
                      testID={`time.${clockField}.${dialValue}`}
                      accessibilityRole="button"
                      accessibilityLabel={label}
                      accessibilityState={{ selected: active }}
                      onPress={() => {
                        if (clockField === 'hour') {
                          selectTime(uses24Hour ? dialValue : (dialValue % 12) + (hour >= 12 ? 12 : 0), minute);
                          setClockField('minute');
                        } else selectTime(hour, dialValue);
                      }}
                      style={({ pressed }) => [styles.dialNumber, { left: center + Math.cos(angle) * radius - 22, top: center + Math.sin(angle) * radius - 22, backgroundColor: active ? theme.primary : pressed ? theme.primarySoft : 'transparent' }]}
                    >
                      <Text style={[styles.dialText, { color: active ? theme.onPrimary : theme.text, fontSize: radius === innerRadius ? 13 : 16 }]}>{label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            )}
          </>
        )}

        <View style={styles.footer}>
          {mode === 'time' ? <Pressable testID="time.mode" accessibilityRole="button" accessibilityLabel={inputMode ? t('editor.useDial') : t('editor.useKeyboard')} onPress={() => setInputMode((current) => !current)} style={({ pressed }) => [styles.iconButton, pressed && { backgroundColor: theme.primarySoft }]}><MaterialCommunityIcons name={inputMode ? 'clock-outline' : 'keyboard-outline'} size={23} color={theme.primary} /></Pressable> : null}
          <View style={styles.footerSpacer} />
          <Pressable testID="picker.cancel" accessibilityRole="button" onPress={onCancel} style={({ pressed }) => [styles.action, pressed && { backgroundColor: theme.primarySoft }]}><Text style={[styles.actionText, { color: theme.primary }]}>{t('app.cancel')}</Text></Pressable>
          <Pressable testID="picker.done" accessibilityRole="button" disabled={inputMode && !validInput} accessibilityState={{ disabled: inputMode && !validInput }} onPress={confirm} style={({ pressed }) => [styles.action, pressed && { backgroundColor: theme.primarySoft }, inputMode && !validInput && { opacity: 0.4 }]}><Text style={[styles.actionText, { color: theme.primary }]}>{t('common.done')}</Text></Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFill, zIndex: 10, backgroundColor: 'rgba(0, 0, 0, 0.36)', alignItems: 'center', justifyContent: 'center', padding: spacing.md },
  card: { width: '100%', maxWidth: 360, paddingHorizontal: 20, paddingTop: 24, paddingBottom: 12 },
  eyebrow: { fontSize: 12, fontWeight: '700', letterSpacing: 1 },
  dateHeadline: { fontSize: 27, lineHeight: 34, fontWeight: '700', marginTop: 8, marginBottom: 20 },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: -20 },
  monthHeader: { minHeight: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  monthTitle: { fontSize: 16, fontWeight: '700', flexShrink: 1 },
  monthActions: { flexDirection: 'row' },
  iconButton: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 24 },
  calendar: { flexDirection: 'row', flexWrap: 'wrap' },
  weekday: { width: '14.2857%', height: 38, textAlign: 'center', textAlignVertical: 'center', fontSize: 12, fontWeight: '600' },
  dayCell: { width: '14.2857%', height: 42, alignItems: 'center', justifyContent: 'center' },
  dayButton: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  dayText: { fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'] },
  clockHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 18, marginBottom: 20 },
  timeField: { width: 82, height: 76, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  timeDigits: { fontSize: 43, fontWeight: '500', fontVariant: ['tabular-nums'] },
  colon: { fontSize: 40, marginHorizontal: 4, paddingBottom: 7 },
  period: { height: 76, width: 50, borderWidth: 1, borderRadius: 14, marginLeft: 8, overflow: 'hidden' },
  periodButton: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  periodText: { fontSize: 12, fontWeight: '700' },
  dial: { width: dialSize, height: dialSize, borderRadius: dialSize / 2, alignSelf: 'center' },
  hand: { position: 'absolute', height: 2 },
  centerDot: { position: 'absolute', left: center - 4, top: center - 4, width: 8, height: 8, borderRadius: 4 },
  dialNumber: { position: 'absolute', width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  dialText: { fontWeight: '600', fontVariant: ['tabular-nums'] },
  inputRow: { minHeight: 158, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 12 },
  inputColumn: { alignItems: 'center', gap: 8 },
  inputLabel: { fontSize: 12, fontWeight: '700' },
  timeInput: { width: 84, height: 70, borderWidth: 1, borderRadius: 14, textAlign: 'center', fontSize: 36, fontVariant: ['tabular-nums'] },
  inputColon: { fontSize: 36, marginTop: 18 },
  footer: { minHeight: 60, flexDirection: 'row', alignItems: 'center', marginTop: 12 },
  footerSpacer: { flex: 1 },
  action: { minWidth: 72, minHeight: 48, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', borderRadius: 24 },
  actionText: { fontSize: 15, fontWeight: '700' },
});

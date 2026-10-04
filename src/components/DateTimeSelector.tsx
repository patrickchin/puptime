import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { useLocalization } from '../localization-context';
import { spacing, type Theme } from '../theme';
import { TimeWheelColumn, wheelHeight, wheelRowHeight } from './TimeWheelColumn';

const twoDigits = (value: number) => String(value).padStart(2, '0');
const twelveHours = Array.from({ length: 12 }, (_, index) => index + 1);
const twentyFourHours = Array.from({ length: 24 }, (_, index) => index);
const minutes = Array.from({ length: 60 }, (_, index) => index);
const periods = [0, 1];

export function DateTimeSelector({ mode, value, locale, theme, onChange, onCancel }: {
  mode: 'date' | 'time';
  value: Date;
  locale: string;
  theme: Theme;
  onChange: (date: Date) => void;
  onCancel: () => void;
}) {
  const { t } = useLocalization();
  const uses24Hour = new Intl.DateTimeFormat(locale, { hour: 'numeric' }).resolvedOptions().hour12 === false;
  const [selected, setSelected] = useState(value);
  const selectedRef = useRef(value);
  const [month, setMonth] = useState(() => new Date(value.getFullYear(), value.getMonth(), 1, 12));
  const [inputMode, setInputMode] = useState(false);
  const [hourInput, setHourInput] = useState(twoDigits(uses24Hour ? value.getHours() : value.getHours() % 12 || 12));
  const [minuteInput, setMinuteInput] = useState(twoDigits(value.getMinutes()));
  const [periodInput, setPeriodInput] = useState<'AM' | 'PM'>(value.getHours() < 12 ? 'AM' : 'PM');
  const hour = selected.getHours();
  const minute = selected.getMinutes();
  const displayHour = uses24Hour ? hour : hour % 12 || 12;
  const validInput = /^\d{1,2}$/.test(hourInput) && /^\d{1,2}$/.test(minuteInput)
    && (uses24Hour ? Number(hourInput) <= 23 : Number(hourInput) >= 1 && Number(hourInput) <= 12)
    && Number(minuteInput) <= 59;
  const inputHour = uses24Hour ? Number(hourInput) : (Number(hourInput) % 12) + (periodInput === 'PM' ? 12 : 0);

  const selectTime = (nextHour?: number, nextMinute?: number) => {
    const next = new Date(selectedRef.current);
    next.setHours(nextHour ?? next.getHours(), nextMinute ?? next.getMinutes(), 0, 0);
    selectedRef.current = next;
    setSelected(next);
    setHourInput(twoDigits(uses24Hour ? next.getHours() : next.getHours() % 12 || 12));
    setMinuteInput(twoDigits(next.getMinutes()));
    setPeriodInput(next.getHours() < 12 ? 'AM' : 'PM');
  };

  const confirm = () => {
    if (inputMode && !validInput) return;
    if (inputMode) {
      const next = new Date(selected);
      next.setHours(inputHour, Number(minuteInput), 0, 0);
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
            <Text style={[styles.timeHeadline, { color: theme.text }]}>
              {inputMode ? t('editor.enterTime') : new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(selected)}
            </Text>
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
                {!uses24Hour ? <View style={[styles.inputPeriod, { borderColor: theme.border }]}>
                  {(['AM', 'PM'] as const).map((period) => <Pressable key={period} testID={`time.input.period.${period}`} accessibilityRole="button" accessibilityState={{ selected: periodInput === period }} onPress={() => setPeriodInput(period)} style={[styles.inputPeriodButton, { backgroundColor: periodInput === period ? theme.primarySoft : 'transparent' }]}><Text style={[styles.inputPeriodText, { color: periodInput === period ? theme.primary : theme.textMuted }]}>{period}</Text></Pressable>)}
                </View> : null}
              </View>
            ) : (
              <>
                <View style={styles.wheels}>
                  <View pointerEvents="none" style={[styles.wheelHighlight, { backgroundColor: theme.primarySoft }]} />
                  <TimeWheelColumn testID="time.wheel.hour" label={t('editor.hour')} values={uses24Hour ? twentyFourHours : twelveHours} selected={uses24Hour ? hour : displayHour} format={twoDigits} onSelect={(nextHour) => selectTime(uses24Hour ? nextHour : (nextHour % 12) + (hour >= 12 ? 12 : 0))} theme={theme} width={80} />
                  <Text style={[styles.wheelColon, { color: theme.text }]}>{':'}</Text>
                  <TimeWheelColumn testID="time.wheel.minute" label={t('editor.minute')} values={minutes} selected={minute} format={twoDigits} onSelect={(nextMinute) => selectTime(undefined, nextMinute)} theme={theme} width={80} />
                  {!uses24Hour ? <TimeWheelColumn testID="time.wheel.period" label={t('editor.period')} values={periods} selected={hour >= 12 ? 1 : 0} format={(period) => period ? 'PM' : 'AM'} onSelect={(period) => selectTime((hour % 12) + period * 12)} theme={theme} width={64} /> : null}
                </View>
                <Text style={[styles.wheelHint, { color: theme.textMuted }]}>{t('editor.swipeTime')}</Text>
              </>
            )}
          </>
        )}

        <View style={styles.footer}>
          {mode === 'time' ? <Pressable testID="time.mode" accessibilityRole="button" accessibilityLabel={inputMode ? t('editor.useWheels') : t('editor.useKeyboard')} onPress={() => {
            if (inputMode && validInput) selectTime(inputHour, Number(minuteInput));
            else if (inputMode) {
              setHourInput(twoDigits(uses24Hour ? selectedRef.current.getHours() : selectedRef.current.getHours() % 12 || 12));
              setMinuteInput(twoDigits(selectedRef.current.getMinutes()));
              setPeriodInput(selectedRef.current.getHours() < 12 ? 'AM' : 'PM');
            }
            setInputMode(!inputMode);
          }} style={({ pressed }) => [styles.iconButton, pressed && { backgroundColor: theme.primarySoft }]}><MaterialCommunityIcons name={inputMode ? 'swap-vertical' : 'keyboard-outline'} size={23} color={theme.primary} /></Pressable> : null}
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
  timeHeadline: { fontSize: 27, lineHeight: 34, fontWeight: '700', marginTop: 6 },
  wheels: { height: wheelHeight, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  wheelHighlight: { position: 'absolute', left: 0, right: 0, top: (wheelHeight - wheelRowHeight) / 2, height: wheelRowHeight, borderRadius: 14 },
  wheelColon: { width: 18, height: wheelRowHeight, lineHeight: wheelRowHeight, textAlign: 'center', fontSize: 28, fontWeight: '700' },
  wheelHint: { fontSize: 12, textAlign: 'center', marginTop: 4 },
  inputRow: { minHeight: 158, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 12 },
  inputColumn: { alignItems: 'center', gap: 8 },
  inputLabel: { fontSize: 12, fontWeight: '700' },
  timeInput: { width: 84, height: 70, borderWidth: 1, borderRadius: 14, textAlign: 'center', fontSize: 36, fontVariant: ['tabular-nums'] },
  inputColon: { fontSize: 36, marginTop: 18 },
  inputPeriod: { width: 50, height: 70, borderWidth: 1, borderRadius: 14, marginTop: 20, overflow: 'hidden' },
  inputPeriodButton: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  inputPeriodText: { fontSize: 12, fontWeight: '700' },
  footer: { minHeight: 60, flexDirection: 'row', alignItems: 'center', marginTop: 12 },
  footerSpacer: { flex: 1 },
  action: { minWidth: 72, minHeight: 48, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', borderRadius: 24 },
  actionText: { fontSize: 15, fontWeight: '700' },
});

import { MaterialCommunityIcons } from '@expo/vector-icons';
import { memo, useEffect, useMemo, useState } from 'react';
import { FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { dateKey, formatDuration, isOpenNap, type PuppyEvent } from '../domain';
import { useLocalization } from '../localization-context';
import { headingStyle, type Theme } from '../theme';
import { timelineDayEvents, timelineDetailTime, timelineFormatters } from '../timeline-format';
import { ActivityIcon } from './ActivityIcon';

const DayMoment = memo(function DayMoment({ event, index, last, day, now, theme }: {
  event: PuppyEvent; index: number; last: boolean; day: number; now: number; theme: Theme;
}) {
  const { activityColors, eventPastLabel, language, t } = useLocalization();
  const colors = activityColors(theme, event);
  const trail = theme.presentation.iconProfile === 'day-trails';
  const nap = event.type === 'nap' && event.endedAt !== undefined;
  const running = isOpenNap(event);
  return (
    <View testID={`timeline.day.event.${event.id}`} style={[styles.moment, trail && { marginLeft: index % 2 ? 32 : 0, marginRight: index % 2 ? 0 : 32 }]}>
      {!last ? <View pointerEvents="none" style={[styles.thread, { borderColor: theme.border }, trail && styles.trailThread]} /> : null}
      <View style={[styles.stop, { backgroundColor: colors.softColor, borderRadius: theme.presentation.iconRadius }]}>
        <ActivityIcon activity={event} theme={theme} color={colors.color} size={28} />
      </View>
      <View style={[styles.card, { backgroundColor: trail ? 'transparent' : colors.softColor, borderRadius: theme.presentation.cardRadius - 4 }]}>
        <Text style={[styles.time, { color: theme.textMuted }]}>{timelineDetailTime(event.at, language, day)}{nap ? ` – ${running ? t('eventRow.now') : timelineDetailTime(event.endedAt as number, language, day)}` : ''}</Text>
        <Text style={[styles.label, headingStyle(theme), { color: theme.text }]}>{eventPastLabel(event)}</Text>
        {nap ? <Text style={[styles.duration, { color: theme.textMuted }]}>{formatDuration((event.endedAt ?? now) - event.at)}{running ? ` · ${t('eventRow.running')}` : ''}</Text> : null}
        {event.estimated ? <Text style={[styles.duration, { color: theme.text }]}>{t('eventRow.estimated')}</Text> : null}
        {event.note?.trim() ? <Text style={[styles.note, { color: theme.text }]}>{event.note.trim()}</Text> : null}
      </View>
      {trail ? <MaterialCommunityIcons accessible={false} importantForAccessibility="no" name="leaf" size={18} color={theme.border} style={styles.leaf} /> : null}
    </View>
  );
});

export function DayTimeline({ events, theme }: { events: PuppyEvent[]; theme: Theme }) {
  const { language, t } = useLocalization();
  const [day, setDay] = useState(() => new Date().setHours(0, 0, 0, 0));
  const [now, setNow] = useState(Date.now);
  // Only a running nap needs a ticking duration; completed moments keep stable props.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const moments = useMemo(() => timelineDayEvents(events, day, now), [events, day, now]);
  const today = dateKey(new Date(day)) === dateKey(new Date(now));
  const trail = theme.presentation.iconProfile === 'day-trails';
  const changeDay = (offset: number) => {
    const next = new Date(day);
    next.setDate(next.getDate() + offset);
    setDay(next.getTime());
  };
  return (
    <FlatList
      key={day}
      testID="timeline.day"
      data={moments}
      keyExtractor={(event) => event.id}
      contentContainerStyle={styles.content}
      ListHeaderComponent={
        <>
          <View style={styles.dateRow}>
            <Pressable testID="timeline.day.previous" accessibilityRole="button" accessibilityLabel={t('timeline.previousDay')} onPress={() => changeDay(-1)} style={({ pressed }) => [styles.dateButton, { backgroundColor: pressed ? theme.primarySoft : theme.surfaceRaised }]}>
              <MaterialCommunityIcons name="chevron-left" size={26} color={theme.primary} />
            </Pressable>
            <View style={styles.dateCopy}>
              <Text style={[styles.date, headingStyle(theme), { color: theme.text }]}>{today ? t('log.today') : timelineFormatters(language).weekday.format(day)}</Text>
              <Text style={[styles.dateDetail, { color: theme.textMuted }]}>{timelineFormatters(language).rangeDate.format(day)}</Text>
            </View>
            <Pressable testID="timeline.day.next" accessibilityRole="button" accessibilityLabel={t('timeline.nextDay')} accessibilityState={{ disabled: today }} disabled={today} onPress={() => changeDay(1)} style={({ pressed }) => [styles.dateButton, { backgroundColor: pressed ? theme.primarySoft : theme.surfaceRaised, opacity: today ? 0.35 : 1 }]}>
              <MaterialCommunityIcons name="chevron-right" size={26} color={theme.primary} />
            </Pressable>
          </View>
          <View style={styles.dayHeading}>
            <Text style={[styles.dayTitle, headingStyle(theme), { color: theme.text }]}>{t(trail ? 'theme.day-trails.greeting' : 'theme.puppy-journal.greeting')}</Text>
            <Image source={require('../../assets/puppy-journal.png')} accessible={false} style={styles.puppy} resizeMode="contain" />
          </View>
        </>
      }
      renderItem={({ item, index }) => <DayMoment event={item} index={index} last={index === moments.length - 1} day={day} now={isOpenNap(item) ? now : 0} theme={theme} />}
      ListEmptyComponent={<Text style={[styles.empty, { color: theme.textMuted }]}>{t('timeline.dayEmpty')}</Text>}
    />
  );
}

const styles = StyleSheet.create({
  content: { width: '100%', maxWidth: 720, alignSelf: 'center', padding: 16, paddingBottom: 32 },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 18 },
  dateButton: { width: 48, height: 48, borderRadius: 24, justifyContent: 'center', alignItems: 'center' },
  dateCopy: { flex: 1, alignItems: 'center' },
  date: { fontSize: 24, lineHeight: 32 },
  dateDetail: { fontSize: 13, lineHeight: 20 },
  dayHeading: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 20 },
  dayTitle: { flex: 1, fontSize: 24, lineHeight: 32 },
  puppy: { width: 76, height: 60 },
  moment: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingBottom: 18, minHeight: 110 },
  stop: { width: 52, height: 52, alignItems: 'center', justifyContent: 'center', zIndex: 1 },
  thread: { position: 'absolute', left: 25, top: 50, bottom: 0, borderLeftWidth: 2, borderStyle: 'dashed' },
  trailThread: { left: 22, width: 30, borderBottomLeftRadius: 28, transform: [{ rotate: '-14deg' }] },
  card: { flex: 1, minWidth: 0, padding: 14, gap: 3 },
  time: { fontSize: 13, lineHeight: 20 },
  label: { fontSize: 24, lineHeight: 30 },
  duration: { fontSize: 13, lineHeight: 20 },
  note: { fontSize: 15, lineHeight: 22, marginTop: 4 },
  leaf: { position: 'absolute', right: 0, bottom: 4 },
  empty: { paddingVertical: 32, textAlign: 'center', fontSize: 16 },
});

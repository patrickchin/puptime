import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import {
  ActivityIndicator,
  Animated,
  FlatList,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import {
  buildTimelineDays,
  TIMELINE_BUCKET_MINUTES,
  TIMELINE_BUCKETS,
  timelineDurationRuns,
  timelinePointClusters,
  type TimelineDay,
  type TimelineMark,
} from '../analytics';
import { dateKey, EVENT_META, eventTypes, type EventType, type PuppyEvent } from '../domain';
import { useLocalization } from '../localization-context';
import { localizedEventLabel, translate, type AppLanguage } from '../localization';
import { eventIcon, spacing, type Theme } from '../theme';

const INITIAL_DAYS = 14;
const LOAD_DAYS = 14;
const DATE_COLUMN_WIDTH = 72;
const LOAD_ROW_HEIGHT = 48;
const MIN_TIME_SCALE = 1;
const MAX_TIME_SCALE = 4;
const ZOOM_STEP = 0.5;
const activityFilters = ['all', ...eventTypes] as const;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function formatBucket(bucket: number, language: AppLanguage): string {
  return new Intl.DateTimeFormat(language, { hour: 'numeric', minute: '2-digit' })
    .format(new Date(2000, 0, 1, 0, bucket * TIMELINE_BUCKET_MINUTES));
}

function describeMark(mark: TimelineMark, language: AppLanguage): string {
  const activity = localizedEventLabel(language, mark.type);
  return mark.endBucket === undefined
    ? translate(language, 'insights.pointWindow', {
      activity,
      start: formatBucket(mark.startBucket, language),
      end: formatBucket(mark.startBucket + 1, language),
    })
    : translate(language, 'insights.durationWindow', {
      activity,
      start: formatBucket(mark.startBucket, language),
      end: formatBucket(mark.endBucket, language),
    });
}

function filterName(types: readonly EventType[], language: AppLanguage): string {
  if (types.length === eventTypes.length) return translate(language, 'insights.activity');
  if (types.length === 1) return localizedEventLabel(language, types[0]).toLocaleLowerCase(language);
  return translate(language, 'insights.selectedActivity');
}

function calendarDayDistance(older: Date, newer: Date): number {
  const utc = (date: Date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.max(0, Math.round((utc(newer) - utc(older)) / 86_400_000));
}

function formatHour(hour: number, language: AppLanguage): string {
  return new Intl.DateTimeFormat(language, { hour: 'numeric' })
    .format(new Date(2000, 0, 1, hour % 24));
}

function formatDateRange(start: Date, end: Date, language: AppLanguage): string {
  const shortDate = new Intl.DateTimeFormat(language, { month: 'short', day: 'numeric' });
  const rangeDate = new Intl.DateTimeFormat(language, { month: 'short', day: 'numeric', year: 'numeric' });
  return start.getFullYear() === end.getFullYear()
    ? `${shortDate.format(start)} – ${rangeDate.format(end)}`
    : `${rangeDate.format(start)} – ${rangeDate.format(end)}`;
}

function eventColor(type: EventType, theme: Theme): string {
  return theme.isDark ? EVENT_META[type].darkColor : EVENT_META[type].color;
}

function horizontalTouchDistance(touches: readonly { pageX: number }[]): number {
  return touches.length < 2 ? 0 : Math.abs(touches[1].pageX - touches[0].pageX);
}

function TimelineDateLabel({
  day,
  selectedTypes,
  isToday,
  currentTime,
  rowHeight,
  horizontalOffset,
  theme,
}: {
  day: TimelineDay;
  selectedTypes: readonly EventType[];
  isToday: boolean;
  currentTime?: Date;
  rowHeight: number;
  horizontalOffset: Animated.Value;
  theme: Theme;
}) {
  const { language, t } = useLocalization();
  const marks = day.marks.filter((mark) => selectedTypes.includes(mark.type));
  const description = marks.length
    ? marks.map((mark) => describeMark(mark, language)).join('. ')
    : selectedTypes.length
      ? t('insights.noLogged', { activity: filterName(selectedTypes, language) })
      : t('insights.noActivitySelected');
  const fullDate = new Intl.DateTimeFormat(language, { weekday: 'long', month: 'long', day: 'numeric' });
  const shortDay = new Intl.DateTimeFormat(language, { weekday: 'short' });
  const shortDate = new Intl.DateTimeFormat(language, { month: 'short', day: 'numeric' });
  const currentTimeDescription = currentTime
    ? t('insights.currentTime', {
      time: new Intl.DateTimeFormat(language, { hour: 'numeric', minute: '2-digit' }).format(currentTime),
    })
    : undefined;

  return (
    <Animated.View
      accessible
      accessibilityLabel={`${[fullDate.format(day.date), currentTimeDescription, description].filter(Boolean).join('. ')}.`}
      style={[
        styles.dateCell,
        {
          backgroundColor: isToday ? theme.primarySoft : theme.background,
          borderColor: theme.border,
          height: rowHeight,
          transform: [{ translateX: horizontalOffset }],
        },
      ]}
    >
      <Text maxFontSizeMultiplier={1.5} style={[styles.weekday, { color: isToday ? theme.primary : theme.text }]}>
        {isToday ? t('insights.today') : shortDay.format(day.date).toUpperCase()}
      </Text>
      <Text maxFontSizeMultiplier={1.5} style={[styles.calendarDate, { color: theme.textMuted }]}>
        {shortDate.format(day.date)}
      </Text>
    </Animated.View>
  );
}

function TimelineTrack({
  day,
  selectedTypes,
  isToday,
  currentTime,
  rowHeight,
  gridHours,
  theme,
}: {
  day: TimelineDay;
  selectedTypes: readonly EventType[];
  isToday: boolean;
  currentTime?: Date;
  rowHeight: number;
  gridHours: readonly number[];
  theme: Theme;
}) {
  const marks = day.marks.filter((mark) => selectedTypes.includes(mark.type));
  const currentTimePosition = currentTime
    ? ((currentTime.getHours() * 60 + currentTime.getMinutes()) / (24 * 60)) * 100
    : undefined;

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.timelineTrack,
        {
          height: rowHeight,
          backgroundColor: isToday ? theme.primarySoft : theme.surface,
          borderBottomColor: theme.border,
        },
      ]}
    >
      {gridHours.map((hour) => (
        <View key={hour} style={[styles.gridLine, { backgroundColor: theme.border, left: `${(hour / 24) * 100}%` }]} />
      ))}
      {timelineDurationRuns(marks).map((mark) => {
        const color = eventColor(mark.type, theme);
        return (
          <View
            key={`${mark.type}-${mark.startBucket}`}
            style={[
              styles.durationMark,
              {
                backgroundColor: color,
                left: `${(mark.startBucket / TIMELINE_BUCKETS) * 100}%`,
                width: `${((mark.endBucket - mark.startBucket) / TIMELINE_BUCKETS) * 100}%`,
              },
            ]}
          />
        );
      })}
      {timelinePointClusters(marks).map((cluster) => {
        const durationTypes = cluster.types.slice(0, cluster.types.length - cluster.ids.length);
        const types = [...new Set(cluster.types)];
        const colors = types.map((type) => eventColor(type, theme));
        const durationCount = new Set(durationTypes).size;
        const markWidth = colors.length > 1 ? Math.min(14, 6 + colors.length * 2) : 6;
        return (
          <View
            key={`${cluster.startBucket}-${cluster.ids.join('-')}`}
            style={[
              styles.pointMark,
              {
                backgroundColor: colors[0],
                left: `${((cluster.startBucket + 0.5) / TIMELINE_BUCKETS) * 100}%`,
                marginLeft: -markWidth / 2,
                width: markWidth,
              },
            ]}
          >
            {colors.length > 1 ? colors.map((color, index) => {
              const continuesHorizontally = index < durationCount;
              return (
                <View
                  key={`${color}-${index}`}
                  style={[
                    styles.markStripe,
                    {
                      backgroundColor: color,
                      borderColor: theme.surfaceRaised,
                      borderBottomWidth: index === colors.length - 1 && !continuesHorizontally ? 1 : 0,
                      borderLeftWidth: continuesHorizontally ? 0 : 1,
                      borderRightWidth: continuesHorizontally ? 0 : 1,
                      borderTopWidth: index > 0 || !continuesHorizontally ? 1 : 0,
                    },
                  ]}
                />
              );
            }) : null}
          </View>
        );
      })}
      {currentTimePosition !== undefined ? (
        <View
          style={[
            styles.currentTimeMarker,
            {
              backgroundColor: theme.text,
              borderColor: theme.surfaceRaised,
              left: `${currentTimePosition}%`,
            },
          ]}
        >
          <View
            style={[
              styles.currentTimeMarkerHead,
              { backgroundColor: theme.text, borderColor: theme.surfaceRaised },
            ]}
          />
        </View>
      ) : null}
    </View>
  );
}

function TimelineAxis({
  hours,
  trackWidth,
  horizontalOffset,
  theme,
}: {
  hours: readonly number[];
  trackWidth: number;
  horizontalOffset: Animated.Value;
  theme: Theme;
}) {
  const { language, t } = useLocalization();
  return (
    <View style={[styles.axisRow, { backgroundColor: theme.background, borderColor: theme.border }]}>
      <Animated.View
        style={[
          styles.axisDateCell,
          {
            backgroundColor: theme.background,
            borderColor: theme.border,
            transform: [{ translateX: horizontalOffset }],
          },
        ]}
      >
        <Text style={[styles.axisDateText, { color: theme.textMuted }]}>{t('timeline.date')}</Text>
      </Animated.View>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[styles.axisTrack, { width: trackWidth }]}
      >
        {hours.map((hour) => (
          <Text
            key={hour}
            maxFontSizeMultiplier={1.4}
            style={[
              styles.axisLabel,
              hour === 0
                ? styles.axisStart
                : hour === 24
                  ? styles.axisEnd
                  : { left: `${(hour / 24) * 100}%`, marginLeft: -20, textAlign: 'center' },
              { color: theme.textMuted },
            ]}
          >
            {formatHour(hour, language)}
          </Text>
        ))}
      </View>
    </View>
  );
}

export function TimelineScreen({ events, theme }: { events: PuppyEvent[]; theme: Theme }) {
  const { eventLabel, language, t } = useLocalization();
  const { fontScale, height, width } = useWindowDimensions();
  const [selectedTypes, setSelectedTypes] = useState<EventType[]>([...eventTypes]);
  const [loadedDayCount, setLoadedDayCount] = useState(INITIAL_DAYS);
  const [timeScale, setTimeScale] = useState(MIN_TIME_SCALE);
  const [nowTime, setNowTime] = useState(Date.now());
  const [isLoadingEarlier, startLoadingEarlier] = useTransition();
  const rowHeight = Math.round(52 * Math.min(fontScale, 1.5));
  const viewportWidth = width;
  const baseTrackWidth = Math.max(288, viewportWidth - DATE_COLUMN_WIDTH);
  const trackWidth = Math.round(baseTrackWidth * timeScale);
  const totalWidth = DATE_COLUMN_WIDTH + trackWidth;
  const pixelsPerHour = trackWidth / 24;
  const tickStep = pixelsPerHour >= 60 ? 1 : pixelsPerHour >= 32 ? 2 : pixelsPerHour >= 20 ? 3 : 6;
  const tickHours = Array.from({ length: 24 / tickStep + 1 }, (_, index) => index * tickStep);
  const gridHours = tickHours.slice(1, -1);
  const now = useMemo(() => new Date(nowTime), [nowTime]);
  const earliestEventAt = events.reduce((earliest, event) => Math.min(earliest, event.at), nowTime);
  const maxHistoryDays = events.length
    ? Math.max(INITIAL_DAYS, calendarDayDistance(new Date(earliestEventAt), now) + 1)
    : INITIAL_DAYS;
  const days = useMemo(
    () => buildTimelineDays(events, Math.min(loadedDayCount, maxHistoryDays), now, now),
    [events, loadedDayCount, maxHistoryDays, now],
  );
  const todayKey = dateKey(now);
  const visibleEventCount = new Set(
    days.flatMap((day) => day.marks.filter((mark) => selectedTypes.includes(mark.type)).map((mark) => mark.id)),
  ).size;
  const rangeLabel = days.length ? formatDateRange(days[0].date, days[days.length - 1].date, language) : '';
  const allSelected = selectedTypes.length === eventTypes.length;
  const hasEarlierDays = loadedDayCount < maxHistoryDays;
  const isCompactHeight = height < 500;

  const listRef = useRef<FlatList<TimelineDay>>(null);
  const horizontalRef = useRef<ScrollView>(null);
  const horizontalOffset = useRef(new Animated.Value(0)).current;
  const horizontalOffsetValue = useRef(0);
  const verticalOffsetValue = useRef(0);
  const didInitialScroll = useRef(false);
  const didUserScroll = useRef(false);
  const timeScaleValue = useRef(timeScale);
  const pendingHorizontalOffset = useRef<number | null>(null);
  const zoomMetrics = useRef({ baseTrackWidth, viewportWidth });
  const pinch = useRef({ distance: 0, scale: 1, offset: 0, focalX: 0 });
  timeScaleValue.current = timeScale;
  zoomMetrics.current = { baseTrackWidth, viewportWidth };

  useEffect(() => {
    const timer = setInterval(() => setNowTime(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    setLoadedDayCount((current) => Math.min(current, maxHistoryDays));
  }, [maxHistoryDays]);

  useEffect(() => {
    const nextOffset = pendingHorizontalOffset.current;
    if (nextOffset === null) return;
    pendingHorizontalOffset.current = null;
    const frame = requestAnimationFrame(() => {
      horizontalRef.current?.scrollTo({ x: nextOffset, animated: false });
      horizontalOffsetValue.current = nextOffset;
    });
    return () => cancelAnimationFrame(frame);
  }, [trackWidth]);

  const horizontalScrollHandler = useMemo(() => Animated.event(
    [{ nativeEvent: { contentOffset: { x: horizontalOffset } } }],
    {
      useNativeDriver: true,
      listener: (event: NativeSyntheticEvent<NativeScrollEvent>) => {
        horizontalOffsetValue.current = event.nativeEvent.contentOffset.x;
      },
    },
  ), [horizontalOffset]);

  const pinchResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponderCapture: (event) => event.nativeEvent.touches.length >= 2,
    onMoveShouldSetPanResponderCapture: (event) => event.nativeEvent.touches.length >= 2,
    onPanResponderGrant: (event) => {
      const touches = event.nativeEvent.touches;
      if (touches.length < 2) return;
      pinch.current = {
        distance: Math.max(1, horizontalTouchDistance(touches)),
        scale: timeScaleValue.current,
        offset: horizontalOffsetValue.current,
        focalX: (touches[0].locationX + touches[1].locationX) / 2,
      };
    },
    onPanResponderMove: (event) => {
      const touches = event.nativeEvent.touches;
      if (touches.length < 2 || pinch.current.distance <= 0) return;
      const rawScale = pinch.current.scale * horizontalTouchDistance(touches) / pinch.current.distance;
      const nextScale = Math.round(clamp(rawScale, MIN_TIME_SCALE, MAX_TIME_SCALE) * 20) / 20;
      if (Math.abs(nextScale - timeScaleValue.current) < 0.025) return;

      const { baseTrackWidth: baseWidth, viewportWidth: viewport } = zoomMetrics.current;
      const focalX = Math.max(DATE_COLUMN_WIDTH, pinch.current.focalX);
      const oldTrackWidth = baseWidth * pinch.current.scale;
      const timeAtFocal = clamp(
        (pinch.current.offset + focalX - DATE_COLUMN_WIDTH) / oldTrackWidth,
        0,
        1,
      );
      const nextTrackWidth = baseWidth * nextScale;
      pendingHorizontalOffset.current = clamp(
        timeAtFocal * nextTrackWidth - focalX + DATE_COLUMN_WIDTH,
        0,
        Math.max(0, DATE_COLUMN_WIDTH + nextTrackWidth - viewport),
      );
      timeScaleValue.current = nextScale;
      setTimeScale(nextScale);
    },
    onPanResponderTerminationRequest: () => false,
  }), []);

  function toggleActivity(type: EventType) {
    setSelectedTypes((current) => current.includes(type)
      ? current.filter((candidate) => candidate !== type)
      : eventTypes.filter((candidate) => current.includes(candidate) || candidate === type));
  }

  function loadEarlierDays() {
    if (!hasEarlierDays || isLoadingEarlier) return;
    startLoadingEarlier(() => {
      setLoadedDayCount((current) => Math.min(maxHistoryDays, current + LOAD_DAYS));
    });
  }

  function changeTimeScale(change: number) {
    const nextScale = clamp(
      Math.round((timeScaleValue.current + change) / ZOOM_STEP) * ZOOM_STEP,
      MIN_TIME_SCALE,
      MAX_TIME_SCALE,
    );
    if (nextScale === timeScaleValue.current) return;
    const { baseTrackWidth: baseWidth, viewportWidth: viewport } = zoomMetrics.current;
    const focalX = viewport / 2;
    const timeAtFocal = clamp(
      (horizontalOffsetValue.current + focalX - DATE_COLUMN_WIDTH) / (baseWidth * timeScaleValue.current),
      0,
      1,
    );
    const nextTrackWidth = baseWidth * nextScale;
    pendingHorizontalOffset.current = clamp(
      timeAtFocal * nextTrackWidth - focalX + DATE_COLUMN_WIDTH,
      0,
      Math.max(0, DATE_COLUMN_WIDTH + nextTrackWidth - viewport),
    );
    timeScaleValue.current = nextScale;
    setTimeScale(nextScale);
  }

  function handleVerticalScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const offset = event.nativeEvent.contentOffset.y;
    verticalOffsetValue.current = offset;
    if (didInitialScroll.current && didUserScroll.current && offset <= 28) loadEarlierDays();
  }

  function handleListContentSizeChange() {
    if (didInitialScroll.current) return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        listRef.current?.scrollToEnd({ animated: false });
        didInitialScroll.current = true;
      });
    });
  }

  function handleVerticalDragStart() {
    didUserScroll.current = true;
    if (didInitialScroll.current && verticalOffsetValue.current <= 28) loadEarlierDays();
  }

  return (
    <View testID="screen.timeline" style={[styles.screen, { backgroundColor: theme.background }]}>
      <View
        style={[
          styles.header,
          isCompactHeight && styles.headerCompact,
          { backgroundColor: theme.background, borderColor: theme.border },
        ]}
      >
        <View style={styles.headingRow}>
          <View style={styles.headingCopy}>
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              style={[
                styles.title,
                {
                  color: theme.text,
                  fontSize: theme.presentation.titleSize,
                  lineHeight: theme.presentation.titleLineHeight,
                  fontWeight: theme.presentation.titleWeight,
                  letterSpacing: theme.presentation.titleTracking,
                },
              ]}
            >
              {t('timeline.title')}
            </Text>
          </View>
          <View
            style={[
              styles.zoomControl,
              {
                backgroundColor: theme.surface,
                borderColor: theme.border,
                borderRadius: theme.presentation.controlRadius,
              },
            ]}
          >
            <Pressable
              testID="timeline.zoom.out"
              accessibilityRole="button"
              accessibilityLabel={t('timeline.zoomOut')}
              accessibilityState={{ disabled: timeScale <= MIN_TIME_SCALE }}
              disabled={timeScale <= MIN_TIME_SCALE}
              onPress={() => changeTimeScale(-ZOOM_STEP)}
              style={({ pressed }) => [
                styles.zoomButton,
                { opacity: timeScale <= MIN_TIME_SCALE ? 0.3 : pressed ? 0.6 : 1 },
              ]}
            >
              <MaterialCommunityIcons name="minus" size={20} color={theme.text} />
            </Pressable>
            <Text
              testID="timeline.zoom.value"
              accessibilityLabel={`${t('insights.timeWidth')}: ${timeScale.toFixed(1)}×`}
              style={[styles.zoomValue, { color: theme.text }]}
            >
              {timeScale.toFixed(1)}×
            </Text>
            <Pressable
              testID="timeline.zoom.in"
              accessibilityRole="button"
              accessibilityLabel={t('timeline.zoomIn')}
              accessibilityState={{ disabled: timeScale >= MAX_TIME_SCALE }}
              disabled={timeScale >= MAX_TIME_SCALE}
              onPress={() => changeTimeScale(ZOOM_STEP)}
              style={({ pressed }) => [
                styles.zoomButton,
                { opacity: timeScale >= MAX_TIME_SCALE ? 0.3 : pressed ? 0.6 : 1 },
              ]}
            >
              <MaterialCommunityIcons name="plus" size={20} color={theme.text} />
            </Pressable>
          </View>
        </View>

        <View style={styles.timelineMeta}>
          <Text testID="timeline.range" numberOfLines={1} style={[styles.rangeText, { color: theme.text }]}>
            {t('timeline.range', { range: rangeLabel, count: visibleEventCount })}
          </Text>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filters}
        >
          {activityFilters.map((type) => {
            const isAll = type === 'all';
            const checked: boolean | 'mixed' = isAll
              ? allSelected
                ? true
                : selectedTypes.length
                  ? 'mixed'
                  : false
              : selectedTypes.includes(type);
            const active = checked !== false;
            const selected = checked === true;
            const label = isAll ? t('insights.all') : eventLabel(type);
            const icon = isAll ? 'layers-outline' : eventIcon(theme, type);
            const color = isAll ? theme.primary : eventColor(type, theme);
            const activeBackground = isAll
              ? theme.primarySoft
              : theme.isDark
                ? EVENT_META[type].darkSoftColor
                : EVENT_META[type].softColor;
            return (
              <Pressable
                key={type}
                testID={`timeline.filter.${type}`}
                accessibilityRole="checkbox"
                accessibilityLabel={isAll
                  ? t(allSelected ? 'insights.clearFilters' : 'insights.selectFilters')
                  : t(selected ? 'insights.hideTiming' : 'insights.showTiming', { activity: label })}
                accessibilityState={{ checked }}
                onPress={() => isAll
                  ? setSelectedTypes(allSelected ? [] : [...eventTypes])
                  : toggleActivity(type)}
                style={({ pressed }) => [
                  styles.filterChip,
                  {
                    backgroundColor: active ? activeBackground : theme.surface,
                    borderColor: active ? color : theme.border,
                    borderRadius: theme.presentation.controlRadius,
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}
              >
                <MaterialCommunityIcons
                  accessibilityElementsHidden
                  importantForAccessibility="no"
                  name={icon as keyof typeof MaterialCommunityIcons.glyphMap}
                  size={17}
                  color={active ? color : theme.textMuted}
                />
                <Text style={[styles.filterLabel, { color: active ? color : theme.textMuted }]}>{label}</Text>
                {active ? (
                  <MaterialCommunityIcons
                    accessibilityElementsHidden
                    importantForAccessibility="no"
                    name={checked === 'mixed' ? 'minus' : 'check'}
                    size={14}
                    color={color}
                  />
                ) : null}
              </Pressable>
            );
          })}
        </ScrollView>

        {!isCompactHeight && (selectedTypes.length === 0 || visibleEventCount === 0) ? (
          <View testID="timeline.empty" style={[styles.emptyNote, { backgroundColor: theme.surface, borderRadius: theme.presentation.controlRadius }]}>
            <MaterialCommunityIcons name="clock-outline" size={18} color={theme.textMuted} />
            <Text style={[styles.emptyText, { color: theme.textMuted }]}>
              {selectedTypes.length === 0
                ? t('insights.chooseActivity')
                : t('insights.noRangeLogs', { activity: filterName(selectedTypes, language) })}
            </Text>
          </View>
        ) : null}
      </View>

      <View style={styles.timelineViewport} {...pinchResponder.panHandlers}>
        <Animated.ScrollView
          ref={horizontalRef}
          horizontal
          directionalLockEnabled
          nestedScrollEnabled
          scrollEventThrottle={16}
          showsHorizontalScrollIndicator
          onScroll={horizontalScrollHandler}
          style={styles.horizontalScroller}
          contentContainerStyle={styles.horizontalContent}
        >
          <View style={[styles.timelineCanvas, { width: totalWidth }]}>
            <TimelineAxis
              hours={tickHours}
              trackWidth={trackWidth}
              horizontalOffset={horizontalOffset}
              theme={theme}
            />
            <FlatList
              ref={listRef}
              data={days}
              keyExtractor={(day) => day.key}
              renderItem={({ item: day }) => (
                <View style={[styles.dayRow, { height: rowHeight, width: totalWidth }]}>
                  <TimelineDateLabel
                    day={day}
                    selectedTypes={selectedTypes}
                    isToday={day.key === todayKey}
                    currentTime={day.key === todayKey ? now : undefined}
                    rowHeight={rowHeight}
                    horizontalOffset={horizontalOffset}
                    theme={theme}
                  />
                  <View style={{ width: trackWidth }}>
                    <TimelineTrack
                      day={day}
                      selectedTypes={selectedTypes}
                      isToday={day.key === todayKey}
                      currentTime={day.key === todayKey ? now : undefined}
                      rowHeight={rowHeight}
                      gridHours={gridHours}
                      theme={theme}
                    />
                  </View>
                </View>
              )}
              ListHeaderComponent={(
                <Pressable
                  accessibilityRole={hasEarlierDays ? 'button' : 'text'}
                  accessibilityLabel={t(hasEarlierDays ? 'timeline.loadEarlier' : 'timeline.historyStart')}
                  accessibilityState={{ busy: isLoadingEarlier, disabled: !hasEarlierDays }}
                  disabled={!hasEarlierDays || isLoadingEarlier}
                  onPress={loadEarlierDays}
                  style={[
                    styles.loadEarlier,
                    {
                      backgroundColor: theme.surface,
                      borderColor: theme.border,
                      width: totalWidth,
                    },
                  ]}
                >
                  <Animated.View style={{ transform: [{ translateX: horizontalOffset }] }}>
                    {isLoadingEarlier ? (
                      <ActivityIndicator size="small" color={theme.primary} />
                    ) : (
                      <MaterialCommunityIcons
                        name={hasEarlierDays ? 'arrow-up' : 'check'}
                        size={18}
                        color={hasEarlierDays ? theme.primary : theme.textMuted}
                      />
                    )}
                  </Animated.View>
                  <Animated.Text
                    style={[
                      styles.loadEarlierText,
                      {
                        color: hasEarlierDays ? theme.primary : theme.textMuted,
                        transform: [{ translateX: horizontalOffset }],
                      },
                    ]}
                  >
                    {t(isLoadingEarlier
                      ? 'timeline.loadingEarlier'
                      : hasEarlierDays
                        ? 'timeline.loadEarlier'
                        : 'timeline.historyStart')}
                  </Animated.Text>
                </Pressable>
              )}
              getItemLayout={(_, index) => ({
                length: rowHeight,
                offset: LOAD_ROW_HEIGHT + rowHeight * index,
                index,
              })}
              initialNumToRender={INITIAL_DAYS}
              maxToRenderPerBatch={INITIAL_DAYS}
              windowSize={7}
              maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
              onContentSizeChange={handleListContentSizeChange}
              onScroll={handleVerticalScroll}
              onScrollBeginDrag={handleVerticalDragStart}
              scrollEventThrottle={16}
              showsVerticalScrollIndicator
              style={styles.dayList}
            />
          </View>
        </Animated.ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: spacing.sm,
    zIndex: 5,
  },
  headerCompact: { paddingTop: spacing.xs, paddingBottom: spacing.xs, gap: spacing.xs },
  headingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  headingCopy: { flex: 1, minWidth: 0 },
  title: { fontSize: 28, lineHeight: 34, fontWeight: '800' },
  zoomControl: {
    minWidth: 140,
    height: 48,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
  },
  zoomButton: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  zoomValue: { minWidth: 44, textAlign: 'center', fontSize: 12, fontWeight: '800', fontVariant: ['tabular-nums'] },
  timelineMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  rangeText: { flex: 1, minWidth: 0, fontSize: 11, lineHeight: 15, fontWeight: '700', fontVariant: ['tabular-nums'] },
  filters: { gap: spacing.sm, paddingRight: spacing.md },
  filterChip: {
    minHeight: 48,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  filterLabel: { fontSize: 12, lineHeight: 17, fontWeight: '700' },
  emptyNote: { minHeight: 36, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  emptyText: { flex: 1, fontSize: 11, lineHeight: 16 },
  timelineViewport: { flex: 1, overflow: 'hidden' },
  horizontalScroller: { flex: 1 },
  horizontalContent: { flexGrow: 1 },
  timelineCanvas: { flex: 1 },
  axisRow: { height: 30, flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth, zIndex: 4 },
  axisDateCell: {
    width: DATE_COLUMN_WIDTH,
    height: 30,
    borderRightWidth: StyleSheet.hairlineWidth,
    justifyContent: 'center',
    paddingLeft: 10,
    zIndex: 5,
  },
  axisDateText: { fontSize: 9, lineHeight: 12, fontWeight: '800', letterSpacing: 0.7 },
  axisTrack: { height: 30, position: 'relative' },
  axisLabel: { position: 'absolute', width: 40, top: 7, fontSize: 10, lineHeight: 14, fontWeight: '600', fontVariant: ['tabular-nums'] },
  axisStart: { left: 4, textAlign: 'left' },
  axisEnd: { right: 4, textAlign: 'right' },
  dayList: { flex: 1 },
  dayRow: { flexDirection: 'row' },
  dateCell: {
    width: DATE_COLUMN_WIDTH,
    flexShrink: 0,
    justifyContent: 'center',
    paddingLeft: 10,
    paddingRight: 6,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    zIndex: 3,
  },
  weekday: { fontSize: 10, lineHeight: 13, fontWeight: '800', letterSpacing: 0.35 },
  calendarDate: { fontSize: 10, lineHeight: 13, fontWeight: '600', marginTop: 1 },
  timelineTrack: { width: '100%', borderBottomWidth: StyleSheet.hairlineWidth, position: 'relative', overflow: 'hidden' },
  gridLine: { position: 'absolute', top: 0, bottom: 0, width: StyleSheet.hairlineWidth },
  pointMark: { position: 'absolute', top: 3, bottom: 3, width: 6, marginLeft: -3, borderRadius: 999, overflow: 'hidden', zIndex: 2 },
  markStripe: { flex: 1, width: '100%' },
  durationMark: { position: 'absolute', top: 3, bottom: 3, minWidth: 3, borderRadius: 999, zIndex: 1 },
  currentTimeMarker: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 4,
    marginLeft: -2,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    zIndex: 3,
  },
  currentTimeMarkerHead: { position: 'absolute', top: 4, left: -2, width: 8, height: 8, borderRadius: 4, borderWidth: 2 },
  loadEarlier: {
    height: LOAD_ROW_HEIGHT,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 6,
    paddingLeft: 12,
  },
  loadEarlierText: { fontSize: 11, lineHeight: 16, fontWeight: '700' },
});

import { MaterialCommunityIcons } from '@expo/vector-icons';
import { memo, useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import {
  ActivityIndicator,
  Animated,
  FlatList,
  type GestureResponderEvent,
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  buildTimelineDays,
  estimateMissingLogs,
  TIMELINE_BUCKET_MINUTES,
  TIMELINE_BUCKETS,
  timelineDurationRuns,
  timelineMarksForPointHit,
  timelinePointClusters,
  type TimelineDay,
  type TimelineMark,
} from '../analytics';
import { activityFromKey, activityKey, customActivityKey, dateKey, formatDuration, isOpenNap, quickEventTypes, type Activity, type ActivityKey, type PuppyEvent } from '../domain';
import { ActivityIcon } from '../components/ActivityIcon';
import { useLocalization } from '../localization-context';
import { translate, type AppLanguage } from '../localization';
import { spacing, type Theme } from '../theme';

const INITIAL_DAYS = 14;
const LOAD_DAYS = 14;
const DATE_COLUMN_WIDTH = 72;
const LOAD_ROW_HEIGHT = 48;
const MIN_TIME_SCALE = 1;
const MAX_TIME_SCALE = 4;
const ZOOM_STEP = 0.5;
const ESTIMATE_OPACITY = 0.35;
const POPOVER_MAX_WIDTH = 320;
const POPOVER_MAX_HEIGHT = 320;
const POPOVER_GAP = 16;

type TimelineSelection = { ids: string[]; x: number; y: number; width: number; height: number };

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function formatBucket(bucket: number, language: AppLanguage): string {
  return new Intl.DateTimeFormat(language, { hour: 'numeric', minute: '2-digit' })
    .format(new Date(2000, 0, 1, 0, bucket * TIMELINE_BUCKET_MINUTES));
}

function describeMark(mark: TimelineMark, language: AppLanguage, activityLabel: (activity: Activity) => string): string {
  const activity = activityLabel({ type: mark.type, customLabel: mark.label });
  if (mark.estimated) return mark.endBucket === undefined
    ? translate(language, 'timeline.estimatedPoint', { activity, time: formatBucket(mark.startBucket, language) })
    : translate(language, 'timeline.estimatedSpan', {
      activity,
      start: formatBucket(mark.startBucket, language),
      end: formatBucket(mark.endBucket, language),
    });
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

function filterName(types: readonly ActivityKey[], language: AppLanguage, allCount: number, activityLabel: (activity: Activity) => string): string {
  if (types.length === allCount) return translate(language, 'insights.activity');
  if (types.length === 1) return activityLabel(activityFromKey(types[0], [])).toLocaleLowerCase(language);
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

function horizontalTouchDistance(touches: readonly { pageX: number }[]): number {
  return touches.length < 2 ? 0 : Math.abs(touches[1].pageX - touches[0].pageX);
}

function TimelineDateLabel({
  day,
  selectedTypes,
  activityCount,
  isToday,
  currentTime,
  rowHeight,
  horizontalOffset,
  theme,
}: {
  day: TimelineDay;
  selectedTypes: readonly ActivityKey[];
  activityCount: number;
  isToday: boolean;
  currentTime?: Date;
  rowHeight: number;
  horizontalOffset: Animated.Value;
  theme: Theme;
}) {
  const { activityLabel, language, t } = useLocalization();
  const marks = day.marks.filter((mark) => selectedTypes.includes(activityKey({ type: mark.type, customLabel: mark.label })));
  const description = marks.length
    ? marks.map((mark) => describeMark(mark, language, activityLabel)).join('. ')
    : selectedTypes.length
      ? t('insights.noLogged', { activity: filterName(selectedTypes, language, activityCount, activityLabel) })
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
  trackWidth,
  gridHours,
  onSelectMarks,
  theme,
}: {
  day: TimelineDay;
  selectedTypes: readonly ActivityKey[];
  isToday: boolean;
  currentTime?: Date;
  rowHeight: number;
  trackWidth: number;
  gridHours: readonly number[];
  onSelectMarks: (ids: string[], event: GestureResponderEvent) => void;
  theme: Theme;
}) {
  const { activityColors, activityLabel, language, t } = useLocalization();
  const marks = day.marks.filter((mark) => selectedTypes.includes(activityKey({ type: mark.type, customLabel: mark.label })));
  const recordedMarks = marks.filter((mark) => !mark.estimated);
  const currentTimePosition = currentTime
    ? ((currentTime.getHours() * 60 + currentTime.getMinutes()) / (24 * 60)) * 100
    : undefined;

  return (
    <View
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
      {timelineDurationRuns(recordedMarks).map((mark) => {
        const color = activityColors(theme, { type: mark.type }).color;
        const ids = recordedMarks.filter((candidate) => candidate.endBucket !== undefined
          && candidate.type === mark.type
          && candidate.startBucket < mark.endBucket
          && candidate.endBucket > mark.startBucket).map((candidate) => candidate.id);
        return (
          <Pressable
            key={`${mark.type}-${mark.startBucket}`}
            testID={`timeline.mark.duration.${day.key}.${mark.startBucket}`}
            accessibilityRole="button"
            accessibilityLabel={`${t('insights.durationWindow', {
              activity: activityLabel({ type: mark.type }),
              start: formatBucket(mark.startBucket, language),
              end: formatBucket(mark.endBucket, language),
            })}. ${t('timeline.viewDetails')}`}
            hitSlop={20}
            onPress={(event) => onSelectMarks(ids, event)}
            style={({ pressed }) => [
              styles.durationMark,
              {
                backgroundColor: color,
                left: `${(mark.startBucket / TIMELINE_BUCKETS) * 100}%`,
                width: `${((mark.endBucket - mark.startBucket) / TIMELINE_BUCKETS) * 100}%`,
                opacity: pressed ? 0.6 : 1,
              },
            ]}
          />
        );
      })}
      {timelinePointClusters(recordedMarks).map((cluster) => {
        const durationMarks = recordedMarks.filter((mark) => mark.endBucket !== undefined
          && mark.startBucket <= cluster.startBucket && mark.endBucket > cluster.startBucket);
        const pointMarks = recordedMarks.filter((mark) => cluster.ids.includes(mark.id));
        const selectedMarks = timelineMarksForPointHit(recordedMarks, cluster.startBucket, trackWidth);
        const colors = [...new Set([...durationMarks, ...pointMarks].map((mark) => activityColors(theme, { type: mark.type, customLabel: mark.label }).color))];
        const durationCount = new Set(durationMarks.map((mark) => activityColors(theme, { type: mark.type, customLabel: mark.label }).color)).size;
        const markWidth = colors.length > 1 ? Math.min(14, 6 + colors.length * 2) : 6;
        return (
          <Pressable
            key={`${cluster.startBucket}-${cluster.ids.join('-')}`}
            testID={`timeline.mark.point.${day.key}.${cluster.startBucket}`}
            accessibilityRole="button"
            accessibilityLabel={`${selectedMarks.map((mark) => describeMark(mark, language, activityLabel)).join('. ')}. ${t('timeline.viewDetails')}`}
            onPress={(event) => onSelectMarks([...new Set(selectedMarks.map((mark) => mark.id))], event)}
            style={({ pressed }) => [
              styles.pointHitTarget,
              {
                left: `${((cluster.startBucket + 0.5) / TIMELINE_BUCKETS) * 100}%`,
                marginLeft: -24,
                opacity: pressed ? 0.6 : 1,
              },
            ]}
          >
            <View style={[styles.pointMark, { backgroundColor: colors[0], height: rowHeight - 6, width: markWidth }]}>
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
          </Pressable>
        );
      })}
      {marks.filter((mark) => mark.estimated).map((mark) => {
        const color = activityColors(theme, { type: mark.type, customLabel: mark.label }).color;
        const duration = mark.endBucket !== undefined;
        return (
          <View
            key={mark.id}
            pointerEvents="none"
            style={[
              duration ? styles.durationMark : styles.estimatedPointMark,
              {
                backgroundColor: color,
                left: `${((mark.startBucket + (duration ? 0 : 0.5)) / TIMELINE_BUCKETS) * 100}%`,
                ...(duration ? { width: `${((mark.endBucket! - mark.startBucket) / TIMELINE_BUCKETS) * 100}%` } : {}),
                opacity: ESTIMATE_OPACITY,
              },
            ]}
          />
        );
      })}
      {currentTimePosition !== undefined ? (
        <View
          pointerEvents="none"
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

const MemoTimelineDateLabel = memo(TimelineDateLabel);
const MemoTimelineTrack = memo(TimelineTrack);
const MemoTimelineAxis = memo(TimelineAxis);

export function TimelineScreen({ events, customActivities, theme }: { events: PuppyEvent[]; customActivities: string[]; theme: Theme }) {
  const { activityColors, activityLabel, language, t } = useLocalization();
  const insets = useSafeAreaInsets();
  const { fontScale, height, width } = useWindowDimensions();
  const activityFilters: ActivityKey[] = useMemo(() => [...quickEventTypes, ...customActivities.map(customActivityKey)], [customActivities]);
  const [selectedType, setSelectedType] = useState<ActivityKey | 'all'>('all');
  const selectedTypes = useMemo(() => selectedType === 'all' ? activityFilters : [selectedType], [activityFilters, selectedType]);
  useEffect(() => {
    if (selectedType !== 'all' && !activityFilters.includes(selectedType)) setSelectedType('all');
  }, [customActivities, selectedType]);
  const [loadedDayCount, setLoadedDayCount] = useState(INITIAL_DAYS);
  const [timeScale, setTimeScale] = useState(MIN_TIME_SCALE);
  const [nowTime, setNowTime] = useState(Date.now());
  const [selection, setSelection] = useState<TimelineSelection | null>(null);
  const [isLoadingEarlier, startLoadingEarlier] = useTransition();
  const rowHeight = Math.round(52 * Math.min(fontScale, 1.5));
  const viewportWidth = width;
  const baseTrackWidth = Math.max(288, viewportWidth - DATE_COLUMN_WIDTH);
  const trackWidth = Math.round(baseTrackWidth * timeScale);
  const totalWidth = DATE_COLUMN_WIDTH + trackWidth;
  const pixelsPerHour = trackWidth / 24;
  const tickStep = pixelsPerHour >= 60 ? 1 : pixelsPerHour >= 32 ? 2 : pixelsPerHour >= 20 ? 3 : 6;
  const tickHours = useMemo(() => Array.from({ length: 24 / tickStep + 1 }, (_, index) => index * tickStep), [tickStep]);
  const gridHours = useMemo(() => tickHours.slice(1, -1), [tickHours]);
  const now = useMemo(() => new Date(nowTime), [nowTime]);
  const estimates = useMemo(() => estimateMissingLogs(events, INITIAL_DAYS, now).estimates, [events, now]);
  const earliestEventAt = events.reduce((earliest, event) => Math.min(earliest, event.at), nowTime);
  const maxHistoryDays = events.length
    ? Math.max(INITIAL_DAYS, calendarDayDistance(new Date(earliestEventAt), now) + 1)
    : INITIAL_DAYS;
  const days = useMemo(
    () => buildTimelineDays(events, Math.min(loadedDayCount, maxHistoryDays), now, now, estimates),
    [events, estimates, loadedDayCount, maxHistoryDays, now],
  );
  const todayKey = dateKey(now);
  const visibleEventCount = new Set(
    days.flatMap((day) => day.marks.filter((mark) => !mark.estimated && selectedTypes.includes(activityKey({ type: mark.type, customLabel: mark.label }))).map((mark) => mark.id)),
  ).size;
  const visibleMarkCount = days.flatMap((day) => day.marks.filter((mark) => selectedTypes.includes(activityKey({ type: mark.type, customLabel: mark.label })))).length;
  const hasVisibleEstimates = days.some((day) => day.marks.some((mark) => mark.estimated && selectedTypes.includes(activityKey({ type: mark.type, customLabel: mark.label }))));
  const rangeLabel = days.length ? formatDateRange(days[0].date, days[days.length - 1].date, language) : '';
  const hasEarlierDays = loadedDayCount < maxHistoryDays;
  const isCompactHeight = height < 500;
  const selectedEvents = events.filter((event) => selection?.ids.includes(event.id)).sort((a, b) => a.at - b.at);
  const popoverWidth = selection ? Math.min(POPOVER_MAX_WIDTH, selection.width - 32) : 0;
  const popoverAbove = !!selection && selection.y > selection.height / 2;
  const availableSpace = selection ? (popoverAbove ? selection.y : selection.height - selection.y) : 0;
  const popoverMaxHeight = Math.max(96, Math.min(POPOVER_MAX_HEIGHT, availableSpace - POPOVER_GAP - 8));
  const popoverLeft = selection ? clamp(selection.x - popoverWidth / 2, 16, selection.width - popoverWidth - 16) : 0;
  const arrowLeft = selection ? clamp(selection.x - popoverLeft - 10, 18, popoverWidth - 38) : 0;

  const screenRef = useRef<View>(null);
  const screenBounds = useRef<{ left: number; top: number; width: number; height: number } | null>(null);
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

  useEffect(() => setSelection(null), [width, height]);

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
      setSelection(null);
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

  function loadEarlierDays() {
    if (!hasEarlierDays || isLoadingEarlier) return;
    setSelection(null);
    startLoadingEarlier(() => {
      setLoadedDayCount((current) => Math.min(maxHistoryDays, current + LOAD_DAYS));
    });
  }

  function changeTimeScale(change: number) {
    setSelection(null);
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
    setSelection(null);
    didUserScroll.current = true;
    if (didInitialScroll.current && verticalOffsetValue.current <= 28) loadEarlierDays();
  }

  const selectMarks = useCallback((ids: string[], event: GestureResponderEvent) => {
    if (!ids.length) return;
    const { pageX, pageY } = event.nativeEvent;
    const showDetails = ({ left, top, width: measuredWidth, height: measuredHeight }: NonNullable<typeof screenBounds.current>) => {
      setSelection({
        ids,
        x: clamp(pageX - left, 0, measuredWidth),
        y: clamp(pageY - top, 0, measuredHeight),
        width: measuredWidth,
        height: measuredHeight,
      });
    };
    if (screenBounds.current) showDetails(screenBounds.current);
  }, []);

  return (
    <View
      ref={screenRef}
      testID="screen.timeline"
      onLayout={(event) => {
        const { width: measuredWidth, height: measuredHeight } = event.nativeEvent.layout;
        screenBounds.current = { left: insets.left, top: insets.top, width: measuredWidth, height: measuredHeight };
        screenRef.current?.measureInWindow((left, top, actualWidth, actualHeight) => {
          screenBounds.current = { left, top, width: actualWidth, height: actualHeight };
        });
      }}
      style={[styles.screen, { backgroundColor: theme.background }]}
    >
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
        {hasVisibleEstimates ? (
          <View style={styles.estimateLegend}>
            <View style={[styles.estimateLegendMark, { backgroundColor: theme.textMuted, opacity: ESTIMATE_OPACITY }]} />
            <Text style={[styles.estimateLegendText, { color: theme.textMuted }]}>{t('timeline.estimateLegend')}</Text>
          </View>
        ) : null}

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filters}
        >
          {(['all', ...activityFilters] as const).map((type) => {
            const isAll = type === 'all';
            const active = selectedType === type;
            const activity = isAll ? null : activityFromKey(type, customActivities);
            const label = activity ? activityLabel(activity) : t('insights.all');
            const colors = activity ? activityColors(theme, activity) : { color: theme.primary, softColor: theme.primarySoft };
            const color = colors.color;
            const activeBackground = colors.softColor;
            return (
              <Pressable
                key={type}
                testID={`timeline.filter.${type}`}
                accessibilityRole="radio"
                accessibilityLabel={label}
                accessibilityState={{ checked: active }}
                onPress={() => {
                  setSelection(null);
                  setSelectedType(type);
                }}
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
                {activity
                  ? <ActivityIcon activity={activity} theme={theme} size={17} color={active ? color : theme.textMuted} />
                  : <MaterialCommunityIcons accessibilityElementsHidden importantForAccessibility="no" name="layers-outline" size={17} color={active ? color : theme.textMuted} />}
                <Text style={[styles.filterLabel, { color: active ? color : theme.textMuted }]}>{label}</Text>
                {active ? (
                  <MaterialCommunityIcons
                    accessibilityElementsHidden
                    importantForAccessibility="no"
                    name="check"
                    size={14}
                    color={color}
                  />
                ) : null}
              </Pressable>
            );
          })}
        </ScrollView>

        {!isCompactHeight && visibleMarkCount === 0 ? (
          <View testID="timeline.empty" style={[styles.emptyNote, { backgroundColor: theme.surface, borderRadius: theme.presentation.controlRadius }]}>
            <MaterialCommunityIcons name="clock-outline" size={18} color={theme.textMuted} />
            <Text style={[styles.emptyText, { color: theme.textMuted }]}>
              {t('insights.noRangeLogs', { activity: filterName(selectedTypes, language, activityFilters.length, activityLabel) })}
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
          onScrollBeginDrag={() => setSelection(null)}
          style={styles.horizontalScroller}
          contentContainerStyle={styles.horizontalContent}
        >
          <View style={[styles.timelineCanvas, { width: totalWidth }]}>
            <MemoTimelineAxis
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
                  <MemoTimelineDateLabel
                    day={day}
                    selectedTypes={selectedTypes}
                    activityCount={activityFilters.length}
                    isToday={day.key === todayKey}
                    currentTime={day.key === todayKey ? now : undefined}
                    rowHeight={rowHeight}
                    horizontalOffset={horizontalOffset}
                    theme={theme}
                  />
                  <View style={{ width: trackWidth }}>
                    <MemoTimelineTrack
                      day={day}
                      selectedTypes={selectedTypes}
                      isToday={day.key === todayKey}
                      currentTime={day.key === todayKey ? now : undefined}
                      rowHeight={rowHeight}
                      trackWidth={trackWidth}
                      gridHours={gridHours}
                      onSelectMarks={selectMarks}
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
      {selection && selectedEvents.length ? (
        <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
          <View
            pointerEvents="box-none"
            style={[styles.popoverPosition, {
              left: popoverLeft,
              width: popoverWidth,
              ...(popoverAbove
                ? { bottom: selection.height - selection.y + POPOVER_GAP }
                : { top: selection.y + POPOVER_GAP }),
            }]}
          >
            <View
              testID="timeline.details"
              style={[styles.detailsPopover, {
                backgroundColor: theme.surfaceRaised,
                borderColor: theme.border,
                borderRadius: theme.presentation.cardRadius,
                maxHeight: popoverMaxHeight,
                shadowColor: theme.shadow,
              }]}
            >
              <View style={styles.detailsHeading}>
                <View style={styles.detailsHeadingCopy}>
                  <Text numberOfLines={1} style={[styles.detailsTitle, { color: theme.text }]}>
                    {selectedEvents.length > 1 && selectedEvents.every((item) => activityKey(item) === activityKey(selectedEvents[0]))
                      ? t('timeline.range', { range: activityLabel(selectedEvents[0]), count: selectedEvents.length })
                      : selectedEvents.length === 1 ? activityLabel(selectedEvents[0]) : t('timeline.details')}
                  </Text>
                  <Text style={[styles.detailsDate, { color: theme.textMuted }]}>
                    {new Intl.DateTimeFormat(language, { weekday: 'long', month: 'short', day: 'numeric' }).format(selectedEvents[0].at)}
                  </Text>
                </View>
                <Pressable
                  testID="timeline.details.close"
                  accessibilityRole="button"
                  accessibilityLabel={t('timeline.closeDetails')}
                  onPress={() => setSelection(null)}
                  style={({ pressed }) => [styles.detailsClose, { opacity: pressed ? 0.5 : 1 }]}
                >
                  <MaterialCommunityIcons name="close" size={22} color={theme.textMuted} />
                </Pressable>
              </View>
              <ScrollView style={styles.detailsScroll} contentContainerStyle={styles.detailsList}>
                {selectedEvents.map((event) => {
                  const colors = activityColors(theme, event);
                  const running = isOpenNap(event);
                  const start = new Intl.DateTimeFormat(language, { hour: 'numeric', minute: '2-digit' }).format(event.at);
                  const end = typeof event.endedAt === 'number'
                    ? new Intl.DateTimeFormat(language, {
                      ...(dateKey(new Date(event.at)) === dateKey(new Date(event.endedAt)) ? {} : { month: 'short' as const, day: 'numeric' as const }),
                      hour: 'numeric',
                      minute: '2-digit',
                    }).format(event.endedAt)
                    : null;
                  return (
                    <View key={event.id} style={[styles.detailsEvent, { borderColor: theme.border }]}>
                      <View style={[styles.detailsDot, { backgroundColor: colors.color }]} />
                      <View style={styles.detailsCopy}>
                        <View style={styles.detailsEventHeading}>
                          <Text style={[styles.detailsEventTitle, { color: theme.text }]}>{activityLabel(event)}</Text>
                          <Text style={[styles.detailsTime, { color: theme.textMuted }]}>{start}</Text>
                        </View>
                        {end || running ? (
                          <Text style={[styles.detailsTime, { color: theme.textMuted }]}>
                            {end ?? t('eventRow.now')} · {formatDuration((event.endedAt ?? nowTime) - event.at)}{running ? ` ${t('eventRow.running')}` : ''}
                          </Text>
                        ) : null}
                        {event.note?.trim() ? <Text style={[styles.detailsNote, { color: theme.text }]}>{event.note.trim()}</Text> : null}
                        <Text style={[styles.detailsSource, { color: theme.textMuted }]}>{t(event.source === 'widget' ? 'eventRow.widget' : 'eventRow.app')}</Text>
                      </View>
                    </View>
                  );
                })}
              </ScrollView>
            </View>
            <View
              pointerEvents="none"
              style={[styles.popoverArrow, {
                left: arrowLeft,
                ...(popoverAbove ? { bottom: -9 } : { top: -9 }),
                borderTopWidth: popoverAbove ? 10 : 0,
                borderBottomWidth: popoverAbove ? 0 : 10,
                borderTopColor: popoverAbove ? theme.surfaceRaised : 'transparent',
                borderBottomColor: popoverAbove ? 'transparent' : theme.surfaceRaised,
              }]}
            />
          </View>
        </View>
      ) : null}
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
  pointHitTarget: { position: 'absolute', top: 0, bottom: 0, width: 48, alignItems: 'center', justifyContent: 'center', zIndex: 2 },
  pointMark: { borderRadius: 999, overflow: 'hidden' },
  estimatedPointMark: { position: 'absolute', top: 3, bottom: 3, width: 6, marginLeft: -3, borderRadius: 999, zIndex: 2 },
  estimateLegend: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  estimateLegendMark: { width: 6, height: 16, borderRadius: 3 },
  estimateLegendText: { fontSize: 11, lineHeight: 16, fontWeight: '600' },
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
  popoverPosition: { position: 'absolute' },
  popoverArrow: { position: 'absolute', width: 0, height: 0, borderLeftWidth: 10, borderRightWidth: 10, borderLeftColor: 'transparent', borderRightColor: 'transparent' },
  detailsPopover: { borderWidth: 1, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.16, shadowRadius: 18, elevation: 8 },
  detailsHeading: { minHeight: 64, paddingLeft: spacing.md, paddingRight: spacing.xs, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  detailsHeadingCopy: { flex: 1, minWidth: 0, gap: 2 },
  detailsTitle: { fontSize: 17, fontWeight: '700' },
  detailsDate: { fontSize: 13 },
  detailsClose: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  detailsScroll: { flexShrink: 1 },
  detailsList: { paddingHorizontal: spacing.md, paddingBottom: spacing.xs },
  detailsEvent: { minHeight: 52, flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, paddingVertical: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth },
  detailsDot: { width: 8, height: 8, borderRadius: 4, marginTop: 7 },
  detailsCopy: { flex: 1, gap: 2 },
  detailsEventHeading: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  detailsEventTitle: { flex: 1, fontSize: 15, fontWeight: '700' },
  detailsTime: { fontSize: 13 },
  detailsNote: { fontSize: 13, marginTop: spacing.xs },
  detailsSource: { fontSize: 12 },
});

import { MaterialCommunityIcons } from '@expo/vector-icons';
import { memo, useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Modal,
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
import {ActivityLoadState} from '../components/ActivityLoadState';
import {activityWindowBounds,useActivityWindow,type ActivityViewProps} from '../activity-view';
import { ActivityIcon } from '../components/ActivityIcon';
import { useLocalization } from '../localization-context';
import { translate, type AppLanguage } from '../localization';
import { headingStyle, spacing, type Theme } from '../theme';
import { collapseEmptyTimelineDays, timelineDetailTime, timelineFormatters, type TimelineGap } from '../timeline-format';

const INITIAL_DAYS = 14;
const LOAD_DAYS = 14;
const DATE_COLUMN_WIDTH = 56;
const LOAD_ROW_HEIGHT = 48;
const MIN_TIME_SCALE = 1;
const MAX_TIME_SCALE = 4;
const ZOOM_STEP = 0.5;
const ESTIMATE_OPACITY = 0.35;
const AXIS_HOURS = Array.from({ length: 25 }, (_, index) => index);
const GRID_HOURS = Array.from({ length: 23 }, (_, index) => index + 1);

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function formatBucket(bucket: number, language: AppLanguage): string {
  return timelineFormatters(language).time
    .format(new Date(2000, 0, 1, 0, bucket * TIMELINE_BUCKET_MINUTES));
}

function describeMark(mark: TimelineMark, language: AppLanguage, activityLabel: (activity: Activity) => string, savedEstimate = false): string {
  const activity = activityLabel({ type: mark.type, customLabel: mark.label });
  if (mark.estimated && !savedEstimate) return mark.endBucket === undefined
    ? translate(language, 'timeline.estimatedPoint', { activity, time: formatBucket(mark.startBucket, language) })
    : translate(language, 'timeline.estimatedSpan', {
      activity,
      start: formatBucket(mark.startBucket, language),
      end: formatBucket(mark.endBucket, language),
    });
  const description = mark.endBucket === undefined
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
  return savedEstimate ? translate(language, 'timeline.estimatedDescription', { description }) : description;
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

function formatDateRange(start: Date, end: Date, language: AppLanguage): string {
  const { shortDate, rangeDate } = timelineFormatters(language);
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
  savedEstimateIds,
  activityCount,
  isToday,
  currentTime,
  rowHeight,
  horizontalOffset,
  theme,
}: {
  day: TimelineDay;
  selectedTypes: readonly ActivityKey[];
  savedEstimateIds: ReadonlySet<string>;
  activityCount: number;
  isToday: boolean;
  currentTime?: Date;
  rowHeight: number;
  horizontalOffset: Animated.Value;
  theme: Theme;
}) {
  const { activityLabel, language, t } = useLocalization();
  const description = useMemo(() => {
    const marks = day.marks.filter((mark) => selectedTypes.includes(activityKey({ type: mark.type, customLabel: mark.label })));
    return marks.length
      ? marks.map((mark) => describeMark(mark, language, activityLabel, savedEstimateIds.has(mark.id))).join('. ')
      : selectedTypes.length
        ? t('insights.noLogged', { activity: filterName(selectedTypes, language, activityCount, activityLabel) })
        : t('insights.noActivitySelected');
  }, [day, selectedTypes, savedEstimateIds, language, activityCount, activityLabel, t]);
  const { fullDate, weekday: shortDay, shortDate, time } = timelineFormatters(language);
  const currentTimeDescription = currentTime
    ? t('insights.currentTime', {
      time: time.format(currentTime),
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
          borderRightWidth: StyleSheet.hairlineWidth,
          transform: [{ translateX: horizontalOffset }],
        },
      ]}
    >
      <Text numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={1.5} style={[styles.weekday, headingStyle(theme), { fontSize: 10, lineHeight: 13, color: isToday ? theme.primary : theme.text }]}>
        {isToday ? t('insights.today') : shortDay.format(day.date).toUpperCase()}
      </Text>
      <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85} maxFontSizeMultiplier={1.5} style={[styles.calendarDate, { color: theme.textMuted }]}>
        {shortDate.format(day.date)}
      </Text>
    </Animated.View>
  );
}

function TimelineTrack({
  day,
  selectedTypes,
  savedEstimateIds,
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
  savedEstimateIds: ReadonlySet<string>;
  isToday: boolean;
  currentTime?: Date;
  rowHeight: number;
  trackWidth: number;
  gridHours: readonly number[];
  onSelectMarks: (ids: string[]) => void;
  theme: Theme;
}) {
  const { activityColors, activityLabel, language, t } = useLocalization();
  const marks = day.marks.filter((mark) => selectedTypes.includes(activityKey({ type: mark.type, customLabel: mark.label })));
  const recordedMarks = marks.filter((mark) => !mark.estimated);
  const interactiveMarks = marks.filter((mark) => !mark.estimated || savedEstimateIds.has(mark.id));
  const clusters = timelinePointClusters(interactiveMarks);
  const currentTimePosition = currentTime
    ? ((currentTime.getHours() * 60 + currentTime.getMinutes()) / (24 * 60)) * 100
    : undefined;

  return (
    <View
      style={[
        styles.timelineTrack,
        {
          height: rowHeight,
          marginVertical: 0,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderRadius: 0,
          backgroundColor: isToday ? theme.primarySoft : theme.surface,
          borderBottomColor: theme.border,
        },
      ]}
    >
      {gridHours.map((hour) => (
        <View key={hour} pointerEvents="none" style={[styles.gridLine, {
          backgroundColor: hour % 3 === 0 ? theme.textMuted : theme.border,
          opacity: hour % 3 === 0 ? 0.4 : 1,
          left: `${(hour / 24) * 100}%`,
        }]} />
      ))}
      {timelineDurationRuns(recordedMarks).map((mark) => {
        const color = activityColors(theme, { type: mark.type }).color;
        return (
          <View
            key={`${mark.type}-${mark.startBucket}`}
            pointerEvents="none"
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
      {interactiveMarks.filter((mark) => mark.endBucket !== undefined).map((mark) => (
        <Pressable
          key={mark.id}
          testID={`timeline.mark.duration.${day.key}.${mark.startBucket}`}
          accessibilityRole="button"
          accessibilityLabel={`${describeMark(mark, language, activityLabel, savedEstimateIds.has(mark.id))}. ${t('timeline.viewDetails')}`}
          hitSlop={{ top: 3, bottom: 3 }}
          onPress={() => onSelectMarks([mark.id])}
          style={({ pressed }) => [styles.durationMark,
            {
            left: `${(mark.startBucket / TIMELINE_BUCKETS) * 100}%`,
            width: `${((mark.endBucket! - mark.startBucket) / TIMELINE_BUCKETS) * 100}%`,
            backgroundColor: pressed ? theme.surface : 'transparent',
            opacity: pressed ? 0.4 : 1,
          }]}
        />
      ))}
      {clusters.map((cluster, index) => {
        const durationMarks = recordedMarks.filter((mark) => mark.endBucket !== undefined
          && mark.startBucket <= cluster.startBucket && mark.endBucket > cluster.startBucket);
        const pointMarks = recordedMarks.filter((mark) => cluster.ids.includes(mark.id));
        const selectedMarks = timelineMarksForPointHit(interactiveMarks, cluster.startBucket, savedEstimateIds);
        const colors = [...new Set([...durationMarks, ...pointMarks].map((mark) => activityColors(theme, { type: mark.type, customLabel: mark.label }).color))];
        const durationCount = new Set(durationMarks.map((mark) => activityColors(theme, { type: mark.type, customLabel: mark.label }).color)).size;
        const markWidth = colors.length > 1 ? Math.min(14, 6 + colors.length * 2) : 6;
        const center = (cluster.startBucket + 0.5) * trackWidth / TIMELINE_BUCKETS;
        const previous = clusters[index - 1];
        const next = clusters[index + 1];
        // Share dense tap space at the midpoint so a neighbor cannot steal the visible mark's tap.
        const left = Math.max(0, center - 24, previous ? (previous.startBucket + cluster.startBucket + 1) * trackWidth / (2 * TIMELINE_BUCKETS) : 0);
        const right = Math.min(trackWidth, center + 24, next ? (next.startBucket + cluster.startBucket + 1) * trackWidth / (2 * TIMELINE_BUCKETS) : trackWidth);
        return (
          <Pressable
            key={`${cluster.startBucket}-${cluster.ids.join('-')}`}
            testID={`timeline.mark.point.${day.key}.${cluster.startBucket}`}
            accessibilityRole="button"
            accessibilityLabel={`${selectedMarks.map((mark) => describeMark(mark, language, activityLabel, savedEstimateIds.has(mark.id))).join('. ')}. ${t('timeline.viewDetails')}`}
            onPress={() => onSelectMarks([...new Set(selectedMarks.map((mark) => mark.id))])}
            style={({ pressed }) => [
              styles.pointHitTarget,
              {
                left,
                width: right - left,
                opacity: pressed ? 0.6 : 1,
              },
            ]}
          >
            {colors.length ? <View pointerEvents="none" style={[styles.pointMark, { left: center - left - markWidth / 2, backgroundColor: colors[0], top: 3, height: rowHeight - 6, width: markWidth }]}>
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
            </View> : null}
          </Pressable>
        );
      })}
      {marks.filter((mark) => mark.estimated).map((mark) => {
        const color = activityColors(theme, { type: mark.type, customLabel: mark.label }).color;
        const duration = mark.endBucket !== undefined;
        const saved = savedEstimateIds.has(mark.id);
        return (
          <View
            key={mark.id}
            pointerEvents="none"
            style={[
              duration ? styles.durationMark : styles.estimatedPointMark,
              saved && styles.savedEstimateMark,
              saved && !duration && styles.savedEstimatePoint,
              {
                backgroundColor: saved ? theme.surface : color,
                borderColor: color,
                left: `${((mark.startBucket + (duration ? 0 : 0.5)) / TIMELINE_BUCKETS) * 100}%`,
                ...(duration ? { width: `${((mark.endBucket! - mark.startBucket) / TIMELINE_BUCKETS) * 100}%` } : {}),
                opacity: saved ? 1 : ESTIMATE_OPACITY,
              },
            ]}
          >
            {saved ? <Text allowFontScaling={false} style={[styles.estimateSymbol, { color: theme.text }]}>?</Text> : null}
          </View>
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
  trackWidth,
  horizontalOffset,
  theme,
}: {
  trackWidth: number;
  horizontalOffset: Animated.Value;
  theme: Theme;
}) {
  const { t } = useLocalization();
  const { fontScale } = useWindowDimensions();
  const staggerLabels = trackWidth / 24 < 22 * Math.min(fontScale, 1.4);
  const axisHeight = staggerLabels ? 42 : 30;
  const labelWidth = trackWidth / 12;
  return (
    <View style={[styles.axisRow, { height: axisHeight, backgroundColor: theme.background, borderColor: theme.border }]}>
      <Animated.View
        style={[
          styles.axisDateCell,
          {
            height: axisHeight,
            backgroundColor: theme.background,
            borderColor: theme.border,
            transform: [{ translateX: horizontalOffset }],
          },
        ]}
      >
        <Text maxFontSizeMultiplier={1.4} style={[styles.axisDateText, { color: theme.textMuted }]}>{t('timeline.date')}</Text>
      </Animated.View>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[styles.axisTrack, { height: axisHeight, width: trackWidth }]}
      >
        {AXIS_HOURS.map((hour) => (
          <Text
            key={hour}
            maxFontSizeMultiplier={1.4}
            style={[
              styles.axisLabel,
              hour === 0
                ? styles.axisStart
                : hour === 24
                  ? styles.axisEnd
                  : { left: `${(hour / 24) * 100}%`, marginLeft: -labelWidth / 2, textAlign: 'center' },
              { color: theme.textMuted, width: labelWidth, top: staggerLabels && hour % 2 ? 20 : 4 },
            ]}
          >
            {hour}
          </Text>
        ))}
        {GRID_HOURS.map((hour) => (
          <View key={hour} style={[styles.axisTick, { left: hour / 24 * trackWidth, backgroundColor: theme.textMuted }]} />
        ))}
      </View>
    </View>
  );
}

const MemoTimelineDateLabel = memo(TimelineDateLabel);
const MemoTimelineTrack = memo(TimelineTrack);
const MemoTimelineAxis = memo(TimelineAxis);

type TimelineProps={events:PuppyEvent[];customActivities:string[];theme:Theme}&ActivityViewProps;
export function TimelineScreen({ events:projectedEvents,activity,refreshToken,customActivities,theme }:TimelineProps) {
  const { activityColors, activityLabel, language, t } = useLocalization();
  const { fontScale, height, width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const activityFilters: ActivityKey[] = useMemo(() => [...quickEventTypes, ...customActivities.map(customActivityKey)], [customActivities]);
  const [selectedType, setSelectedType] = useState<ActivityKey | 'all'>('all');
  const selectedTypes = useMemo(() => selectedType === 'all' ? activityFilters : [selectedType], [activityFilters, selectedType]);
  useEffect(() => {
    if (selectedType !== 'all' && !activityFilters.includes(selectedType)) setSelectedType('all');
  }, [activityFilters, selectedType]);
  const [loadedDayCount, setLoadedDayCount] = useState(INITIAL_DAYS);
  const [timeScale, setTimeScale] = useState(1);
  const timeScaleLabel = timeScale.toFixed(2).replace(/0$/, '');
  const [nowTime, setNowTime] = useState(Date.now());
  const bounds=activityWindowBounds(nowTime,Math.max(loadedDayCount-1,INITIAL_DAYS));
  const window=useActivityWindow(activity,projectedEvents,bounds.from,bounds.until,refreshToken);
  const events=window.events;
  const [summary,setSummary]=useState<{eventCount:number;earliestAt:number|null}|null>(null);
  const [summaryError,setSummaryError]=useState(false),[summaryAttempt,setSummaryAttempt]=useState(0);
  useEffect(()=>{
    if(!activity)return;let current=true;setSummaryError(false);
    void activity.summary().then(value=>{if(current)setSummary(value);}).catch(()=>{if(current)setSummaryError(true);});
    return()=>{current=false;};
  },[activity,refreshToken,summaryAttempt]);
  const [selection, setSelection] = useState<string[]>([]);
  const [isLoadingEarlier, startLoadingEarlier] = useTransition();
  const rowHeight = Math.round(52 * Math.min(fontScale, 1.5));
  const viewportWidth = width - insets.left - insets.right;
  const baseTrackWidth = Math.max(1, viewportWidth - DATE_COLUMN_WIDTH);
  const trackWidth = baseTrackWidth * timeScale;
  const totalWidth = DATE_COLUMN_WIDTH + trackWidth;
  const now = useMemo(() => new Date(nowTime), [nowTime]);
  const estimates = useMemo(() => estimateMissingLogs(events, INITIAL_DAYS, now).estimates, [events, now]);
  const earliestEventAt = activity?summary?.earliestAt??nowTime:events.reduce((earliest, event) => Math.min(earliest, event.at), nowTime);
  const maxHistoryDays = (activity?summary?.eventCount:events.length)
    ? Math.max(INITIAL_DAYS, calendarDayDistance(new Date(earliestEventAt), now) + 1)
    : INITIAL_DAYS;
  const days = useMemo(
    () => buildTimelineDays(events, Math.min(loadedDayCount, maxHistoryDays), now, now, estimates),
    [events, estimates, loadedDayCount, maxHistoryDays, now],
  );
  const todayKey = dateKey(now);
  const rows = useMemo(() => collapseEmptyTimelineDays(days, todayKey), [days, todayKey]);
  const savedEstimateIds = useMemo(() => new Set(events.filter((event) => event.estimated).map((event) => event.id)), [events]);
  const visibleEventCount = new Set(
    days.flatMap((day) => day.marks.filter((mark) => !mark.estimated && selectedTypes.includes(activityKey({ type: mark.type, customLabel: mark.label }))).map((mark) => mark.id)),
  ).size;
  const visibleMarkCount = days.flatMap((day) => day.marks.filter((mark) => selectedTypes.includes(activityKey({ type: mark.type, customLabel: mark.label })))).length;
  const visibleEstimateCount = new Set(
    days.flatMap((day) => day.marks.filter((mark) => savedEstimateIds.has(mark.id) && selectedTypes.includes(activityKey({ type: mark.type, customLabel: mark.label }))).map((mark) => mark.id)),
  ).size;
  const hasVisibleGaps = days.some((day) => day.marks.some((mark) => mark.estimated && !savedEstimateIds.has(mark.id) && selectedTypes.includes(activityKey({ type: mark.type, customLabel: mark.label }))));
  const rangeLabel = days.length ? formatDateRange(days[0].date, days[days.length - 1].date, language) : '';
  const rangeDescription = visibleEstimateCount
    ? t('timeline.rangeWithEstimates', { range: rangeLabel, recorded: visibleEventCount, estimated: visibleEstimateCount })
    : t('timeline.range', { range: rangeLabel, count: visibleEventCount });
  const hasEarlierDays = loadedDayCount < maxHistoryDays;
  const isCompactHeight = height < 500;
  const selectedEvents = events.filter((event) => selection.includes(event.id)).sort((a, b) => a.at - b.at);
  const sharedDetailDay = selectedEvents.length && selectedEvents.every((event) => dateKey(new Date(event.at)) === dateKey(new Date(selectedEvents[0].at)))
    ? selectedEvents[0].at
    : undefined;
  const detailDate = sharedDetailDay === undefined ? undefined
    : dateKey(new Date(sharedDetailDay)) === todayKey
      ? `${t('log.today')} · ${timelineFormatters(language).shortDate.format(sharedDetailDay)}`
      : new Date(sharedDetailDay).getFullYear() === now.getFullYear()
        ? timelineFormatters(language).fullDate.format(sharedDetailDay)
        : timelineFormatters(language).rangeDate.format(sharedDetailDay);
  const listRef = useRef<FlatList<TimelineDay | TimelineGap>>(null);
  const horizontalRef = useRef<ScrollView>(null);
  const horizontalOffset = useRef(new Animated.Value(0)).current;
  const horizontalOffsetValue = useRef(0);
  const verticalOffsetValue = useRef(0);
  const didInitialScroll = useRef(false);
  const didUserScroll = useRef(false);
  const timeScaleValue = useRef(timeScale);
  const pendingHorizontalOffset = useRef<number | null>(null);
  const zoomMetrics = useRef({ baseTrackWidth, viewportWidth, gutter: 0 });
  const pinch = useRef({ distance: 0, scale: 1, offset: 0, focalX: 0 });
  timeScaleValue.current = timeScale;
  zoomMetrics.current = { baseTrackWidth, viewportWidth, gutter: 0 };

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

      const { baseTrackWidth: baseWidth, viewportWidth: viewport, gutter } = zoomMetrics.current;
      const focalX = Math.max(DATE_COLUMN_WIDTH, pinch.current.focalX);
      const oldTrackWidth = baseWidth * pinch.current.scale;
      const timeAtFocal = clamp(
        (pinch.current.offset + focalX - DATE_COLUMN_WIDTH - gutter) / Math.max(1, oldTrackWidth - gutter * 2),
        0,
        1,
      );
      const nextTrackWidth = baseWidth * nextScale;
      pendingHorizontalOffset.current = clamp(
        gutter + timeAtFocal * Math.max(1, nextTrackWidth - gutter * 2) - focalX + DATE_COLUMN_WIDTH,
        0,
        Math.max(0, DATE_COLUMN_WIDTH + nextTrackWidth - viewport),
      );
      timeScaleValue.current = nextScale;
      setTimeScale(nextScale);
    },
    onPanResponderTerminationRequest: () => false,
  }), []);

  function loadEarlierDays() {
    if (!hasEarlierDays || isLoadingEarlier || window.loading || window.error) return;
    // Consume the gesture once; more top-edge scroll events must not queue pages.
    didUserScroll.current = false;
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
    const { baseTrackWidth: baseWidth, viewportWidth: viewport, gutter } = zoomMetrics.current;
    const focalX = viewport / 2;
    const timeAtFocal = clamp(
      (horizontalOffsetValue.current + focalX - DATE_COLUMN_WIDTH - gutter) / Math.max(1, baseWidth * timeScaleValue.current - gutter * 2),
      0,
      1,
    );
    const nextTrackWidth = baseWidth * nextScale;
    pendingHorizontalOffset.current = clamp(
      gutter + timeAtFocal * Math.max(1, nextTrackWidth - gutter * 2) - focalX + DATE_COLUMN_WIDTH,
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

  const selectMarks = useCallback((ids: string[]) => setSelection(ids), []);

  return (
    <View
      testID="screen.timeline"
      style={[styles.screen, { backgroundColor: theme.background }]}
    >
      <ActivityLoadState loading={window.loading} error={window.error||summaryError} onRetry={()=>{window.retry();setSummaryAttempt(value=>value+1);}} theme={theme}/>
      <View
        style={[
          styles.header,
          isCompactHeight && styles.headerCompact,
          { backgroundColor: theme.background, borderColor: theme.border },
        ]}
      >
        <View style={[styles.headingRow,fontScale>=1.5&&!isCompactHeight&&styles.headingRowStacked]}>
          <View style={[styles.headingCopy,fontScale>=1.5&&!isCompactHeight&&styles.headingCopyStacked]}>
            <Text
              maxFontSizeMultiplier={2}
              style={[
                styles.title,
                {
                  color: theme.text,
                  fontSize: theme.presentation.titleSize,
                  lineHeight: theme.presentation.titleLineHeight,
                  fontWeight: theme.presentation.titleWeight,
                  fontFamily: theme.presentation.headingFont,
                  letterSpacing: theme.presentation.titleTracking,
                },
              ]}
            >
              {t('timeline.title')}
            </Text>
            {isCompactHeight ? (
              <Text testID="timeline.range" maxFontSizeMultiplier={2} style={[styles.rangeText, { flex: 0, color: theme.text }]}>
                {rangeDescription}
              </Text>
            ) : null}
          </View>
          <View
            style={[
              styles.zoomControl,
              fontScale>=1.5&&!isCompactHeight&&{alignSelf:'flex-start'},
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
              accessibilityLabel={`${t('insights.timeWidth')}: ${timeScaleLabel}×`}
              style={[styles.zoomValue, { color: theme.text }]}
            >
              {timeScaleLabel}×
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

        {!isCompactHeight ? (
          <View style={styles.timelineMeta}>
            <Text testID="timeline.range" maxFontSizeMultiplier={2} style={[styles.rangeText, { color: theme.text }]}>
              {rangeDescription}
            </Text>
          </View>
        ) : null}
        {hasVisibleGaps ? (
          <View style={styles.estimateLegend}>
            <View style={[styles.estimateLegendMark, { backgroundColor: theme.textMuted, opacity: ESTIMATE_OPACITY }]} />
            <Text style={[styles.estimateLegendText, { color: theme.textMuted }]}>{t('timeline.estimateLegend')}</Text>
          </View>
        ) : null}

        {visibleEstimateCount ? (
          <Text style={[styles.estimateLegendText, { color: theme.text }]}>{t('timeline.estimatedLegend')}</Text>
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
                  setSelection([]);
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

        {!isCompactHeight && !window.loading && !window.error && !summaryError && visibleMarkCount === 0 ? (
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
          scrollEnabled={timeScale > MIN_TIME_SCALE}
          directionalLockEnabled
          nestedScrollEnabled
          scrollEventThrottle={16}
          showsHorizontalScrollIndicator
          onScroll={horizontalScrollHandler}
          style={styles.horizontalScroller}
          contentContainerStyle={styles.horizontalContent}
        >
          <View style={[styles.timelineCanvas, { width: totalWidth }]}>
            <MemoTimelineAxis
              trackWidth={trackWidth}
              horizontalOffset={horizontalOffset}
              theme={theme}
            />
            <FlatList
              ref={listRef}
              data={rows}
              keyExtractor={(day) => day.key}
              renderItem={({ item: day }) => 'emptyDays' in day ? (
                <View style={{ height: rowHeight, width: totalWidth, backgroundColor: theme.background }}>
                  <Animated.View
                    testID={`timeline.gap.${day.key}`}
                    accessible
                    accessibilityLabel={`${formatDateRange(day.start, day.end, language)}. ${t('timeline.emptyDays', { count: day.emptyDays })}`}
                    style={[styles.gapRow, { height: rowHeight, width: viewportWidth, borderColor: theme.border, transform: [{ translateX: horizontalOffset }] }]}
                  >
                    <Text accessibilityElementsHidden importantForAccessibility="no" style={[styles.gapDots, { color: theme.textMuted }]}>⋮</Text>
                    <View style={styles.gapCopy}>
                      <Text maxFontSizeMultiplier={1.5} style={[styles.gapLabel, { color: theme.textMuted }]}>{t('timeline.emptyDays', { count: day.emptyDays })}</Text>
                      <Text maxFontSizeMultiplier={1.5} style={[styles.gapDates, { color: theme.textMuted }]}>{formatDateRange(day.start, day.end, language)}</Text>
                    </View>
                  </Animated.View>
                </View>
              ) : (
                <View style={[styles.dayRow, { height: rowHeight, width: totalWidth }]}>
                  <MemoTimelineDateLabel
                    day={day}
                    selectedTypes={selectedTypes}
                    savedEstimateIds={savedEstimateIds}
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
                      savedEstimateIds={savedEstimateIds}
                      isToday={day.key === todayKey}
                      currentTime={day.key === todayKey ? now : undefined}
                      rowHeight={rowHeight}
                      trackWidth={trackWidth}
                      gridHours={GRID_HOURS}
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
                  disabled={!hasEarlierDays || isLoadingEarlier || window.loading || window.error}
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
      <Modal
        visible={selectedEvents.length > 0}
        transparent
        animationType="none"
        presentationStyle="overFullScreen"
        statusBarTranslucent
        navigationBarTranslucent
        onRequestClose={() => setSelection([])}
      >
        <View style={styles.detailsModal} accessibilityViewIsModal>
          <Pressable
            testID="timeline.details.backdrop"
            accessibilityRole="button"
            accessibilityLabel={t('timeline.closeDetails')}
            onPress={() => setSelection([])}
            style={styles.detailsBackdrop}
          />
          <View
            testID="timeline.details"
            style={[styles.detailsSheet, {
              backgroundColor: theme.surfaceRaised,
              maxHeight: height * 0.8,
              paddingBottom: insets.bottom + spacing.sm,
            }]}
          >
            <View style={[styles.detailsHeading, { borderColor: theme.border }]}>
              <View style={styles.detailsHeadingCopy}>
                <Text style={[styles.detailsTitle, { color: theme.text }]}>{t('timeline.details')}</Text>
                {detailDate ? <Text testID="timeline.details.date" style={[styles.detailsTime, { color: theme.textMuted }]}>{detailDate}</Text> : null}
              </View>
              <Pressable
                testID="timeline.details.close"
                accessibilityRole="button"
                accessibilityLabel={t('timeline.closeDetails')}
                onPress={() => setSelection([])}
                style={({ pressed }) => [styles.detailsClose, { opacity: pressed ? 0.5 : 1 }]}
              >
                <MaterialCommunityIcons name="close" size={24} color={theme.text} />
              </Pressable>
            </View>
            <ScrollView nestedScrollEnabled style={styles.detailsScroll} contentContainerStyle={styles.detailsList}>
              {selectedEvents.map((event, index) => {
                const colors = activityColors(theme, event);
                const running = isOpenNap(event);
                const end = typeof event.endedAt === 'number'
                  ? timelineDetailTime(event.endedAt, language, sharedDetailDay)
                  : null;
                return (
                  <View key={event.id} style={[styles.detailsEvent, { borderColor: theme.border, borderBottomWidth: index === selectedEvents.length - 1 ? 0 : StyleSheet.hairlineWidth }]}>
                    <View style={[styles.detailsIcon, { backgroundColor: colors.softColor }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                      <ActivityIcon activity={event} theme={theme} color={colors.color} size={24} />
                    </View>
                    <View style={styles.detailsCopy}>
                      <View style={styles.detailsSummary}>
                        <Text testID={`timeline.details.event.${event.id}`} style={[styles.detailsEventTitle, { color: theme.text }]}>
                          {activityLabel(event)}{event.estimated ? ` · ${t('eventRow.estimated')}` : ''}
                        </Text>
                        <Text style={[styles.detailsTime, { color: theme.textMuted }]}>{timelineDetailTime(event.at, language, sharedDetailDay)}</Text>
                      </View>
                      {end || running ? (
                        <Text style={[styles.detailsTime, { color: theme.textMuted }]}>
                          → {end ?? t('eventRow.now')} · {formatDuration((event.endedAt ?? nowTime) - event.at)}{running ? ` ${t('eventRow.running')}` : ''}
                        </Text>
                      ) : null}
                      {event.note?.trim() ? <Text style={[styles.detailsNote, { color: theme.text }]}>{event.note.trim()}</Text> : null}
                    </View>
                  </View>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
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
  headingRowStacked: { flexDirection: 'column', alignItems: 'stretch' },
  headingCopy: { flex: 1, minWidth: 0 },
  headingCopyStacked: { flex: 0, width: '100%' },
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
  axisRow: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth, zIndex: 4 },
  axisDateCell: {
    width: DATE_COLUMN_WIDTH,
    borderRightWidth: StyleSheet.hairlineWidth,
    justifyContent: 'center',
    paddingLeft: 6,
    zIndex: 5,
  },
  axisDateText: { fontSize: 9, lineHeight: 12, fontWeight: '800', letterSpacing: 0.7 },
  axisTrack: { position: 'relative' },
  axisTick: { position: 'absolute', bottom: 0, height: 4, width: StyleSheet.hairlineWidth },
  axisLabel: { position: 'absolute', fontSize: 10, lineHeight: 14, fontWeight: '600', fontVariant: ['tabular-nums'] },
  axisStart: { left: 1, textAlign: 'left' },
  axisEnd: { right: 1, textAlign: 'right' },
  dayList: { flex: 1 },
  dayRow: { flexDirection: 'row' },
  gapRow: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth },
  gapDots: { width: DATE_COLUMN_WIDTH, textAlign: 'center', fontSize: 24 },
  gapCopy: { flex: 1, paddingHorizontal: 8 },
  gapLabel: { fontSize: 12, lineHeight: 17, fontWeight: '600' },
  gapDates: { fontSize: 11, lineHeight: 16 },
  dateCell: {
    width: DATE_COLUMN_WIDTH,
    flexShrink: 0,
    justifyContent: 'center',
    paddingLeft: 6,
    paddingRight: 2,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    zIndex: 3,
  },
  weekday: { fontSize: 10, lineHeight: 13, fontWeight: '800', letterSpacing: 0.35 },
  calendarDate: { fontSize: 10, lineHeight: 13, fontWeight: '600', marginTop: 1 },
  timelineTrack: { width: '100%', borderBottomWidth: StyleSheet.hairlineWidth, position: 'relative', overflow: 'hidden' },
  gridLine: { position: 'absolute', top: 0, bottom: 0, width: 1 },
  pointHitTarget: { position: 'absolute', top: 0, bottom: 0, justifyContent: 'center', zIndex: 2 },
  pointMark: { position: 'absolute', top: 3, borderRadius: 999, overflow: 'hidden' },
  estimatedPointMark: { position: 'absolute', top: 3, bottom: 3, width: 6, marginLeft: -3, borderRadius: 999, zIndex: 2 },
  savedEstimateMark: { minWidth: 14, borderWidth: 1, borderStyle: 'dashed', borderRadius: 3, justifyContent: 'center' },
  savedEstimatePoint: { width: 14, marginLeft: -7 },
  estimateSymbol: { fontSize: 12, lineHeight: 17, textAlign: 'center', fontWeight: '700' },
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
  detailsModal: { flex: 1, justifyContent: 'flex-end' },
  detailsBackdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(0, 0, 0, 0.42)' },
  detailsSheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, overflow: 'hidden' },
  detailsHeading: { minHeight: 64, paddingVertical: spacing.sm, marginHorizontal: spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: StyleSheet.hairlineWidth },
  detailsHeadingCopy: { flex: 1, gap: spacing.xs },
  detailsTitle: { fontSize: 20, fontWeight: '800' },
  detailsClose: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  detailsScroll: { flexGrow: 0, flexShrink: 1 },
  detailsList: { paddingHorizontal: spacing.md },
  detailsEvent: { minHeight: 64, flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, paddingVertical: 12 },
  detailsIcon: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  detailsCopy: { flex: 1, gap: 2 },
  detailsSummary: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', columnGap: spacing.sm, rowGap: 2 },
  detailsEventTitle: { fontSize: 16, fontWeight: '700', flexShrink: 1 },
  detailsTime: { fontSize: 14, flexShrink: 1 },
  detailsNote: { fontSize: 14, lineHeight: 20, marginTop: spacing.xs },
});

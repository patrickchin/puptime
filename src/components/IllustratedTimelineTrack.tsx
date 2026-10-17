import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { TIMELINE_BUCKET_MINUTES, TIMELINE_BUCKETS, timelineMarkerGroups, type TimelineDay } from '../analytics';
import { activityCombinationIndex } from '../activity-artwork';
import { activityKey, type ActivityKey } from '../domain';
import { useLocalization } from '../localization-context';
import { headingStyle, type Theme } from '../theme';
import { timelineFormatters } from '../timeline-format';
import { ActivityCombinationIcon, ActivityIcon } from './ActivityIcon';

export const TIMELINE_ART_GUTTER = 24;

/** A shared time line, with screen-space collisions collected into one tappable bundle. */
export const IllustratedTimelineTrack = memo(function IllustratedTimelineTrack({
  day, selectedTypes, savedEstimateIds, currentTime, rowHeight, trackWidth, theme, onSelectMarks,
}: {
  day: TimelineDay;
  selectedTypes: readonly ActivityKey[];
  savedEstimateIds: ReadonlySet<string>;
  isToday: boolean;
  gridHours: readonly number[];
  currentTime?: Date;
  rowHeight: number;
  trackWidth: number;
  theme: Theme;
  onSelectMarks: (ids: string[]) => void;
}) {
  const { activityLabel, language, t } = useLocalization();
  const journal = theme.presentation.iconProfile === 'puppy-journal';
  const soft = theme.presentation.iconProfile === 'soft-play';
  const plotWidth = Math.max(1, trackWidth - TIMELINE_ART_GUTTER * 2);
  const baseline = rowHeight / 2;
  const marks = day.marks.filter(mark => mark.endBucket === undefined && selectedTypes.includes(activityKey({ type: mark.type, customLabel: mark.label })));
  const groups = timelineMarkerGroups(marks.filter(mark => !mark.estimated || savedEstimateIds.has(mark.id)), plotWidth);
  const tickHours = [0, 6, 12, 18, 24];
  const time = (bucket: number) => timelineFormatters(language).time.format(new Date(2000, 0, 1, 0, bucket * TIMELINE_BUCKET_MINUTES));
  const railColor = journal ? '#B8CADA' : soft ? '#C9D9F7' : '#CEB590';

  return (
    <View testID={`timeline.track.${day.key}`} style={{ height: rowHeight, width: trackWidth }}>
      {soft ? <View pointerEvents="none" style={[StyleSheet.absoluteFill, { marginVertical: 7, marginHorizontal: 3, borderRadius: 28, backgroundColor: '#FDFEFF', borderWidth: 1, borderColor: '#E0E8F7' }]} /> : null}
      {journal ? <View pointerEvents="none" style={{ position: 'absolute', top: 0, bottom: 0, left: 9, width: 1, backgroundColor: '#E8BAB0' }} /> : null}
      <View pointerEvents="none" style={{ position: 'absolute', top: baseline - (soft ? 4 : 1), left: TIMELINE_ART_GUTTER, width: plotWidth, height: soft ? 8 : journal ? 1 : 3, borderRadius: 8, backgroundColor: journal || soft ? railColor : 'transparent', borderTopWidth: journal || soft ? 0 : 3, borderColor: railColor, borderStyle: 'dashed' }} />
      {tickHours.map(hour => <View key={hour} pointerEvents="none" style={{ position: 'absolute', left: TIMELINE_ART_GUTTER + hour / 24 * plotWidth - (soft ? 3 : 1), top: baseline - (soft ? 3 : 4), width: soft ? 6 : 2, height: soft ? 6 : 8, borderRadius: soft ? 3 : 1, backgroundColor: soft ? '#A3BDE8' : railColor }} />)}
      {marks.filter(mark => mark.estimated && !savedEstimateIds.has(mark.id)).map(mark => (
        <View key={mark.id} pointerEvents="none" style={{ position: 'absolute', left: TIMELINE_ART_GUTTER + (mark.startBucket + 0.5) / TIMELINE_BUCKETS * plotWidth - 16, top: baseline - 16, opacity: 0.22 }}>
          <ActivityIcon activity={{ type: mark.type }} theme={theme} size={32} color={theme.textMuted} />
        </View>
      ))}
      {groups.map((group, index) => {
        const center = TIMELINE_ART_GUTTER + group.center;
        const hitLeft = Math.max(center - 24, index === 0 ? 0 : TIMELINE_ART_GUTTER + (groups[index - 1].center + group.center) / 2);
        const hitRight = Math.min(center + 24, index === groups.length - 1 ? trackWidth : TIMELINE_ART_GUTTER + (group.center + groups[index + 1].center) / 2);
        const activities = [...new Set(group.marks.map(mark => mark.type))];
        const combinationIndex = activityCombinationIndex(activities);
        const merged = group.marks.length > 1;
        const estimated = group.marks.some(mark => mark.estimated);
        const description = group.marks.map(mark => `${activityLabel({ type: mark.type, customLabel: mark.label })}, ${time(mark.startBucket)}${mark.estimated ? `, ${t('eventRow.estimated')}` : ''}`).join('. ');
        return (
          <Pressable key={group.marks[0].id}
            testID={`timeline.mark.point.${day.key}.${group.firstBucket}`}
            accessibilityRole="button" accessibilityLabel={`${description}. ${t('timeline.viewDetails')}`}
            onPress={() => onSelectMarks(group.marks.map(mark => mark.id))}
            style={({ pressed }) => ({ position: 'absolute', left: hitLeft, width: hitRight - hitLeft, height: rowHeight, opacity: pressed ? 0.6 : 1 })}>
            <View pointerEvents="none" style={{ position: 'absolute', left: center - hitLeft - 21, top: baseline - 21, width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: journal ? 7 : soft ? 21 : 13, backgroundColor: merged ? journal ? '#FFFDF4' : soft ? '#EBF1FF' : '#F4E5C9' : 'transparent', borderWidth: merged ? 1 : 0, borderColor: journal ? '#D7C5A5' : soft ? '#CAD8F3' : '#CDB38D', borderStyle: estimated ? 'dashed' : 'solid', transform: journal ? [{ rotate: index % 2 ? '3deg' : '-3deg' }] : [] }}>
              <View style={{ width: 40, height: 38, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
                {combinationIndex === undefined
                  ? <ActivityIcon activity={{ type: activities[0] }} theme={theme} size={38} color={theme.text} />
                  : <ActivityCombinationIcon index={combinationIndex} theme={theme} size={40} />}
              </View>
              {merged || estimated ? <View testID={`timeline.cluster.${day.key}.${group.firstBucket}`} style={{ position: 'absolute', right: -3, bottom: -4, minWidth: 20, height: 20, borderRadius: soft ? 10 : 6, paddingHorizontal: 3, backgroundColor: theme.primary, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: theme.background }}>
                <Text maxFontSizeMultiplier={1} style={[headingStyle(theme), { color: theme.onPrimary, fontSize: 12, lineHeight: 16 }]}>{merged ? `${group.marks.length}${estimated ? '?' : ''}` : '?'}</Text>
              </View> : null}
            </View>
          </Pressable>
        );
      })}
      {currentTime ? <View pointerEvents="none" style={{ position: 'absolute', left: TIMELINE_ART_GUTTER + (currentTime.getHours() * 60 + currentTime.getMinutes()) / 1440 * plotWidth, top: 8, bottom: 8, width: 1, backgroundColor: theme.primary, opacity: 0.65 }} /> : null}
    </View>
  );
});

# How Puptime learns patterns

Puptime does not use machine learning, a language model, or a server. Its suggestions come from deterministic statistics over the activity stored on the device. The same history always produces the same result for a given time and time zone.

Suggestions are evidence about the log, not claims about the puppy. A missing meal log can mean that the meal was not recorded; Puptime does not assert that the puppy ate. Possible gaps appear as faded timeline marks and are never added to stored history automatically.

## Shared definitions

- Descriptive statistics and missing-log checks use the last 14 local calendar days, including today up to the current time. Routine learning uses the last 14 **completed** local calendar days; today's unfinished log cannot be mistaken for a day with skipped later activities.
- An **active day** or **recorded day** is a day containing at least one recorded log of any type. Completely blank days are excluded because Puptime cannot distinguish an inactive day from an entirely unlogged one.
- A time of day is represented as minutes after local midnight.
- A median or quartile uses a sorted list with linear interpolation between adjacent values when needed.
- Pattern learning considers `pee`, `poop`, `meal`, `pottyTrip`, `walk`, and `nap`. Custom activities are not learned.

## Constants

| Rule | Value |
| --- | ---: |
| Lookback window | 14 calendar days |
| Recorded days needed for a routine suggestion | 3 |
| Maximum learned occurrences of one activity per day | 8 |
| Learned-time rounding | nearest 15 minutes |
| Candidate learning window | ±90 minutes |
| Days needed to keep a window | at least 3 and strictly more than half of recorded days |
| Learned variation | central 80% of daily samples, symmetric about the rounded median |
| Minimum learned matching tolerance | ±30 minutes |
| Manually added routine matching tolerance | ±30 minutes |
| Active days needed before checking for missing logs | 4 |
| Missing-log matching tolerance | ±90 minutes |
| Other active days needed as evidence | at least 3 |
| Required recurrence on other active days | at least 75% |
| Completed naps needed to estimate duration | 3 |
| Accepted nap duration samples | 10 minutes through 6 hours |

## Learning a routine

`suggestScheduleFromEvents` finds recurring clock-time windows independently for each activity type:

1. Keep recorded events from the last 14 completed days and collect the recorded days, including days with only custom activities. Saved estimates are excluded.
2. Stop if fewer than 3 days contain activity.
3. Try each remaining event time as a candidate center. Collect the closest same-type event within 90 minutes on each recorded day, with at most one sample per day. Clock distances wrap around midnight, so 23:55 and 00:05 are close.
4. Choose the candidate supported by the most distinct days. Break ties by the smallest mean absolute distance to the candidate, then by sorted clock time. Input order does not change the result.
5. Keep it only when at least `max(3, floor(recorded days / 2) + 1)` days support it. Days with no log of this type remain in the denominator; one busy day cannot create a recurring pattern by itself.
6. Align the samples around the candidate before taking their median, then round the median to the nearest 15 minutes. Aligning avoids a noon median for logs either side of midnight.
7. Calculate the distance from the rounded median to the 10th and 90th percentiles. Use the larger distance, rounded **outward** to 15 minutes with a minimum of 30 minutes, as the window's symmetric tolerance. This keeps a rare extreme from setting the whole window's width.
8. Remove all same-type events in the candidate's 90-minute neighborhood before finding the next window. Repeated taps in that neighborhood cannot create additional slots. Stop when no remaining candidate has enough supporting days, or after 8 windows for one type. The algorithm does not force a median daily count into the schedule.
9. Return the windows in chronological order with their supporting-day counts. Support counts refer to the candidate neighborhood; the displayed typical window deliberately need not include every supporting sample. They are observations, not probabilities.

For example, breakfast around 09:00 and dinner around 19:00 stay separate even when breakfast is absent on several days. Dinner is grouped with other evening meals rather than being treated as that day's first meal. A rare 03:00 meal contributes no new window unless it also recurs on most recorded days.

The review shows the learned variation and the number of supporting days. Applying a suggestion saves its tolerance alongside its central time, so the daily routine uses that variation too. Moving a learned time shifts its window; changing its activity clears the learned tolerance. Suggested reminders are off by default and use the central time if enabled. Existing and manually added times retain their normal tolerance.

## Matching logs to expected times

`scheduleStatusesForDay` is shared by the daily routine and missing-log estimator.

For a given day, each expected time is connected to actual events of the same type inside the allowed tolerance. Future-dated events and saved estimates are excluded. Puptime processes the possible matches nearest-first and uses an augmenting-path reassignment algorithm: if the nearest event is already assigned, it tries to move that event's previous expected time to another compatible event. This prevents one log from satisfying two planned times and finds as many one-to-one matches as possible within the day's plan. Learned windows that cross midnight can match events from the adjacent calendar day; manually added times match only the chosen day.

An expected time is then classified as:

- **done** when an event was matched;
- **upcoming** before the tolerance window;
- **due** inside the tolerance window; or
- **missed** internally after the window closes without a match. The routine displays this as **No log**, using neutral styling: an event may have shifted, been skipped, or simply not been recorded.

The routine uses the larger of ±30 minutes and the entry's learned tolerance. Missing-log estimation uses the larger of ±90 minutes and the learned tolerance to avoid treating ordinary timing variation as missing data. Windows are guides, not deadlines, and the app cannot determine why an event is absent.

## Finding possible missing logs

`estimateMissingLogs` starts with the learned routine above, then checks each active day against it:

1. Require at least 4 active days and at least one learned time.
2. Match every learned time on every active day with at least a ±90-minute tolerance.
3. Consider only a learned time classified as **missed** after its window has passed.
4. Require another log later on the same day. This is evidence that logging continued after the gap.
5. If any log of this type on that day remains unmatched, withhold the estimate: that log could be a shifted occurrence. Look at the same learned slot on other active days whose window has passed, or which already have a match; unfinished comparison windows are not evidence of absence.
6. Require at least 3 matches and matches on at least 75% of those other days.
7. Suggest the learned 15-minute time and show the evidence as “seen on X of Y other active days.”

The 75% figure is an evidence threshold, not a calibrated probability that an activity happened. Puptime intentionally says that a log **may** be missing rather than displaying a false probability score.

No suggestions are made for completely blank days, future windows, weak patterns, or custom activities. Estimates appear automatically on the timeline for the current 14-day analysis window. These unsaved marks remain separate from real logs and are excluded from counts, exports, and reminders. Saved estimated entries retain a persistent **Estimated** label, including after editing or importing. They suppress the same suggestion, but never serve as evidence for other suggestions, routine learning, completion, or recorded averages.

### Example: missing meal

Suppose 7 active days normally contain meals around 08:00, 12:00, and 18:00. One day contains breakfast, dinner, and later activity but no event within 90 minutes of noon. If the noon slot matched on at least 3 and at least 75% of the other 6 days, Puptime suggests a meal around the learned noon time.

## Estimating an unlogged nap

A nap suggestion must pass every missing-log rule plus stricter duration checks:

1. Collect completed naps matched to the same learned start-time slot on the other active days.
2. Ignore open naps, legacy point-only nap logs, and durations shorter than 10 minutes or longer than 6 hours.
3. Require at least 3 valid durations and use their median as the estimated duration.
4. Add that duration to the learned start time and round to whole milliseconds to estimate the end.
5. Do not suggest the nap if its estimated end is still in the future.
6. Do not suggest it if another activity was logged between the estimated start and end.
7. Require a log at or after the estimated end as evidence that logging resumed.

For durations of 80, 90, and 100 minutes, the estimated duration is 90 minutes. A learned 13:00 start therefore produces an estimated 13:00–14:30 nap.

This estimates naps only. It does not infer overnight sleep from general inactivity.

## Descriptive statistics that are not learned suggestions

The Insights frequency card is descriptive rather than predictive:

- Daily average is `matching logs / recorded days`, including zeroes on days where another activity was logged.
- Daily range is the minimum and maximum count across those recorded days.
- Typical gap is the median interval between consecutive matching logs.
- “Middle half” is the 25th-to-75th-percentile interval range.

These values use recorded logs only. Saved estimates are counted separately and do not affect averages, gaps, or recorded-day counts. These statistics do not create routine times or missing-log suggestions.

## Limits

- Patterns use local wall-clock time. Travel or a time-zone change can shift apparent routines.
- The algorithm does not model weekdays, weekends, age, notes, feeding quantities, or relationships between activities.
- Learning groups nearby occurrences into a single window and can merge distinct routines within three hours. Widely scattered times may produce no suggestion. It is a conservative clock-time heuristic, not a model of activity sequences or the reasons a day changed.
- Missing-log checks withhold estimates when an unmatched same-type event could explain a shift. This reduces false gaps but can also hide a real missing log on a day with an extra event.
- The daily matcher prevents reuse within one day's plan. Matching independently requested plans on adjacent days does not coordinate assignments across those calls.
- A repeated biological event can still vary naturally. The estimator identifies plausible log gaps, not facts or veterinary concerns.
- A completely unlogged day provides no evidence and is intentionally left uninterpreted.

## Implementation map

| Behavior | Source |
| --- | --- |
| Windowing, percentiles, routine learning | `src/analytics.ts` — `windowedEvents`, `percentile`, `suggestScheduleFromEvents` |
| One-to-one event matching and statuses | `src/analytics.ts` — `scheduleStatusesForDay` |
| Missing-log and nap estimates | `src/analytics.ts` — `estimateMissingLogs` |
| Uncertain timeline display | `src/screens/TimelineScreen.tsx` — faded marks and accessibility labels |
| Executable examples and edge cases | `src/analytics.test.ts` |

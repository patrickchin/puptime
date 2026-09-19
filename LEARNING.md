# How Puptime learns patterns

Puptime does not use machine learning, a language model, or a server. Its suggestions come from deterministic statistics over the activity stored on the device. The same history always produces the same result for a given time and time zone.

Suggestions are evidence about the log, not claims about the puppy. A missing meal log can mean that the meal was not recorded; Puptime does not assert that the puppy ate. Nothing inferred is added to history until the user reviews it and taps **Add log**.

## Shared definitions

- The default analysis window is the last 14 local calendar days, including today up to the current time.
- An **active day** or **recorded day** is a day containing at least one log of any type. Completely blank days are excluded because Puptime cannot distinguish an inactive day from an entirely unlogged one.
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
| Normal routine matching tolerance | ±30 minutes |
| Active days needed before checking for missing logs | 4 |
| Missing-log matching tolerance | ±90 minutes |
| Other active days needed as evidence | at least 3 |
| Required recurrence on other active days | at least 75% |
| Completed naps needed to estimate duration | 3 |
| Accepted nap duration samples | 10 minutes through 6 hours |

## Learning a routine

`suggestScheduleFromEvents` learns recurring positions within each activity type:

1. Keep events inside the analysis window and collect the recorded days.
2. Stop if fewer than 3 days contain activity.
3. Group events by activity type and day, then sort each day's times from earliest to latest.
4. For each type, count its logs on every recorded day. Days with other activity but none of this type contribute a zero.
5. Set the expected daily count to the rounded median of those counts, clamped from 0 to 8.
6. For each ordinal position—first meal, second meal, and so on—collect that position's time from every day where it exists.
7. Keep the position only when it appears on at least `max(3, ceil(recorded days / 2))` days.
8. Take the median time, round it to the nearest 15 minutes, and remove duplicate type/time pairs.
9. Return the learned times in chronological order. Suggested reminders are off by default.

For example, if most active days contain meals near 08:00, 12:00, and 18:00, the median daily count is 3. Puptime learns a first, second, and third meal slot independently. One missing lunch shifts that day's second meal later, but the median remains resistant while most days contain the usual lunch.

## Matching logs to expected times

`scheduleStatusesForDay` is shared by the daily routine and missing-log estimator.

For a given day, each expected time is connected to actual events of the same type inside the allowed tolerance. Puptime processes the possible matches nearest-first and uses an augmenting-path reassignment algorithm: if the nearest event is already assigned, it tries to move that event's previous expected time to another compatible event. This prevents one log from satisfying two planned times and finds as many one-to-one matches as possible.

An expected time is then classified as:

- **done** when an event was matched;
- **upcoming** before the tolerance window;
- **due** inside the tolerance window; or
- **missed** after the window closes without a match.

The routine UI uses a ±30-minute tolerance. Missing-log estimation deliberately uses a wider ±90-minute tolerance to avoid treating ordinary timing variation as missing data.

## Finding possible missing logs

`estimateMissingLogs` starts with the learned routine above, then checks each active day against it:

1. Require at least 4 active days and at least one learned time.
2. Match every learned time on every active day with the ±90-minute tolerance.
3. Consider only a learned time classified as **missed** after its window has passed.
4. Require another log later on the same day. This is evidence that logging continued after the gap.
5. Look at the same learned slot on all other active days.
6. Require at least 3 matches and matches on at least 75% of those other days.
7. Suggest the learned 15-minute time and show the evidence as “seen on X of Y other active days.”

The 75% figure is an evidence threshold, not a calibrated probability that an activity happened. Puptime intentionally says that a log **may** be missing rather than displaying a false probability score.

No suggestions are made for completely blank days, future windows, weak patterns, or custom activities. Adding a suggestion creates a normal, editable app log at the estimated time; undo remains available.

### Example: missing meal

Suppose 7 active days normally contain meals around 08:00, 12:00, and 18:00. One day contains breakfast, dinner, and later activity but no event within 90 minutes of noon. If the noon slot matched on at least 3 and at least 75% of the other 6 days, Puptime suggests a meal around the learned noon time.

## Estimating an unlogged nap

A nap suggestion must pass every missing-log rule plus stricter duration checks:

1. Collect completed naps matched to the same learned start-time slot on the other active days.
2. Ignore open naps, legacy point-only nap logs, and durations shorter than 10 minutes or longer than 6 hours.
3. Require at least 3 valid durations and use their median as the estimated duration.
4. Add that duration to the learned start time to estimate the end.
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

These values do not create routine times or missing-log suggestions.

## Limits

- Patterns use local wall-clock time. Travel or a time-zone change can shift apparent routines.
- The algorithm does not model weekdays, weekends, age, notes, feeding quantities, or relationships between activities.
- Ordinal matching works best for stable routines. If an early occurrence is genuinely skipped, later occurrences can shift position for that day.
- A repeated biological event can still vary naturally. The estimator identifies plausible log gaps, not facts or veterinary concerns.
- A completely unlogged day provides no evidence and is intentionally left uninterpreted.

## Implementation map

| Behavior | Source |
| --- | --- |
| Windowing, percentiles, routine learning | `src/analytics.ts` — `windowedEvents`, `percentile`, `suggestScheduleFromEvents` |
| One-to-one event matching and statuses | `src/analytics.ts` — `scheduleStatusesForDay` |
| Missing-log and nap estimates | `src/analytics.ts` — `estimateMissingLogs` |
| User review and evidence display | `src/screens/InsightsScreen.tsx` |
| Confirmation, persistence, and undo | `App.tsx` — `addEstimatedEvent` |
| Executable examples and edge cases | `src/analytics.test.ts` |

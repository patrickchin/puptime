# Conversational onboarding end-to-end coverage

Run the conversational native entry (`index.onboarding-preview.tsx`) on a
dedicated simulator with synthetic data. These flows clear the installation.
The current verification target is iOS; the Apple wheel boundary flow and native
failure runner specifically require iOS. This suite does not establish Android
coverage.

```sh
maestro --device DEVICE_ID test .maestro/conversational
node scripts/verify-ios-conversational-failures.mjs DEVICE_ID \
  --replace-synthetic build/onboarding-failure-results
```

The iOS Simulator PR workflow runs both commands and uploads Maestro reports,
screenshots, and the failure runner's `verification.json`. The failure runner
accepts only a dedicated `Puptime …Onboarding…` simulator, rejects cloud-owned
history, and backs up the previous synthetic SQLite directory before clearing it.

## Decision and transition matrix

Flow numbers below refer to `.maestro/conversational/NN-*.yaml`.

| Screen or behavior | Cases exercised | Flows |
| --- | --- | --- |
| Welcome | Guest; Apple, Google, and email preview dialogs, each canceled and continued as guest; return from profile | 04 |
| Name | Enter, preserve through Back, trim surrounding spaces, empty/whitespace fallback, skip clears a previous answer, 256-character limit | 03, 04 |
| Age | All four age bands and their meal recommendations; skip; Back to name | 03–05 |
| Meal count | One, two, three, four; defaults for each; skip; same count preserves edits; changed count resets defaults | 03–08 |
| Meal times | Grouped times; wheel edit; Done, Cancel, and outside dismissal; skip; Back | 01, 05, 08, 16 |
| Poop windows | Defaults after meals, editable start and fixed 30-minute window, muted meal reference stays fixed, Back retains edits, changed meals regenerate windows | 01, 05, 16 |
| Optional plan | Keep both, meals only, poop only after either meal skip, skip both | 01, 03, 06–08 |
| Review | Actual timeline, forward to reminders, secondary return to poop windows, Back | 01, 05, 09 |
| Reminder rules | Both toggle states for all four rules; every timing option (10 each for meal/poop, 7 each for after-meal/after-wee); Cancel/outside dismissal; Back retains selections | 09 |
| Unavailable reminders | Meal or poop scheduled reminder disabled when corresponding entries are absent | 03, 06, 07 |
| Device permission | Defer, actual OS Allow, actual OS Don't Allow, already granted, already blocked; Back and retry; normal Notifications reflects delivery state | 01, 03, 09–12 |
| Ready | Back to reminders; show tutorial; explore without tutorial | 01–03, 05, 09–12 |
| Tutorial | Dismiss without creating a log; real meal, pee, and poop quick actions | 01, 02, 13, 14 |
| Handoff | Real Log/Timeline/navigation instead of preview routes; saved Schedule/Notifications; completed state survives cold restart | 01–16 |
| Interrupted draft | Stop before completion, reopen at welcome, finish a fresh draft without leaking earlier meal choices | 15 |
| Native time boundaries | Apple hour, minute and AM/PM wheels; noon to midnight; a poop window spanning midnight; persistence in normal Schedule | 16 |

Each new completed route uses the shared normal-app assertion: the real Today
screen is visible, preview navigation and spotlight are absent, Timeline and Log
navigation work, and a cold restart stays in the normal app. The existing full
routes also inspect saved plan/reminder values and real logged events.

## Real storage failures and retry

`scripts/verify-ios-conversational-failures.mjs` installs temporary SQLite
triggers in the actual simulator database. There are no production test hooks or
mocked successful saves. It checks:

1. Notification intent write failure: stay on reminders with the chosen delay,
   then retry successfully.
2. Notification deferral write failure: stay on reminders without claiming the
   delivery setting changed, then retry successfully.
3. Schedule write failure: stay on Ready; completion marker remains unset.
4. Notification preference write failure: same guard, then navigate back through
   the answers and verify the name, edited times and reminder delay survive.
5. Completion marker write failure: stay on Ready without entering the real app.
6. Successful retry: keep the exact routine IDs and values, save the name and
   notification choices, dismiss the guide without creating an event, navigate
   normally, and remain completed after restart.

Schedule, notification preferences and completion are separate transactions.
A later failure can leave earlier writes persisted; the assertions require the
completion marker to stay unset and retry to preserve the draft without duplicate
routines. They do not claim the entire finish operation is one transaction.

## Scope

Coverage targets every distinct offered decision, navigation edge, timing option
and error/retry branch. It does not enumerate every permutation, arbitrary input,
time value, or repeated Back sequence. Boundary values and representative plans
cover those open-ended inputs.

Apple, Google and email are currently preview dialogs in this entry. Their two
exits are covered; external OAuth and account creation are not implemented or
verified by this suite. Simulator notification permission checks do not prove
physical-device notification delivery. Draft answers are currently in memory:
an interrupted, unfinished setup returns to welcome; completed setup persists.

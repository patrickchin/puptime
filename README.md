# Puptime

Puptime is a private, offline puppy routine tracker for Android and iOS. Log potty results, outside trips, walks, meals, and timed naps from the app or a home-screen widget, then compare when each activity happens from day to day.

## What it includes

- One-tap logging for pee, poop, meals, potty trips, walks, and naps, with haptic confirmation and undo
- A Today overview that shows the next routine activity and live daily completion progress
- A recent-first, filterable activity history with an expandable month-and-year archive
- Common extra activities plus reusable custom names such as grooming or medication
- Start/end nap tracking with a visible running state and editable start and end times
- A chronological log grouped by day, with automatically saved activity, name, note, date, and time edits
- Optional notes on every log, with native speech-to-text dictation
- An editable daily routine with native time pickers and clear logged, due, upcoming, and missed states
- Optional per-activity daily reminders, scheduled locally on the device
- A 10-day timing timeline with one row per calendar day, 15-minute windows, activity filters, and visible nap spans
- A compact month-by-month pace view for scanning older patterns without crowding out recent activity
- Pee and poop frequency summaries with per-recorded-day averages, observed ranges, and typical gaps between logs
- A reviewable routine suggestion built from recurring activity times across at least three recorded days
- Reviewable possible missed logs learned from strong repeated patterns, including estimated nap spans when prior durations are consistent
- A spreadsheet-ready CSV export of the complete activity history, including notes and exact timestamps
- Customizable, color-coded Android and iOS home-screen widgets with clear activity icons
- Ten named themes—Meadow, Sunrise, Midnight, Paper, Bubblegum, Blueprint, Trail, Tide, Plum, and Contrast—with distinct color, shape, spacing, type, surface, icon, and writing treatments
- An independent language setting for the system language, English, Simplified Chinese, or Spanish
- On-device storage—no account, subscription, server, ads, or tracking

The starter routine is only an editable example, not veterinary guidance. Change it to fit your puppy and your veterinarian’s advice.

## Install on Android

Download the APK from the [latest GitHub release](https://github.com/patrickchin/puptime/releases/latest), open it on your phone, and allow installation from that source if Android asks.

Tap the widget button on the Today screen to choose the two to four actions shown on your home screen. Pee, poop, and meals are the default; an active nap temporarily appears so it can always be ended.

The Android widget has two useful heights:

- One row: only the chosen action buttons, without latest-activity or time text.
- Two rows: the same chosen actions plus `−15` and `+15` controls for logging up to one hour ago. The time resets to **Now** after logging.

Long-press the widget to show Android’s resize handles, then drag the vertical handle to switch layouts. Inside the app, tap the pencil beside any point-in-time log to correct its activity, custom name, date, time, or note. Edits save automatically, including when you close the editor. Nap logs expose editable start and end dates and times.

Puptime never closes an open nap or silently adds estimated sleep. If you forgot to stop a nap, tap **End nap** when you remember, then use the pencil on that nap to correct the end. A possible-gap suggestion may offer a reviewable nap span learned from prior durations; it becomes an editable log only after you tap **Add log**. Old nap taps from Puptime 1.1 remain unchanged as historical point events.

Saved notes and activity data stay on your device. Voice dictation uses your phone's Apple or Android speech-recognition service, which may require a network connection depending on the device and downloaded language models.

From **Insights**, use **Export activity CSV** to open the system share sheet. Puptime creates the file in temporary app storage; your data goes nowhere until you choose an app or destination.

Routine reminders are optional. Turn one on while editing a planned time and allow notifications when the phone asks. Puptime schedules repeating reminders locally; it does not upload the routine or require a notification server.

The routine suggestion also stays entirely on the device. It looks at the last 14 days, keeps activities that recur on most recorded days, and rounds their typical times to 15 minutes. You can preview the complete suggestion before replacing the current routine, and generated reminders start off.

See [How Puptime learns patterns](LEARNING.md) for the exact routine-learning, event-matching, missing-log, and nap-estimation algorithms and their limits.

## Run locally

Requires Node.js 22.13 or newer, the Android SDK for Android, and Xcode for iOS.

```sh
npm ci
npm run prebuild
npm run android
```

The widgets use native extensions, so they require a development or release build rather than Expo Go. Interactive iOS widget buttons require iOS 17 or newer.

## Checks and release build

```sh
npm run typecheck
npm test
npx expo export --platform android
npx expo export --platform ios
npm run build:android
```

The release APK is written to `android/app/build/outputs/apk/release/app-release.apk`.

GitHub Actions also performs an unsigned native iOS Simulator build of the app and widget, installs and launches it, then keeps the zipped `.app` and smoke-test screenshot as short-lived workflow artifacts.

## Stack

- Expo SDK 57 / React Native 0.86 / React 19
- TypeScript
- AsyncStorage for offline persistence
- `react-native-android-widget` on Android
- Expo Widgets and SwiftUI on iOS

## License

MIT

## Privacy

See the [Puptime privacy policy](PRIVACY.md).

# Puptime

Puptime is a private, offline puppy routine tracker for Android and iOS. Log potty results, outside trips, walks, meals, and timed naps from the app or a home-screen widget, then compare when each activity happens from day to day.

## Screenshots

<table>
  <tr>
    <th>Today</th>
    <th>Activity history</th>
    <th>Insights</th>
  </tr>
  <tr>
    <td><img src="assets/screenshots/today.png" width="260" alt="Puptime Today screen with quick logging and routine progress"></td>
    <td><img src="assets/screenshots/activity.png" width="260" alt="Puptime activity history with notes and timed naps"></td>
    <td><img src="assets/screenshots/insights-summary.png" width="260" alt="Puptime insights with frequency summaries and possible missing logs"></td>
  </tr>
  <tr>
    <th>Timing patterns</th>
    <th>Daily routine</th>
    <th>Appearance</th>
  </tr>
  <tr>
    <td><img src="assets/screenshots/insights-timeline.png" width="260" alt="Puptime timing timeline comparing activity across ten days"></td>
    <td><img src="assets/screenshots/schedule.png" width="260" alt="Puptime editable daily routine with suggested times and progress"></td>
    <td><img src="assets/screenshots/appearance.png" width="260" alt="Puptime appearance picker showing its visual themes"></td>
  </tr>
</table>

## What it includes

- One-tap logging for pee, poop, meals, potty trips, walks, and naps, with haptic confirmation and undo
- A Today overview that shows the next routine activity and live daily completion progress
- A recent-first, filterable activity history with an expandable month-and-year archive
- Common extra activities plus reusable custom names such as grooming or medication
- Start/end nap tracking with a visible running state and editable start and end times
- A chronological log grouped by day, with automatically saved activity, name, note, date, and time edits
- Optional notes on every log, with native speech-to-text dictation
- An editable daily routine with native time pickers and clear logged, due, upcoming, and missed states
- Optional per-activity daily reminders, scheduled locally with an adjustable 0-, 5-, 10-, 15-, or 30-minute lead time
- A 10-, 20-, or 30-day timing timeline with one compressed row per calendar day, 15-minute windows, overlaid activity marks, and visible nap spans
- A compact month-by-month pace view for scanning older patterns without crowding out recent activity
- Pee and poop frequency summaries with per-recorded-day averages, observed ranges, and typical gaps between logs
- A reviewable routine suggestion built from recurring activity times across at least three recorded days
- Reviewable possible missed logs learned from strong repeated patterns, including estimated nap spans when prior durations are consistent
- A spreadsheet-ready CSV export of the complete activity history, including notes and exact timestamps
- Customizable, color-coded Android and iOS home-screen widgets with clear activity icons, immediate saved feedback, and optional confirmation notifications with **Add note** and **Edit details** actions
- One Settings screen for appearance, language, widget actions, notification access, widget confirmations, and reminder timing
- Ten named themes—Meadow, Sunrise, Midnight, Paper, Bubblegum, Blueprint, Trail, Tide, Plum, and Contrast—with distinct color, shape, spacing, type, surface, icon, and writing treatments
- An independent language setting for the system language, English, Simplified Chinese, or Spanish
- On-device storage—no account, subscription, server, ads, or tracking

The starter routine is only an editable example, not veterinary guidance. Change it to fit your puppy and your veterinarian’s advice.

## Install on Android

Download the APK from the [latest GitHub release](https://github.com/patrickchin/puptime/releases/latest), open it on your phone, and allow installation from that source if Android asks.

Open Settings from the gear on the Today screen to choose the two to four actions shown on your home screen. Pee, poop, and meals are the default; an active nap temporarily appears so it can always be ended.

The Android widget uses the available height for its action buttons. Long-press it to resize the widget, or tap the pencil beside any point-in-time log in the app to correct its activity, custom name, date, time, or note. Edits save automatically, including when you close the editor. Nap logs expose editable start and end dates and times.

Puptime never closes an open nap or silently adds estimated sleep. If you forgot to stop a nap, tap **End nap** when you remember, then use the pencil on that nap to correct the end. A possible-gap suggestion may offer a reviewable nap span learned from prior durations; it becomes an editable log only after you tap **Add log**. Old nap taps from Puptime 1.1 remain unchanged as historical point events.

Saved notes and activity data stay on your device. Voice dictation uses your phone's Apple or Android speech-recognition service, which may require a network connection depending on the device and downloaded language models.

From **Insights**, use **Export activity CSV** to open the system share sheet. Puptime creates the file in temporary app storage; your data goes nowhere until you choose an app or destination.

Routine reminders are optional. Turn one on while editing a planned time, then choose how early reminders should arrive in Settings. Puptime schedules repeating reminders locally; it does not upload the routine or require a notification server. Settings can also enable a local confirmation after every widget log so you can immediately add a note or open the full editor.

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

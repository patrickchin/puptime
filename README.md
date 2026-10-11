# Puptime

Puptime is a puppy activity log for Android and iOS. Data stays on the device.

## Screenshots

<table>
  <tr>
    <th>Log</th>
    <th>Home Screen widget</th>
    <th>Insights</th>
  </tr>
  <tr>
    <td><img src="assets/screenshots/today.png" width="260" alt="Puptime Log screen with pee, poop, eat, and one card per day"></td>
    <td><img src="assets/screenshots/widget.jpg" width="260" alt="Puptime quick logging widget on the iPhone Home Screen"></td>
    <td><img src="assets/screenshots/insights-summary.png" width="260" alt="Puptime insights with frequency summaries and possible missing logs"></td>
  </tr>
  <tr>
    <th>Timing patterns</th>
    <th>Daily routine</th>
    <th>Settings</th>
  </tr>
  <tr>
    <td><img src="assets/screenshots/insights-timeline.png" width="260" alt="Puptime timing timeline comparing activity across ten days"></td>
    <td><img src="assets/screenshots/schedule.png" width="260" alt="Puptime editable daily routine with suggested times and progress"></td>
    <td><img src="assets/screenshots/appearance.png" width="260" alt="Puptime Settings screen with theme, language, widget, and notification controls"></td>
  </tr>
</table>

## Features

- Log pee, poop, and meals with one tap, haptic confirmation, and undo. Earlier logs of other activities remain in history.
- Use a configured widget action to start and stop naps, then edit their start and end times.
- Add typed or dictated notes and edit an activity, name, date, time, or note.
- See today and yesterday together, expand earlier dates, and load more history as needed.
- Set a daily routine, choose when reminders arrive, and review suggested times before using them.
- Get customizable potty nudges after the latest pee or meal log.
- Compare activity timing across 10, 20, or 30 days and view pee and poop frequency summaries.
- See possible missing logs, including estimated nap spans, automatically faded on the timeline without adding them to history. Saved estimates stay labeled and do not influence learned routines or recorded statistics.
- Export and import activity CSV backups with stable IDs, notes, exact timestamps, nap states, and estimate labels. Reimporting preserves existing edits.
- Choose two to four Home Screen widget actions and optional confirmation notifications.
- Manage themes, language, widget actions, and notifications in Settings.
- Read a short getting-started guide and 12 detailed puppy-care articles in **Learn**, with section citations, further reading, and selected YouTube demonstrations. The same guides are on the website under **Puppy care**. Articles are currently in English; in-app navigation supports all app languages. Text works offline; external resources need a browser and internet connection.
- Keep data on the device without an account, subscription, server, ads, analytics, or tracking.

The starter routine is only an editable example, not veterinary guidance. Change it to fit your puppy and your veterinarian’s advice.

## Install on Android

Download the APK from the [latest GitHub release](https://github.com/patrickchin/puptime/releases/latest), open it on your phone, and allow installation from that source if Android asks.

Open Settings from the gear on the Log screen to choose the two to four actions shown on your home screen. Pee, poop, and meals are the default; an active nap temporarily appears so it can always be ended from the widget.

The Android widget uses the available height for its action buttons. Long-press it to resize it. In the app, tap the pencil beside a log to change its activity, custom name, date, time, or note. Edits save automatically, even if you close the editor. Nap logs have separate start and end times.

Puptime does not end an open nap or add estimated sleep to your logs. If you forgot to stop a nap, tap **End nap** on the widget, then edit its end time. Possible gaps appear automatically as faded marks on the timeline; they remain uncertain and are excluded from log counts, exports, and reminders. Nap taps saved by Puptime 1.1 remain point events.

Saved notes and activity data stay on your device. Voice dictation uses your phone's Apple or Android speech-recognition service, which may require a network connection depending on the device and downloaded language models.

From **Insights → Activity backup**, use **Export CSV** to open the system share sheet. Puptime creates the file in temporary app storage. The data is not sent until you choose a destination. **Import CSV** opens your device’s file picker and accepts a Puptime activity export. It adds missing event IDs, skips existing IDs without overwriting current edits, and reports both counts. The entire file is checked before any activity is saved; invalid files and imports that would leave multiple naps running are rejected. Backups include activity only, so routines and settings must be set up separately. Development exports from before the import schema are not supported.

Saved estimated entries retain an **Estimated** label in history, Timeline, and backups, even after editing or importing. Recorded averages, routine learning, routine completion, last-log timestamps, and potty reminders exclude these estimates. Suggestions you have not added are never exported.

Routine reminders are optional. Turn one on while editing a planned time, then choose how early reminders should arrive in Settings. Puptime can also remind you after the latest pee or meal; the default potty nudges are two hours after a pee and 30 minutes after a meal, and each can be turned off or changed from 15 minutes to four hours. Puptime schedules reminders locally; it does not upload the routine or require a notification server. Settings can also enable a local confirmation after every widget log so you can immediately add a note or open the full editor.

Routine suggestions also stay on the device. Puptime checks the last 14 completed days and finds recurring time windows across distinct recorded days. The review shows typical variation and how many days support each pattern; extra taps and skipped early activities do not shift every later slot. These windows are guides, not deadlines. You review the full suggestion before replacing the current routine. Suggested reminders start off and use the window's central time if enabled.

See [How Puptime learns patterns](LEARNING.md) for the exact routine-learning, event-matching, missing-log, and nap-estimation algorithms and their limits.

## Run locally

Requires Node.js 22.18 or newer, the Android SDK for Android, and Xcode for iOS.

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

## iOS end-to-end tests

The Maestro suite covers navigation, core logging and persistence, routine editing and reminder permission handling, widget and appearance settings, localization, Insights, and Timeline controls.

Install [Maestro](https://docs.maestro.dev/maestro-cli/how-to-install-maestro-cli), boot an iOS 26 Simulator, and install a local Puptime build with `npm run ios`. Keep Expo running, then run this in another terminal:

```sh
npm run test:e2e:ios
```

Every flow clears app state before it starts. GitHub Actions also runs the complete suite against the standalone Release build and uploads the Maestro report and failure artifacts.

The release APK is written to `android/app/build/outputs/apk/release/app-release.apk`.

GitHub Actions also performs an unsigned native iOS Simulator build of the app and widget, installs and launches it, then keeps the zipped `.app` and smoke-test screenshot as short-lived workflow artifacts.

See [Puppy care research](PUPPY_CARE_RESEARCH.md) for the source selection, evidence differences, and content maintenance notes.

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

# Puptime

Puptime is a puppy activity log for potty breaks, meals, walks, and daily routines. Local logging stays free without an account. Optional cloud backup and device sync are being qualified separately from existing offline releases. The website provides account management and consent-controlled analytics; see [Privacy](PRIVACY.md).

## Existing offline release

The screenshots, features, and Android installation instructions below describe the published offline release. Android, widgets, and nap-related changes are deferred during the account-enabled iPhone rollout.

### Screenshots

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

### Features

- Log pee, poop, and meals with one tap, haptic confirmation, and undo. Earlier logs of other activities remain in history.
- Use a configured widget action to start and stop naps, then edit their start and end times.
- Add typed or dictated notes and edit an activity, name, date, time, or note.
- See today and yesterday together, expand earlier dates, and load more history as needed.
- Set a daily routine, choose when reminders arrive, and review suggested times before using them.
- Get customizable potty nudges after the latest pee or meal log.
- Compare timing in two Timeline views: Pee, and Poop & Eat together. Load earlier dates as needed and view pee and poop frequency summaries in Insights.
- Set expected eating and poop windows while editing a time in Schedule. Choose how many minutes before and after the planned time to highlight on every Timeline day, including dates without logs. Highlights follow the activity filter; accepted learned routine windows appear automatically. Reminders still use the planned time.
- See possible missing logs, including estimated nap spans, automatically faded on the timeline without adding them to history. Saved estimates stay labeled and do not influence learned routines or recorded statistics.
- Export and import activity CSV backups with stable IDs, notes, exact timestamps, nap states, and estimate labels. Reimporting preserves existing edits.
- Choose two to four Home Screen widget actions and optional confirmation notifications.
- Use the default style in Light or Dark mode, or follow the device setting. Removed theme selections fall back to the device setting.
- Manage appearance, language, widget actions, and activity data in Settings. Manage reminders and device delivery in Notifications.
- Browse illustrated topic cards in **Learn**, with a short getting-started guide and 12 detailed puppy-care articles. Each article opens with an at-a-glance overview and links to its sections and sources, plus further reading and selected YouTube demonstrations. The same guides are on the website under **Puppy care**. Articles are currently in English; in-app navigation supports all app languages. Text and bundled English ElevenLabs narration work offline in the app; external resources need a browser and internet connection. Each guide has play/pause, 15-second skips, and playback speed controls.
- Keep activity data on the device without an account, subscription, server or ads. Optional anonymous usage analytics are off by default and controlled in Settings.

The starter routine is only an editable example, not veterinary guidance. Change it to fit your puppy and your veterinarian’s advice.

### Install on Android

Download the APK from the [latest GitHub release](https://github.com/patrickchin/puptime/releases/latest), open it on your phone, and allow installation from that source if Android asks.

The top bar shows the current screen title. Use the labeled switch in Log and Timeline to move between them in one tap; the menu opens Insights, Schedule, Notifications, Puppy care, and Settings. Settings returns to the screen you came from.

Open Settings from the navigation menu to choose the two to four actions shown on your home screen. Pee, poop, and meals are the default; an active nap temporarily appears so it can always be ended from the widget.

The Android widget uses the available height for its action buttons. Long-press it to resize it. In the app, tap the pencil beside a log to change its activity, custom name, date, time, or note. Edits save automatically, even if you close the editor. Nap logs have separate start and end times.

Puptime does not end an open nap or add estimated sleep to your logs. If you forgot to stop a nap, tap **End nap** on the widget, then edit its end time. Possible gaps appear automatically as faded marks on the timeline; they remain uncertain and are excluded from log counts, exports, and reminders. Nap taps saved by Puptime 1.1 remain point events.

Saved notes and activity data stay on your device. Voice dictation uses your phone's Apple or Android speech-recognition service, which may require a network connection depending on the device and downloaded language models.

From **Settings → Activity data**, use **Export CSV** to open the system share sheet. Puptime creates the file in temporary app storage. The data is not sent until you choose a destination. **Import CSV** opens your device’s file picker and accepts a Puptime activity export. It adds missing event IDs, skips existing IDs without overwriting current edits, and reports both counts. The entire file is checked before any activity is saved; invalid files and imports that would leave multiple naps running are rejected. Backups include activity only, so routines and settings must be set up separately. Development exports from before the import schema are not supported.

On iOS and Android, **Settings → Local log backups** automatically backs up every dog stored locally, keeping 30 compact daily activity snapshots per dog in the app’s persistent Documents storage, separate from SQLite. A snapshot is saved on the first use each local day (or after the first log if the journal is empty). While open, Puptime also checks for a new day every minute. Later logs enter the next day’s snapshot; no exact background schedule is promised while the app is closed. Empty journals never rotate existing snapshots out. Snapshot files are written to a temporary file, renamed, and read back before older valid copies are removed. Damaged files are preserved. Recovery adds missing IDs through the transactional importer, keeps current edits, and rejects nap conflicts without partial writes. For cloud-linked logs, recovery sends explicit restores for acknowledged deletions and waits for pending changes before recovering those IDs. Snapshots from before a database reset remain visible with their puppy name. Recovery targets the snapshot’s original local puppy ID, recreating a missing puppy profile when necessary. It preserves existing names and edits and leaves the active puppy unchanged, even when dogs share event IDs. **Export CSV** opens the system share sheet so a copy can be saved outside the app; uninstalling or clearing app storage removes local snapshots. These snapshots contain logs only, including notes, custom labels, nap state and estimates; they exclude routines, settings, credentials and sync state. Puptime also keeps up to 10 safety snapshots per dog before account sign-in/sign-out, cloud association or replacement (including full resync and destructive cloud projections), CSV import, recovery and log deletion. Each safety checkpoint covers all locally stored dogs. The daily and safety limits are independent per dog, so one dog’s activity cannot rotate another dog’s snapshots out. They bypass the daily limit and include the latest logs; unchanged retries are deduplicated. The latest checkpoint for each safety reason is protected from other reasons rotating it out. Failed required backups abort the associated local transaction; account credentials are not changed if the pre-authentication checkpoint fails. Native version/build changes trigger a snapshot on first launch, inside the initialization transaction before any schema changes; mobile operating systems do not provide a reliable app callback before installing an update. Existing installations receive a checkpoint when this protection is first installed. Unreadable data or an unsupported old schema stops initialization rather than resetting the database.

Saved estimated entries retain an **Estimated** label in history, Timeline, and backups, even after editing or importing. Recorded averages, routine learning, routine completion, last-log timestamps, and potty reminders exclude these estimates. Suggestions you have not added are never exported.

Routine reminders are optional. Turn one on while editing a planned time, then choose how early reminders should arrive in Notifications. Puptime can also remind you after the latest pee or meal; the default potty nudges are two hours after a pee and 30 minutes after a meal, and each can be turned off or changed from 15 minutes to four hours. Puptime schedules reminders locally; it does not upload the routine or require a notification server. Settings can also enable a local confirmation after every widget log so you can immediately add a note or open the full editor.

Routine suggestions also stay on the device. Puptime checks the last 14 completed days and finds recurring time windows across distinct recorded days. The review shows typical variation and how many days support each pattern; extra taps and skipped early activities do not shift every later slot. These windows are guides, not deadlines. You review the full suggestion before replacing the current routine. Suggested reminders start off and use the window's central time if enabled.

See [How Puptime learns patterns](LEARNING.md) for the exact routine-learning, event-matching, missing-log, and nap-estimation algorithms and their limits.

## Run locally

Requires Node.js 22.18 or newer, the Android SDK for Android, and Xcode for iOS.

```sh
npm ci
npm run prebuild
npm run ios
```

The widgets use native extensions, so they require a development or release build rather than Expo Go. Interactive iOS widget buttons require iOS 17 or newer.

## Checks and release build

For the public website's static pages, analytics configuration, and Google indexing setup, see [Website operations](docs/website-operations.md).

For the standalone backend, scoped integration keys, REST routes and OpenAPI contract, see [Puptime API](docs/api.md).

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
- Expo SQLite for the account-enabled iOS store; AsyncStorage for legacy storage and migration
- `react-native-android-widget` on Android
- Expo Widgets and SwiftUI on iOS

## License

MIT for the application code. The website’s bundled Red Hat Display and Red Hat Text fonts use the SIL Open Font License; see `public/fonts/*-OFL.txt`. The ElevenLabs recordings in `assets/puppy-care/audio` are provided for noncommercial use with attribution; they are not licensed under MIT. See [narration notes](assets/puppy-care/audio/README.md).

## Privacy

See the [Puptime privacy policy](PRIVACY.md).

For optional native product telemetry, event definitions, analysis recipes and verification, see [App telemetry](docs/app-telemetry.md).

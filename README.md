# Puptime

Puptime is a private, offline puppy routine tracker for Android and iOS. Log potty results, outside trips, walks, meals, and timed naps from the app or a home-screen widget, then review the full history, weekly activity, nap duration, and schedule consistency.

## What it includes

- One-tap logging for pee, poop, meals, potty trips, walks, and naps, with haptic confirmation and undo
- A Today overview that shows the next routine activity and live daily completion progress
- Filterable history for quickly reviewing potty, meal, walk, nap, or custom logs
- Common extra activities plus reusable custom names such as grooming or medication
- Start/end nap tracking with a visible running state and editable start and end times
- A chronological log grouped by day, with editable activity types, custom names, notes, and exact dates and times
- Optional notes on every log, with native speech-to-text dictation
- An editable daily routine with native time pickers and clear logged, due, upcoming, and missed states
- Optional per-activity daily reminders, scheduled locally on the device
- Seven-day activity, nap-duration, and schedule-adherence charts
- Polished, color-coded Android and iOS home-screen widgets with clear activity icons
- Automatic light and dark themes
- On-device storage—no account, subscription, server, ads, or tracking

The starter routine is only an editable example, not veterinary guidance. Change it to fit your puppy and your veterinarian’s advice.

## Install on Android

Download the APK from the [latest GitHub release](https://github.com/patrickchin/puptime/releases/latest), open it on your phone, and allow installation from that source if Android asks.

The Android widget has two useful heights:

- One row: four compact buttons that immediately log pee, poop, meals, or the nap start/end state.
- Two rows: adds **Out** and **Walk**. Tap `−5` or `+5` to choose a time up to one hour ago, then tap the activity. It resets to **Now** after logging.

Long-press the widget to show Android’s resize handles, then drag the vertical handle to switch layouts. Inside the app, tap the pencil beside any point-in-time log to correct its activity, custom name, date, time, or note. Nap logs expose editable start and end dates and times.

Puptime never invents a nap end time. If you forgot to stop a nap, tap **End nap** when you remember, then use the pencil on that nap to correct the end. Old nap taps from Puptime 1.1 remain unchanged as historical point events.

Saved notes and activity data stay on your device. Voice dictation uses your phone's Apple or Android speech-recognition service, which may require a network connection depending on the device and downloaded language models.

Routine reminders are optional. Turn one on while editing a planned time and allow notifications when the phone asks. Puptime schedules repeating reminders locally; it does not upload the routine or require a notification server.

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

## Stack

- Expo SDK 57 / React Native 0.86 / React 19
- TypeScript
- AsyncStorage for offline persistence
- `react-native-android-widget` on Android
- Expo Widgets and SwiftUI on iOS

## License

MIT

# Puptime

Puptime is a private, offline puppy routine tracker for Android and iOS. Log potty results, outside trips, walks, meals, and timed naps from the app or a home-screen widget, then review the full history, weekly activity, nap duration, and schedule consistency.

## What it includes

- One-tap logging for pee, poop, meals, potty trips, walks, and naps, with haptic confirmation and undo
- Common extra activities plus reusable custom names such as grooming or medication
- Start/end nap tracking with a visible running state and editable start and end times
- A chronological log grouped by day, with quick backdating and exact time editing
- An editable daily routine with native time pickers
- Seven-day activity, nap-duration, and schedule-adherence charts
- Polished, color-coded Android and iOS home-screen widgets with clear activity icons
- Automatic light and dark themes
- On-device storage—no account, server, ads, or tracking

The starter routine is only an editable example, not veterinary guidance. Change it to fit your puppy and your veterinarian’s advice.

## Install on Android

Download the APK from the [latest GitHub release](https://github.com/patrickchin/puptime/releases/latest), open it on your phone, and allow installation from that source if Android asks.

The Android widget has two useful heights:

- One row: four compact buttons that immediately log pee, poop, meals, or the nap start/end state.
- Two rows: adds **Out** and **Walk**. Tap `−5` or `+5` to choose a time up to one hour ago, then tap the activity. It resets to **Now** after logging.

Long-press the widget to show Android’s resize handles, then drag the vertical handle to switch layouts. Inside the app, tap the pencil beside any log to change its time. Nap logs expose both start and end times.

Puptime never invents a nap end time. If you forgot to stop a nap, tap **End nap** when you remember, then use the pencil on that nap to correct the end. Old nap taps from Puptime 1.1 remain unchanged as historical point events.

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

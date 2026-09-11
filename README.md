# Puptime

Puptime is a private, offline puppy routine tracker for Android and iOS. Log pee, poop, meals, and naps in one tap from the app or a home-screen widget, then review the full history, weekly activity, and schedule consistency.

## What it includes

- One-tap logging with haptic confirmation and undo
- A chronological log grouped by day, with quick backdating and exact time editing
- An editable daily routine with native time pickers
- Seven-day activity and schedule-adherence charts
- Interactive Android and iOS home-screen widgets
- Automatic light and dark themes
- On-device storage—no account, server, ads, or tracking

The starter routine is only an editable example, not veterinary guidance. Change it to fit your puppy and your veterinarian’s advice.

## Install on Android

Download the APK from the [latest GitHub release](https://github.com/patrickchin/puptime/releases/latest), open it on your phone, and allow installation from that source if Android asks.

The Android widget has two useful heights:

- One row: four compact buttons that immediately log the current time.
- Two rows: tap `−5` or `+5` to choose a time up to one hour ago, then tap the activity. It resets to **Now** after logging.

Long-press the widget to show Android’s resize handles, then drag the vertical handle to switch layouts. Inside the app, tap the pencil beside any logged time for Now, 5/15/30/60-minute shortcuts or the exact native time picker.

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

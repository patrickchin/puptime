# Puptime

Puptime is a private, offline puppy routine tracker for Android and iOS. Log pee, poop, meals, and naps in one tap from the app or a home-screen widget, then review the full history, weekly activity, and schedule consistency.

## What it includes

- One-tap logging with haptic confirmation and undo
- A chronological log grouped by day
- An editable daily routine with native time pickers
- Seven-day activity and schedule-adherence charts
- Interactive Android and iOS home-screen widgets
- Automatic light and dark themes
- On-device storage—no account, server, ads, or tracking

The starter routine is only an editable example, not veterinary guidance. Change it to fit your puppy and your veterinarian’s advice.

## Run locally

Requires Node.js 22.13 or newer, the Android SDK for Android, and Xcode for iOS.

```sh
npm ci
npm run prebuild
npm run android
```

The widgets use native extensions, so they require a development or release build rather than Expo Go.

## Checks and release build

```sh
npm run typecheck
npm test
npx expo export --platform android
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
